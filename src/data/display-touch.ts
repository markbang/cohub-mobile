/**
 * Turns raw touches on a remote display into intents, as the web client's `display-touch.ts` does.
 * `touch` taps and drags where the finger is; `trackpad` steers a cursor the way a laptop trackpad does.
 */
export const DISPLAY_TOUCH = {
  slop: 8,
  tapMs: 250,
  doubleTapMs: 300,
  holdMs: 500,
  zoomSlop: 20,
  panSlop: 10,
} as const;

export type DisplayTouchMode = "touch" | "trackpad";

export type DisplayTouchIntent =
  | { type: "press" | "drag" | "release"; x: number; y: number }
  | { type: "cancel" }
  | { type: "move"; dx: number; dy: number }
  | { type: "tap" | "hold" | "drop" }
  | { type: "secondary"; x: number; y: number }
  | { type: "pinch"; zoom: boolean; scale: number; x: number; y: number; dx: number; dy: number }
  | { type: "settle" };

type Finger = { x: number; y: number; startX: number; startY: number };
type Timer = ReturnType<typeof setTimeout>;

type Pair = {
  ids: [number, number];
  startedAt: number;
  start: { distance: number; x: number; y: number };
  last: { distance: number; x: number; y: number };
  zoom: boolean | null;
};

type State =
  | { kind: "idle" }
  | { kind: "pending"; id: number; hold: Timer }
  | { kind: "pressing"; id: number }
  | { kind: "tracking"; id: number; at: number; moved: boolean; armed: boolean; held: boolean; lastX: number; lastY: number }
  | { kind: "pair"; pair: Pair }
  | { kind: "spent" };

export function createDisplayTouch({ mode, emit }: { mode: () => DisplayTouchMode; emit: (intent: DisplayTouchIntent) => void }) {
  const fingers = new Map<number, Finger>();
  let state: State = { kind: "idle" };
  let lastTap = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };

  const drift = (finger: Finger) => Math.hypot(finger.x - finger.startX, finger.y - finger.startY);

  function clearPending() {
    if (state.kind === "pending") clearTimeout(state.hold);
  }

  function measure(ids: [number, number]) {
    const a = fingers.get(ids[0]);
    const b = fingers.get(ids[1]);
    if (!a || !b) return null;
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Nothing presses until the finger moves or lifts, so a pinch or a long press never clicks first.
  function commitPress(id: number, finger = fingers.get(id)) {
    clearPending();
    state = { kind: "pressing", id };
    if (finger) emit({ type: "press", x: finger.startX, y: finger.startY });
  }

  // A still finger held in touch mode is a secondary click, as a long press is on a phone.
  function holdSecondary(id: number) {
    const finger = fingers.get(id);
    clearPending();
    state = { kind: "spent" };
    if (finger) emit({ type: "secondary", x: finger.startX, y: finger.startY });
  }

  function startPair(at: number) {
    clearPending();
    if (state.kind === "pressing") emit({ type: "cancel" });
    if (state.kind === "tracking" && state.held) emit({ type: "drop" });
    const [first, second] = fingers.keys();
    if (first === undefined || second === undefined) return;
    const ids: [number, number] = [first, second];
    const start = measure(ids);
    if (!start) return;
    state = { kind: "pair", pair: { ids, startedAt: at, start, last: start, zoom: null } };
  }

  function movePair(pair: Pair) {
    const now = measure(pair.ids);
    if (!now) return;
    if (pair.zoom === null) {
      if (Math.abs(now.distance - pair.start.distance) >= DISPLAY_TOUCH.zoomSlop) pair.zoom = true;
      else if (Math.hypot(now.x - pair.start.x, now.y - pair.start.y) >= DISPLAY_TOUCH.panSlop) pair.zoom = false;
      else return;
    }
    const { last } = pair;
    emit({ type: "pinch", zoom: pair.zoom, scale: pair.zoom ? now.distance / last.distance : 1, x: last.x, y: last.y, dx: now.x - last.x, dy: now.y - last.y });
    pair.last = now;
  }

  function endPair(pair: Pair, at: number) {
    if (pair.zoom === null && at - pair.startedAt <= DISPLAY_TOUCH.tapMs) emit({ type: "secondary", x: pair.start.x, y: pair.start.y });
    else if (pair.zoom !== null) emit({ type: "settle" });
    state = { kind: "spent" };
  }

  return {
    down(id: number, x: number, y: number, at: number) {
      fingers.set(id, { x, y, startX: x, startY: y });
      if (fingers.size === 2 && state.kind !== "pair") {
        startPair(at);
        return;
      }
      if (fingers.size !== 1 || state.kind !== "idle") return;
      if (mode() === "touch") {
        state = { kind: "pending", id, hold: setTimeout(() => holdSecondary(id), DISPLAY_TOUCH.holdMs) };
        return;
      }
      const armed = at - lastTap.at <= DISPLAY_TOUCH.doubleTapMs && Math.hypot(x - lastTap.x, y - lastTap.y) <= DISPLAY_TOUCH.slop * 4;
      state = { kind: "tracking", id, at, moved: false, armed, held: false, lastX: x, lastY: y };
    },

    move(id: number, x: number, y: number) {
      const finger = fingers.get(id);
      if (!finger) return;
      finger.x = x;
      finger.y = y;
      switch (state.kind) {
        case "pending":
          if (state.id === id && drift(finger) > DISPLAY_TOUCH.slop) {
            commitPress(id);
            emit({ type: "drag", x, y });
          }
          return;
        case "pressing":
          if (state.id === id) emit({ type: "drag", x, y });
          return;
        case "tracking": {
          if (state.id !== id) return;
          if (!state.moved) {
            if (drift(finger) <= DISPLAY_TOUCH.slop) return;
            state.moved = true;
            if (state.armed) {
              state.held = true;
              emit({ type: "hold" });
            }
          }
          emit({ type: "move", dx: x - state.lastX, dy: y - state.lastY });
          state.lastX = x;
          state.lastY = y;
          return;
        }
        case "pair":
          if (state.pair.ids.includes(id)) movePair(state.pair);
          return;
      }
    },

    up(id: number, x: number, y: number, at: number) {
      const finger = fingers.get(id);
      if (!finger) return;
      fingers.delete(id);
      switch (state.kind) {
        case "pending":
          if (state.id !== id) break;
          commitPress(id, finger);
          emit({ type: "release", x, y });
          state = { kind: "idle" };
          break;
        case "pressing":
          if (state.id !== id) break;
          emit({ type: "release", x, y });
          state = { kind: "idle" };
          break;
        case "tracking":
          if (state.id !== id) break;
          if (state.held) emit({ type: "drop" });
          else if (!state.moved && at - state.at <= DISPLAY_TOUCH.tapMs) {
            emit({ type: "tap" });
            lastTap = { at, x, y };
          }
          state = { kind: "idle" };
          break;
        case "pair":
          if (state.pair.ids.includes(id)) endPair(state.pair, at);
          break;
      }
      if (fingers.size === 0) state = { kind: "idle" };
    },

    cancel(id: number) {
      if (!fingers.delete(id)) return;
      clearPending();
      if (state.kind === "pressing" && state.id === id) emit({ type: "cancel" });
      if (state.kind === "tracking" && state.id === id && state.held) emit({ type: "drop" });
      if (state.kind === "pair" && state.pair.ids.includes(id) && state.pair.zoom !== null) emit({ type: "settle" });
      state = fingers.size === 0 ? { kind: "idle" } : { kind: "spent" };
    },

    dispose() {
      clearPending();
      fingers.clear();
      state = { kind: "idle" };
    },
  };
}

export type DisplayTouch = ReturnType<typeof createDisplayTouch>;
