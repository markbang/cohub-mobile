import type { SpaceRuntimeStatus } from "@/src/data/runtime";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "./query";

export function useSpaceRuntime(spaceId: string) {
  const { client } = useAppActions();
  const query = useScreenQuery({
    queryKey: [`space:${spaceId}:runtime`],
    queryFn: (): Promise<SpaceRuntimeStatus> => client!.space(spaceId).getRuntime(),
    enabled: Boolean(client && spaceId),
    retry: 0,
  });
  return {
    status: query.isError ? null : query.data ?? null,
    loading: query.isFetching,
    error: query.error ? query.error.message || "Unable to check the local runtime." : null,
    refresh: async () => { await query.refetch(); },
  };
}
