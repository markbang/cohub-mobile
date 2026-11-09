import type { WorkspaceUsage } from "@neta-art/cohub";
import { getActiveLocale, translate } from "@/src/i18n/core";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Binary units, one decimal below 10, as the web settings show them. */
export function formatWorkspaceBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const index = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${UNITS[index]}`;
}

/** When the size was taken, and whether the workspace may have changed since. */
export function workspaceUsageNote(usage: WorkspaceUsage): string {
  if (usage.status === "error") return translate("space.settings.storage.error");
  const at = usage.measuredAt ? Date.parse(usage.measuredAt) : Number.NaN;
  if (!Number.isFinite(at)) return translate("space.settings.storage.pending");
  const time = new Date(at).toLocaleString(getActiveLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const measured = translate("space.settings.storage.measured", { time });
  return usage.status === "stale" ? `${measured} · ${translate("space.settings.storage.stale")}` : measured;
}
