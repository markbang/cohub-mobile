import { HttpError, normalizeAppDomainHostname, type AppDomainListResponse, type AppDomainRecord, type CohubClient } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { withAppDomainResult } from "./app-domains";
import { useAppActions } from "./context";
import { useScreenQuery } from "./query";
import { useSpaceRealtime } from "./use-space-realtime";

export type AppDomainAction = "add" | "check" | "remove";
export type AppDomainProblem = { code: string | null; message: string | null };
type MutationResult = { domain: AppDomainRecord } | { removedId: string };

const toProblem = (error: unknown): AppDomainProblem => ({
  code: error instanceof HttpError ? error.code : null,
  message: error instanceof Error ? error.message : null,
});

const SETTLING = new Set<AppDomainRecord["status"]>(["pending", "provisioning", "removing"]);

export function useAppDomains(appId: string, spaceId: string | undefined) {
  const { client } = useAppActions();
  const queryClient = useQueryClient();
  const queryKey = [`app:${appId}:domains`];
  const [busy, setBusy] = useState<AppDomainAction | null>(null);
  const [problem, setProblem] = useState<AppDomainProblem | null>(null);
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const listQuery = useScreenQuery({
    queryKey,
    queryFn: (): Promise<AppDomainListResponse> => client!.apps.listDomains(appId),
    enabled: Boolean(client),
    refetchInterval: (query) => query.state.data?.domains.some((domain) => SETTLING.has(domain.status)) ? 15_000 : 60_000,
  });
  const list = listQuery.data ?? null;
  const loadError = listQuery.error?.message ?? null;

  const run = async (action: AppDomainAction, request: (client: CohubClient) => Promise<MutationResult>) => {
    if (!client || busy) return false;
    setBusy(action);
    setProblem(null);
    try {
      const result = await request(client);
      // A list read that started before the mutation must not restore the old binding.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<AppDomainListResponse>(queryKey, (current) => current && withAppDomainResult(current, result));
      void queryClient.invalidateQueries({ queryKey });
      return true;
    } catch (error) {
      setProblem(toProblem(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return {
    list,
    loadError,
    busy,
    problem,
    reload: () => void queryClient.invalidateQueries({ queryKey }),
    add: (input: string) => {
      const hostname = normalizeAppDomainHostname(input);
      if (!hostname) {
        setProblem({ code: "domain_invalid", message: null });
        return Promise.resolve(false);
      }
      return run("add", (api) => api.apps.addDomain(appId, hostname));
    },
    check: (domainId: string) => run("check", (api) => api.apps.checkDomain(appId, domainId)),
    remove: (domainId: string) => run("remove", async (api) => {
      const result = await api.apps.removeDomain(appId, domainId);
      return result.domain ? { domain: result.domain } : { removedId: domainId };
    }),
  };
}
