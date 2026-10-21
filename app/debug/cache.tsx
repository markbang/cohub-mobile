import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useApp } from "@/src/data/context";
import { cacheStats, hydrateHome, type CacheStats } from "@/src/data/local-db";
import type { SpaceRecord, UserSessionListItem } from "@neta-art/cohub";
import { AppIcon, Loader, PrimaryButton, Screen, SectionHeader } from "@/src/ui";
import { displaySessionTitle, formatRelativeTime } from "@/src/utils";

const LIST_LIMIT = 50;

export default function DebugCacheScreen() {
  const { userUuid, clearCache } = useApp();
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [sessions, setSessions] = useState<UserSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStats, home] = await Promise.all([cacheStats(userUuid), hydrateHome(userUuid)]);
      setStats(nextStats);
      setSpaces(home.spaces);
      setSessions(home.sessions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取缓存失败");
    } finally {
      setLoading(false);
    }
  }, [userUuid]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const clear = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      await clearCache();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清空缓存失败");
    } finally {
      setClearing(false);
    }
  }, [clearCache, clearing, load]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SectionHeader title="当前用户" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row icon="fingerprint" label="user_key" value={userUuid} />
          <Row icon="info" label="数据库" value="cohub-mobile.db" />
        </View>

        <SectionHeader title="行数" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {loading && !stats ? (
            <View className="p-5 items-center">
              <Loader />
            </View>
          ) : (
            <>
              <Metric icon="layers" label="spaces" value={stats?.spaces ?? 0} />
              <Metric icon="messages" label="sessions" value={stats?.sessions ?? 0} />
              <Metric icon="file-text" label="messages" value={stats?.messages ?? 0} />
              <Metric icon="bookmark" label="read states" value={stats?.readStates ?? 0} />
            </>
          )}
          {error ? <Row icon="alert" label="错误" value={error} tone="danger" /> : null}
        </View>

        <View className="flex-row gap-2 mx-4 mt-4">
          <PrimaryButton label="刷新" icon="refresh" loading={loading} disabled={clearing} onPress={() => void load()} className="flex-1" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清空本地缓存"
            disabled={clearing}
            onPress={() => void clear()}
            className="min-h-12 flex-1 items-center justify-center rounded-sm border border-danger px-4 active:bg-danger-soft disabled:opacity-55"
          >
            <Text className="text-body font-semibold text-danger">{clearing ? "清空中…" : "清空缓存"}</Text>
          </Pressable>
        </View>
        <Text className="text-caption text-fg-muted mx-4 mt-2">
          清空只删当前用户的本地副本；下次进入会重新从服务端填充。用来验证 cache-first 与登出清理。
        </Text>

        <SectionHeader title={`缓存空间 · ${spaces.length}`} />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {spaces.length === 0 ? <Empty text="没有缓存空间" /> : spaces.slice(0, LIST_LIMIT).map((space) => (
            <Row key={space.id} icon="layers" label={space.name?.trim() || space.title?.trim() || "—"} value={`${space.id.slice(0, 8)} · ${formatRelativeTime(space.updatedAt)}`} />
          ))}
          {spaces.length > LIST_LIMIT ? <Empty text={`还有 ${spaces.length - LIST_LIMIT} 个…`} /> : null}
        </View>

        <SectionHeader title={`缓存会话 · ${sessions.length}`} />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {sessions.length === 0 ? <Empty text="没有缓存会话" /> : sessions.slice(0, LIST_LIMIT).map((session) => (
            <Row key={session.id} icon="messages" label={displaySessionTitle(session)} value={`${session.id.slice(0, 8)} · ${formatRelativeTime(session.lastMessageAt ?? session.updatedAt)}`} />
          ))}
          {sessions.length > LIST_LIMIT ? <Empty text={`还有 ${sessions.length - LIST_LIMIT} 个…`} /> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Metric({ icon, label, value }: { icon: React.ComponentProps<typeof AppIcon>["name"]; label: string; value: number }) {
  return (
    <View className="min-h-14 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <View className="w-8 h-8 rounded-sm items-center justify-center bg-surface-raised">
        <AppIcon name={icon} size={16} tone="accent" />
      </View>
      <Text className="text-caption text-fg-muted flex-1">{label}</Text>
      <Text className="text-headline font-semibold text-fg">{value}</Text>
    </View>
  );
}

function Row({ icon, label, value, tone = "default" }: { icon: React.ComponentProps<typeof AppIcon>["name"]; label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <View className="min-h-14 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <View className="w-8 h-8 rounded-sm items-center justify-center bg-surface-raised">
        <AppIcon name={icon} size={15} tone={tone === "danger" ? "danger" : "muted"} />
      </View>
      <Text numberOfLines={1} className={`text-body font-semibold flex-1 ${tone === "danger" ? "text-danger" : "text-fg"}`}>{label}</Text>
      <Text selectable numberOfLines={2} className={`text-right text-micro ${tone === "danger" ? "text-danger" : "text-fg-secondary"}`} style={{ maxWidth: "48%" }}>{value}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text className="text-caption text-fg-muted p-4">{text}</Text>;
}

