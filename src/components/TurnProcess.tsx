import type { CohubClient, ContentBlock, SessionTurnRecord } from "@neta-art/cohub";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { MessageContent } from "@/src/components/MessageContent";
import type { StreamView } from "@/src/data/types";
import { useTranslation } from "@/src/i18n";
import { AppIcon, Loader } from "@/src/ui";

export function TurnProcess({ turn, client, spaceId }: { turn: SessionTurnRecord; client: CohubClient | null; spaceId: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; content: ContentBlock[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const objectKey = turn.intermediateIndex?.messagesObjectKey;
  const loadKey = `${turn.sessionId}:${turn.id}:${objectKey ?? ""}:${attempt}`;
  const content = loaded?.key === loadKey ? loaded.content : null;
  const errorMessage = expanded && objectKey && !client
    ? t("turn.connect")
    : error?.key === loadKey ? error.message : null;
  useEffect(() => {
    if (!expanded || !objectKey || !client) return;
    let active = true;
    const controller = new AbortController();
    const api = client.space(spaceId).session(turn.sessionId).turns.intermediate;
    void (async () => {
      const file = await api.get(turn.id, objectKey, { signal: controller.signal });
      const blocks = await Promise.all((file?.messages ?? []).map(async (message) => {
        const tools = message.toolCallsObjectKey ? await api.getToolCalls(turn.id, message, { signal: controller.signal }) : null;
        const body: ContentBlock[] = message.content.length ? message.content : message.text ? [{ type: "text", text: message.text }] : [];
        if (!tools) return body;
        return [...body.filter((block) => block.type !== "tool_use" && block.type !== "tool_result"), ...tools.toolCalls.flatMap((tool): ContentBlock[] => [
          { type: "tool_use", id: tool.id, name: tool.name, input: tool.input },
          ...(tool.result ? [{ type: "tool_result" as const, tool_use_id: tool.id, content: tool.result.content ?? "", is_error: tool.result.isError }] : []),
        ])];
      }));
      if (active) setLoaded({ key: loadKey, content: blocks.flat() });
    })().catch((cause: unknown) => { if (active) setError({ key: loadKey, message: cause instanceof Error ? cause.message : t("turn.loadError") }); });
    return () => { active = false; controller.abort(); };
  }, [client, expanded, loadKey, objectKey, spaceId, t, turn.id, turn.sessionId]);
  const summary = turn.intermediateSummary;
  if (!objectKey && !summary?.messageCount && !summary?.toolCallCount) return null;
  const label = `${summary ? t("turn.steps", { steps: summary.messageCount, tools: summary.toolCallCount }) : t("turn.executionDetails")}${turn.durationMs != null ? ` · ${Math.round(turn.durationMs / 1000)}s` : ""}`;
  return <ProcessDisclosure label={label} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    {errorMessage ? <Pressable accessibilityRole="button" onPress={() => setAttempt(attempt + 1)}><Text className="text-caption text-danger">{errorMessage} {t("common.retry")}</Text></Pressable> : !objectKey ? <Text className="text-caption text-fg-muted">{t("turn.notArchived")}</Text> : content === null ? <Loader /> : content.length ? <MessageContent content={content} /> : <Text className="text-caption text-fg-muted">{t("turn.none")}</Text>}
  </ProcessDisclosure>;
}

/** The row's padding holds the 32pt capsule's 44pt touch target; hitSlop never reaches past a parent. */
function ProcessDisclosure({ label, expanded, onToggle, children }: { label: string; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  return <View className="px-4 py-1.5">
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={onToggle} hitSlop={6} className="h-8 max-w-full flex-row items-center gap-1 self-start rounded-full bg-surface-raised pl-2 pr-3 active:bg-surface-pressed">
      <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={14} tone="muted" />
      <Text numberOfLines={1} className="shrink text-caption text-fg-muted">{label}</Text>
    </Pressable>
    {expanded ? <View className="mt-2 gap-2 border-l border-border pl-3">{children}</View> : null}
  </View>;
}

export function StreamingTurnProcess({ messages }: { messages: StreamView["intermediateMessages"] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // Collapsed rows still run on every dispatch; derive once per snapshot instead.
  const { content, toolCount } = useMemo(() => {
    let tools = 0;
    const blocks: ContentBlock[] = [];
    for (const message of messages) {
      for (const block of message.content) if (block.type === "tool_use") tools += 1;
      if (message.content.length) blocks.push(...message.content);
      else if (message.text) blocks.push({ type: "text", text: message.text });
    }
    return { content: blocks, toolCount: tools };
  }, [messages]);
  if (messages.length === 0) return null;
  return <ProcessDisclosure label={t("turn.steps", { steps: messages.length, tools: toolCount })} expanded={expanded} onToggle={() => setExpanded(!expanded)}>
    {content.length ? <MessageContent content={content} /> : <Text className="text-caption text-fg-muted">{t("turn.none")}</Text>}
  </ProcessDisclosure>;
}
