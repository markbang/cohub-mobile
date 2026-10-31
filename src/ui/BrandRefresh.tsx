import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTranslation } from "@/src/i18n";
import { springs } from "@/src/motion";
import { AppRefreshControl } from "@/src/ui/AppRefreshControl";
import { Mascot, MascotLoader } from "@/src/ui/Mascot";

/** The band a refresh holds open (UIRefreshControl's height); pulling past it commits. */
const BAND = 60;
const MASCOT = 36;
const REVEAL: [number, number] = [8, BAND];

type ScrollEvent = { nativeEvent: { contentOffset: { y: number } } };

export type BrandRefresh = ReturnType<typeof useBrandRefresh>;

/**
 * Pull to refresh drawn with the mascot, following the finger frame by frame.
 *
 * iOS keeps UIRefreshControl's gesture, rubber band, and trigger with its spinner cleared; the mascot
 * sits just above the content (`header`), so the pull uncovers it at the content's own pace.
 * Android's SwipeRefreshLayout hides the pull from JS, so `BrandRefreshArea` takes the gesture there:
 * once the list is at its top and the finger moves down, the list follows it on the UI thread with a
 * rubber band and the mascot grows in the gap; past the band a release refreshes.
 *
 * `scrollEventThrottle` is the list's own, so the iOS reveal can bridge a slow event rate.
 */
export function useBrandRefresh({ refreshing, onRefresh, scrollEventThrottle = 16 }: { refreshing: boolean; onRefresh: () => void; scrollEventThrottle?: number }) {
  const pull = useSharedValue(0);
  const atTop = useSharedValue(true);
  const dragStart = useRef<number | null>(null);
  // LegendList's types omit `refreshControl` even though it hands the element to its ScrollView.
  const listProps = useMemo(() => Platform.OS === "ios" ? { refreshControl: <AppRefreshControl brand refreshing={refreshing} onRefresh={onRefresh} /> } : {}, [onRefresh, refreshing]);
  const onScrollBeginDrag = useCallback((event: ScrollEvent) => { dragStart.current = event.nativeEvent.contentOffset.y; }, []);
  const onScroll = useCallback((event: ScrollEvent) => {
    const y = event.nativeEvent.contentOffset.y;
    atTop.set(y <= 1);
    if (Platform.OS !== "ios" || dragStart.current === null) return;
    // Measured from where the drag began, so no inset arithmetic: a drag from the top uncovers the
    // mascot, and one from further down leaves it far above the viewport.
    const distance = Math.max(0, dragStart.current - y);
    pull.set(scrollEventThrottle > 20 ? withTiming(distance, { duration: scrollEventThrottle }) : distance);
  }, [atTop, pull, scrollEventThrottle]);
  const header = useMemo(() => Platform.OS === "ios" ? <InContentMascot refreshing={refreshing} pull={pull} /> : null, [pull, refreshing]);
  return { listProps, header, onScroll, onScrollBeginDrag, refreshing, onRefresh, pull, atTop };
}

function RefreshMascot({ refreshing }: { refreshing: boolean }) {
  const { t } = useTranslation();
  return refreshing ? <MascotLoader size={MASCOT} accessibilityLabel={t("common.loading")} /> : <Mascot size={MASCOT} />;
}

function useReveal(pull: SharedValue<number>, refreshing: boolean) {
  return useAnimatedStyle(() => {
    const shown = refreshing ? 1 : interpolate(pull.get(), REVEAL, [0, 1], "clamp");
    return { opacity: shown, transform: [{ scale: 0.55 + shown * 0.45 }] };
  });
}

function InContentMascot({ refreshing, pull }: { refreshing: boolean; pull: SharedValue<number> }) {
  const reveal = useReveal(pull, refreshing);
  return <View pointerEvents="none" className="absolute left-0 right-0 items-center justify-center" style={{ top: -BAND, height: BAND }}>
    <Animated.View style={reveal}><RefreshMascot refreshing={refreshing} /></Animated.View>
  </View>;
}

/** iOS: UIScrollView's rubber band. Android pulls slow down the same way as they lengthen. */
function rubberBand(distance: number) {
  "worklet";
  const limit = BAND * 2.4;
  return limit * (1 - 1 / ((Math.max(0, distance) * 0.55) / limit + 1));
}

/**
 * Wraps a list that uses `useBrandRefresh`. On iOS it renders the list unchanged; on Android it owns the
 * pull. `top` is where the list's content begins on screen, under any header drawn over it.
 */
export function BrandRefreshArea({ refresh, top, children }: { refresh: BrandRefresh; top: number; children: ReactNode }) {
  if (Platform.OS === "ios") return children;
  return <AndroidPull refresh={refresh} top={top}>{children}</AndroidPull>;
}

function AndroidPull({ refresh, top, children }: { refresh: BrandRefresh; top: number; children: ReactNode }) {
  const { refreshing, onRefresh, pull, atTop } = refresh;
  const dragging = useSharedValue(false);
  const touchStart = useSharedValue({ x: 0, y: 0 });
  // While a refresh runs the band stays open; when it ends the list springs back unless a finger holds it.
  useEffect(() => {
    if (dragging.get()) return;
    pull.set(withSpring(refreshing ? BAND : 0, springs.sheet));
  }, [dragging, pull, refreshing]);
  const gesture = useMemo(() => Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0];
      if (touch) touchStart.set({ x: touch.absoluteX, y: touch.absoluteY });
    })
    .onTouchesMove((event, state) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      const dx = touch.absoluteX - touchStart.get().x;
      const dy = touch.absoluteY - touchStart.get().y;
      // Claim the touch before the list's own drag slop does, and only for a downward pull at the top;
      // anything else is the list's (or a horizontal pager's) to keep.
      if (!atTop.get() || dy < -2 || Math.abs(dx) > Math.abs(dy)) state.fail();
      else if (dy > 4) state.activate();
    })
    .onStart(() => { dragging.set(true); })
    .onUpdate((event) => { pull.set((refreshing ? BAND : 0) + rubberBand(event.translationY)); })
    // Only the release decides, so a pull that dips back under the band before letting go does not refresh.
    .onEnd(() => {
      const commit = pull.get() >= BAND;
      pull.set(withSpring(commit || refreshing ? BAND : 0, springs.sheet));
      if (commit && !refreshing) scheduleOnRN(onRefresh);
    })
    .onFinalize(() => { dragging.set(false); }), [atTop, dragging, onRefresh, pull, refreshing, touchStart]);

  const listStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.get() }] }));
  const reveal = useReveal(pull, refreshing);
  const place = useAnimatedStyle(() => ({ transform: [{ translateY: top + (pull.get() - MASCOT) / 2 }] }));
  return <GestureDetector gesture={gesture}>
    <View className="flex-1" collapsable={false}>
      <Animated.View pointerEvents="none" className="absolute left-0 right-0 items-center" style={place}>
        <Animated.View style={reveal}><RefreshMascot refreshing={refreshing} /></Animated.View>
      </Animated.View>
      <Animated.View className="flex-1" style={listStyle}>{children}</Animated.View>
    </View>
  </GestureDetector>;
}
