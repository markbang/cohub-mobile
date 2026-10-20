import { isLocalHarness, LOCAL_HARNESSES, type HarnessKind, type RuntimeStatus } from "@neta-art/cohub";
import type { ChatModelSelection } from "@/src/data/types";

export type RuntimeHarness = HarnessKind;
export type LocalRuntimeModel = ChatModelSelection & { name: string };
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
    .map((model) => ({ provider: model.provider, id: model.id, name: model.name }));
}

export function runtimeHarnessFromTurn(turn: { meta?: Record<string, unknown> | null; harness?: string | null } | null | undefined): RuntimeHarness {
  const harness = turn?.meta?.harness ?? turn?.harness;
  return isLocalHarness(harness) ? harness : "cohub";
}
