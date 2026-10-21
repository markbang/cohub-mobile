import { NativeTabs } from "expo-router/native-tabs";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

/**
 * iOS uses the system tab bar: Liquid Glass, its lens, drag between tabs, and minimizing on scroll
 * are UIKit's. Android draws its own (`_layout.tsx`, `FloatingTabBar`). Tab screens lay out their own
 * headers and insets, so the system's automatic scroll insets stay off; their bottom padding comes
 * from `useFloatingTabBarInset`, which reads each tab's safe area.
 */
export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  return (
    <NativeTabs tintColor={theme.colors.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.chats")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="spaces" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "square.stack.3d.up", selected: "square.stack.3d.up.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.spaces")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf="waveform.path.ecg" />
        <NativeTabs.Trigger.Label>{t("tabs.activity")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.me")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
