import type { CohubClient, SpaceFsEntry } from "@neta-art/cohub";
import { useScreenQuery } from "./query";

const NO_ENTRIES: SpaceFsEntry[] = [];

/** One cached listing per directory, shared by the Files screen and the Space panel; `space.fs.changed` invalidates it. */
export function useSpaceDirectory(client: CohubClient | null, spaceId: string, path: string, enabled = true) {
  const query = useScreenQuery({
    queryKey: [`space:${spaceId}:files:${path}`],
    queryFn: async (): Promise<SpaceFsEntry[]> => (await client!.space(spaceId).files.list(path || undefined)).entries,
    enabled: enabled && Boolean(client && spaceId),
    intervalMs: 30_000,
  });
  return {
    entries: query.data ?? NO_ENTRIES,
    loading: enabled && Boolean(client && spaceId) && query.isPending,
    fetching: query.isFetching,
    error: query.error,
    refetch: async () => { await query.refetch(); },
  };
}
