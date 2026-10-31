import { LinearGradient } from "expo-linear-gradient";
import { useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
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

// Opacity eases out with a flat start and end, so neither end of the fade reads as a line across
// the content. The top fades right below the opaque status bar, leaving content faintly visible
// behind the header's glass like iOS 26's soft scroll edge; the bottom holds briefly behind
// floating controls first.
const SCRIM_STEPS = 10;
function scrimCurve(hold: number) {
  return [...(hold > 0 ? [{ at: 0, alpha: 1 }] : []), ...Array.from({ length: SCRIM_STEPS + 1 }, (_, step) => {
    const t = step / SCRIM_STEPS;
    return { at: hold + (1 - hold) * t, alpha: 1 - t * t * (3 - 2 * t) };
  })];
}
const SCRIM_CURVES = { top: scrimCurve(0), bottom: scrimCurve(0.2) };

/** `solid` keeps the first points fully opaque, e.g. the status bar, before the fade begins. */
export function EdgeScrim({ edge, solid = 0, style }: { edge: "top" | "bottom"; solid?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  const curve = SCRIM_CURVES[edge];
  return <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, style]}>
    {solid > 0 ? <View style={{ height: solid, backgroundColor: colors.background }} /> : null}
    <LinearGradient
      pointerEvents="none"
      colors={curve.map(({ alpha }) => colorWithOpacity(colors.background, alpha)) as unknown as readonly [string, string, ...string[]]}
      locations={curve.map(({ at }) => at) as unknown as readonly [number, number, ...number[]]}
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
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrollY ? interpolate(scrollY.get(), [0, edgeChrome.topFade], [0, 1], "clamp") : 1 }));
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute left-0 right-0 top-0 z-1" style={{ paddingTop: insets.top }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: -edgeChrome.topFade }, scrimStyle]}>
      <EdgeScrim edge="top" solid={insets.top} />
    </Animated.View>
    {children}
  </View>;
}

/** Android's keyboard height includes the navigation bar, which edge-to-edge chrome already pads for. */
export function useKeyboardCoveredInset() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? insets.bottom : 0;
}

/**
 * With `keyboard`, the footer rides the keyboard instead of the screen resizing: a shrinking viewport
 * slides the tail under the composer until it settles. Pair it with `KeyboardAwareLegendList`.
 */
export function EdgeFooter({ children, onLayout, keyboard = false }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void; keyboard?: boolean }) {
  const covered = useKeyboardCoveredInset();
  const content = <>
    <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
    {children}
  </>;
  if (keyboard) return <KeyboardStickyView pointerEvents="box-none" onLayout={onLayout} offset={{ opened: covered }} style={FOOTER_STYLE}>{content}</KeyboardStickyView>;
  return <View pointerEvents="box-none" onLayout={onLayout} style={FOOTER_STYLE}>{content}</View>;
}

/** Pads by the same lift as a keyboard `EdgeFooter`. */
export function KeyboardLiftPadding({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const covered = useKeyboardCoveredInset();
  const { height, progress } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -height.get() - progress.get() * covered) }), [covered]);
  return <Animated.View pointerEvents="none" style={[style, liftStyle]}>{children}</Animated.View>;
}

const FOOTER_STYLE: ViewStyle = { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1 };
