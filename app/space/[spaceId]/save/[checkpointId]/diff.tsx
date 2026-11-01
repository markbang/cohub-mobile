import type { CheckpointDiffFileResponse, CheckpointDiffPatchLine } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DIFF_STATUS, formatDiffCounts } from "@/src/data/checkpoint-diff";
import { useAppActions } from "@/src/data/context";
import { useScreenQuery } from "@/src/data/query";
import { useTranslation } from "@/src/i18n";
import { DataError, LoadingDocument, Screen, TopBar } from "@/src/ui";

type Params = { spaceId: string; checkpointId: string; path: string; base?: string };

const MONO = { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" } as const;

/** Full class names, so the Tailwind scanner sees every variant. */
const LINE_CLASSES: Record<CheckpointDiffPatchLine["type"], { row: string; text: string; prefix: string }> = {
  add: { row: "bg-success-soft", text: "text-success", prefix: "+" },
  del: { row: "bg-danger-soft", text: "text-danger", prefix: "−" },
  hunk: { row: "bg-surface-raised", text: "text-fg-muted", prefix: "" },
  meta: { row: "", text: "text-fg-faint", prefix: "" },
  context: { row: "", text: "text-fg-secondary", prefix: " " },
};

export default function SaveDiffScreen() {
  const { spaceId = "", checkpointId = "", path = "", base } = useLocalSearchParams<Params>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { client } = useAppActions();
  const diffQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:save`, checkpointId, "diff-file", path, base ?? null],
    queryFn: (): Promise<CheckpointDiffFileResponse> => client!.space(spaceId).checkpoints(checkpointId).diff.file(path, { base: base ?? null }),
    enabled: Boolean(client && path),
    staleTime: Infinity,
  });
  const diff = diffQuery.data ?? null;
  const error = diffQuery.error ? diffQuery.error.message || t("save.diffFailed") : null;
  const name = path.split("/").pop() || path;
  const status = diff?.status ? DIFF_STATUS[diff.status] : null;
  const subtitle = [status ? t(status.label) : null, diff ? formatDiffCounts(diff.additions, diff.deletions) : null].filter(Boolean).join(" · ");
  const unavailable = diff && diff.kind !== "text" ? t(diff.kind === "binary" || diff.kind === "asset" ? "save.binaryDiff" : diff.kind === "too_large" ? "save.tooLargeDiff" : "save.diffUnavailable") : null;
  return <Screen>
    <TopBar title={name} subtitle={subtitle || path} onBack={() => router.back()} />
    {error ? <DataError message={error} onRetry={() => void diffQuery.refetch()} /> : !diff ? <LoadingDocument /> : unavailable ? <Text className="px-6 py-10 text-center text-subhead text-fg-muted">{unavailable}</Text> : (
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {/* Long lines scroll sideways together, so columns stay aligned like a terminal diff. */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: "100%" }}>
          <View className="min-w-full py-2">
            {diff.lines.map((line, index) => {
              const classes = LINE_CLASSES[line.type];
              return <View key={index} className={`flex-row px-3 ${classes.row}`}>
                <Text selectable className={`text-code ${classes.text}`} style={MONO}>{classes.prefix}{line.text}</Text>
              </View>;
            })}
          </View>
        </ScrollView>
        {diff.truncated ? <Text className="px-6 pt-3 text-caption text-fg-muted">{t("save.diffTruncated")}</Text> : null}
      </ScrollView>
    )}
  </Screen>;
}
