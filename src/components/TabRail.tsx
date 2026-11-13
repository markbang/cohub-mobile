import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs/types";
import { NavigationHelpersContext } from "expo-router/build/react-navigation/core/NavigationHelpersContext";
import { TabActions } from "expo-router/build/react-navigation/routers/TabRouter";
import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, useAppTheme } from "@/src/theme";

/** The rail's width; the split window adds it to the left pane, so the list keeps its own width. */
export const TAB_RAIL_WIDTH = 72;
const ICON_SIZE = 24;
/** The account tab stands apart at the rail's foot, as in desktop messaging apps. */
const FOOT_ROUTE = "(me)";

/**
 * The tab bar of the desktop layout (`useDesktopSplit`): a slim rail beside the list. A floating bottom bar
 * sits within thumb reach on a phone; with a pointer it covers the list's last rows and leaves the window's
 * height unused. Tabs keep their words, and the selected one its tinted capsule and accent, as on the bar.
 */
export function TabRail({ state, descriptors, emitter, insets }: BottomTabBarProps) {
  const theme = useAppTheme();
  const tabs = useContext(NavigationHelpersContext);
  const item = (route: (typeof state.routes)[number], index: number) => {
    const { options } = descriptors[route.key];
    const label = typeof options.title === "string" ? options.title : route.name;
    const focused = state.index === index;
    const select = () => {
      const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (focused || event.defaultPrevented) return;
      // JUMP_TO, as the floating bar sends: a NAVIGATE would also pop the Chat open beside the list.
      tabs?.dispatch(TabActions.jumpTo(route.name, route.params));
    };
    return <Pressable
      key={route.key}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
      testID={options.tabBarButtonTestID}
      onPress={select}
      className="items-center gap-1 py-1.5 active:opacity-70"
    >
      <View className={`h-8 w-14 items-center justify-center rounded-full ${focused ? "bg-glass-lens" : ""}`}>
        {/* design-system-begin: the icon renderer takes JS colors. */}
        {options.tabBarIcon?.({ focused, color: focused ? theme.colors.accent : theme.colors.text, size: ICON_SIZE })}
        {/* design-system-end */}
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className={`text-micro font-semibold ${focused ? "text-accent" : "text-fg-secondary"}`}>{label}</Text>
    </Pressable>;
  };
  const indexed = state.routes.map((route, index) => ({ route, index }));
  return <View accessibilityRole="tablist" className="items-center justify-between border-border bg-background pb-4" style={{ width: TAB_RAIL_WIDTH, paddingTop: insets.top + 12, borderRightWidth: StyleSheet.hairlineWidth }}>
    <View className="gap-3">{indexed.filter(({ route }) => route.name !== FOOT_ROUTE).map(({ route, index }) => item(route, index))}</View>
    <View>{indexed.filter(({ route }) => route.name === FOOT_ROUTE).map(({ route, index }) => item(route, index))}</View>
  </View>;
}
