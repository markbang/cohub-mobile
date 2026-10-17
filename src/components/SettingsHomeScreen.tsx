import { Link, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser } from "@/src/auth/current-user";
import { useProfileSession } from "@/src/auth/profile-session";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { useBrowserPreference } from "@/src/data/browser-preference";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useDebugUnlock } from "@/src/components/useDebugUnlock";
import { useApp } from "@/src/data/context";
import { settingsMenu } from "@/src/data/settings-navigation";
import { useTranslation } from "@/src/i18n";
import { getInstalledAppVersion } from "@/src/platform/app-updates";
import { currentUpdateChannel } from "@/src/platform/update-channel";
import { useAppTheme, useThemePreference } from "@/src/theme";
import { AppIcon, Avatar, PrimaryButton, Screen, SettingsGroup, TopBar } from "@/src/ui";

export function SettingsHomeScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t, preference: language } = useTranslation();
  const appearance = useThemePreference();
  const browser = useBrowserPreference();
  const router = useRouter();
  const { signOut } = useProfileSession();
  const { name, email, avatar } = useCurrentUser();
  const { clearCache } = useApp();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = getInstalledAppVersion();
  // Preview channels are opted into from the debug menu; keep that visible outside it.
  const updateChannel = currentUpdateChannel();
  const openDebug = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    router.push("/debug");
  }, [router]);
  const unlockDebug = useDebugUnlock(openDebug);

  const confirmSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      try {
        await clearCache();
      } catch {
        setError(t("profile.clearCache.partialError"));
      }
      await signOut();
      setSignOutOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("profile.signOut.error"));
    } finally {
      setSigningOut(false);
    }
  };

  const detailFor = (href: string) => {
    if (href === "/appearance") return t(`appearance.theme.${appearance}`);
    if (href === "/language") return t(language === "system" ? "language.option.system" : language === "en" ? "language.device.english" : "language.device.chinese");
    if (href === "/settings/browser") return t(browser.preference === "in-app" ? "settings.browser.inApp" : "settings.browser.system");
    return undefined;
  };

  return <Screen>
    <TopBar title={t("settings.title")} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }} keyboardShouldPersistTaps="handled">
      {/* The profile is a row like any other setting, not a hero; it drills into profile editing. */}
      <View className="mb-6 mt-2 px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.section.profile")}
          onPress={() => router.push("/settings/profile")}
          className="min-h-18 flex-row items-center gap-3 rounded-md bg-surface py-3 pl-3 pr-2 active:bg-surface-pressed"
          style={{ borderCurve: "continuous" }}
        >
          <Link.AppleZoomTarget><Avatar name={name} uri={avatar} size={48} /></Link.AppleZoomTarget>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-headline font-semibold text-fg">{name}</Text>
            {email ? <Text numberOfLines={1} className="text-subhead text-fg-muted">{email}</Text> : null}
          </View>
          <AppIcon name="chevron-right" size={16} tone="faint" />
        </Pressable>
      </View>
      <View testID="settings-list">
        {settingsMenu.map((group) => <SettingsGroup key={group.labelKey} label={t(group.labelKey)}>
          {group.items.map((item, index) => <SettingsRow
            key={item.href}
            icon={item.icon}
            title={t(item.labelKey)}
            detail={detailFor(item.href)}
            last={index === group.items.length - 1}
            onPress={() => router.push(item.href)}
          />)}
        </SettingsGroup>)}
      </View>
      <SettingsGroup>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.signOut")}
          disabled={signingOut}
          onPress={() => { setError(null); setSignOutOpen(true); }}
          className="min-h-13 items-center justify-center bg-surface active:bg-danger-soft"
        ><Text className="text-body font-semibold text-danger">{signingOut ? t("profile.signingOut") : t("common.signOut")}</Text></Pressable>
      </SettingsGroup>
      <Pressable testID="settings.version" accessibilityRole="button" accessibilityLabel={t("profile.version")} onPress={unlockDebug} className="min-h-11 items-center justify-center">
        <Text className="text-center text-micro tabular-nums text-fg-faint">Cohub Mobile · {version}{updateChannel && updateChannel !== "production" ? ` · ${updateChannel}` : ""}</Text>
      </Pressable>
    </ScrollView>
    <AdaptiveSheet
      visible={signOutOpen}
      title={t("profile.signOut.title")}
      subtitle={t("profile.signOut.subtitle")}
      onClose={() => { if (!signingOut) setSignOutOpen(false); }}
      dismissible={!signingOut}
      scrollable={false}
      testID="sign-out-sheet"
      footer={<PrimaryButton label={t("common.signOut")} icon="arrow-right" variant="danger" loading={signingOut} onPress={() => void confirmSignOut()} />}
    >
      <Text className="text-body text-fg-secondary">{t("profile.signOut.body")}</Text>
      {error ? <Text accessibilityRole="alert" className="mt-3 text-caption text-danger">{error}</Text> : null}
    </AdaptiveSheet>
  </Screen>;
}
