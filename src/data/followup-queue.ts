import type { CohubClient, MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import type { StreamView } from "./types";

export function shouldQueueFollowup(turns: readonly SessionTurnRecord[], stream: StreamView | null | undefined): boolean {
  return turns.some((turn) => turn.status === "running" || turn.status === "abort_requested")
    || stream?.status === "pending" || stream?.status === "streaming";
}

export function isOptimisticFollowup(message: MessageRecord): boolean {
  return message.role === "user" && message.meta?.optimistic === true && message.meta?.queuedFollowup === true;
}

export type FollowupQueueItem = {
  key: string;
  preview: string;
  sequence: number;
  clientMessageId: string | null;
  turn: SessionTurnRecord | null;
  message: MessageRecord | null;
};

export function followupQueueItems(turns: readonly SessionTurnRecord[], activeTurnId: string | null | undefined, messages: readonly MessageRecord[]): FollowupQueueItem[] {
  const confirmed = queuedFollowupTurns(turns, activeTurnId).map((turn): FollowupQueueItem => ({
    key: turn.id, preview: followupPreviewText(turn), sequence: turn.sequence,
    clientMessageId: typeof turn.meta?.clientMessageId === "string" ? turn.meta.clientMessageId : null,
    turn, message: null,
  }));
  const pending = messages.filter(isOptimisticFollowup).filter((message) => !turns.some((turn) =>
    (typeof message.meta?.clientMessageId === "string" && turn.meta?.clientMessageId === message.meta.clientMessageId)
      // An unsubmitted send's Turn number is provisional and never matches by number.
      || (message.meta?.awaitingSubmit !== true && turn.sequence === message.meta?.turnSequence)
  )).map((message): FollowupQueueItem => ({
    key: message.id, preview: followupPreviewText({ userText: message.text }),
    sequence: Number(message.meta?.turnSequence),
    clientMessageId: typeof message.meta?.clientMessageId === "string" ? message.meta.clientMessageId : null,
    turn: null, message,
  }));
  return [...confirmed, ...pending].sort((left, right) => left.sequence - right.sequence);
}

export function isSendQueueItem(item: FollowupQueueItem, message: MessageRecord): boolean {
  const clientId = message.meta?.clientMessageId;
  if (typeof clientId === "string" && item.clientMessageId !== null) return clientId === item.clientMessageId;
  return item.key === message.id || item.sequence === message.meta?.turnSequence;
}

/** Server-side follow-ups waiting for the running turn to finish, excluding the turn currently streaming. */
export function queuedFollowupTurns(turns: readonly SessionTurnRecord[], activeTurnId: string | null | undefined) {
  const active = turns.find((turn) => turn.id === activeTurnId && (turn.status === "queued" || turn.status === "running" || turn.status === "abort_requested")) ?? turns.find((turn) => turn.status === "running" || turn.status === "abort_requested");
  if (!active) return [];
  return turns
    .filter((turn) => turn.status === "queued" && turn.intent === "followup" && turn.id !== active.id)
    .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt));
}

export function followupPreviewText(turn: Pick<SessionTurnRecord, "userText"> & Partial<Pick<SessionTurnRecord, "userContent">>) {
  const text = (turn.userText ?? "").replace(/\s+/g, " ").trim();
  const filenames = (turn.userContent ?? []).flatMap((block) => block.type === "image" && typeof block._meta?.filename === "string" ? [block._meta.filename] : []);
  return text || filenames.join(", ") || "Follow-up";
}

/** Aborts the running turn and runs this queued follow-up next. */
export async function steerQueuedFollowup(client: CohubClient, spaceId: string, sessionId: string, turnId: string) {
  return client.space(spaceId).session(sessionId).steerTurn(turnId);
}

export async function cancelQueuedFollowup(client: CohubClient, spaceId: string, sessionId: string, turnId: string) {
  return client.space(spaceId).session(sessionId).cancelTurn(turnId);
}

type SendJob = { id: string; order: number; run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void };
type SendLane = { jobs: SendJob[]; running: string | null; blockedBy: string | null };

/**
 * One FIFO per Chat. A send goes out only after the one ahead of it was accepted, so the server
 * numbers Turns in the order they were sent; it never waits for the agent. A failed send holds the
 * sends behind it until the user retries or deletes it.
 */
export function createSendQueue() {
  const lanes = new Map<string, SendLane>();
  const lane = (key: string) => {
    let value = lanes.get(key);
    if (!value) lanes.set(key, value = { jobs: [], running: null, blockedBy: null });
    return value;
  };
  const pump = (key: string) => {
    const current = lane(key);
    if (current.running !== null || current.blockedBy !== null) return;
    const job = current.jobs.shift();
    if (!job) return;
    current.running = job.id;
    job.run().then(() => {
      current.running = null;
      job.resolve();
      pump(key);
    }, (error: unknown) => {
      current.running = null;
      current.blockedBy = job.id;
      job.reject(error);
    });
  };
  return {
    /** Ordered by `order`, so a retry takes back the place of the send it replaces. */
    enqueue(key: string, job: { id: string; order: number; run: () => Promise<void> }): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const jobs = lane(key).jobs;
        const index = jobs.findIndex((item) => item.order > job.order);
        jobs.splice(index < 0 ? jobs.length : index, 0, { ...job, resolve, reject });
        pump(key);
      });
    },
    /** The failed send was retried or deleted; the sends behind it continue. */
    release(key: string, id: string) {
      const current = lanes.get(key);
      if (current?.blockedBy !== id) return;
      current.blockedBy = null;
      pump(key);
    },
    blocked(): [string, string][] {
      return [...lanes].flatMap(([key, value]) => value.blockedBy === null ? [] : [[key, value.blockedBy] as [string, string]]);
    },
    has(key: string, id: string) {
      const current = lanes.get(key);
      return Boolean(current && (current.running === id || current.jobs.some((job) => job.id === id)));
    },
  };
}

export type SendQueue = ReturnType<typeof createSendQueue>;
