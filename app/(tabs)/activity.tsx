import { useRouter, useScrollToTop } from "expo-router";
import type { BillingSubscriptionHistoryStatus } from "@neta-art/cohub";
import { useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { AccountAvatar } from "@/src/components/AccountAvatar";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { ActivityHeatmap } from "@/src/components/ActivityHeatmap";
import { useApp } from "@/src/data/context";
import { useActivity } from "@/src/data/use-activity";
import { useBillingHistory } from "@/src/data/use-billing-history";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, ConnectionBanner, DataError, LoadingRows, Screen, SectionHeader, SettingsGroup, TopBar } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";
import { PressableScale } from "@/src/ui/PressableScale";
import { EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";

export default function ActivityScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout } = useEdgeChrome();
  const { connectionUnavailable } = useApp();
  const { credits, activity, refresh } = useActivity();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const subscriptions = useBillingHistory("subscriptions");
  const subscriptionItems = subscriptions.data?.kind === "subscriptions" ? subscriptions.data.list.items as BillingSubscriptionHistoryStatus[] : [];
  const currentSubscription = subscriptionItems.find((item) => item.status === "active") ?? subscriptionItems[0] ?? null;
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const retry = () => void refresh();
  const refreshOnPull = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refresh(), subscriptions.load()]);
    } finally {
      setPullRefreshing(false);
    }
  };
  return <Screen edgeToEdge>
    <EdgeHeader onLayout={onHeaderLayout}>
      <TopBar transparent title={t("activity.title")} leading={<AccountAvatar />} />
      <ConnectionBanner visible={connectionUnavailable} />
    </EdgeHeader>
    <ScrollView ref={scrollRef} className="flex-1" contentInsetAdjustmentBehavior="never" scrollIndicatorInsets={{ top: headerHeight, bottom: tabBarInset }} contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: tabBarInset }} refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={refreshOnPull} progressViewOffset={headerHeight} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />}>
      {/* One figure leads the screen: the balance, tabular so it does not shift as it updates. */}
      <PressableScale accessibilityRole="button" accessibilityLabel={t("settings.section.billing")} onPress={() => router.push("/settings/billing")} style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }} pressedStyle={{ opacity: 0.7 }}>
        <View className="flex-row items-center gap-1.5">
          <AppIcon name="database" size={14} tone="muted" />
          <Text className="flex-1 text-caption font-semibold text-fg-muted">{t("settings.billing.balance")}</Text>
          <AppIcon name="chevron-right" size={16} tone="faint" />
        </View>
        <Text className={`mt-1 text-display font-bold tabular-nums ${credits.data && credits.data.netUsd < 0 ? "text-danger" : "text-fg"}`}>{credits.data ? `$${credits.data.netUsd.toFixed(2)}` : "—"}</Text>
      </PressableScale>
      {credits.error ? <DataError message={credits.error} onRetry={retry} /> : null}
      <SettingsGroup>
        <SettingsRow
          icon="sparkles"
          title={t("activity.subscription.title")}
          detail={subscriptions.data ? currentSubscription?.productName ?? t("activity.subscription.none") : t(subscriptions.error ? "settings.billing.error" : "common.loading")}
          onPress={() => router.push({ pathname: "/settings/billing-history", params: { kind: "subscriptions" } })}
        />
        <SettingsRow icon="activity" title={t("activity.usageDetails")} onPress={() => router.push("/settings/activity")} />
        <SettingsRow icon="gift" title={t("settings.section.referrals")} last onPress={() => router.push("/settings/referrals")} />
      </SettingsGroup>
      {subscriptions.error ? <DataError message={subscriptions.error} onRetry={() => void subscriptions.load()} /> : null}
      <SectionHeader title={t("activity.heatmap.title")} />
      {activity?.error ? <DataError message={activity.error} onRetry={retry} /> : null}
      {activity?.data ? <View className="px-4"><ActivityHeatmap hourly={activity.data.hourly} days={activity.data.days} /></View> : !activity?.error ? <LoadingRows count={2} /> : null}
    </ScrollView>
  </Screen>;
}
