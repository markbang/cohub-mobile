/**
 * A picker, camera, share sheet, or browser opened from the app is a foreground handoff. Android
 * reports it as the app going to the background (RN maps every `onPause` to `background`), so live
 * work would be torn down and everything refetched on each attachment pick.
 */
export const HANDOFF_MAX_HOLD_MS = 60_000;

export type ForegroundGate = {
  /** Marks a handoff open; the returned function ends it and is safe to call more than once. */
  begin: () => () => void;
  /** Maps a raw active/inactive report to the transitions listeners should see, in order. */
  next: (rawActive: boolean) => boolean[];
  /** Whether a background report is being held for an open or just-ended handoff. */
  holding: () => boolean;
  active: () => boolean;
};

/**
 * A background report during a handoff is held instead of delivered. Returning within
 * `maxHoldMs` delivers nothing, since nothing was torn down; returning later delivers a full
 * background-then-active cycle, because the process may have been suspended for that long.
 */
export function createForegroundGate(now: () => number = Date.now, maxHoldMs = HANDOFF_MAX_HOLD_MS): ForegroundGate {
  let handoffs = 0;
  let heldAt: number | null = null;
  let reported = true;
  return {
    begin() {
      handoffs += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        handoffs -= 1;
      };
    },
    next(rawActive) {
      if (!rawActive) {
        if (handoffs > 0 && reported) {
          heldAt ??= now();
          return [];
        }
        heldAt = null;
        if (!reported) return [];
        reported = false;
        return [false];
      }
      const held = heldAt;
      heldAt = null;
      if (reported) return held !== null && now() - held > maxHoldMs ? [false, true] : [];
      reported = true;
      return [true];
    },
    holding: () => heldAt !== null,
    active: () => reported,
  };
}
