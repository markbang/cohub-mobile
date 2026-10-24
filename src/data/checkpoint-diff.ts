import type { CheckpointDiffStatus, CheckpointRecord } from "@neta-art/cohub";
import type { TranslationKey } from "@/src/i18n/en";

export const DIFF_STATUS: Record<CheckpointDiffStatus, { label: TranslationKey; letter: string; tone: "success" | "danger" | "accent" | "muted" }> = {
  A: { label: "save.diff.added", letter: "A", tone: "success" },
  M: { label: "save.diff.modified", letter: "M", tone: "muted" },
  T: { label: "save.diff.modified", letter: "M", tone: "muted" },
  D: { label: "save.diff.deleted", letter: "D", tone: "danger" },
  R: { label: "save.diff.renamed", letter: "R", tone: "accent" },
  C: { label: "save.diff.copied", letter: "C", tone: "accent" },
};

export function formatDiffCounts(additions: number | null | undefined, deletions: number | null | undefined): string {
  const parts: string[] = [];
  if (typeof additions === "number") parts.push(`+${additions}`);
  if (typeof deletions === "number") parts.push(`−${deletions}`);
  return parts.join(" ");
}

export function saveTitle(checkpoint: Pick<CheckpointRecord, "description" | "commitHash">, fallback: (hash: string) => string): string {
  return checkpoint.description?.trim() || fallback(checkpoint.commitHash.slice(0, 8));
}

export function saveStat(checkpoint: Pick<CheckpointRecord, "meta">, key: string): number | null {
  const stats = checkpoint.meta?.stats;
  if (!stats || typeof stats !== "object") return null;
  const value = (stats as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function joinSavePath(directory: string, name: string): string {
  return directory ? `${directory.replace(/\/+$/, "")}/${name}` : name;
}
