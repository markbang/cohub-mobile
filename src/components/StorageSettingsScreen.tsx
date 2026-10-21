import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { CACHE_RETENTION_OPTIONS, setCacheRetention, useCacheRetention, type CacheRetention } from "@/src/data/cache-retention";
import { useApp } from "@/src/data/context";
import { useTranslation, type Translate } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { TopBar, Screen } from "@/src/ui";

export function StorageSettingsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const { state, clearCache, applyCacheRetention } = useApp();
  const retention = useCacheRetention();
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmClearCache = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearCache();
      setClearOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("profile.clearCache.error"));
    } finally {
      setBusy(false);
    }
  };
  const selectRetention = async (next: CacheRetention) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setCacheRetention(next);
      await applyCacheRetention();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("profile.cacheRetention.error"));
    } finally {
      setBusy(false);
    }
  };
  return <Screen>
    <TopBar title={t("settings.storage.title")} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}>
      <SettingsRow icon="database" title={t("profile.data.spaces")} value={String(state.spaces.length)} />
      <SettingsRow icon="messages" title={t("profile.data.chats")} value={String(state.sessions.length)} />
      {/* Retention is a short single choice, picked in place like Language; clearing asks first. */}
      <SettingsSelectRow<CacheRetention>
        icon="clock"
        title={t("profile.data.retention")}
        value={retention}
        disabled={busy}
        options={CACHE_RETENTION_OPTIONS.map((option) => ({ value: option, label: retentionLabel(option, t) }))}
        onChange={(next) => void selectRetention(next)}
        testID="cache-retention-select"
      />
      <SettingsRow icon="trash" title={t("profile.data.clearCache")} onPress={() => { setError(null); setClearOpen(true); }} danger />
      {error && !clearOpen ? <Text accessibilityRole="alert" className="px-4 pt-3 text-caption text-danger">{error}</Text> : null}
    </ScrollView>
    <ConfirmSheet
      visible={clearOpen}
      title={t("profile.clearCache.title")}
      message={t("profile.clearCache.body")}
      confirmLabel={t("profile.clearCache.action")}
      confirmIcon="trash"
      busy={busy}
      error={error}
      onConfirm={() => void confirmClearCache()}
      onClose={() => setClearOpen(false)}
      testID="clear-cache-sheet"
    />
  </Screen>;
}

function retentionLabel(option: CacheRetention, t: Translate): string {
  if (option === "1d") return t("profile.cacheRetention.option.oneDay");
  if (option === "forever") return t("profile.cacheRetention.option.forever");
  return t("profile.cacheRetention.option.days", { days: option === "7d" ? 7 : 30 });
}
