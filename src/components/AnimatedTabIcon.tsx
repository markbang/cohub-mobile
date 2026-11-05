import { useEffect } from "react";
import type { ColorValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { IconName } from "@/src/icons";
import { motion } from "@/src/motion";
import { Glyph } from "@/src/ui/Glyph";

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


/** Tabs switch a hundred times a day, so selection only settles the icon's weight; it never pops. */
export function AnimatedTabIcon({ name, color, size, focused }: AnimatedTabIconProps) {
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(focused ? 1 : 0, { duration: motion.fade.duration }));
  }, [focused, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.9 + progress.get() * 0.1,
    transform: [{ translateY: 1 - progress.get() }],
  }));

  return (
    <Animated.View style={style}>
      {/* iOS selects a tab with the filled symbol; the glyph set's filled shape stands in, where it has one. */}
      <Glyph name={iconNames[name]} size={size} color={color} strokeWidth={focused ? 2 : 1.8} fill={focused ? String(color) : undefined} />
    </Animated.View>
  );
}
