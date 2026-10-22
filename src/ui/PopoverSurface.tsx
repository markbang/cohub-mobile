import { useEffect, useMemo, type ReactNode } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { motion, popoverExitScale, popoverFromScale, springs } from "@/src/motion";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Where the surface grows from, as `transformOrigin` [x, y, z]; point it at the control or touch that opened it. */
export type PopoverOrigin = [x: number | `${number}%`, y: number | `${number}%`, z: number];

type PopoverSurfaceProps = Omit<ViewProps, "style"> & {
  origin: PopoverOrigin;
  /** Scale it grows from; a surface that reappears while typing grows from nearer 1 so it does not pulse. */
  fromScale?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * A menu or popover surface that grows out of its anchor on mount, as iOS menus do. It unmounts with its
 * owner immediately; the exit is a native layout animation, so React state never waits on it.
 */
export function PopoverSurface({ origin, fromScale = popoverFromScale, className, style, children, ...viewProps }: PopoverSurfaceProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withSpring(1, springs.popover));
  }, [progress]);

  const revealStyle = useAnimatedStyle(() => ({
    // The fade finishes early so the content is readable while the spring settles its size.
    opacity: interpolate(progress.get(), [0, 0.5], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: fromScale + (1 - fromScale) * progress.get() }],
  }));

  const exiting = useMemo<EntryExitAnimationFunction>(() => () => {
    "worklet";
    // Start from wherever the entrance is, so closing mid-spring does not jump to full size first.
    const shown = progress.get();
    const config = { duration: motion.fadeOut.duration, easing: EASE_OUT };
    return {
      initialValues: {
        opacity: interpolate(shown, [0, 0.5], [0, 1], Extrapolation.CLAMP),
        transform: [{ scale: fromScale + (1 - fromScale) * shown }],
      },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scale: withTiming(Math.min(popoverExitScale, fromScale + (1 - fromScale) * shown), config) }],
      },
    };
  }, [fromScale, progress]);

  return <Animated.View {...viewProps} exiting={exiting} className={className} style={[style, { transformOrigin: origin }, revealStyle]}>{children}</Animated.View>;
}
