import type { SessionRecord } from "@neta-art/cohub";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { botEntries, botSessionsBySpace, isBotSpace, NEEDS_YOU_LABEL, needsYouItems } from "@/src/data/bot-mode";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { sessionListStatus } from "@/src/data/session-status";
import { useScreenVisible } from "@/src/ui/pane";

const BOT_SESSION_LIMIT = 20;
// Realtime reaches only the Bots on screen; the rest reconcile on this interval while the view is visible.
const POLL_MS = 30_000;

function httpStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : null;
}

/**
 * The Bots view: each Bot Space's Chats read from the server and merged, painted first from the
 * cached home list. Keys start with `chats` so realtime Chat, Turn, and label events refresh them.
 */
export function useBots(enabled: boolean) {
  const { client, refreshSessionStatuses, requestRunningSessions, releaseRunningSessions } = useAppActions();
  const visible = useScreenVisible();
  const spaces = useAppSelector(({ state }) => state.spaces.filter(isBotSpace), shallowEqual);
  const cached = useAppSelector(({ state }) => state.sessions.filter((session) => spaces.some((space) => space.id === session.spaceId)), shallowEqual);
  const active = enabled && Boolean(client);
  const sessionQueries = useQueries({ subscribed: visible, queries: spaces.map((space) => ({
    queryKey: [`chats:bots:${space.id}:sessions`],
    queryFn: async (): Promise<SessionRecord[]> => (await client!.space(space.id).sessions.list({ limit: BOT_SESSION_LIMIT })).sessions,
    enabled: active,
    refetchInterval: POLL_MS,
  })) });
  const needsYouQueries = useQueries({ subscribed: visible, queries: spaces.map((space) => ({
    queryKey: [`chats:bots:${space.id}:needs-you`],
    queryFn: async (): Promise<SessionRecord[]> => {
      try {
        const sessions: SessionRecord[] = [];
        let cursor: string | null = null;
        do {
          const page = await client!.space(space.id).labels.listItems(NEEDS_YOU_LABEL, { limit: 100, cursor });
          sessions.push(...(page.sessions ?? []));
          cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
        } while (cursor);
        return sessions;
      } catch (error) {
        // The label exists only once a Bot first asks for the user.
        if (httpStatus(error) === 404) return [];
        throw error;
      }
    },
    enabled: active,
    refetchInterval: POLL_MS,
  })) });

  const loaded = new Map<string, SessionRecord[]>();
  const needsYou = new Map<string, SessionRecord[]>();
  spaces.forEach((space, index) => {
    const sessions = sessionQueries[index]?.data;
    if (sessions) loaded.set(space.id, sessions);
    needsYou.set(space.id, needsYouQueries[index]?.data ?? []);
  });
  const loadedKey = sessionQueries.map((query) => query.dataUpdatedAt).join(",");
  const needsYouKey = needsYouQueries.map((query) => query.dataUpdatedAt).join(",");
  const sessionsBySpace = useMemo(() => botSessionsBySpace(spaces.map((space) => space.id), cached, loaded),
    // `loaded` is rebuilt each render; its contents change only with the queries' update stamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, cached, loadedKey]);
  const allSessions = useMemo(() => [...sessionsBySpace.values()].flat(), [sessionsBySpace]);
  useEffect(() => {
    if (active && allSessions.length) void refreshSessionStatuses(allSessions, { silent: true });
  }, [active, allSessions, refreshSessionStatuses]);
  // A Bot runs when any of its Chats does, including ones past its first page: the account-wide Running scan covers those.
  useEffect(() => {
    if (!active || !visible) return;
    void requestRunningSessions("all");
    return () => releaseRunningSessions("all");
  }, [active, visible, requestRunningSessions, releaseRunningSessions]);
  const runningSpaceIds = useAppSelector(({ state }) => {
    const ids = new Set(spaces.map((space) => space.id));
    const candidates = [...allSessions, ...(state.runningSessions.all?.sessions ?? []).filter((session) => ids.has(session.spaceId))];
    return [...new Set(candidates.filter((session) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running").map((session) => session.spaceId))].sort();
  }, shallowEqual);

  const entries = useMemo(() => botEntries(spaces, sessionsBySpace, needsYou, new Set(runningSpaceIds)),
    // `needsYou` is rebuilt each render; its contents change only with the queries' update stamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, sessionsBySpace, needsYouKey, runningSpaceIds]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => needsYouItems(spaces, needsYou), [spaces, needsYouKey]);
  const runningError = useAppSelector(({ state }) => state.runningSessions.all?.error ?? null);
  const failed = [...sessionQueries, ...needsYouQueries].find((query) => query.error)?.error;
  return {
    entries,
    needsYou: waiting,
    loading: sessionQueries.some((query) => query.isPending && query.isFetching),
    error: failed ? failed.message : active ? runningError : null,
    refetch: () => Promise.all([requestRunningSessions("all"), ...[...sessionQueries, ...needsYouQueries].map((query) => query.refetch())]).then(() => undefined),
  };
}
