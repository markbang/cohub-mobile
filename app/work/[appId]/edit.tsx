import type { AppDetailResponse, AppViewStatsResponse, AppVisibility } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsRow } from "@/src/components/SettingsRow";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { useToast } from "@/src/components/Toast";
import { APP_HIDE_COHUB_BAR_FEATURE, dailyViews, hidesCohubBar, withCohubBar } from "@/src/data/app-manage";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppSwitch, DataError, Field, FIELD_INPUT_CLASS, LoadingSections, PrimaryButton, Screen, Segmented, SettingsGroup, TopBar } from "@/src/ui";
import { Meta } from "@/src/ui/ListRow";
import { formatNumber } from "@/src/utils";

export default function ManageWorkScreen() {
  const { appId = "" } = useLocalSearchParams<{ appId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [detail, setDetail] = useState<AppDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState<AppViewStatsResponse | null>(null);
  const [canHideBar, setCanHideBar] = useState<boolean | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [visibility, setVisibility] = useState<AppVisibility>("public");
  const [hideBar, setHideBar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!client || !appId) return;
    let active = true;
    void client.apps.get(appId).then((result) => {
      if (!active) return;
      setDetail(result);
      setTitle(result.app.meta?.title || result.app.meta?.name || "");
      setDescription(result.app.meta?.description || "");
      setPublished(result.app.status === "published");
      setVisibility(result.app.visibility);
      setHideBar(hidesCohubBar(result.app.meta));
      setError(null);
    }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : t("work.error")); });
    // Stats and the entitlement are extras: their failure leaves the form usable.
    void client.apps.getStats(appId).then((result) => { if (active) setStats(result); }).catch(() => undefined);
    void client.billing.getFeatureEntitlement(APP_HIDE_COHUB_BAR_FEATURE).then((result) => { if (active) setCanHideBar(result.enabled); }).catch(() => { if (active) setCanHideBar(false); });
    return () => { active = false; };
  }, [appId, attempt, client, t]);

  const save = async () => {
    if (!client || !detail || saving) return;
    setSaving(true);
    try {
      const meta = withCohubBar({ ...detail.app.meta, title: title.trim() || undefined, description: description.trim() || undefined }, hideBar);
      const result = await client.apps.update(appId, { status: published ? "published" : "disabled", visibility, meta });
      setDetail((current) => current ? { ...current, app: result.app } : current);
      toast({ title: t("app.edit.saved") });
      router.back();
    } catch (caught) {
      toast({ title: t("app.edit.saveFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!client || !detail || deleting) return;
    setDeleting(true);
    try {
      await client.apps.delete(appId);
      setConfirmDelete(false);
      toast({ title: t("app.manage.deleted") });
      router.dismiss(2);
    } catch (caught) {
      toast({ title: t("app.manage.deleteFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setDeleting(false);
    }
  };

  const app = detail?.app;
  const workTitle = app?.meta?.title || app?.meta?.name || app?.slug || t("work.fallbackTitle");
  return <Screen keyboard>
    <TopBar title={t("app.manage.title")} subtitle={app ? workTitle : undefined} onBack={() => router.back()} />
    {error && !detail ? <DataError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : null}
    {!detail || !app ? (error ? null : <LoadingSections sections={[{ kind: "field" }, { kind: "field", tall: true }, { kind: "field" }, { kind: "group", rows: 2, trailing: "switch" }, { kind: "capsule" }]} />) : <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
      {stats ? <ViewStats stats={stats} /> : null}

      <View className="mb-6 gap-4 px-4">
        <Field label={t("app.edit.title.label")}>
          <TextInput value={title} onChangeText={setTitle} placeholder={t("app.edit.titlePlaceholder")} placeholderTextColor={theme.colors.textFaint} autoCorrect={false} accessibilityLabel={t("app.edit.title.label")} className={FIELD_INPUT_CLASS} />
        </Field>
        <Field label={t("app.edit.description")}>
          <TextInput value={description} onChangeText={setDescription} placeholder={t("app.edit.descriptionPlaceholder")} placeholderTextColor={theme.colors.textFaint} multiline textAlignVertical="top" accessibilityLabel={t("app.edit.description")} className={`min-h-24 ${FIELD_INPUT_CLASS}`} />
        </Field>
        <Field label={t("app.manage.visibility")} hint={t(visibility === "public" ? "app.manage.visibility.publicHint" : "app.manage.visibility.spaceHint")}>
          <Segmented value={visibility} onChange={setVisibility} options={[{ value: "public", label: t("app.manage.visibility.public") }, { value: "space", label: t("app.manage.visibility.space") }]} />
        </Field>
      </View>

      <SettingsGroup>
        <ToggleRow title={t("app.edit.published")} detail={t("app.edit.publishedDescription")} value={published} onChange={setPublished} />
        <ToggleRow
          title={t("app.manage.hideBar")}
          detail={canHideBar === false && !hideBar ? t("app.manage.hideBarLocked") : t("app.manage.hideBarDetail")}
          value={hideBar}
          disabled={canHideBar !== true && !hideBar}
          onChange={setHideBar}
          last
        />
      </SettingsGroup>
      <PrimaryButton label={t("common.save")} loading={saving} onPress={() => void save()} className="mx-4 mb-6" />

      <SettingsGroup>
        <SettingsRow icon="globe" title={t("app.domain.title")} onPress={() => router.push({ pathname: "/work/[appId]/domain", params: { appId, spaceId: app.spaceId } })} />
        {app.status === "published" && detail.publicUrl ? <SettingsRow icon="megaphone" title={t("app.promo.title")} onPress={() => router.push({ pathname: "/work/[appId]/promotions", params: { appId, publicUrl: detail.publicUrl ?? "" } })} /> : null}
        <SettingsRow icon="history" title={t("app.versions.title")} detail={`v${app.latestVersion}`} onPress={() => router.push({ pathname: "/work/[appId]/versions", params: { appId } })} />
        <SettingsRow icon="shield" title={t("app.access.title")} detail={t("app.access.count", { count: app.appScopes.length })} last onPress={() => router.push({ pathname: "/work/[appId]/access", params: { appId } })} />
      </SettingsGroup>

      <SettingsGroup>
        <SettingsRow icon="trash" title={t("app.manage.delete")} danger last onPress={() => setConfirmDelete(true)} />
      </SettingsGroup>
    </ScrollView>}
    <ConfirmSheet
      visible={confirmDelete}
      title={t("app.manage.delete")}
      subtitle={workTitle}
      message={t("app.manage.deleteConfirm")}
      confirmLabel={t("app.manage.delete")}
      confirmIcon="trash"
      busy={deleting}
      onConfirm={() => void remove()}
      onClose={() => setConfirmDelete(false)}
    />
  </Screen>;
}

function ToggleRow({ title, detail, value, onChange, disabled = false, last = false }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean; last?: boolean }) {
  return <View className={`min-h-16 flex-row items-center gap-3 bg-surface px-4 py-3 ${last ? "" : "border-b border-border"}`}>
    <View className={`min-w-0 flex-1 gap-0.5 ${disabled ? "opacity-55" : ""}`}>
      <Text className="text-body text-fg">{title}</Text>
      <Text className="text-caption text-fg-muted">{detail}</Text>
    </View>
    <AppSwitch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={title} />
  </View>;
}

function ViewStats({ stats }: { stats: AppViewStatsResponse }) {
  const { t } = useTranslation();
  const days = dailyViews(stats);
  const peak = Math.max(1, ...days.map((day) => day.views));
  return <SettingsGroup label={t("app.stats.title")}>
    <View className="gap-3 bg-surface p-4">
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Meta icon="eye" value={formatNumber(stats.summary.totalViews)} label={t("app.stats.total", { count: stats.summary.totalViews })} tone="accent" />
        <Text className="text-caption tabular-nums text-fg-muted">{t("app.stats.day", { count: formatNumber(stats.summary.views24h) })}</Text>
        <Text className="text-caption tabular-nums text-fg-muted">{t("app.stats.week", { count: formatNumber(stats.summary.views7d) })}</Text>
        <Text className="text-caption tabular-nums text-fg-muted">{t("app.stats.month", { count: formatNumber(stats.summary.views30d) })}</Text>
      </View>
      <View accessible accessibilityLabel={t("app.stats.chart")} className="h-16 flex-row items-end gap-0.5">
        {days.map((day) => <View key={day.date} className={`flex-1 rounded-t-xs ${day.views ? "bg-accent" : "bg-surface-raised"}`} style={{ height: `${Math.max(4, (day.views / peak) * 100)}%` }} />)}
      </View>
    </View>
  </SettingsGroup>;
}
