import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { setChatEntryDiagnostics } from "@/src/data/chat-entry-trace";
import { record } from "@/src/data/debug-session";

const STORAGE_KEY = "debug.frameProbe";
// Hitches are summed per window so a sustained stutter cannot flood the bounded diagnostics log.
const WINDOW_MS = 1_000;
// Over 1.5 frames at 60 Hz, so it reads the same on 60 and 120 Hz screens.
const SLOW_FRAME_MS = 25;
const JS_TICK_MS = 100;
const JS_STALL_MS = 50;

let enabled = false;
const listeners = new Set<() => void>();

function emit(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  setChatEntryDiagnostics(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useFrameProbeEnabled() {
  return useSyncExternalStore(subscribe, () => enabled);
}

export function setFrameProbeEnabled(next: boolean) {
  emit(next);
  record("perf.probe", { enabled: next });
  void AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0").catch(() => undefined);
}

function reportUiJank(frames: number, slow: number, worstMs: number, sentAt: number) {
  // The report crosses to the JS thread, so a late arrival is itself a JS stall at that moment.
  record("perf.ui_jank", { frames, slow, worstMs: Math.round(worstMs), arrivedLateMs: Date.now() - sentAt });
}

/**
 * Records UI-thread frame hitches and JS event-loop stalls into the diagnostics log while enabled
 * from the debug menu, on the same clock as touches, scrolls and navigation, so a feedback report
 * shows which thread stalled during which interaction. Paused in the background, where frames stop.
 */
export function useFrameProbe() {
  const probing = useFrameProbeEnabled();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const active = probing && foreground;

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY).then((value) => { if (!cancelled && value === "1") emit(true); }).catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const windowStart = useSharedValue(0);
  const frames = useSharedValue(0);
  const slow = useSharedValue(0);
  const worst = useSharedValue(0);
  const frameCallback = useFrameCallback((frame) => {
    const interval = frame.timeSincePreviousFrame;
    if (interval !== null) {
      frames.set(frames.get() + 1);
      if (interval > SLOW_FRAME_MS) {
        slow.set(slow.get() + 1);
        if (interval > worst.get()) worst.set(interval);
      }
      if (frame.timestamp - windowStart.get() < WINDOW_MS) return;
      if (slow.get() > 0) scheduleOnRN(reportUiJank, frames.get(), slow.get(), worst.get(), Date.now());
    }
    windowStart.set(frame.timestamp);
    frames.set(0);
    slow.set(0);
    worst.set(0);
  }, false);

  useEffect(() => {
    frameCallback.setActive(active);
  }, [active, frameCallback]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let windowStartAt = Date.now();
    let stalls = 0;
    let worstMs = 0;
    let totalMs = 0;
    let expected = Date.now() + JS_TICK_MS;
    const tick = () => {
      const now = Date.now();
      const lag = now - expected;
      if (lag > JS_STALL_MS) {
        stalls += 1;
        totalMs += lag;
        worstMs = Math.max(worstMs, lag);
      }
      if (now - windowStartAt >= WINDOW_MS) {
        if (stalls > 0) record("perf.js_stall", { stalls, worstMs, totalMs, windowMs: now - windowStartAt });
        windowStartAt = now;
        stalls = 0;
        worstMs = 0;
        totalMs = 0;
      }
      expected = now + JS_TICK_MS;
      timer = setTimeout(tick, JS_TICK_MS);
    };
    timer = setTimeout(tick, JS_TICK_MS);
    return () => { if (timer !== null) clearTimeout(timer); };
  }, [active]);
}
