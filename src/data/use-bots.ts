import type { SessionRecord } from "@neta-art/cohub";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { botEntries, isBotSpace, newerSession } from "@/src/data/bot-mode";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { ensureBotSession, readBotSession } from "@/src/data/primary-bot";
import { sessionListStatus } from "@/src/data/session-status";
import { useScreenVisible } from "@/src/ui/pane";

// Realtime reaches only the Bots on screen; the rest reconcile on this interval while the view is visible.
const POLL_MS = 30_000;

/** Reads `bot.json` and the Chat it names; outside realtime scopes, so a busy Bot's file writes do not re-read it. */
const botSessionKey = (spaceId: string) => [`bots:${spaceId}:session`];

/**
 * The Bots view: one row per Bot Space, each showing only its one Chat. That Chat's newer copy in the
 * cached home list wins over this read, so realtime updates show before the next poll.
 */
export function useBots(enabled: boolean) {
  const { client, refreshSessionStatuses } = useAppActions();
  const queryClient = useQueryClient();
  const visible = useScreenVisible();
  const spaces = useAppSelector(({ state }) => state.spaces.filter(isBotSpace), shallowEqual);
  const active = enabled && Boolean(client);
  const sessionQueries = useQueries({ subscribed: visible, queries: spaces.map((space) => ({
    queryKey: botSessionKey(space.id),
    queryFn: (): Promise<SessionRecord | null> => readBotSession(client!, space.id),
    enabled: active,
    refetchInterval: POLL_MS,
  })) });

  const listed = sessionQueries.map((query) => query.data ?? null);
  const listedKey = sessionQueries.map((query) => query.dataUpdatedAt).join(",");
  const home = useAppSelector(({ state }) => listed.map((session) => session ? state.sessions.find((item) => item.id === session.id) ?? null : null), shallowEqual);
  const sessions = useMemo(() => new Map(spaces.map((space, index) => [space.id, newerSession<SessionRecord>(listed[index], home[index])])),
    // `listed` is rebuilt each render; its contents change only with the queries' update stamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, listedKey, home]);
  const mains = useMemo(() => [...sessions.values()].filter((session): session is SessionRecord => session !== null), [sessions]);
  useEffect(() => {
    if (active && mains.length) void refreshSessionStatuses(mains, { silent: true });
  }, [active, mains, refreshSessionStatuses]);
  const running = useAppSelector(({ state }) => mains.filter((session) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running").map((session) => session.spaceId), shallowEqual);

  const entries = useMemo(() => botEntries(spaces, sessions, new Set(running)), [spaces, sessions, running]);
  const failed = sessionQueries.find((query) => query.error)?.error;

  /** A Bot without a recorded Chat (an older or hand-made one) gets it on first open, by the same rule as the primary Bot. */
  const openSession = useCallback(async (spaceId: string): Promise<string> => {
    const known = sessions.get(spaceId);
    if (known) return known.id;
    const session = await ensureBotSession(client!, spaceId);
    queryClient.setQueryData(botSessionKey(spaceId), session);
    return session.id;
  }, [client, queryClient, sessions]);

  return {
    entries,
    loading: sessionQueries.some((query) => query.isPending && query.isFetching),
    error: failed ? failed.message : null,
    openSession,
    refetch: () => Promise.all(sessionQueries.map((query) => query.refetch())).then(() => undefined),
  };
}
