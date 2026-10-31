import * as Clipboard from "expo-clipboard";
import type { AppPromotionProviderStatus, AppPromotionRecord, AppPromotionStatsResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { FilterChip } from "@/src/components/FilterChip";
import { useToast } from "@/src/components/Toast";
import { promotionUrl } from "@/src/data/app-manage";
import { useApp } from "@/src/data/context";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, DataError, EmptyState, Field, FIELD_INPUT_CLASS, IconButton, Loader, LoadingSections, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { formatNumber, formatRelativeTime } from "@/src/utils";

const UTM_FIELDS = [
  { key: "source", label: "app.promo.utm.source", placeholder: "instagram" },
  { key: "medium", label: "app.promo.utm.medium", placeholder: "paid_social" },
  { key: "campaign", label: "app.promo.utm.campaign", placeholder: "launch_2026" },
  { key: "content", label: "app.promo.utm.content", placeholder: "video_a" },
] as const satisfies readonly { key: string; label: TranslationKey; placeholder: string }[];

const FUNNEL = [
  ["landing", "app.promo.landing"],
  ["ready", "app.promo.ready"],
  ["registrationCompleted", "app.promo.registered"],
  ["paywallViewed", "app.promo.paywall"],
  ["checkoutStarted", "app.promo.checkout"],
] as const satisfies readonly (readonly [keyof AppPromotionStatsResponse["summary"], TranslationKey])[];

type UtmKey = (typeof UTM_FIELDS)[number]["key"];

export default function WorkPromotionsScreen() {
  const { appId = "", publicUrl = "" } = useLocalSearchParams<{ appId: string; publicUrl: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [data, setData] = useState<{ promotions: AppPromotionRecord[]; providers: AppPromotionProviderStatus[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AppPromotionRecord | null>(null);

  const load = useCallback(async () => {
    if (!client || !appId) return;
    try {
      setData(await client.apps.listPromotions(appId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("app.promo.error"));
      throw caught;
    }
  }, [appId, client, t]);
  useSyncScope(`app:${appId}:promotions`, load, 60_000, Boolean(appId));

  const copy = async (promotion: AppPromotionRecord) => {
    try {
      await Clipboard.setStringAsync(promotionUrl(publicUrl, promotion));
      toast({ title: t("app.promo.copied") });
    } catch (caught) {
      toast({ title: t("app.promo.copyFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    }
  };

  return <Screen>
    <TopBar title={t("app.promo.title")} onBack={() => router.back()} actions={data ? <IconButton name="plus" label={t("app.promo.new")} onPress={() => setCreating(true)} /> : undefined} />
    {error && !data ? <DataError message={error} onRetry={() => void load().catch(() => undefined)} /> : null}
    {!data ? (error ? null : <LoadingSections sections={[{ kind: "group", rows: 3 }]} />) : data.promotions.length === 0
      ? <EmptyState icon="megaphone" title={t("app.promo.title")} description={t("app.promo.empty")} action={{ icon: "plus", label: t("app.promo.new"), onPress: () => setCreating(true) }} />
      : <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
        <SettingsGroup>
          {data.promotions.map((promotion, index) => <View key={promotion.id} className="flex-row items-center bg-surface">
            <Pressable accessibilityRole="button" accessibilityLabel={promotion.name} onPress={() => setSelected(promotion)} className="min-h-16 min-w-0 flex-1 justify-center gap-0.5 py-3 pl-4 active:bg-surface-pressed">
              <Text numberOfLines={1} className="text-body text-fg">{promotion.name}</Text>
              <Text numberOfLines={1} className="text-caption text-fg-muted">{[promotion.provider, formatRelativeTime(promotion.createdAt)].join(" · ")}</Text>
            </Pressable>
            <IconButton name="copy" label={t("app.promo.copyLink")} onPress={() => void copy(promotion)} />
            {index === data.promotions.length - 1 ? null : <View className="absolute bottom-0 left-4 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
          </View>)}
        </SettingsGroup>
      </ScrollView>}
    {creating && data ? <CreatePromotionSheet appId={appId} providers={data.providers} onClose={() => setCreating(false)} onCreated={(promotion) => { setCreating(false); setData((current) => current ? { ...current, promotions: [...current.promotions, promotion] } : current); setSelected(promotion); }} /> : null}
    {selected ? <PromotionStatsSheet appId={appId} promotion={selected} link={promotionUrl(publicUrl, selected)} onCopy={() => void copy(selected)} onClose={() => setSelected(null)} /> : null}
  </Screen>;
}

function CreatePromotionSheet({ appId, providers, onClose, onCreated }: { appId: string; providers: AppPromotionProviderStatus[]; onClose: () => void; onCreated: (promotion: AppPromotionRecord) => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { client } = useApp();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState(() => providers.find((item) => item.configured)?.key ?? "generic");
  const [utm, setUtm] = useState<Record<UtmKey, string>>({ source: "", medium: "", campaign: "", content: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!client || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const parameters = Object.fromEntries(Object.entries(utm).map(([key, value]) => [`utm_${key}`, value.trim()]).filter(([, value]) => value));
      const result = await client.apps.createPromotion(appId, { name: name.trim(), provider, parameters });
      onCreated(result.promotion);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("app.promo.error"));
    } finally {
      setSaving(false);
    }
  };
  return <AdaptiveSheet visible title={t("app.promo.new")} onClose={onClose} dismissible={!saving} confirm={{ label: t("app.promo.create"), loading: saving, disabled: !name.trim(), onPress: () => void create() }}>
    <View className="gap-4">
      <Field label={t("app.promo.name")}>
        <TextInput value={name} onChangeText={setName} maxLength={120} placeholder={t("app.promo.namePlaceholder")} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t("app.promo.name")} className={FIELD_INPUT_CLASS} />
      </Field>
      {providers.length > 1 ? <Field label={t("app.promo.provider")}>
        <View className="flex-row flex-wrap">
          {providers.map((item) => <FilterChip key={item.key} label={item.configured ? item.key : t("app.promo.providerUnavailable", { provider: item.key })} selected={provider === item.key} onPress={() => { if (item.configured) setProvider(item.key); }} />)}
        </View>
      </Field> : null}
      <Text className="text-caption font-semibold text-fg-muted">{t("app.promo.utm")}</Text>
      {UTM_FIELDS.map((field) => <Field key={field.key} label={t(field.label)}>
        <TextInput value={utm[field.key]} onChangeText={(value) => setUtm((current) => ({ ...current, [field.key]: value }))} autoCapitalize="none" autoCorrect={false} placeholder={field.placeholder} placeholderTextColor={theme.colors.textFaint} accessibilityLabel={t(field.label)} className={FIELD_INPUT_CLASS} />
      </Field>)}
      {error ? <Text accessibilityRole="alert" selectable className="text-caption text-danger">{error}</Text> : null}
    </View>
  </AdaptiveSheet>;
}

function PromotionStatsSheet({ appId, promotion, link, onCopy, onClose }: { appId: string; promotion: AppPromotionRecord; link: string; onCopy: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { client } = useApp();
  const [stats, setStats] = useState<AppPromotionStatsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.apps.getPromotionStats(appId, promotion.id).then((result) => { if (active) setStats(result); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [appId, client, promotion.id]);
  return <AdaptiveSheet visible title={promotion.name} subtitle={promotion.provider} onClose={onClose}>
    <View className="gap-4">
      <Pressable accessibilityRole="button" accessibilityLabel={t("app.promo.copyLink")} onPress={onCopy} className="flex-row items-center gap-2 rounded-sm bg-surface-raised px-3 py-2.5 active:bg-surface-pressed" style={{ borderCurve: "continuous" }}>
        <AppIcon name="link" size={16} tone="accent" />
        <Text numberOfLines={2} selectable className="min-w-0 flex-1 text-caption text-fg-secondary">{link}</Text>
        <AppIcon name="copy" size={16} tone="muted" />
      </Pressable>
      {failed ? <Text className="text-subhead text-fg-muted">{t("app.promo.statsUnavailable")}</Text> : !stats ? <View className="py-4"><Loader /></View> : <View className="overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
        {FUNNEL.map(([key, label], index) => <View key={key} className={`min-h-12 flex-row items-center px-4 ${index ? "border-t border-border" : ""}`}>
          <Text className="min-w-0 flex-1 text-body text-fg">{t(label)}</Text>
          <Text className="text-body font-semibold tabular-nums text-fg">{formatNumber(stats.summary[key])}</Text>
        </View>)}
        <View className="min-h-12 flex-row items-center border-t border-border px-4">
          <Text className="min-w-0 flex-1 text-body text-fg">{t("app.promo.readyRate")}</Text>
          <Text className="text-body font-semibold tabular-nums text-fg">{`${Math.round(stats.summary.readyRate * 100)}%`}</Text>
        </View>
      </View>}
    </View>
  </AdaptiveSheet>;
}
