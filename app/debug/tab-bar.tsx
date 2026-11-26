import { Redirect, useLocalSearchParams } from "expo-router";
import { TabBarFixtureList } from "@/src/components/TabBarFixtureList";
import { uiSnapshots } from "@/src/config";

/** The tab bar fixture with no bar over it: the sharp reference for the blurred band on the Chats tab. */
export default function TabBarFixtureScreen() {
  const { shift } = useLocalSearchParams<{ shift?: string }>();
  if (!uiSnapshots) return <Redirect href="/(tabs)" />;
  return <TabBarFixtureList shift={shift === "b" ? "b" : "a"} />;
}
