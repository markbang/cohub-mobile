import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "@/src/config";
import { fetchTrending, type TrendingBoard, type TrendingDimension, type TrendingEntry } from "./trending";

type BoardState = { entries: TrendingEntry[] | null; error: string | null };

/** Public leaderboards: kept in memory per board for quick switching, never persisted. */
export function useTrending(board: TrendingBoard, dimension: TrendingDimension) {
  const key = `${board}:${dimension}`;
  const [boards, setBoards] = useState<Record<string, BoardState>>({});
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Resolves null when superseded, so a late response never lands on another board.
  const request = useCallback(async (): Promise<BoardState | null> => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const entries = await fetchTrending(config.apiOrigin, board, dimension, current.signal);
      return current.signal.aborted ? null : { entries, error: null };
    } catch (caught) {
      if (current.signal.aborted) return null;
      return { entries: null, error: caught instanceof Error ? caught.message : "Unable to load trending. Pull to refresh to retry." };
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }, [board, dimension]);
  const apply = useCallback((result: BoardState | null) => {
    if (!result) return;
    setBoards((previous) => ({ ...previous, [key]: { entries: result.entries ?? previous[key]?.entries ?? null, error: result.error } }));
  }, [key]);
  const refresh = useCallback(async () => {
    setRefreshingKey(key);
    try {
      apply(await request());
    } finally {
      setRefreshingKey((previous) => previous === key ? null : previous);
    }
  }, [apply, key, request]);
  const state = boards[key];
  const loaded = state !== undefined;
  useEffect(() => {
    if (!loaded) void request().then(apply);
  }, [apply, loaded, request]);
  useEffect(() => () => controller.current?.abort(), []);
  return { entries: state?.entries ?? null, error: state?.error ?? null, loading: !loaded || refreshingKey === key, refresh };
}
