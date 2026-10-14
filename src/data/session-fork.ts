import type { CohubClient, SessionForkRecord, SessionRecord, SessionTurnRecord } from "@neta-art/cohub";

export async function forkSessionTurn(
  client: CohubClient,
  spaceId: string,
  sessionId: string,
  turn: Pick<SessionTurnRecord, "id" | "sourceTurnId">,
): Promise<{ session: SessionRecord; fork: SessionForkRecord }> {
  const anchorId = turn.sourceTurnId ?? turn.id;
  if (!spaceId.trim() || !sessionId.trim() || !anchorId.trim()) {
    throw new Error("Cannot fork without a Space, Chat, and saved turn. Reload the Chat and try again.");
  }
  // Inherited turns must use their original server anchor, as in the web client.
  return client.space(spaceId).session(sessionId).turn(anchorId).fork();
}

export type ForkPoint = {
  sequence: number;
  sessionId: string;
  turnId: string;
};

type TimelineTurn = Pick<SessionTurnRecord, "id" | "sequence" | "sourceSessionId" | "sourceTurnId">;

/** Inherited Turns form a prefix; report its end only once the loaded window shows what follows. */
export function forkPoint(turns: readonly TimelineTurn[], sessionId: string, hasMoreNewer: boolean): ForkPoint | null {
  let anchor: TimelineTurn | null = null;
  for (const turn of turns) {
    if (turn.sourceSessionId && turn.sourceSessionId !== sessionId && (!anchor || turn.sequence > anchor.sequence)) anchor = turn;
  }
  if (!anchor?.sourceSessionId) return null;
  const sequence = anchor.sequence;
  const followed = turns.some((turn) => turn.sequence === sequence + 1);
  const newest = !hasMoreNewer && turns.every((turn) => turn.sequence <= sequence);
  if (!followed && !newest) return null;
  return { sequence, sessionId: anchor.sourceSessionId, turnId: anchor.sourceTurnId ?? anchor.id };
}
