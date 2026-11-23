import type { MessageRecord } from "@neta-art/cohub";
import { isFailedSend, isLocalSend, turnSequenceForMessage } from "./session-history";

function messageTurnSequence(message: Pick<MessageRecord, "meta">) {
  const sequence = message.meta?.turnSequence;
  return typeof sequence === "number" && Number.isInteger(sequence) ? sequence : null;
}

/** The first message of the first Turn after `readSequence`, or -1 when this device has read it all. */
export function firstUnseenIndex(messages: Pick<MessageRecord, "meta">[], readSequence: number | null) {
  if (readSequence === null) return -1;
  return messages.findIndex((message) => {
    const sequence = turnSequenceForMessage(message);
    return sequence !== null && sequence > readSequence;
  });
}

export type UnreadStart = {
  messageId: string;
  /** The Turn whose first message opens the unread run; the run is read once the read sequence reaches it. */
  turnSequence: number;
  /** The run is only the last message, so opening at the tail already shows it. */
  atEnd: boolean;
};

/** Where a Chat with unread opens: the first message of the first Turn after the read sequence. */
export function unreadStart(messages: MessageRecord[], readSequence: number | null): UnreadStart | null {
  const index = firstUnseenIndex(messages, readSequence);
  const message = messages[index];
  const turnSequence = message ? turnSequenceForMessage(message) : null;
  if (!message || turnSequence === null) return null;
  return { messageId: message.id, turnSequence, atEnd: index === messages.length - 1 };
}

/** Whether the loaded messages reach the Turn after the read sequence, so the unread run can start in them. */
export function reachesUnread(messages: Pick<MessageRecord, "meta">[], readSequence: number | null) {
  if (readSequence === null) return true;
  return messages.some((message) => {
    const sequence = turnSequenceForMessage(message);
    return sequence !== null && sequence <= readSequence + 1;
  });
}

/** The read sequence once these messages have shown: the newest assistant Turn among them, never lower than `current`. */
export function readThrough(current: number | null, messages: Iterable<Pick<MessageRecord, "role" | "meta">>): number | null {
  let latest = current;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const sequence = turnSequenceForMessage(message);
    if (sequence !== null && (latest === null || sequence > latest)) latest = sequence;
  }
  return latest;
}

/** A user message the server accepted: a send still in flight or one that failed has nothing delivered. */
export function isDeliveredMessage(message: Pick<MessageRecord, "role" | "meta">) {
  return message.role === "user" && !isLocalSend(message) && !isFailedSend(message);
}

export function latestUnreadAssistantIndex(messages: MessageRecord[], readSequence: number | null) {
  let latestIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const sequence = messageTurnSequence(message);
    if (sequence !== null && (readSequence === null || sequence > readSequence)) latestIndex = index;
  }
  return latestIndex;
}

/** Assistant turns newer than what the device has shown: what jumping to the latest reveals. */
export function unreadAssistantTurnCount(messages: readonly MessageRecord[], readSequence: number | null) {
  const turns = new Set<number>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const sequence = messageTurnSequence(message);
    if (sequence !== null && (readSequence === null || sequence > readSequence)) turns.add(sequence);
  }
  return turns.size;
}

/** What this device last showed of a Chat. A `null` id at `seenAt` 0 is a manual "mark as unread". */
export type SessionSeenEntry = { messageId: string | null; seenAt: number };
export type SessionSeenState = { baseline: number | null; entries: Readonly<Record<string, SessionSeenEntry>> };

export const EMPTY_SESSION_SEEN: SessionSeenState = { baseline: null, entries: {} };

/**
 * Unread is device-local, as on the web app. A Chat never opened here counts only for messages after
 * the baseline (the first launch that tracked reads), so an existing account does not start all unread.
 */
export function isSessionUnread(session: { id: string; lastMessageId: string | null; lastMessageAt: string | null }, seen: SessionSeenState): boolean {
  if (seen.baseline === null || !session.lastMessageId) return false;
  const lastAt = session.lastMessageAt ? Date.parse(session.lastMessageAt) : Number.NaN;
  const entry = seen.entries[session.id];
  if (!entry) return Number.isFinite(lastAt) && lastAt > seen.baseline;
  if (entry.messageId === session.lastMessageId) return false;
  // The list can learn a message id after the Chat that showed it closed; its time still places it.
  return !(Number.isFinite(lastAt) && lastAt <= entry.seenAt);
}

type LastMessage = { lastMessageId: string | null; lastMessageAt: string | null };

/** The newer of two records' last message; the thread and the list update on separate paths. */
export function latestMessageId(...records: (LastMessage | null | undefined)[]): string | null {
  let latest: LastMessage | null = null;
  for (const record of records) {
    if (!record?.lastMessageId) continue;
    if (!latest || Date.parse(record.lastMessageAt ?? "") > Date.parse(latest.lastMessageAt ?? "")) latest = record;
  }
  return latest?.lastMessageId ?? null;
}
