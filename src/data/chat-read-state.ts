import type { MessageRecord } from "@neta-art/cohub";
function messageTurnSequence(message: Pick<MessageRecord, "meta">) {
  const sequence = message.meta?.turnSequence;
  return typeof sequence === "number" && Number.isInteger(sequence) ? sequence : null;
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
