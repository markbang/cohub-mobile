import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { FilterChip } from "@/src/components/FilterChip";
import type { TrendingBoard, TrendingDimension, TrendingEntry } from "@/src/data/trending";
import { useTrending } from "@/src/data/use-trending";
import { useTranslation } from "@/src/i18n";
import { Avatar, DataError, EmptyState, LoadingRows, Screen, Segmented, TopBar } from "@/src/ui";
import { ListRow } from "@/src/ui/ListRow";
import { formatNumber } from "@/src/utils";

const DIMENSIONS: readonly TrendingDimension[] = ["spaces", "users", "models"];

export default function TrendingRoute() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [board, setBoard] = useState<TrendingBoard>("llm");
  const [dimension, setDimension] = useState<TrendingDimension>("spaces");
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const { entries, error, loading, refresh } = useTrending(board, dimension);
  const cost = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const refreshOnPull = async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  };
  const row = (entry: TrendingEntry) => {
    const metric = formatNumber(entry.tokens ?? entry.requests);
    const metricLabel = t(entry.tokens === null ? "trending.metric.requests" : "trending.metric.tokens");
    const subtitle = [entry.subtitle, cost.format(entry.cost), t("trending.sessions", { count: entry.sessions })].filter(Boolean).join(" · ");
    return <ListRow
      key={entry.key}
      accessibilityLabel={`${entry.rank}. ${entry.title}, ${metric} ${metricLabel}, ${subtitle}`}
      leading={<View className="flex-row items-center gap-2.5">
        <Text className={`w-6 text-center text-subhead font-bold tabular-nums ${entry.rank <= 3 ? "text-accent" : "text-fg-faint"}`}>{entry.rank}</Text>
        <Avatar name={entry.title} uri={entry.avatarUrl} size={40} />
      </View>}
      title={entry.title}
      subtitle={subtitle}
      accessory={<View className="items-end">
        <Text className="text-body font-semibold tabular-nums text-fg">{metric}</Text>
        <Text className="text-caption text-fg-muted">{metricLabel}</Text>
      </View>}
    />;
  };
  return <Screen scroll refreshing={pullRefreshing} onRefresh={() => void refreshOnPull()}>
    <TopBar title={t("activity.trending")} subtitle={t("trending.window")} onBack={() => router.back()} />
    <View className="px-4 pt-2">
      <Segmented
        options={[{ value: "llm", label: t("trending.board.llm") }, { value: "generation", label: t("trending.board.generation") }]}
        value={board}
        onChange={setBoard}
      />
    </View>
    <View accessibilityRole="tablist" className="flex-row px-2">
      {DIMENSIONS.map((item) => <FilterChip key={item} label={t(`trending.dimension.${item}`)} selected={item === dimension} onPress={() => setDimension(item)} />)}
    </View>
    {error ? <DataError message={error} onRetry={() => void refresh()} /> : null}
    {entries === null
      ? loading ? <LoadingRows count={6} /> : null
      : entries.length ? entries.map(row) : <EmptyState icon="trending-up" title={t("trending.empty")} />}
  </Screen>;
}
