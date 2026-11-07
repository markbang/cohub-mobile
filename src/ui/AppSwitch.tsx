import { useEffect, useRef } from "react";
import { Platform, Pressable, Switch, type SwitchProps } from "react-native";
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import { haptics } from "@/src/platform/haptics";
import { useAppTheme } from "@/src/theme";

type AppSwitchProps = Pick<SwitchProps, "value" | "onValueChange" | "disabled" | "accessibilityLabel" | "testID">;

// The iOS 26 switch, measured: a 63 × 28 track holding a 37 × 24 capsule thumb inset by 2.
const TRACK = { width: 63, height: 28 } as const;
const THUMB = { width: 37, height: 24 } as const;
const TRAVEL = TRACK.width - THUMB.width - 4;
// iOS 27's switch, fitted by liquidglass: the thumb travels on a stiff, overdamped spring and, under a finger,
// swells into a 59 × 38 lens that a quick tap keeps up for 300 ms.
const SPRING = { mass: 1, stiffness: 1000, damping: 80 } as const;
const LIFT_SPRING = { mass: 1, stiffness: 2000, damping: 80 } as const;
const LENS = { x: 59 / THUMB.width, y: 38 / THUMB.height } as const;
const LENS_MIN_MS = 300;
// design-system: the thumb is white in every theme, as the system switch's is.
const THUMB_STYLE = { ...THUMB, backgroundColor: "#ffffff" } as const;

/** iOS keeps the system switch with the accent track; Android draws the same control instead of Material's. */
export function AppSwitch({ value = false, onValueChange, disabled = false, accessibilityLabel, testID }: AppSwitchProps) {
  const { colors } = useAppTheme();
  const progress = useSharedValue(value ? 1 : 0);
  const lift = useSharedValue(0);
  const pressedAt = useRef(0);
  useEffect(() => { progress.set(withSpring(value ? 1 : 0, SPRING)); }, [progress, value]);
  const off = colors.switchOff;
  const on = colors.accent;
  const trackStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.get(), [0, 1], [off, on]) }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.get() * TRAVEL }, { scaleX: 1 + (LENS.x - 1) * lift.get() }, { scaleY: 1 + (LENS.y - 1) * lift.get() }] }));
  if (Platform.OS === "ios") return <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} testID={testID} trackColor={{ true: colors.accent }} />;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
      disabled={disabled}
      // Dimmed as one layer, as UISwitch is, so the thumb stays opaque over the track.
      needsOffscreenAlphaCompositing={disabled}
      hitSlop={8}
      onPressIn={() => { pressedAt.current = Date.now(); lift.set(withSpring(1, LIFT_SPRING)); }}
      onPressOut={() => { lift.set(withDelay(Math.max(0, LENS_MIN_MS - (Date.now() - pressedAt.current)), withSpring(0, LIFT_SPRING))); }}
      onPress={() => { haptics.selection(); onValueChange?.(!value); }}
      className="disabled:opacity-50"
    >
      {/* design-system: the track color is interpolated on the UI thread, so it is a Reanimated style. */}
      <Reanimated.View className="justify-center rounded-full px-0.5" style={[TRACK, trackStyle]}>
        {/* design-system: the thumb is white in every theme, as the system switch's is. */}
        <Reanimated.View className="rounded-full" style={[THUMB_STYLE, thumbStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}
