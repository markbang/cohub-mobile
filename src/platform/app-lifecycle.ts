import { AppState } from "react-native";
import { createForegroundGate } from "@/src/data/foreground-handoff";

/** The handoff's result usually resolves before the matching `active` report; this waits for it. */
const HANDOFF_SETTLE_MS = 1_000;

const gate = createForegroundGate();
const listeners = new Set<(active: boolean) => void>();
let observing = false;

function apply(rawActive: boolean) {
  for (const active of gate.next(rawActive)) {
    for (const listener of [...listeners]) listener(active);
  }
}

/**
 * Whether the app is in front for live work: realtime, polling, and foreground refreshes. Unlike
 * `AppState`, a picker or share sheet the app opened does not count as leaving.
 */
export function isAppActive() {
  observe();
  return gate.active();
}

/** One app-lifetime subscription, so the gate never misses a transition between subscribers. */
function observe() {
  if (observing) return;
  observing = true;
  // A launch straight into the background (a notification or background fetch) starts inactive.
  if (AppState.currentState === "background") apply(false);
  AppState.addEventListener("change", (state) => apply(state === "active"));
}

export function subscribeAppActive(listener: (active: boolean) => void): () => void {
  observe();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Runs `task` (a picker, camera, share sheet, or browser) as a foreground handoff. */
export async function withForegroundHandoff<T>(task: () => Promise<T>): Promise<T> {
  observe();
  const end = gate.begin();
  try {
    return await task();
  } finally {
    end();
    // A user who left for the home screen from inside the picker is really in the background.
    if (gate.holding()) setTimeout(() => apply(AppState.currentState === "active"), HANDOFF_SETTLE_MS);
  }
}
