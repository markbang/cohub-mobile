import { createContext, use, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type LayoutAnimationsValues, type SharedValue } from "react-native-reanimated";
import { runOnUISync } from "react-native-worklets";
import { arrivedKeys, listContinuityChange, withLeavingRows } from "@/src/data/list-continuity";
import { continuity, curves } from "@/src/motion";

/**
 * After a change that moves rows, layout changes animate for this long: long enough for LegendList to measure
 * and place the rows (a leaving row collapses a frame or two later), short enough that a later, unrelated
 * resize lands in place.
 */
const MOVE_WINDOW_MS = 400;
const MOVE_EASING = Easing.bezier(...curves.easeInOut);
const FADE_EASING = Easing.bezier(...curves.easeOut);

type RowState = { leaving: ReadonlySet<string>; arriving: ReadonlySet<string> };
const NO_ROWS: RowState = { leaving: new Set(), arriving: new Set() };
const RowStateContext = createContext<RowState>(NO_ROWS);

type Shown<T> = { source: readonly T[]; items: T[]; rows: RowState; list: string; query: string };

/**
 * Continuity for a tab root's LegendList (Chats, Spaces). A change that keeps the list moves the rows on screen to
 * their new places, collapses rows that left while they fade where they stood, and fades in rows that arrived.
 * Nothing animates for the first rows, a page appended at the end, another list (`list`, e.g. a filter), or while
 * `quiet` (loading, refreshing, a finger on the list). While a search `query` holds still, rows that change came
 * from elsewhere (remote results landing), so they fade without moving anything.
 *
 * The list must be `AnimatedLegendList` with `itemLayoutAnimation`, its header's root given `onHeaderLayout`,
 * each row wrapped in `ListContinuityRow`, and the whole list in `ListContinuityProvider`. Rows move by a transform on
 * LegendList's own row containers, so recycling and scrolling are untouched; only rows whose start and end are
 * both on screen move. Under Reduce Motion rows land in place and only fade.
 */
export function useListContinuity<T>({ items, keyOf, list, query, quiet, scrollY, contentInset }: {
  items: readonly T[];
  keyOf: (item: T) => string;
  list: string;
  query: string;
  quiet: () => boolean;
  scrollY: SharedValue<number>;
  /** The list's top padding, above its header. */
  contentInset: number;
}) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<Shown<T>>(() => ({ source: items, items: [...items], rows: NO_ROWS, list, query }));
  const movingUntil = useSharedValue(0);
  const rowsTop = useSharedValue(contentInset);
  const viewport = useSharedValue(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => { rowsTop.set(contentInset + headerHeight); }, [contentInset, headerHeight, rowsTop]);
  const visibleKeys = useRef<ReadonlySet<string>>(new Set());

  // The new rows reach the list a commit after they arrive, so a move is armed on the UI thread before LegendList
  // lays them out: the layout transition below reads `movingUntil` as that layout lands.
  const armedUntil = useRef(0);
  useLayoutEffect(() => {
    if (shown.source === items) return;
    const previousKeys = shown.items.filter((item) => !shown.rows.leaving.has(keyOf(item))).map(keyOf);
    const nextKeys = items.map(keyOf);
    const fadeOnly = query !== "" && query === shown.query;
    const change = listContinuityChange(previousKeys, nextKeys, { sameList: shown.list === list, quiet: quiet(), fadeOnly });
    const leavingRows = change === "fade" || change === "move" ? withLeavingRows(shown.items, items, keyOf) : null;
    const arriving = leavingRows ? arrivedKeys(previousKeys, nextKeys) : new Set<string>();
    const shouldMove = change === "move" && !reducedMotion && leavingRows !== null && touchesScreen(previousKeys, nextKeys, leavingRows.leaving, arriving, visibleKeys.current);
    // A change that must not move cuts short a move still armed from the one before.
    const until = shouldMove ? Date.now() + MOVE_WINDOW_MS : 0;
    if (shouldMove || armedUntil.current > Date.now()) {
      armedUntil.current = until;
      runOnUISync(() => {
        "worklet";
        movingUntil.set(until);
      });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the rows reach the list a commit late on purpose, after the move is armed.
    setShown(leavingRows
      ? { source: items, items: leavingRows.items, rows: { leaving: leavingRows.leaving, arriving }, list, query }
      : { source: items, items: [...items], rows: NO_ROWS, list, query });
  }, [items, keyOf, list, movingUntil, query, quiet, reducedMotion, shown]);

  // Rows that left are dropped once they have faded; rows that arrived later, by scrolling in, simply show.
  useEffect(() => {
    if (shown.rows === NO_ROWS) return;
    const settle = Math.max(continuity.rowLeave.duration, continuity.rowEnter.duration);
    const timer = setTimeout(() => setShown((current) => current === shown ? { ...current, items: current.items.filter((item) => !current.rows.leaving.has(keyOf(item))), rows: NO_ROWS } : current), settle);
    return () => clearTimeout(timer);
  }, [keyOf, shown]);

  // Slides in flight, by the place each is heading to. LegendList often lays a sliding row out again in place (a
  // fresh measurement); Reanimated then replaces the slide, so the part still to go is resumed rather than left
  // on the row. Only a row that stays put looks itself up: its target is its own, while a row that moves may
  // start where another row is now heading. A row moved again mid-slide starts from its laid-out place.
  const slides = useSharedValue<Record<number, { start: number; shift: number }>>({});
  const itemLayoutAnimation = useMemo(() => (values: LayoutAnimationsValues) => {
    "worklet";
    const now = Date.now();
    const duration = continuity.rowMove.duration;
    let shift = values.currentOriginY - values.targetOriginY;
    if (Math.abs(shift) < 0.5) {
      const inFlight = slides.get()[Math.round(values.targetOriginY)];
      const elapsed = inFlight ? (now - inFlight.start) / duration : 1;
      if (inFlight && elapsed < 1) shift = inFlight.shift * (1 - MOVE_EASING.factory()(elapsed));
    }
    const top = scrollY.get() - rowsTop.get();
    const bottom = top + viewport.get();
    const onScreen = (y: number, height: number) => y + height > top && y < bottom;
    if (now > movingUntil.get() || Math.abs(shift) < 0.5 || !onScreen(values.currentOriginY, values.currentHeight) || !onScreen(values.targetOriginY, values.targetHeight)) {
      // Lands in place, clearing whatever offset a cut-short slide left on the row.
      return { initialValues: { transform: [{ translateY: 0 }] }, animations: { transform: [{ translateY: withTiming(0, { duration: 0 }) }] } };
    }
    slides.modify((current) => {
      "worklet";
      const next: Record<number, { start: number; shift: number }> = {};
      for (const key in current) if (now - current[key]!.start < duration) next[key] = current[key]!;
      next[Math.round(values.targetOriginY)] = { start: now, shift };
      return next;
    });
    return {
      initialValues: { transform: [{ translateY: shift }] },
      animations: { transform: [{ translateY: withTiming(0, { duration, easing: MOVE_EASING }) }] },
    };
  }, [movingUntil, rowsTop, scrollY, slides, viewport]);

  return {
    data: shown.items,
    rows: shown.rows,
    itemLayoutAnimation,
    onHeaderLayout: (event: LayoutChangeEvent) => setHeaderHeight(event.nativeEvent.layout.height),
    onListLayout: (event: LayoutChangeEvent) => viewport.set(event.nativeEvent.layout.height),
    /** Feed from `onViewableItemsChanged`: a change wholly off screen moves nothing. */
    setVisibleKeys: (keys: readonly string[]) => { visibleKeys.current = new Set(keys); },
  };
}

/**
 * Whether a change shows on screen: a row on screen leaves or changes places, or a row arrives next to one on
 * screen (a fork's rows open under their parent). One wholly off screen moves nothing on screen, and
 * LegendList may be holding the visible rows still while it lands.
 */
function touchesScreen(previous: readonly string[], next: readonly string[], leaving: ReadonlySet<string>, arriving: ReadonlySet<string>, visible: ReadonlySet<string>): boolean {
  if ([...leaving, ...reordered(previous, next)].some((key) => visible.has(key))) return true;
  return next.some((key, index) => {
    if (!arriving.has(key)) return false;
    if (visible.has(key)) return true;
    let before = index - 1;
    while (before >= 0 && arriving.has(next[before]!)) before -= 1;
    let after = index + 1;
    while (after < next.length && arriving.has(next[after]!)) after += 1;
    return visible.has(next[before] ?? "") || visible.has(next[after] ?? "");
  });
}

/** Keys shared by both lists whose order among each other changed. */
function reordered(previous: readonly string[], next: readonly string[]): string[] {
  const kept = new Set(next);
  const before = previous.filter((key) => kept.has(key));
  const still = new Set(before);
  const after = next.filter((key) => still.has(key));
  return after.filter((key, index) => before[index] !== key);
}

export function ListContinuityProvider({ rows, children }: { rows: RowState; children: ReactNode }) {
  return <RowStateContext value={rows}>{children}</RowStateContext>;
}

/**
 * One row of a continuity list. A leaving row keeps drawing where it stood, fading, while its slot collapses to
 * nothing so the rows below close the gap; an arriving row fades in. Neither takes touches or focus while fading out.
 */
export function ListContinuityRow({ rowKey, children }: { rowKey: string; children: ReactNode }) {
  const { leaving: leavingKeys, arriving } = use(RowStateContext);
  const leaving = leavingKeys.has(rowKey);
  const [arrived] = useState(() => arriving.has(rowKey));
  const opacity = useSharedValue(arrived ? 0 : 1);
  useEffect(() => {
    opacity.set(withTiming(leaving ? 0 : 1, leaving ? { duration: continuity.rowLeave.duration, easing: FADE_EASING } : { duration: continuity.rowEnter.duration, easing: FADE_EASING }));
  }, [leaving, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <View style={leaving ? LEAVING_SLOT : undefined} pointerEvents={leaving ? "none" : "auto"} accessibilityElementsHidden={leaving} importantForAccessibility={leaving ? "no-hide-descendants" : "auto"}>
    <Animated.View style={[leaving ? LEAVING_ROW : undefined, style]}>{children}</Animated.View>
  </View>;
}

const LEAVING_SLOT = { height: 0 } as const;
const LEAVING_ROW = { position: "absolute", top: 0, left: 0, right: 0 } as const;
