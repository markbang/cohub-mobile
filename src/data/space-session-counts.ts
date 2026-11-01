import type { CohubClient } from "@neta-art/cohub";
import { useQueries, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

/** Page size shared by the Space page preview and the list count probe. */
export const SPACE_SESSION_COUNT_PAGE_SIZE = 20;
const COUNT_TTL_MS = 5 * 60_000;
const COUNT_CONCURRENCY = 4;

export type SpaceSessionCount = {
  count: number;
  hasMore: boolean;
};

export type SpaceSessionCounts = Record<string, SpaceSessionCount>;

export const spaceSessionCountKey = (spaceId: string) => [`space:${spaceId}:chats`, "count"];

/** Runs at most `limit` tasks at once, in arrival order. */
export function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

// Probes fan out per visible Space, so they share one budget across screens.
const probeLimit = createLimiter(COUNT_CONCURRENCY);

/** The Space page already reads this page of Chats; it seeds the count instead of a second probe. */
export function publishSpaceSessionCount(queryClient: QueryClient, spaceId: string, count: number, hasMore: boolean) {
  queryClient.setQueryData<SpaceSessionCount>(spaceSessionCountKey(spaceId), { count, hasMore });
}

/** Space counts for the given ids; with `probe: false` only already-known counts are returned. */
export function useSpaceSessionCounts(client: CohubClient | null, spaceIds: readonly string[], options: { probe?: boolean } = {}) {
  const probe = options.probe ?? true;
  const ids = useMemo(() => [...new Set(spaceIds)].filter(Boolean).sort(), [spaceIds]);
  // A stable combiner lets the query observer keep the same counts object until a count changes.
  const combine = useCallback((results: { data?: SpaceSessionCount }[]) => {
    const counts: SpaceSessionCounts = {};
    results.forEach((result, index) => { if (result.data) counts[ids[index]!] = result.data; });
    return counts;
  }, [ids]);
  return useQueries({
    queries: ids.map((spaceId) => ({
      queryKey: spaceSessionCountKey(spaceId),
      queryFn: () => probeLimit(async (): Promise<SpaceSessionCount> => {
        const response = await client!.space(spaceId).sessions.list({ limit: SPACE_SESSION_COUNT_PAGE_SIZE });
        return { count: response.sessions.length, hasMore: Boolean(response.pageInfo?.hasMore) };
      }),
      enabled: probe && Boolean(client),
      staleTime: COUNT_TTL_MS,
      retry: 0,
    })),
    combine,
  });
}
