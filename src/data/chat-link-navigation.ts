export type ChatLinkTarget = { sessionId: string; turn: string | null; turnId: string | null };

export type ChatLinkNavigation =
  | { kind: "push" }
  | { kind: "none" }
  | { kind: "setParams"; params: { turn: string | undefined; turnId: string | undefined } };

/**
 * A notification or deep link selects a Chat rather than drilling into one: when that Chat is
 * already on top, it updates in place instead of stacking a second copy whose Back returns to
 * the same Chat. Both turn params are always written so a new target replaces the previous one.
 */
export function chatLinkNavigation(currentPathname: string, target: ChatLinkTarget): ChatLinkNavigation {
  if (currentPathname !== `/chat/${target.sessionId}`) return { kind: "push" };
  if (!target.turn && !target.turnId) return { kind: "none" };
  return { kind: "setParams", params: { turn: target.turn ?? undefined, turnId: target.turnId ?? undefined } };
}
