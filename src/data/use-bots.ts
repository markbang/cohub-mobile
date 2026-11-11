import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { botEntries, isBotSpace, latestBotNote, newerSession, type BotNote } from "@/src/data/bot-mode";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { loadBotListCache, saveBotListCache } from "@/src/data/local-db";
import { ensureBotChats, readBotFile } from "@/src/data/primary-bot";
import { sessionListStatus } from "@/src/data/session-status";
import { useScreenVisible } from "@/src/ui/pane";
import { displaySpaceName } from "@/src/utils";

// Realtime reaches only the Bots on screen; the rest reconcile on this interval while the view is visible.
const POLL_MS = 30_000;
const NEEDS_YOU_LABEL = "needs-you";
// Bots whose Chats and hook were checked on open this launch; a later open goes straight in.
const checked = new Set<string>();
// A row painted from disk: stale, so its reads still run, and later than 0, so the rows' update stamps pick it up.
const CACHED_AT = 1;

type CachedBot = { file: Awaited<ReturnType<typeof readBotFile>>; note: BotNote | null };

/** `bot.json` and the Chats it names; shared with the Chat screen, which reads it to know a Bot's Chats. */
export const botFileQuery = (client: CohubClient | null, spaceId: string) => ({
  queryKey: [`bots:${spaceId}:file`],
  queryFn: () => readBotFile(client!, spaceId),
});

const botNoteKey = (spaceId: string, chatId: string | undefined) => [`chats:bots:${spaceId}:said:${chatId}`];

/**
 * The Bots view: one row per Bot. Its line, time, and unread come from the last thing the Bot said in the
 * user's Chat; running and `needs-you` from the Chat it works in.
 */
export function useBots(enabled: boolean) {
  const { client, userKey, refreshSessionStatuses } = useAppActions();
  const queryClient = useQueryClient();
  const visible = useScreenVisible();
  const spaces = useAppSelector(({ state }) => state.spaces.filter(isBotSpace), shallowEqual);
  const active = enabled && Boolean(client);
  // Each row's line otherwise waits on three reads in a row (`bot.json`, its Chats, their Turns) after every cold start.
  useEffect(() => {
    if (!active) return;
    let current = true;
    void loadBotListCache<CachedBot>(userKey).then((cached) => {
      if (!current) return;
      for (const [spaceId, row] of cached) {
        const fileKey = botFileQuery(client, spaceId).queryKey;
        if (queryClient.getQueryData(fileKey) === undefined) queryClient.setQueryData(fileKey, row.file, { updatedAt: CACHED_AT });
        const noteKey = botNoteKey(spaceId, row.file.chat?.id);
        if (queryClient.getQueryData(noteKey) === undefined) queryClient.setQueryData(noteKey, row.note, { updatedAt: CACHED_AT });
      }
    }).catch(() => undefined);
    return () => { current = false; };
  }, [active, client, queryClient, userKey]);
  const fileQueries = useQueries({ subscribed: visible, queries: spaces.map((space) => ({ ...botFileQuery(client, space.id), enabled: active, refetchInterval: POLL_MS })) });
  const files = fileQueries.map((query) => query.data ?? null);
  const noteQueries = useQueries({ subscribed: visible, queries: spaces.map((space, index) => {
    const chatId = files[index]?.chat?.id;
    return {
      queryKey: botNoteKey(space.id, chatId),
      queryFn: async (): Promise<BotNote | null> => latestBotNote((await client!.space(space.id).session(chatId!).turns.listPaginated({ limit: 20 })).turns),
      enabled: active && Boolean(chatId),
      refetchInterval: POLL_MS,
    };
  }) });
  const needsYouQueries = useQueries({ subscribed: visible, queries: spaces.map((space, index) => {
    const sessionId = files[index]?.session?.id;
    return {
      // The Bot labels its working Chat (`$COHUB_SESSION_ID`) when it needs the user.
      queryKey: [`chats:bots:${space.id}:needs-you:${sessionId}`],
      queryFn: async (): Promise<boolean> => (await client!.space(space.id).labels.getResourceLabels("session", sessionId!)).labels.some((label) => label.name === NEEDS_YOU_LABEL),
      enabled: active && Boolean(sessionId),
      refetchInterval: POLL_MS,
    };
  }) });

  const filesKey = fileQueries.map((query) => query.dataUpdatedAt).join(",");
  const home = useAppSelector(({ state }) => files.map((file) => file?.session ? state.sessions.find((item) => item.id === file.session!.id) ?? null : null), shallowEqual);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mains = useMemo(() => files.flatMap((file, index) => { const main = newerSession<SessionRecord>(file?.session, home[index]); return main ? [main] : []; }), [filesKey, home]);
  useEffect(() => {
    if (active && mains.length) void refreshSessionStatuses(mains, { silent: true });
  }, [active, mains, refreshSessionStatuses]);
  const running = useAppSelector(({ state }) => mains.filter((session) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running").map((session) => session.spaceId), shallowEqual);
  const needsYou = spaces.filter((_, index) => needsYouQueries[index]?.data === true).map((space) => space.id);
  const stamps = [...noteQueries, ...needsYouQueries].map((query) => query.dataUpdatedAt).join(",");
  useEffect(() => {
    spaces.forEach((space, index) => {
      const file = fileQueries[index];
      const note = noteQueries[index];
      if (!file?.data || !note?.isSuccess || note.dataUpdatedAt <= CACHED_AT) return;
      void saveBotListCache(userKey, space.id, { file: file.data, note: note.data ?? null } satisfies CachedBot).catch(() => undefined);
    });
    // The queries' contents change only with their update stamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, stamps, userKey]);
  const entries = useMemo(() => botEntries(spaces, new Map(spaces.map((space, index) => [space.id, { note: noteQueries[index]?.data ?? null, chatId: files[index]?.chat?.id ?? null }])), new Set(running), new Set(needsYou)),
    // The queries' contents change only with their update stamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, filesKey, stamps, running]);
  const failed = [...fileQueries, ...noteQueries, ...needsYouQueries].find((query) => query.error)?.error;

  /** The user's Chat with a Bot; one the Bot does not have yet (an older or hand-made Bot) is made on first open, as for the primary Bot. */
  const openChat = useCallback(async (spaceId: string): Promise<string> => {
    const known = queryClient.getQueryData<Awaited<ReturnType<typeof readBotFile>>>(botFileQuery(client, spaceId).queryKey);
    if (known?.chat && known.session && checked.has(spaceId)) return known.chat.id;
    const space = spaces.find((item) => item.id === spaceId);
    const { chat } = await ensureBotChats(client!, spaceId, displaySpaceName(space));
    checked.add(spaceId);
    void queryClient.invalidateQueries({ queryKey: botFileQuery(client, spaceId).queryKey });
    return chat.id;
  }, [client, queryClient, spaces]);

  return {
    entries,
    loading: fileQueries.some((query) => query.isPending && query.isFetching),
    error: failed ? failed.message : null,
    openChat,
    refetch: () => Promise.all([...fileQueries, ...noteQueries, ...needsYouQueries].map((query) => query.refetch())).then(() => undefined),
  };
}
