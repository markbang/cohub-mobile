import { resolveWebBaseUrl, type SpaceRecord, type SpaceWalletActivity } from "@neta-art/cohub";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SettingsRow } from "@/src/components/SettingsRow";
import { GroupRow, GroupSlot, GroupTile } from "@/src/components/GroupRow";
import { useToast } from "@/src/components/Toast";
import { config } from "@/src/config";
import { useAppActions, useAppSelector } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { formatUsd, walletProductBalanceUsd } from "@/src/data/space-wallet";
import { useSpaceWallet } from "@/src/data/use-space-wallet";
import { useTranslation, type TranslationKey } from "@/src/i18n";
import { openWebLink } from "@/src/platform/browser";
import { useAppTheme } from "@/src/theme";
import { AppIcon, AppSwitch, DataError, IconButton, Loader, LoadingSections, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { displaySpaceName } from "@/src/utils";

const ACTIVITY_LABELS: Record<SpaceWalletActivity["kind"], TranslationKey> = {
  grant: "space.wallet.activity.recharge",
  usage: "space.wallet.activity.usage",
  refund: "space.wallet.activity.refund",
  expire: "space.wallet.activity.expire",
  revoke: "space.wallet.activity.revoke",
  adjust: "space.wallet.activity.adjust",
  reversal: "space.wallet.activity.reversal",
};

export default function SpaceWalletScreen() {
  const { spaceId = "" } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const wallet = useSpaceWallet(spaceId);
  const { summary, catalog, activity, errors, payment } = wallet;
  const [refreshing, setRefreshing] = useState(false);
  const space = useAppSelector((app) => app.state.spaces.find((item) => item.id === spaceId));
  const money = (amount: number, digits?: number) => formatUsd(amount, digits);
  const { client, upsertSpace } = useAppActions();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Space details carry who may edit and whether guests may fund; list rows do not.
  const detailKey = [`space:${spaceId}:wallet`, "space"];
  const detail = useScreenQuery({ queryKey: detailKey, queryFn: (): Promise<SpaceRecord> => client!.spaces.get(spaceId), enabled: Boolean(client && spaceId) }).data ?? null;
  const canEdit = detail?.access?.permissions.includes("space.edit") === true;
  const publicFunding = detail?.publicProfile?.fundingEnabled === true;
  const [savingFunding, setSavingFunding] = useState(false);
  const setPublicFunding = async (enabled: boolean) => {
    if (!client || savingFunding) return;
    setSavingFunding(true);
    try {
      const { space: next } = await client.space(spaceId).profile({ fundingEnabled: enabled });
      queryClient.setQueryData(detailKey, next);
      upsertSpace(next);
    } catch (caught) {
      toast({ title: t("wallet.publicFunding.failed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setSavingFunding(false);
    }
  };
  const copyFundLink = () => void Clipboard.setStringAsync(`${resolveWebBaseUrl({ env: config.environment })}/spaces/${encodeURIComponent(spaceId)}/fund`)
    .then(() => toast({ title: t("wallet.fund.linkCopied"), tone: "success" }))
    .catch(() => undefined);
  const canRecharge = Boolean(catalog?.supported && catalog.paymentAvailable && summary?.usable !== false && catalog.products.length);

  const refresh = async () => {
    setRefreshing(true);
    try { await wallet.refresh(); } catch { /* Errors land in each section's state. */ } finally { setRefreshing(false); }
  };

  const buy = async (productKey: string) => {
    const product = catalog?.products.find((item) => item.key === productKey);
    if (!product) return;
    const url = await wallet.startCheckout(product);
    if (!url) return;
    await openWebLink(url).catch(() => undefined);
    wallet.reload();
  };

  return <Screen scroll refreshing={refreshing} onRefresh={() => void refresh()}>
    <TopBar title={t("space.wallet.title")} subtitle={space ? displaySpaceName(space) : undefined} onBack={() => router.back()} />
    {!summary && errors.summary ? <DataError message={errors.summary} onRetry={wallet.reload} /> : null}
    {!summary && !errors.summary ? <LoadingSections sections={[{ kind: "hero" }, { kind: "group", rows: 3, label: true, leading: true }]} /> : null}
    {summary ? <>
      <View className="h-3" />
      <SettingsGroup>
        <View className="gap-1 p-4">
          <Text className="text-caption text-fg-muted">{t("space.wallet.balance")}</Text>
          <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={1} className="text-display font-semibold tabular-nums text-fg">{money(summary.balanceUsd, 4)}</Text>
          <Text className="mt-1 text-caption text-fg-muted">{t("space.wallet.description")}</Text>
        </View>
      </SettingsGroup>
      {payment ? <PaymentBanner payment={payment} onRefresh={wallet.reload} onDismiss={wallet.dismissPayment} /> : null}
      <SettingsGroup label={t("space.wallet.recharge")}>
        {!catalog ? (errors.catalog ? <InlineRetry message={errors.catalog} onRetry={wallet.reload} /> : <View className="min-h-13 items-center justify-center"><Loader /></View>)
          : !canRecharge ? <Text className="p-4 text-subhead text-fg-muted">{t("space.wallet.rechargeUnavailable")}</Text>
          : catalog.products.map((product, index) => <SettingsRow
            key={product.key}
            icon="database"
            title={product.name}
            value={t("space.wallet.adds", { amount: money(walletProductBalanceUsd(product)) })}
            detail={wallet.buying === product.key ? undefined : money(product.pricing.amountUsd)}
            disabled={wallet.buying !== null}
            last={index === catalog.products.length - 1}
            onPress={() => void buy(product.key)}
          >{wallet.buying === product.key ? <Loader /> : null}</SettingsRow>)}
      </SettingsGroup>
      <Text className="-mt-4 mb-6 px-8 text-caption text-fg-muted">{wallet.checkoutError ? <Text className="text-danger">{t("space.wallet.checkoutFailed")} </Text> : null}{t("space.wallet.rechargeNote")}</Text>
      <SettingsGroup footer={canEdit ? t("wallet.publicFunding.hint") : undefined}>
        <GroupRow leading={<GroupTile icon="wallet" accent />} title={t("wallet.fund.fromBalance")} titleClassName="text-accent" onPress={() => router.push({ pathname: "/space/[spaceId]/fund", params: { spaceId } })} last={!canEdit} />
        {canEdit ? <GroupRow leading={savingFunding ? <GroupSlot><Loader /></GroupSlot> : <GroupTile icon="globe" />} title={t("wallet.publicFunding")} trailing={<AppSwitch value={publicFunding} disabled={savingFunding} onValueChange={(value) => void setPublicFunding(value)} accessibilityLabel={t("wallet.publicFunding")} />} last={!publicFunding} /> : null}
        {canEdit && publicFunding ? <GroupRow leading={<GroupTile icon="link" accent />} title={t("wallet.fund.linkCopy")} titleClassName="text-accent" onPress={copyFundLink} last /> : null}
      </SettingsGroup>
      <SettingsGroup label={t("space.wallet.activity")}>
        {!activity ? (errors.activity ? <InlineRetry message={errors.activity} onRetry={wallet.reload} /> : <View className="min-h-13 items-center justify-center"><Loader /></View>)
          : activity.items.length === 0 ? <Text className="p-4 text-subhead text-fg-muted">{t("space.wallet.noActivity")}</Text>
          : activity.items.map((item, index) => <ActivityRow key={item.id} item={item} amount={money(item.amountUsd, 8)} last={index === activity.items.length - 1 && !activity.hasMore} />)}
        {activity?.hasMore ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.wallet.loadMore")} disabled={wallet.loadingMore} onPress={() => void wallet.loadMore()} className="min-h-12 flex-row items-center justify-center gap-2 bg-surface active:bg-surface-pressed">
          {wallet.loadingMore ? <Loader /> : <AppIcon name="chevrons-down" size={16} tone="accent" />}
          <Text className="text-subhead font-semibold text-accent">{t("space.wallet.loadMore")}</Text>
        </Pressable> : null}
      </SettingsGroup>
      {activity && errors.activity ? <Text accessibilityRole="alert" selectable className="-mt-4 mb-6 px-8 text-caption text-danger">{errors.activity}</Text> : null}
    </> : null}
  </Screen>;
}

function ActivityRow({ item, amount, last }: { item: SpaceWalletActivity; amount: string; last: boolean }) {
  const { t } = useTranslation();
  const positive = item.amountUsd > 0;
  return <View accessible accessibilityLabel={`${t(ACTIVITY_LABELS[item.kind])}, ${amount}`} className="min-h-13 flex-row items-center gap-3 bg-surface px-4 py-2">
    <View className="min-w-0 flex-1 gap-0.5">
      <Text className="text-body text-fg">{t(ACTIVITY_LABELS[item.kind])}</Text>
      <Text className="text-caption text-fg-muted">{new Date(item.createdAt).toLocaleString()}</Text>
    </View>
    <Text className={`text-subhead tabular-nums ${positive ? "text-success" : "text-fg-secondary"}`}>{positive ? `+${amount}` : amount}</Text>
    {last ? null : <View className="absolute bottom-0 left-4 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
  </View>;
}

function PaymentBanner({ payment, onRefresh, onDismiss }: { payment: "pending" | "settled" | "failed"; onRefresh: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const tone = payment === "settled" ? "success" : payment === "failed" ? "danger" : "warning";
  return <View accessibilityLiveRegion="polite" className={`mx-4 -mt-3 mb-6 flex-row items-center gap-3 rounded-md py-2 pl-4 pr-1 ${payment === "settled" ? "bg-success-soft" : payment === "failed" ? "bg-danger-soft" : "bg-warning-soft"}`} style={{ borderCurve: "continuous" }}>
    {payment === "pending" ? <Loader color={theme.colors.warning} /> : <AppIcon name={payment === "settled" ? "check-circle" : "alert"} size={18} tone={tone} />}
    <Text className="min-w-0 flex-1 text-subhead text-fg">{t(payment === "settled" ? "space.wallet.paymentSettled" : payment === "failed" ? "space.wallet.paymentFailed" : "space.wallet.paymentPending")}</Text>
    {payment === "pending" ? <IconButton name="refresh" label={t("space.wallet.refresh")} onPress={onRefresh} /> : <IconButton name="x" label={t("common.close")} onPress={onDismiss} />}
  </View>;
}

function InlineRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return <View className="min-h-13 flex-row items-center gap-2 bg-surface py-1 pl-4 pr-1">
    <Text selectable accessibilityRole="alert" className="min-w-0 flex-1 text-caption text-danger">{message}</Text>
    <IconButton name="refresh" label={t("common.retry")} onPress={onRetry} />
  </View>;
}
