import type { LucideIcon } from "lucide-react-native";
import { useEffect } from "react";
import type { ColorValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { icons, type IconName } from "@/src/icons";
import { motion } from "@/src/motion";

export type AnimatedTabIconName = "messages" | "layers" | "activity" | "user";

type AnimatedTabIconProps = {
  name: AnimatedTabIconName;
  color: ColorValue;
  size: number;
  focused: boolean;
};

const iconNames: Record<AnimatedTabIconName, IconName> = {
  messages: "messages",
  layers: "layers",
  activity: "activity",
  user: "user",
};

// iOS selects a tab with the filled symbol. These two read clearly when filled; the overlapping
// message squares would merge into one shape, and the activity trace is a line on iOS too.
const FILLED_WHEN_FOCUSED = new Set<AnimatedTabIconName>(["layers", "user"]);

/** Tabs switch a hundred times a day, so selection only settles the icon's weight; it never pops. */
export function AnimatedTabIcon({ name, color, size, focused }: AnimatedTabIconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  const Icon: LucideIcon = icons[iconNames[name]];

  useEffect(() => {
    progress.set(withTiming(focused ? 1 : 0, { duration: motion.fade.duration }));
  }, [focused, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.9 + progress.get() * 0.1,
    transform: [{ translateY: 1 - progress.get() }],
  }));

  return (
    <Animated.View style={style}>
      <Icon size={size} color={color} fill={focused && FILLED_WHEN_FOCUSED.has(name) ? String(color) : "none"} strokeWidth={focused ? 2 : 1.8} absoluteStrokeWidth />
    </Animated.View>
  );
}
