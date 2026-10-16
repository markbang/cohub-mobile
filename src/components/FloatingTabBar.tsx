import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { edgeChrome, typography, useAppTheme } from "@/src/theme";
import { EdgeScrim } from "@/src/ui/EdgeChrome";

const BAR_HEIGHT = 60;
const BAR_HORIZONTAL_MARGIN = 18;
const BAR_BOTTOM_MARGIN = 8;
const INDICATOR_DURATION = 250;
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

const IOS_HOME_INDICATOR_OVERLAP = 14;

function barBottomOffset(bottomInset: number) {
  // iOS's home-indicator inset is sized for edge-to-edge content; like the system tab bar, a floating bar can sit partly inside it.
  if (Platform.OS === "ios") return Math.max(bottomInset - IOS_HOME_INDICATOR_OVERLAP, BAR_BOTTOM_MARGIN * 2);
  return Math.max(bottomInset, BAR_BOTTOM_MARGIN) + BAR_BOTTOM_MARGIN;
}

/** Space the floating bar occupies at the bottom of a tab screen. */
export function useFloatingTabBarInset() {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + barBottomOffset(insets.bottom) + 16;
}

export function FloatingTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const theme = useAppTheme();
  const [barWidth, setBarWidth] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const measured = useRef(false);
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const hidden = useSharedValue(0);

  const routes = state.routes;
  const itemWidth = barWidth > 0 ? barWidth / routes.length : 0;

  useEffect(() => {
    if (itemWidth <= 0) return;
    const x = state.index * itemWidth;
    if (!measured.current) {
      measured.current = true;
      indicatorX.set(x);
      indicatorWidth.set(itemWidth);
      return;
    }
    indicatorX.set(withTiming(x, { duration: INDICATOR_DURATION, easing: EASE_IN_OUT }));
    indicatorWidth.set(withTiming(itemWidth, { duration: INDICATOR_DURATION, easing: EASE_IN_OUT }));
  }, [indicatorWidth, indicatorX, itemWidth, state.index]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    hidden.set(withTiming(keyboardVisible ? 1 : 0, { duration: 180, easing: EASE_IN_OUT }));
  }, [hidden, keyboardVisible]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.get() }],
    width: indicatorWidth.get(),
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: 1 - hidden.get(),
    transform: [{ translateY: hidden.get() * (BAR_HEIGHT + 40) }],
  }));

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? "none" : "box-none"}
      style={[{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: BAR_HORIZONTAL_MARGIN,
        paddingBottom: barBottomOffset(insets.bottom),
      }, barStyle]}
    >
      <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, shadowColor: theme.colors.shadow },
        ]}
      >
        <View style={styles.barInner} onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}>
          {itemWidth > 0 ? (
            <Animated.View pointerEvents="none" style={[styles.indicator, { backgroundColor: theme.colors.accentSoft }, indicatorStyle]} />
          ) : null}
          {routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const label = typeof options.title === "string" ? options.title : route.name;
            const color = focused ? theme.colors.accent : theme.colors.textMuted;
            const onPress = () => {
              const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (focused || event.defaultPrevented) return;
              if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => undefined);
              navigateToTab(route.key);
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                testID={options.tabBarButtonTestID}
                onPress={onPress}
                onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.65 } : null]}
              >
                {options.tabBarIcon?.({ focused, color, size: 19 })}
                <Text numberOfLines={1} style={[typography.caption, { color, fontWeight: focused ? "600" : "500" }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 5,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  barInner: {
    flex: 1,
    flexDirection: "row",
  },
  indicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: (BAR_HEIGHT - 10) / 2,
  },
  item: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
});
