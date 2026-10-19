import type { UserSessionListItem } from "@neta-art/cohub";
import type { LatestSessionTurn, SessionStatus } from "./session-status";
import type { Translate } from "@/src/i18n/core";
import type { StreamView } from "./types";

export type SessionActivityTone = "muted" | "danger";

export type SessionActivity = {
  text: string;
  tone: SessionActivityTone;
};

type ActivityOptions = {
  status: SessionStatus;
  /** Latest Turn from `loadSessionLatestTurns`; carries the text already fetched for status. */
  latestTurn: LatestSessionTurn | null | undefined;
  /** The open Chat's live Turn, when it belongs to the active Turn. */
  live: Pick<StreamView, "turnId" | "status"> | null;
  t: Translate;
  now?: number;
};

/** Coarse buckets keep the row still between per-minute rerenders. */
function formatElapsed(elapsedMs: number, t: Translate) {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  return minutes >= 60
    ? t("session.activity.elapsedHours", { hours: Math.floor(minutes / 60) })
    : t("session.activity.elapsedMinutes", { minutes });
}

/**
 * The second-line state for a Chat row. A live or unsettled Turn outranks the
 * preview, which can be empty while tool-call messages are the latest write.
 */
export function sessionActivity(session: Pick<UserSessionListItem, "activeTurn" | "lastTurnIssue">, options: ActivityOptions): SessionActivity | null {
  const { status, t } = options;

  if (status === "running") {
    const active = session.activeTurn;
    if (active?.status === "queued") return { text: t("ui.status.queued"), tone: "muted" };
    if (active?.status === "abort_requested") return { text: t("session.activity.stopping"), tone: "muted" };
    if (active && options.live?.turnId === active.id && options.live.status === "pending") return { text: t("session.activity.starting"), tone: "muted" };
    const label = t("ui.status.running");
    const startedAt = Date.parse(active?.startedAt ?? options.latestTurn?.startedAt ?? "");
    return Number.isFinite(startedAt)
      ? { text: `${label} ${formatElapsed((options.now ?? Date.now()) - startedAt, t)}`, tone: "muted" }
      : { text: label, tone: "muted" };
  }

  if (status === "failed" || status === "stopped") {
    const reason = (options.latestTurn?.errorMessage ?? session.lastTurnIssue?.errorMessage)?.replace(/\s+/g, " ").trim();
    const label = t(status === "failed" ? "ui.status.failed" : "ui.status.stopped");
    return { text: reason ? `${label} · ${reason}` : label, tone: status === "failed" ? "danger" : "muted" };
  }

  return null;
}
