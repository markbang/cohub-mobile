import { readSentTurns, readSessionTurnOrigin, type CohubClient, type SessionRecord, type SessionTurnRecord } from "@neta-art/cohub";

export type RelatedSessionRef = { spaceId: string; sessionId: string; turnId: string };

export type SentSession = RelatedSessionRef & { count: number };

export type RelatedSessionView = { status: "unknown" } | { status: "ready"; session: SessionRecord } | { status: "unavailable" };

/** Self follow-ups are skipped; they are already in the same timeline. */
export function sentFrom(turn: Pick<SessionTurnRecord, "sessionId" | "meta">): RelatedSessionRef | null {
  const origin = readSessionTurnOrigin(turn.meta);
  if (!origin || origin.sessionId === turn.sessionId) return null;
  return { spaceId: origin.spaceId, sessionId: origin.sessionId, turnId: origin.turnId };
}

/** Entries recorded before `spaceId` was mirrored belong to the caller's Space. */
export function sentSessions(turn: Pick<SessionTurnRecord, "sessionId" | "meta">, callerSpaceId: string): SentSession[] {
  const sessions = new Map<string, SentSession>();
  for (const ref of readSentTurns(turn.meta)) {
    if (ref.sessionId === turn.sessionId) continue;
    const spaceId = ref.spaceId ?? callerSpaceId;
    const key = `${spaceId}:${ref.sessionId}`;
    const current = sessions.get(key);
    if (current) sessions.set(key, { ...current, turnId: ref.turnId, count: current.count + 1 });
    else sessions.set(key, { spaceId, sessionId: ref.sessionId, turnId: ref.turnId, count: 1 });
  }
  return [...sessions.values()];
}

const UNKNOWN: RelatedSessionView = { status: "unknown" };

function isAccessDenied(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : null;
  return status === 403 || status === 404;
}

/** Scoped to one client, which is recreated per signed-in user. */
export function createRelatedSessionStore(client: CohubClient) {
  const settled = new Map<string, RelatedSessionView>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get(ref: Pick<RelatedSessionRef, "sessionId">): RelatedSessionView {
      return settled.get(ref.sessionId) ?? UNKNOWN;
    },
    request(ref: Pick<RelatedSessionRef, "spaceId" | "sessionId">) {
      if (settled.has(ref.sessionId) || pending.has(ref.sessionId)) return;
      pending.add(ref.sessionId);
      void client.space(ref.spaceId).session(ref.sessionId).get().then(
        ({ session }) => { settled.set(ref.sessionId, { status: "ready", session }); },
        // Transient failures stay unknown so the next mount retries.
        (error: unknown) => { if (isAccessDenied(error)) settled.set(ref.sessionId, { status: "unavailable" }); },
      ).finally(() => {
        pending.delete(ref.sessionId);
        notify();
      });
    },
  };
}

export type RelatedSessionStore = ReturnType<typeof createRelatedSessionStore>;
