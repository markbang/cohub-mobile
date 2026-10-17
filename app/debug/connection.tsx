import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useApp } from "@/src/data/context";
import type { ConnectionState } from "@/src/data/types";
import { AppIcon, PrimaryButton, Screen, SectionHeader, StatusPill } from "@/src/ui";
import type { IconName } from "@/src/icons";

function connectionTone(state: ConnectionState): "success" | "warning" | "danger" | "neutral" {
  if (state === "open") return "success";
  if (state === "connecting" || state === "reconnecting") return "warning";
  if (state === "error" || state === "closed") return "danger";
  return "neutral";
}

export default function DebugConnectionScreen() {
  const { state, connectionState, refreshHome, refreshSessionStatuses } = useApp();
  const [timeline, setTimeline] = useState<{ at: number; value: ConnectionState }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void Promise.resolve().then(() =>
      setTimeline((current) => [{ at: Date.now(), value: connectionState }, ...current].slice(0, 40)),
    );
  }, [connectionState]);

  const restart = useCallback(async () => {
    if (busy) return;
    setBusy("restart");
    try {
      await refreshHome();
      await refreshSessionStatuses(state.sessions);
    } finally {
      setBusy(null);
    }
  }, [busy, refreshHome, refreshSessionStatuses, state.sessions]);

  const views = Object.entries(state.sessionViews);
  const streams = views.filter(([, view]) => view.stream);
  const runningTurns = Object.values(state.sessionLatestTurns).filter((turn) => turn?.status === "running").length;
  const sending = views.filter(([, view]) => view.sending).length;
  const optimistic = views.reduce(
    (total, [, view]) => total + view.messages.filter((message) => message.meta?.optimistic === true).length,
    0,
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="items-center pt-5 gap-2">
          <StatusPill label={connectionState} tone={connectionTone(connectionState)} />
          <Text className="text-caption text-fg-muted">
            {state.booting ? "启动中" : state.refreshing ? "刷新中" : "已就绪"}
          </Text>
        </View>

        <SectionHeader title="同步状态" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          <Row icon="messages" label="会话(列表)" value={String(state.sessions.length)} />
          <Row icon="layers" label="空间" value={String(state.spaces.length)} />
          <Row icon="activity" label="运行中的轮次" value={String(runningTurns)} />
          <Row icon="arrow-up" label="发送中 / 乐观消息" value={`${sending} / ${optimistic}`} />
          <Row icon="list-tree" label="会话分页" value={`hasMore=${state.sessionsHasMore} · cursor=${state.sessionsCursor ? `${state.sessionsCursor.slice(0, 12)}…` : "—"}`} />
          <Row icon="refresh" label="状态请求中" value={String(state.sessionStatusRequests)} />
          <Row icon="wifi" label="lastSyncedAt" value={state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleTimeString() : "—"} />
        </View>

        {(state.error || state.spacesError || state.sessionsError || state.sessionStatusError || state.activityError) ? (
          <>
            <SectionHeader title="错误" />
            <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
              {state.error ? <Row icon="alert" label="error" value={state.error} tone="danger" /> : null}
              {state.spacesError ? <Row icon="alert" label="spaces" value={state.spacesError} tone="danger" /> : null}
              {state.sessionsError ? <Row icon="alert" label="sessions" value={state.sessionsError} tone="danger" /> : null}
              {state.sessionStatusError ? <Row icon="alert" label="status" value={state.sessionStatusError} tone="danger" /> : null}
              {state.activityError ? <Row icon="alert" label="activity" value={state.activityError} tone="danger" /> : null}
            </View>
          </>
        ) : null}

        <SectionHeader title={`活跃流 · ${streams.length}`} />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {streams.length === 0 ? (
            <Text className="text-caption text-fg-muted p-4">当前没有正在流式输出的会话</Text>
          ) : streams.map(([sessionId, view]) => (
            <View key={sessionId} className="px-3 py-2 border-b border-border gap-1">
              <View className="flex-row items-center gap-2">
                <AppIcon name="sync" size={15} tone="accent" />
                <Text className="text-body font-semibold text-fg flex-1">{sessionId.slice(0, 8)}</Text>
                <StatusPill label={view.stream?.status ?? "—"} tone={view.stream?.status === "streaming" || view.stream?.status === "pending" ? "warning" : "neutral"} />
              </View>
              <Text className="text-micro font-semibold text-fg-muted">
                {`turn=${view.stream?.turnId?.slice(0, 8) ?? "—"} · phase=${view.stream?.runtimePhase ?? "—"} · model=${view.stream?.runtimeModel ?? "—"} · blocks=${view.stream?.contentBlocks.length ?? 0} · intermediate=${view.stream?.intermediateMessages.length ?? 0}`}
              </Text>
            </View>
          ))}
        </View>

        <SectionHeader title="连接状态时间线" />
        <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
          {timeline.map((entry, index) => (
            <View key={`${entry.at}-${index}`} className="flex-row items-center gap-2 px-3 py-2 border-b border-border">
              <Text className="text-micro tabular-nums text-fg-faint">{new Date(entry.at).toLocaleTimeString()}</Text>
              <StatusPill label={entry.value} tone={connectionTone(entry.value)} dot={false} />
            </View>
          ))}
        </View>

        <View className="px-4 pt-4">
          <PrimaryButton label="重新同步 (refreshHome + statuses)" icon="refresh" loading={busy === "restart"} disabled={busy !== null} onPress={() => void restart()} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, label, value, tone = "default" }: { icon: IconName; label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <View className="min-h-13 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <View className="w-8 h-8 rounded-sm items-center justify-center bg-surface-raised">
        <AppIcon name={icon} size={15} tone={tone === "danger" ? "danger" : "muted"} />
      </View>
      <Text className="text-caption text-fg-muted w-32">{label}</Text>
      <Text selectable numberOfLines={3} className={`text-caption flex-1 text-right ${tone === "danger" ? "text-danger" : "text-fg-secondary"}`}>{value}</Text>
    </View>
  );
}

