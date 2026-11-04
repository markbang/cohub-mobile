import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { edgeChrome } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";

/**
 * Android tab roots, drawn as UIKit lays out a Large Title: the bar's buttons in a 44 pt row, the title
 * on its own row below. The title row's padding puts its cap height 22 pt under the bar and a search
 * field below it 63 pt under the bar, as measured on iOS 26.
 */
export function LargeTitleBar({ title, actions }: { title: string; actions?: ReactNode }) {
  return <View>
    <View className="flex-row items-center justify-end gap-3 px-4" style={{ minHeight: edgeChrome.headerMinHeight }}>
      {actions ? <BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider> : null}
    </View>
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="px-4 pb-2 text-display font-bold text-fg" style={TITLE_INSET}>{title}</Text>
  </View>;
}

const TITLE_INSET = { paddingTop: 14 } as const;
