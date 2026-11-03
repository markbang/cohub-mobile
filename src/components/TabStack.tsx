import { Stack } from "expo-router";
import { useAppTheme } from "@/src/theme";

export type TabStackProps = { title: string };

export function TabStack(_props: TabStackProps) {
  const theme = useAppTheme();
  // design-system: navigator contentStyle is a native prop
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />;
}
