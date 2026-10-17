import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collapsedComposerHeight } from "@/src/ui/composer-layout";
import { colorWithOpacity, edgeChrome, useAppTheme } from "@/src/theme";

export function useEdgeChrome(options?: { reserveComposer?: boolean }) {
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(insets.top + edgeChrome.headerMinHeight);
  const [footerHeight, setFooterHeight] = useState(() => options?.reserveComposer ? collapsedComposerHeight(insets.bottom) : 0);
  return {
    headerHeight,
    footerHeight,
    onHeaderLayout: (event: LayoutChangeEvent) => setHeaderHeight(event.nativeEvent.layout.height),
    onFooterLayout: (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height),
  };
}

export function EdgeScrim({ edge, style }: { edge: "top" | "bottom"; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  return <LinearGradient
    pointerEvents="none"
    accessible={false}
    colors={[colors.background, colorWithOpacity(colors.background, 245 / 255), colorWithOpacity(colors.background, 184 / 255), colorWithOpacity(colors.background, 0)]}
    locations={[0, 0.45, 0.75, 1]}
    start={{ x: 0, y: edge === "top" ? 0 : 1 }}
    end={{ x: 0, y: edge === "top" ? 1 : 0 }}
    style={[StyleSheet.absoluteFill, style]}
  />;
}

export function EdgeHeader({ children, onLayout }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void }) {
  const insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute left-0 right-0 top-0 z-1" style={{ paddingTop: insets.top }}>
    <EdgeScrim edge="top" style={{ bottom: -edgeChrome.fade }} />
    {children}
  </View>;
}

export function EdgeFooter({ children, onLayout }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void }) {
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute bottom-0 left-0 right-0 z-1">
    <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
    {children}
  </View>;
}
