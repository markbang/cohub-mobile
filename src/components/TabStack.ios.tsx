import { Stack } from "expo-router";
import { useAppTheme } from "@/src/theme";
import { liquidGlass } from "@/src/ui/Glass";

// The title is set here so the bar is in place on the first frame.
export function TabStack({ title }: { title: string }) {
  const theme = useAppTheme();
  return <Stack screenOptions={{
    title,
    headerShown: true,
    headerLargeTitle: true,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    // design-system-begin: navigator header styles are native props that only take JS colors.
    headerTintColor: theme.colors.text,
    headerTitleStyle: { color: theme.colors.text },
    headerLargeTitleStyle: { color: theme.colors.text },
    // design-system-end
    // Before Liquid Glass, a collapsed bar over scrolled content needs its material.
    headerBlurEffect: liquidGlass ? undefined : "systemChromeMaterial",
    // design-system: navigator contentStyle is a native prop
    contentStyle: { backgroundColor: theme.colors.background },
  }} />;
}
