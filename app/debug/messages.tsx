import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MessageBubble } from "@/src/components/MessageContent";
import { compactionFromMessage } from "@/src/data/compaction";
import { useApp } from "@/src/data/context";
import { mergeDisplayMessages, messagesFromTurns } from "@/src/data/session-history";
import { hasRenderableMessage, isAssistantIntermediate } from "@/src/utils";
import { Screen, SectionHeader } from "@/src/ui";

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function blockSummary(block: ContentBlock): string {
  if (block.type === "text") return `text:${block.text.length}`;
  if (block.type === "thinking") return `thinking:${block.thinking.length}`;
  if (block.type === "tool_use") return `tool_use:${block.name}`;
  if (block.type === "tool_result") return "tool_result";
  if (block.type === "image") return "image";
  if (block.type === "shell_command") return `shell:${block.command.length}`;
  return `note:${block.note_type}`;
}

function contentSummary(content: ContentBlock[] | null | undefined): string {
  if (content == null) return "null";
  if (!Array.isArray(content)) return typeof content;
  if (content.length === 0) return "[]";
  return `[${content.map(blockSummary).join(", ")}]`;
}

const CONTROL_MESSAGE: MessageRecord = {
  id: "debug-usage-control",
  sessionId: "debug-usage",
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "对照组：合成消息（usage.output = 1160，footer 应显示 ↓1.2K）。" }],
  text: "对照组：合成消息（usage.output = 1160，footer 应显示 ↓1.2K）。",
  sequence: -1,
  provider: "cohub",
  model: "deepseek-flash",
  stopReason: "stop",
  errorMessage: null,
  usage: { input: 1000, output: 1160, cacheRead: 253184, cacheWrite: 0, totalTokens: 255344 },
  meta: { messageKind: "assistant_final", turnId: "debug-control", requestedThinkingLevel: "xhigh" },
  authorUuid: null,
  authorProfile: null,
  startedAt: null,
  completedAt: null,
  durationMs: 0,
  createdAt: new Date().toISOString(),
};

/**
 * Renders the exact assistant messages the chat timeline would show, with the
 * raw `usage` payload next to the real bubble footer. Used to tell apart
 * "usage missing on the message" from "footer failed to render it".
 */
export default function DebugMessagesScreen() {
  const { state } = useApp();
  const loaded = useMemo(
    () => state.sessions.filter((session) => state.sessionViews[session.id]),
    [state.sessions, state.sessionViews],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sessionId = selectedId ?? loaded[0]?.id ?? null;
  const view = sessionId ? state.sessionViews[sessionId] : null;

  const messages = useMemo(() => {
    if (!view) return [];
    const history = messagesFromTurns(view.turns);
    return mergeDisplayMessages(
      history.length > 0 ? history : view.messages,
      history.length > 0 ? view.messages : [],
    )
      .filter((message) => !isAssistantIntermediate(message) && hasRenderableMessage(message))
      .sort((a, b) => a.sequence - b.sequence);
  }, [view]);

  const assistantMessages = messages.filter((message) => message.role === "assistant").slice(-8);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <SectionHeader title="已加载的对话" />
        <View className="px-4 flex-row flex-wrap gap-2">
          {loaded.slice(0, 6).map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: session.id === sessionId }}
              onPress={() => setSelectedId(session.id)}
              className={`min-h-9 justify-center rounded-full px-3 ${session.id === sessionId ? "bg-accent-soft" : "bg-surface active:bg-surface-pressed"}`}
            >
              <Text numberOfLines={1} className={`text-caption max-w-55 ${session.id === sessionId ? "text-accent" : "text-fg-muted"}`}>{session.title?.trim() || session.id.slice(0, 8)}</Text>
            </Pressable>
          ))}
          {loaded.length === 0 ? (
            <Text className="text-caption text-fg-muted">没有已加载的对话：先打开一个对话，再回到这里。</Text>
          ) : null}
        </View>

        {view ? <>
          <SectionHeader title="状态" />
          <View className="mx-4 border rounded-md overflow-hidden border-border bg-surface">
            <Row label="historyLoaded" value={String(view.historyLoaded)} />
            <Row label="turns / messages" value={`${view.turns.length} / ${view.messages.length}`} />
            <Row label="stream" value={view.stream ? `${view.stream.status}${view.stream.turnId ? ` · ${view.stream.turnId.slice(0, 8)}` : ""}` : "—"} />
          </View>

          <SectionHeader title="对照组（合成消息）" />
          <Text selectable className="text-caption text-fg-muted mx-4 mb-1">
            固定 usage.output=1160；气泡 footer 应显示 ↓1.2K。
          </Text>
          <View className="mx-4 border border-border" style={{ borderStyle: "dashed" }}>
            <MessageBubble message={CONTROL_MESSAGE} />
          </View>

          <SectionHeader title="最近的 assistant 消息（usage + 真实渲染）" />
          {assistantMessages.length === 0 ? (
            <Text className="text-caption text-fg-muted mx-4">没有 assistant 消息。</Text>
          ) : assistantMessages.map((message) => {
            const usage = message.usage;
            const inputValue = (usage?.input ?? 0) + (usage?.cacheRead ?? 0);
            const cached = typeof usage?.cacheRead === "number" && usage.cacheRead > 0 ? formatTokenCount(usage.cacheRead) : null;
            const input = inputValue > 0 ? formatTokenCount(inputValue) : null;
            const output = typeof usage?.output === "number" && usage.output > 0 ? formatTokenCount(usage.output) : null;
            return <View key={message.id} className="mt-3">
              <Text selectable className="text-micro font-semibold text-fg-faint mx-4">{`#${message.sequence} · ${String(message.meta?.messageKind ?? "?")} · ${message.model ?? "—"}`}</Text>
              <Text selectable className="text-code text-fg-secondary mx-4 mt-1">{usage ? JSON.stringify(usage) : "usage: null"}</Text>
              <Text selectable className="text-code text-fg-muted mx-4 mt-1">
                {`live=${message.meta?._mobileLive === true ? "y" : "n"} text=${message.text == null ? "null" : `${message.text.length}c`} content=${contentSummary(message.content)} notice=${compactionFromMessage(message) ? "y" : "n"} render=${hasRenderableMessage(message) ? "y" : "n"}`}
              </Text>
              <Text selectable className="text-code text-fg-faint mx-4 mt-1">
                {`keys: ${Object.keys(message).join(",")}${message.meta ? ` · meta: ${Object.keys(message.meta).join(",")}` : ""}`}
              </Text>
              <Text selectable className={`text-caption mx-4 mt-1 ${output ? "text-success" : "text-danger"}`}>
                {`tokens → input ${input ?? "—"} / cached ${cached ?? "—"} / output ${output ? `↓${output}` : "MISSING"}`}
              </Text>
              <Text selectable className="text-micro font-semibold text-fg-faint mx-4 mt-1.5">气泡 ↓（虚线框内）</Text>
              <View className="mx-4 mt-0.5 border border-border" style={{ borderStyle: "dashed" }}>
                <MessageBubble message={message} />
              </View>
            </View>;
          })}
        </> : null}
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-12 px-3 py-2 flex-row items-center gap-3 border-b border-border">
      <Text className="text-caption text-fg-muted w-32">{label}</Text>
      <Text selectable className="text-caption text-fg flex-1 text-right">{value}</Text>
    </View>
  );
}

