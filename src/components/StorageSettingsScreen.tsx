import { useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { retentionLabel, useStorageSettings } from "@/src/components/use-storage-settings";
import { CACHE_RETENTION_OPTIONS, type CacheRetention } from "@/src/data/cache-retention";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { TopBar, Screen } from "@/src/ui";

export function StorageSettingsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const router = useRouter();
  const storage = useStorageSettings();
  return <Screen>
    <TopBar title={t("settings.storage.title")} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}>
      <SettingsRow icon="database" title={t("profile.data.spaces")} value={String(storage.spaceCount)} />
      <SettingsRow icon="messages" title={t("profile.data.chats")} value={String(storage.chatCount)} />
      {/* Retention is a short single choice, picked in place like Language; clearing asks first. */}
      <SettingsSelectRow<CacheRetention>
        icon="clock"
        title={t("profile.data.retention")}
        value={storage.retention}
        disabled={storage.busy}
        options={CACHE_RETENTION_OPTIONS.map((option) => ({ value: option, label: retentionLabel(option, t) }))}
        onChange={(next) => void storage.selectRetention(next)}
        testID="cache-retention-select"
      />
      <SettingsRow icon="trash" title={t("profile.data.clearCache")} onPress={storage.openClear} danger />
      {storage.error && !storage.clearOpen ? <Text accessibilityRole="alert" className="px-4 pt-3 text-caption text-danger">{storage.error}</Text> : null}
    </ScrollView>
    <ConfirmSheet
      visible={storage.clearOpen}
      title={t("profile.clearCache.title")}
      message={t("profile.clearCache.body")}
      confirmLabel={t("profile.clearCache.action")}
      confirmIcon="trash"
      busy={storage.busy}
      error={storage.error}
      onConfirm={() => void storage.confirmClearCache()}
      onClose={storage.closeClear}
      testID="clear-cache-sheet"
    />
  </Screen>;
}
