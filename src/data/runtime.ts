import { isAgentTurn, isApprovalMode, isLocalHarness, isModelThinkingLevel, LOCAL_HARNESSES, STANDARD_SERVICE_TIER, type ApprovalMode, type HarnessKind, type RuntimeCapabilities, type RuntimeStatus, type SessionTurnRecord } from "@neta-art/cohub";
import type { ChatModelSelection } from "./types";

export type RuntimeHarness = HarnessKind;
export type LocalRuntimeModel = Omit<RuntimeCapabilities["models"][number], "harness" | "isDefault">;
export type SpaceRuntimeStatus = RuntimeStatus;

export function canUseRuntimeHarness(status: SpaceRuntimeStatus | null, harness: RuntimeHarness): boolean {
  return harness === "cohub" || Boolean(status?.kind === "local" && status.online && status.capabilities?.harnesses.includes(harness));
}

export type HarnessAvailability = "ready" | "offline" | "missing";
export type HarnessOption = { harness: RuntimeHarness; availability: HarnessAvailability };

/** Mirrors web: every local Harness is listed so an offline Runtime or an uninstalled CLI reads as a state, not an absence. */
export function harnessOptions(status: SpaceRuntimeStatus | null): HarnessOption[] {
  const online = status?.kind === "local" && status.online;
  const local = LOCAL_HARNESSES.map((harness): HarnessOption => ({
    harness,
    availability: !online ? "offline" : canUseRuntimeHarness(status, harness) ? "ready" : "missing",
  }));
  return [
    { harness: "cohub", availability: "ready" },
    ...local.filter((option) => option.availability === "ready"),
    ...local.filter((option) => option.availability !== "ready"),
  ];
}

export function localModelsForHarness(status: SpaceRuntimeStatus | null, harness: RuntimeHarness): LocalRuntimeModel[] {
  if (!status?.online || harness === "cohub") return [];
  return (status.capabilities?.models ?? [])
    .filter((model) => model.harness === harness)
    .map(({ provider, id, name, reasoning, defaultThinkingLevel, thinkingLevelMap }) => ({ provider, id, name, reasoning, defaultThinkingLevel, thinkingLevelMap }));
}

export function runtimeHarnessFromTurn(turn: { meta?: Record<string, unknown> | null; harness?: string | null } | null | undefined): RuntimeHarness {
  const harness = turn?.meta?.harness ?? turn?.harness;
  return isLocalHarness(harness) ? harness : "cohub";
}

/** Approval modes the Runtime enforces for a Harness; none for Cohub or an offline Runtime. */
export function approvalModesFor(status: SpaceRuntimeStatus | null, harness: RuntimeHarness): ApprovalMode[] {
  if (harness === "cohub" || status?.kind !== "local" || !status.online) return [];
  return status.capabilities?.approvalModes?.[harness] ?? [];
}

/** The last approval mode a Turn sent for this Harness; a Turn without one left the thread's settings as they were. */
export function approvalModeFromTurns(turns: readonly { executionKind?: SessionTurnRecord["executionKind"]; meta?: Record<string, unknown> | null; harness?: string | null }[], harness: RuntimeHarness): ApprovalMode | null {
  const mode = turns.findLast((turn) => isAgentTurn(turn) && runtimeHarnessFromTurn(turn) === harness && isApprovalMode(turn.meta?.approvalMode))?.meta?.approvalMode;
  return isApprovalMode(mode) ? mode : null;
}

/**
 * The model the last Turn of this Harness asked for, as on web. Once a local Turn settles, `turn.model` is the
 * id the Harness reports for the model that answered, which need not be a Runtime catalog id; the request in
 * `meta` is. A request without a model left the choice to the Harness default.
 */
export function requestedRuntimeModel(turns: readonly { executionKind?: SessionTurnRecord["executionKind"]; meta?: Record<string, unknown> | null; harness?: string | null }[], harness: RuntimeHarness): ChatModelSelection | null {
  const meta = turns.findLast((turn) => isAgentTurn(turn) && runtimeHarnessFromTurn(turn) === harness)?.meta;
  if (typeof meta?.model !== "string" || typeof meta.provider !== "string") return null;
  const level = meta.requestedThinkingLevel;
  return { provider: meta.provider, id: meta.model, ...(typeof level === "string" && isModelThinkingLevel(level) ? { thinkingLevel: level } : {}) };
}

/** The tier the Fast switch selects (Codex `priority`); models without it show no switch. */
export const FAST_SERVICE_TIER = "priority";

/** The model a local Turn runs: the chosen one, or the Harness default when none is chosen. */
export function runtimeModelFor(status: SpaceRuntimeStatus | null, harness: RuntimeHarness, id: string | null | undefined): RuntimeCapabilities["models"][number] | null {
  if (harness === "cohub" || !status?.online) return null;
  const models = (status.capabilities?.models ?? []).filter((model) => model.harness === harness);
  return (id ? models.find((model) => model.id === id) : models.find((model) => model.isDefault)) ?? null;
}

export function supportsFast(model: RuntimeCapabilities["models"][number] | null): boolean {
  return Boolean(model?.serviceTiers?.some((tier) => tier.id === FAST_SERVICE_TIER));
}

/** Off only needs saying where Fast is the model's default. */
export function fastServiceTier(model: RuntimeCapabilities["models"][number] | null, fast: boolean): string | undefined {
  if (fast) return FAST_SERVICE_TIER;
  return model?.defaultServiceTier === FAST_SERVICE_TIER ? STANDARD_SERVICE_TIER : undefined;
}
