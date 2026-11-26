import { Redirect, useLocalSearchParams } from "expo-router";
import { TabBarFixtureList } from "@/src/components/TabBarFixtureList";
import { uiSnapshots } from "@/src/config";

/**
 * The tab bar's blur is fitted from a dense, fixed list under the bar, and the bar is drawn only by a tab's own
 * stack: this route lives in the Chats tab (so the bar stays over it) and `/debug/tab-bar` draws the same rows
 * with no bar, as the sharp reference. Only a snapshot build opens it.
 */
export default function TabBarFixtureScreen() {
  const { shift } = useLocalSearchParams<{ shift?: string }>();
  if (!uiSnapshots) return <Redirect href="/(tabs)" />;
  return <TabBarFixtureList shift={shift === "b" ? "b" : "a"} />;
}
