import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { Easing, Extrapolation, ReduceMotion, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { RADIUS } from "@/src/design/tokens";
import { menuMorph, motion } from "@/src/motion";
import { GlassBackground, useGlassMaterial } from "@/src/ui/Glass";

const CLOSE_EASING = Easing.bezier(...menuMorph.close.curve);
/** iOS 26's menu corner, measured; the composer's panel keeps the sheet radius. */
const GLASS_MENU_RADIUS = 32;

export type MorphRect = { x: number; y: number; width: number; height: number };

type MorphMenuSurfaceProps = Omit<ViewProps, "style" | "children"> & {
  /** The control that opened the menu, in the coordinates of the surface's parent. */
  anchor: MorphRect;
  /** Turning false shrinks the menu back into `anchor`; `onClosed` fires once it is there. */
  open: boolean;
  onClosed: () => void;
  /** Places the settled panel in its parent; the surface is absolutely positioned. */
  style: StyleProp<ViewStyle>;
  /** `glass`: a floating menu; `panel`: the composer's solid, bordered sheet. */
  material?: "glass" | "panel";
  children: ReactNode;
};

/**
 * A menu panel that takes the place of its trigger: it grows out of the trigger's bounds and collapses back
 * into them, while the owner hides the trigger for as long as the menu is open. The backdrop is a
 * childless absolute layer, so animating its frame re-lays out nothing else; the rows keep their final
 * layout and only fade and scale, so hit-testing matches what is drawn once the menu settles.
 */
export function MorphMenuSurface({ anchor, open, onClosed, style, material = "glass", children, ...viewProps }: MorphMenuSurfaceProps) {
  const glass = useGlassMaterial();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const opening = useSharedValue(open);
  const [box, setBox] = useState<MorphRect | null>(null);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);

  const measured = box !== null;
  useEffect(() => {
    // Closed before it was ever laid out: there is nothing on screen to shrink.
    if (!measured) { if (!open) onClosedRef.current(); return; }
    const target = open ? 1 : 0;
    const finishClose = () => onClosedRef.current();
    const done = (finished?: boolean) => {
      "worklet";
      if (finished && target === 0) scheduleOnRN(finishClose);
    };
    opening.set(open);
    progress.set(reduced
      ? withTiming(target, { duration: open ? motion.fade.duration : motion.fadeOut.duration, reduceMotion: ReduceMotion.Never }, done)
      : open ? withSpring(target, menuMorph.open, done) : withTiming(target, { duration: menuMorph.close.duration, easing: CLOSE_EASING }, done));
  }, [measured, open, opening, progress, reduced]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setBox((current) => current && current.x === x && current.y === y && current.width === width && current.height === height ? current : { x, y, width, height });
  };

  const radius = material === "panel" ? RADIUS.lg : GLASS_MENU_RADIUS;
  const from = { x: anchor.x - (box?.x ?? 0), y: anchor.y - (box?.y ?? 0), width: anchor.width, height: anchor.height };
  const fromRadius = Math.min(anchor.width, anchor.height) / 2;

  const backdropStyle = useAnimatedStyle(() => {
    if (!box) return { opacity: 0 };
    const p = progress.get();
    // Reduce Motion keeps the panel in place and only crossfades it.
    const g = reduced ? 1 : p;
    return {
      // The trigger hides as the menu opens, so the panel stands in for it almost at once.
      opacity: reduced ? p : interpolate(p, [0, 0.06], [0, 1], Extrapolation.CLAMP),
      left: from.x * (1 - g),
      top: from.y * (1 - g),
      width: Math.max(0, from.width + (box.width - from.width) * g),
      height: Math.max(0, from.height + (box.height - from.height) * g),
      borderRadius: Math.max(0, fromRadius + (radius - fromRadius) * g),
    };
  });

  // The rows ride the panel's frame, scaled with it from its corner, as UIKit's do; they come in over the open
  // and are gone within the close's first 50 ms.
  const contentStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (reduced || !box) return { opacity: p };
    const opacity = interpolate(p, opening.get() ? [0.3, 0.9] : [0.7, 0.97], [0, 1], Extrapolation.CLAMP);
    const width = from.width + (box.width - from.width) * p;
    const height = from.height + (box.height - from.height) * p;
    return { opacity, transform: [{ translateX: from.x * (1 - p) }, { translateY: from.y * (1 - p) }, { scaleX: width / box.width }, { scaleY: height / box.height }] };
  });

  return <View {...viewProps} pointerEvents={open ? "auto" : "none"} onLayout={onLayout} style={[{ position: "absolute" }, style]}>
    {material === "panel"
      ? <Animated.View pointerEvents="none" className="border-border bg-surface shadow-float" style={[styles.backdrop, { borderWidth: StyleSheet.hairlineWidth }, backdropStyle]} />
      : <Animated.View pointerEvents="none" className={glass === "liquid" ? undefined : "shadow-glass"} style={[styles.backdrop, backdropStyle]}>
        <GlassBackground radius={radius} solidClassName="bg-glass-menu" rim />
      </Animated.View>}
    <Animated.View style={[styles.content, CONTENT_ORIGIN, { borderRadius: radius }, contentStyle]}>
      {children}
    </Animated.View>
  </View>;
}

const CONTENT_ORIGIN = { transformOrigin: "left top" } as const;

const styles = StyleSheet.create({
  backdrop: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
  content: { flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden", borderCurve: "continuous" },
});

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
