import { createContext, Fragment, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useKeyboardContext } from "react-native-keyboard-controller";
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { scheduleOnRN } from "react-native-worklets";
import { dismissToast, expireToast, pushToast, TOAST_DURATION_MS, type ToastEntry, type ToastTone } from "@/src/data/toast-queue";
import { haptics } from "@/src/platform/haptics";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { useTranslation } from "@/src/i18n";
import { motion } from "@/src/motion";
import { AppIcon, Mascot } from "@/src/ui";

type ShowToast = (toast: { title: string; message?: string; tone?: ToastTone }) => void;

type ToastLayerState = {
  toasts: ToastEntry[];
  /** The most recently mounted viewport draws the toasts; `null` leaves them to the root layer. */
  topViewport: string | null;
  registerViewport: (id: string) => () => void;
  dismiss: (key: string) => void;
  hold: (holding: boolean) => void;
  /** Keys whose entrance already played, so a toast moving to another viewport does not enter twice. */
  entered: Set<string>;
};

const ToastContext = createContext<ShowToast | null>(null);
const ToastLayerContext = createContext<ToastLayerState | null>(null);

/** Vertical offset per older toast; the stack should read as depth, not as a list. */
const STACK_OFFSET = 10;
/** Clears the tab bar or composer above the bottom inset, or above the keyboard while it is up. */
const BOTTOM_CLEARANCE = 84;
/** A toast released after being held stays at least this long, so it does not vanish as the finger lifts. */
const RELEASE_GRACE_MS = 1500;
const DISMISS_DISTANCE = 56;
const DISMISS_VELOCITY = 800;

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number };

/** Every toast runs its own time; a finger on the stack pauses all of them, and releasing gives back at least a grace period. */
class ToastClock {
  private readonly timers = new Map<string, Timer>();
  private held = false;

  constructor(private readonly onExpire: (key: string) => void) {}

  start(key: string, duration: number) {
    this.stop(key);
    const timer: Timer = { handle: null, remaining: duration, startedAt: 0 };
    this.timers.set(key, timer);
    if (!this.held) this.run(key, timer);
  }

  hold(holding: boolean) {
    if (this.held === holding) return;
    this.held = holding;
    for (const [key, timer] of this.timers) {
      if (holding) {
        if (!timer.handle) continue;
        clearTimeout(timer.handle);
        timer.handle = null;
        timer.remaining -= Date.now() - timer.startedAt;
      } else {
        timer.remaining = Math.max(timer.remaining, RELEASE_GRACE_MS);
        this.run(key, timer);
      }
    }
  }

  /** Drops the time of every toast no longer queued. */
  retain(entries: readonly ToastEntry[]) {
    for (const key of [...this.timers.keys()]) if (!entries.some((entry) => entry.key === key)) this.stop(key);
  }

  stopAll() {
    for (const key of [...this.timers.keys()]) this.stop(key);
  }

  private stop(key: string) {
    const timer = this.timers.get(key);
    if (timer?.handle) clearTimeout(timer.handle);
    this.timers.delete(key);
  }

  private run(key: string, timer: Timer) {
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => {
      this.timers.delete(key);
      this.onExpire(key);
    }, timer.remaining);
  }
}

/** Queue state lives outside React so timers and repeated calls read the current stack, not a render's snapshot. */
class ToastStore {
  entries: ToastEntry[] = [];
  /** Keys whose entrance already played, so a toast moving to another viewport does not enter twice. */
  readonly entered = new Set<string>();
  readonly clock = new ToastClock((key) => this.commit(expireToast(this.entries, key)));
  private counter = 0;

  constructor(private readonly publish: (entries: ToastEntry[]) => void) {}

  nextKey() {
    this.counter += 1;
    return `toast-${this.counter}`;
  }

  commit(next: ToastEntry[]) {
    this.entries = next;
    this.clock.retain(next);
    for (const key of [...this.entered]) if (!next.some((entry) => entry.key === key)) this.entered.delete(key);
    this.publish(next);
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [viewports, setViewports] = useState<string[]>([]);
  const [store] = useState(() => new ToastStore(setToasts));

  const show = useCallback<ShowToast>(({ title, message, tone = "neutral" }) => {
    // Titles are UI copy, not user content; the detail line may quote an error and is not logged.
    recordDebugEvent("ui.toast", { tone, label: title.slice(0, 80), hasMessage: Boolean(message) });
    const next = pushToast(store.entries, { key: store.nextKey(), title, message, tone, revision: 0 });
    store.commit(next);
    store.clock.start(next[0].key, TOAST_DURATION_MS[tone]);
    // A success or neutral toast confirms what the user just did and the control already answered; a failure is news.
    if (tone === "danger") haptics.failure();
    // The one announcement per toast; the card itself is not a live region, so moving it between viewports stays silent.
    AccessibilityInfo.announceForAccessibilityWithOptions(message ? `${title}. ${message}` : title, { queue: true });
  }, [store]);

  const dismiss = useCallback((key: string) => store.commit(dismissToast(store.entries, key)), [store]);
  const hold = useCallback((holding: boolean) => store.clock.hold(holding), [store]);

  useEffect(() => () => store.clock.stopAll(), [store]);

  const registerViewport = useCallback((id: string) => {
    setViewports((current) => [...current, id]);
    return () => setViewports((current) => current.filter((existing) => existing !== id));
  }, []);

  const topViewport = viewports.at(-1) ?? null;
  const layer = useMemo<ToastLayerState>(
    () => ({ toasts, topViewport, registerViewport, dismiss, hold, entered: store.entered }),
    [dismiss, hold, registerViewport, store, toasts, topViewport],
  );

  return (
    <ToastContext.Provider value={show}>
      <ToastLayerContext.Provider value={layer}>
        {children}
        {topViewport === null ? <ToastLayer /> : null}
      </ToastLayerContext.Provider>
    </ToastContext.Provider>
  );
}

function useToastLayer() {
  const layer = useContext(ToastLayerContext);
  if (!layer) throw new Error("ToastViewport must be used inside ToastProvider");
  return layer;
}

/**
 * Mount inside any React Native `Modal` so toasts raised while it is open stay visible. Only the most recently
 * mounted viewport draws; the root layer takes over when none is. iOS needs none: its root layer is a
 * full-window overlay (see `Overlay`), and one mounted inside a modal attaches before the modal presents.
 */
export function ToastViewport() {
  return Platform.OS === "ios" ? null : <AndroidToastViewport />;
}

function AndroidToastViewport() {
  const { registerViewport, topViewport } = useToastLayer();
  const id = useId();
  useEffect(() => registerViewport(id), [id, registerViewport]);
  return topViewport === id ? <ToastLayer /> : null;
}

/**
 * iOS: a full-window overlay is attached to the window when it mounts, so it sits above whatever is presented
 * at that moment, including native stack modals and SwiftUI sheets that have no viewport. Remounting it for
 * each new or refreshed front toast keeps that toast on top of anything presented since. VoiceOver must still
 * reach the screen beneath, so it is not an accessibility modal.
 */
function Overlay({ front, children }: { front: string; children: ReactNode }) {
  if (Platform.OS !== "ios") return <Fragment>{children}</Fragment>;
  return <FullWindowOverlay key={front} unstable_accessibilityContainerViewIsModal={false}>{children}</FullWindowOverlay>;
}

function ToastLayer() {
  const { toasts, dismiss, hold, entered } = useToastLayer();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardContext().reanimated;
  // The keyboard's height is negative while open; the layer rides it on the UI thread and returns as it closes.
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, keyboard.height.get() + insets.bottom) }] }), [insets.bottom]);
  if (toasts.length === 0) return null;
  // Oldest first so the newest toast is last in the tree and wins hit-testing.
  const ordered = toasts.slice().reverse();
  return (
    <Overlay front={`${toasts[0].key}:${toasts[0].revision}`}>
      <Reanimated.View pointerEvents="box-none" style={[styles.layer, { bottom: insets.bottom + BOTTOM_CLEARANCE }, liftStyle]}>
        {/* An Android modal has no gesture root of its own. This one is sized to the front card, so it never takes the modal's touches. */}
        <GestureHandlerRootView pointerEvents="box-none" style={styles.root}>
          {ordered.map((toast) => <ToastCard key={toast.key} toast={toast} depth={toasts.indexOf(toast)} entered={entered} onDismiss={dismiss} onHold={hold} />)}
        </GestureHandlerRootView>
      </Reanimated.View>
    </Overlay>
  );
}

const enterSpring = { duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System } as const;

type ToastCardProps = {
  toast: ToastEntry;
  depth: number;
  entered: Set<string>;
  onDismiss: (key: string) => void;
  onHold: (holding: boolean) => void;
};

function ToastCard({ toast, depth, entered, onDismiss, onHold }: ToastCardProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isFront = depth === 0;

  const [alreadyEntered] = useState(() => entered.has(toast.key));
  const enter = useSharedValue(alreadyEntered ? 1 : 0);
  const translateX = useSharedValue(0);
  const stackDepth = useSharedValue(depth);

  useEffect(() => {
    entered.add(toast.key);
    if (!alreadyEntered) enter.set(withSpring(1, enterSpring));
  }, [alreadyEntered, enter, entered, toast.key]);

  useEffect(() => {
    stackDepth.set(withSpring(depth, enterSpring));
  }, [depth, stackDepth]);

  const finishDismiss = useCallback(() => onDismiss(toast.key), [onDismiss, toast.key]);

  // A card can unmount mid-press (moved to another viewport) without its gesture finalizing.
  const pressed = useSharedValue(false);
  useEffect(() => () => { if (pressed.get()) onHold(false); }, [onHold, pressed]);

  useEffect(() => {
    if (!toast.expired) return;
    // Expiry fades in place: nothing pushed it, so nothing should throw it.
    enter.set(withTiming(0, { duration: motion.settle.duration, reduceMotion: ReduceMotion.System }, (finished) => {
      if (finished) scheduleOnRN(finishDismiss);
    }));
  }, [enter, finishDismiss, toast.expired]);

  const onPanUpdate = (translationX: number) => {
    "worklet";
    translateX.set(translationX);
  };

  const onPanEnd = (translationX: number, velocityX: number) => {
    "worklet";
    const flung = Math.abs(velocityX) > DISMISS_VELOCITY;
    const farEnough = Math.abs(translationX) > DISMISS_DISTANCE;
    if (!flung && !farEnough) {
      translateX.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: velocityX, reduceMotion: ReduceMotion.System }));
      return;
    }
    const direction = translationX < 0 || (translationX === 0 && velocityX < 0) ? -1 : 1;
    const exit = { duration: 300, dampingRatio: 1, velocity: velocityX, overshootClamping: true, reduceMotion: ReduceMotion.System };
    translateX.set(withSpring(direction * width, exit, (finished) => {
      if (finished) scheduleOnRN(finishDismiss);
    }));
  };

  // A finger resting on the toast pauses every toast's time, so the one being read cannot slip away.
  const pan = useMemo(
    () => Gesture.Pan().enabled(isFront).activeOffsetX([-10, 10]).failOffsetY([-12, 12])
      .onBegin(() => { pressed.set(true); scheduleOnRN(onHold, true); })
      .onUpdate((event) => onPanUpdate(event.translationX))
      .onEnd((event) => onPanEnd(event.translationX, event.velocityX))
      .onFinalize(() => { pressed.set(false); scheduleOnRN(onHold, false); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worklet callbacks close over stable shared values
    [isFront, finishDismiss, onHold, width],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const d = stackDepth.get();
    const e = enter.get();
    return {
      opacity: e * (1 - d * 0.35),
      transform: [{ translateY: (1 - e) * 16 - d * STACK_OFFSET }, { translateX: translateX.get() }, { scale: (0.96 + 0.04 * e) * (1 - d * 0.04) }],
    };
  });

  const danger = toast.tone === "danger";
  const label = toast.message ? `${toast.title}. ${toast.message}` : toast.title;
  // The front card is in flow and sizes the layer, so the gesture root only covers what can be touched.
  const placement = isFront ? "" : "absolute bottom-0 left-0 right-0";

  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View accessible accessibilityLabel={label} accessibilityHint={isFront ? t("toast.swipeHint") : undefined} pointerEvents={isFront ? "auto" : "none"} className={`${placement} flex-row items-center gap-3 rounded-md bg-surface-float px-4 py-3 shadow-float ${danger ? "border border-danger" : ""}`} style={[{ zIndex: 10 - depth, borderCurve: "continuous" }, animatedStyle]}>
        {danger ? <Mascot size={20} mood="worried" /> : <AppIcon name={toast.tone === "success" ? "check" : "info"} size={16} tone={toast.tone === "success" ? "success" : "secondary"} />}
        <View className="min-w-0 flex-1 gap-px">
          <Text numberOfLines={1} className="text-body font-semibold text-fg">{toast.title}</Text>
          {toast.message ? <Text numberOfLines={2} className="text-caption text-fg-secondary">{toast.message}</Text> : null}
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 12, right: 12, zIndex: 90 },
  root: { flex: 0 },
});
