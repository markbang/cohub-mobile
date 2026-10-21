import { useRouter, useScrollToTop } from "expo-router";
import type { BillingSubscriptionHistoryStatus } from "@neta-art/cohub";
import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { ActivityHeatmap } from "@/src/components/ActivityHeatmap";
import { useApp } from "@/src/data/context";
import { useActivity } from "@/src/data/use-activity";
import { useBillingHistory } from "@/src/data/use-billing-history";
import { useTranslation } from "@/src/i18n";
import { AppIcon, AppRefreshControl, ConnectionBanner, DataError, LoadingRows, Screen, SectionHeader, SettingsGroup } from "@/src/ui";
import { SettingsRow } from "@/src/components/SettingsRow";
import { PressableScale } from "@/src/ui/PressableScale";
import { EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";

export default function ActivityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout, scrollY, onScroll } = useEdgeChrome();
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
    <EdgeHeader onLayout={onHeaderLayout} scrollY={scrollY}>
      <ConnectionBanner visible={connectionUnavailable} />
    </EdgeHeader>
    <ScrollView ref={scrollRef} className="flex-1" onScroll={onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" scrollIndicatorInsets={{ top: headerHeight, bottom: tabBarInset }} contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: tabBarInset }} refreshControl={<AppRefreshControl refreshing={pullRefreshing} onRefresh={refreshOnPull} progressViewOffset={headerHeight} />}>
      {/* One figure leads the screen: the balance on a dashboard card, tabular so it does not shift as it updates. */}
      <View className="mb-6 mt-4 px-4">
        <PressableScale accessibilityRole="button" accessibilityLabel={t("settings.section.billing")} onPress={() => router.push("/settings/billing")} className="gap-3 rounded-md bg-surface p-5" style={{ borderCurve: "continuous" }}>
          <View className="flex-row items-center gap-2">
            <View className="size-8 items-center justify-center rounded-xs bg-accent-soft" style={{ borderCurve: "continuous" }}><AppIcon name="database" size={16} tone="accent" strokeWidth={2.1} /></View>
            <Text className="flex-1 text-subhead font-semibold text-fg-secondary">{t("settings.billing.balance")}</Text>
            <AppIcon name="chevron-right" size={16} tone="faint" />
          </View>
          <Text className={`text-display font-bold tabular-nums ${credits.data && credits.data.netUsd < 0 ? "text-danger" : "text-fg"}`}>{credits.data ? `$${credits.data.netUsd.toFixed(2)}` : "—"}</Text>
        </PressableScale>
      </View>
      {credits.error ? <DataError message={credits.error} onRetry={retry} /> : null}
      <SettingsGroup>
        <SettingsRow
          icon="sparkles"
          title={t("activity.subscription.title")}
          detail={subscriptions.data ? currentSubscription?.productName ?? t("activity.subscription.none") : t(subscriptions.error ? "settings.billing.error" : "common.loading")}
          value={currentSubscription?.status}
          onPress={() => router.push({ pathname: "/settings/billing-history", params: { kind: "subscriptions" } })}
        />
        <SettingsRow icon="activity" title={t("activity.usageDetails")} onPress={() => router.push("/settings/activity")} />
        <SettingsRow icon="trending-up" title={t("activity.trending")} onPress={() => router.push("/trending")} />
        <SettingsRow icon="gift" title={t("settings.section.referrals")} last onPress={() => router.push("/settings/referrals")} />
      </SettingsGroup>
      {subscriptions.error ? <DataError message={subscriptions.error} onRetry={() => void subscriptions.load()} /> : null}
      <SectionHeader title={t("activity.heatmap.title")} />
      {activity?.error ? <DataError message={activity.error} onRetry={retry} /> : null}
      {activity?.data ? <View className="mx-4 rounded-md bg-surface p-4" style={{ borderCurve: "continuous" }}><ActivityHeatmap hourly={activity.data.hourly} days={activity.data.days} /></View> : !activity?.error ? <LoadingRows count={2} /> : null}
    </ScrollView>
  </Screen>;
}
