import type { ContentBlock, MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { MessageBubble, StreamCard } from "@/src/components/MessageContent";
import { useReducedMotion } from "react-native-reanimated";
import { NativeChatTimeline, type NativeChatTimelineHandle } from "@/src/components/timeline/NativeChatTimeline";
import { ChatTimelineView, nativeChatTimeline } from "@/src/platform/chat-timeline";
import { ComposerInput, IconButton, Screen, TopBar } from "@/src/ui";
import { EdgeFooter, EdgeHeader, useEdgeChrome, useKeyboardCoveredInset } from "@/src/ui/EdgeChrome";
import { usePaneWidth } from "@/src/ui/pane";

/**
 * The Chat screen's own chrome and native timeline over fixed conversations, so its layout can be
 * captured on both platforms without an account's data. `?fixture=` picks the conversation.
 */
const FIXTURES = ["conversation", "tools", "long", "states", "media", "stream"] as const;
type Fixture = (typeof FIXTURES)[number];

const NO_TURNS: ReadonlyMap<string, SessionTurnRecord> = new Map();
const NO_TURN_SEQUENCES: ReadonlyMap<number, SessionTurnRecord[]> = new Map();
const NOOP = () => undefined;

export default function DebugChatScreen() {
  const router = useRouter();
  // `?native=1` draws the native timeline where the Chat screen does not (iOS), to debug it;
  // `?native=0` draws the JS list that binaries without the native timeline fall back to.
  const params = useLocalSearchParams<{ fixture?: string; native?: string }>();
  const useNative = params.native !== "0" && (nativeChatTimeline || (ChatTimelineView !== null && params.native === "1"));
  const fixture: Fixture = FIXTURES.includes(params.fixture as Fixture) ? params.fixture as Fixture : "conversation";
  const messages = useMemo(() => conversation(fixture), [fixture]);
  const { headerHeight, footerHeight, onHeaderLayout, onFooterLayout } = useEdgeChrome({ reserveComposer: true });
  const keyboardCoveredInset = useKeyboardCoveredInset();
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState("");
  const width = usePaneWidth();
  // Printed under the bar so a snapshot shows whether rows were laid out (frame) even when none is painted.
  const timelineRef = useRef<NativeChatTimelineHandle>(null);
  const [probe, setProbe] = useState("probing…");
  useEffect(() => {
    // Probed every two seconds: a row that appears late shows up in a later snapshot of the line.
    const timer = setInterval(() => {
      if (!useNative) { setProbe("JS list"); return; }
      void timelineRef.current?.inspect().then((result) => {
        const frame = result.firstFrame ? `${Math.round(result.firstFrame.x)},${Math.round(result.firstFrame.y)} ${Math.round(result.firstFrame.width)}×${Math.round(result.firstFrame.height)}` : "none";
        const state = result.state;
        setProbe([
          `rows ${result.rows} · visible ${state?.visibleKeys.length ?? "?"} · first ${frame}`,
          `following ${state?.following} · toLatest ${state?.distanceToLatest === null || state?.distanceToLatest === undefined ? "?" : Math.round(state.distanceToLatest)} · toOldest ${state?.distanceToOldest === null || state?.distanceToOldest === undefined ? "?" : Math.round(state.distanceToOldest)}`,
          `setRows failures ${result.rowsFailures}${result.rowsError ? ` · ${result.rowsError}` : ""}`,
          ...(state?.viewportWidth === undefined ? [] : [`native viewport ${Math.round(state.viewportWidth)}×${Math.round(state.viewportHeight ?? 0)} · rows ${state.rowCount} · content ${Math.round(state.contentHeight ?? 0)}`]),
          ...(state?.diagnostics ? [JSON.stringify(state.diagnostics)] : []),
        ].join("\n"));
      }).catch((error: unknown) => setProbe(`probe failed: ${String(error)}`));
    }, 2000);
    return () => clearInterval(timer);
  }, [fixture, useNative]);

  return <Screen edgeToEdge>
    <EdgeHeader onLayout={onHeaderLayout}>
      <TopBar transparent title="Fix the Android sheet height" subtitle="Home" onBack={() => router.back()} actions={<>
        <IconButton name="list-tree" label="Turns" size={38} onPress={NOOP} />
        <IconButton name="more" label="More" size={38} onPress={NOOP} />
      </>} />
      <Text testID="debug-chat-probe" className="px-4 text-micro text-fg-muted">{probe}</Text>
    </EdgeHeader>
    <View className="flex-1 min-h-0 bg-background">
      {useNative ? <NativeChatTimeline
        key={fixture}
        ref={timelineRef}
        sessionId={`debug-${fixture}`}
        spaceId=""
        client={null}
        messages={messages}
        turnsById={NO_TURNS}
        turnsBySequence={NO_TURN_SEQUENCES}
        streamTurnId={null}
        replyAnchor={null}
        liveStream={false}
        forkOrigin={null}
        hasMoreOlder={false}
        hasMoreNewer={false}
        loadingOlder={false}
        loadingNewer={false}
        retryDisabled={false}
        pendingReply={false}
        arrivalBaseline={null}
        forkingTurnId={null}
        flight={null}
        headerHeight={headerHeight}
        footerHeight={footerHeight}
        keyboardCoveredInset={keyboardCoveredInset}
        keyboardFrozen={false}
        reducedMotion={reducedMotion}
        lookupSession={() => null}
        onOpenRelated={NOOP}
        onCopy={async () => undefined}
        onRetry={NOOP}
        onDiscard={NOOP}
        onFork={NOOP}
        onLoadOlder={NOOP}
        onLoadNewer={NOOP}
        onFollowingChange={NOOP}
        onVisibleMessages={NOOP}
        onNearEdge={NOOP}
        onLoad={NOOP}
        onDragBegin={NOOP}
        onFlightEnd={NOOP}
        onScrollOffset={NOOP}
        onWidth={NOOP}
        refreshing={false}
        onRefresh={NOOP}
      /> : <FlatList
        // The Chat screen's JS list path: what iOS and binaries without the native timeline draw.
        key={fixture}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <MessageBubble message={item} availableWidth={width} />}
        contentContainerStyle={{ paddingTop: headerHeight + 12, paddingBottom: footerHeight + 12 }}
        // A reply still being written; the native timeline reads live replies from a Chat's stream, which a fixture has none of.
        ListFooterComponent={fixture === "stream" ? <StreamCard content={STREAM_REPLY} status="streaming" availableWidth={width} /> : null}
      />}
    </View>
    <EdgeFooter keyboard onLayout={onFooterLayout}>
      <ComposerInput value={draft} onChangeText={setDraft} onSend={() => setDraft("")} onAttach={NOOP} modelLabel="Claude Sonnet" modelDetail="High" modelStatus="available" />
    </EdgeFooter>
  </Screen>;
}

type Line = { role: "user" | "assistant"; text?: string; content?: ContentBlock[]; error?: string };

const PNG = (data: string): ContentBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
const STREAM_REPLY: ContentBlock[] = [{ type: "text", text: "Three issues are open. The Android sheet height is the oldest; the other two are about the tablet layout and" }];

const SCRIPTS: Record<Fixture, Line[]> = {
  conversation: [
    { role: "user", text: "The sheet on Android takes almost the whole screen for two rows. Can you find out why?" },
    { role: "assistant", text: "## What happens\n\nThe sheet defaults to the **large** detent, which is the full-height page sheet. Short content should use `detent=\"fit\"` instead.\n\n1. Forms with text input keep the page sheet.\n2. Pickers and short details size to their rows.\n\n```tsx\n<AdaptiveSheet detent=\"fit\" title=\"Sheet\" onClose={close}>\n  {rows}\n</AdaptiveSheet>\n```" },
    { role: "user", text: "Put the call sites in a table." },
    { role: "assistant", text: "| Sheet | Content | Detent |\n| --- | --- | --- |\n| Create Space | Form | Large |\n| Promotion | Link and funnel | Fit |\n| Feedback | Form | Large |\n\nThe catalog's sample sheet now uses the fit detent as well." },
    { role: "user", text: "Thanks 👍" },
    { role: "assistant", text: "You're welcome. The next snapshot run will show both sheets side by side." },
  ],
  tools: [
    { role: "user", text: "Read src/example.ts and tell me what it exports." },
    { role: "assistant", content: [
      { type: "tool_use", id: "debug-read", name: "read", input: { path: "src/example.ts" } },
      { type: "tool_result", tool_use_id: "debug-read", content: [{ type: "text", text: "```ts\nexport const example = true;\nexport function run() {\n  return example;\n}\n```" }], is_error: false },
      { type: "text", text: "It exports a constant, `example`, and a function, `run`, which returns it." },
    ] },
    { role: "user", text: "Run the tests." },
    { role: "assistant", content: [
      { type: "tool_use", id: "debug-bash", name: "bash", input: { command: "npm test" } },
      { type: "tool_result", tool_use_id: "debug-bash", content: [{ type: "text", text: "1 failing\n  example › run returns false" }], is_error: true },
      { type: "text", text: "One test fails: it expects `run()` to return `false`." },
    ] },
  ],
  long: Array.from({ length: 24 }, (_, index): Line => index % 2 === 0
    ? { role: "user", text: [`Question ${index / 2 + 1}`, "Can you check this as well?", "A longer question that wraps onto a second line so the bubble grows with its text."][index % 3] }
    : { role: "assistant", text: [`Answer ${Math.ceil(index / 2)}. Done.`, "Here is a paragraph long enough to wrap across several lines, so the reading width and line height show clearly in the snapshot.", "- First point\n- Second point\n- Third point"][index % 3] }),
  media: [
    { role: "user", content: [{ type: "text", text: "Two references for the header." }, PNG("iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAFUlEQVR4nGN4UWFDEmIY1TCqATsCAHYZNRC672UqAAAAAElFTkSuQmCC"), PNG("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAQCAIAAACtAwlQAAAAFUlEQVR4nGOwqThBEDGMKhpVRJwiADSXHRBuHmapAAAAAElFTkSuQmCC")] },
    { role: "assistant", content: [{ type: "text", text: "Both are in. The wide one sets the header's height; the tall one crops to it." }, PNG("iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAFUlEQVR4nGN4UWFDEmIY1TCqATsCAHYZNRC672UqAAAAAElFTkSuQmCC")] },
  ],
  stream: [
    { role: "user", text: "Summarize the open issues." },
  ],
  states: [
    { role: "user", text: "A message that sent normally." },
    { role: "assistant", text: "A normal reply." },
    { role: "user", text: "A message that failed to send.", error: "The message could not be sent. Check your connection." },
  ],
};

function conversation(fixture: Fixture): MessageRecord[] {
  const start = Date.parse("2026-09-11T09:00:00Z");
  return SCRIPTS[fixture].map((line, index) => {
    const turn = Math.floor(index / 2) + 1;
    const content = line.content ?? [{ type: "text", text: line.text ?? "" }];
    return {
      id: `debug-${fixture}-${index}`, sessionId: `debug-${fixture}`, role: line.role,
      content, text: line.text ?? null,
      sequence: index + 1, provider: line.role === "assistant" ? "cohub" : null,
      model: line.role === "assistant" ? "claude-sonnet" : null,
      stopReason: "stop", errorMessage: line.error ?? null,
      usage: line.role === "assistant" ? { input: 1200, output: 240, cacheRead: 300, cacheWrite: 0, totalTokens: 1740 } : null,
      meta: { turnId: `debug-${fixture}-turn-${turn}`, turnSequence: turn }, authorUuid: null, authorProfile: null,
      startedAt: null, completedAt: null, durationMs: 4200,
      createdAt: new Date(start + index * 60_000).toISOString(),
    } as MessageRecord;
  });
}
