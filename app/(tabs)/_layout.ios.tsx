import { NativeTabs } from "expo-router/native-tabs";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

/**
 * iOS uses the system tab bar: Liquid Glass, its lens, drag between tabs, and minimizing on scroll
 * are UIKit's. Android draws its own (`_layout.tsx`, `FloatingTabBar`). Each tab is a `TabStack` whose
 * root list sets its own inset adjustment under the navigation bar, so the tabs' automatic insets stay
 * off; bottom padding comes from `useFloatingTabBarInset`, which reads each tab's safe area.
 */
export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  return (
    <NativeTabs tintColor={theme.colors.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(chats)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.chats")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(spaces)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "square.stack.3d.up", selected: "square.stack.3d.up.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.spaces")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(activity)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf="waveform.path.ecg" />
        <NativeTabs.Trigger.Label>{t("tabs.activity")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(me)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.me")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
