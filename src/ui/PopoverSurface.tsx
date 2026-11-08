import { useEffect, useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { RADIUS } from "@/src/design/tokens";
import { curves, popover } from "@/src/motion";
import { GlassBackground } from "@/src/ui/Glass";

const EASE_OUT = Easing.bezier(...curves.easeOut);

/** Where the surface grows from, as `transformOrigin` [x, y, z]; point it at the control or touch that opened it. */
export type PopoverOrigin = [x: number | `${number}%`, y: number | `${number}%`, z: number];

type PopoverSurfaceProps = Omit<ViewProps, "style"> & {
  origin: PopoverOrigin;
  /** Uniform scale to grow from instead of unfolding; a surface that reappears while typing stays near 1 so it does not pulse. */
  fromScale?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** The composer's typing menus (slash commands, mentions): a sheet, solid and bordered on iOS, glass on Android. */
  panel?: boolean;
  children: ReactNode;
};

/**
 * A menu or popover surface that unfolds out of its anchor on mount. It unmounts with its owner immediately;
 * the exit is a native layout animation, so React state never waits on it.
 */
export function PopoverSurface({ origin, fromScale, className, style, panel = false, children, ...viewProps }: PopoverSurfaceProps) {
  const fromX = fromScale ?? popover.from.x;
  const fromY = fromScale ?? popover.from.y;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withTiming(1, { duration: popover.open.duration, easing: EASE_OUT }));
  }, [progress]);

  const revealStyle = useAnimatedStyle(() => ({
    // The fade finishes early so the content is readable while the panel finishes unfolding.
    opacity: interpolate(progress.get(), [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scaleX: fromX + (1 - fromX) * progress.get() },
      { scaleY: fromY + (1 - fromY) * progress.get() },
    ],
  }));

  const exiting = useMemo<EntryExitAnimationFunction>(() => () => {
    "worklet";
    // Start from wherever the entrance is, so closing mid-open does not jump to full size first.
    const shown = progress.get();
    const scaleX = fromX + (1 - fromX) * shown;
    const scaleY = fromY + (1 - fromY) * shown;
    const config = { duration: popover.close.duration, easing: EASE_OUT };
    return {
      initialValues: {
        opacity: interpolate(shown, [0, 0.6], [0, 1], Extrapolation.CLAMP),
        transform: [{ scaleX }, { scaleY }],
      },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scaleX: withTiming(Math.min(scaleX, fromX), config) }, { scaleY: withTiming(Math.min(scaleY, fromY), config) }],
      },
    };
  }, [fromX, fromY, progress]);

  const glass = panel && Platform.OS === "android";
  const panelClass = !panel ? "" : glass ? "overflow-hidden rounded-lg shadow-glass" : "overflow-hidden rounded-lg border-border bg-surface shadow-float";
  return <Animated.View {...viewProps} exiting={exiting} className={`${panelClass} ${className ?? ""}`} style={[panel ? glass ? PANEL_SHAPE : BORDERED_PANEL : null, style, { transformOrigin: origin }, revealStyle]}>
    {glass ? <GlassBackground radius={RADIUS.lg} surface="glassMenu" /> : null}
    {children}
  </Animated.View>;
}

const PANEL_SHAPE = { borderCurve: "continuous" } as const;
const BORDERED_PANEL = { borderWidth: StyleSheet.hairlineWidth, borderCurve: "continuous" } as const;
