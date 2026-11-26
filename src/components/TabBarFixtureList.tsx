import { Text, useWindowDimensions, View } from "react-native";

/**
 * A fixed list of dense, high-contrast lines for fitting the tab bar's glass: one row is two 17 pt lines of
 * semibold text, and a row is exactly as tall as the band the fit may use. It draws no scroll view, so the bar
 * stays expanded, and it places the rows from the window's bottom edge, so one shift puts the same lines in the
 * band here and on the plain debug screen that has no bar.
 *
 * The bar's rim was measured on the iOS 27 phone at 3×: top 2374 px, bottom 2558 px of a 2622 px window.
 */
export const TAB_BAR_RIM = { top: 82.67, bottom: 21.33 };
/** What counts: from 9 pt below the top rim to 20 pt above the bottom rim; the lens mirrors the rest. */
export const TAB_BAR_BAND_INSETS = { top: 9, bottom: 20 };
export const TAB_BAR_LINE_HEIGHT = 20;
export const TAB_BAR_ROW_HEIGHT = TAB_BAR_LINE_HEIGHT * 2;
/** A quarter of a row: a half would move the lines exactly one line and land on the same grid. */
export const TAB_BAR_SHIFT = TAB_BAR_ROW_HEIGHT / 4;
/** Enough rows to cover the lower part of the window and the band, leaving the top clear of text. */
const ROWS = 16;

const pad = (index: number) => String(index + 1).padStart(2, "0");

export type TabBarFixtureShift = "a" | "b";

export function TabBarFixtureList({ shift }: { shift: TabBarFixtureShift }) {
  const { height } = useWindowDimensions();
  const bandTop = height - TAB_BAR_RIM.top + TAB_BAR_BAND_INSETS.top;
  const top = height - ROWS * TAB_BAR_ROW_HEIGHT;
  // A row starts where the band does (its top is `bandTop` modulo a row, from the rows' own top); `b` lifts them.
  const offset = ((bandTop - top) % TAB_BAR_ROW_HEIGHT) - (shift === "b" ? TAB_BAR_SHIFT : 0);
  const line = { fontSize: 17, lineHeight: TAB_BAR_LINE_HEIGHT, fontWeight: "600" as const };
  return (
    <View className="absolute inset-0 bg-background">
      <View style={{ position: "absolute", left: 0, right: 0, top, height: ROWS * TAB_BAR_ROW_HEIGHT, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, transform: [{ translateY: offset }] }}>
          {Array.from({ length: ROWS }, (_, index) => (
            <View key={index} style={{ height: TAB_BAR_ROW_HEIGHT, paddingHorizontal: 16, justifyContent: "center" }}>
              <Text numberOfLines={1} className="text-fg" style={line}>{`Row ${pad(index)} · invoice draft`}</Text>
              <Text numberOfLines={1} className="text-fg-secondary" style={line}>{`Row ${pad(index)} · marked as paid`}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text className="text-fg-faint" style={{ position: "absolute", right: 16, top: 8, fontSize: 11, fontWeight: "500" }}>{`tab bar fixture · ${shift}`}</Text>
    </View>
  );
}
