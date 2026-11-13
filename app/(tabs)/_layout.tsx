import { Tabs } from "expo-router";
import { AnimatedTabIcon } from "@/src/components/AnimatedTabIcon";
import { FloatingTabBar, TabBlurTargetsProvider, TabScreenLayout } from "@/src/components/FloatingTabBar";
import { TabRail } from "@/src/components/TabRail";
import { botOnly } from "@/src/data/bot-mode-preference";
import { useTranslation } from "@/src/i18n";
import { useDesktopSplit } from "@/src/ui/pane";
import { TabBarMinimizeProvider } from "@/src/ui/tab-bar-minimize";

// Seeds the tab app on Chats when a link opens a screen above it; without it Expo Router seeds the first route of its own route sort, (me).
export const unstable_settings = { anchor: "(chats)" };

export default function TabLayout() {
  const { t } = useTranslation();
  const rail = useDesktopSplit();
  // Tabs are peers, not a hierarchy: switching must never slide.
  return (
    <TabBlurTargetsProvider>
    <TabBarMinimizeProvider>
    <Tabs
      screenOptions={{ headerShown: false, animation: "none", tabBarPosition: rail ? "left" : "bottom" }}
      screenLayout={({ route, children }) => <TabScreenLayout routeKey={route.key}>{children}</TabScreenLayout>}
      tabBar={(props) => rail ? <TabRail {...props} /> : <FloatingTabBar {...props} />}
    >
      <Tabs.Screen
        name="(chats)"
        options={{
          title: t("tabs.chats"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="messages" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="(spaces)"
        options={{
          title: t("tabs.spaces"),
          // The Bot mode App reaches Spaces only as Bots.
          ...(botOnly ? { href: null } : {}),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="layers" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="(activity)"
        options={{
          title: t("tabs.activity"),
          ...(botOnly ? { href: null } : {}),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="activity" color={color} size={size} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="(me)"
        options={{
          title: t("tabs.me"),
          tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="user-circle" color={color} size={size} focused={focused} />,
        }}
      />
    </Tabs>
    </TabBarMinimizeProvider>
    </TabBlurTargetsProvider>
  );
}
