import type { CohubClient, ContentBlock, SessionTurnRecord } from "@neta-art/cohub";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { LineDeltaText, MessageContent, useChipStyle } from "@/src/components/MessageContent";
import { streamingSteps, thinkingBlocks, turnProcessSummary } from "@/src/data/chat-rendering";
import { changedFiles } from "@/src/data/tool-call";
import type { StreamView } from "@/src/data/types";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Loader } from "@/src/ui";

/** Archived steps never change for an object key, so one read serves every later expansion. */
export function turnStepsQuery(client: CohubClient | null, spaceId: string, turn: SessionTurnRecord) {
  const objectKey = turn.intermediateIndex?.messagesObjectKey;
  return {
    queryKey: ["turn-steps", turn.sessionId, turn.id, objectKey],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ContentBlock[]> => {
      const api = client!.space(spaceId).session(turn.sessionId).turns.intermediate;
      const file = await api.get(turn.id, objectKey!, { signal });
      const blocks = await Promise.all((file?.messages ?? []).map(async (message) => {
        const tools = message.toolCallsObjectKey ? await api.getToolCalls(turn.id, message, { signal }) : null;
        const body: ContentBlock[] = message.content.length ? message.content : message.text ? [{ type: "text", text: message.text }] : [];
        if (!tools) return body;
        return [...body.filter((block) => block.type !== "tool_use" && block.type !== "tool_result"), ...tools.toolCalls.flatMap((tool): ContentBlock[] => [
          { type: "tool_use", id: tool.id, name: tool.name, input: tool.input },
          ...(tool.result ? [{ type: "tool_result" as const, tool_use_id: tool.id, content: tool.result.content ?? "", is_error: tool.result.isError }] : []),
        ])];
      }));
      return blocks.flat();
    },
    staleTime: Infinity,
  };
}

export function TurnProcess({ turn, client, spaceId }: { turn: SessionTurnRecord; client: CohubClient | null; spaceId: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const objectKey = turn.intermediateIndex?.messagesObjectKey;
  const steps = useQuery({ ...turnStepsQuery(client, spaceId, turn), enabled: expanded && Boolean(objectKey && client) });
  const content = steps.data ?? null;
  const errorMessage = expanded && objectKey && !client
    ? t("turn.connect")
    : steps.error && !steps.isFetching ? steps.error.message || t("turn.loadError") : null;
  // The reply shows only its answer; the thinking behind it closes the steps.
  const thinking = useMemo(() => thinkingBlocks(turn.assistantContent), [turn.assistantContent]);
  const summary = turn.intermediateSummary;
  const hasSteps = Boolean(objectKey || summary?.messageCount || summary?.toolCallCount);
  if (!hasSteps && thinking.length === 0) return null;
  const process = turnProcessSummary(t, { hasSteps, steps: summary?.messageCount ?? null, tools: summary?.toolCallCount ?? null, durationMs: turn.durationMs ?? null });
  return <ProcessDisclosure process={process} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    {!hasSteps ? null : errorMessage ? <Pressable accessibilityRole="button" onPress={() => void steps.refetch()}><Text className="text-caption text-danger">{errorMessage} {t("common.retry")}</Text></Pressable> : !objectKey ? <Text className="text-caption text-fg-muted">{t("turn.notArchived")}</Text> : content === null ? <Loader /> : content.length ? <><ChangedFiles blocks={content} /><MessageContent content={content} /></> : thinking.length ? null : <Text className="text-caption text-fg-muted">{t("turn.none")}</Text>}
    {thinking.length ? <MessageContent content={thinking} /> : null}
  </ProcessDisclosure>;
}

/** The files a Turn's steps changed, as wrapping chips: the name and its line delta. */
function ChangedFiles({ blocks }: { blocks: ContentBlock[] }) {
  const { t } = useTranslation();
  const { chip, mono } = useChipStyle();
  const files = useMemo(() => changedFiles(blocks), [blocks]);
  if (files.length === 0) return null;
  return <View className="flex-row flex-wrap gap-1.5">
    {files.map((file) => <View key={file.path} accessible accessibilityLabel={`${file.path}: ${t("message.tool.lineDelta", { added: file.delta.added, removed: file.delta.removed })}`} className="max-w-full rounded-[6px] px-1.5 py-[3px]" style={chip}>
      <Text numberOfLines={1} className="text-fg-secondary" style={mono}>{file.name}<LineDeltaText delta={file.delta} lead /></Text>
    </View>)}
  </View>;
}

/** The summary as `Meta` items; the row's padding holds the 32pt row's 44pt touch target, and its highlight reaches past the text column. */
function ProcessDisclosure({ process, expanded, onToggle, children }: { process: ReturnType<typeof turnProcessSummary>; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return <View className="px-4 py-2">
    <Pressable accessibilityRole="button" accessibilityLabel={process.label} accessibilityState={{ expanded }} onPress={onToggle} hitSlop={6} className="-ml-2 h-8 max-w-full flex-row items-center gap-2.5 self-start rounded-full px-2 active:bg-surface-pressed">
      {process.items.map((item) => <View key={item.icon} className="min-w-0 shrink flex-row items-center gap-1">
        <AppIcon name={item.icon} size={13} tone="muted" />
        <Text numberOfLines={1} className="shrink text-caption text-fg-muted tabular-nums">{item.value}</Text>
      </View>)}
      <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={13} tone="faint" />
    </Pressable>
    {expanded ? <View className="mt-2 gap-2 border-l border-border pl-3">{children}</View> : null}
  </View>;
}

export function StreamingTurnProcess({ messages, thinking }: { messages: StreamView["intermediateMessages"]; thinking: ContentBlock[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // Collapsed rows still run on every dispatch; derive once per snapshot instead.
  const { content, tools } = useMemo(() => streamingSteps(messages), [messages]);
  if (messages.length === 0 && thinking.length === 0) return null;
  const process = turnProcessSummary(t, { hasSteps: messages.length > 0, steps: messages.length, tools, durationMs: null });
  return <ProcessDisclosure process={process} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    {!messages.length ? null : content.length ? <><ChangedFiles blocks={content} /><MessageContent content={content} /></> : thinking.length ? null : <Text className="text-caption text-fg-muted">{t("turn.none")}</Text>}
    {thinking.length ? <MessageContent active content={thinking} /> : null}
  </ProcessDisclosure>;
}
