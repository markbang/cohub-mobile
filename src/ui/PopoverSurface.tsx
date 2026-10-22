import { useEffect, useMemo, type ReactNode } from "react";
import { Platform, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming, type EntryExitAnimationFunction } from "react-native-reanimated";
import { popover } from "@/src/motion";

const OPEN_EASING = Easing.bezier(0.23, 1, 0.32, 1);
const CLOSE_EASING = Easing.out(Easing.quad);
const CLOSE_BLUR = Platform.OS === "android";

/** Where the surface grows from, as `transformOrigin` [x, y, z]; point it at the control or touch that opened it. */
export type PopoverOrigin = [x: number | `${number}%`, y: number | `${number}%`, z: number];

type PopoverSurfaceProps = Omit<ViewProps, "style"> & {
  origin: PopoverOrigin;
  /** Uniform scale to grow from instead of unfolding; a surface that reappears while typing stays near 1 so it does not pulse. */
  fromScale?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * A menu or popover surface that unfolds out of its anchor on mount. It unmounts with its owner immediately;
 * the exit is a native layout animation, so React state never waits on it.
 */
export function PopoverSurface({ origin, fromScale, className, style, children, ...viewProps }: PopoverSurfaceProps) {
  const fromX = fromScale ?? popover.from.x;
  const fromY = fromScale ?? popover.from.y;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withTiming(1, { duration: popover.open.duration, easing: OPEN_EASING }));
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
    const config = { duration: popover.close.duration, easing: CLOSE_EASING };
    return {
      initialValues: {
        opacity: interpolate(shown, [0, 0.6], [0, 1], Extrapolation.CLAMP),
        transform: [{ scaleX }, { scaleY }],
        ...(CLOSE_BLUR ? { filter: [{ blur: 0 }] } : {}),
      },
      animations: {
        opacity: withTiming(0, config),
        transform: [{ scaleX: withTiming(Math.min(scaleX, fromX), config) }, { scaleY: withTiming(Math.min(scaleY, fromX), config) }],
        ...(CLOSE_BLUR ? { filter: [{ blur: withTiming(popover.closeBlur, config) }] } : {}),
      },
    };
  }, [fromX, fromY, progress]);

  return <Animated.View {...viewProps} exiting={exiting} className={className} style={[style, { transformOrigin: origin }, revealStyle]}>{children}</Animated.View>;
}
