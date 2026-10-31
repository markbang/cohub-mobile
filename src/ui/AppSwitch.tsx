import { useEffect } from "react";
import { Platform, Pressable, Switch, type SwitchProps } from "react-native";
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { haptics } from "@/src/platform/haptics";
import { useAppTheme } from "@/src/theme";

type AppSwitchProps = Pick<SwitchProps, "value" | "onValueChange" | "disabled" | "accessibilityLabel" | "testID">;

const TRACK = { width: 51, height: 31 } as const;
const THUMB = 27;
const TRAVEL = TRACK.width - THUMB - 4;
const SPRING = { duration: 320, dampingRatio: 0.8 } as const;
// design-system: the thumb is white in every theme, as the system switch's is.
const THUMB_STYLE = { width: THUMB, height: THUMB, backgroundColor: "#ffffff" } as const;

/** iOS keeps the system switch with the accent track; Android draws the same control instead of Material's. */
export function AppSwitch({ value = false, onValueChange, disabled = false, accessibilityLabel, testID }: AppSwitchProps) {
  const { colors } = useAppTheme();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => { progress.set(withSpring(value ? 1 : 0, SPRING)); }, [progress, value]);
  const off = colors.borderStrong;
  const on = colors.accent;
  const trackStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.get(), [0, 1], [off, on]) }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.get() * TRAVEL }] }));
  if (Platform.OS === "ios") return <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} testID={testID} trackColor={{ true: colors.accent }} />;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
      disabled={disabled}
      hitSlop={8}
      onPress={() => { haptics.selection(); onValueChange?.(!value); }}
      className="disabled:opacity-45"
    >
      {/* design-system: the track color is interpolated on the UI thread, so it is a Reanimated style. */}
      <Reanimated.View className="justify-center rounded-full px-0.5" style={[TRACK, trackStyle]}>
        {/* design-system: the thumb is white in every theme, as the system switch's is. */}
        <Reanimated.View className="rounded-full shadow-float" style={[THUMB_STYLE, thumbStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}
