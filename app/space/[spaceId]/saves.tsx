import type { CheckpointRecord } from "@neta-art/cohub";
import { LegendList } from "@legendapp/list/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useToast } from "@/src/components/Toast";
import { saveTitle } from "@/src/data/checkpoint-diff";
import { useApp } from "@/src/data/context";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { useSyncScope } from "@/src/data/use-sync-scope";
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
  const { client } = useApp();
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const [saves, setSaves] = useState<CheckpointRecord[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!client || !spaceId) return;
    const request = ++generation.current;
    try {
      const result = await client.space(spaceId).checkpoints.list({ limit: PAGE_SIZE });
      if (request !== generation.current) return;
      setSaves(result.checkpoints);
      setCursor(result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null);
      setError(null);
    } catch (caught) {
      if (request === generation.current) setError(caught instanceof Error ? caught.message : t("save.loadFailed"));
      throw caught;
    }
  }, [client, spaceId, t]);
  useSyncScope(`space:${spaceId}:saves`, load, 60_000, Boolean(spaceId));

  const loadMore = async () => {
    if (!client || !cursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    try {
      const result = await client.space(spaceId).checkpoints.list({ limit: PAGE_SIZE, cursor });
      if (request !== generation.current) return;
      setSaves((current) => {
        const known = new Set((current ?? []).map((item) => item.id));
        return [...(current ?? []), ...result.checkpoints.filter((item) => !known.has(item.id))];
      });
      setCursor(result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null);
    } catch (caught) {
      toast({ title: t("save.loadFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setLoadingMore(false);
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
    {error && !saves ? <DataError message={error} onRetry={() => void load().catch(() => undefined)} /> : null}
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
      refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().catch(() => undefined).finally(() => setRefreshing(false)); }} />}
    />}
  </Screen>;
}
