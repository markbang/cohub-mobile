import { useCallback, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "@/src/i18n";
import { AppRefreshControl } from "@/src/ui/AppRefreshControl";
import { Mascot, MascotLoader } from "@/src/ui/Mascot";

/** The band UIRefreshControl holds open while refreshing; the mascot sits centred in it. */
const BAND = 60;
const MASCOT = 36;

type ScrollEvent = { nativeEvent: { contentOffset: { y: number } } };

/**
 * Pull to refresh drawn with the mascot. The platform keeps the gesture, its rubber band, and its
 * trigger distance; only the indicator is ours. On iOS the mascot sits just above the content, so a
 * pull reveals it in the gap the content leaves and it waits there while the refresh runs. Android has
 * no such gap, so its own circle stays off screen and the mascot takes a row at the top while it runs.
 *
 * Spread `listProps` on the list, call `onScroll` and `onScrollBeginDrag` from the list's own handlers,
 * and put `header` first in its header.
 */
export function useBrandRefresh({ refreshing, onRefresh, progressViewOffset }: { refreshing: boolean; onRefresh: () => void; progressViewOffset?: number }) {
  const pull = useSharedValue(0);
  const dragStart = useRef<number | null>(null);
  // LegendList's types omit `refreshControl` even though it hands the element to its ScrollView.
  const listProps = useMemo(() => ({ refreshControl: <AppRefreshControl brand refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={progressViewOffset} /> }), [onRefresh, progressViewOffset, refreshing]);
  // The pull is measured from where the drag began, so no inset arithmetic is needed: a drag from the
  // top reveals the mascot, and one from further down leaves it far above the viewport.
  const onScrollBeginDrag = useCallback((event: ScrollEvent) => { dragStart.current = event.nativeEvent.contentOffset.y; }, []);
  const onScroll = useCallback((event: ScrollEvent) => {
    if (dragStart.current === null) return;
    pull.set(withTiming(Math.max(0, dragStart.current - event.nativeEvent.contentOffset.y), { duration: 80 }));
  }, [pull]);
  const header = useMemo(() => <RefreshMascot refreshing={refreshing} pull={pull} />, [pull, refreshing]);
  return { listProps, header, onScroll, onScrollBeginDrag };
}

function RefreshMascot({ refreshing, pull }: { refreshing: boolean; pull: ReturnType<typeof useSharedValue<number>> }) {
  const { t } = useTranslation();
  const reveal = useAnimatedStyle(() => refreshing
    ? { opacity: 1, transform: [{ scale: 1 }] }
    : { opacity: interpolate(pull.get(), [12, BAND - 4], [0, 1], "clamp"), transform: [{ scale: interpolate(pull.get(), [12, BAND - 4], [0.6, 1], "clamp") }] });
  const mascot = refreshing ? <MascotLoader size={MASCOT} accessibilityLabel={t("common.loading")} /> : <Mascot size={MASCOT} />;
  if (Platform.OS === "android") return refreshing ? <View className="items-center justify-center" style={{ height: BAND }}>{mascot}</View> : null;
  return <View pointerEvents="none" className="absolute left-0 right-0 items-center justify-center" style={{ top: -BAND, height: BAND }}>
    <Animated.View style={reveal}>{mascot}</Animated.View>
  </View>;
}
