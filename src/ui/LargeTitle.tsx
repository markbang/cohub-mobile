import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Pressable, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type TextInput } from "react-native";
import Animated, { Easing, interpolate, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { useTranslation } from "@/src/i18n";
import { continuity, curves } from "@/src/motion";
import { usePredictiveBackBlock } from "@/src/platform/predictive-back";
import { edgeChrome } from "@/src/theme";
import { SearchField } from "@/src/ui";
import { BarButtonContext } from "@/src/ui/bar-button-context";
import { useScreenVisible } from "@/src/ui/pane";
import { useMinimizeTabBarOnScroll } from "@/src/ui/tab-bar-minimize";

// The Large Title row: its padding puts the cap height 22 pt under the bar and a search field below it
// 63 pt under the bar, as measured on iOS 26.
const TITLE_INSET = { paddingTop: 14 } as const;
// Scrolled this far past `hold`, the Large Title has gone under the bar and the bar shows its own title.
const COLLAPSE_AT = 52;
// UIKit does not tie the swap to the offset: once past it, the bar's title rises 14 pt into place over 170 ms,
// its opacity trailing the rise, while the Large Title fades out; the reverse on the way back (iOS 26, frame by frame).
const TITLE_SWAP = { duration: 170, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
const TITLE_RISE = 14;

/** 0 while the Large Title shows, 1 once the bar's title has taken over; timed, not scrubbed by the scroll. */
function useTitleSwap(scrollY: SharedValue<number> | undefined, hold: number) {
  const swap = useSharedValue(0);
  useAnimatedReaction(() => (scrollY ? scrollY.get() >= hold + COLLAPSE_AT - 0.5 : false), (collapsed, previous) => {
    if (collapsed === previous) return;
    swap.set(previous === null ? (collapsed ? 1 : 0) : withTiming(collapsed ? 1 : 0, TITLE_SWAP));
  });
  return swap;
}
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
    collapsed: hold + COLLAPSE_AT,
    edge: [hold + 8, hold + 48] as const,
  };
}

/**
 * Android tab roots, drawn as UIKit lays out a Large Title: a fixed 44 pt bar for the buttons, whose
 * centred title appears once the Large Title (`LargeTitle`, the first item of the scroll content) has
 * scrolled under it. The same scroll minimizes the floating tab bar, as UIKit's tab bar does.
 */
export function LargeTitleBar({ title, actions, scrollY, hold = 0 }: { title: string; actions?: ReactNode; scrollY?: SharedValue<number>; hold?: number }) {
  useMinimizeTabBarOnScroll(scrollY, hold + COLLAPSE_AT);
  const swap = useTitleSwap(scrollY, hold);
  const titleStyle = useAnimatedStyle(() => {
    const progress = swap.get();
    return { opacity: Math.pow(progress, 2.5), transform: [{ translateY: (1 - progress) * TITLE_RISE }] };
  });
  return <View className="flex-row items-center justify-end gap-3 px-4" style={{ minHeight: edgeChrome.headerMinHeight }}>
    {/* The Large Title is the header for screen readers; this copy only shows it while collapsed. */}
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="absolute inset-x-0 inset-y-0 items-center justify-center" style={titleStyle}>
      <Text numberOfLines={1} className="text-headline font-semibold text-fg">{title}</Text>
    </Animated.View>
    {actions ? <BarButtonContext.Provider value="system">{actions}</BarButtonContext.Provider> : null}
  </View>;
}

/**
 * The Large Title itself, scrolled with the content once the `hold` offset (a collapsing search field) has
 * passed; a pull past the top stretches it, as UIKit does.
 */
export function LargeTitle({ title, scrollY, hold = 0, search }: { title: string; scrollY?: SharedValue<number>; hold?: number; search?: LargeTitleSearchState }) {
  // The swap hides it once the bar's title shows, so it never rests half-veiled under the soft edge.
  const swap = useTitleSwap(scrollY, hold);
  const searching = search?.progress;
  const stretchStyle = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.get() : 0;
    // An active search takes the title's place: it fades as the field rises over it.
    return { opacity: (1 - swap.get()) * (1 - (searching ? searching.get() : 0)), transform: [{ translateY: Math.min(Math.max(y, 0), hold) }, { scale: interpolate(y, [-120, 0], [1.1, 1], "clamp") }] };
  });
  return <Animated.View style={[TITLE_ORIGIN, stretchStyle]}>
    <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="px-4 pb-2 text-display font-bold text-fg" style={TITLE_INSET}>{title}</Text>
  </Animated.View>;
}

const TITLE_ORIGIN = { transformOrigin: "left center" } as const;

/**
 * Android's drawn search under a Large Title, activated as iOS activates a navigation bar's search: focusing the
 * field fades the bar and the Large Title, lifts the list until the field sits where the bar was, and slides a
 * Cancel in beside it. Cancel or system back clears the query, drops the keyboard, and runs it all back.
 *
 * Only transforms and opacity animate. The lift is measured once when the search starts, so the keyboard
 * resizing the screen cannot move the field; `held` keeps the lifted layout (the list's longer bottom, the
 * field above the rows) until the return has finished. What is touchable follows `active`, never the
 * animation's progress.
 */
export type LargeTitleSearchState = {
  active: boolean;
  held: boolean;
  /** For the list's `ListHeaderComponentStyle`: the pinned field covers the rows scrolling under it. */
  listHeaderStyle: { zIndex: number } | undefined;
  progress: SharedValue<number>;
  lift: number;
  inputRef: React.RefObject<TextInput | null>;
  begin: () => void;
  cancel: () => void;
  onRowLayout: (event: LayoutChangeEvent) => void;
};

export function useLargeTitleSearch({ onQueryChange, scrollY, scrollRef, headerHeight }: {
  onQueryChange: (query: string) => void;
  scrollY: SharedValue<number>;
  /** Cancel puts the list back where the search started; scrolled results would otherwise leave the field off its row. */
  scrollRef: { current: ScrollView | null };
  /** The `EdgeHeader`'s height: the list's top padding, above the Large Title. */
  headerHeight: number;
}): LargeTitleSearchState {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const visible = useScreenVisible();
  const inputRef = useRef<TextInput>(null);
  const progress = useSharedValue(0);
  const [active, setActive] = useState(false);
  const [held, setHeld] = useState(false);
  const [lift, setLift] = useState(0);
  const [rowTop, setRowTop] = useState(0);
  const [startOffset, setStartOffset] = useState(0);
  const timing = { duration: reducedMotion ? 0 : continuity.search.duration, easing: SEARCH_EASING };

  const begin = () => {
    if (active) return;
    setStartOffset(scrollY.get());
    // From the field's row at rest up to the bar's row, which starts under the status bar.
    setLift(Math.max(0, headerHeight + rowTop - insets.top));
    setActive(true);
    setHeld(true);
    progress.set(withTiming(1, timing));
  };
  const release = useCallback(() => setHeld(false), []);
  const cancel = () => {
    if (!active) return;
    onQueryChange("");
    inputRef.current?.blur();
    setActive(false);
    if (Math.abs(scrollY.get() - startOffset) > 1) scrollRef.current?.scrollTo({ y: startOffset, animated: false });
    progress.set(withTiming(0, timing, (finished) => {
      if (finished) scheduleOnRN(release);
    }));
  };
  const cancelRef = useRef(cancel);
  useEffect(() => { cancelRef.current = cancel; });

  // System back leaves the search before it leaves anything else.
  usePredictiveBackBlock(active && visible);
  useEffect(() => {
    if (!active || !visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [active, visible]);

  return { active, held, listHeaderStyle: held ? ABOVE_ROWS : undefined, progress, lift, inputRef, begin, cancel, onRowLayout: (event) => setRowTop(event.nativeEvent.layout.y) };
}

const SEARCH_EASING = Easing.bezier(...curves.easeInOut);
const ABOVE_ROWS = { zIndex: 1 } as const;

/**
 * Wraps the list under a drawn search: an active search lifts it, and its bottom reaches that much further so
 * nothing opens up below. Without `search` (iOS's system search) the list is left as it is.
 */
export function LargeTitleSearchLift({ search, children }: { search?: LargeTitleSearchState; children: ReactNode }) {
  if (!search) return children;
  return <SearchLift search={search}>{children}</SearchLift>;
}

function SearchLift({ search, children }: { search: LargeTitleSearchState; children: ReactNode }) {
  const { progress, lift } = search;
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift * progress.get() }] }));
  return <Animated.View style={[LIFT_FILL, search.held ? { marginBottom: -lift } : null, riseStyle]}>{children}</Animated.View>;
}

const LIFT_FILL = { flex: 1 } as const;

/**
 * The search field under a Large Title. Over the first `LARGE_TITLE_SEARCH_HEIGHT` of scroll it stays under
 * the held title and shrinks to nothing from its top, its contents fading out over the first half, as UIKit
 * collapses a navigation bar's search field; the rows below keep following the finger. With `search`, focusing
 * it starts that search: the field stays whole and pinned to the screen while the results scroll under it.
 */
export function LargeTitleSearch({ scrollY, field, search }: { scrollY: SharedValue<number>; field: { value: string; onChangeText: (query: string) => void; placeholder?: string }; search?: LargeTitleSearchState }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const searching = search?.progress;
  const [cancelWidth, setCancelWidth] = useState(0);
  const inset = cancelWidth > 0 ? cancelWidth + CANCEL_GAP : 0;
  const rowStyle = useAnimatedStyle(() => {
    const y = scrollY.get();
    const collapsed = Math.min(Math.max(y, 0), LARGE_TITLE_SEARCH_HEIGHT);
    const pinned = searching ? searching.get() : 0;
    return { transform: [{ translateY: collapsed + (y - collapsed) * pinned }, { scaleY: Math.max(0.001, 1 - (collapsed / LARGE_TITLE_SEARCH_HEIGHT) * (1 - pinned)) }] };
  });
  const contentStyle = useAnimatedStyle(() => {
    const pinned = searching ? searching.get() : 0;
    return { opacity: interpolate(scrollY.get(), [0, LARGE_TITLE_SEARCH_HEIGHT / 2], [1, 0], "clamp") * (1 - pinned) + pinned };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: searching ? searching.get() : 0 }));
  const cancelStyle = useAnimatedStyle(() => {
    const shown = searching ? searching.get() : 0;
    return { opacity: shown, transform: [{ translateX: (1 - shown) * inset }] };
  });
  const active = search?.active ?? false;
  return <>
    <Animated.View onLayout={search?.onRowLayout} className="px-4 pb-2" style={[SEARCH_ORIGIN, rowStyle]}>
      {/* Rows scroll under the pinned field: this covers them up to the screen's top edge. */}
      {search ? <Animated.View pointerEvents="none" className="absolute inset-x-0 bottom-0 bg-background" style={[{ top: -insets.top - BACKDROP_REACH }, backdropStyle]} /> : null}
      <Animated.View style={contentStyle}>
        <SearchField
          value={field.value}
          onChangeText={field.onChangeText}
          placeholder={field.placeholder}
          inputRef={search?.inputRef}
          onFocus={search?.begin}
          trailing={search ? { inset, progress: search.progress, held: search.held } : undefined}
        />
        {search ? <Animated.View
          pointerEvents={active ? "auto" : "none"}
          accessibilityElementsHidden={!active}
          importantForAccessibility={active ? "auto" : "no-hide-descendants"}
          onLayout={(event) => setCancelWidth(event.nativeEvent.layout.width)}
          className="absolute bottom-0 right-0 top-0 justify-center"
          style={cancelStyle}
        >
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} onPress={search.cancel} hitSlop={CANCEL_SLOP} className="min-h-11 justify-center active:opacity-55">
            <Text numberOfLines={1} className="text-body text-accent">{t("common.cancel")}</Text>
          </Pressable>
        </Animated.View> : null}
      </Animated.View>
    </Animated.View>
    <View style={SEARCH_TAIL} />
  </>;
}

// UIKit leaves 8 pt between a search field and its Cancel.
const CANCEL_GAP = 8;
const CANCEL_SLOP = { top: 0, bottom: 0, left: 8, right: 16 } as const;
// The backdrop reaches past the status bar so an overscrolled list cannot show rows above it.
const BACKDROP_REACH = 120;

const SEARCH_ORIGIN = { transformOrigin: "top" } as const;
// UIKit's bar ends this much further below its search field than the row's own padding, so the list starts lower:
// iOS 27 puts the first row's title 49 px (27 pt) under the field.
const SEARCH_TAIL = { height: 2 } as const;

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
