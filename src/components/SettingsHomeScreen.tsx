import { useRouter, useScrollToTop } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useCurrentUser } from "@/src/auth/current-user";
import { useProfileSession } from "@/src/auth/profile-session";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { saveBrowserPreference, useBrowserPreference, type BrowserPreference } from "@/src/data/browser-preference";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { useToast } from "@/src/components/Toast";
import { useDebugUnlock } from "@/src/components/useDebugUnlock";
import { useApp } from "@/src/data/context";
import { settingsMenu } from "@/src/data/settings-navigation";
import { useTranslation, type LocalePreference } from "@/src/i18n";
import { getInstalledAppVersion } from "@/src/platform/app-updates";
import { currentUpdateChannel } from "@/src/platform/update-channel";
import { useThemePreference } from "@/src/theme";
import { AppIcon, Avatar, Screen, SettingsGroup } from "@/src/ui";
import { NAVIGATION_BAR_INSETS, nativeHeaders } from "@/src/ui/NativeHeader";

export function SettingsHomeScreen() {
  const tabBarInset = useFloatingTabBarInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const { t, preference: language, setPreference: setLanguage } = useTranslation();
  const showToast = useToast();
  // A press sliding through a pop-up menu must not scroll the page under it.
  const [selecting, setSelecting] = useState(false);
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
    return undefined;
  };

  return <Screen edgeToEdge={nativeHeaders}>
    <ScrollView ref={scrollRef} scrollEnabled={!selecting} {...(nativeHeaders ? NAVIGATION_BAR_INSETS : null)} contentContainerStyle={{ paddingBottom: tabBarInset }} keyboardShouldPersistTaps="handled">
      {/* The profile is a row like any other setting, not a hero; it drills into profile editing. */}
      <View className="mb-6 mt-4 px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("settings.section.profile")}
          onPress={() => router.push("/settings/profile")}
          className="min-h-18 flex-row items-center gap-3 rounded-md bg-surface py-3 pl-3 pr-2 active:bg-surface-pressed"
          style={{ borderCurve: "continuous" }}
        >
          <Avatar name={name} uri={avatar} size={48} />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-headline font-semibold text-fg">{name}</Text>
            {email ? <Text numberOfLines={1} className="text-subhead text-fg-muted">{email}</Text> : null}
          </View>
          <AppIcon name="chevron-right" size={16} tone="faint" />
        </Pressable>
      </View>
      <View testID="settings-list">
        {settingsMenu.map((group) => <SettingsGroup key={group.labelKey} label={t(group.labelKey)}>
          {group.items.map((item, index) => {
            const last = index === group.items.length - 1;
            // Short single choices are picked in place from a pop-up menu; their pages stay reachable by link.
            if (item.href === "/language") return <SettingsSelectRow<LocalePreference>
              key={item.href}
              icon={item.icon}
              title={t(item.labelKey)}
              value={language}
              options={[
                { value: "system", label: t("language.option.system") },
                { value: "en", label: t("language.option.en") },
                { value: "zh", label: t("language.option.zh") },
              ]}
              onChange={(next) => void setLanguage(next)}
              onOpenChange={setSelecting}
              last={last}
              testID="settings-language-select"
            />;
            if (item.href === "/settings/browser") return <SettingsSelectRow<BrowserPreference>
              key={item.href}
              icon={item.icon}
              title={t(item.labelKey)}
              value={browser.preference}
              disabled={!browser.loaded && !browser.error}
              options={[
                { value: "system", label: t("settings.browser.system") },
                { value: "in-app", label: t("settings.browser.inApp") },
              ]}
              onChange={(next) => void saveBrowserPreference(next).catch(() => showToast({ title: t("settings.browser.saveFailed"), tone: "danger" }))}
              onOpenChange={setSelecting}
              last={last}
              testID="settings-browser-select"
            />;
            return <SettingsRow
              key={item.href}
              icon={item.icon}
              title={t(item.labelKey)}
              detail={detailFor(item.href)}
              last={last}
              onPress={() => router.push(item.href)}
            />;
          })}
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
    <ConfirmSheet
      visible={signOutOpen}
      title={t("profile.signOut.title")}
      subtitle={t("profile.signOut.subtitle")}
      message={t("profile.signOut.body")}
      confirmLabel={t("common.signOut")}
      confirmIcon="arrow-right"
      busy={signingOut}
      error={error}
      onConfirm={() => void confirmSignOut()}
      onClose={() => setSignOutOpen(false)}
      testID="sign-out-sheet"
    />
  </Screen>;
}
