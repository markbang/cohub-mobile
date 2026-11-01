import { focusManager, QueryClient, useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { AppState } from "react-native";

// Foregrounding the app counts as window focus, so stale queries refetch and polling pauses in the background.
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"));
  return () => subscription.remove();
});

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
 * Query keys start with the realtime scope string (e.g. `space:<id>:labels`), so realtime
 * invalidations and screen queries share one vocabulary. Event bursts are collapsed into one
 * invalidation per window, so a stream of events never restarts the same read repeatedly.
 */
export function createScopeInvalidator(client: QueryClient, windowMs = 250) {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    invalidateScopes(client, { exact: [...exact], prefixes: [...prefixes] });
    exact.clear();
    prefixes.clear();
  };
  return {
    add(change: { exact: readonly string[]; prefixes: readonly string[] }) {
      for (const key of change.exact) exact.add(key);
      for (const prefix of change.prefixes) prefixes.add(prefix);
      if (timer === null && (exact.size > 0 || prefixes.size > 0)) timer = setTimeout(flush, windowMs);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export function invalidateScopes(client: QueryClient, change: { exact: readonly string[]; prefixes: readonly string[] }) {
  void client.invalidateQueries({
    predicate: (query) => {
      const scope = query.queryKey[0];
      return typeof scope === "string" && (change.exact.includes(scope) || change.prefixes.some((prefix) => scope.startsWith(prefix)));
    },
  });
}

/**
 * A screen query that polls and reacts to invalidation only while its route is focused.
 * Access failures stop polling until an explicit invalidation or refetch.
 */
export function useScreenQuery<TData, TKey extends QueryKey = QueryKey>(options: UseQueryOptions<TData, Error, TData, TKey> & { intervalMs?: number }) {
  const focused = useIsFocused();
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
