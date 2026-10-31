import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { edgeChrome } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";

/**
 * Android tab roots: the Large Title and the bar's buttons share one row, as on the App Store's Today and in a
 * Material top app bar. A separate title row only pays off where UIKit collapses it into the bar on scroll.
 */
export function LargeTitleBar({ title, actions }: { title: string; actions?: ReactNode }) {
  return <View className="flex-row items-center gap-2 pl-4 pr-2" style={{ minHeight: edgeChrome.headerMinHeight }}>
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="min-w-0 flex-1 text-display font-bold text-fg">{title}</Text>
    {actions ? <View className="flex-row items-center"><BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider></View> : null}
  </View>;
}
