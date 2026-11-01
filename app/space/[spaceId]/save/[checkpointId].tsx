import * as Clipboard from "expo-clipboard";
import type { CheckpointDiffFile, CheckpointDiffSummary, CheckpointRecord, SpaceFsEntry } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { SpaceFileRow } from "@/src/components/SpaceFileRow";
import { useToast } from "@/src/components/Toast";
import { DIFF_STATUS, formatDiffCounts, joinSavePath, saveStat, saveTitle } from "@/src/data/checkpoint-diff";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { useTranslation } from "@/src/i18n";
import { AppIcon, DataError, IconButton, Loader, LoadingSections, Screen, Segmented, TopBar } from "@/src/ui";
import { Meta } from "@/src/ui/ListRow";
import { formatRelativeTime, parentSpacePath } from "@/src/utils";

type Params = { spaceId: string; checkpointId: string; base?: string };
type Tab = "changes" | "files";

export default function SaveScreen() {
  const { spaceId = "", checkpointId = "", base } = useLocalSearchParams<Params>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const toast = useToast();
  const { client } = useAppActions();
  const saveQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:save`, checkpointId],
    queryFn: async (): Promise<CheckpointRecord> => (await client!.space(spaceId).checkpoints.get(checkpointId)).checkpoint,
    enabled: Boolean(client && spaceId && checkpointId),
    staleTime: Infinity,
  });
  const save = saveQuery.data ?? null;
  const error = saveQuery.error ? saveQuery.error.message || t("save.loadFailed") : null;
  const [tab, setTab] = useState<Tab>("changes");
  const [comparing, setComparing] = useState(false);
  const title = save ? saveTitle(save, (hash) => t("space.save", { hash })) : t("save.title");

  const copyHash = async () => {
    if (!save) return;
    try {
      await Clipboard.setStringAsync(save.commitHash);
      toast({ title: t("save.hashCopied"), tone: "success" });
    } catch (caught) {
      toast({ title: t("save.copyFailed"), message: caught instanceof Error ? caught.message : undefined, tone: "danger" });
    }
  };

  return <Screen>
    <TopBar title={title} subtitle={save ? formatRelativeTime(save.createdAt) : undefined} onBack={() => router.back()} actions={save ? <IconButton name="copy" label={t("save.copyHash")} onPress={() => void copyHash()} /> : undefined} />
    {error && !save ? <DataError message={error} onRetry={() => void saveQuery.refetch()} /> : null}
    {!save ? (error ? null : <LoadingSections paddingTop={4} sections={[{ kind: "caption" }, { kind: "capsule" }, { kind: "group", rows: 4, leading: true }]} />) : <>
      <View className="gap-3 px-4 pb-3 pt-1">
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <Meta icon="bookmark" value={save.commitHash.slice(0, 12)} label={t("save.commit", { hash: save.commitHash })} />
          <Meta icon="clock" value={new Date(save.createdAt).toLocaleString()} label={new Date(save.createdAt).toLocaleString()} />
          {saveStat(save, "fileCount") !== null ? <Meta icon="file-text" value={String(saveStat(save, "fileCount"))} label={t("save.fileCount", { count: saveStat(save, "fileCount") ?? 0 })} /> : null}
        </View>
        <Segmented value={tab} onChange={setTab} options={[{ value: "changes", label: t("save.changes") }, { value: "files", label: t("save.files") }]} />
      </View>
      {tab === "changes"
        ? <ChangesTab spaceId={spaceId} save={save} base={base ?? null} bottomInset={insets.bottom} onCompare={() => setComparing(true)} />
        : <FilesTab spaceId={spaceId} checkpointId={save.id} bottomInset={insets.bottom} />}
      <CompareSheet
        visible={comparing}
        spaceId={spaceId}
        save={save}
        base={base ?? null}
        onClose={() => setComparing(false)}
        onPick={(next) => { setComparing(false); router.setParams({ base: next ?? undefined }); }}
      />
    </>}
  </Screen>;
}

function ChangesTab({ spaceId, save, base, bottomInset, onCompare }: { spaceId: string; save: CheckpointRecord; base: string | null; bottomInset: number; onCompare: () => void }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useAppActions();
  const diffQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:save`, save.id, "diff", base],
    queryFn: (): Promise<CheckpointDiffSummary> => client!.space(spaceId).checkpoints(save.id).diff.summary({ base }),
    enabled: Boolean(client),
    staleTime: Infinity,
  });
  const summary = diffQuery.data ?? null;
  const failure = diffQuery.error ? diffQuery.error.message || t("save.diffFailed") : null;
  const compareLabel = base && base !== save.parentCheckpointId ? t("save.comparedWith", { hash: base.slice(0, 8) }) : save.parentCheckpointId ? t("save.comparedWithParent") : t("save.firstSave");
  return <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: bottomInset + 32 }}>
    <View className="flex-row items-center gap-2 px-4 pb-2">
      <Text numberOfLines={1} className="min-w-0 flex-1 text-caption text-fg-muted">{compareLabel}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("save.compare")} onPress={onCompare} className="min-h-11 flex-row items-center gap-1 rounded-full px-3 active:bg-surface-pressed">
        <AppIcon name="git-compare" size={16} tone="accent" />
        <Text className="text-caption font-semibold text-accent">{t("save.compare")}</Text>
      </Pressable>
    </View>
    {failure ? <DataError message={failure} onRetry={() => void diffQuery.refetch()} /> : !summary ? <LoadingSections paddingTop={0} sections={[{ kind: "caption" }, { kind: "group", rows: 4, leading: true }]} /> : <>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1 px-4 pb-3">
        <Meta icon="file-text" value={String(summary.stats.changedFileCount)} label={t("save.changedFiles", { count: summary.stats.changedFileCount })} />
        <Text className="text-caption tabular-nums text-success">+{summary.stats.additions}</Text>
        <Text className="text-caption tabular-nums text-danger">−{summary.stats.deletions}</Text>
      </View>
      {summary.files.length === 0 ? <Text className="px-4 py-6 text-center text-subhead text-fg-muted">{t("save.noChanges")}</Text> : <View className="mx-4 overflow-hidden rounded-md bg-surface" style={{ borderCurve: "continuous" }}>
        {summary.files.map((file, index) => <DiffFileRow key={`${file.status}:${file.path}`} file={file} last={index === summary.files.length - 1} onPress={() => router.push({ pathname: "/space/[spaceId]/save/[checkpointId]/diff", params: { spaceId, checkpointId: save.id, path: file.path, ...(base ? { base } : {}) } })} />)}
      </View>}
      {summary.truncated ? <Text className="px-8 pt-2 text-caption text-fg-muted">{t("save.truncated")}</Text> : null}
    </>}
  </ScrollView>;
}

/** Full class names, so the Tailwind scanner sees every variant. */
const STATUS_CLASSES = {
  success: { box: "bg-success-soft", text: "text-success" },
  danger: { box: "bg-danger-soft", text: "text-danger" },
  accent: { box: "bg-accent-soft", text: "text-accent" },
  muted: { box: "bg-surface-raised", text: "text-fg-secondary" },
} as const;

function DiffFileRow({ file, last, onPress }: { file: CheckpointDiffFile; last: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const status = DIFF_STATUS[file.status];
  const name = file.path.split("/").pop() || file.path;
  const directory = parentSpacePath(file.path);
  const counts = file.binary ? t("save.binary") : formatDiffCounts(file.additions, file.deletions);
  const tone = STATUS_CLASSES[status.tone];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t(status.label)}: ${file.path}`} onPress={onPress} className="min-h-13 flex-row items-center gap-3 py-2 pl-4 pr-3 active:bg-surface-pressed">
    <View className={`size-6 items-center justify-center rounded-xs ${tone.box}`}><Text className={`text-micro font-semibold ${tone.text}`}>{status.letter}</Text></View>
    <View className="min-w-0 flex-1">
      <Text numberOfLines={1} className="text-body text-fg">{name}</Text>
      {directory || file.oldPath ? <Text numberOfLines={1} ellipsizeMode="head" className="text-caption text-fg-muted">{file.oldPath && file.oldPath !== file.path ? t("save.renamedFrom", { path: file.oldPath }) : directory}</Text> : null}
    </View>
    {counts ? <Text className="text-caption tabular-nums text-fg-muted">{counts}</Text> : null}
    <AppIcon name="chevron-right" size={16} tone="faint" />
    {last ? null : <View className="absolute bottom-0 left-13 right-0 bg-border" style={{ height: StyleSheet.hairlineWidth }} />}
  </Pressable>;
}

function FilesTab({ spaceId, checkpointId, bottomInset }: { spaceId: string; checkpointId: string; bottomInset: number }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useAppActions();
  const [path, setPath] = useState("");
  const listingQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:save`, checkpointId, "files", path],
    queryFn: async (): Promise<SpaceFsEntry[]> => [...(await client!.space(spaceId).checkpoints(checkpointId).files.list(path || undefined)).entries].sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name)),
    enabled: Boolean(client),
    staleTime: Infinity,
  });
  const entries = listingQuery.data ?? null;
  const failure = listingQuery.error && !entries ? listingQuery.error.message || t("files.loadError") : null;
  return <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: bottomInset + 32 }}>
    {path ? <Pressable accessibilityRole="button" accessibilityLabel={t("files.backToParent")} onPress={() => setPath(parentSpacePath(path))} className="mx-4 mb-2 min-h-11 flex-row items-center gap-2 rounded-sm px-2 active:bg-surface-pressed">
      <AppIcon name="arrow-left" size={16} tone="accent" />
      <Text numberOfLines={1} ellipsizeMode="head" className="min-w-0 flex-1 text-subhead text-fg-secondary">/{path}</Text>
    </Pressable> : null}
    {failure ? <DataError message={failure} onRetry={() => void listingQuery.refetch()} /> : !entries ? <View className="py-6"><Loader /></View>
      : entries.length === 0 ? <Text className="px-4 py-6 text-center text-subhead text-fg-muted">{t("files.emptyFolder")}</Text>
      : <View className="mx-4 overflow-hidden rounded-md bg-surface" style={{ borderCurve: "continuous" }}>
        {entries.map((entry) => <SpaceFileRow key={entry.path || joinSavePath(path, entry.name)} entry={entry} compact onPress={() => {
          if (entry.type === "dir") setPath(entry.path || joinSavePath(path, entry.name));
          else router.push({ pathname: "/space/[spaceId]/save/[checkpointId]/file", params: { spaceId, checkpointId, path: entry.path || joinSavePath(path, entry.name) } });
        }} />)}
      </View>}
  </ScrollView>;
}

function CompareSheet({ visible, spaceId, save, base, onClose, onPick }: { visible: boolean; spaceId: string; save: CheckpointRecord; base: string | null; onClose: () => void; onPick: (base: string | null) => void }) {
  const { t } = useTranslation();
  const { client } = useAppActions();
  const optionsQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:saves`, "compare"],
    queryFn: async (): Promise<CheckpointRecord[]> => (await client!.space(spaceId).checkpoints.list({ limit: 30 })).checkpoints,
    enabled: Boolean(client) && visible,
  });
  const options = optionsQuery.data?.filter((item) => item.id !== save.id) ?? null;
  const error = optionsQuery.error ? optionsQuery.error.message || t("save.loadFailed") : null;
  const current = base && base !== save.parentCheckpointId ? base : null;
  return <AdaptiveSheet visible={visible} title={t("save.compareTitle")} onClose={onClose}>
    <View className="overflow-hidden rounded-md bg-surface-raised" style={{ borderCurve: "continuous" }}>
      <CompareOption label={save.parentCheckpointId ? t("save.parentDefault") : t("save.firstSave")} selected={current === null} onPress={() => onPick(null)} />
      {options?.map((item) => <CompareOption key={item.id} label={saveTitle(item, (hash) => t("space.save", { hash }))} detail={formatRelativeTime(item.createdAt)} selected={current === item.id} onPress={() => onPick(item.id)} />)}
    </View>
    {error ? <Text selectable accessibilityRole="alert" className="mt-2 text-caption text-danger">{error}</Text> : !options ? <View className="py-4"><Loader /></View> : null}
  </AdaptiveSheet>;
}

function CompareOption({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={label} onPress={onPress} className="min-h-13 flex-row items-center gap-3 border-b border-border px-4 py-2 active:bg-surface-pressed">
    <View className="min-w-0 flex-1">
      <Text numberOfLines={1} className="text-body text-fg">{label}</Text>
      {detail ? <Text className="text-caption text-fg-muted">{detail}</Text> : null}
    </View>
    {selected ? <AppIcon name="check" size={18} tone="accent" /> : null}
  </Pressable>;
}
