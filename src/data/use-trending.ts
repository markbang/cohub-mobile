import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { config } from "@/src/config";
import { fetchTrending, type TrendingBoard, type TrendingDimension, type TrendingEntry } from "./trending";

/** Public leaderboards: cached in memory per board for quick switching, never persisted. */
export function useTrending(board: TrendingBoard, dimension: TrendingDimension) {
  const query = useQuery({
    queryKey: ["trending", board, dimension],
    queryFn: ({ signal }): Promise<TrendingEntry[]> => fetchTrending(config.apiOrigin, board, dimension, signal),
    staleTime: 5 * 60_000,
  });
  const refetch = query.refetch;
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  const error = query.error ? query.error.message || "Unable to load trending. Pull to refresh to retry." : null;
  return { entries: query.data ?? null, error, loading: query.isFetching, refresh };
}
