import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { edgeChrome } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";

// The Large Title row: its padding puts the cap height 22 pt under the bar and a search field below it
// 63 pt under the bar, as measured on iOS 26.
const TITLE_INSET = { paddingTop: 14 } as const;
// As in UIKit, the bar's own title fades in while the Large Title slides under the bar.
const COLLAPSE_RANGE = [40, 52];

/**
 * Tab roots on both platforms, drawn as UIKit lays out a Large Title: a fixed 44 pt bar for the buttons, whose
 * centred title appears once the Large Title (`LargeTitle`, the first item of the scroll content) has
 * scrolled under it.
 */
export function LargeTitleBar({ title, actions, scrollY }: { title: string; actions?: ReactNode; scrollY?: Readonly<SharedValue<number>> }) {
  const titleStyle = useAnimatedStyle(() => ({ opacity: scrollY ? interpolate(scrollY.get(), COLLAPSE_RANGE, [0, 1], "clamp") : 0 }));
  return <View className="flex-row items-center justify-end gap-3 px-4" style={{ minHeight: edgeChrome.headerMinHeight }}>
    {/* The Large Title is the header for screen readers; this copy only shows it while collapsed. */}
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="absolute inset-x-0 inset-y-0 items-center justify-center" style={titleStyle}>
      <Text numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
    </Animated.View>
    {actions ? <BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider> : null}
  </View>;
}

/** The Large Title itself, scrolled with the content; a pull past the top stretches it, as UIKit does. */
export function LargeTitle({ title, scrollY }: { title: string; scrollY?: Readonly<SharedValue<number>> }) {
  const stretchStyle = useAnimatedStyle(() => ({ transform: [{ scale: scrollY ? interpolate(scrollY.get(), [-120, 0], [1.1, 1], "clamp") : 1 }] }));
  return <Animated.View style={[TITLE_ORIGIN, stretchStyle]}>
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="px-4 pb-2 text-display font-bold text-fg" style={TITLE_INSET}>{title}</Text>
  </Animated.View>;
}

const TITLE_ORIGIN = { transformOrigin: "left center" } as const;
