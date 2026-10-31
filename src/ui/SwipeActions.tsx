import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { IconName } from "@/src/icons";
import { traceAction } from "@/src/data/interaction-trace";
import { springs } from "@/src/motion";
import { haptics } from "@/src/platform/haptics";
import { AppIcon } from "@/src/ui";

export type SwipeAction = { icon: IconName; label: string; tone: "accent" | "neutral"; disabled?: boolean; onPress: () => void };

const ACTION_WIDTH = 76;
// A row only starts sliding once the finger has clearly gone sideways; any vertical movement first
// hands the touch to the list, so scrolling never turns into a swipe.
const ACTIVE_X = 16;
const FAIL_Y = 8;
// UIScrollView's fast deceleration projects a release to where it would coast.
const RELEASE_PROJECTION_S = 0.1;
const TONES = {
  accent: { box: "bg-accent", text: "text-on-accent", icon: "onAccent" },
  neutral: { box: "bg-border-strong", text: "text-fg", icon: "fg" },
} as const;

/**
 * List row swipe actions, as in Mail and Messages: a swipe from the leading edge uncovers `leading`
 * (Messages pins there), one from the trailing edge uncovers `trailing`. The row is opaque so the
 * actions only show as it slides off them. Each action stays reachable without the gesture, through
 * the row's long-press menu and its accessibility actions.
 */
export function SwipeActions({ leading = [], trailing = [], children }: { leading?: readonly SwipeAction[]; trailing?: readonly SwipeAction[]; children: ReactNode }) {
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const leadWidth = leading.length * ACTION_WIDTH;
  const trailWidth = trailing.length * ACTION_WIDTH;

  const gesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-ACTIVE_X, ACTIVE_X])
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onStart(() => { start.set(offset.get()); })
    .onUpdate((event) => {
      const next = start.get() + event.translationX;
      const max = leadWidth;
      const min = -trailWidth;
      // Past the actions the row resists instead of stopping dead.
      offset.set(next > max ? max + (next - max) * 0.2 : next < min ? min + (next - min) * 0.2 : next);
    })
    .onEnd((event) => {
      const projected = offset.get() + event.velocityX * RELEASE_PROJECTION_S;
      const target = leadWidth && projected > leadWidth / 2 ? leadWidth : trailWidth && projected < -trailWidth / 2 ? -trailWidth : 0;
      offset.set(withSpring(target, { ...springs.sheet, velocity: event.velocityX, overshootClamping: true }));
      scheduleOnRN(setOpen, target !== 0);
      if (target !== 0) scheduleOnRN(haptics.selection);
    }), [leadWidth, offset, start, trailWidth]);

  const close = () => { offset.set(withSpring(0, { ...springs.sheet, overshootClamping: true })); setOpen(false); };
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const leadStyle = useAnimatedStyle(() => ({ opacity: interpolate(offset.get(), [0, leadWidth * 0.5 || 1], [0, 1], "clamp"), width: Math.max(0, offset.get()) }));
  const trailStyle = useAnimatedStyle(() => ({ opacity: interpolate(-offset.get(), [0, trailWidth * 0.5 || 1], [0, 1], "clamp"), width: Math.max(0, -offset.get()) }));

  if (!leadWidth && !trailWidth) return children;
  return <GestureDetector gesture={gesture}>
    <View collapsable={false}>
      {leadWidth ? <Animated.View className="absolute bottom-0 left-0 top-0 flex-row overflow-hidden" style={leadStyle}><Actions actions={leading} onDone={close} /></Animated.View> : null}
      {trailWidth ? <Animated.View className="absolute bottom-0 right-0 top-0 flex-row justify-end overflow-hidden" style={trailStyle}><Actions actions={trailing} onDone={close} /></Animated.View> : null}
      <Animated.View className="bg-background" style={rowStyle}>
        {children}
        {/* An open row closes on the next tap rather than opening what is under the finger. */}
        {open ? <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={close} /> : null}
      </Animated.View>
    </View>
  </GestureDetector>;
}

function Actions({ actions, onDone }: { actions: readonly SwipeAction[]; onDone: () => void }) {
  return <>
    {actions.map((action) => {
      const tone = TONES[action.tone];
      return <Pressable
        key={action.label}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        disabled={action.disabled}
        onPress={() => { traceAction("swipe_action", { action: action.icon }); onDone(); action.onPress(); }}
        className={`items-center justify-center gap-1 disabled:opacity-55 ${tone.box}`}
        style={{ width: ACTION_WIDTH }}
      >
        <AppIcon name={action.icon} size={20} tone={tone.icon} strokeWidth={2.1} />
        <Text numberOfLines={1} className={`text-caption font-semibold ${tone.text}`}>{action.label}</Text>
      </Pressable>;
    })}
  </>;
}
