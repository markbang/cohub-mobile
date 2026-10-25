import type { Permission } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "@/src/components/Toast";
import { APP_SCOPES } from "@/src/data/app-manage";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { DataError, LoadingSections, PrimaryButton, Screen, SettingsGroup, TopBar } from "@/src/ui";

export default function WorkAccessScreen() {
  const { appId = "" } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [scopes, setScopes] = useState<Set<Permission> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!client || !appId) return;
    let active = true;
    void client.apps.get(appId)
      .then((result) => { if (active) { setScopes(new Set(result.app.appScopes)); setError(null); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : t("work.error")); });
    return () => { active = false; };
  }, [appId, attempt, client, t]);

  const save = async () => {
    if (!client || !scopes || saving) return;
    setSaving(true);
    try {
      // Scopes this screen does not list (granted elsewhere) are kept as they are.
      await client.apps.update(appId, { appScopes: [...scopes] });
      toast({ title: t("app.access.saved") });
      router.back();
    } catch (caught) {
      toast({ title: t("app.edit.saveFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return <Screen>
    <TopBar title={t("app.access.title")} onBack={() => router.back()} />
    {error && !scopes ? <DataError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : null}
    {!scopes ? (error ? null : <LoadingSections sections={[{ kind: "caption" }, { kind: "group", rows: 8, trailing: "switch" }, { kind: "capsule" }]} />) : <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
      <Text className="mb-4 px-8 text-caption text-fg-muted">{t("app.access.hint")}</Text>
      <SettingsGroup>
        {APP_SCOPES.map((scope, index) => <View key={scope} className={`min-h-16 flex-row items-center gap-3 bg-surface px-4 py-3 ${index === APP_SCOPES.length - 1 ? "" : "border-b border-border"}`}>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-body text-fg">{t(`app.scope.${scope}`)}</Text>
            <Text className="text-caption text-fg-muted">{t(`app.scope.${scope}.hint`)}</Text>
          </View>
          <Switch
            value={scopes.has(scope)}
            disabled={saving}
            accessibilityLabel={t(`app.scope.${scope}`)}
            onValueChange={(enabled) => setScopes((current) => { const next = new Set(current); if (enabled) next.add(scope); else next.delete(scope); return next; })}
            trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
            thumbColor={theme.colors.surface}
          />
        </View>)}
      </SettingsGroup>
      <PrimaryButton label={t("common.save")} loading={saving} onPress={() => void save()} className="mx-4" />
    </ScrollView>}
  </Screen>;
}
