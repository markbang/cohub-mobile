import type { SpaceSandboxRecord } from "@neta-art/cohub";
import type { TranslationKey } from "@/src/i18n/en";

export type SandboxSetupInfo = NonNullable<NonNullable<SpaceSandboxRecord["meta"]>["setup"]>;
export type SandboxSetupStatus = "waiting" | "running" | "succeeded" | "failed" | "unavailable";

export const SETUP_STATUS: Record<SandboxSetupStatus, { label: TranslationKey; tone: "neutral" | "info" | "success" | "danger" }> = {
  waiting: { label: "space.setup.waiting", tone: "neutral" },
  running: { label: "space.setup.running", tone: "info" },
  succeeded: { label: "space.setup.succeeded", tone: "success" },
  failed: { label: "space.setup.failed", tone: "danger" },
  unavailable: { label: "space.setup.unavailable", tone: "neutral" },
};

/** Reports from sandboxes older than per-step status carry only an exit code; mirrors web. */
export function sandboxSetupStatus(setup: SandboxSetupInfo | null | undefined): SandboxSetupStatus {
  if (!setup) return "unavailable";
  if (setup.status) return setup.status;
  return setup.error || setup.exitCode ? "failed" : "succeeded";
}

export function sandboxSetupInfo(meta: Record<string, unknown> | null | undefined): SandboxSetupInfo | null {
  const setup = meta?.setup;
  if (!setup || typeof setup !== "object" || typeof (setup as { ran?: unknown }).ran !== "boolean") return null;
  return setup as SandboxSetupInfo;
}

export function sandboxSetupLogPaths(logDir: string): { stdout: string; stderr: string } {
  const base = logDir.replace(/\/+$/, "");
  return { stdout: `${base}/stdout.log`, stderr: `${base}/stderr.log` };
}
