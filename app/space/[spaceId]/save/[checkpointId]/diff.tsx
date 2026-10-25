import type { CheckpointDiffFileResponse, CheckpointDiffPatchLine } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DIFF_STATUS, formatDiffCounts } from "@/src/data/checkpoint-diff";
import { useApp } from "@/src/data/context";
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
  const { client } = useApp();
  const [diff, setDiff] = useState<CheckpointDiffFileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!client || !path) return;
    let active = true;
    void client.space(spaceId).checkpoints(checkpointId).diff.file(path, { base: base ?? null })
      .then((result) => { if (active) { setDiff(result); setError(null); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : t("save.diffFailed")); });
    return () => { active = false; };
  }, [attempt, base, checkpointId, client, path, spaceId, t]);
  const name = path.split("/").pop() || path;
  const status = diff?.status ? DIFF_STATUS[diff.status] : null;
  const subtitle = [status ? t(status.label) : null, diff ? formatDiffCounts(diff.additions, diff.deletions) : null].filter(Boolean).join(" · ");
  const unavailable = diff && diff.kind !== "text" ? t(diff.kind === "binary" || diff.kind === "asset" ? "save.binaryDiff" : diff.kind === "too_large" ? "save.tooLargeDiff" : "save.diffUnavailable") : null;
  return <Screen>
    <TopBar title={name} subtitle={subtitle || path} onBack={() => router.back()} />
    {error ? <DataError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : !diff ? <LoadingDocument /> : unavailable ? <Text className="px-6 py-10 text-center text-subhead text-fg-muted">{unavailable}</Text> : (
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
