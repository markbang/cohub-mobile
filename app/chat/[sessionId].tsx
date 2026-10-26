import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useNavigation, useNavigationContainerRef, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Dimensions, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent, type ViewToken } from "react-native";
import Animated, { cubicBezier, useAnimatedRef, useReducedMotion } from "react-native-reanimated";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { AnchoredActionMenu, type AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import { NativeMenuButton, nativeMenus } from "@/src/components/NativeMenu";
import { NoticeSheet } from "@/src/components/SystemDialogs";
import { useToast } from "@/src/components/Toast";
import { copyMessageText, MessageBubble, StreamCard } from "@/src/components/MessageContent";
import { SendBubbleOverlay } from "@/src/components/SendBubbleOverlay";
import { QueuedFollowupRow } from "@/src/components/QueuedFollowupRow";
import { isSendBubbleMessage, measureSendBubbleSource, type SendBubbleTransition } from "@/src/ui/send-bubble-motion";
import { StreamingTurnProcess, TurnProcess } from "@/src/components/TurnProcess";
import { ForkedFromDivider, SentFromLink, SentToList } from "@/src/components/RelatedSessionLinks";
import { forkPoint } from "@/src/data/session-fork";
import type { RelatedSessionRef } from "@/src/data/related-sessions";
import { ModelSelectorMenu } from "@/src/components/ModelSelectorMenu";
import { HarnessPicker, harnessMenuSections } from "@/src/components/ExecutionHarnessMenu";
import { AttachmentMenu } from "@/src/components/AttachmentMenu";
import { SpaceMentionMenu } from "@/src/components/SpaceMentionMenu";
import { SlashCommandMenu } from "@/src/components/SlashCommandMenu";
import { SessionLabelSheet } from "@/src/components/SessionLabelSheet";
import { fetchSessionLabels, toUserSessionLabels, type SessionLabel } from "@/src/data/session-labels";
import { TurnNavigatorSheet } from "@/src/components/TurnNavigatorSheet";
import { SpacePanels, type SpacePanel } from "@/src/components/SpacePanels";
import { useApp, useSession } from "@/src/data/context";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useComposerMentions } from "@/src/data/use-composer-mentions";
import { useComposerSlashCommands } from "@/src/data/use-composer-slash";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { CHAT_FOLLOW_TAIL_MAINTAIN_THRESHOLD, CHAT_PAGE_THRESHOLD, chatFollowPinAnimated, chatListDistances, chatListViewOffset, chatMaintainScrollAtEnd, chatTailDisplaced, chatTailScrolledAway, chatTailStalled, nextChatTailFollowing } from "@/src/data/chat-scroll";
import { chatScrollTrace, type TraceFields } from "@/src/data/chat-scroll-trace";
import { debugAlias, record as recordDebugEvent } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { useChatScrollTrace, useTraceTouches } from "@/src/components/use-chat-scroll-trace";
import { useChatVisibleRows } from "@/src/components/use-chat-visible-rows";
import { isCatchUpArrival, useChatCatchUp } from "@/src/components/use-chat-catch-up";
import { markChatEntry } from "@/src/data/chat-entry-trace";
import { cancelQueuedFollowup, followupQueueItems, isOptimisticFollowup, isSendQueueItem, queuedFollowupTurns, steerQueuedFollowup } from "@/src/data/followup-queue";
import { isActiveTurnStatus, isLiveStreamStatus, isTerminalTurnStatus, shouldShowLiveStream } from "@/src/data/chat-stream";
import { liveReplyAnchor, MessageMeasurements, rowHeightMeasurement, thinkingBlocks } from "@/src/data/chat-rendering";
import type { AttachmentDraft, ChatModelSelection } from "@/src/data/types";
import { canUseRuntimeHarness, localModelsForHarness, runtimeHarnessFromTurn, type RuntimeHarness, type SpaceRuntimeStatus } from "@/src/data/runtime";
import { useSpaceRuntime } from "@/src/data/use-space-runtime";
import { harnessLabel, type CohubClient, type LocalHarness, type MessageRecord, type ModelCatalogEntry, type SessionRecord, type SessionTurnRecord } from "@neta-art/cohub";
import { chatThreadPlaceholder, mergeDisplayMessages, messageIndexForTurn, messageRowKey, messagesFromTurns, messagesInWindow, turnSequenceForMessage, withTurnSequences } from "@/src/data/session-history";
import { useAppTheme, typography } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { formatThinkingLevel, modelAvailabilityLevel, requestedThinkingLevel } from "@/src/model-catalog";
import { useNativeVoiceInput } from "@/src/platform/native-voice-input";
import { GlassBackground } from "@/src/ui/Glass";
import { AppIcon, AttachmentChip, ComposerInput, ConnectionBanner, FIELD_INPUT_CLASS, TopBar, IconButton, ListEdgeLoader, Loader, LoadingState, listRefreshProps, PrimaryButton, Screen, type ComposerInputMeasurement, type IconName } from "@/src/ui";
import { displaySessionTitle, displaySpaceName, hasRenderableMessage, isAssistantIntermediate } from "@/src/utils";
import { EdgeFooter, EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";

type RouteParams = { sessionId?: string | string[]; spaceId?: string | string[]; turn?: string | string[]; turnId?: string | string[] };
type CreatedChat = { sessionId: string; transition: SendBubbleTransition | null };
const NEW_COMPOSER_DRAFT_SCOPE = { kind: "new" } as const;
const messageViewabilityConfig = { itemVisiblePercentThreshold: 20 };
/** Only used to estimate the destination of a jump the list cannot resolve on its own. */
const FALLBACK_ROW_HEIGHT = 140;
const OPEN_SETTLE_MS = 300;
/** Cached Chats paint within this; a placeholder before it is only a flash. */
const OPENING_PLACEHOLDER_DELAY_MS = 300;
// Rows a catch-up adds settle in from just below; the strong ease-out lands them without a tail.
const ARRIVAL_STYLE = {
  animationName: { from: { opacity: 0, transform: [{ translateY: 8 }] }, to: { opacity: 1, transform: [{ translateY: 0 }] } },
  animationDuration: 260,
  animationTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
} as const;
const ARRIVAL_STYLE_REDUCED = { animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: 200 } as const;
const TURN_START_STYLE = { paddingTop: 8 } as const;

// Decided once per mount: removing the CSS animation mid-fade leaves the row at its partial opacity.
function ArrivalRow({ arrival, reducedMotion, children }: { arrival: boolean; reducedMotion: boolean; children: ReactNode }) {
  const [animated] = useState(arrival);
  return <Animated.View style={animated ? (reducedMotion ? ARRIVAL_STYLE_REDUCED : ARRIVAL_STYLE) : undefined}>{children}</Animated.View>;
}

const RENAME_MAX_LENGTH = 80;

// Row height depends on rendered text/blocks, not on the metadata JSON stringify would also
// walk. A transcript-wide JSON.stringify on every turn patch dominated list re-renders.
function measurementRevision(message: MessageRecord, previousTurnSequence: number | null) {
  let blockSignature = "";
  for (const block of message.content ?? []) {
    if (block.type === "text") blockSignature += `t${block.text.length};`;
    else if (block.type === "thinking") blockSignature += `k${block.thinking.length};`;
    else blockSignature += `${block.type};`;
  }
  const usage = message.usage;
  return [
    message.id,
    turnSequenceForMessage(message) ?? -1,
    previousTurnSequence ?? -1,
    message.role,
    message.text?.length ?? 0,
    message.errorMessage?.length ?? 0,
    blockSignature,
    message.model ?? "",
    usage?.input ?? 0,
    usage?.cacheRead ?? 0,
    usage?.output ?? 0,
  ].join(":");
}

type ChatScrollEvent = {
  nativeEvent: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { height: number };
    velocity?: { y?: number };
  };
};

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<RouteParams>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const spaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  const rawTurn = Array.isArray(params.turn) ? params.turn[0] : params.turn;
  const rawTurnId = Array.isArray(params.turnId) ? params.turnId[0] : params.turnId;
  const parsedTurn = rawTurn ? Number(rawTurn) : NaN;
  const initialTurnSequence = Number.isSafeInteger(parsedTurn) && parsedTurn > 0 ? parsedTurn : null;
  const initialTurnId = rawTurnId?.trim() || null;
  const [createdChat, setCreatedChat] = useState<CreatedChat | null>(null);
  if (!sessionId) return <MissingChat />;
  if (sessionId === "new") {
    return spaceId
      ? <DraftChatContent
          spaceId={spaceId}
          onCreated={({ session, transition }) => {
            setCreatedChat({ sessionId: session.id, transition });
            // Update the deep-linkable identity without pushing a new screen or replaying
            // the native stack transition. The current surface continues in place.
            router.setParams({ sessionId: session.id });
          }}
        />
      : <MissingChat />;
  }
  return <ChatContent key={sessionId} sessionId={sessionId} initialTurnSequence={initialTurnSequence} initialTurnId={initialTurnId} initialSendTransition={createdChat?.sessionId === sessionId ? createdChat.transition : null} />;
}

// iOS swipe-back is silently cancelled when the SpacePanels pager wins the horizontal drag; the
// cancelled interactive pop can then desync the JS stack, so later back presses dispatch
// GO_BACK against an already-popped root (silently unhandled in production). Keep a before/after
// breadcrumb so the diagnostics distinguish a cancelled touch from a navigation action that did
// not change the root state.
function backNavigationState(root: ReturnType<typeof useNavigationContainerRef>) {
  if (!root.isReady()) return { rootReady: false, canGoBack: null, rootIndex: null, topRouteName: null, chatStackDepth: null, chatStackIndex: null };
  const state = root.getState();
  const stack = state?.routes.at(-1)?.state;
  return {
    rootReady: true,
    canGoBack: root.canGoBack(),
    rootIndex: state?.index ?? null,
    topRouteName: state?.routes.at(-1)?.name ?? null,
    chatStackDepth: stack?.type === "stack" ? stack.routes.length : null,
    chatStackIndex: stack?.type === "stack" ? stack.index : null,
  };
}

function useBackPressTrace(source: string, root: ReturnType<typeof useNavigationContainerRef>) {
  return useCallback(() => {
    recordDebugEvent("chat.back.pressed", { source, ...backNavigationState(root) });
    requestAnimationFrame(() => {
      recordDebugEvent("chat.back.state_after", { source, phase: "frame", ...backNavigationState(root) });
      setTimeout(() => recordDebugEvent("chat.back.state_after", { source, phase: "settled", ...backNavigationState(root) }), 400);
    });
  }, [root, source]);
}

function ChatContent({ sessionId, initialTurnSequence, initialTurnId, initialSendTransition }: { sessionId: string; initialTurnSequence: number | null; initialTurnId: string | null; initialSendTransition?: SendBubbleTransition | null }) {
  const router = useRouter();
  const rootNavigation = useNavigationContainerRef();
  const traceBackPress = useBackPressTrace("chat", rootNavigation);
  const theme = useAppTheme();
  const { t } = useTranslation();
  const showToast = useToast();
  const { state, client, connectionUnavailable, refreshHome, sendMessage, abortSession, refreshSession, loadOlderTurns, loadNewerTurns, loadTurnIndex, jumpToTurn, loadLatestTurns, renameSession, forkSession, getAccessToken, loadModels, loadModelStatus, models, modelsLoading, modelsError, modelStatus, modelStatusLoading, modelStatusError, loadSessionReadSequence, saveSessionReadSequence, loadComposerDraft, saveComposerDraft, clearComposerDraft } = useApp();
  const view = useSession(sessionId);
  const session = view.session ?? state.sessions.find((item) => item.id === sessionId) ?? null;
  const sessionSummary = state.sessions.find((item) => item.id === sessionId) ?? null;
  const spaceId = view.space?.id ?? session?.spaceId ?? sessionSummary?.spaceId ?? "";
  const runtime = useSpaceRuntime(spaceId);
  useSyncScope(`chat:${sessionId}:tail`, () => refreshSession(sessionId, { silent: true, throwOnError: true }), 60_000, view.historyLoaded && !view.hasMoreNewer && !view.stream);
  const { headerHeight, footerHeight, onHeaderLayout, onFooterLayout } = useEdgeChrome({ reserveComposer: true });
  const composerRef = useRef<View>(null);
  const [sendTransition, setSendTransition] = useState<SendBubbleTransition | null>(() => initialSendTransition ?? null);
  const composerMeasurementRef = useRef<ComposerInputMeasurement>({ input: null, scrollY: 0 });
  const sendRootRef = useAnimatedRef<View>();
  const sendBubbleRef = useAnimatedRef<View>();
  const sendQueueRef = useAnimatedRef<View>();
  const attachmentSourceRef = useRef<View>(null);
  const attachmentScrollYRef = useRef(0);
  const queueScrollRef = useRef<ScrollView>(null);
  const submitLockRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();
  const completeSendTransition = useCallback((id: string) => {
    setSendTransition((current) => current?.message.id === id ? null : current);
  }, []);
  useFocusEffect(useCallback(() => () => {
    sendGenerationRef.current += 1;
    setSendTransition(null);
  }, []));
  useFocusEffect(useCallback(() => {
    recordDebugEvent("chat.screen.focus", { session: debugAlias("session", sessionId) });
    return () => recordDebugEvent("chat.screen.blur", { session: debugAlias("session", sessionId) });
  }, [sessionId]));
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", () => {
      sendGenerationRef.current += 1;
      setSendTransition(null);
    });
    return () => subscription.remove();
  }, []);
  const [input, setInput] = useState("");
  const inputRef = useRef("");
  const inputEditedRef = useRef(false);
  const draftLoadedRef = useRef(false);
  const draftScope = useMemo(() => ({ kind: "session" as const, sessionId }), [sessionId]);
  const updateInput = useCallback((next: string) => {
    inputEditedRef.current = true;
    inputRef.current = next;
    setInput(next);
  }, []);
  const mentions = useComposerMentions({ value: input, onChange: updateInput, currentSpaceId: spaceId || null, composer: composerMeasurementRef });
  const slash = useComposerSlashCommands({ value: input, onChange: updateInput, spaceId: spaceId || null, composer: composerMeasurementRef });
  const { onFocusChange: onMentionsFocusChange } = mentions;
  const { onFocusChange: onSlashFocusChange } = slash;
  // The hooks' focus setters are stable, so this handler is too.
  const handleComposerFocus = useCallback((focused: boolean) => {
    onMentionsFocusChange(focused);
    onSlashFocusChange(focused);
  }, [onMentionsFocusChange, onSlashFocusChange]);
  const [sendFeedback, setSendFeedback] = useState<"idle" | "success">("idle");
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  useEffect(() => { if (attachments.length === 0) attachmentScrollYRef.current = 0; }, [attachments.length]);
  useEffect(() => {
    let active = true;
    inputEditedRef.current = false;
    draftLoadedRef.current = false;
    inputRef.current = "";
    void loadComposerDraft(spaceId, draftScope)
      .then((draft) => {
        if (!active) return;
        draftLoadedRef.current = true;
        if (inputEditedRef.current) {
          void saveComposerDraft(spaceId, draftScope, inputRef.current).catch(() => undefined);
          return;
        }
        inputRef.current = draft;
        setInput(draft);
      })
      .catch(() => {
        if (active) draftLoadedRef.current = true;
      });
    return () => { active = false; };
  }, [draftScope, loadComposerDraft, saveComposerDraft, spaceId]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timer = setTimeout(() => {
      void saveComposerDraft(spaceId, draftScope, input).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [draftScope, input, saveComposerDraft, spaceId]);
  useEffect(() => () => {
    if (draftLoadedRef.current) void saveComposerDraft(spaceId, draftScope, inputRef.current).catch(() => undefined);
  }, [draftScope, saveComposerDraft, spaceId]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const moreButtonRef = useRef<View>(null);
  const titleRef = useRef<View>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeTitleMenu = useCallback(() => setTitleMenuOpen(false), []);
  const [labelSheetOpen, setLabelSheetOpen] = useState(false);
  const [chatLabels, setChatLabels] = useState<SessionLabel[]>([]);
  const [renameValue, setRenameValue] = useState("");
  const [stopping, setStopping] = useState(false);
  const [pendingFollowupAction, setPendingFollowupAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false);
  const [selectedHarness, setSelectedHarness] = useState<RuntimeHarness | null>(null);
  const [localModelsByHarness, setLocalModelsByHarness] = useState<Partial<Record<LocalHarness, ChatModelSelection | null>>>({});
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection | null>(null);
  const [modelOverride, setModelOverride] = useState(false);
  const [activePanel, setActivePanel] = useState<SpacePanel | null>(null);
  const [forkingTurnId, setForkingTurnId] = useState<string | null>(null);
  const [turnNavigatorOpen, setTurnNavigatorOpen] = useState(false);
  const [loadingSequence, setLoadingSequence] = useState<number | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  // Tail pins snap until opening has settled; animating them was the visible chase to the tail.
  const [openSettled, setOpenSettled] = useState(false);
  const [openingDelayElapsed, setOpeningDelayElapsed] = useState(false);
  // The newest page replacing the loaded turns mounts a fresh list that places itself like an open.
  const [mountGeneration] = useState(view.windowGeneration);
  const [listGeneration, setListGeneration] = useState(view.windowGeneration);
  if (listGeneration !== view.windowGeneration) {
    setListGeneration(view.windowGeneration);
    setListLoaded(false);
    setOpenSettled(false);
    setOpeningDelayElapsed(false);
  }
  const listPlacedRef = useRef(false);
  const [jumpingToLatest, setJumpingToLatest] = useState(false);
  // Entry timeline for the opt-in diagnostics: markChatEntry is a no-op unless enabled.
  const entryRendersRef = useRef(0);
  const entryHistoryLoadedRef = useRef(false);
  const entryStatsRef = useRef({ messages: 0, turns: 0, hasStream: false, historyLoaded: false });
  const [currentTurnSequence, setCurrentTurnSequence] = useState<number | null>(null);
  const pendingScrollSequence = useRef<number | null>(null);
  const handledDeepLinkTarget = useRef<string | null>(null);
  const listRef = useRef<LegendListRef>(null);
  const listContainerRef = useRef<View>(null);
  const initialScrollDone = useRef(false);
  const initialUnreadIndexRef = useRef<number | null>(null);
  const initialUnreadRetriesRef = useRef(0);
  const readStateLoadedRef = useRef(false);
  const readSequenceRef = useRef<number | null>(null);
  const savedReadSequenceRef = useRef<number | null>(null);
  const followingTailRef = useRef(true);
  const [followingTail, setFollowingTailState] = useState(true);
  const followPinAnimatedRef = useRef(true);
  const [followPinAnimated, setFollowPinAnimatedState] = useState(true);
  const userDraggingRef = useRef(false);
  const momentumScrollingRef = useRef(false);
  const followTailFrameRef = useRef<number | null>(null);
  const turnScrollTargetRef = useRef<number | null>(null);
  const turnScrollRetriesRef = useRef(new Map<number, number>());
  const turnScrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollRef = useRef({ y: 0, height: 0, viewport: 0 });
  const alwaysScrollLogRef = useRef({ at: 0, y: 0 });
  const traceRequestId = useRef(0);
  const traceCancelGeneration = useRef(0);
  const traceState = useCallback((): TraceFields => ({
    session: chatScrollTrace.alias("session", sessionId),
    pendingSequence: pendingScrollSequence.current, targetSequence: turnScrollTargetRef.current,
    retryTimerPending: turnScrollRetryTimerRef.current !== null,
    retries: turnScrollTargetRef.current === null ? null : turnScrollRetriesRef.current.get(turnScrollTargetRef.current) ?? 0,
    following: followingTailRef.current, dragging: userDraggingRef.current, momentum: momentumScrollingRef.current,
    initialDone: initialScrollDone.current, followFramePending: followTailFrameRef.current !== null,
    cancelGeneration: traceCancelGeneration.current,
    inverted: false,
    ...lastScrollRef.current,
  }), [sessionId]);
  const { recording: tracing, log: trace } = useChatScrollTrace("chat", traceState);
  const traceTouches = useTraceTouches("chat.list", traceState, tracing);
  const traceOffset = useCallback((source: string, options: { offset: number; animated: boolean }) => {
    trace("command.scrollToOffset", { source, ...options, hasList: Boolean(listRef.current) });
    listRef.current?.scrollToOffset(options);
  }, [trace]);
  const traceEnd = useCallback((source: string, animated: boolean) => {
    trace("command.scrollToEnd", { source, animated, hasList: Boolean(listRef.current) });
    listRef.current?.scrollToEnd({ animated });
  }, [trace]);
  const traceIndex = useCallback((source: string, options: { index: number; animated: boolean; viewPosition: number; viewOffset: number }) => {
    trace("command.scrollToIndex", { source, ...options, hasList: Boolean(listRef.current) });
    // Chronological list: only the overlaid top bar has to be compensated.
    const viewOffset = chatListViewOffset(options.viewPosition, options.viewOffset, headerHeight);
    return listRef.current?.scrollToIndex({ ...options, viewOffset }) ?? Promise.resolve();
  }, [headerHeight, trace]);
  const setFollowingTail = useCallback((next: boolean) => {
    if (followingTailRef.current === next) return;
    trace("tail.followingChanged", { next });
    followingTailRef.current = next;
    setFollowingTailState(next);
  }, [trace]);
  useEffect(() => {
    if (view.hasMoreNewer) setFollowingTail(false);
  }, [setFollowingTail, view.hasMoreNewer]);
  useLayoutEffect(() => {
    listPlacedRef.current = false;
  }, [listGeneration]);
  const setFollowPinAnimated = useCallback((next: boolean) => {
    if (followPinAnimatedRef.current === next) return;
    followPinAnimatedRef.current = next;
    setFollowPinAnimatedState(next);
  }, []);
  const cancelTurnScroll = useCallback(() => {
    traceCancelGeneration.current += 1;
    trace("turn.cancel");
    pendingScrollSequence.current = null;
    turnScrollTargetRef.current = null;
    turnScrollRetriesRef.current.clear();
    if (turnScrollRetryTimerRef.current !== null) {
      clearTimeout(turnScrollRetryTimerRef.current);
      turnScrollRetryTimerRef.current = null;
    }
  }, [trace]);
  const requestFollowTail = useCallback((animated = false) => {
    trace("tail.request", { animated });
    // A list still placing itself owns the scroll; a command would race it.
    if (!listPlacedRef.current || !followingTailRef.current || userDraggingRef.current || momentumScrollingRef.current || pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null) return;
    if (followTailFrameRef.current !== null) cancelAnimationFrame(followTailFrameRef.current);
    followTailFrameRef.current = requestAnimationFrame(() => {
      followTailFrameRef.current = null;
      if (!listPlacedRef.current || !followingTailRef.current || userDraggingRef.current || momentumScrollingRef.current || pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null) return;
      traceEnd("tail.frame", animated);
      if (animated) return;
      requestAnimationFrame(() => {
        if (!followingTailRef.current || userDraggingRef.current || momentumScrollingRef.current) return;
        traceEnd("tail.secondFrame", false);
      });
    });
  }, [trace, traceEnd]);
  const onVisibleRows = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (chatScrollTrace.isRecording()) trace("list.viewable", { items: viewableItems.map((item) => ({ index: item.index, visible: item.isViewable, message: chatScrollTrace.alias("message", (item.item as MessageRecord).id), turn: turnSequenceForMessage(item.item as MessageRecord) })) });
    const ordered = viewableItems
      .filter((item) => item.isViewable && item.item && typeof item.item === "object")
      .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER));
    if (initialUnreadIndexRef.current !== null) {
      const initialUnreadVisible = ordered.some((item) => item.index === initialUnreadIndexRef.current);
      if (initialUnreadVisible) {
        initialUnreadIndexRef.current = null;
        initialUnreadRetriesRef.current = 0;
      } else {
        return;
      }
    }
    if (readStateLoadedRef.current && initialScrollDone.current) {
      const visibleAssistantSequence = ordered.reduce((latest, item) => {
        const message = item.item as MessageRecord;
        if (message.role !== "assistant") return latest;
        const sequence = turnSequenceForMessage(message);
        return sequence !== null ? Math.max(latest, sequence) : latest;
      }, readSequenceRef.current ?? 0);
      if (visibleAssistantSequence > (readSequenceRef.current ?? 0)) {
        readSequenceRef.current = visibleAssistantSequence;
        if (visibleAssistantSequence > (savedReadSequenceRef.current ?? 0)) {
          savedReadSequenceRef.current = visibleAssistantSequence;
          void saveSessionReadSequence(sessionId, visibleAssistantSequence).catch(() => undefined);
        }
      }
    }
    const target = turnScrollTargetRef.current;
    if (target !== null) {
      if (ordered.some((item) => turnSequenceForMessage((item.item as { meta: Record<string, unknown> | null })) === target)) {
        trace("turn.targetVisible", { sequence: target });
        turnScrollTargetRef.current = null;
        turnScrollRetriesRef.current.delete(target);
        if (turnScrollRetryTimerRef.current !== null) {
          clearTimeout(turnScrollRetryTimerRef.current);
          turnScrollRetryTimerRef.current = null;
        }
        setCurrentTurnSequence(target);
      }
      return;
    }
    // Chronological list: the first viewable row is the one at the top of the viewport.
    const visualTop = ordered[0];
    if (visualTop?.item) setCurrentTurnSequence(turnSequenceForMessage(visualTop.item as { meta: Record<string, unknown> | null }));
  }, [saveSessionReadSequence, sessionId, trace]);
  const { onViewableItemsChanged, measureVisibleRows, trackRow } = useChatVisibleRows({ viewportRef: listContainerRef, topInset: headerHeight, bottomInset: footerHeight, onVisible: onVisibleRows });
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const spaceName = view.space ? displaySpaceName(view.space) : sessionSummary?.space?.name || t("space.fallbackName");
  const spaceSessions = useMemo(() => state.sessions.filter((item) => item.spaceId === spaceId), [spaceId, state.sessions]);
  const queuedFollowups = useMemo(() => queuedFollowupTurns(view.turns, view.stream?.turnId), [view.stream?.turnId, view.turns]);
  const queuedFollowupIds = useMemo(() => new Set(queuedFollowups.map((turn) => turn.id)), [queuedFollowups]);
  const queueItems = useMemo(() => followupQueueItems(view.turns, view.stream?.turnId, view.messages), [view.turns, view.stream?.turnId, view.messages]);
  const transitionQueueItem = sendTransition ? queueItems.find((item) => isSendQueueItem(item, sendTransition.message)) ?? null : null;
  const queueTransitionActive = sendTransition !== null && transitionQueueItem !== null;
  useEffect(() => {
    if (!sendTransition || sendTransition.destination !== "queue" || transitionQueueItem) return;
    const frame = requestAnimationFrame(() => completeSendTransition(sendTransition.message.id));
    return () => cancelAnimationFrame(frame);
  }, [completeSendTransition, sendTransition, transitionQueueItem]);
  useEffect(() => { recordDebugEvent("chat.queue.state", { count: queuedFollowups.length, ids: queuedFollowups.map((turn) => chatScrollTrace.alias("turn", turn.id)) }); }, [queuedFollowups]);
  const messages = useMemo(() => {
    const history = messagesFromTurns(view.turns);
    return messagesInWindow(withTurnSequences(
      mergeDisplayMessages(history.length > 0 ? history : view.messages, history.length > 0 ? view.messages : [])
        .filter((message) => !isOptimisticFollowup(message) && !isAssistantIntermediate(message) && hasRenderableMessage(message) && !(typeof message.meta?.turnId === "string" && queuedFollowupIds.has(message.meta.turnId))),
      view.turns,
    ), { turns: view.turns, hasMoreNewer: view.hasMoreNewer });
  }, [queuedFollowupIds, view.hasMoreNewer, view.messages, view.turns]);
  const { showLoader: catchUpLoader, arrivalBaseline } = useChatCatchUp(view.catchingUp, messages);
  // renderItem previously ran linear `find`/`filter` over every turn for every rendered row.
  const turnsById = useMemo(() => new Map(view.turns.map((entry) => [entry.id, entry])), [view.turns]);
  const turnsBySequence = useMemo(() => {
    const map = new Map<number, SessionTurnRecord[]>();
    for (const entry of view.turns) {
      const list = map.get(entry.sequence);
      if (list) list.push(entry);
      else map.set(entry.sequence, [entry]);
    }
    return map;
  }, [view.turns]);
  const transitionMessage = sendTransition
    ? messages.find((item) => isSendBubbleMessage(item, sendTransition.message)) ?? sendTransition.message
    : null;

  useEffect(() => {
    if (!tracing) return;
    trace("chat.state", {
      messageCount: messages.length, turnCount: view.turns.length,
      loading: view.loading, historyLoaded: view.historyLoaded, refreshing: view.refreshing,
      loadingOlder: view.loadingOlder, loadingNewer: view.loadingNewer,
      hasMoreOlder: view.hasMoreOlder, hasMoreNewer: view.hasMoreNewer,
      streamStatus: view.stream?.status ?? null, sending: view.sending,
      activePanel, currentTurnSequence, turnNavigatorOpen,
      initialTurnSequence, hasInitialTurnId: initialTurnId !== null,
      inverted: false, maintainVisibleContentPosition: !followingTail,
    });
  }, [activePanel, currentTurnSequence, followingTail, initialTurnId, initialTurnSequence, messages.length, trace, tracing, turnNavigatorOpen, view.hasMoreNewer, view.hasMoreOlder, view.historyLoaded, view.loading, view.loadingNewer, view.loadingOlder, view.refreshing, view.sending, view.stream?.status, view.turns.length]);
  const { fontScale } = useWindowDimensions();
  // App text size changes row heights, so it participates in the measurement cache key.
  const textSizeToken = typography.chatBody.fontSize;
  const [listWidth, setListWidth] = useState(0);
  const measurements = useMemo(() => {
    const cache = new MessageMeasurements();
    cache.configure(`${listWidth}:${fontScale}:${theme.mode}:${textSizeToken}`, []);
    return cache;
  }, [listWidth, fontScale, textSizeToken, theme.mode]);
  const measuredMessages = useMemo(() => messages.map((message, index) => ({
    id: message.id,
    revision: measurementRevision(message, index > 0 ? turnSequenceForMessage(messages[index - 1]!) : null),
  })), [messages]);
  useEffect(() => {
    measurements.configure(`${listWidth}:${fontScale}:${theme.mode}:${textSizeToken}`, measuredMessages);
  }, [measurements, measuredMessages, listWidth, fontScale, textSizeToken, theme.mode]);
  const estimatedOffset = useCallback((index: number, averageHeight: number) => {
    const fromOldest = index < 0 ? 0 : measurements.estimateOffset(measuredMessages, index, averageHeight);
    return headerHeight + 12 + (view.hasMoreOlder ? 50 : 0) + fromOldest;
  }, [headerHeight, measurements, measuredMessages, view.hasMoreOlder]);
  let recordedModel: ChatModelSelection | null = null;
  let hasRelevantTurn = false;
  for (const turn of [...view.turns].reverse()) {
    if (turn.executionKind === "direct_generation" || turn.provider === "generation") continue;
    hasRelevantTurn = true;
    if (turn.model) {
      const provider = turn.provider || "cohub";
      const catalogItem = models.find((item) => item.provider === provider && item.id === turn.model);
      const name = catalogItem?.model?.name;
      const requestedLevel = requestedThinkingLevel(turn.meta);
      recordedModel = { provider, id: turn.model, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}), ...(requestedLevel ? { thinkingLevel: requestedLevel } : {}) };
    }
    break;
  }
  if (!hasRelevantTurn && !recordedModel) {
    for (const message of [...messages].reverse()) {
      if (message.meta?.messageKind === "generation_result" || message.provider === "generation") continue;
      if (!message.model && message.role !== "assistant") continue;
      if (message.model) {
        const provider = message.provider || "cohub";
        const catalogItem = models.find((item) => item.provider === provider && item.id === message.model);
        const name = catalogItem?.model?.name;
        const requestedLevel = requestedThinkingLevel(message.meta);
        recordedModel = { provider, id: message.model, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}), ...(requestedLevel ? { thinkingLevel: requestedLevel } : {}) };
      }
      break;
    }
  }
  const lastAgentTurn = [...view.turns].reverse().find((turn) => turn.executionKind !== "direct_generation");
  const composerHarness = selectedHarness ?? runtimeHarnessFromTurn(lastAgentTurn);
  const recordedLocalModel = composerHarness === "cohub" ? null : [...view.turns].reverse().find((turn) => runtimeHarnessFromTurn(turn) === composerHarness && turn.model);
  const activeModel = composerHarness === "cohub"
    ? (modelOverride ? selectedModel : recordedModel)
    : (Object.hasOwn(localModelsByHarness, composerHarness) ? localModelsByHarness[composerHarness] ?? null : recordedLocalModel ? recordedRuntimeModel(recordedLocalModel, composerHarness) : null);
  const activeStatus = composerHarness === "cohub" && activeModel ? modelAvailabilityLevel(modelStatus?.models[activeModel.id]) : "unknown";
  const modelLabel = activeModel?.name || activeModel?.id || (composerHarness === "cohub" ? t("chat.model.automatic") : t("model.runtimeAutomatic"));
  const modelTriggerLabel = activeModel?.thinkingLevel ? `${modelLabel} · ${formatThinkingLevel(activeModel.thinkingLevel)}` : modelLabel;
  const liveStream = shouldShowLiveStream(view.stream, messages);
  // Mounting LegendList empty then filling it drops `initialScrollAtEnd`, so the first paint
  // would show the oldest rows and jump. Wait until there is a tail to pin to.
  const timelineReady = messages.length > 0 || view.historyLoaded || Boolean(liveStream) || view.sending;
  // The list stays invisible until it has settled on the tail, so the opening state covers that too.
  const placeholder = chatThreadPlaceholder({
    messageCount: messages.length,
    historyLoaded: view.historyLoaded,
    error: view.error,
    hasLiveActivity: Boolean(liveStream || view.sending),
  }) ?? (timelineReady && !listLoaded ? "opening" : null);
  const threadPlaceholder = placeholder === "opening" && !openingDelayElapsed ? null : placeholder;
  const running = state.sessionLatestTurns[sessionId]?.status === "running" || view.sending || (liveStream && isLiveStreamStatus(view.stream?.status ?? ""));
  const appendVoiceText = useCallback((text: string) => {
    const current = inputRef.current.trim();
    updateInput(current ? `${current} ${text}` : text);
  }, [updateInput]);
  const voice = useNativeVoiceInput({ getAccessToken, onFinal: appendVoiceText });

  const handleListLoad = useCallback(() => {
    listPlacedRef.current = true;
    setListLoaded(true);
  }, []);

  useEffect(() => {
    entryRendersRef.current += 1;
    entryStatsRef.current = { messages: view.messages.length, turns: view.turns.length, hasStream: Boolean(view.stream), historyLoaded: view.historyLoaded };
  });

  useEffect(() => {
    markChatEntry("screen.mount", entryStatsRef.current);
    const timer = setTimeout(() => markChatEntry("settled", { ...entryStatsRef.current, renders: entryRendersRef.current }), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (entryHistoryLoadedRef.current || !view.historyLoaded) return;
    entryHistoryLoadedRef.current = true;
    markChatEntry("history.loaded", { turns: view.turns.length, renders: entryRendersRef.current });
  }, [view.historyLoaded, view.turns.length]);

  useEffect(() => {
    if (listLoaded) markChatEntry("list.loaded", { renders: entryRendersRef.current });
  }, [listLoaded]);

  useEffect(() => {
    const timer = setTimeout(() => setOpeningDelayElapsed(true), OPENING_PLACEHOLDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [listGeneration]);

  const openQuiet = listLoaded && view.historyLoaded && !view.catchingUp;
  useEffect(() => {
    if (openSettled || !openQuiet) return;
    const timer = setTimeout(() => setOpenSettled(true), OPEN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [openQuiet, openSettled]);

  useEffect(() => {
    let active = true;
    readStateLoadedRef.current = false;
    readSequenceRef.current = null;
    savedReadSequenceRef.current = null;
    void loadSessionReadSequence(sessionId).then((sequence) => {
      if (!active) return;
      readSequenceRef.current = sequence;
      savedReadSequenceRef.current = sequence;
      readStateLoadedRef.current = true;
    }).catch(() => {
      if (active) readStateLoadedRef.current = true;
    });
    return () => { active = false; };
  }, [loadSessionReadSequence, sessionId]);

  const hasInitialTurnTarget = initialTurnId !== null || initialTurnSequence !== null;
  const targetMessageIndex = useCallback((sequence: number) => {
    const exactIndex = messageIndexForTurn(messages, sequence);
    if (exactIndex >= 0) return exactIndex;
    return messages.findIndex((message) => {
      const messageSequence = turnSequenceForMessage(message);
      return messageSequence !== null && messageSequence > sequence;
    });
  }, [messages]);
  const targetIsLatestMessage = useCallback(() => {
    const target = turnScrollTargetRef.current;
    const lastMessage = messages.at(-1);
    return target !== null && lastMessage !== undefined && turnSequenceForMessage(lastMessage) === target;
  }, [messages]);
  const requestInitialScroll = useCallback(() => {
    if (!listLoaded || !view.historyLoaded || initialScrollDone.current || messages.length === 0 || hasInitialTurnTarget) return;
    initialScrollDone.current = true;
    setFollowingTail(true);
    setCurrentTurnSequence(view.turns.at(-1)?.sequence ?? null);
  }, [hasInitialTurnTarget, listLoaded, messages.length, setFollowingTail, view.historyLoaded, view.turns]);

  // Legend resolves `scrollToIndex` for unrendered rows from its own estimates; when it rejects the
  // row is too far away, so park at an estimated offset and let the retry timer re-target it.
  const scrollToMessageIndex = useCallback((source: string, index: number, animated: boolean) => {
    void traceIndex(source, { index, animated, viewPosition: 0.15, viewOffset: 8 }).catch(() => {
      trace("command.scrollToIndexEstimate", { source, index });
      traceOffset(`${source}.estimate`, { offset: estimatedOffset(index, FALLBACK_ROW_HEIGHT), animated: false });
    });
  }, [estimatedOffset, trace, traceIndex, traceOffset]);

  const scheduleTurnScrollRetry = useCallback((sequence: number, retry: number) => {
    trace("turn.retrySchedule", { sequence, retry, exhausted: retry >= 4 });
    if (retry >= 4) {
      if (turnScrollTargetRef.current === sequence) turnScrollTargetRef.current = null;
      turnScrollRetriesRef.current.delete(sequence);
      return;
    }
    if (turnScrollRetryTimerRef.current !== null) clearTimeout(turnScrollRetryTimerRef.current);
    turnScrollRetryTimerRef.current = setTimeout(() => {
      turnScrollRetryTimerRef.current = null;
      trace("turn.retryFire", { sequence, retry });
      if (turnScrollTargetRef.current !== sequence) return;
      const index = targetMessageIndex(sequence);
      if (index < 0 || !listRef.current) return;
      turnScrollRetriesRef.current.set(sequence, retry + 1);
      scrollToMessageIndex("turn.retryTimer", index, false);
    }, retry === 0 ? 120 : 180);
  }, [scrollToMessageIndex, targetMessageIndex, trace]);
  const scrollToTurn = useCallback((sequence: number, retry = 0) => {
    const index = targetMessageIndex(sequence);
    trace("turn.scrollRequest", { sequence, retry, index, messageCount: messages.length });
    turnScrollTargetRef.current = sequence;
    turnScrollRetriesRef.current.set(sequence, retry);
    setFollowingTail(false);
    if (index < 0) {
      pendingScrollSequence.current = sequence;
      return;
    }
    if (!listRef.current) {
      pendingScrollSequence.current = sequence;
      return;
    }
    pendingScrollSequence.current = null;
    initialScrollDone.current = true;
    scrollToMessageIndex("turn.scrollToTurn", index, retry === 0);
    scheduleTurnScrollRetry(sequence, retry);
    setCurrentTurnSequence(sequence);
  }, [messages.length, scheduleTurnScrollRetry, scrollToMessageIndex, setFollowingTail, targetMessageIndex, trace]);

  const handleTurnJump = async (sequence: number) => {
    const requestId = ++traceRequestId.current;
    const cancelGeneration = traceCancelGeneration.current;
    setLoadingSequence(sequence);
    try {
      trace("turn.jumpStart", { sequence, origin: "navigator", requestId });
      const resolvedSequence = await jumpToTurn(sessionId, sequence);
      trace("turn.jumpResolved", { sequence, resolvedSequence, origin: "navigator", requestId, cancelledWhileWaiting: cancelGeneration !== traceCancelGeneration.current });
      scrollToTurn(resolvedSequence);
      setTurnNavigatorOpen(false);
    } catch (error) {
      trace("turn.jumpFailed", { origin: "navigator", requestId });
      setNotice({ title: t("chat.turnUnavailable.title"), message: error instanceof Error ? error.message : t("chat.turnUnavailable.body") });
    } finally {
      setLoadingSequence(null);
    }
  };

  useEffect(() => {
    initialScrollDone.current = false;
    initialUnreadIndexRef.current = null;
    initialUnreadRetriesRef.current = 0;
    pendingScrollSequence.current = null;
    userDraggingRef.current = false;
    momentumScrollingRef.current = false;
    turnScrollTargetRef.current = null;
    turnScrollRetriesRef.current.clear();
    if (turnScrollRetryTimerRef.current !== null) {
      clearTimeout(turnScrollRetryTimerRef.current);
      turnScrollRetryTimerRef.current = null;
    }
    handledDeepLinkTarget.current = null;
  }, [sessionId]);

  useEffect(() => {
    const frame = requestAnimationFrame(requestInitialScroll);
    return () => cancelAnimationFrame(frame);
  }, [requestInitialScroll]);

  useEffect(() => () => {
    if (followTailFrameRef.current !== null) cancelAnimationFrame(followTailFrameRef.current);
    if (turnScrollRetryTimerRef.current !== null) clearTimeout(turnScrollRetryTimerRef.current);
  }, []);

  useEffect(() => {
    const targetKey = initialTurnId ? `id:${initialTurnId}` : initialTurnSequence !== null ? `sequence:${initialTurnSequence}` : null;
    if (!targetKey || !client || !spaceId || !view.historyLoaded || handledDeepLinkTarget.current === targetKey) return;
    handledDeepLinkTarget.current = targetKey;
    const target = initialTurnId ? { turnId: initialTurnId } : initialTurnSequence;
    if (target === null) return;
    const requestId = ++traceRequestId.current;
    const cancelGeneration = traceCancelGeneration.current;
    void (async () => {
      try {
        if (chatScrollTrace.isRecording()) trace("turn.jumpStart", { origin: "deepLink", requestId, target: typeof target === "number" ? target : chatScrollTrace.alias("turn", target.turnId) });
        const sequence = await jumpToTurn(sessionId, target);
        trace("turn.jumpResolved", { origin: "deepLink", sequence, requestId, cancelledWhileWaiting: cancelGeneration !== traceCancelGeneration.current });
        pendingScrollSequence.current = sequence;
        scrollToTurn(sequence);
      } catch (error) {
        trace("turn.jumpFailed", { origin: "deepLink", requestId });
        setNotice({ title: t("chat.turnUnavailable.title"), message: error instanceof Error ? error.message : t("chat.turnUnavailable.deepLinkBody") });
      }
    })();
  }, [client, initialTurnId, initialTurnSequence, jumpToTurn, scrollToTurn, sessionId, spaceId, t, trace, view.historyLoaded, view.turns]);

  useEffect(() => {
    if (turnNavigatorOpen) void loadTurnIndex(sessionId, { force: true }).catch(() => undefined);
  }, [loadTurnIndex, sessionId, turnNavigatorOpen]);

  const appendAttachments = (next: AttachmentDraft[]) => setAttachments((current) => [...current, ...next].slice(0, 6));
  const pickAttachments = async () => {
    setAttachmentMenuOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/octet-stream", size: asset.size ?? 0 })));
    } catch (error) { showToast({ title: t("chat.attachmentUnavailable.title"), message: error instanceof Error ? error.message : t("chat.attachmentUnavailable.body"), tone: "danger" }); }
  };
  const pickPhotos = async () => {
    setAttachmentMenuOpen(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showToast({ title: t("chat.photoOff.title"), message: t("chat.photoOff.body"), tone: "danger" }); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.88 });
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName || `image-${index + 1}.jpg`, mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 })));
    } catch (error) { showToast({ title: t("chat.photoPickerUnavailable.title"), message: error instanceof Error ? error.message : t("chat.photoPickerUnavailable.body"), tone: "danger" }); }
  };
  const takePhoto = async () => {
    setAttachmentMenuOpen(false);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { showToast({ title: t("chat.cameraOff.title"), message: t("chat.cameraOff.body"), tone: "danger" }); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.88 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset) appendAttachments([{ uri: asset.uri, name: asset.fileName || "camera-photo.jpg", mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 }]);
    } catch (error) { showToast({ title: t("chat.cameraUnavailable.title"), message: error instanceof Error ? error.message : t("chat.cameraUnavailable.body"), tone: "danger" }); }
  };
  const stopGeneration = async () => {
    recordDebugEvent("chat.stop.pressed", { stopping });
    if (stopping) {
      recordDebugEvent("chat.stop.ignored", { reason: "already_in_flight" });
      return;
    }
    setStopping(true);
    recordDebugEvent("chat.stop.started");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await abortSession(sessionId);
      recordDebugEvent("chat.stop.ended", { outcome: "success" });
    } catch (error) {
      recordDebugEvent("chat.stop.ended", { outcome: "failed" });
      showToast({ title: t("chat.stopFailed.title"), message: error instanceof Error ? error.message : t("chat.stopFailed.body"), tone: "danger" });
    } finally { setStopping(false); }
  };
  const runFollowupAction = async (turnId: string, action: "steer" | "cancel") => {
    if (!client || !spaceId || pendingFollowupAction !== null) return;
    setPendingFollowupAction(turnId);
    if (action === "steer") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (action === "steer") await steerQueuedFollowup(client, spaceId, sessionId, turnId);
      else await cancelQueuedFollowup(client, spaceId, sessionId, turnId);
      await refreshSession(sessionId);
    } catch (error) {
      showToast({ title: action === "steer" ? t("chat.steerFailed.title") : t("chat.cancelFailed.title"), message: error instanceof Error ? error.message : t("chat.followupFailed.body"), tone: "danger" });
      void refreshSession(sessionId).catch(() => undefined);
    } finally {
      setPendingFollowupAction(null);
    }
  };
  const shareChat = async () => {
    const title = session ? displaySessionTitle(session) : t("chat.title");
    if (!spaceId) {
      showToast({ title: t("chat.shareFailed.title"), message: t("chat.shareFailed.body"), tone: "danger" });
      return;
    }
    const url = `https://cohub.live/spaces/${encodeURIComponent(spaceId)}/sessions/${encodeURIComponent(sessionId)}`;
    await Share.share({ message: `${title}\n${url}`, url, title });
  };
  const copySessionTitle = useCallback(async () => {
    const title = session ? displaySessionTitle(session) : t("chat.title");
    try {
      await Clipboard.setStringAsync(title);
      showToast({ title: t("chat.titleCopied") });
    } catch (error) {
      showToast({ title: t("chat.copyTitleFailed.title"), message: error instanceof Error ? error.message : t("chat.copyTitleFailed.body"), tone: "danger" });
    }
  }, [session, showToast, t]);
  const openTitleMenu = useCallback(() => {
    setMoreOpen(false);
    setTitleMenuOpen(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);
  // Edit the stored title, not its `@Label` display, so saving unchanged keeps mention markup.
  const openRename = () => {
    const current = session ? session.title?.trim() || displaySessionTitle(session) : "";
    // iOS asks with the system alert and its text field; Android draws the same dialog.
    if (Platform.OS === "ios") {
      Alert.prompt(t("chat.rename.title"), undefined, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.save"), isPreferred: true, onPress: (value?: string) => void saveRename((value ?? "").slice(0, RENAME_MAX_LENGTH)) },
      ], "plain-text", current);
      return;
    }
    setRenameValue(current);
    setRenameOpen(true);
  };
  const openLabelSheet = () => {
    setLabelSheetOpen(true);
    if (!client || !spaceId) return;
    void fetchSessionLabels(client, spaceId)
      .then((tree) => setChatLabels(toUserSessionLabels(tree)))
      .catch(() => setChatLabels([]));
  };
  const saveRename = async (title = renameValue) => {
    try { await renameSession(sessionId, title); setRenameOpen(false); } catch (error) { showToast({ title: t("chat.renameFailed.title"), message: error instanceof Error ? error.message : t("chat.renameFailed.body"), tone: "danger" }); }
  };
  const titleActions: AnchoredMenuAction[] = [
    { icon: "copy", title: t("chat.titleActions.copy"), onPress: () => void copySessionTitle() },
    { icon: "square-pen", title: t("chat.titleActions.edit"), onPress: openRename },
  ];
  const chatActions: AnchoredMenuAction[] = [
    ...(tracing ? [{ icon: "activity" as const, title: "Scroll Diagnostics", onPress: () => { trace("experiment.mark", { origin: "chatMenu" }); router.push("/debug/chat-scroll"); } }] : []),
    { icon: "share", title: t("chat.actions.share"), onPress: () => void shareChat() },
    { icon: "messages", title: t("chat.actions.openChats"), disabled: !spaceId, onPress: () => setActivePanel("chat") },
    { icon: "folder-open", title: t("chat.actions.openFiles"), disabled: !spaceId, onPress: () => setActivePanel("files") },
    { icon: "tag", title: t("chat.actions.labels"), disabled: !client || !spaceId, onPress: openLabelSheet },
    { icon: "square-pen", title: t("chat.actions.rename"), onPress: openRename },
  ];
  const handleScroll = useCallback((event: ChatScrollEvent) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const now = Date.now();
    if (now - alwaysScrollLogRef.current.at >= 250) {
      recordDebugEvent("chat.list.scroll", {
        session: debugAlias("session", sessionId),
        offsetY: Math.round(contentOffset.y),
        deltaY: Math.round(contentOffset.y - alwaysScrollLogRef.current.y),
        contentHeight: Math.round(contentSize.height),
        viewportHeight: Math.round(layoutMeasurement.height),
        following: followingTailRef.current,
      });
      alwaysScrollLogRef.current = { at: now, y: contentOffset.y };
    }
    trace("list.scroll", { previousY: lastScrollRef.current.y, deltaY: contentOffset.y - lastScrollRef.current.y, offsetY: contentOffset.y, contentHeight: contentSize.height, viewportHeight: layoutMeasurement.height });
    // Growth adds distance from the tail without the user going anywhere. Legend's own animated
    // tail pin also reports momentum while it catches up toward newer messages, so a burst of
    // tokens must not look like a scroll-away. Only a move toward older messages may drop following.
    const offsetDelta = contentOffset.y - lastScrollRef.current.y;
    const grew = contentSize.height > lastScrollRef.current.height;
    lastScrollRef.current = { y: contentOffset.y, height: contentSize.height, viewport: layoutMeasurement.height };
    measureVisibleRows();
    const { distanceToLatest, distanceToOldest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height);
    setFollowingTail(nextChatTailFollowing({
      currentlyFollowing: followingTailRef.current,
      distanceToBottom: distanceToLatest,
      userInteracting: chatTailScrolledAway({ dragging: userDraggingRef.current, momentum: momentumScrollingRef.current, contentGrew: grew, offsetDelta }),
      pendingTarget: pendingScrollSequence.current !== null || (turnScrollTargetRef.current !== null && !targetIsLatestMessage()),
      detached: view.hasMoreNewer,
    }));
    // Native animated scrollTo cannot retarget; snap once a burst opens a gap the pin would chase.
    setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
    if (initialScrollDone.current && followingTailRef.current && chatTailDisplaced({ dragging: userDraggingRef.current, momentum: momentumScrollingRef.current, contentGrew: grew, offsetDelta, distanceToLatest })) {
      recordDebugEvent("chat.tail.displaced", { session: debugAlias("session", sessionId), offsetY: Math.round(contentOffset.y), distanceToLatest: Math.round(distanceToLatest) });
      requestFollowTail(false);
      return;
    }
    if (initialScrollDone.current && listPlacedRef.current && distanceToOldest < CHAT_PAGE_THRESHOLD && view.hasMoreOlder && !view.loadingOlder) {
      trace("pagination.request", { direction: "older", distanceToOldest });
      void loadOlderTurns(sessionId);
    }
    if (distanceToLatest < CHAT_PAGE_THRESHOLD && view.hasMoreNewer && !view.loadingNewer) {
      trace("pagination.request", { direction: "newer", distanceToLatest });
      void loadNewerTurns(sessionId);
    }
  }, [loadNewerTurns, loadOlderTurns, measureVisibleRows, requestFollowTail, sessionId, setFollowPinAnimated, setFollowingTail, targetIsLatestMessage, trace, view.hasMoreNewer, view.hasMoreOlder, view.loadingNewer, view.loadingOlder]);

  const handleContentSizeChange = useCallback((width: number, height: number) => {
    trace("list.contentSize", { width, height });
    measureVisibleRows();
    const pending = pendingScrollSequence.current;
    if (pending !== null) {
      scrollToTurn(pending);
      if (pendingScrollSequence.current !== null) return;
      initialScrollDone.current = true;
      return;
    }
    // Legend's animated pin can lose its opening race on a chat that is already streaming when
    // opened: its maintain request stays pending while the tail keeps growing out of view, and
    // only a user drag recovers it. Re-check one frame later; a healthy pin is producing scroll
    // events while it catches up, so an unchanged offset next to an oversized gap is a real stall.
    if (initialScrollDone.current && followingTailRef.current && !userDraggingRef.current && !momentumScrollingRef.current && turnScrollTargetRef.current === null) {
      if (followTailFrameRef.current !== null) cancelAnimationFrame(followTailFrameRef.current);
      const yAtSchedule = lastScrollRef.current.y;
      followTailFrameRef.current = requestAnimationFrame(() => {
        followTailFrameRef.current = null;
        if (!followingTailRef.current || userDraggingRef.current || momentumScrollingRef.current) return;
        const { distanceToLatest } = chatListDistances(lastScrollRef.current.y, height, lastScrollRef.current.viewport);
        if (!chatTailStalled(distanceToLatest, lastScrollRef.current.y === yAtSchedule)) return;
        trace("tail.stalled", { distanceToLatest });
        setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
        requestFollowTail(false);
      });
    }
    requestInitialScroll();
  }, [measureVisibleRows, requestFollowTail, requestInitialScroll, scrollToTurn, setFollowPinAnimated, trace]);

  const handleScrollBeginDrag = useCallback(() => {
    setSendTransition(null);
    traceAction("chat_list_drag_begin");
    trace("list.dragBegin");
    userDraggingRef.current = true;
    momentumScrollingRef.current = false;
    if (followTailFrameRef.current !== null) {
      cancelAnimationFrame(followTailFrameRef.current);
      followTailFrameRef.current = null;
    }
    cancelTurnScroll();
  }, [cancelTurnScroll, trace]);

  const handleScrollEndDrag = useCallback((event: ChatScrollEvent) => {
    traceAction("chat_list_drag_end", { velocityY: event.nativeEvent.velocity?.y ?? null, offsetY: Math.round(event.nativeEvent.contentOffset.y) });
    trace("list.dragEnd", { velocityY: event.nativeEvent.velocity?.y, offsetY: event.nativeEvent.contentOffset.y });
    const velocityY = event.nativeEvent.velocity?.y ?? 0;
    if (Math.abs(velocityY) >= 0.05) {
      momentumScrollingRef.current = true;
      return;
    }
    userDraggingRef.current = false;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const { distanceToLatest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height);
    setFollowingTail(nextChatTailFollowing({ currentlyFollowing: followingTailRef.current, distanceToBottom: distanceToLatest, userInteracting: false, pendingTarget: pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null, detached: view.hasMoreNewer }));
    setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
    requestFollowTail();
  }, [requestFollowTail, setFollowPinAnimated, setFollowingTail, trace, view.hasMoreNewer]);

  const handleMomentumScrollBegin = useCallback(() => {
    traceAction("chat_list_momentum_begin");
    trace("list.momentumBegin");
    if (userDraggingRef.current) momentumScrollingRef.current = true;
  }, [trace]);

  const handleMomentumScrollEnd = useCallback((event: ChatScrollEvent) => {
    traceAction("chat_list_momentum_end", { offsetY: Math.round(event.nativeEvent.contentOffset.y) });
    trace("list.momentumEnd", { offsetY: event.nativeEvent.contentOffset.y });
    userDraggingRef.current = false;
    momentumScrollingRef.current = false;
    if (pendingScrollSequence.current !== null) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const { distanceToLatest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height);
    setFollowingTail(nextChatTailFollowing({ currentlyFollowing: followingTailRef.current, distanceToBottom: distanceToLatest, userInteracting: false, pendingTarget: pendingScrollSequence.current !== null || (turnScrollTargetRef.current !== null && !targetIsLatestMessage()), detached: view.hasMoreNewer }));
    setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
    requestFollowTail();
  }, [requestFollowTail, setFollowPinAnimated, setFollowingTail, targetIsLatestMessage, trace, view.hasMoreNewer]);

  const jumpToLatest = useCallback(async () => {
    cancelTurnScroll();
    if (!view.hasMoreNewer) {
      setFollowingTail(true);
      requestFollowTail(true);
      return;
    }
    setJumpingToLatest(true);
    try {
      const replaced = await loadLatestTurns(sessionId);
      setFollowingTail(true);
      // A replaced window remounts the list, which places itself at the end.
      if (!replaced) requestFollowTail(true);
    } catch (error) {
      showToast({ title: t("chat.jumpLatestFailed"), message: error instanceof Error ? error.message : t("data.loadNewerFailed"), tone: "danger" });
    } finally {
      setJumpingToLatest(false);
    }
  }, [cancelTurnScroll, loadLatestTurns, requestFollowTail, sessionId, setFollowingTail, showToast, t, view.hasMoreNewer]);

  const handleCopyMessage = useCallback((text: string) => {
    recordDebugEvent("chat.message.copy", { session: debugAlias("session", sessionId), length: text.length });
    void copyMessageText(text).catch((error) => {
      showToast({ title: t("chat.copyFailed.title"), message: error instanceof Error ? error.message : t("chat.copyFailed.body"), tone: "danger" });
    });
  }, [sessionId, showToast, t]);

  const forkMessage = useCallback(async (message: MessageRecord) => {
    const turnId = message.meta?.turnId;
    if (!spaceId || typeof turnId !== "string" || forkingTurnId) return;
    recordDebugEvent("chat.turn.fork", { session: debugAlias("session", sessionId), sequence: message.sequence });
    setForkingTurnId(turnId);
    try {
      const turn = view.turns.find((item) => item.id === turnId);
      if (!turn) throw new Error(t("chat.forkUnavailable"));
      const response = await forkSession(spaceId, sessionId, turn);
      void refreshHome();
      router.push({ pathname: "/chat/[sessionId]", params: { sessionId: response.id } });
    } catch (error) {
      showToast({ title: t("chat.forkFailed.title"), message: error instanceof Error ? error.message : t("chat.forkFailed.body"), tone: "danger" });
    } finally {
      setForkingTurnId(null);
    }
  }, [forkSession, forkingTurnId, refreshHome, router, sessionId, showToast, spaceId, t, view.turns]);

  // A ref keeps related-Chat links from re-rendering every row on each dispatch.
  const appStateRef = useRef(state);
  useEffect(() => { appStateRef.current = state; }, [state]);
  const lookupSession = useCallback((id: string): SessionRecord | null => appStateRef.current.sessionViews[id]?.session ?? appStateRef.current.sessions.find((item) => item.id === id) ?? null, []);
  const parentSessionId = state.sessionForks[sessionId]?.parentSessionId ?? null;
  const forkOrigin = useMemo(() => {
    const point = forkPoint(view.turns, sessionId, view.hasMoreNewer);
    if (!point || !spaceId) return null;
    // The edge names the direct parent; the anchor's owner differs only when an inherited Turn was forked again.
    return { sequence: point.sequence, ref: { spaceId, sessionId: parentSessionId ?? point.sessionId, turnId: point.turnId } };
  }, [parentSessionId, sessionId, spaceId, view.hasMoreNewer, view.turns]);
  const navigation = useNavigation();
  const openRelatedSession = useCallback((ref: RelatedSessionRef) => {
    // Going back to the Chat underneath keeps its scroll position and avoids ping-pong stacks.
    const stack = navigation.getState();
    const previous = stack ? stack.routes[stack.index - 1] : undefined;
    if (previous?.name === "chat/[sessionId]" && (previous.params as { sessionId?: string } | undefined)?.sessionId === ref.sessionId) {
      router.back();
      return;
    }
    router.push({ pathname: "/chat/[sessionId]", params: { sessionId: ref.sessionId, turnId: ref.turnId } });
  }, [navigation, router]);

  const submit = async () => {
    if ((!input.trim() && attachments.length === 0) || view.sending || submitLockRef.current) return;
    submitLockRef.current = true;
    const generation = sendGenerationRef.current;
    const text = input;
    const files = attachments;
    recordDebugEvent("chat.send.pressed", { hasText: Boolean(text.trim()), attachmentCount: files.length, keyboardExpected: true });
    try {
      const lastAgentTurn = [...view.turns].reverse().find((turn) => turn.executionKind !== "direct_generation");
      const harness = selectedHarness ?? runtimeHarnessFromTurn(lastAgentTurn);
      if (!canUseRuntimeHarness(runtime.status, harness)) {
        showToast({ title: t("runtime.unavailable.title"), message: t("runtime.unavailable.body"), tone: "danger" });
        return;
      }
      const { input: field, scrollY } = composerMeasurementRef.current;
      const source = reducedMotion ? null : await measureSendBubbleSource(files.length > 0 ? attachmentSourceRef.current : field, sendRootRef.current, files.length > 0 ? attachmentScrollYRef.current : scrollY);
      if (generation !== sendGenerationRef.current) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSendTransition(null);
      inputRef.current = "";
      setInput("");
      setAttachments([]);
      void clearComposerDraft(spaceId, draftScope).catch(() => undefined);
      recordDebugEvent("chat.send.composer_cleared");
      const recordedLocalModel = harness === "cohub" ? null : [...view.turns].reverse().find((turn) => runtimeHarnessFromTurn(turn) === harness && turn.model);
      const requestModel = harness === "cohub"
        ? (modelOverride ? selectedModel : recordedModel)
        : (Object.hasOwn(localModelsByHarness, harness) ? localModelsByHarness[harness] ?? null : recordedLocalModel ? recordedRuntimeModel(recordedLocalModel, harness) : null);
      await sendMessage(sessionId, text, files, {
        model: requestModel,
        harness,
        onOptimistic: (message) => {
          if (source) {
            recordDebugEvent("chat.send_transition.source_measured", { ...source });
            setSendTransition({ message, text, source, attachments: files, destination: isOptimisticFollowup(message) ? "queue" : "bubble" });
          }
          if (!isOptimisticFollowup(message)) {
            cancelTurnScroll();
            setFollowingTail(true);
            requestFollowTail(!reducedMotion);
          }
        },
      });
      setSendFeedback("success");
      setTimeout(() => setSendFeedback("idle"), 700);
    } catch {
      recordDebugEvent("chat.send.transition_cancelled");
      // Keep any next message typed while the request was in flight.
      updateInput([text, inputRef.current].filter(Boolean).join("\n\n"));
      setAttachments((current) => [...files, ...current]);
      setSendTransition(null);
    } finally {
      submitLockRef.current = false;
    }
  };

  // FlatList and its cells are PureComponents: bailing out depends on every prop keeping its
  // identity. These are stable across stream batches, so a live turn no longer re-renders every
  // mounted row (the live step list subscribes on its own instead).
  const streamTurnId = view.stream?.turnId ?? null;
  const replyAnchor = liveStream || (view.sending && !view.messages.some(isOptimisticFollowup)) ? liveReplyAnchor(messages, liveStream ? streamTurnId : null, view.hasMoreNewer) : null;
  // LegendList memoizes each row on [item, extraData]; fork/send-transition state renders
  // inside a row but never changes `messages`, so it must flow through extraData to reach it.
  const rowExtraData = useMemo(
    () => ({ forkingTurnId, forkOrigin, sendTransition, queueTransitionActive, streamTurnId, replyAnchor, liveStream, arrivalBaseline, t, theme }),
    [forkingTurnId, forkOrigin, sendTransition, queueTransitionActive, streamTurnId, replyAnchor, liveStream, arrivalBaseline, t, theme],
  );
  const keyExtractor = useCallback((item: MessageRecord) => messageRowKey(item), []);
  // Assistant Markdown rows are much taller than user bubbles; separate averages so the
  // first measured assistant does not poison the estimate used for the next user row.
  const getMessageItemType = useCallback((item: MessageRecord) => item.role, []);
  const listContentStyle = useMemo(() => ({ paddingTop: headerHeight + 12, paddingBottom: footerHeight + 12, flexGrow: messages.length === 0 ? 1 : undefined }), [footerHeight, headerHeight, messages.length]);
  const listIndicatorInsets = useMemo(() => ({ top: headerHeight, bottom: footerHeight }), [footerHeight, headerHeight]);
  // Chronological list: anchoring on data changes keeps the reading position when older turns are
  // prepended. `undefined` keeps Legend's default size stabilization.
  const maintainVisiblePosition = useMemo(() => (followingTail ? undefined : { data: true }), [followingTail]);
  // Row growth uses the list's pin, including tool expansion and streaming. Small growth animates;
  // a burst that outruns the pin snaps so the tail cannot run away.
  const maintainScrollAtEnd = useMemo(() => chatMaintainScrollAtEnd(followingTail, openSettled && !reducedMotion && followPinAnimated), [followPinAnimated, followingTail, openSettled, reducedMotion]);
  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    trace("list.layout", { ...event.nativeEvent.layout });
    setListWidth(event.nativeEvent.layout.width);
    // The stall fallback measures distance before any scroll event may have fired, so the
    // viewport has to come from layout, not only from onScroll.
    lastScrollRef.current = { ...lastScrollRef.current, viewport: event.nativeEvent.layout.height };
    measureVisibleRows();
  }, [measureVisibleRows, trace]);
  const handleListRefresh = useCallback(() => { void refreshSession(sessionId); }, [refreshSession, sessionId]);
  const renderMessage = useCallback(({ item, index }: { item: MessageRecord; index: number }) => {
    const chronologicalIndex = index;
    const isTransitionMessage = sendTransition?.destination === "bubble" && !queueTransitionActive && isSendBubbleMessage(item, sendTransition.message);
    const sequence = turnSequenceForMessage(item);
    const messageTurn = typeof item.meta?.turnId === "string" ? turnsById.get(item.meta.turnId) ?? null : null;
    const sequenceTurns = item.role === "user" && sequence !== null ? turnsBySequence.get(sequence) : undefined;
    const newer = messages[index + 1];
    const endsForkPrefix = forkOrigin !== null && sequence === forkOrigin.sequence && (newer ? turnSequenceForMessage(newer) : null) !== sequence;
    // Rows keep their renderItem closure across prepends and window jumps (messages is
    // deliberately outside extraData), so onLayout can arrive with a stale index or an
    // unsized row; skipping is required because throwing inside a native event handler
    // is fatal on the new architecture and freezes the whole screen.
    return <View ref={(row) => trackRow(messageRowKey(item), row)} collapsable={false} style={item.role === "user" ? TURN_START_STYLE : undefined} onLayout={(event) => { const { height } = event.nativeEvent.layout; if (chatScrollTrace.isRecording()) trace("row.layout", { message: chatScrollTrace.alias("message", item.id), index, sequence, ...event.nativeEvent.layout }); const measurement = rowHeightMeasurement(measuredMessages, chronologicalIndex, item.id, height); if (measurement) measurements.measure(measurement.message, measurement.height); }}><ArrivalRow arrival={isCatchUpArrival(arrivalBaseline, item) && !isTransitionMessage} reducedMotion={reducedMotion}>{sequenceTurns?.[0] ? <SentFromLink turn={sequenceTurns[0]} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /> : null}<MessageBubble message={item} local={item.meta?.optimistic === true} hidden={isTransitionMessage} bubbleRef={isTransitionMessage ? sendBubbleRef : undefined} availableWidth={listWidth || windowWidth} onCopy={handleCopyMessage} onFork={messageTurn && isTerminalTurnStatus(messageTurn.status) ? forkMessage : undefined} forkDisabled={forkingTurnId !== null} forking={forkingTurnId !== null && forkingTurnId === item.meta?.turnId} spaceId={spaceId || null} />{sequenceTurns?.map((entry) => <View key={entry.id}>{isActiveTurnStatus(entry.status) || entry.id === streamTurnId ? <LiveTurnProcess sessionId={sessionId} turn={entry} client={client} spaceId={spaceId} /> : <TurnProcess turn={entry} client={client} spaceId={spaceId} />}<SentToList turn={entry} spaceId={spaceId} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /></View>)}{item.id === replyAnchor ? <LiveReply sessionId={sessionId} showStream={liveStream} processInRow={Boolean(sequenceTurns?.some((entry) => entry.id === streamTurnId))} availableWidth={listWidth || windowWidth} /> : null}{endsForkPrefix ? <ForkedFromDivider origin={forkOrigin.ref} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /> : null}</ArrivalRow></View>;
  }, [arrivalBaseline, client, forkMessage, forkOrigin, forkingTurnId, handleCopyMessage, listWidth, lookupSession, measuredMessages, measurements, messages, liveStream, openRelatedSession, reducedMotion, replyAnchor, queueTransitionActive, sendBubbleRef, sendTransition, sessionId, spaceId, streamTurnId, trace, trackRow, turnsById, turnsBySequence, windowWidth]);

  if (view.loading && !session && view.messages.length === 0 && view.turns.length === 0) return <Screen edgeToEdge><EdgeHeader onLayout={onHeaderLayout}><TopBar transparent title={t("chat.title")} onBack={() => { traceBackPress(); router.back(); }} /></EdgeHeader><View style={{ flex: 1, paddingTop: headerHeight }}><ChatThreadPlaceholder kind="opening" /></View></Screen>;
  return <Screen keyboard edgeToEdge>
    <View className="flex-1" accessibilityElementsHidden={moreOpen || titleMenuOpen} importantForAccessibility={moreOpen || titleMenuOpen ? "no-hide-descendants" : "auto"}>
    <SpacePanels edgeToEdge key={spaceId || sessionId} spaceId={spaceId} spaceName={spaceName} sessions={spaceSessions} client={client} activePanel={activePanel} onActivePanelChange={setActivePanel} onOpenSession={(nextSessionId, target) => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: nextSessionId, ...(target?.turn != null ? { turn: String(target.turn) } : {}), ...(target?.turnId ? { turnId: target.turnId } : {}) } })} onNewChat={() => { if (spaceId) router.push({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId } }); }} onOpenFile={(path) => { if (spaceId) router.push({ pathname: "/space/[spaceId]/file", params: { spaceId, path } }); }} onOpenFilesPage={() => { if (spaceId) router.push({ pathname: "/space/[spaceId]/files", params: { spaceId } }); }}>
      <Animated.View ref={sendRootRef} collapsable={false} className="flex-1 min-h-0">
        <EdgeHeader onLayout={onHeaderLayout}>
        <TopBar transparent title={session ? displaySessionTitle(session) : t("chat.title")} subtitle={spaceName} titleRef={titleRef} onTitleLongPress={session ? openTitleMenu : undefined} titleMenu={session ? { menu: "chat-title-actions-menu", actions: titleActions } : undefined} titleLongPressLabel={t("chat.titleActions.open")} onBack={() => { traceBackPress(); router.back(); }} actions={<><IconButton name="list-tree" label={t("chat.turns.open")} size={38} onPress={() => setTurnNavigatorOpen(true)} disabled={view.turnIndex.length === 0 && view.loading} />{nativeMenus ? <NativeMenuButton appearance="bar" icon="more" label={t("chat.more")} actions={chatActions} testID="chat-actions-menu" /> : <View ref={moreButtonRef} collapsable={false}><IconButton name="more" label={t("chat.more")} size={38} onPress={() => { setTitleMenuOpen(false); setMoreOpen(true); }} /></View>}</>} />
        <ConnectionBanner visible={connectionUnavailable} />
        {view.error ? <View className="mx-4 mt-3 flex-row items-center gap-2 rounded-md bg-danger-soft py-1 pl-3 pr-1" style={{ borderCurve: "continuous" }}><AppIcon name="alert" size={16} tone="danger" /><Text selectable className="flex-1 text-caption text-danger">{view.error}</Text><IconButton name="refresh" label={t("common.retry")} tone="danger" onPress={() => void refreshSession(sessionId)} /></View> : null}
        </EdgeHeader>
        <View ref={listContainerRef} collapsable={false} className="flex-1 min-h-0 bg-background">
        {/* Android selectable text must not reposition the timeline when it gains focus. Explicit turn/tail scrolling remains enabled. */}
        {timelineReady ? <LegendList
          key={listGeneration}
          {...traceTouches}
          ref={listRef}
          data={messages}
          extraData={rowExtraData}
          alignItemsAtEnd
          maintainScrollAtEnd={maintainScrollAtEnd}
          maintainScrollAtEndThreshold={CHAT_FOLLOW_TAIL_MAINTAIN_THRESHOLD}
          estimatedItemSize={FALLBACK_ROW_HEIGHT}
          getItemType={getMessageItemType}
          // Deep links still own the first scroll; otherwise open on the tail instead of the oldest row.
          initialScrollAtEnd={!hasInitialTurnTarget || listGeneration !== mountGeneration}
          // Android scrolls a focused selectable text into view; selecting a message must not
          // move the timeline. Explicit turn/tail scrolling stays enabled.
          scrollsChildToFocus={false}
          onLayout={handleListLayout}
          onLoad={handleListLoad}
          keyExtractor={keyExtractor}
          renderItem={renderMessage}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={maintainVisiblePosition}
          viewabilityConfig={messageViewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          scrollEventThrottle={100}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          contentInsetAdjustmentBehavior="never"
          scrollIndicatorInsets={listIndicatorInsets}
          contentContainerStyle={listContentStyle}
          onContentSizeChange={handleContentSizeChange}
          {...listRefreshProps({ refreshing: view.refreshing, onRefresh: handleListRefresh, progressViewOffset: headerHeight })}
          ListHeaderComponent={view.hasMoreOlder ? <LoadMoreCapsule icon="chevrons-up" label={t("chat.loadOlder.short")} accessibilityLabel={t("chat.loadOlder")} loading={view.loadingOlder} onPress={() => void loadOlderTurns(sessionId)} /> : null}
          ListFooterComponent={<View>{view.hasMoreNewer ? <LoadMoreCapsule icon="chevrons-down" label={t("chat.loadNewer.short")} accessibilityLabel={t("chat.loadNewer")} loading={view.loadingNewer} onPress={() => void loadNewerTurns(sessionId)} /> : null}{messages.length === 0 ? <LiveReply sessionId={sessionId} showStream={liveStream} processInRow={false} availableWidth={listWidth || windowWidth} /> : null}</View>}
        /> : null}
        {threadPlaceholder ? <View pointerEvents="none" style={{ position: "absolute", top: headerHeight, right: 0, bottom: footerHeight, left: 0 }}><ChatThreadPlaceholder kind={threadPlaceholder} /></View> : null}

        {!followingTail ? <Pressable accessibilityRole="button" accessibilityLabel={t("chat.jumpLatest")} accessibilityState={{ busy: jumpingToLatest, disabled: jumpingToLatest }} disabled={jumpingToLatest} onPress={() => void jumpToLatest()} className="absolute right-4 z-4 size-11 items-center justify-center rounded-full shadow-float active:opacity-70" style={{ bottom: footerHeight + 12 }}><GlassBackground radius={22} />{jumpingToLatest ? <Loader /> : <AppIcon name="arrow-down" size={18} tone="accent" />}</Pressable> : null}
        {mentions.menu ? <SpaceMentionMenu menu={mentions.menu} onSelect={mentions.select} onDismiss={mentions.dismiss} style={{ position: "absolute", left: 12, right: 12, bottom: footerHeight + 4, zIndex: 5 }} /> : null}
        {slash.menu ? <SlashCommandMenu menu={slash.menu} onSelect={slash.select} onDismiss={slash.dismiss} style={{ position: "absolute", left: 12, right: 12, bottom: footerHeight + 4, zIndex: 6 }} /> : null}
        </View>
        <EdgeFooter onLayout={onFooterLayout}>
        {/* Outside the measured chrome: in the list footer it moved the followed tail twice per catch-up. */}
        {catchUpLoader && !view.hasMoreNewer && !liveStream ? <View pointerEvents="none" className="absolute left-0 right-0 bottom-full"><ListEdgeLoader label={t("chat.catchingUp")} /></View> : null}
        {queueItems.length > 0 ? <View className="px-3 pt-2 pb-1.5 gap-1.5">
          <Text className="text-micro font-semibold text-fg-muted">{t("chat.followups", { count: queueItems.length })}</Text>
          <ScrollView ref={queueScrollRef} style={{ maxHeight: 180, flexGrow: 0 }} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => { if (queueTransitionActive || queueItems.some((item) => item.turn === null)) queueScrollRef.current?.scrollToEnd({ animated: false }); }}>
            {queueItems.map((item) => {
              const turn = item.turn;
              const inFlight = transitionQueueItem?.key === item.key;
              return <QueuedFollowupRow key={item.key} preview={item.preview} pending={!turn || pendingFollowupAction === turn.id} hidden={inFlight} rowRef={inFlight ? sendQueueRef : undefined} onSteer={turn ? () => void runFollowupAction(turn.id, "steer") : undefined} onCancel={turn ? () => void runFollowupAction(turn.id, "cancel") : undefined} />;
            })}
          </ScrollView>
        </View> : null}
        {attachments.length > 0 ? <View className="px-3 pt-1 bg-background"><View ref={attachmentSourceRef} collapsable={false} style={{ maxHeight: 136 }}><ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 7 }} keyboardShouldPersistTaps="handled" onScroll={(event) => { attachmentScrollYRef.current = event.nativeEvent.contentOffset.y; }}>{attachments.map((attachment, index) => <AttachmentChip key={`${attachment.uri}-${index}`} name={attachment.name} uri={attachment.uri} mimeType={attachment.mimeType} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</ScrollView></View></View> : null}
        {voice.partial || voice.error ? <View className="bg-background px-4" style={{ paddingTop: 5 }}><Text className={`text-caption ${voice.error ? "text-danger" : "text-fg-muted"}`}>{voice.error ? voice.error : t("chat.listening", { text: voice.partial })}</Text></View> : null}
        <ComposerInput harnessSections={harnessMenuSections({ value: composerHarness, status: runtime.status, t, onSelect: setSelectedHarness, onRefresh: () => void runtime.refresh() })} anchorRef={composerRef} measurementRef={composerMeasurementRef} attachmentMenuOpen={attachmentMenuOpen} modelMenuOpen={modelSelectorOpen} showHarnessPicker={runtime.status?.kind === "local"} harness={composerHarness} harnessMenuOpen={harnessMenuOpen} onHarnessPress={() => { setModelSelectorOpen(false); setHarnessMenuOpen(true); void runtime.refresh(); }} sendFeedback={sendFeedback} value={mentions.displayValue} onChangeText={mentions.onChangeText} onSelectionChange={mentions.onSelectionChange} onFocusChange={handleComposerFocus} onSend={() => void submit()} onStop={() => void stopGeneration()} onAttach={() => { setModelSelectorOpen(false); setHarnessMenuOpen(false); setAttachmentMenuOpen(true); }} attachmentActions={[
          { icon: "camera", title: t("chat.attachment.camera"), onPress: () => void takePhoto() },
          { icon: "images", title: t("chat.attachment.photos"), onPress: () => void pickPhotos() },
          { icon: "paperclip", title: t("chat.attachment.file"), onPress: () => void pickAttachments() },
        ]} sending={view.sending} onVoice={() => voice.isRecording ? voice.stop() : void voice.start()} onModelPress={() => { setAttachmentMenuOpen(false); if (composerHarness === "cohub") void Promise.all([loadModels(), loadModelStatus()]).catch(() => undefined); else void runtime.refresh(); setModelSelectorOpen(true); }} modelLabel={modelTriggerLabel} modelStatus={activeStatus} voiceActive={voice.isRecording} voiceStarting={voice.isStarting} disabled={view.loading || stopping} running={running} hasAttachment={attachments.length > 0} placeholder={running ? t("ui.composer.working") : t("ui.composer.placeholder")} />
        </EdgeFooter>
        {sendTransition && transitionMessage && (sendTransition.destination === "bubble" || transitionQueueItem) ? <SendBubbleOverlay key={sendTransition.message.id} transition={sendTransition} message={transitionMessage} queueItem={transitionQueueItem} rootRef={sendRootRef} targetRef={queueTransitionActive ? sendQueueRef : sendBubbleRef} availableWidth={listWidth || windowWidth} spaceId={spaceId || null} onComplete={completeSendTransition} /> : null}
        {labelSheetOpen && client && session && spaceId ? <SessionLabelSheet client={client} spaceId={spaceId} session={session} labels={chatLabels} labelsError={null} onLabelsReload={() => { if (client && spaceId) void fetchSessionLabels(client, spaceId).then((tree) => setChatLabels(toUserSessionLabels(tree))).catch(() => undefined); }} onClose={() => setLabelSheetOpen(false)} onChanged={() => undefined} /> : null}
        {attachmentMenuOpen ? <AttachmentMenu anchorRef={composerRef} onClose={() => setAttachmentMenuOpen(false)} onCamera={() => void takePhoto()} onPhotos={() => void pickPhotos()} onFile={() => void pickAttachments()} /> : null}
        <TurnNavigatorSheet visible={turnNavigatorOpen} turns={view.turnIndex} currentSequence={currentTurnSequence} loading={view.turnIndexLoading} loadingSequence={loadingSequence} onClose={() => setTurnNavigatorOpen(false)} onJump={(sequence) => handleTurnJump(sequence)} onRetry={() => void loadTurnIndex(sessionId, { force: true }).catch(() => undefined)} />
        {runtime.status?.kind === "local" ? <HarnessPicker anchorRef={composerRef} value={composerHarness} status={runtime.status} open={harnessMenuOpen} onClose={() => setHarnessMenuOpen(false)} onRefresh={() => void runtime.refresh()} onSelect={(harness) => { setSelectedHarness(harness); setHarnessMenuOpen(false); }} /> : null}
        {modelSelectorOpen ? composerHarness === "cohub" ? <ModelSelectorMenu anchorRef={composerRef} models={models} loading={modelsLoading} error={modelsError || modelStatusError} modelStatus={modelStatus?.models ?? null} modelStatusLoading={modelStatusLoading} currentModel={modelOverride ? selectedModel : recordedModel} onClose={() => setModelSelectorOpen(false)} onRetry={() => void Promise.all([loadModels({ force: true }), loadModelStatus({ force: true })]).catch(() => undefined)} onSelect={(model) => { setSelectedModel(model); setModelOverride(true); setModelSelectorOpen(false); }} /> : <ModelSelectorMenu anchorRef={composerRef} title={t("model.runtimeTitle", { harness: harnessLabel(composerHarness) })} automaticLabel={t("model.runtimeAutomatic")} automaticDetail={t("model.runtimeAutomaticDetail")} models={runtimeCatalogModels(runtime.status, composerHarness)} loading={runtime.loading} error={runtime.error} currentModel={activeModel} onClose={() => setModelSelectorOpen(false)} onRetry={() => void runtime.refresh()} onSelect={(model) => { setLocalModelsByHarness((current) => ({ ...current, [composerHarness]: model })); setModelSelectorOpen(false); }} /> : null}
        <NoticeSheet notice={notice} fallbackTitle={t("common.notice")} onClose={() => setNotice(null)} testID="chat-notice-sheet" />
        <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}><View className="flex-1 justify-center p-6" style={SCRIM}><View className="gap-4 rounded-lg bg-surface p-5" style={{ borderCurve: "continuous" }}><Text className="text-headline font-semibold text-fg">{t("chat.rename.title")}</Text><TextInput autoFocus value={renameValue} onChangeText={setRenameValue} maxLength={RENAME_MAX_LENGTH} placeholder={t("chat.rename.placeholder")} placeholderTextColor={theme.colors.textFaint} className={FIELD_INPUT_CLASS} /><View className="flex-row justify-end gap-2"><PrimaryButton variant="ghost" label={t("common.cancel")} onPress={() => setRenameOpen(false)} /><PrimaryButton label={t("common.save")} onPress={() => void saveRename()} /></View></View></View></Modal>
      </Animated.View>
    </SpacePanels>
    </View>
    {titleMenuOpen ? <AnchoredActionMenu
      anchorRef={titleRef}
      title={session ? displaySessionTitle(session) : t("chat.title")}
      testID="chat-title-actions-menu"
      onClose={closeTitleMenu}
      actions={titleActions}
    /> : null}
    {moreOpen ? <AnchoredActionMenu
      anchorRef={moreButtonRef}
      title={session ? displaySessionTitle(session) : t("chat.title")}
      testID="chat-actions-menu"
      onClose={closeMore}
      actions={chatActions}
    /> : null}
  </Screen>;
}

/**
 * Live step list for an active turn. Subscribing to the stream here instead of inside
 * `renderItem` keeps the row list's callback identity stable, so stream batches stop
 * re-rendering every mounted cell. The fallback matches the persisted turn process.
 */
function LiveTurnProcess({ sessionId, turn, client, spaceId }: { sessionId: string; turn: SessionTurnRecord; client: CohubClient | null; spaceId: string }) {
  const { state } = useApp();
  const stream = state.sessionViews[sessionId]?.stream ?? null;
  const thinking = thinkingBlocks(stream?.contentBlocks);
  if (stream?.turnId === turn.id && (stream.intermediateMessages.length > 0 || thinking.length > 0)) return <StreamingTurnProcess messages={stream.intermediateMessages} thinking={thinking} />;
  return <TurnProcess turn={turn} client={client} spaceId={spaceId} />;
}

function LiveReply({ sessionId, showStream, processInRow, availableWidth }: { sessionId: string; showStream: boolean; processInRow: boolean; availableWidth: number }) {
  const { state } = useApp();
  const view = state.sessionViews[sessionId];
  const stream = view?.stream;
  if (showStream && stream) return <View testID="chat-live-reply">
    {!processInRow ? <StreamingTurnProcess messages={stream.intermediateMessages} thinking={thinkingBlocks(stream.contentBlocks)} /> : null}
    <StreamCard content={stream.contentBlocks} status={stream.status} runtimePhase={stream.runtimePhase} runtimeModel={stream.runtimeModel} availableWidth={availableWidth} />
  </View>;
  return view?.sending && !view.messages.some(isOptimisticFollowup) ? <StreamCard content={[]} status="pending" availableWidth={availableWidth} /> : null;
}

function ChatThreadPlaceholder({ kind }: { kind: "opening" | "empty" }) {
  const { t } = useTranslation();
  if (kind === "opening") return <LoadingState label={t("chat.placeholder.opening")} />;
  return (
    <View className="flex-1 items-center justify-center p-7">
      <View className="size-14 items-center justify-center rounded-full bg-accent-soft">
        <AppIcon name="sparkles" size={23} tone="accent" />
      </View>
      <Text className="text-headline font-semibold text-fg mt-4 text-center">{t("chat.placeholder.empty.title")}</Text>
      <Text className="text-body text-fg-muted text-center mt-1.5 max-w-72">{t("chat.placeholder.empty.body")}</Text>
    </View>
  );
}

function DraftChatContent({ spaceId, onCreated }: { spaceId: string; onCreated: (created: { session: SessionRecord; transition: SendBubbleTransition | null }) => void }) {
  useSpaceRealtime([spaceId]);
  const router = useRouter();
  const { t } = useTranslation();
  const showToast = useToast();
  const { state, client, connectionUnavailable, sendNewMessage, getAccessToken, loadModels, loadModelStatus, models, modelsLoading, modelsError, modelStatus, modelStatusLoading, modelStatusError, loadComposerDraft, saveComposerDraft, clearComposerDraft } = useApp();
  const runtime = useSpaceRuntime(spaceId);
  const space = state.spaces.find((item) => item.id === spaceId) ?? null;
  const { headerHeight, onHeaderLayout } = useEdgeChrome();
  const composerRef = useRef<View>(null);
  const composerMeasurementRef = useRef<ComposerInputMeasurement>({ input: null, scrollY: 0 });
  const sendRootRef = useRef<View>(null);
  const attachmentSourceRef = useRef<View>(null);
  const attachmentScrollYRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const [input, setInput] = useState("");
  const inputRef = useRef("");
  const inputEditedRef = useRef(false);
  const draftLoadedRef = useRef(false);
  const updateInput = useCallback((next: string) => {
    inputEditedRef.current = true;
    inputRef.current = next;
    setInput(next);
  }, []);
  const mentions = useComposerMentions({ value: input, onChange: updateInput, currentSpaceId: spaceId, composer: composerMeasurementRef });
  const slash = useComposerSlashCommands({ value: input, onChange: updateInput, spaceId, composer: composerMeasurementRef });
  const { onFocusChange: onMentionsFocusChange } = mentions;
  const { onFocusChange: onSlashFocusChange } = slash;
  // The hooks' focus setters are stable, so this handler is too.
  const handleComposerFocus = useCallback((focused: boolean) => {
    onMentionsFocusChange(focused);
    onSlashFocusChange(focused);
  }, [onMentionsFocusChange, onSlashFocusChange]);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  useEffect(() => {
    let active = true;
    inputEditedRef.current = false;
    draftLoadedRef.current = false;
    inputRef.current = "";
    void loadComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE)
      .then((draft) => {
        if (!active) return;
        draftLoadedRef.current = true;
        if (inputEditedRef.current) {
          void saveComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE, inputRef.current).catch(() => undefined);
          return;
        }
        inputRef.current = draft;
        setInput(draft);
      })
      .catch(() => {
        if (active) draftLoadedRef.current = true;
      });
    return () => { active = false; };
  }, [loadComposerDraft, saveComposerDraft, spaceId]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timer = setTimeout(() => {
      void saveComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE, input).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [input, saveComposerDraft, spaceId]);
  useEffect(() => () => {
    if (draftLoadedRef.current) void saveComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE, inputRef.current).catch(() => undefined);
  }, [saveComposerDraft, spaceId]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [harnessMenuOpen, setHarnessMenuOpen] = useState(false);
  const [selectedHarness, setSelectedHarness] = useState<RuntimeHarness>("cohub");
  const [localModelsByHarness, setLocalModelsByHarness] = useState<Partial<Record<LocalHarness, ChatModelSelection | null>>>({});
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection | null>(null);
  const [activePanel, setActivePanel] = useState<SpacePanel | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const appendVoiceText = useCallback((text: string) => {
    const current = inputRef.current.trim();
    updateInput(current ? `${current} ${text}` : text);
  }, [updateInput]);
  const voice = useNativeVoiceInput({ getAccessToken, onFinal: appendVoiceText });
  const appendAttachments = (next: AttachmentDraft[]) => setAttachments((current) => [...current, ...next].slice(0, 6));
  const pickAttachments = async () => { setAttachmentMenuOpen(false); try { const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true }); if (result.canceled) return; appendAttachments(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/octet-stream", size: asset.size ?? 0 }))); } catch (error) { showToast({ title: t("chat.attachmentUnavailable.title"), message: error instanceof Error ? error.message : t("chat.attachmentUnavailable.body"), tone: "danger" }); } };
  const pickPhotos = async () => { setAttachmentMenuOpen(false); try { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) { showToast({ title: t("chat.photoOff.title"), message: t("chat.photoOff.body"), tone: "danger" }); return; } const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.88 }); if (result.canceled) return; appendAttachments(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName || `image-${index + 1}.jpg`, mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 }))); } catch (error) { showToast({ title: t("chat.photoPickerUnavailable.title"), message: error instanceof Error ? error.message : t("chat.photoPickerUnavailable.body"), tone: "danger" }); } };
  const takePhoto = async () => { setAttachmentMenuOpen(false); try { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { showToast({ title: t("chat.cameraOff.title"), message: t("chat.cameraOff.body"), tone: "danger" }); return; } const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.88 }); if (result.canceled) return; const asset = result.assets[0]; if (asset) appendAttachments([{ uri: asset.uri, name: asset.fileName || "camera-photo.jpg", mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 }]); } catch (error) { showToast({ title: t("chat.cameraUnavailable.title"), message: error instanceof Error ? error.message : t("chat.cameraUnavailable.body"), tone: "danger" }); } };
  const submit = async () => {
    if (!space || sending || (!input.trim() && attachments.length === 0)) return;
    const text = input;
    const files = attachments;
    setSending(true);
    try {
      if (!canUseRuntimeHarness(runtime.status, selectedHarness)) {
        showToast({ title: t("runtime.unavailable.title"), message: t("runtime.unavailable.body"), tone: "danger" });
        return;
      }
      const { input: field, scrollY } = composerMeasurementRef.current;
      const source = reducedMotion
        ? null
        : await measureSendBubbleSource(
            files.length > 0 ? attachmentSourceRef.current : field,
            sendRootRef.current,
            files.length > 0 ? attachmentScrollYRef.current : scrollY,
          );
      inputRef.current = "";
      setInput("");
      setAttachments([]);
      void clearComposerDraft(space.id, NEW_COMPOSER_DRAFT_SCOPE).catch(() => undefined);
      const requestModel = selectedHarness === "cohub" ? selectedModel : localModelsByHarness[selectedHarness] ?? null;
      const result = await sendNewMessage(space.id, text, files, { model: requestModel, harness: selectedHarness });
      onCreated({
        session: result.session,
        transition: source ? { message: result.message, text, source, attachments: files, destination: "bubble" } : null,
      });
    } catch (error) {
      updateInput(text);
      setAttachments(files);
      showToast({ title: t("chat.startFailed.title"), message: error instanceof Error ? error.message : t("chat.startFailed.body"), tone: "danger" });
    } finally {
      setSending(false);
    }
  };
  if (!space) return <Screen><TopBar title={t("chat.spaceUnavailable")} onBack={() => router.back()} /><View className="flex-1 items-center justify-center p-6"><Text className="text-body text-fg-muted text-center">{t("chat.spaceUnavailable.body")}</Text></View></Screen>;
  const spaceName = displaySpaceName(space);
  const spaceSessions = state.sessions.filter((item) => item.spaceId === space.id);
  const activeModel = selectedHarness === "cohub" ? selectedModel : localModelsByHarness[selectedHarness] ?? null;
  const modelLabel = activeModel?.name || activeModel?.id || (selectedHarness === "cohub" ? t("chat.model.automatic") : t("model.runtimeAutomatic"));
  const modelTriggerLabel = activeModel?.thinkingLevel ? `${modelLabel} · ${formatThinkingLevel(activeModel.thinkingLevel)}` : modelLabel;
  const selectedStatus = selectedHarness === "cohub" && activeModel ? modelAvailabilityLevel(modelStatus?.models[activeModel.id]) : "unknown";
  return <Screen keyboard edgeToEdge>
    <SpacePanels edgeToEdge key={space.id} spaceId={space.id} spaceName={spaceName} sessions={spaceSessions} client={client} activePanel={activePanel} onActivePanelChange={setActivePanel} onOpenSession={(nextSessionId, target) => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: nextSessionId, ...(target?.turn != null ? { turn: String(target.turn) } : {}), ...(target?.turnId ? { turnId: target.turnId } : {}) } })} onNewChat={() => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId: space.id } })} onOpenFile={(path) => router.push({ pathname: "/space/[spaceId]/file", params: { spaceId: space.id, path } })} onOpenFilesPage={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId: space.id } })}>
      <View ref={sendRootRef} collapsable={false} className="flex-1 min-h-0">
        <EdgeHeader onLayout={onHeaderLayout}>
        <TopBar transparent title={spaceName} onBack={() => router.back()} actions={<><IconButton name="messages" label={t("chat.actions.openChats")} size={38} onPress={() => setActivePanel("chat")} /><IconButton name="folder-open" label={t("chat.actions.openFiles")} size={38} onPress={() => setActivePanel("files")} /></>} />
        <ConnectionBanner visible={connectionUnavailable} />
        </EdgeHeader>
        <View style={{ flex: 1, minHeight: 0, paddingTop: headerHeight }}>
          <View className="flex-1 min-h-0 items-center justify-center px-7 pb-4">
            <View className="size-14 items-center justify-center rounded-full bg-accent-soft"><AppIcon name="sparkles" size={24} tone="accent" /></View>
            <Text className="mt-4 text-center text-headline font-semibold text-fg">{t("chat.draft.title")}</Text>
            <Text className="text-body text-fg-muted mt-1.5 max-w-72 text-center">{t("chat.draft.body")}</Text>
            <Text className="text-caption text-fg-faint mt-4">{t("chat.draft.subtitle")}</Text>
          </View>
          {mentions.menu ? <SpaceMentionMenu menu={mentions.menu} onSelect={mentions.select} onDismiss={mentions.dismiss} style={{ marginHorizontal: 12, marginBottom: 6 }} /> : null}
          {slash.menu ? <SlashCommandMenu menu={slash.menu} onSelect={slash.select} onDismiss={slash.dismiss} style={{ marginHorizontal: 12, marginBottom: 6 }} /> : null}
          {attachments.length > 0 ? <View ref={attachmentSourceRef} collapsable={false} className="bg-background px-3 pt-1" style={{ gap: 7 }}>{attachments.map((attachment, index) => <AttachmentChip key={`${attachment.uri}-${index}`} name={attachment.name} uri={attachment.uri} mimeType={attachment.mimeType} onRemove={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</View> : null}
          {voice.partial || voice.error ? <View className="bg-background px-4" style={{ paddingTop: 5 }}><Text className={`text-caption ${voice.error ? "text-danger" : "text-fg-muted"}`}>{voice.error ? voice.error : t("chat.listening", { text: voice.partial })}</Text></View> : null}
          <ComposerInput harnessSections={harnessMenuSections({ value: selectedHarness, status: runtime.status, t, onSelect: setSelectedHarness, onRefresh: () => void runtime.refresh() })} anchorRef={composerRef} measurementRef={composerMeasurementRef} attachmentMenuOpen={attachmentMenuOpen} modelMenuOpen={modelSelectorOpen} showHarnessPicker={runtime.status?.kind === "local"} harness={selectedHarness} harnessMenuOpen={harnessMenuOpen} onHarnessPress={() => { setModelSelectorOpen(false); setHarnessMenuOpen(true); void runtime.refresh(); }} value={mentions.displayValue} onChangeText={mentions.onChangeText} onSelectionChange={mentions.onSelectionChange} onFocusChange={handleComposerFocus} onSend={() => void submit()} onAttach={() => { setModelSelectorOpen(false); setHarnessMenuOpen(false); setAttachmentMenuOpen(true); }} attachmentActions={[
          { icon: "camera", title: t("chat.attachment.camera"), onPress: () => void takePhoto() },
          { icon: "images", title: t("chat.attachment.photos"), onPress: () => void pickPhotos() },
          { icon: "paperclip", title: t("chat.attachment.file"), onPress: () => void pickAttachments() },
        ]} sending={sending} onVoice={() => voice.isRecording ? voice.stop() : void voice.start()} onModelPress={() => { setAttachmentMenuOpen(false); if (selectedHarness === "cohub") void Promise.all([loadModels(), loadModelStatus()]).catch(() => undefined); else void runtime.refresh(); setModelSelectorOpen(true); }} modelLabel={modelTriggerLabel} modelStatus={selectedStatus} voiceActive={voice.isRecording} voiceStarting={voice.isStarting} disabled={sending} hasAttachment={attachments.length > 0} placeholder={sending ? t("chat.draft.starting") : t("ui.composer.placeholder")} />
        </View>
        {runtime.status?.kind === "local" ? <HarnessPicker anchorRef={composerRef} value={selectedHarness} status={runtime.status} open={harnessMenuOpen} onClose={() => setHarnessMenuOpen(false)} onRefresh={() => void runtime.refresh()} onSelect={(harness) => { setSelectedHarness(harness); setHarnessMenuOpen(false); }} /> : null}
        {modelSelectorOpen ? selectedHarness === "cohub" ? <ModelSelectorMenu anchorRef={composerRef} models={models} loading={modelsLoading} error={modelsError || modelStatusError} modelStatus={modelStatus?.models ?? null} modelStatusLoading={modelStatusLoading} currentModel={selectedModel} onClose={() => setModelSelectorOpen(false)} onRetry={() => void Promise.all([loadModels({ force: true }), loadModelStatus({ force: true })]).catch(() => undefined)} onSelect={(model) => { setSelectedModel(model); setModelSelectorOpen(false); }} /> : <ModelSelectorMenu anchorRef={composerRef} title={t("model.runtimeTitle", { harness: harnessLabel(selectedHarness) })} automaticLabel={t("model.runtimeAutomatic")} automaticDetail={t("model.runtimeAutomaticDetail")} models={runtimeCatalogModels(runtime.status, selectedHarness)} loading={runtime.loading} error={runtime.error} currentModel={activeModel} onClose={() => setModelSelectorOpen(false)} onRetry={() => void runtime.refresh()} onSelect={(model) => { setLocalModelsByHarness((current) => ({ ...current, [selectedHarness]: model })); setModelSelectorOpen(false); }} /> : null}
        {attachmentMenuOpen ? <AttachmentMenu anchorRef={composerRef} onClose={() => setAttachmentMenuOpen(false)} onCamera={() => void takePhoto()} onPhotos={() => void pickPhotos()} onFile={() => void pickAttachments()} /> : null}
        <NoticeSheet notice={notice} fallbackTitle={t("common.notice")} onClose={() => setNotice(null)} testID="new-chat-notice-sheet" />
      </View>
    </SpacePanels>
  </Screen>;
}

function runtimeCatalogModels(status: SpaceRuntimeStatus | null, harness: RuntimeHarness): ModelCatalogEntry[] {
  return localModelsForHarness(status, harness).map(({ provider, id, ...model }) => ({ provider, id, model } as ModelCatalogEntry));
}

function recordedRuntimeModel(turn: { provider?: string | null; model?: string | null; meta?: unknown }, harness: RuntimeHarness): ChatModelSelection {
  const thinkingLevel = requestedThinkingLevel(turn.meta);
  return { provider: turn.provider ?? harness, id: turn.model!, ...(thinkingLevel ? { thinkingLevel } : {}) };
}

function MissingChat() {
  const router = useRouter();
  const { t } = useTranslation();
  return <Screen><TopBar title={t("chat.title")} onBack={() => router.back()} /><View className="flex-1 items-center justify-center"><Text className="text-body text-fg-muted">{t("chat.missing")}</Text></View></Screen>;
}

/** Pagination control at either end of the thread: a short centered capsule, the full action spoken. */
function LoadMoreCapsule({ icon, label, accessibilityLabel, loading, onPress }: { icon: IconName; label: string; accessibilityLabel: string; loading: boolean; onPress: () => void }) {
  return <View className="items-center py-2">
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ busy: loading, disabled: loading }} disabled={loading} onPress={onPress} hitSlop={4} className="min-h-10 flex-row items-center gap-1.5 rounded-full bg-surface-raised px-4 active:bg-surface-pressed">
      {loading ? <Loader /> : <AppIcon name={icon} size={16} tone="accent" />}
      <Text className="text-caption font-semibold text-accent">{label}</Text>
    </Pressable>
  </View>;
}

// design-system: modal scrims dim whatever theme sits underneath, so they stay black.
const SCRIM = { backgroundColor: "rgba(0,0,0,0.6)" } as const;
