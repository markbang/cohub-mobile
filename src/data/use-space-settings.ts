import type { CohubClient, CronJobRecord, SandboxSpecId, SpaceMember, SpaceModListItem, SpaceRole, SpaceSandboxConfig, SpaceSandboxRecord, SpaceWalletSummary, WorkspaceUsage } from "@neta-art/cohub";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, type SetStateAction } from "react";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";

export type SpaceEnvironmentItem = { name: string; value: string };
type InvitationItem = { token: string; role: SpaceRole; status: string };
export type SpaceSettingsResourceState = { loading: boolean; loaded: boolean; error: string | null };
type Ports = Record<string, { url?: string; port?: number }>;
type ResourceKey = "env" | "config" | "sandbox" | "usage" | "wallet" | "ports" | "allowedSpec" | "members" | "invitations" | "mods" | "schedules";

const NO_ENV: SpaceEnvironmentItem[] = [];
const NO_PORTS: Ports = {};
const NO_MEMBERS: SpaceMember[] = [];
const NO_INVITATIONS: InvitationItem[] = [];
const NO_MODS: SpaceModListItem[] = [];
const NO_SCHEDULES: CronJobRecord[] = [];

/** Shared keys: the setup screen reads the same sandbox, and the wallet hook the same summary. */
export const spaceSettingsKey = (spaceId: string, key: ResourceKey) => ({
  sandbox: [`space:${spaceId}:sandbox-setup`],
  wallet: [`space:${spaceId}:wallet`, "summary"],
  schedules: [`space:${spaceId}:schedules`],
} as Partial<Record<ResourceKey, unknown[]>>)[key] ?? [`space:${spaceId}:settings:${key}`];

export function useSpaceSettings(client: CohubClient | null, spaceId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const enabled = Boolean(client && spaceId);
  const space = client && spaceId ? client.space(spaceId) : null;
  // Independent sections settle on their own; a failed port or permission read cannot hide the rest.
  const queries = {
    env: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "env"), queryFn: async () => (await space!.env.list()).env as SpaceEnvironmentItem[], enabled }),
    config: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "config"), queryFn: async (): Promise<SpaceSandboxConfig | null> => (await space!.getConfig()).config.sandbox, enabled }),
    sandbox: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "sandbox"), queryFn: async (): Promise<SpaceSandboxRecord | null> => (await space!.sandbox.get()).sandbox, enabled }),
    // Only Space details carry the workspace measurement; local Runtimes have none.
    usage: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "usage"), queryFn: async (): Promise<WorkspaceUsage | null> => (await client!.spaces.get(spaceId)).workspaceUsage ?? null, enabled }),
    wallet: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "wallet"), queryFn: (): Promise<SpaceWalletSummary> => space!.wallet.get(), enabled }),
    ports: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "ports"), queryFn: async (): Promise<Ports> => (await space!.sandbox.ports()).endpoints, enabled }),
    allowedSpec: useScreenQuery({
      queryKey: spaceSettingsKey(spaceId, "allowedSpec"),
      queryFn: async (): Promise<SandboxSpecId> => {
        const [boost, ultra] = await Promise.all([client!.billing.getFeatureEntitlement("sandbox.spec.boost"), client!.billing.getFeatureEntitlement("sandbox.spec.ultra")]);
        return ultra.enabled ? "ultra" : boost.enabled ? "boost" : "standard";
      },
      enabled,
    }),
    members: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "members"), queryFn: async (): Promise<SpaceMember[]> => (await space!.members.list()).items, enabled }),
    invitations: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "invitations"), queryFn: async (): Promise<InvitationItem[]> => (await space!.invitations.list()).items, enabled }),
    mods: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "mods"), queryFn: async (): Promise<SpaceModListItem[]> => (await space!.mods.list()).items, enabled }),
    schedules: useScreenQuery({ queryKey: spaceSettingsKey(spaceId, "schedules"), queryFn: async (): Promise<CronJobRecord[]> => (await client!.cronJobs.list(spaceId)).jobs, enabled }),
  } satisfies Record<ResourceKey, UseQueryResult<unknown, Error>>;

  const unavailable = enabled ? null : t(spaceId ? "data.stillConnecting" : "space.unavailable");
  const state = (query: UseQueryResult<unknown, Error>): SpaceSettingsResourceState => ({
    loading: enabled && query.isFetching,
    loaded: query.data !== undefined,
    // A retry in flight clears the previous failure, so the section shows progress instead.
    error: unavailable ?? (query.error && !query.isFetching ? query.error.message || t("space.settings.loadFailed") : null),
  });
  const resources = Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, state(query)])) as Record<ResourceKey, SpaceSettingsResourceState>;

  const loadResource = useCallback(async (key: ResourceKey): Promise<void> => {
    await queryClient.refetchQueries({ queryKey: spaceSettingsKey(spaceId, key), exact: true, type: "all" });
  }, [queryClient, spaceId]);

  const setters = useMemo(() => {
    function setter<T>(key: ResourceKey, fallback: T) {
      return (next: SetStateAction<T>) => queryClient.setQueryData<T>(spaceSettingsKey(spaceId, key), (current) => typeof next === "function" ? (next as (value: T) => T)(current ?? fallback) : next);
    }
    return {
      setEnv: setter("env", NO_ENV),
      setConfig: setter<SpaceSandboxConfig | null>("config", null),
      setMembers: setter("members", NO_MEMBERS),
      setInvitations: setter("invitations", NO_INVITATIONS),
      setMods: setter("mods", NO_MODS),
      setSchedules: setter("schedules", NO_SCHEDULES),
    };
  }, [queryClient, spaceId]);

  return {
    env: queries.env.data ?? NO_ENV,
    config: queries.config.data ?? null,
    sandbox: queries.sandbox.data ?? null,
    usage: queries.usage.data ?? null,
    wallet: queries.wallet.data ?? null,
    ports: queries.ports.data ?? NO_PORTS,
    allowedSpec: queries.allowedSpec.data ?? "standard",
    members: queries.members.data ?? NO_MEMBERS,
    invitations: queries.invitations.data ?? NO_INVITATIONS,
    mods: queries.mods.data ?? NO_MODS,
    schedules: queries.schedules.data ?? NO_SCHEDULES,
    ...setters,
    resources,
    loadResource,
  };
}
