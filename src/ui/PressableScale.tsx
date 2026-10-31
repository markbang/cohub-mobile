import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableAndroidRippleConfig, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { haptics } from "@/src/platform/haptics";
import { press, springs } from "@/src/motion";

type PressableScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "tab" | "menuitem" | "header";
  accessibilityState?: Record<string, unknown>;
  testID?: string;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  style?: StyleProp<ViewStyle>;
  /** Layout and token classes for the inner content view; `style` still merges after it. */
  className?: string;
  /** Extra style applied only while pressed (e.g. background tint). */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Set false to skip the scale animation (icon buttons etc). */
  scale?: boolean;
  /** Fire a light haptic on press (native platforms with haptics support). */
  haptic?: boolean;
  androidRipple?: PressableAndroidRippleConfig;
};

/**
 * Pressable with a subtle native-feeling settle: scale down while pressed,
 * spring back on release, optional light haptic. Replaces ripple feedback.
 */
export function PressableScale({
  children,
  onPress,
  onPressIn,
  onLongPress,
  disabled = false,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  testID,
  hitSlop,
  style,
  className,
  pressedStyle,
  scale = true,
  haptic = false,
  androidRipple,
}: PressableScaleProps) {
  const progress = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: progress.get() }] }));
  // Parent-layout flex has to live on the outer wrapper. Child layout
  // (flexDirection, padding, gap) stays on the inner view so rows keep their direction.
  const flex = StyleSheet.flatten(style)?.flex;
  const fill = flex == null ? null : { flex: 1, minWidth: 0 as const };

  // A spring picks up from wherever an interrupted press left the scale, so quick re-taps never jump.
  const settle = (toValue: number) => progress.set(withSpring(toValue, toValue === 1 ? springs.pressOut : springs.pressIn));

  return (
    <Animated.View style={[flex == null ? null : { flex, minWidth: 0 }, scaleStyle]}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        testID={testID}
        hitSlop={hitSlop}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        android_ripple={androidRipple}
        style={fill ?? undefined}
        onPressIn={() => {
          onPressIn?.();
          if (scale) settle(press.scale);
          if (haptic) haptics.commit();
        }}
        onPressOut={() => {
          if (scale) settle(1);
        }}
      >
        {({ pressed }) => (
          <View className={className} style={[style, fill, pressed ? pressedStyle : null, pressed && !scale ? { opacity: 0.72 } : null]}>
            {children}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
