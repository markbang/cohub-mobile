import { Tabs } from "expo-router";
import { AnimatedTabIcon } from "@/src/components/AnimatedTabIcon";
import { FloatingTabBar, TabBlurTargetsProvider, TabScreenLayout } from "@/src/components/FloatingTabBar";
import { useTranslation } from "@/src/i18n";

export default function TabLayout() {
  const { t } = useTranslation();
  // Tabs are peers, not a hierarchy: switching must never slide.
  return (
    <TabBlurTargetsProvider>
    <Tabs
      screenOptions={{ headerShown: false, animation: "none" }}
      screenLayout={({ route, children }) => <TabScreenLayout routeKey={route.key}>{children}</TabScreenLayout>}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.chats"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="messages" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="spaces"
        options={{
          title: t("tabs.spaces"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="layers" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t("tabs.activity"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="activity" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.me"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="user" color={color} size={size} focused={focused} />,
        }}
      />
    </Tabs>
    </TabBlurTargetsProvider>
  );
}
