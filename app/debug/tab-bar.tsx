import { useLocalSearchParams } from "expo-router";
import { TabBarFixtureList } from "@/src/components/TabBarFixtureList";

/** The tab bar fixture with no bar over it: the sharp reference for the blurred band on the Chats tab. */
export default function TabBarFixtureScreen() {
  const { shift } = useLocalSearchParams<{ shift?: string }>();
  return <TabBarFixtureList shift={shift === "b" ? "b" : "a"} />;
}
