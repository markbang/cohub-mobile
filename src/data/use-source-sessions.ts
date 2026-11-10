import type { CohubClient, UserSessionListItem } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { translate } from "@/src/i18n/core";
import { sessionPageState, type SessionPageBoundary } from "@/src/data/session-status";
import { sessionSourceFilterKeys, type SessionSourceFilter } from "@/src/data/session-source";
import { mergeSessionPages, reconcileSessionHead } from "./session-list-sync";
import { useScreenQuery } from "./query";
import { sortByRecent } from "@/src/utils";

const PAGE_SIZE = 60;
const REQUEST_TIMEOUT_MS = 15_000;
const EMPTY = { sessions: [] as UserSessionListItem[], loading: false, loadingMore: false, error: null as string | null, hasMore: false, initialized: false };

function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(translate("data.timeout", { label: translate("tabs.chats"), seconds: 15 }))), REQUEST_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 401) return translate("data.signInRejected");
    if (status === 403) return translate("data.noAccess");
  }
  return error instanceof Error && error.message.trim() ? error.message : translate("data.chatsLoadFailed");
}

type SourcePages = { sessions: UserSessionListItem[]; cursor: string | null; boundary: SessionPageBoundary | null; hasMore: boolean; pagesLoaded: number };

/** Every source, or only the Chats archived in their Space. */
export type ChatsListFilter = SessionSourceFilter | "archived";

/**
 * Server-filtered global Chats list for a source filter or the archive. The shared home list stays
 * unfiltered for cache hydration and cross-screen lookups, so this keeps its own
 * pages and cursor. `all` resolves to the empty state; callers use the home list.
 */
export function useSourceSessions(client: CohubClient | null, filter: ChatsListFilter) {
  const scope = useMemo(() => filter === "archived" ? { archived: "only" as const } : { source: sessionSourceFilterKeys(filter) ?? undefined }, [filter]);
  const enabled = filter !== "all" && Boolean(client);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [`chats:source:${filter}`], [filter]);
  const query = useScreenQuery({
    queryKey,
    queryFn: async (): Promise<SourcePages> => {
      const requestStartedAt = Date.now();
      const response = await withTimeout(client!.user.listSessions({ limit: PAGE_SIZE, ...scope }));
      const loaded = queryClient.getQueryData<SourcePages>(queryKey);
      const page = sessionPageState(response, null, loaded?.boundary ?? null);
      if (!loaded) return { sessions: response.sessions ?? [], cursor: page.cursor, boundary: page.boundary, hasMore: page.hasMore, pagesLoaded: 1 };
      // A head refresh reconciles into loaded pages; their tail cursor survives while the head still has more.
      const sessions = sortByRecent(reconcileSessionHead(loaded.sessions, response.sessions, page.hasMore, requestStartedAt));
      return loaded.pagesLoaded > 1 && page.hasMore
        ? { ...loaded, sessions }
        : { sessions, cursor: page.cursor, boundary: page.boundary, hasMore: page.hasMore, pagesLoaded: 1 };
    },
    enabled,
    intervalMs: 15_000,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(() => {
    const start = queryClient.getQueryData<SourcePages>(queryKey);
    if (!enabled || loadingMoreRef.current || !start?.hasMore || !start.cursor) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    void withTimeout(client!.user.listSessions({ limit: PAGE_SIZE, cursor: start.cursor, ...scope })).then((response) => {
      queryClient.setQueryData<SourcePages>(queryKey, (current) => {
        if (!current || current.cursor !== start.cursor) return current;
        const page = sessionPageState(response, start.cursor, current.boundary);
        return { sessions: sortByRecent(mergeSessionPages(current.sessions, response.sessions ?? [])), cursor: page.cursor, boundary: page.boundary, hasMore: page.hasMore, pagesLoaded: current.pagesLoaded + 1 };
      });
    }).catch(setLoadMoreError).finally(() => {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    });
  }, [client, enabled, scope, queryClient, queryKey]);

  const refetch = query.refetch;
  const reload = useCallback(() => { setLoadMoreError(null); void refetch(); }, [refetch]);
  const failure = loadMoreError ?? query.error;

  if (!enabled) return { ...EMPTY, loadMore, reload };
  return {
    sessions: query.data?.sessions ?? EMPTY.sessions,
    loading: query.isPending && query.isFetching,
    loadingMore,
    error: failure ? errorMessage(failure) : null,
    hasMore: query.data?.hasMore ?? false,
    initialized: query.data !== undefined || query.isError,
    loadMore,
    reload,
  };
}
