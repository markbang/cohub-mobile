/** Most transient work finishes before this; showing a status for it only adds a flicker. */
export const STATUS_SHOW_DELAY_MS = 400;
/** Once shown, a status stays at least this long so it can be read instead of flashing. */
export const STATUS_MIN_VISIBLE_MS = 400;

export type DelayedStatusOptions = { showDelayMs?: number; minVisibleMs?: number };

export type DelayedStatusState<T> =
  | { phase: "idle"; key: string }
  | { phase: "pending"; key: string; showAt: number }
  | { phase: "shown"; key: string; value: T; holdUntil: number };

/**
 * A status shows only after it has stayed set for `showDelayMs`, then stays for at least
 * `minVisibleMs`. `deadlinePassed` says whether `delayedStatusDeadline(state)` has been reached.
 * Returns `state` itself when nothing changes, so it can run on every render. Values compare by
 * identity; a new `key` (another Chat, another request) starts over.
 */
export function stepDelayedStatus<T>(
  state: DelayedStatusState<T> | null,
  input: { key: string; value: T | null; deadlinePassed: boolean } & DelayedStatusOptions,
  now: () => number,
): DelayedStatusState<T> {
  const { key, value, deadlinePassed, showDelayMs = STATUS_SHOW_DELAY_MS, minVisibleMs = STATUS_MIN_VISIBLE_MS } = input;
  const shown = (next: T): DelayedStatusState<T> => ({ phase: "shown", key, value: next, holdUntil: now() + minVisibleMs });
  const start = (): DelayedStatusState<T> => {
    if (value === null) return { phase: "idle", key };
    return showDelayMs <= 0 ? shown(value) : { phase: "pending", key, showAt: now() + showDelayMs };
  };
  if (state === null || state.key !== key) return start();
  switch (state.phase) {
    case "idle":
      return value === null ? state : start();
    case "pending":
      if (value === null) return { phase: "idle", key };
      return deadlinePassed ? shown(value) : state;
    case "shown":
      if (value === null) return deadlinePassed ? { phase: "idle", key } : state;
      return value === state.value ? state : shown(value);
  }
}

export function delayedStatusDeadline<T>(state: DelayedStatusState<T>): number | null {
  return state.phase === "pending" ? state.showAt : state.phase === "shown" ? state.holdUntil : null;
}

export function shownDelayedStatus<T>(state: DelayedStatusState<T>, key: string): T | null {
  return state.phase === "shown" && state.key === key ? state.value : null;
}
