import type { ContentBlock, MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { MessageBubble, StreamCard } from "@/src/components/MessageContent";
import { StreamingTurnProcess, TurnProcess } from "@/src/components/TurnProcess";
import { Screen } from "@/src/ui";

const NOW = new Date().toISOString();

const LONG_OUTPUT = [
  "> cohub-mobile@1.7.0 typecheck",
  "> tsc --noEmit --noUnusedLocals --noUnusedParameters",
  "",
  ...Array.from({ length: 24 }, (_, index) => `src/components/MessageContent.tsx(${60 + index},7): error TS2322: Type 'string' is not assignable to type 'ReactNode'.`),
  "",
  "Found 24 errors in 1 file.",
].join("\n");

const FILE_OUTPUT = Array.from({ length: 36 }, (_, index) => `${String(index + 1).padStart(3, " ")}  ${index % 6 === 0 ? "// section" : "const value = compute(index);"}`).join("\n");

const EDIT_CONTEXT = Array.from({ length: 5 }, (_, index) => `const kept${index} = ${index};`);
const EDIT_OLD = [...EDIT_CONTEXT, ...Array.from({ length: 4 }, (_, index) => `const oldLine${index} = "before";`), ...EDIT_CONTEXT].join("\n");
const EDIT_NEW = [...EDIT_CONTEXT, ...Array.from({ length: 6 }, (_, index) => `const newLine${index} = "after";`), ...EDIT_CONTEXT].join("\n");

const BLOCKS: ContentBlock[] = [
  { type: "text", text: "下面覆盖长输出、报错、编辑 diff 和运行中的工具调用。点每一行展开，重点看展开后下方的空白高度。" },
  { type: "tool_use", id: "t-short", name: "terminal", input: { command: "git status --short" } },
  { type: "tool_result", tool_use_id: "t-short", content: "## main", is_error: false },
  { type: "tool_use", id: "t-long", name: "terminal", input: { command: "npm run typecheck" } },
  { type: "tool_result", tool_use_id: "t-long", content: LONG_OUTPUT, is_error: false },
  { type: "tool_use", id: "t-read", name: "read_file", input: { path: "src/components/MessageContent.tsx" } },
  { type: "tool_result", tool_use_id: "t-read", content: FILE_OUTPUT, is_error: false },
  { type: "tool_use", id: "t-error", name: "terminal", input: { command: "npm run native:ios" } },
  { type: "tool_result", tool_use_id: "t-error", content: "xcrun: error: unable to find utility \"xcodebuild\"", is_error: true },
  { type: "tool_use", id: "t-edit", name: "edit", input: { path: "/workspace/src/data/markdown.ts", edits: [{ oldText: EDIT_OLD, newText: EDIT_NEW }] } },
  { type: "tool_result", tool_use_id: "t-edit", content: "Applied 1 edit.", is_error: false },
  { type: "tool_use", id: "t-running", name: "read_file", input: { path: "src/data/markdown.ts" } },
  { type: "text", text: "如果展开后出现明显空白，记下是哪一种工具和大概高度，反馈给我。" },
];

const MESSAGE = {
  id: "debug-tools",
  sessionId: "debug-tools",
  role: "assistant",
  content: BLOCKS,
  text: "",
  sequence: 1,
  provider: "cohub",
  model: "debug-agent",
  stopReason: "stop",
  errorMessage: null,
  usage: null,
  meta: null,
  startedAt: NOW,
  completedAt: NOW,
  durationMs: 0,
  createdAt: NOW,
} as MessageRecord;

const STEPS: { messageId: string | null; messageOrdinal: number | null; content: ContentBlock[] }[] = [
  { messageId: "s1", messageOrdinal: 1, content: BLOCKS.slice(1, 11) },
  { messageId: "s2", messageOrdinal: 2, content: [
    { type: "tool_use", id: "t-write", name: "write", input: { path: "/workspace/src/data/markdown.test.ts", content: "import { parse } from \"./markdown\";\n\ntest(\"parse\", () => {\n  expect(parse(\"# a\")).toBeTruthy();\n});" } },
    { type: "tool_result", tool_use_id: "t-write", content: "Wrote 5 lines.", is_error: false },
  ] },
];

const TURN = { id: "debug-tools-turn", sessionId: "debug-tools", sequence: 1, status: "completed", intermediateIndex: null, intermediateSummary: { messageCount: 6, toolCallCount: 14 }, durationMs: 72_400, assistantContent: [] } as unknown as SessionTurnRecord;
const THOUGHT_TURN = { ...TURN, id: "debug-tools-thought", intermediateSummary: null, durationMs: 4_000, assistantContent: [{ type: "thinking", thinking: "The file is short; read it whole." }] } as unknown as SessionTurnRecord;

export default function DebugToolsScreen() {
  // The live card counts from when this screen opened.
  const [startedAt] = useState(() => new Date().toISOString());
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingVertical: 12 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 pb-2">
          <Text className="text-caption text-fg-muted">
            点击工具行展开或收起；展开态内部输出可纵向滚动。
          </Text>
        </View>
        <TurnProcess turn={THOUGHT_TURN} client={null} spaceId="debug" />
        <TurnProcess turn={TURN} client={null} spaceId="debug" />
        <StreamingTurnProcess messages={STEPS} thinking={[]} />
        <MessageBubble message={MESSAGE} />
        <StreamCard content={[{ type: "text", text: "Still working on the rest…" }]} status="streaming" startedAt={startedAt} />
        <StreamCard content={[{ type: "thinking", thinking: "Checking the remaining files." }]} status="streaming" startedAt={startedAt} />
      </ScrollView>
    </Screen>
  );
}
