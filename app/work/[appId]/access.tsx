import type { AppDetailResponse, Permission } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "@/src/components/Toast";
import { APP_SCOPES } from "@/src/data/app-manage";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/src/i18n";
import { AppSwitch, DataError, LoadingSections, PrimaryButton, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { GroupSeparator } from "@/src/components/GroupRow";

export default function WorkAccessScreen() {
  const { appId = "" } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useAppActions();
  const queryClient = useQueryClient();
  const detailKey = [`app:${appId}:detail`];
  const detailQuery = useScreenQuery({
    queryKey: detailKey,
    queryFn: (): Promise<AppDetailResponse> => client!.apps.get(appId),
    enabled: Boolean(client && appId),
  });
  const error = detailQuery.error ? detailQuery.error.message || t("work.error") : null;
  // Edits are a local draft over the fetched scopes, so a background read never resets toggles.
  const [draft, setDraft] = useState<Set<Permission> | null>(null);
  const fetched = detailQuery.data?.app.appScopes;
  const scopes = draft ?? (fetched ? new Set(fetched) : null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!client || !scopes || saving) return;
    setSaving(true);
    try {
      // Scopes this screen does not list (granted elsewhere) are kept as they are.
      const result = await client.apps.update(appId, { appScopes: [...scopes] });
      queryClient.setQueryData<AppDetailResponse>(detailKey, (current) => current ? { ...current, app: result.app } : current);
      toast({ title: t("app.access.saved"), tone: "success" });
      router.back();
    } catch (caught) {
      toast({ title: t("app.edit.saveFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return <Screen>
    <TopBar title={t("app.access.title")} onBack={() => router.back()} />
    {error && !scopes ? <DataError message={error} onRetry={() => void detailQuery.refetch()} /> : null}
    {!scopes ? (error ? null : <LoadingSections sections={[{ kind: "caption" }, { kind: "group", rows: 8, trailing: "switch" }, { kind: "capsule" }]} />) : <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
      <Text className="mb-4 px-8 text-caption text-fg-muted">{t("app.access.hint")}</Text>
      <SettingsGroup>
        {APP_SCOPES.map((scope, index) => <View key={scope} className="min-h-16 flex-row items-center gap-3 bg-surface px-4 py-3">
          {index === APP_SCOPES.length - 1 ? null : <GroupSeparator inset="text" />}
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-body text-fg">{t(`app.scope.${scope}`)}</Text>
            <Text className="text-caption text-fg-muted">{t(`app.scope.${scope}.hint`)}</Text>
          </View>
          <AppSwitch
            value={scopes.has(scope)}
            disabled={saving}
            accessibilityLabel={t(`app.scope.${scope}`)}
            onValueChange={(enabled) => setDraft(() => { const next = new Set(scopes); if (enabled) next.add(scope); else next.delete(scope); return next; })}
          />
        </View>)}
      </SettingsGroup>
      <PrimaryButton label={t("common.save")} loading={saving} onPress={() => void save()} className="mx-4" />
    </ScrollView>}
  </Screen>;
}
