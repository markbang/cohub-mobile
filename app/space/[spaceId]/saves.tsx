import type { CheckpointRecord } from "@neta-art/cohub";
import { LegendList } from "@legendapp/list/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { saveTitle } from "@/src/data/checkpoint-diff";
import { useAppActions } from "@/src/data/context";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { usePagedQuery } from "@/src/data/query";
import { useTranslation } from "@/src/i18n";
import { AppIcon, AppRefreshControl, DataError, EmptyState, IconButton, ListEdgeLoader, LoadingRows, Screen, TopBar } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow } from "@/src/ui/ListRow";
import { formatRelativeTime } from "@/src/utils";

const PAGE_SIZE = 30;

export default function SavesScreen() {
  const { spaceId = "" } = useLocalSearchParams<{ spaceId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useAppActions();
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const list = usePagedQuery<CheckpointRecord>({
    queryKey: [`space:${spaceId}:saves`, "list"],
    enabled: Boolean(client && spaceId),
    intervalMs: 60_000,
    id: (item) => item.id,
    fetchPage: async (cursor) => {
      const result = await client!.space(spaceId).checkpoints.list(cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE });
      return { items: result.checkpoints, cursor: result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null };
    },
  });
  const saves = list.items;
  const error = list.query.error ? list.query.error.message || t("save.loadFailed") : null;
  const loadingMore = list.loadingMore;
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const load = () => list.query.refetch();
  const loadMore = async () => {
    try {
      await list.loadMore();
    } catch (caught) {
      toast({ title: t("save.loadFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    }
  };

  const create = async () => {
    if (!client || creating) return;
    setCreating(true);
    try {
      const result = await client.space(spaceId).checkpoints.create();
      toast({ title: t(result.existing ? "save.createExisting" : "save.creating") });
    } catch (caught) {
      toast({ title: t("save.createFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setCreating(false);
    }
  };

  return <Screen>
    <TopBar title={t("save.listTitle")} onBack={() => router.back()} actions={<IconButton name="plus" label={t("space.saveCheckpoint")} disabled={creating} onPress={() => void create()} />} />
    {error && !saves ? <DataError message={error} onRetry={() => void load()} /> : null}
    {!saves ? (error ? null : <LoadingRows count={6} />) : <LegendList
      data={saves}
      keyExtractor={(item) => item.id}
      estimatedItemSize={80}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 32, flexGrow: saves.length ? undefined : 1 }}
      renderItem={({ item }) => <ListRow
        leading={<View className="flex-1 justify-center"><View className="items-center justify-center rounded-sm bg-surface-raised" style={{ width: LIST_AVATAR_SIZE, height: LIST_AVATAR_SIZE, borderCurve: "continuous" }}><AppIcon name="bookmark" size={20} tone="muted" /></View></View>}
        title={saveTitle(item, (hash) => t("space.save", { hash }))}
        meta={formatRelativeTime(item.createdAt)}
        subtitle={item.commitHash.slice(0, 8)}
        accessibilityLabel={saveTitle(item, (hash) => t("space.save", { hash }))}
        onPress={() => router.push({ pathname: "/space/[spaceId]/save/[checkpointId]", params: { spaceId, checkpointId: item.id } })}
      />}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.6}
      ListEmptyComponent={<EmptyState icon="bookmark" title={t("space.empty.saves")} action={{ icon: "plus", label: t("space.saveCheckpoint"), onPress: () => void create() }} />}
      ListFooterComponent={loadingMore ? <ListEdgeLoader /> : null}
      refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    />}
  </Screen>;
}
