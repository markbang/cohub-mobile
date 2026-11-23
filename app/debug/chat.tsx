import type { ContentBlock, MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { BotExchangeRow, BotNoteBubble, BotTimeDivider, BotTyping } from "@/src/components/BotBubbles";
import { BotTitle } from "@/src/components/BotTitle";
import { JumpToLatest } from "@/src/components/JumpToLatest";
import { MessageBubble, StreamCard } from "@/src/components/MessageContent";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { UnreadDivider } from "@/src/components/UnreadDivider";
import { NativeChatTimeline, type NativeChatTimelineHandle } from "@/src/components/timeline/NativeChatTimeline";
import { BOT_BUBBLE_INSET, botExchange, botNoteSpace, botPlacements, botVoice, type BotPeer } from "@/src/data/bot-mode";
import { isDeliveredMessage, readThrough, unreadAssistantTurnCount, unreadStart } from "@/src/data/chat-read-state";
import { turnSequenceForMessage } from "@/src/data/session-history";
import { motion } from "@/src/motion";
import { ChatTimelineView, nativeChatTimeline } from "@/src/platform/chat-timeline";
import { ComposerInput, IconButton, Screen, TopBar } from "@/src/ui";
import { EdgeBlurTarget, EdgeFooter, EdgeHeader, useEdgeChrome, useKeyboardCoveredInset } from "@/src/ui/EdgeChrome";
import { usePaneWidth } from "@/src/ui/pane";

/**
 * The Chat screen's own chrome and native timeline over fixed conversations, so its layout can be
 * captured on both platforms without an account's data. `?fixture=` picks the conversation; `bot` is a Bot's page.
 * `?arrive=<n>` appends n replies two seconds after opening, as a reply that lands while the user reads up.
 */
const FIXTURES = ["conversation", "tools", "long", "states", "media", "stream", "bot"] as const;
type Fixture = (typeof FIXTURES)[number];

const NO_TURNS: ReadonlyMap<string, SessionTurnRecord> = new Map();
const NO_TURN_SEQUENCES: ReadonlyMap<number, SessionTurnRecord[]> = new Map();
const NOOP = () => undefined;

export default function DebugChatScreen() {
  const params = useLocalSearchParams<{ fixture?: string; native?: string; probe?: string; arrive?: string; draft?: string; unread?: string; tail?: string }>();
  // A new link is a new snapshot: its state starts over, as a fresh launch would, rather than carrying the last link's scroll and read state.
  return <DebugChatView key={[params.fixture, params.native, params.probe, params.arrive, params.draft, params.unread, params.tail].join("|")} />;
}

function DebugChatView() {
  const router = useRouter();
  // `?native=1` draws the native timeline where the Chat screen does not (iOS), to debug it;
  // `?native=0` draws the JS list that binaries without the native timeline fall back to.
  const params = useLocalSearchParams<{ fixture?: string; native?: string; probe?: string; arrive?: string; draft?: string; unread?: string; tail?: string }>();
  const useNative = params.native !== "0" && (nativeChatTimeline || (ChatTimelineView !== null && params.native === "1"));
  const fixture: Fixture = FIXTURES.includes(params.fixture as Fixture) ? params.fixture as Fixture : "conversation";
  // `?tail=user`: the Chat ends on a prompt with no reply yet, as a message just sent looks.
  const baseMessages = useMemo(() => {
    const all = conversation(fixture);
    return params.tail === "user" && all.at(-1)?.role === "assistant" ? all.slice(0, -1) : all;
  }, [fixture, params.tail]);
  const arriveCount = Number(params.arrive) > 0 ? Math.floor(Number(params.arrive)) : 0;
  const arrivalKey = `${fixture}:${arriveCount}`;
  const [arrival, setArrival] = useState<{ key: string; messages: MessageRecord[] } | null>(null);
  useEffect(() => {
    if (arriveCount === 0) return;
    const timer = setTimeout(() => setArrival({ key: arrivalKey, messages: arrivals(baseMessages, arriveCount) }), 2000);
    return () => clearTimeout(timer);
  }, [arrivalKey, arriveCount, baseMessages]);
  const messages = useMemo(() => [...baseMessages, ...(arrival?.key === arrivalKey ? arrival.messages : [])], [arrival, arrivalKey, baseMessages]);
  const [following, setFollowing] = useState(true);
  // The fixture's replies count as read; `arrive` replies land after them.
  const seenSequence = useMemo(() => baseMessages.reduce((latest, message) => message.role === "assistant" ? Math.max(latest, Number(message.meta?.turnSequence ?? 0)) : latest, 0), [baseMessages]);
  // `?unread=N`: the Nth message's Turn is the first the device has not read; the read sequence is seeded just
  // before it, then advances as the screen's own rules do (after the first drag, by the rows in view).
  const seededRead = useMemo(() => {
    const message = baseMessages[Number.parseInt(params.unread ?? "", 10) - 1];
    return message ? (turnSequenceForMessage(message) ?? 1) - 1 : null;
  }, [baseMessages, params.unread]);
  const [readSequence, setReadSequence] = useState<number | null>(seededRead);
  const [dragged, setDragged] = useState(false);
  const unread = useMemo(() => unreadStart(messages, seededRead), [messages, seededRead]);
  const unreadMessageId = unread && readSequence !== null && readSequence < unread.turnSequence ? unread.messageId : null;
  const bot = fixture === "bot" ? BOT : null;
  const botTurns = useMemo(() => bot ? botSayTurns(messages) : NO_TURNS, [bot, messages]);
  // As the Chat screen: the newest own message the server accepted, which a Bot's note never is.
  const deliveredId = useMemo(() => { const last = messages.at(-1); return last && isDeliveredMessage(last) && botNoteSpace(botTurns.get(String(last.meta?.turnId))) === null ? last.id : undefined; }, [botTurns, messages]);
  // As the Chat screen: a reply is the page's Bot, a note is whoever wrote it.
  const exchangeOf = (message: MessageRecord) => { const writer = botNoteSpace(botTurns.get(String(message.meta?.turnId))); return writer ? botExchange(message, writer, BOT_SPACE_ID) : null; };
  const placements = botPlacements(messages, (message) => message.role !== "user" ? BOT_SPACE_ID : botVoice(exchangeOf(message), botNoteSpace(botTurns.get(String(message.meta?.turnId)))));
  const { headerHeight, footerHeight, onHeaderLayout, onFooterLayout, blurTarget, attachBlurTarget } = useEdgeChrome({ reserveComposer: true });
  const keyboardCoveredInset = useKeyboardCoveredInset();
  const reducedMotion = useReducedMotion();
  // `?draft=` seeds the composer as a Chat's saved draft does; typing replaces it.
  const [typed, setDraft] = useState<string | null>(null);
  const draft = typed ?? params.draft ?? "";
  const width = usePaneWidth();
  // With `?probe=1`, printed under the bar so a snapshot shows whether rows were laid out (frame) even when none
  // is painted. Otherwise it stays an accessibility label only, which captures can wait on without the text
  // covering the timeline.
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

  return <Screen edgeToEdge blurTarget={blurTarget}>
    <EdgeHeader onLayout={onHeaderLayout} blurBar>
      {bot ? <TopBar transparent title={bot.name} onBack={() => router.back()} actions={<IconButton name="list-tree" label="Work log" size={38} onPress={NOOP} />}>
        <BotTitle name={bot.name} avatarUrl={null} onPress={NOOP} />
      </TopBar> : <TopBar transparent title="Fix the Android sheet height" subtitle="Home" onBack={() => router.back()} actions={<>
        <IconButton name="list-tree" label="Turns" size={38} onPress={NOOP} />
        <IconButton name="more" label="More" size={38} onPress={NOOP} />
      </>} />}
      {arriveCount > 0 ? <View testID="debug-chat-arrivals" accessible accessibilityLabel={`arrivals ${arrival?.key === arrivalKey ? arrival.messages.length : 0}`} pointerEvents="none" style={ARRIVALS_LABEL} /> : null}
      {params.probe === "1"
        ? <Text testID="debug-chat-probe" className="px-4 text-micro text-fg-muted">{probe}</Text>
        : <View testID="debug-chat-probe" accessible accessibilityLabel={probe} pointerEvents="none" style={PROBE_LABEL} />}
    </EdgeHeader>
    <View className="flex-1 min-h-0 bg-background">
    <EdgeBlurTarget attach={attachBlurTarget}>
      {useNative ? <NativeChatTimeline
        key={fixture}
        ref={timelineRef}
        sessionId={`debug-${fixture}`}
        spaceId={bot ? BOT_SPACE_ID : ""}
        client={null}
        bot={bot}
        botPeers={BOT_PEERS}
        messages={messages}
        unreadMessageId={unreadMessageId}
        initialMessageId={unread && !unread.atEnd ? unread.messageId : null}
        onDragBegin={() => setDragged(true)}
        onVisibleMessages={(visible) => {
          if (unread && !dragged) return;
          setReadSequence((current) => readThrough(current, visible.map((item) => item.message)));
        }}
        turnsById={botTurns}
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
        speechEnabled={false}
        onSpeak={NOOP}
        onLoadOlder={NOOP}
        onLoadNewer={NOOP}
        onFollowingChange={setFollowing}
        onNearEdge={NOOP}
        onLoad={NOOP}
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
        renderItem={({ item, index }) => { const writer = botNoteSpace(botTurns.get(String(item.meta?.turnId))); const exchange = exchangeOf(item); return bot
          // The Chat screen's Bot rows: the time above, the gap where the side changes, then the bubble.
          ? <View style={placements[index]?.gap ? { paddingTop: placements[index].gap } : undefined}>
            {item.id === unreadMessageId ? <UnreadDivider /> : null}
            {placements[index]?.time ? <BotTimeDivider at={placements[index].time} /> : null}
            {exchange ? <BotExchangeRow exchange={exchange} bot={bot} peer={BOT_PEERS.get(exchange.peer) ?? null} spaceId={null} availableWidth={width} onOpenBot={NOOP} /> : writer ? <BotNoteBubble message={item} spaceId={null} availableWidth={width} /> : <MessageBubble message={item} availableWidth={width} rowInset={BOT_BUBBLE_INSET} />}
          </View>
          : <>{item.id === unreadMessageId ? <UnreadDivider /> : null}<MessageBubble message={item} availableWidth={width} delivered={item.id === deliveredId} /></>; }}
        contentContainerStyle={{ paddingTop: headerHeight + 12, paddingBottom: footerHeight + 12 }}
        // A reply still being written; the native timeline reads live replies from a Chat's stream, which a fixture has none of.
        ListFooterComponent={fixture === "stream" ? <StreamCard content={STREAM_REPLY} status="streaming" availableWidth={width} /> : null}
      />}
    </EdgeBlurTarget>
    </View>
    <EdgeFooter keyboard onLayout={onFooterLayout}>
      {following ? null : <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fadeOut.duration)} className="absolute right-4 z-4" style={ABOVE_FOOTER_BUTTON}><JumpToLatest busy={false} unread={unreadAssistantTurnCount(messages, seenSequence)} onPress={NOOP} /></Animated.View>}
      {bot ? <BotTyping bot={bot} /> : null}
      <ComposerInput value={draft} onChangeText={setDraft} onSend={() => setDraft("")} onAttach={NOOP} modelLabel="Claude Sonnet" modelDetail="High" modelStatus="available" onVoice={NOOP} {...(bot ? { variant: "bot" as const, placeholder: `Message ${bot.name}` } : {})} />
    </EdgeFooter>
  </Screen>;
}

// Full width: Android's accessibility dump leaves out a view too small to see.
const PROBE_LABEL = { position: "absolute", left: 0, right: 0, bottom: 0, height: 8 } as const;
const ARRIVALS_LABEL = { position: "absolute", left: 0, right: 0, top: 0, height: 8 } as const;
const ABOVE_FOOTER_BUTTON = { bottom: "100%", marginBottom: 12 } as const;

type Line = { role: "user" | "assistant"; text?: string; content?: ContentBlock[]; error?: string; /** A user message the server did not accept: its meta carries `sendFailed`, as a failed send's does. */ failed?: boolean; /** On a Bot's page: which Bot wrote the note (none for the user's), at minutes from today 08:00. */ bot?: "self" | "peer" | "stranger"; at?: number };

const BOT: BotPeer = { name: "Chief of staff", avatarUrl: null };
// The origin the server records on a `say` note; it is read only when its ids are UUIDs.
const BOT_SAY_ORIGIN = { kind: "prompt", depth: 1, turnId: "e130c767-6785-4f62-9ff8-1ffecbd10b96", spaceId: "0aec405e-90c4-4a99-840c-d890a67f60f5", sessionId: "79e168c0-c2e4-4815-abf0-65c41a1074bc", toolCallId: "4f3eb83c-ff0f-4bf0-8f3e-bb7e4907d8c7" };
const BOT_SPACE_ID = BOT_SAY_ORIGIN.spaceId;
// Another Bot the app has loaded, and one it has not.
const BOT_WRITERS = { self: BOT_SPACE_ID, peer: "5b0c2d4e-6f70-4a81-9b92-a3b4c5d6e7f8", stranger: "7c1d3e5f-8091-4b2c-8d3e-4f5061728394" } as const;
const BOT_PEERS: ReadonlyMap<string, BotPeer> = new Map([[BOT_WRITERS.peer, { name: "Cohub", avatarUrl: null }]]);

/** The `say` Turn behind each of the Bot's lines, so both timelines put them on its side. */
function botSayTurns(messages: readonly MessageRecord[]): ReadonlyMap<string, SessionTurnRecord> {
  return new Map(messages.filter((message) => typeof message.meta?.writer === "string").map((message) => {
    const id = String(message.meta?.turnId);
    return [id, { id, sequence: message.sequence, executionKind: "note", status: "completed", meta: { origin: { ...BOT_SAY_ORIGIN, spaceId: message.meta?.writer } } } as unknown as SessionTurnRecord];
  }));
}

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
  bot: [
    { role: "user", text: "Remind me about the board deck tomorrow.", at: -11 * 60 },
    { role: "user", text: "Hey, what needs my attention today?", at: -2 },
    { role: "user", text: "GM! Can I get your approval for the board deck review at 2pm?", bot: "self", at: 0 },
    { role: "user", text: "Updated the numbers based on today's pull from Salesforce, Mercury, QuickBooks, and Hex.", bot: "self", at: 0 },
    { role: "user", text: "Can you add a slide for headcount and pull from Rippling", at: 3 },
    { role: "user", content: [{ type: "text", text: "Pulled and added" }, PNG("iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAFUlEQVR4nGN4UWFDEmIY1TCqATsCAHYZNRC672UqAAAAAElFTkSuQmCC")], bot: "self", at: 6 },
    // Messages between Bots: a request from a Bot the app has loaded, this Bot's report back to it, and one from a Bot it has not.
    { role: "user", text: "Can you check the headcount slide against Rippling before the 2pm review? Last month's export counted two contractors twice, and the board deck needs the current numbers.", bot: "peer", at: 7 },
    { role: "user", text: `@[Cohub](cohub://spaces/${BOT_WRITERS.peer}) The headcount slide matches Rippling: 48 full-time and 6 contractors. Both duplicates from last month are gone.\n\n- Checked against today's Rippling export\n- Slide 7 updated`, bot: "self", at: 8 },
    { role: "user", text: "The offsite receipts are coded.", bot: "stranger", at: 9 },
    { role: "user", text: "Looks good, send it to the team", at: 40 },
    { role: "user", text: "Sent. Overnight there were 41 new emails: 6 needed you and are in your inbox, 3 invoices went to Expense Manager, 2 intros are connected, and 1 bug report went to Bug Triager. Nothing else is waiting on you before the review.", bot: "self", at: 41 },
  ],
  states: [
    { role: "user", text: "A message that sent normally." },
    { role: "assistant", text: "A normal reply." },
    { role: "user", text: "A message that failed to send.", error: "The message could not be sent. Check your connection.", failed: true },
  ],
};

function conversation(fixture: Fixture): MessageRecord[] {
  const start = Date.parse("2026-09-11T09:00:00Z");
  const today = new Date();
  today.setHours(8, 0, 0, 0);
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
      meta: { ...(line.at === undefined ? { turnId: `debug-${fixture}-turn-${turn}`, turnSequence: turn } : { turnId: `debug-${fixture}-turn-${index + 1}`, turnSequence: index + 1, ...(line.bot ? { writer: BOT_WRITERS[line.bot] } : {}) }), ...(line.failed ? { sendFailed: true } : {}) }, authorUuid: null, authorProfile: null,
      startedAt: null, completedAt: null, durationMs: 4200,
      createdAt: new Date(line.at === undefined ? start + index * 60_000 : today.getTime() + line.at * 60_000).toISOString(),
    } as MessageRecord;
  });
}

/** Replies that arrive after the Chat opened: the turns after the fixture's last one, all from the assistant. */
function arrivals(base: readonly MessageRecord[], count: number): MessageRecord[] {
  const lastSequence = base.reduce((latest, message) => Math.max(latest, message.sequence), 0);
  const lastTurn = base.reduce((latest, message) => Math.max(latest, Number(message.meta?.turnSequence ?? 0)), 0);
  const sessionId = base[0]?.sessionId ?? "debug";
  return Array.from({ length: count }, (_, index) => {
    const turn = lastTurn + index + 1;
    const text = `New arrival ${index + 1}. Ready when you are.`;
    return {
      id: `debug-arrival-${turn}`, sessionId, role: "assistant", content: [{ type: "text", text }], text,
      sequence: lastSequence + index + 1, provider: "cohub", model: "claude-sonnet", stopReason: "stop", errorMessage: null,
      usage: null, meta: { turnId: `debug-arrival-turn-${turn}`, turnSequence: turn }, authorUuid: null, authorProfile: null,
      startedAt: null, completedAt: null, durationMs: 4200, createdAt: new Date().toISOString(),
    } as MessageRecord;
  });
}
