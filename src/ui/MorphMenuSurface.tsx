import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { RADIUS } from "@/src/design/tokens";
import { menuMorph, motion } from "@/src/motion";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";
import { CLOSE_FRAMES, MORPH_FRAME_MS, OPEN_FRAMES, morphShape, resumeFrame, type MorphRect } from "@/src/ui/menu-morph";

export type { MorphRect } from "@/src/ui/menu-morph";

/** iOS 27's menu corner, measured; the composer's panel keeps the sheet radius. */
const GLASS_MENU_RADIUS = menuMorph.radius;
const LINEAR = Easing.linear;

type MorphMenuSurfaceProps = Omit<ViewProps, "style" | "children"> & {
  /** The control that opened the menu, in the coordinates of the surface's parent. */
  anchor: MorphRect;
  /** Turning false shrinks the menu back into `anchor`; `onClosed` fires once it is there. */
  open: boolean;
  onClosed: () => void;
  /** Places the settled panel in its parent; the surface is absolutely positioned. */
  style: StyleProp<ViewStyle>;
  /** `glass`: a floating menu; `panel`: the composer's larger sheet, solid and bordered on iOS, glass on Android. */
  material?: "glass" | "panel";
  children: ReactNode;
};

/**
 * A menu panel that takes the place of its trigger, morphing as iOS 27's does (`menu-morph.ts`): the
 * trigger drops as a ball and swells into the menu, and on close the menu fades into a ball that runs back
 * into the trigger. The owner hides the trigger through `MenuAnchor`. The backdrop is a childless
 * absolute layer, so animating its frame re-lays out nothing else; the rows keep their final layout and are
 * only moved, zoomed and clipped by transforms, so hit-testing matches what is drawn once the menu settles.
 */
export function MorphMenuSurface({ anchor, open, onClosed, style, material = "glass", children, ...viewProps }: MorphMenuSurfaceProps) {
  const glass = useGlassMaterial();
  const reduced = useReducedMotion();
  // Frames into the current morph (a 0–1 fade under Reduce Motion), and which way it runs.
  const frame = useSharedValue(0);
  const opening = useSharedValue(true);
  const started = useRef(false);
  const [box, setBox] = useState<MorphRect | null>(null);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);

  const measured = box !== null;
  useEffect(() => {
    // Closed before it was ever laid out: there is nothing on screen to shrink.
    if (!measured) { if (!open) onClosedRef.current(); return; }
    const finishClose = () => onClosedRef.current();
    const done = (finished?: boolean) => {
      "worklet";
      if (finished && !open) scheduleOnRN(finishClose);
    };
    if (reduced) {
      opening.set(open);
      frame.set(withTiming(open ? 1 : 0, { duration: open ? motion.fade.duration : motion.fadeOut.duration, reduceMotion: ReduceMotion.Never }, done));
      return;
    }
    const at = frame.get();
    const wasOpening = opening.get();
    // Turned around part-way, it picks up the other way where the shape is as tall.
    const from = !started.current ? 0 : wasOpening === open ? at : resumeFrame(open, at, wasOpening);
    started.current = true;
    const end = open ? OPEN_FRAMES : CLOSE_FRAMES;
    opening.set(open);
    frame.set(from);
    frame.set(withTiming(end, { duration: Math.max(0, end - from) * MORPH_FRAME_MS, easing: LINEAR, reduceMotion: ReduceMotion.Never }, done));
  }, [frame, measured, open, opening, reduced]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setBox((current) => current && current.x === x && current.y === y && current.width === width && current.height === height ? current : { x, y, width, height });
  };

  const radius = material === "panel" ? RADIUS.lg : GLASS_MENU_RADIUS;
  const from = { x: anchor.x - (box?.x ?? 0), y: anchor.y - (box?.y ?? 0), width: anchor.width, height: anchor.height };

  const backdropStyle = useAnimatedStyle(() => {
    if (!box) return { opacity: 0 };
    const f = frame.get();
    // Reduce Motion keeps the panel in place and only crossfades it.
    if (reduced) return { opacity: f, left: 0, top: 0, width: box.width, height: box.height, borderRadius: radius };
    const shape = morphShape(opening.get(), f, from, box, radius);
    return { opacity: shape.glass, left: shape.x, top: shape.y, width: shape.width, height: shape.height, borderRadius: shape.corner };
  });

  // The clip follows the glass by transform alone; the rows inside are scaled back out of it and then zoomed
  // and shifted about the menu's centre, so their text never squashes.
  const clipStyle = useAnimatedStyle(() => {
    const f = frame.get();
    if (!box || reduced) return { opacity: box ? f : 0, borderRadius: radius, transform: IDENTITY };
    const shape = morphShape(opening.get(), f, from, box, radius);
    const sx = Math.max(0.01, shape.width / box.width);
    const sy = Math.max(0.01, shape.height / box.height);
    return {
      opacity: shape.rows,
      // Scaled unevenly, the corner turns elliptical; this keeps it inside the glass's corner.
      borderRadius: shape.corner / Math.max(sx, sy),
      transform: [{ translateX: shape.x }, { translateY: shape.y }, { scaleX: sx }, { scaleY: sy }],
    };
  });
  const rowsStyle = useAnimatedStyle(() => {
    const f = frame.get();
    if (!box || reduced) return { transform: IDENTITY };
    const shape = morphShape(opening.get(), f, from, box, radius);
    const sx = Math.max(0.01, shape.width / box.width);
    const sy = Math.max(0.01, shape.height / box.height);
    const cx = box.width / 2;
    const cy = box.height / 2;
    return { transform: [
      { translateX: (cx * (1 - shape.zoom) - shape.x) / sx },
      { translateY: (cy * (1 - shape.zoom) + shape.shift - shape.y) / sy },
      { scaleX: shape.zoom / sx },
      { scaleY: shape.zoom / sy },
    ] };
  });

  return <View {...viewProps} pointerEvents={open ? "auto" : "none"} onLayout={onLayout} style={[{ position: "absolute" }, style]}>
    {material === "panel" && Platform.OS === "ios"
      ? <Animated.View pointerEvents="none" className="border-border bg-surface shadow-float" style={[styles.backdrop, { borderWidth: StyleSheet.hairlineWidth }, backdropStyle]} />
      : <Animated.View pointerEvents="none" className={glass === "liquid" ? undefined : "shadow-glass"} style={[styles.backdrop, backdropStyle]}>
        <GlassBackground radius={radius} surface="glassMenu" />
      </Animated.View>}
    <Animated.View style={[styles.content, CONTENT_ORIGIN, clipStyle]}>
      <Animated.View style={[styles.rows, CONTENT_ORIGIN, rowsStyle]}>
        {children}
      </Animated.View>
    </Animated.View>
  </View>;
}

const IDENTITY = [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }];
const CONTENT_ORIGIN = { transformOrigin: "left top" } as const;

const styles = StyleSheet.create({
  backdrop: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
  content: { flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden", borderCurve: "continuous" },
  rows: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
});

type MenuAnchorProps = ViewProps & { open: boolean; ref?: Ref<View> };

/**
 * Wraps the control a menu grows out of: hidden while its menu is open and, as iOS 27's is, faded back in only
 * once the menu has run back into it.
 */
export function MenuAnchor({ open, style, ref, ...props }: MenuAnchorProps) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    if (open) { shown.set(0); return; }
    shown.set(withDelay(reduced ? motion.fadeOut.duration : menuMorph.reveal.delay, withTiming(1, { duration: menuMorph.reveal.duration })));
  }, [open, reduced, shown]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return <Animated.View ref={ref} collapsable={false} {...props} style={[style, animatedStyle]} />;
}

type Presence = { open: boolean; onExited: () => void };
const PresenceContext = createContext<Presence>({ open: true, onExited: () => undefined });

/**
 * Keeps a menu mounted after its owner closes it, until the menu has shrunk back into its control.
 * The menu reads the state through `useMenuPresence`; outside a presence it is simply open.
 */
export function MenuPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const value = useMemo(() => ({ open, onExited: () => setMounted(false) }), [open]);
  return mounted ? <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider> : null;
}

export function useMenuPresence() {
  return useContext(PresenceContext);
}
