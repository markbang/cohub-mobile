import { Stack } from "expo-router";
import type { NativeStackNativeProps } from "expo-router/build/react-navigation/native-stack/types";
import { useAppTheme } from "@/src/theme";
import { liquidGlass } from "@/src/ui/Glass";
import type { TabStackProps } from "./TabStack";

// ScreenStackItem reads this; expo-router spreads `unstable_nativeProps` onto it but types only the Screen props.
const TAB_ROOT_NATIVE_PROPS = { unstable_safeAreaEdges: { top: false } } as NativeStackNativeProps;

// The title is set here so the bar is in place on the first frame.
export function TabStack({ title }: TabStackProps) {
  const theme = useAppTheme();
  return <Stack screenOptions={{
    title,
    headerShown: true,
    headerLargeTitle: true,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    // On iOS 26 react-native-screens wraps the content in a top safe-area view, which kept the Large
    // Title from collapsing on scroll; the lists' automatic content insets already clear the bar.
    unstable_nativeProps: TAB_ROOT_NATIVE_PROPS,
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
