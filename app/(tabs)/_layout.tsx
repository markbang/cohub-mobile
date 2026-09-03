import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Platform, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type IconName } from "@/src/ui";
import { useAppTheme } from "@/src/theme";

const TAB_BAR_EXTRA_BOTTOM_SPACE = 10;
const TAB_BAR_CONTENT_HEIGHT = 64;

export default function TabLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const bottomSpace = Math.max(insets.bottom, 0) + TAB_BAR_EXTRA_BOTTOM_SPACE;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textFaint,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: TAB_BAR_CONTENT_HEIGHT + bottomSpace,
          paddingTop: 6,
          paddingBottom: bottomSpace,
          paddingHorizontal: 4,
          shadowColor: theme.colors.shadow,
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.12,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginBottom: 1 },
        tabBarItemStyle: { minHeight: 52, marginHorizontal: 3, marginVertical: 3, borderRadius: 18 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Chats", tabBarIcon: (props) => <TabIcon name="messages" {...props} /> }} />
      <Tabs.Screen name="spaces" options={{ title: "Spaces", tabBarIcon: (props) => <TabIcon name="layers" {...props} /> }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: (props) => <TabIcon name="activity" {...props} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: (props) => <TabIcon name="user" {...props} /> }} />
    </Tabs>
  );
}

function TabIcon({ name, color, size, focused }: { name: IconName; color: ColorValue; size: number; focused: boolean }) {
  const [scale] = useState(() => new Animated.Value(focused ? 1 : 0.92));
  const [translateY] = useState(() => new Animated.Value(focused ? -1 : 1));
  const [opacity] = useState(() => new Animated.Value(focused ? 1 : 0.78));

  useEffect(() => {
    const driver = Platform.OS !== "web";
    Animated.parallel([
      Animated.spring(scale, {
        toValue: focused ? 1 : 0.92,
        damping: 13,
        stiffness: 220,
        mass: 0.7,
        useNativeDriver: driver,
      }),
      Animated.spring(translateY, {
        toValue: focused ? -1 : 1,
        damping: 14,
        stiffness: 220,
        mass: 0.7,
        useNativeDriver: driver,
      }),
      Animated.timing(opacity, {
        toValue: focused ? 1 : 0.78,
        duration: 180,
        useNativeDriver: driver,
      }),
    ]).start();
  }, [focused, opacity, scale, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }, { translateY }] }}>
      <AppIcon name={name} color={color} size={Math.min(size, 24)} strokeWidth={focused ? 2.3 : 1.8} />
    </Animated.View>
  );
}
