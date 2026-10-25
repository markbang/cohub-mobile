import type { GenerationContentBlock, TaskRunDetailResponse } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { GenerationBlock } from "@/src/components/GenerationOutput";
import { useApp } from "@/src/data/context";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Bone, Screen, Skeleton, StatusPill, TopBar } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

export default function TaskScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useApp();
  const [detail, setDetail] = useState<TaskRunDetailResponse | null>(null);
  useSpaceRealtime(detail?.run.spaceId ? [detail.run.spaceId] : []);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const generation = useRef(0);
  
  // Memoize expensive JSON stringification and limit size
  const jsonString = useMemo(() => {
    if (!detail?.run) return "";
    try {
      const cleaned = JSON.parse(JSON.stringify(detail.run, (_key, value) => {
        // Skip very large fields to prevent performance issues
        if (typeof value === "string" && value.length > 10000) {
          return `[Large string: ${value.length} chars]`;
        }
        // Limit array length
        if (Array.isArray(value) && value.length > 100) {
          return [...value.slice(0, 100), `[...${value.length - 100} more items]`];
        }
        return value;
      }));
      return JSON.stringify(cleaned, null, 2);
    } catch {
      return "[Unable to serialize]";
    }
  }, [detail]);
  useEffect(() => () => { generation.current += 1; }, [client, taskId]);
  useSyncScope(`task:${taskId}`, async () => {
    if (!client || !taskId) return;
    const token = generation.current;
    try {
      const result = await client.tasks.get(taskId);
      if (token !== generation.current) return;
      setDetail(result);
      setError(null);
    } catch (caught) {
      if (token === generation.current) setError(caught instanceof Error ? caught.message : t("task.error"));
      throw caught;
    }
  }, !detail || detail.run.status === "running" || detail.run.status === "pending" ? 5_000 : 60_000, Boolean(taskId));
  const output = generationOutput(detail?.run.result);
  const run = detail?.run;
  
  return <Screen>
    <TopBar title={t("task.title")} onBack={() => router.back()} />
    <ScrollView contentContainerClassName="gap-4 p-4">
      {error ? <Text className="text-body text-danger">{error}</Text> : !detail ? <TaskSkeleton /> : (
        <>
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-headline font-semibold text-fg">{sentenceCase(run?.taskType.replaceAll("_", " ") ?? "")}</Text>
              <StatusPill 
                label={run?.status ?? "unknown"} 
                tone={run?.status === "failed" ? "danger" : run?.status === "running" || run?.status === "pending" ? "warning" : "success"} 
              />
            </View>
            
            <View className="gap-2">
              <InfoRow icon="clock" label={t("task.created")} value={formatRelativeTime(run?.createdAt ?? "")} />
              <InfoRow icon="clock" label={t("task.updated")} value={formatRelativeTime(run?.updatedAt ?? "")} />
              <InfoRow icon="activity" label={t("task.attempts")} value={String(run?.attemptCount ?? 0)} />
              {run?.sessionId && <InfoRow icon="message-square" label={t("task.session")} value={run.sessionId.slice(0, 8)} />}
              {run?.errorMessage && <InfoRow icon="alert" label={t("task.error")} value={run.errorMessage} danger />}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => setShowJson(!showJson)}
            className="flex-row items-center justify-between p-3 rounded-sm bg-surface active:bg-surface-pressed"
          >
            <Text className="text-body font-semibold text-fg">{t("task.showJson")}</Text>
            <AppIcon name={showJson ? "chevron-up" : "chevron-down"} size={16} tone="muted" />
          </Pressable>

          {showJson && run && (
            <ScrollView horizontal style={{ maxHeight: 400 }}>
              <View className="p-3 rounded-sm bg-surface-raised">
                <Text selectable className="text-micro font-normal text-fg" style={{ lineHeight: 16, fontFamily: "SpaceMono" }}>
                  {jsonString}
                </Text>
              </View>
            </ScrollView>
          )}

          {output.length > 0 && (
            <View className="gap-3 mt-2">
              <Text className="text-headline font-semibold text-fg">{t("task.output")}</Text>
              {output.map((block, index) => <GenerationBlock key={index} block={block} />)}
            </View>
          )}

          {output.length === 0 && !run?.errorMessage && run?.status === "completed" && (
            <Text className="text-body text-fg-muted">{t("task.noOutput")}</Text>
          )}
        </>
      )}
    </ScrollView>
  </Screen>;
}
function TaskSkeleton() {
  return <Skeleton className="gap-4">
    <View className="gap-3">
      <View className="flex-row items-center justify-between" style={{ height: 22 }}><Bone width="45%" height={13} /><Bone width={64} height={22} /></View>
      <View className="gap-2">
        {(["40%", "40%", "16%"] as const).map((width, index) => <View key={index} className="flex-row items-center gap-2" style={{ height: 18 }}>
          <Bone width={14} height={14} radius={4} /><View className="min-w-18"><Bone width={56} height={9} /></View><Bone width={width} height={9} />
        </View>)}
      </View>
    </View>
    <Bone width="100%" height={46} radius={14} />
  </Skeleton>;
}

function InfoRow({ icon, label, value, danger = false }: { icon: React.ComponentProps<typeof AppIcon>["name"]; label: string; value: string; danger?: boolean }) {
  return (
    <View className="flex-row items-center gap-2">
      <AppIcon name={icon} size={14} tone="muted" />
      <Text className="text-caption text-fg-muted min-w-18">{label}</Text>
      <Text selectable className={`flex-1 text-caption ${danger ? "text-danger" : "text-fg"}`}>{value}</Text>
    </View>
  );
}

function generationOutput(result: unknown): GenerationContentBlock[] { if (!result || typeof result !== "object" || !Array.isArray((result as { output?: unknown }).output)) return []; return (result as { output: GenerationContentBlock[] }).output; }

/** Task types arrive as snake_case identifiers; titles follow the sentence-case copy rule. */
function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
