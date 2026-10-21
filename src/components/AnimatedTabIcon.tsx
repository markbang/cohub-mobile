import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef } from "react";
import type { ColorValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { icons, type IconName } from "@/src/icons";
import { motion, springs } from "@/src/motion";

export type AnimatedTabIconName = "messages" | "layers" | "activity";

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
};

const POP_FROM_SCALE = 0.84;

export function AnimatedTabIcon({ name, color, size, focused }: AnimatedTabIconProps) {
  const progress = useSharedValue(focused ? 1 : 0);
  const scale = useSharedValue(1);
  const mounted = useRef(false);
  const Icon: LucideIcon = icons[iconNames[name]];

  useEffect(() => {
    progress.set(withTiming(focused ? 1 : 0, { duration: motion.fade.duration }));
    // Only a change of tab pops; the tab that is selected at launch just appears.
    if (mounted.current && focused) scale.set(withSequence(withTiming(POP_FROM_SCALE, { duration: motion.pressIn.duration }), withSpring(1, springs.pop)));
    mounted.current = true;
  }, [focused, progress, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.9 + progress.get() * 0.1,
    transform: [{ translateY: 1 - progress.get() }, { scale: scale.get() }],
  }));

  return (
    <Animated.View style={style}>
      <Icon size={size} color={color} strokeWidth={focused ? 2 : 1.8} absoluteStrokeWidth />
    </Animated.View>
  );
}
