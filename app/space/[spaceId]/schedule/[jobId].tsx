import type { CronJobRecord, TaskRunRecord } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { cronSummaryText, formatRunTime, ScheduleForm, scheduleProblem, type ScheduleValues } from "@/src/components/ScheduleForm";
import { ConfirmSheet } from "@/src/components/SystemDialogs";
import { useToast } from "@/src/components/Toast";
import { useApp } from "@/src/data/context";
import { nextCronRuns, summarizeCron } from "@/src/data/cron";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useTranslation } from "@/src/i18n";
import { AppSwitch, AppIcon, DataError, IconButton, Loader, LoadingSections, PrimaryButton, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { formatRelativeTime } from "@/src/utils";

const RUN_PAGE = 20;

function promptText(job: CronJobRecord): string | null {
  const content = (job.payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string" ? [(block as { text: string }).text] : []).join("\n\n").trim();
  return text || null;
}

export default function ScheduleScreen() {
  const { jobId = "" } = useLocalSearchParams<{ spaceId: string; jobId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslation();
  const toast = useToast();
  const { client } = useApp();
  const [job, setJob] = useState<CronJobRecord | null>(null);
  const [runs, setRuns] = useState<{ items: TaskRunRecord[]; cursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"toggle" | "save" | "delete" | "more" | null>(null);
  const [editing, setEditing] = useState<ScheduleValues | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!client || !jobId) return;
    try {
      const [detail, history] = await Promise.all([client.cronJobs.get(jobId), client.cronJobs.runs(jobId, { limit: RUN_PAGE })]);
      setJob(detail.job);
      setRuns((current) => {
        if (!current || current.items.length <= RUN_PAGE) return { items: history.runs, cursor: history.pageInfo.hasMore ? history.pageInfo.nextCursor : null };
        const seen = new Set(history.runs.map((run) => run.id));
        return { items: [...history.runs, ...current.items.filter((run) => !seen.has(run.id))], cursor: current.cursor };
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("schedule.loadFailed"));
      throw caught;
    }
  }, [client, jobId, t]);
  const active = runs?.items.some((run) => run.status === "running" || run.status === "pending") ?? false;
  useSyncScope(`schedule:${jobId}`, load, active ? 10_000 : 60_000, Boolean(jobId));

  const nextRuns = useMemo(() => job ? nextCronRuns(job.cronExpression, job.timezone, 3) : [], [job]);

  const toggle = async (enabled: boolean) => {
    if (!client || !job || busy) return;
    setBusy("toggle");
    try {
      setJob((await client.cronJobs.toggle(job.id, enabled)).job);
      toast({ title: enabled ? t("space.settings.schedule.enabled") : t("space.settings.schedule.disabled") });
    } catch (caught) {
      toast({ title: t("space.settings.schedule.toggleFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!client || !job || !editing || busy) return;
    const problem = scheduleProblem(editing, false, t);
    if (problem) { setEditError(problem); return; }
    setBusy("save");
    setEditError(null);
    try {
      const { job: next } = await client.cronJobs.update(job.id, { title: editing.title.trim(), cronExpression: editing.cronExpression.trim(), timezone: editing.timezone.trim() });
      setJob(next);
      setEditing(null);
      toast({ title: t("schedule.saved") });
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : t("schedule.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!client || !job || busy) return;
    setBusy("delete");
    try {
      await client.cronJobs.delete(job.id);
      setConfirmDelete(false);
      toast({ title: t("schedule.deleted") });
      router.back();
    } catch (caught) {
      toast({ title: t("schedule.deleteFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const loadMore = async () => {
    if (!client || !runs?.cursor || busy) return;
    setBusy("more");
    try {
      const next = await client.cronJobs.runs(jobId, { limit: RUN_PAGE, cursor: runs.cursor });
      setRuns((current) => {
        const seen = new Set((current?.items ?? []).map((run) => run.id));
        return { items: [...(current?.items ?? []), ...next.runs.filter((run) => !seen.has(run.id))], cursor: next.pageInfo.hasMore ? next.pageInfo.nextCursor : null };
      });
    } catch (caught) {
      toast({ title: t("schedule.loadFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const prompt = job ? promptText(job) : null;
  return <Screen>
    <TopBar title={job?.title || t("space.settings.schedule.unnamed")} subtitle={job ? cronSummaryText(summarizeCron(job.cronExpression), job.cronExpression, t) : undefined} onBack={() => router.back()} actions={job ? <IconButton name="square-pen" label={t("schedule.edit")} onPress={() => { setEditError(null); setEditing({ title: job.title, prompt: "", cronExpression: job.cronExpression, timezone: job.timezone }); }} /> : undefined} />
    {error && !job ? <DataError message={error} onRetry={() => void load().catch(() => undefined)} /> : null}
    {!job ? (error ? null : <LoadingSections sections={[{ kind: "group", rows: 4 }, { kind: "group", rows: 2, label: true }]} />) : <ScrollView className="flex-1" contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
      <SettingsGroup>
        <View className="min-h-13 flex-row items-center gap-3 bg-surface px-4 py-2">
          <AppIcon name="calendar-clock" size={18} tone={job.enabled ? "accent" : "muted"} />
          <Text className="min-w-0 flex-1 text-body text-fg">{t(job.enabled ? "schedule.active" : "schedule.paused")}</Text>
          <AppSwitch value={job.enabled} disabled={busy !== null} onValueChange={(enabled) => void toggle(enabled)} accessibilityLabel={t("schedule.enabledLabel")} />
        </View>
        <Detail label={t("schedule.field.repeat")} value={job.cronExpression} mono />
        <Detail label={t("schedule.field.timezone")} value={job.timezone} />
        <Detail label={t("schedule.nextRuns")} value={job.enabled && nextRuns.length ? nextRuns.map((run) => formatRunTime(run, job.timezone, locale)).join("\n") : t("schedule.noNextRun")} />
      </SettingsGroup>
      {prompt ? <SettingsGroup label={t("schedule.field.prompt")}>
        <Text selectable className="bg-surface p-4 text-subhead text-fg-secondary">{prompt}</Text>
      </SettingsGroup> : null}
      <SettingsGroup label={t("schedule.runs")}>
        {!runs ? <View className="min-h-13 items-center justify-center bg-surface"><Loader /></View>
          : runs.items.length === 0 ? <Text className="bg-surface p-4 text-subhead text-fg-muted">{t("schedule.noRuns")}</Text>
          : runs.items.map((run, index) => <RunRow key={run.id} run={run} last={index === runs.items.length - 1 && !runs.cursor} onPress={() => router.push({ pathname: "/task/[taskId]", params: { taskId: run.id } })} />)}
        {runs?.cursor ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.wallet.loadMore")} disabled={busy !== null} onPress={() => void loadMore()} className="min-h-12 flex-row items-center justify-center gap-2 bg-surface active:bg-surface-pressed">
          {busy === "more" ? <Loader /> : <AppIcon name="chevrons-down" size={16} tone="accent" />}
          <Text className="text-subhead font-semibold text-accent">{t("space.wallet.loadMore")}</Text>
        </Pressable> : null}
      </SettingsGroup>
      <PrimaryButton variant="secondary" icon="trash" label={t("schedule.delete")} onPress={() => setConfirmDelete(true)} className="mx-4" />
    </ScrollView>}
    {editing ? <AdaptiveSheet visible title={t("schedule.edit")} onClose={() => { if (busy !== "save") setEditing(null); }} dismissible={busy !== "save"} confirm={{ label: t("common.save"), loading: busy === "save", onPress: () => void save() }}>
      <View className="gap-4">
        <ScheduleForm values={editing} onChange={setEditing} withPrompt={false} disabled={busy === "save"} />
        {editError ? <Text accessibilityRole="alert" selectable className="text-caption text-danger">{editError}</Text> : null}
      </View>
    </AdaptiveSheet> : null}
    <ConfirmSheet visible={confirmDelete} title={t("schedule.delete")} subtitle={job?.title} message={t("schedule.deleteConfirm")} confirmLabel={t("schedule.delete")} confirmIcon="trash" busy={busy === "delete"} onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)} />
  </Screen>;
}

const MONO = { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } as const;

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <View className="flex-row gap-3 bg-surface px-4 py-3">
    <Text className="w-24 text-caption text-fg-muted">{label}</Text>
    <Text selectable className="min-w-0 flex-1 text-subhead tabular-nums text-fg" style={mono ? MONO : undefined}>{value}</Text>
    <View className="absolute left-4 right-0 top-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />
  </View>;
}

function RunRow({ run, last, onPress }: { run: TaskRunRecord; last: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const running = run.status === "running" || run.status === "pending";
  const time = run.startedAt ?? run.scheduledAt ?? run.createdAt;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${run.status}, ${formatRelativeTime(time)}`} onPress={onPress} className="min-h-13 flex-row items-center gap-3 bg-surface py-2.5 pl-4 pr-3 active:bg-surface-pressed">
    <AppIcon name={running ? "sync" : run.status === "failed" ? "alert" : "check-circle"} size={17} tone={running ? "accent" : run.status === "failed" ? "danger" : "success"} />
    <View className="min-w-0 flex-1">
      <Text className="text-body text-fg">{t(`schedule.run.${run.status}`)}</Text>
      {run.errorMessage ? <Text numberOfLines={1} className="text-caption text-danger">{run.errorMessage}</Text> : null}
    </View>
    <Text className="text-caption tabular-nums text-fg-faint">{formatRelativeTime(time)}</Text>
    <AppIcon name="chevron-right" size={16} tone="faint" />
    {last ? null : <View className="absolute bottom-0 left-12 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
  </Pressable>;
}
