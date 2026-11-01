import type { CohubClient, PaletteOverviewResponse } from "@neta-art/cohub";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { loadSpaceListCache, loadSpaceVisits, saveSpaceListCache, saveSpaceVisit } from "./local-db";
import { useScreenQuery } from "./query";
import { recentSpaceVisits, type SpaceVisit } from "./space-list";

export const SPACE_OVERVIEW_KEY = ["spaces-overview"] as const;

type VisitStore = StoreApi<{ spaceVisits: SpaceVisit[]; spaceVisitsError: string | null }>;

/** Provider side: hydrates persisted visits and the cached overview, and owns visit writes. */
export function useSpaceListOwner(client: CohubClient | null, userKey: string, store: VisitStore, queryClient: QueryClient) {
  const generation = useRef(0);
  const hydration = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => {
    const token = ++generation.current;
    hydration.current = Promise.all([loadSpaceListCache(userKey), loadSpaceVisits(userKey)]).then(([cached, stored]) => {
      if (generation.current !== token) return;
      // Cached rows paint first but stay stale, so the first observer still refetches.
      if (cached && queryClient.getQueryData(SPACE_OVERVIEW_KEY) === undefined) queryClient.setQueryData(SPACE_OVERVIEW_KEY, cached, { updatedAt: 0 });
      store.setState((current) => ({ spaceVisits: recentSpaceVisits([...stored, ...current.spaceVisits], Date.now()) }));
    }).catch(() => {
      if (generation.current === token) store.setState({ spaceVisitsError: "Could not load recent Spaces. Pull to refresh to retry." });
    });
    return () => { generation.current += 1; };
  }, [queryClient, store, userKey]);

  const loadOverview = useCallback(async (): Promise<PaletteOverviewResponse> => {
    if (!client) throw new Error("Still connecting. Try again in a moment.");
    await hydration.current;
    try {
      const data = await client.search.overview({ spaceLimit: 50, recentSpaceIds: recentSpaceVisits(store.getState().spaceVisits, Date.now()).map((visit) => visit.spaceId) });
      await saveSpaceListCache(userKey, data);
      return data;
    } catch {
      throw new Error("Could not refresh recent Spaces. Check your connection and retry.");
    }
  }, [client, store, userKey]);

  const recordVisit = useCallback((spaceId: string): void => {
    if (!spaceId.trim()) throw new Error("Cannot record a Space visit without a Space ID.");
    const timestamp = Date.now();
    store.setState((current) => ({ spaceVisits: recentSpaceVisits([{ spaceId, timestamp }, ...current.spaceVisits], timestamp) }));
    void saveSpaceVisit(userKey, spaceId, timestamp).catch(() => store.setState({ spaceVisitsError: "Could not save your recent Space visit. Try opening the Space again." }));
  }, [store, userKey]);

  const reset = useCallback(() => {
    generation.current += 1;
    store.setState({ spaceVisits: [], spaceVisitsError: null });
  }, [store]);

  return { loadOverview, recordVisit, reset };
}

/** Consumer side: recent visits plus the server overview, refreshed while the caller is mounted. */
export function useSpaceList(loadOverview: () => Promise<PaletteOverviewResponse>, visits: SpaceVisit[], visitsError: string | null, enabled: boolean, intervalMs?: number) {
  const queryClient = useQueryClient();
  const query = useScreenQuery({ queryKey: SPACE_OVERVIEW_KEY, queryFn: loadOverview, enabled, intervalMs });
  // Errors surface through the query state, so callers can await a refresh without handling them.
  const refresh = useCallback(() => queryClient.fetchQuery({ queryKey: SPACE_OVERVIEW_KEY, queryFn: loadOverview, staleTime: 0 }).then(() => undefined, () => undefined), [loadOverview, queryClient]);
  const overview = query.data ?? null;
  const error = query.error?.message ?? visitsError;
  return useMemo(() => ({ overview, visits, loading: query.isFetching, error, refresh, updatedAt: query.dataUpdatedAt }), [overview, visits, query.isFetching, error, refresh, query.dataUpdatedAt]);
}
