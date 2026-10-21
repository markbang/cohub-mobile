import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { popoverFromScale, springs } from "@/src/motion";

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
 * A menu or popover surface that grows out of its anchor on mount, as iOS menus do. Closing stays
 * instant: the surface unmounts with its owner, so nothing waits on an exit animation.
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

  return <Animated.View {...viewProps} className={className} style={[style, { transformOrigin: origin }, revealStyle]}>{children}</Animated.View>;
}
