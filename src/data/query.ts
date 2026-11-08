import { focusManager, QueryClient, useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useScreenVisible } from "@/src/ui/pane";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { subscribeAppActive } from "@/src/platform/app-lifecycle";

export { createScopeInvalidator, invalidateScopes } from "./query-scopes";

// Foregrounding the app counts as window focus, so stale queries refetch and polling pauses in the background.
// A picker or share sheet the app opened is not a background trip.
focusManager.setEventListener((setFocused) => subscribeAppActive(setFocused));

function isAccessDenied(error: unknown) {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const status = typeof cause === "object" && cause !== null && "status" in cause ? cause.status : null;
  return status === 401 || status === 403;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        gcTime: 10 * 60_000,
        // Permission failures need an explicit invalidation (e.g. access change), not a retry.
        retry: (failures, error) => failures < 1 && !isAccessDenied(error),
        refetchIntervalInBackground: false,
      },
      mutations: { retry: 0 },
    },
  });
}

/**
 * A screen query that polls and reacts to invalidation only while its route is visible (focused, or
 * on view in the left pane of a split window).
 * Access failures stop polling until an explicit invalidation or refetch.
 */
export function useScreenQuery<TData, TKey extends QueryKey = QueryKey>(options: UseQueryOptions<TData, Error, TData, TKey> & { intervalMs?: number }) {
  const focused = useScreenVisible();
  const { intervalMs, ...rest } = options;
  const interval = intervalMs ?? rest.refetchInterval;
  return useQuery({
    ...rest,
    subscribed: focused && (rest.subscribed ?? true),
    refetchInterval: interval === undefined ? undefined : (query) => {
      if (isAccessDenied(query.state.error)) return false;
      return typeof interval === "function" ? interval(query) : interval;
    },
  });
}

/**
 * Schedules a read whose result the app reducer owns. Refetches when invalidated or stale on
 * focus, polls at `intervalMs` while the route is focused, and keeps only a completion stamp.
 */
export function useSyncQuery(key: string, run: () => Promise<unknown>, intervalMs: number, enabled = true) {
  useScreenQuery({
    queryKey: [key],
    queryFn: async () => { await run(); return Date.now(); },
    enabled,
    staleTime: intervalMs,
    intervalMs,
    notifyOnChangeProps: [],
  });
}

export type Page<T> = { items: T[]; cursor: string | null };

/**
 * A cursor-paged list held as one cache entry. Refreshes read only the first page and hand it to
 * `mergeHead` (default: replace), so polling never re-walks every loaded page. `loadMore` appends
 * the next page unless a refresh replaced the cursor it started from.
 */
export function usePagedQuery<T>(options: {
  queryKey: QueryKey;
  enabled: boolean;
  intervalMs?: number | ((loaded: Page<T> | undefined) => number);
  fetchPage: (cursor: string | null) => Promise<Page<T>>;
  id: (item: T) => string;
  mergeHead?: (loaded: Page<T>, head: Page<T>) => Page<T>;
}) {
  const queryClient = useQueryClient();
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const interval = options.intervalMs;
  const query = useScreenQuery<Page<T>>({
    queryKey: options.queryKey,
    queryFn: async () => {
      const { fetchPage, mergeHead, queryKey } = latest.current;
      const head = await fetchPage(null);
      const loaded = queryClient.getQueryData<Page<T>>(queryKey);
      return loaded && mergeHead ? mergeHead(loaded, head) : head;
    },
    enabled: options.enabled,
    refetchInterval: typeof interval === "function" ? (query) => interval(query.state.data) : interval,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async (): Promise<void> => {
    const { fetchPage, id, queryKey } = latest.current;
    const start = queryClient.getQueryData<Page<T>>(queryKey);
    if (!start?.cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchPage(start.cursor);
      queryClient.setQueryData<Page<T>>(queryKey, (current) => {
        if (!current || current.cursor !== start.cursor) return current;
        const known = new Set(current.items.map(id));
        return { items: [...current.items, ...page.items.filter((item) => !known.has(id(item)))], cursor: page.cursor };
      });
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [queryClient]);
  return { query, items: query.data?.items ?? null, hasMore: Boolean(query.data?.cursor), loadingMore, loadMoreError, loadMore };
}
