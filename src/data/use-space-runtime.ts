import type { SpaceRuntimeStatus } from "@/src/data/runtime";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "./query";

/** A Bot's page always runs in the cloud, so it skips the runtime read. */
export function useSpaceRuntime(spaceId: string, enabled = true) {
  const { client } = useAppActions();
  const query = useScreenQuery({
    queryKey: [`space:${spaceId}:runtime`],
    queryFn: (): Promise<SpaceRuntimeStatus> => client!.space(spaceId).getRuntime(),
    enabled: Boolean(client && spaceId) && enabled,
    retry: 0,
  });
  return {
    status: query.isError ? null : query.data ?? null,
    loading: query.isFetching,
    error: query.error ? query.error.message || "Unable to check the local runtime." : null,
    refresh: async () => { await query.refetch(); },
  };
}
