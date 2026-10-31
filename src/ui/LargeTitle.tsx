import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { edgeChrome } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";

/** Scroll offset at which the Large Title has slid under the bar: its line height plus padding. */
const LARGE_TITLE_HEIGHT = 53;

/**
 * Android's drawn version of a UIKit Large Title bar: buttons on the right, and the small centered
 * title fades in only once the Large Title (`LargeTitle`, the list's first row) has scrolled under it.
 */
export function LargeTitleBar({ title, scrollY, actions }: { title: string; scrollY: SharedValue<number>; actions?: ReactNode }) {
  const [side, setSide] = useState(0);
  const titleStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [LARGE_TITLE_HEIGHT - 16, LARGE_TITLE_HEIGHT], [0, 1], "clamp") }));
  return <View className="flex-row items-center px-2 py-1.5" style={{ minHeight: edgeChrome.headerMinHeight }}>
    <View style={{ width: side }} />
    <Animated.Text accessibilityElementsHidden importantForAccessibility="no" numberOfLines={1} className="min-w-0 flex-1 text-center text-headline font-semibold text-fg" style={titleStyle}>{title}</Animated.Text>
    <View onLayout={(event) => setSide(event.nativeEvent.layout.width)} className="flex-row items-center justify-end">
      <BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider>
    </View>
  </View>;
}

export function LargeTitle({ title, children }: { title: string; children?: ReactNode }) {
  return <View className="pb-2">
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="px-4 pb-2 pt-1 text-display font-bold text-fg">{title}</Text>
    {children}
  </View>;
}
