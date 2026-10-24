import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import type { LatestSessionTurn } from "./session-status";

export type SpaceRealtimeEvent = Parameters<Parameters<CohubClient["onUserEvent"]>[0]>[0];

type SpaceChange = {
  exact: string[];
  prefixes: string[];
  sessionId?: string;
  session?: Partial<SessionRecord>;
  turn?: Partial<LatestSessionTurn>;
};

/** Only summary/lifecycle events invalidate reads; stream patches belong to the Chat reducer. */
export function spaceRealtimeChange(event: SpaceRealtimeEvent): SpaceChange {
  const change: SpaceChange = { exact: [], prefixes: [] };
  const spaceId = event.spaceId;
  if (typeof spaceId !== "string" || !spaceId.trim()) return change;
  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const session = event.payload.session as Partial<SessionRecord> | undefined;
      if (typeof event.sessionId !== "string" || !session || session.id !== event.sessionId || session.spaceId !== spaceId || (session.updatedAt !== undefined && (typeof session.updatedAt !== "string" || !Number.isFinite(Date.parse(session.updatedAt))))) throw new Error("Invalid realtime Chat metadata. Reopen the Space to retry.");
      change.sessionId = event.sessionId;
      change.prefixes.push("chats");
      change.exact.push(`space:${spaceId}:chats`, `space:${spaceId}:chat-panel`);
      // Partial updates (e.g. activeTurn-only) carry no revision, so they cannot order metadata.
      if (session.updatedAt === undefined) break;
      const metadata: Partial<SessionRecord> = { id: session.id, spaceId, updatedAt: session.updatedAt };
      for (const key of ["title", "source", "latestMessageText", "lastMessageId", "lastMessageAt"] as const) {
        const value = session[key];
        if (value === undefined) continue;
        if (value !== null && (typeof value !== "string" || (key === "lastMessageAt" && !Number.isFinite(Date.parse(value))))) throw new Error("Invalid realtime Chat metadata. Reopen the Space to retry.");
        metadata[key] = value;
      }
      change.session = metadata;
      break;
    }
    case "session.turn.created":
    case "session.turn.updated":
    case "session.turn.finalized": {
      const turn = event.payload.turn as (Partial<LatestSessionTurn> & { sessionId?: string }) | undefined;
      if (typeof event.sessionId !== "string" || !event.sessionId || typeof turn?.id !== "string" || !turn.id || (turn.sessionId !== undefined && turn.sessionId !== event.sessionId) || (turn.sequence !== undefined && (!Number.isSafeInteger(turn.sequence) || turn.sequence < 1)) || (turn.status !== undefined && !["queued", "running", "abort_requested", "completed", "failed", "interrupted", "merged", "cancelled"].includes(turn.status)) || (turn.updatedAt !== undefined && (typeof turn.updatedAt !== "string" || !Number.isFinite(Date.parse(turn.updatedAt))))) throw new Error("Invalid realtime Chat status. Reopen the Space to retry.");
      change.sessionId = event.sessionId;
      // The payload narrows to the reported fields; the row falls back to its preview otherwise.
      change.turn = {
        id: turn.id,
        ...(turn.sequence === undefined ? {} : { sequence: turn.sequence }),
        ...(turn.status === undefined ? {} : { status: turn.status }),
        ...(turn.updatedAt === undefined ? {} : { updatedAt: turn.updatedAt }),
        ...(typeof turn.userText === "string" || turn.userText === null ? { userText: turn.userText } : {}),
        ...(typeof turn.assistantText === "string" || turn.assistantText === null ? { assistantText: turn.assistantText } : {}),
        ...(typeof turn.errorMessage === "string" || turn.errorMessage === null ? { errorMessage: turn.errorMessage } : {}),
        ...(typeof turn.startedAt === "string" || turn.startedAt === null ? { startedAt: turn.startedAt } : {}),
      };
      change.exact.push("chat-statuses", `space:${spaceId}:chats`, `space:${spaceId}:chat-panel`);
      // Running membership follows the Turn state in place; account scans only reconcile.
      change.prefixes.push("chats");
      break;
    }
    case "space.fs.changed":
      change.prefixes.push(`space:${spaceId}:files:`, `space:${spaceId}:files-panel:`);
      break;
    case "app.version.published":
      change.exact.push(`space:${spaceId}:resources`);
      break;
    case "app.domain.updated":
    case "app.domain.removed": {
      const payload = event.payload as { appId?: unknown; domain?: { appId?: unknown } } | undefined;
      const appId = event.type === "app.domain.updated" ? payload?.domain?.appId : payload?.appId;
      if (typeof appId !== "string" || !appId) throw new Error("Invalid realtime App domain. Reopen the App to retry.");
      change.exact.push(`app:${appId}:domains`);
      break;
    }
    case "task.created":
    case "task.updated": {
      const task = event.payload.task as { id?: unknown; status?: unknown } | undefined;
      if (typeof task?.id !== "string" || !task.id) throw new Error("Invalid realtime Task. Reopen the Space to retry.");
      change.exact.push(`space:${spaceId}:tasks`, `task:${task.id}`);
      if (event.type === "task.updated" && (task?.status === "completed" || task?.status === "failed")) change.exact.push(`space:${spaceId}:resources`);
      break;
    }
    case "label.assignments.updated":
      change.prefixes.push("chats", "running:", `space:${spaceId}:label-members:`);
      change.exact.push(`space:${spaceId}:chat-panel`, `space:${spaceId}:labels`);
      break;
  }
  return change;
}

const USER_SESSION_EVENT_TYPES: ReadonlySet<string> = new Set(["session.created", "session.updated", "session.turn.created", "session.turn.updated", "session.turn.finalized"]);

/**
 * Creators and participants receive Session snapshots and Turn-state projections in
 * their user room for every Space, without joining it. Held rows reconcile in place;
 * only a Chat this account has not loaded needs a list read (or, once running, a
 * single Chat read by the caller).
 */
export function userSessionRealtimeChange(event: SpaceRealtimeEvent, isListed: (sessionId: string) => boolean): SpaceChange {
  if (!USER_SESSION_EVENT_TYPES.has(event.type)) return { exact: [], prefixes: [] };
  const change = spaceRealtimeChange(event);
  if (!change.sessionId) return change;
  return { ...change, exact: [], prefixes: isListed(change.sessionId) ? [] : ["chats"] };
}
