import type { MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import { messageRowKey, turnSequenceForMessage } from "./session-history";

/**
 * The native timeline's rows. A message's attachments (where it came from, the turn's steps, where
 * it was sent, the live reply, the fork boundary) are rows of their own, so a streamed step list or
 * reply re-renders one small row instead of the message above it. `owner` is the message row they
 * belong to, which is what reading position, read state, and turn jumps are about.
 */
export type TimelineRow =
  | { kind: "older"; key: "older"; owner: null }
  | { kind: "newer"; key: "newer"; owner: null }
  | { kind: "sentFrom"; key: string; owner: string; turn: SessionTurnRecord }
  | { kind: "message"; key: string; owner: string; message: MessageRecord; index: number }
  | { kind: "process"; key: string; owner: string; turn: SessionTurnRecord; live: boolean }
  | { kind: "talk"; key: string; owner: string; turn: SessionTurnRecord; live: boolean }
  | { kind: "sentTo"; key: string; owner: string; turn: SessionTurnRecord }
  | { kind: "live"; key: "live"; owner: string | null; processInRow: boolean }
  | { kind: "fork"; key: "fork"; owner: string };

export type TimelineRowsInput = {
  messages: readonly MessageRecord[];
  turnsBySequence: ReadonlyMap<number, readonly SessionTurnRecord[]>;
  /** The sequence that closes the inherited prefix of a forked Chat. */
  forkSequence: number | null;
  replyAnchor: string | null;
  streamTurnId: string | null;
  isActiveTurn: (turn: SessionTurnRecord) => boolean;
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  /** A Bot Chat: what the Bot said between steps follows each Turn's steps. */
  talk?: boolean;
};

export function timelineRows(input: TimelineRowsInput): TimelineRow[] {
  const { messages, turnsBySequence, forkSequence, replyAnchor, streamTurnId } = input;
  const rows: TimelineRow[] = [];
  if (input.hasMoreOlder) rows.push({ kind: "older", key: "older", owner: null });
  messages.forEach((message, index) => {
    const owner = messageRowKey(message);
    const sequence = turnSequenceForMessage(message);
    const turns = message.role === "user" && sequence !== null ? turnsBySequence.get(sequence) : undefined;
    const first = turns?.[0];
    if (first) rows.push({ kind: "sentFrom", key: `from:${owner}`, owner, turn: first });
    rows.push({ kind: "message", key: owner, owner, message, index });
    for (const turn of turns ?? []) {
      const live = turn.id === streamTurnId || input.isActiveTurn(turn);
      rows.push({ kind: "process", key: `process:${turn.id}`, owner, turn, live });
      if (input.talk) rows.push({ kind: "talk", key: `talk:${turn.id}`, owner, turn, live });
      rows.push({ kind: "sentTo", key: `to:${turn.id}`, owner, turn });
    }
    if (message.id === replyAnchor) rows.push({ kind: "live", key: "live", owner, processInRow: Boolean(turns?.some((turn) => turn.id === streamTurnId)) });
    const next = messages[index + 1];
    if (forkSequence !== null && sequence === forkSequence && (next ? turnSequenceForMessage(next) : null) !== sequence) rows.push({ kind: "fork", key: "fork", owner });
  });
  if (input.hasMoreNewer) rows.push({ kind: "newer", key: "newer", owner: null });
  if (messages.length === 0) rows.push({ kind: "live", key: "live", owner: null, processInRow: false });
  return rows;
}

/** The first row of the message a turn jump lands on, so its "sent from" link shows above it. */
export function timelineTargetKey(rows: readonly TimelineRow[], messageKey: string): string | null {
  return rows.find((row) => row.owner === messageKey)?.key ?? null;
}

/** Visible rows reduced to their messages, top first, each once. */
export function visibleTimelineMessages(rows: readonly TimelineRow[], visibleKeys: readonly string[]): { message: MessageRecord; index: number; key: string }[] {
  const byKey = new Map<string, TimelineRow>(rows.map((row) => [row.key, row]));
  const messageRows = new Map<string, Extract<TimelineRow, { kind: "message" }>>();
  for (const row of rows) if (row.kind === "message") messageRows.set(row.key, row);
  const seen = new Set<string>();
  const visible: { message: MessageRecord; index: number; key: string }[] = [];
  for (const key of visibleKeys) {
    const owner = byKey.get(key)?.owner;
    if (!owner || seen.has(owner)) continue;
    const row = messageRows.get(owner);
    if (!row) continue;
    seen.add(owner);
    visible.push({ message: row.message, index: row.index, key: owner });
  }
  return visible.sort((left, right) => left.index - right.index);
}
