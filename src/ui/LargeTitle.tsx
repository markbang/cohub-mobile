import { useRef, type ReactNode } from "react";
import { Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { edgeChrome } from "@/src/theme";
import { BarButtonContext } from "@/src/ui/bar-button-context";

// The Large Title row: its padding puts the cap height 22 pt under the bar and a search field below it
// 63 pt under the bar, as measured on iOS 26.
const TITLE_INSET = { paddingTop: 14 } as const;
// As in UIKit, the bar's own title fades in while the Large Title slides under the bar.
const COLLAPSE_RANGE = [40, 52] as const;
/** The search field row under a Large Title: the 44 pt capsule and its 8 pt bottom padding. */
export const LARGE_TITLE_SEARCH_HEIGHT = 52;

/**
 * Scroll offsets of a tab root's header. As in UIKit, a search field under the Large Title collapses
 * first while the title holds (`hold`), then the title slides under the bar (`collapsed`), where the soft
 * edge (`edge`) comes in.
 */
export function largeTitleScroll(search: boolean) {
  const hold = search ? LARGE_TITLE_SEARCH_HEIGHT : 0;
  return {
    hold,
    collapsed: hold + COLLAPSE_RANGE[1],
    edge: [hold + 8, hold + 48] as const,
  };
}

/**
 * Android tab roots, drawn as UIKit lays out a Large Title: a fixed 44 pt bar for the buttons, whose
 * centred title appears once the Large Title (`LargeTitle`, the first item of the scroll content) has
 * scrolled under it.
 */
export function LargeTitleBar({ title, actions, scrollY, hold = 0 }: { title: string; actions?: ReactNode; scrollY?: SharedValue<number>; hold?: number }) {
  const titleStyle = useAnimatedStyle(() => ({ opacity: scrollY ? interpolate(scrollY.get(), [COLLAPSE_RANGE[0] + hold, COLLAPSE_RANGE[1] + hold], [0, 1], "clamp") : 0 }));
  return <View className="flex-row items-center justify-end gap-3 px-4" style={{ minHeight: edgeChrome.headerMinHeight }}>
    {/* The Large Title is the header for screen readers; this copy only shows it while collapsed. */}
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="absolute inset-x-0 inset-y-0 items-center justify-center" style={titleStyle}>
      <Text numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
    </Animated.View>
    {actions ? <BarButtonContext.Provider value="drawn">{actions}</BarButtonContext.Provider> : null}
  </View>;
}

/**
 * The Large Title itself, scrolled with the content once the `hold` offset (a collapsing search field) has
 * passed; a pull past the top stretches it, as UIKit does.
 */
export function LargeTitle({ title, scrollY, hold = 0 }: { title: string; scrollY?: SharedValue<number>; hold?: number }) {
  const stretchStyle = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.get() : 0;
    return { transform: [{ translateY: Math.min(Math.max(y, 0), hold) }, { scale: interpolate(y, [-120, 0], [1.1, 1], "clamp") }] };
  });
  return <Animated.View style={[TITLE_ORIGIN, stretchStyle]}>
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="px-4 pb-2 text-display font-bold text-fg" style={TITLE_INSET}>{title}</Text>
  </Animated.View>;
}

const TITLE_ORIGIN = { transformOrigin: "left center" } as const;

/**
 * The search field under a Large Title. Over the first `LARGE_TITLE_SEARCH_HEIGHT` of scroll it stays under
 * the held title and shrinks to nothing from its top, its contents fading out over the first half, as UIKit
 * collapses a navigation bar's search field; the rows below keep following the finger.
 */
export function LargeTitleSearch({ scrollY, children }: { scrollY: SharedValue<number>; children: ReactNode }) {
  const rowStyle = useAnimatedStyle(() => {
    const collapsed = Math.min(Math.max(scrollY.get(), 0), LARGE_TITLE_SEARCH_HEIGHT);
    return { transform: [{ translateY: collapsed }, { scaleY: Math.max(0.001, 1 - collapsed / LARGE_TITLE_SEARCH_HEIGHT) }] };
  });
  const contentStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.get(), [0, LARGE_TITLE_SEARCH_HEIGHT / 2], [1, 0], "clamp") }));
  return <Animated.View className="px-4 pb-2" style={[SEARCH_ORIGIN, rowStyle]}>
    <Animated.View style={contentStyle}>{children}</Animated.View>
  </Animated.View>;
}

const SEARCH_ORIGIN = { transformOrigin: "top" } as const;

/**
 * UIKit never rests a scroll view part-way through collapsing its bar: released there, it settles on the
 * nearest of expanded, search hidden (`hold`), and collapsed. Spread the handlers on the tab root's list.
 */
export function useLargeTitleSnap(scrollRef: { current: ScrollView | null }, offsets: { hold: number; collapsed: number }, enabled: boolean) {
  const momentum = useRef(false);
  // A list that ends inside the collapse may rest at its end, so its last rows stay reachable.
  const settle = ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) => {
    const y = contentOffset.y;
    const end = contentSize.height - layoutMeasurement.height;
    const stops = [0, offsets.hold, offsets.collapsed, end].filter((stop, index, all) => stop >= 0 && stop <= end + 0.5 && all.indexOf(stop) === index);
    if (y <= 0 || y >= offsets.collapsed) return;
    const target = stops.reduce((best, stop) => Math.abs(stop - y) < Math.abs(best - y) ? stop : best, stops[0]);
    if (Math.abs(target - y) >= 1) scrollRef.current?.scrollTo({ y: target, animated: true });
  };
  if (!enabled) return {};
  return {
    onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const position = event.nativeEvent;
      momentum.current = false;
      // A fling settles in onMomentumScrollEnd; wait a frame to see whether one starts.
      setTimeout(() => { if (!momentum.current) settle(position); }, 32);
    },
    onMomentumScrollBegin: () => { momentum.current = true; },
    onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      momentum.current = false;
      settle(event.nativeEvent);
    },
  };
}
