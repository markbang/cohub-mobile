import type { QueryClient } from "@tanstack/react-query";

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
