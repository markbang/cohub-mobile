import { HttpError, normalizeAppDomainHostname, type AppDomainListResponse, type AppDomainRecord, type CohubClient } from "@neta-art/cohub";
import { useCallback, useEffect, useRef, useState } from "react";
import { withAppDomainResult } from "./app-domains";
import { useApp } from "./context";
import { useSpaceRealtime } from "./use-space-realtime";
import { useSyncScope } from "./use-sync-scope";

export type AppDomainAction = "add" | "check" | "remove";
export type AppDomainProblem = { code: string | null; message: string | null };
type MutationResult = { domain: AppDomainRecord } | { removedId: string };

const toProblem = (error: unknown): AppDomainProblem => ({
  code: error instanceof HttpError ? error.code : null,
  message: error instanceof Error ? error.message : null,
});

const SETTLING = new Set<AppDomainRecord["status"]>(["pending", "provisioning", "removing"]);

export function useAppDomains(appId: string, spaceId: string | undefined) {
  const { client, sync } = useApp();
  const key = `app:${appId}:domains`;
  const [list, setList] = useState<AppDomainListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<AppDomainAction | null>(null);
  const [problem, setProblem] = useState<AppDomainProblem | null>(null);
  // Bumped by each mutation, so a list read that started before it cannot restore the old binding.
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [appId, client]);
  useSpaceRealtime(spaceId ? [spaceId] : []);

  const load = useCallback(async () => {
    if (!client) return;
    const request = generation.current;
    try {
      const next = await client.apps.listDomains(appId);
      if (request !== generation.current) return;
      setList(next);
      setLoadError(null);
    } catch (error) {
      if (request === generation.current) setLoadError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [appId, client]);
  const settling = list?.domains.some((domain) => SETTLING.has(domain.status)) ?? false;
  useSyncScope(key, load, settling ? 15_000 : 60_000);

  const run = async (action: AppDomainAction, request: (client: CohubClient) => Promise<MutationResult>) => {
    if (!client || busy) return false;
    setBusy(action);
    setProblem(null);
    try {
      const result = await request(client);
      generation.current += 1;
      setList((current) => current && withAppDomainResult(current, result));
      sync.invalidate(key);
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
    reload: () => sync.invalidate(key),
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
