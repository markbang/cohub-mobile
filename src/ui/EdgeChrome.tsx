import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collapsedComposerHeight } from "@/src/ui/composer-layout";
import { colorWithOpacity, edgeChrome, useAppTheme } from "@/src/theme";

export function useEdgeChrome(options?: { reserveComposer?: boolean }) {
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(insets.top + edgeChrome.headerMinHeight);
  const [footerHeight, setFooterHeight] = useState(() => options?.reserveComposer ? collapsedComposerHeight(insets.bottom) : 0);
  const scrollY = useSharedValue(0);
  return {
    headerHeight,
    footerHeight,
    scrollY,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => scrollY.set(event.nativeEvent.contentOffset.y),
    onHeaderLayout: (event: LayoutChangeEvent) => setHeaderHeight(event.nativeEvent.layout.height),
    onFooterLayout: (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height),
  };
}

// Opacity holds briefly, then eases out with a flat start and end, so neither the edge of the
// held part nor the end of the fade reads as a line across the content.
const SCRIM_HOLD = 0.2;
const SCRIM_STEPS = 10;
const SCRIM_CURVE = [{ at: 0, alpha: 1 }, ...Array.from({ length: SCRIM_STEPS + 1 }, (_, step) => {
  const t = step / SCRIM_STEPS;
  return { at: SCRIM_HOLD + (1 - SCRIM_HOLD) * t, alpha: 1 - t * t * (3 - 2 * t) };
})];

/** `solid` keeps the first points fully opaque, e.g. the status bar, before the fade begins. */
export function EdgeScrim({ edge, solid = 0, style }: { edge: "top" | "bottom"; solid?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  return <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, style]}>
    {solid > 0 ? <View style={{ height: solid, backgroundColor: colors.background }} /> : null}
    <LinearGradient
      pointerEvents="none"
      colors={SCRIM_CURVE.map(({ alpha }) => colorWithOpacity(colors.background, alpha)) as unknown as readonly [string, string, ...string[]]}
      locations={SCRIM_CURVE.map(({ at }) => at) as unknown as readonly [number, number, ...number[]]}
      start={{ x: 0, y: edge === "top" ? 0 : 1 }}
      end={{ x: 0, y: edge === "top" ? 1 : 0 }}
      style={{ flex: 1 }}
    />
  </View>;
}

/**
 * With `scrollY`, the fade shows only once content has scrolled under the header, so nothing is
 * veiled at rest; without it the fade is always on, for screens whose content starts beneath it.
 */
export function EdgeHeader({ children, onLayout, scrollY }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void; scrollY?: SharedValue<number> }) {
  const insets = useSafeAreaInsets();
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrollY ? interpolate(scrollY.get(), [0, edgeChrome.fade], [0, 1], "clamp") : 1 }));
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute left-0 right-0 top-0 z-1" style={{ paddingTop: insets.top }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: -edgeChrome.fade }, scrimStyle]}>
      <EdgeScrim edge="top" solid={insets.top} />
    </Animated.View>
    {children}
  </View>;
}

export function EdgeFooter({ children, onLayout }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void }) {
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute bottom-0 left-0 right-0 z-1">
    <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
    {children}
  </View>;
}
