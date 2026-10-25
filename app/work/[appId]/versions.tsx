import type { AppRecord, AppVersionRecord } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useTranslation } from "@/src/i18n";
import { AppIcon, DataError, LoadingSections, PrimaryButton, Screen, SettingsGroup, StatusPill, TopBar } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

export default function WorkVersionsScreen() {
  const { appId = "" } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [app, setApp] = useState<AppRecord | null>(null);
  const [versions, setVersions] = useState<AppVersionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    if (!client || !appId) return;
    try {
      const [detail, list] = await Promise.all([client.apps.get(appId), client.apps.listVersions(appId)]);
      setApp(detail.app);
      setVersions([...list.versions].sort((a, b) => b.version - a.version));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("app.versions.loadFailed"));
      throw caught;
    }
  }, [appId, client, t]);
  useSyncScope(`app:${appId}:versions`, load, 60_000, Boolean(appId));

  const publish = async () => {
    if (!client || publishing) return;
    setPublishing(true);
    try {
      const result = await client.apps.publishVersion(appId);
      setApp(result.app);
      setVersions((current) => [result.version, ...(current ?? []).filter((item) => item.id !== result.version.id)].sort((a, b) => b.version - a.version));
      toast({ title: t("app.versions.published", { version: result.version.version }) });
    } catch (caught) {
      toast({ title: t("app.versions.publishFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setPublishing(false);
    }
  };

  return <Screen>
    <TopBar title={t("app.versions.title")} onBack={() => router.back()} />
    {error && !versions ? <DataError message={error} onRetry={() => void load().catch(() => undefined)} /> : null}
    {!versions ? (error ? null : <LoadingSections sections={[{ kind: "capsule" }, { kind: "caption" }, { kind: "group", rows: 4 }]} />) : <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
      <PrimaryButton label={t("app.versions.publish")} icon="rocket" loading={publishing} onPress={() => void publish()} className="mx-4 mb-2" />
      <Text className="mb-6 px-8 text-caption text-fg-muted">{t("app.versions.publishHint")}</Text>
      <SettingsGroup>
        {versions.length === 0 ? <Text className="bg-surface p-4 text-subhead text-fg-muted">{t("app.versions.empty")}</Text> : versions.map((version, index) => {
          const current = version.id === app?.currentVersionId;
          return <View key={version.id} className="min-h-14 flex-row items-center gap-3 bg-surface px-4 py-3">
            <AppIcon name="history" size={17} tone={current ? "accent" : "muted"} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-body font-semibold tabular-nums text-fg">v{version.version}</Text>
              <Text numberOfLines={1} className="text-caption text-fg-muted">{[version.createdAt ? formatRelativeTime(version.createdAt) : null, version.contentKind].filter(Boolean).join(" · ")}</Text>
            </View>
            {current ? <StatusPill label={t("app.versions.current")} tone="success" /> : null}
            {index === versions.length - 1 ? null : <View className="absolute bottom-0 left-12 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
          </View>;
        })}
      </SettingsGroup>
    </ScrollView>}
  </Screen>;
}
