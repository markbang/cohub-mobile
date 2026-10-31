import { useRef, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import type { IconName } from "@/src/icons";
import { traceAction } from "@/src/data/interaction-trace";
import { haptics } from "@/src/platform/haptics";
import { AppIcon } from "@/src/ui";

export type SwipeAction = { icon: IconName; label: string; tone: "accent" | "neutral"; disabled?: boolean; onPress: () => void };

const ACTION_WIDTH = 76;
const TONES = {
  accent: { box: "bg-accent", text: "text-on-accent", icon: "onAccent" },
  neutral: { box: "bg-border-strong", text: "text-fg", icon: "fg" },
} as const;

/**
 * List row swipe actions, as in Mail and Messages: a swipe from the leading edge uncovers `leading`
 * (Messages pins there), one from the trailing edge uncovers `trailing`. Each action stays reachable
 * without the gesture, through the row's long-press menu and its accessibility actions.
 */
export function SwipeActions({ leading = [], trailing = [], children }: { leading?: readonly SwipeAction[]; trailing?: readonly SwipeAction[]; children: ReactNode }) {
  const opened = useRef(false);
  if (!leading.length && !trailing.length) return children;
  return <ReanimatedSwipeable
    friction={1.6}
    leftThreshold={ACTION_WIDTH / 2}
    rightThreshold={ACTION_WIDTH / 2}
    overshootLeft={false}
    overshootRight={false}
    dragOffsetFromLeft={12}
    dragOffsetFromRight={12}
    onSwipeableWillOpen={() => { if (!opened.current) haptics.selection(); opened.current = true; }}
    onSwipeableClose={() => { opened.current = false; }}
    renderLeftActions={leading.length ? (progress, _translation, methods) => <Actions actions={leading} side="leading" progress={progress} methods={methods} /> : undefined}
    renderRightActions={trailing.length ? (progress, _translation, methods) => <Actions actions={trailing} side="trailing" progress={progress} methods={methods} /> : undefined}
  >
    {children}
  </ReanimatedSwipeable>;
}

function Actions({ actions, side, progress, methods }: { actions: readonly SwipeAction[]; side: "leading" | "trailing"; progress: SharedValue<number>; methods: SwipeableMethods }) {
  // The actions grow out of the edge with the row, rather than sitting revealed behind it.
  const style = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 0.4], [0, 1], "clamp"), transform: [{ scale: interpolate(progress.get(), [0, 1], [0.8, 1], "clamp") }] }));
  return <View className={`flex-row ${side === "leading" ? "" : "justify-end"}`} style={{ width: ACTION_WIDTH * actions.length }}>
    {actions.map((action) => {
      const tone = TONES[action.tone];
      return <Pressable
        key={action.label}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        disabled={action.disabled}
        onPress={() => { traceAction("swipe_action", { action: action.icon }); methods.close(); action.onPress(); }}
        className={`items-center justify-center disabled:opacity-55 ${tone.box}`}
        style={{ width: ACTION_WIDTH }}
      >
        <Animated.View className="items-center gap-1" style={style}>
          <AppIcon name={action.icon} size={20} tone={tone.icon} strokeWidth={2.1} />
          <Text numberOfLines={1} className={`text-caption font-semibold ${tone.text}`}>{action.label}</Text>
        </Animated.View>
      </Pressable>;
    })}
  </View>;
}
