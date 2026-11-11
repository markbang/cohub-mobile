import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { haptics } from "@/src/platform/haptics";
import { clearForegroundSession, setForegroundSession } from "@/src/platform/notifications";
import { useFocusEffect, useLocalSearchParams, useNavigation, useNavigationContainerRef, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Dimensions, KeyboardAvoidingView as RNKeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent, type ViewToken } from "react-native";
import Animated, { cubicBezier, Easing, FadeIn, FadeOut, ReduceMotion, useAnimatedRef, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { curves, motion } from "@/src/motion";
import type { LegendListRef } from "@legendapp/list/react-native";
import { KeyboardAwareLegendList } from "@legendapp/list/keyboard";
import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";
import { AnchoredActionMenu, type AnchoredMenuAction, type AnchoredMenuSection } from "@/src/components/AnchoredActionMenu";
import { NativeMenuButton, nativeMenus } from "@/src/components/NativeMenu";
import { NoticeSheet } from "@/src/components/SystemDialogs";
import { ToastViewport, useToast } from "@/src/components/Toast";
import { copyMessageText, MessageBubble, StreamCard } from "@/src/components/MessageContent";
import { SendBubbleOverlay } from "@/src/components/SendBubbleOverlay";
import { QueuedFollowupRow } from "@/src/components/QueuedFollowupRow";
import { createSendFlight, isSendBubbleMessage, measureSendBubbleSource, type SendBubbleTransition } from "@/src/ui/send-bubble-motion";
import { StreamingTurnProcess, TurnProcess } from "@/src/components/TurnProcess";
import { ForkedFromDivider, SentFromLink, SentToList } from "@/src/components/RelatedSessionLinks";
import { latestMessageId } from "@/src/data/chat-read-state";
import { forkPoint } from "@/src/data/session-fork";
import type { RelatedSessionRef } from "@/src/data/related-sessions";
import { ModelSelectorMenu } from "@/src/components/ModelSelectorMenu";
import { HarnessPicker, harnessMenuSections } from "@/src/components/ExecutionHarnessMenu";
import { AttachmentMenu } from "@/src/components/AttachmentMenu";
import { MenuAnchor, MenuPresence } from "@/src/ui/MorphMenuSurface";
import { SpaceMentionMenu } from "@/src/components/SpaceMentionMenu";
import { SlashCommandMenu } from "@/src/components/SlashCommandMenu";
import { SessionLabelSheet } from "@/src/components/SessionLabelSheet";
import { fetchSessionLabels, toUserSessionLabels, type SessionLabel } from "@/src/data/session-labels";
import { TurnNavigatorSheet } from "@/src/components/TurnNavigatorSheet";
import { SpacePanels, type SpacePanel } from "@/src/components/SpacePanels";
import { shallowEqual, useAppActions, useAppSelector, useAppStateGetter, useModelCatalog, useSession, useSessionStream } from "@/src/data/context";
import { useScreenQuery, useSyncQuery } from "@/src/data/query";
import { useQuery } from "@tanstack/react-query";
import { sessionListStatus } from "@/src/data/session-status";
import type { ComposerDraftScope } from "@/src/data/local-db";
import { createNewChatDraft } from "@/src/data/new-chat-draft";
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
import type { UploadTarget } from "@/src/data/attachment-uploads";
import { useAttachmentUploadState } from "@/src/data/use-attachment-upload";
import { approvalModeFromTurns, approvalModesFor, canUseRuntimeHarness, fastServiceTier, FAST_SERVICE_TIER, localModelsForHarness, runtimeHarnessFromTurn, runtimeModelFor, supportsFast, type RuntimeHarness, type SpaceRuntimeStatus } from "@/src/data/runtime";
import type { LocalExecution } from "@/src/data/context";
import type { LocalExecutionMenu } from "@/src/components/ExecutionHarnessMenu";
import { SessionApprovals } from "@/src/components/SessionApprovals";
import { useSpaceRuntime } from "@/src/data/use-space-runtime";
import { harnessLabel, HttpError, isAgentTurn, type ApprovalMode, resolveWebBaseUrl, type SpaceRecord, type CohubClient, type LocalHarness, type MessageRecord, type ModelCatalogEntry, type SessionRecord, type SessionTurnRecord } from "@neta-art/cohub";
import { appendVoiceText as appendDictation } from "@/src/data/voice-append";
import { chatThreadPlaceholder, failedSendDraft, failedSendMessage, isFailedSend, isSubmittingSend, mergeDisplayMessages, messageIndexForTurn, messageRowKey, messagesFromTurns, messagesInWindow, turnSequenceForMessage, withTurnSequences } from "@/src/data/session-history";
import { useAppTheme, typography } from "@/src/theme";
import { config } from "@/src/config";
import { useTranslation } from "@/src/i18n";
import { formatThinkingLevel, modelAvailabilityLevel, requestedThinkingLevel } from "@/src/model-catalog";
import { useNativeVoiceInput } from "@/src/platform/native-voice-input";
import { GlassBackdrop, GlassBackground } from "@/src/ui/Glass";
import { AppIcon, AttachmentChip, ComposerInput, ConnectionBanner, DataError, FIELD_INPUT_CLASS, TopBar, IconButton, ListEdgeLoader, Loader, LoadingState, PrimaryButton, Screen, type ComposerInputMeasurement, type IconName, Mascot } from "@/src/ui";
import { displaySessionTitle, displaySpaceName, hasRenderableMessage, isAssistantIntermediate } from "@/src/utils";
import { BrandRefreshArea, useBrandRefresh } from "@/src/ui/BrandRefresh";
import { EdgeBlurTarget, EdgeFooter, EdgeFooterOverlay, EdgeHeader, KeyboardLiftPadding, ScreenBlurTarget, useBlurTarget, useEdgeChrome, useKeyboardCoveredInset } from "@/src/ui/EdgeChrome";
import { NativeChatTimeline, type NativeChatTimelineHandle, type VisibleMessage } from "@/src/components/timeline/NativeChatTimeline";
import { BotNoteBubble, BotTimeDivider, BotTyping } from "@/src/components/BotBubbles";
import { BotTitle } from "@/src/components/BotTitle";
import { BOT_BUBBLE_INSET, botMessageSpace, botPlacements, botSender, isBotSpace, latestBotNote, relayFailedMessage, type BotPeer } from "@/src/data/bot-mode";
import { useBotMode } from "@/src/data/bot-mode-preference";
import { useBotModel } from "@/src/data/bot-model";
import { loadBotReminder, relayToBot } from "@/src/data/bot-relay";
import { botFileQuery } from "@/src/data/use-bots";
import { saveBotFileCache } from "@/src/data/local-db";
import { RenderErrorBoundary, RenderFailureView } from "@/src/components/RenderErrorBoundary";
import { nativeChatTimeline } from "@/src/platform/chat-timeline";
import { withForegroundHandoff } from "@/src/platform/app-lifecycle";
import { previewLocalFile } from "@/src/platform/file-preview";
import { takeIncomingShare } from "@/src/platform/incoming-share";
import { usePaneWidth } from "@/src/ui/pane";

type RouteParams = { sessionId?: string | string[]; spaceId?: string | string[]; turn?: string | string[]; turnId?: string | string[]; shared?: string | string[]; log?: string | string[] };
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
// Rows that open above the composer rise out from behind it, so the footer reads as growing rather than
// a block popping in. Reduce Motion is honored by the layout animation itself.
const FOOTER_ROW_IN = { duration: motion.fade.duration, easing: Easing.bezier(...curves.easeOut), reduceMotion: ReduceMotion.System };
function footerRowEntering() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
    animations: { opacity: withTiming(1, FOOTER_ROW_IN), transform: [{ translateY: withTiming(0, FOOTER_ROW_IN) }] },
  };
}
const TURN_START_STYLE = { paddingTop: 8 } as const;
const ABOVE_FOOTER_BUTTON = { bottom: "100%", marginBottom: 12 } as const;
const FOOTER_MENU = { marginHorizontal: 12, marginBottom: 4 } as const;
const NO_SPACES: readonly SpaceRecord[] = [];

// Decided once per mount: removing the CSS animation mid-fade leaves the row at its partial opacity.
function ArrivalRow({ arrival, reducedMotion, children }: { arrival: boolean; reducedMotion: boolean; children: ReactNode }) {
  const [animated] = useState(arrival);
  return <Animated.View style={animated ? (reducedMotion ? ARRIVAL_STYLE_REDUCED : ARRIVAL_STYLE) : undefined}>{children}</Animated.View>;
}

const RENAME_MAX_LENGTH = 80;
const MAX_ATTACHMENTS = 6;
const ATTACHMENT_LIST_MAX_HEIGHT = 136;

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
  // A new Chat stays on this one surface after the server creates it: same component, no remount,
  // no Stack transition. The route only learns the id for deep links and restoration.
  const [draft] = useState(() => sessionId === "new" && spaceId ? { spaceId, fromShare: (Array.isArray(params.shared) ? params.shared[0] : params.shared) === "1" } : null);
  const onCreated = useCallback((id: string) => router.setParams({ sessionId: id }), [router]);
  if (!sessionId) return <MissingChat />;
  if (draft) return <ChatContent sessionId={sessionId === "new" ? null : sessionId} draft={draft} onCreated={onCreated} initialTurnSequence={null} initialTurnId={null} />;
  if (sessionId === "new") return <MissingChat />;
  return <ChatContent key={sessionId} sessionId={sessionId} initialTurnSequence={initialTurnSequence} initialTurnId={initialTurnId} workLog={(Array.isArray(params.log) ? params.log[0] : params.log) === "1"} />;
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

type ChatDraft = { spaceId: string; fromShare: boolean };

type ScrollGesture = "idle" | "dragging" | "momentum";

type ChatOverlay = "attachments" | "rename" | "more" | "titleMenu" | "labels" | "model" | "harness" | "turns";

type NewChatStart = { pending: MessageRecord | null } | { sessionId: string };

/**
 * One Chat surface. With `draft` it starts as a new Chat in that Space: the first send shows its
 * bubble here at once, and when the server creates the Chat this same component carries on with it.
 */
function ChatContent({ sessionId: routeSessionId, draft = null, onCreated, initialTurnSequence, initialTurnId, workLog = false }: { sessionId: string | null; draft?: ChatDraft | null; onCreated?: (sessionId: string) => void; initialTurnSequence: number | null; initialTurnId: string | null; /** A Bot's working Chat opened from its profile, shown as an ordinary Chat. */ workLog?: boolean }) {
  // A new Chat's first message (sending, or failed with retry) is held until the server creates it.
  const [newChat, setNewChat] = useState<NewChatStart>({ pending: null });
  const createdSessionId = "sessionId" in newChat ? newChat.sessionId : null;
  // "" until a new Chat exists; every session-scoped effect below is a no-op for it.
  const sessionId = routeSessionId ?? createdSessionId ?? "";
  const pendingNew = "pending" in newChat ? newChat.pending : null;
  // A late answer must not set the route params of whatever screen is focused after this one closed.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const router = useRouter();
  const rootNavigation = useNavigationContainerRef();
  const traceBackPress = useBackPressTrace("chat", rootNavigation);
  const theme = useAppTheme();
  const { t } = useTranslation();
  const showToast = useToast();
  const { client, userUuid, userKey, refreshHome, sendMessage, sendNewMessage, upsertSpace, discardFailedSend, abortSession, refreshSession, loadOlderTurns, loadNewerTurns, loadTurnIndex, jumpToTurn, loadLatestTurns, renameSession, setSessionArchived, forkSession, getAccessToken, loadModels, loadModelStatus, loadSessionReadSequence, saveSessionReadSequence, markSessionSeen, loadComposerDraft, saveComposerDraft, clearComposerDraft, refreshSessionStatuses } = useAppActions();
  // Each subscription is scoped to this Chat; token batches reach only LiveReply and LiveTurnProcess.
  const { models, modelsLoading, modelsError, modelStatus, modelStatusLoading, modelStatusError } = useModelCatalog();
  const connectionUnavailable = useAppSelector((app) => app.connectionUnavailable);
  const latestTurnStatus = useAppSelector((app) => app.state.sessionLatestTurns[sessionId]?.status);
  const parentSessionId = useAppSelector((app) => app.state.sessionForks[sessionId]?.parentSessionId ?? null);
  const getAppState = useAppStateGetter();
  const sessionSummary = useAppSelector((app) => app.state.sessions.find((item) => item.id === sessionId) ?? null);
  const botModeEnabled = useBotMode(userUuid).enabled;
  // A Bot's page is its user Chat, which can be read as a note delta before the detail request returns.
  const earlySpaceId = draft?.spaceId ?? sessionSummary?.spaceId ?? "";
  const earlySpaceSlug = useAppSelector((app) => (earlySpaceId ? app.state.spaces.find((item) => item.id === earlySpaceId)?.slug : undefined));
  const deltaNotes = !workLog && isBotSpace({ slug: earlySpaceSlug ?? sessionSummary?.space?.slug });
  const botSpaceEarly = botModeEnabled && deltaNotes;
  const view = useSession(sessionId, { notesOnly: deltaNotes });
  const session = view.session ?? sessionSummary;
  const spaceId = draft?.spaceId ?? view.space?.id ?? session?.spaceId ?? sessionSummary?.spaceId ?? "";
  const listedSpace = useAppSelector((app) => (draft ? app.state.spaces.find((item) => item.id === draft.spaceId) ?? null : null));
  // A cold start can open a new Chat before the Space list arrives. Only the server saying it is gone or
  // off-limits means unavailable; an offline or failed request can be retried.
  const spaceLookup = useScreenQuery({
    queryKey: [`space:${spaceId}:detail`],
    queryFn: async (): Promise<SpaceRecord> => {
      const remote = await client!.spaces.get(spaceId);
      upsertSpace(remote);
      return remote;
    },
    enabled: Boolean(draft) && listedSpace === null && Boolean(client && spaceId),
    retry: 0,
  });
  const draftSpace = draft ? listedSpace ?? spaceLookup.data ?? null : null;
  const runtime = useSpaceRuntime(spaceId, !botSpaceEarly);
  useSyncQuery(`chat:${sessionId}:tail`, () => refreshSession(sessionId, { silent: true, throwOnError: true, notesOnly: deltaNotes }), 60_000, view.historyLoaded && !view.hasMoreNewer && !view.stream);
  const { headerHeight, footerHeight, onHeaderLayout, onFooterLayout, blurTarget, attachBlurTarget } = useEdgeChrome({ reserveComposer: true });
  const { blurTarget: screenBlurTarget, attachBlurTarget: attachScreenBlurTarget } = useBlurTarget();
  const composerRef = useRef<View>(null);
  const composerMenuSourceRef = useRef<View>(null);
  const [sendTransition, setSendTransition] = useState<SendBubbleTransition | null>(null);
  const composerMeasurementRef = useRef<ComposerInputMeasurement>({ input: null, scrollY: 0 });
  const sendRootRef = useAnimatedRef<View>();
  const sendBubbleRef = useAnimatedRef<View>();
  const sendQueueRef = useAnimatedRef<View>();
  const attachmentSourceRef = useRef<View>(null);
  const attachmentScrollYRef = useRef(0);
  const queueScrollRef = useRef<ScrollView>(null);
  const sendGenerationRef = useRef(0);
  // The latest send owns the flight; a slower measurement from an earlier one is dropped.
  const sendTokenRef = useRef(0);
  const reducedMotion = useReducedMotion();
  const paneWidth = usePaneWidth();
  const completeSendTransition = useCallback((id: string) => {
    setSendTransition((current) => current?.message.id === id ? null : current);
  }, []);
  useFocusEffect(useCallback(() => () => {
    sendGenerationRef.current += 1;
    setSendTransition(null);
  }, []));
  useFocusEffect(useCallback(() => {
    if (!sessionId) return;
    recordDebugEvent("chat.screen.focus", { session: debugAlias("session", sessionId) });
    setForegroundSession(sessionId);
    return () => {
      // Pushing Chat B over A focuses B before A blurs; clearing unconditionally would drop B.
      clearForegroundSession(sessionId);
      recordDebugEvent("chat.screen.blur", { session: debugAlias("session", sessionId) });
    };
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
  const draftScope = useMemo<ComposerDraftScope>(() => (sessionId ? { kind: "session", sessionId } : NEW_COMPOSER_DRAFT_SCOPE), [sessionId]);
  const [newChatDraft] = useState(() => createNewChatDraft({
    save: (text) => saveComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE, text),
    clearIf: (text) => clearComposerDraft(spaceId, NEW_COMPOSER_DRAFT_SCOPE, text),
  }));
  // Set when a new Chat is created: the composer keeps what it holds and saves it as that Chat's draft.
  const takeoverRef = useRef(false);
  const persistDraft = useCallback((scope: ComposerDraftScope, text: string) => {
    if (scope.kind === "new") newChatDraft.persist(text);
    else void saveComposerDraft(spaceId, scope, text).catch(() => undefined);
  }, [newChatDraft, saveComposerDraft, spaceId]);
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
  const sendFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sendFeedbackTimerRef.current !== null) clearTimeout(sendFeedbackTimerRef.current); }, []);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  // Sending reads the composer from refs: they are cleared with the send, so a second tap that lands
  // before the cleared composer renders finds nothing to send again.
  const attachmentsRef = useRef<AttachmentDraft[]>([]);
  useLayoutEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const { target: uploadTarget, release: releaseUpload } = useComposerUploads(spaceId, sessionId, attachments);
  useEffect(() => { if (attachments.length === 0) attachmentScrollYRef.current = 0; }, [attachments.length]);
  useEffect(() => {
    if (takeoverRef.current) {
      takeoverRef.current = false;
      draftLoadedRef.current = true;
      persistDraft(draftScope, inputRef.current);
      return;
    }
    let active = true;
    inputEditedRef.current = false;
    draftLoadedRef.current = false;
    inputRef.current = "";
    void loadComposerDraft(spaceId, draftScope)
      .then((saved) => {
        if (!active) return;
        draftLoadedRef.current = true;
        if (inputEditedRef.current) {
          persistDraft(draftScope, inputRef.current);
          return;
        }
        inputRef.current = saved;
        setInput(saved);
      })
      .catch(() => {
        if (active) draftLoadedRef.current = true;
      });
    return () => { active = false; };
  }, [draftScope, loadComposerDraft, persistDraft, spaceId]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timer = setTimeout(() => persistDraft(draftScope, input), 400);
    return () => clearTimeout(timer);
  }, [draftScope, input, persistDraft]);
  useEffect(() => () => {
    if (draftLoadedRef.current) persistDraft(draftScope, inputRef.current);
  }, [draftScope, persistDraft]);
  // Menus and sheets open one at a time; a close only clears its own, so a late onClose cannot shut the next.
  const [overlay, setOverlay] = useState<ChatOverlay | null>(null);
  const closeOverlay = useCallback((kind: ChatOverlay) => setOverlay((current) => (current === kind ? null : current)), []);
  const attachmentMenuOpen = overlay === "attachments";
  const renameOpen = overlay === "rename";
  const moreOpen = overlay === "more";
  const titleMenuOpen = overlay === "titleMenu";
  const labelSheetOpen = overlay === "labels";
  const modelSelectorOpen = overlay === "model";
  const harnessMenuOpen = overlay === "harness";
  const turnNavigatorOpen = overlay === "turns";
  const moreButtonRef = useRef<View>(null);
  const titleRef = useRef<View>(null);
  const closeMore = useCallback(() => closeOverlay("more"), [closeOverlay]);
  const closeTitleMenu = useCallback(() => closeOverlay("titleMenu"), [closeOverlay]);
  const [chatLabels, setChatLabels] = useState<SessionLabel[]>([]);
  const [chatLabelsError, setChatLabelsError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const renameSavingRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [pendingFollowupAction, setPendingFollowupAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [selectedHarness, setSelectedHarness] = useState<RuntimeHarness | null>(null);
  const [localModelsByHarness, setLocalModelsByHarness] = useState<Partial<Record<LocalHarness, ChatModelSelection | null>>>({});
  const [selectedModel, setSelectedModel] = useState<ChatModelSelection | null>(null);
  const [modelOverride, setModelOverride] = useState(false);
  const [activePanel, setActivePanel] = useState<SpacePanel | null>(null);
  const [forkingTurnId, setForkingTurnId] = useState<string | null>(null);
  const [loadingSequence, setLoadingSequence] = useState<number | null>(null);
  // Tail pins snap until opening has settled; animating them was the visible chase to the tail.
  const [openPhase, setOpenPhase] = useState<"placing" | "placed" | "settled">("placing");
  const listLoaded = openPhase !== "placing";
  const openSettled = openPhase === "settled";
  const [openingDelayElapsed, setOpeningDelayElapsed] = useState(false);
  // The newest page replacing the loaded turns mounts a fresh list that places itself like an open.
  const [mountGeneration] = useState(view.windowGeneration);
  const [listGeneration, setListGeneration] = useState(view.windowGeneration);
  if (listGeneration !== view.windowGeneration) {
    setListGeneration(view.windowGeneration);
    setOpenPhase("placing");
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
  const timelineRef = useRef<NativeChatTimelineHandle>(null);
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
  const scrollGestureRef = useRef<ScrollGesture>("idle");
  const followTailFrameRef = useRef<number | null>(null);
  const turnScrollTargetRef = useRef<number | null>(null);
  const turnScrollRetriesRef = useRef(new Map<number, number>());
  const turnScrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollRef = useRef({ y: 0, height: 0, viewport: 0 });
  const keyboardCoveredInset = useKeyboardCoveredInset();
  const keyboardInsetRef = useRef(0);
  // On Android a composer menu's Modal replays the keyboard state when it shows and again when it is dismissed.
  // The list takes each zero-height replay for a fresh close and scrolls back by its last keyboard lift, so its
  // keyboard handling holds from opening a menu over a hidden keyboard until the dismissal replay has passed.
  const listKeyboardFrozen = useSharedValue(false);
  const listKeyboardFrozenRef = useRef(false);
  const [keyboardFrozen, setKeyboardFrozen] = useState(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuOpen = attachmentMenuOpen || modelSelectorOpen || harnessMenuOpen;
  useLayoutEffect(() => { composerMenuOpenRef.current = composerMenuOpen; }, [composerMenuOpen]);
  const setListKeyboardFrozen = useCallback((frozen: boolean) => {
    if (listKeyboardFrozenRef.current === frozen) return;
    listKeyboardFrozenRef.current = frozen;
    listKeyboardFrozen.set(frozen);
    setKeyboardFrozen(frozen);
  }, [listKeyboardFrozen]);
  // Called on press, ahead of the Modal: the list reads `freeze` through a derived value a frame later.
  const freezeListForComposerMenu = useCallback(() => {
    if (Platform.OS === "android" && !KeyboardController.isVisible()) setListKeyboardFrozen(true);
  }, [setListKeyboardFrozen]);
  useEffect(() => {
    // Each replay ends in a JS keyboard event after its list handlers already ran, so release on the first one with no menu open.
    const settle = () => { if (Platform.OS === "android") setListKeyboardFrozen(composerMenuOpenRef.current); };
    // Only the settled inset counts; see `chatListDistances`. A frozen list does not lift for the model search keyboard.
    const shown = KeyboardEvents.addListener("keyboardDidShow", (event) => {
      keyboardInsetRef.current = listKeyboardFrozenRef.current ? 0 : Math.max(0, event.height - keyboardCoveredInset);
      settle();
    });
    const hiding = KeyboardEvents.addListener("keyboardWillHide", () => { keyboardInsetRef.current = 0; });
    const hidden = KeyboardEvents.addListener("keyboardDidHide", settle);
    return () => { shown.remove(); hiding.remove(); hidden.remove(); };
  }, [keyboardCoveredInset, setListKeyboardFrozen]);
  const alwaysScrollLogRef = useRef({ at: 0, y: 0 });
  const traceRequestId = useRef(0);
  const traceCancelGeneration = useRef(0);
  const traceState = useCallback((): TraceFields => ({
    session: chatScrollTrace.alias("session", sessionId),
    pendingSequence: pendingScrollSequence.current, targetSequence: turnScrollTargetRef.current,
    retryTimerPending: turnScrollRetryTimerRef.current !== null,
    retries: turnScrollTargetRef.current === null ? null : turnScrollRetriesRef.current.get(turnScrollTargetRef.current) ?? 0,
    following: followingTailRef.current, dragging: scrollGestureRef.current !== "idle", momentum: scrollGestureRef.current === "momentum",
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
    // The native timeline pins its tail itself; asking for the tail is an explicit return to it.
    if (nativeChatTimeline) {
      if (pendingScrollSequence.current === null && turnScrollTargetRef.current === null) timelineRef.current?.scrollToEnd(animated);
      return;
    }
    // A list still placing itself owns the scroll; a command would race it.
    if (!listPlacedRef.current || !followingTailRef.current || scrollGestureRef.current !== "idle" || pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null) return;
    if (followTailFrameRef.current !== null) cancelAnimationFrame(followTailFrameRef.current);
    followTailFrameRef.current = requestAnimationFrame(() => {
      followTailFrameRef.current = null;
      if (!listPlacedRef.current || !followingTailRef.current || scrollGestureRef.current !== "idle" || pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null) return;
      traceEnd("tail.frame", animated);
      if (animated) return;
      requestAnimationFrame(() => {
        if (!followingTailRef.current || scrollGestureRef.current !== "idle") return;
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
  const spaceName = draftSpace ? displaySpaceName(draftSpace) : view.space ? displaySpaceName(view.space) : sessionSummary?.space?.name || t("space.fallbackName");
  const listedSpaceAvatarUrl = useAppSelector((app) => (spaceId ? app.state.spaces.find((item) => item.id === spaceId)?.publicProfile?.avatarUrl : undefined));
  // In Bot mode a Bot's page is the Chat its `bot.json` names for the user: what the Bot `say`s and what the user
  // writes. Every other Chat, including the one the Bot works in, renders as an ordinary Chat.
  const listedSpaceSlug = useAppSelector((app) => (spaceId ? app.state.spaces.find((item) => item.id === spaceId)?.slug : undefined));
  const botSpace = botModeEnabled && !workLog && isBotSpace({ slug: listedSpaceSlug ?? sessionSummary?.space?.slug ?? view.space?.slug ?? draftSpace?.slug });
  const botFile = useQuery({ ...botFileQuery(client, spaceId), enabled: botSpace && Boolean(client && spaceId) });
  // A Bot opened without visiting the Bots view still leaves its identity for the next launch.
  const savedBotFileRef = useRef("");
  useEffect(() => {
    if (!botSpace || !botFile.data || !userKey || savedBotFileRef.current === spaceId) return;
    savedBotFileRef.current = spaceId;
    void saveBotFileCache(userKey, spaceId, botFile.data).catch(() => undefined);
  }, [botFile.data, botSpace, spaceId, userKey]);
  const botChats = botSpace ? botFile.data ?? null : null;
  const spaceAvatarUrl = listedSpaceAvatarUrl ?? view.space?.publicProfile?.avatarUrl ?? null;
  const bot = useMemo<BotPeer | null>(() => botChats?.chat?.id === sessionId ? { name: spaceName, avatarUrl: spaceAvatarUrl } : null, [botChats?.chat?.id, sessionId, spaceAvatarUrl, spaceName]);
  // The open Chat is seen up to whichever record (thread or list) knows the newer message. A Bot's row compares
  // its last note's Turn-derived id, which the session's server id never equals, so its page records that id.
  const botNoteId = useMemo(() => bot ? latestBotNote(view.turns, spaceId)?.messageId ?? null : null, [bot, spaceId, view.turns]);
  const seenMessageId = botNoteId ?? latestMessageId(view.session, sessionSummary);
  useFocusEffect(useCallback(() => {
    if (seenMessageId) void markSessionSeen(sessionId, seenMessageId).catch(() => undefined);
  }, [markSessionSeen, seenMessageId, sessionId]));
  // A notification for the Chat a Bot works in lands on the Bot's page; its work log opens it as a Chat.
  const botPageId = !workLog && botChats?.session?.id === sessionId ? botChats.chat?.id ?? null : null;
  useEffect(() => { if (botPageId) router.replace({ pathname: "/chat/[sessionId]", params: { sessionId: botPageId } }); }, [botPageId, router]);
  const botWork = bot ? botChats?.session ?? null : null;
  useEffect(() => { if (botWork) void refreshSessionStatuses([botWork], { silent: true }); }, [botWork, refreshSessionStatuses]);
  // The Bot is typing while its working Chat runs.
  const botWorking = useAppSelector(({ state }) => botWork ? sessionListStatus(state.sessions.find((item) => item.id === botWork.id) ?? botWork, state.sessionLatestTurns[botWork.id], state.sessionTurnStatuses) === "running" : false);
  // The user's message reaches the Bot in two steps; one whose second step failed stays here marked failed.
  const [relayFailed, setRelayFailed] = useState<ReadonlySet<string>>(() => new Set());
  const spaceSessions = useAppSelector((app) => app.state.sessions.filter((item) => item.spaceId === spaceId), shallowEqual);
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
  const threadMessages = useMemo(() => {
    if (pendingNew) return [pendingNew];
    const history = messagesFromTurns(view.turns);
    return messagesInWindow(withTurnSequences(
      mergeDisplayMessages(history.length > 0 ? history : view.messages, history.length > 0 ? view.messages : [])
        .filter((message) => !isOptimisticFollowup(message) && !isAssistantIntermediate(message) && hasRenderableMessage(message) && !(typeof message.meta?.turnId === "string" && queuedFollowupIds.has(message.meta.turnId))),
      view.turns,
    ), { turns: view.turns, hasMoreNewer: view.hasMoreNewer });
  }, [pendingNew, queuedFollowupIds, view.hasMoreNewer, view.messages, view.turns]);
  const messages = useMemo(() => relayFailed.size ? threadMessages.map((message) => relayFailed.has(clientMessageIdOf(message) ?? "") ? relayFailedMessage(message, t("bots.relayFailed")) : message) : threadMessages, [relayFailed, t, threadMessages]);
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
  // A Bot's page spaces its bubbles by side and time instead of by Turn; the native timeline places them the same way.
  const botLayout = useMemo(() => {
    if (!bot) return null;
    const writer = (message: MessageRecord) => {
      if (message.role !== "user") return spaceId;
      const sequence = turnSequenceForMessage(message);
      return botMessageSpace(message, (sequence !== null ? turnsBySequence.get(sequence)?.[0] : undefined) ?? (typeof message.meta?.turnId === "string" ? turnsById.get(message.meta.turnId) : null));
    };
    const placements = botPlacements(messages, writer);
    return new Map(messages.map((message, index) => [message.id, placements[index]!]));
  }, [bot, messages, spaceId, turnsById, turnsBySequence]);
  // Other Bots that write on this Bot's page, by Space, from the Spaces the app has loaded.
  const loadedSpaces = useAppSelector(({ state }) => bot ? state.spaces : NO_SPACES);
  const botPeers = useMemo(() => new Map<string, BotPeer>(loadedSpaces.map((space) => [space.id, { name: displaySpaceName(space), avatarUrl: space.publicProfile?.avatarUrl ?? null }])), [loadedSpaces]);
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
      streamStatus: view.stream?.status ?? null, submitting: view.messages.some(isSubmittingSend),
      activePanel, currentTurnSequence, turnNavigatorOpen,
      initialTurnSequence, hasInitialTurnId: initialTurnId !== null,
      inverted: false, maintainVisibleContentPosition: !followingTail,
    });
  }, [activePanel, currentTurnSequence, followingTail, initialTurnId, initialTurnSequence, messages.length, trace, tracing, turnNavigatorOpen, view.hasMoreNewer, view.hasMoreOlder, view.historyLoaded, view.loading, view.loadingNewer, view.loadingOlder, view.messages, view.refreshing, view.stream?.status, view.turns.length]);
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
  const turnsNewestFirst = useMemo(() => [...view.turns].reverse(), [view.turns]);
  const recordedModel = useMemo(() => recordedChatModel(turnsNewestFirst, messages, models), [messages, models, turnsNewestFirst]);
  const lastAgentTurn = useMemo(() => turnsNewestFirst.find(isAgentTurn), [turnsNewestFirst]);
  const composerHarness: RuntimeHarness = bot ? "cohub" : selectedHarness ?? runtimeHarnessFromTurn(lastAgentTurn);
  const recordedLocalModel = composerHarness === "cohub" ? null : turnsNewestFirst.find((turn) => runtimeHarnessFromTurn(turn) === composerHarness && turn.model);
  // A Bot's model is chosen on its profile.
  const [botModel] = useBotModel(userUuid, spaceId);
  const activeModel = composerHarness === "cohub"
    ? (bot && botModel !== undefined ? botModel : modelOverride ? selectedModel : recordedModel)
    : (Object.hasOwn(localModelsByHarness, composerHarness) ? localModelsByHarness[composerHarness] ?? null : recordedLocalModel ? recordedRuntimeModel(recordedLocalModel, composerHarness) : null);
  const activeStatus = composerHarness === "cohub" && activeModel ? modelAvailabilityLevel(modelStatus?.models[activeModel.id]) : "unknown";
  const modelLabel = activeModel?.name || activeModel?.id || (composerHarness === "cohub" ? t("chat.model.automatic") : t("model.runtimeAutomatic"));
  const modelTriggerDetail = activeModel?.thinkingLevel ? formatThinkingLevel(activeModel.thinkingLevel) : undefined;
  // Unsent choices per Harness; once sent, the Turn's own record shows what ran.
  const [approvalChoices, setApprovalChoices] = useState<Partial<Record<RuntimeHarness, ApprovalMode>>>({});
  const [fastChoices, setFastChoices] = useState<Partial<Record<RuntimeHarness, boolean>>>({});
  const approvalModes = approvalModesFor(runtime.status, composerHarness);
  const approvalMode = composerHarness === "cohub" ? null : approvalChoices[composerHarness] ?? approvalModeFromTurns(view.turns, composerHarness);
  const runtimeModel = runtimeModelFor(runtime.status, composerHarness, activeModel?.id);
  const fastAvailable = supportsFast(runtimeModel);
  const fast = fastAvailable && (fastChoices[composerHarness] ?? runtimeModel?.defaultServiceTier === FAST_SERVICE_TIER);
  const execution: LocalExecution | undefined = composerHarness === "cohub" ? undefined : {
    // Kept when the Runtime stops offering it, so the send fails instead of silently dropping a limit.
    ...(approvalMode ? { approvalMode } : {}),
    ...(fastAvailable && fastChoices[composerHarness] !== undefined ? { serviceTier: fastServiceTier(runtimeModel, fast) } : {}),
  };
  const executionMenu: LocalExecutionMenu = composerHarness === "cohub" ? {} : {
    approval: { modes: approvalModes, value: approvalMode, onSelect: (mode) => setApprovalChoices((current) => ({ ...current, [composerHarness]: mode })) },
    ...(fastAvailable ? { fast: { value: fast, onToggle: () => setFastChoices((current) => ({ ...current, [composerHarness]: !fast })) } } : {}),
  };
  // The catalog names the recorded model; before it loads the trigger would show the raw id.
  useEffect(() => { if (!botSpaceEarly) void loadModels().catch(() => undefined); }, [botSpaceEarly, client, loadModels]);
  const liveStream = shouldShowLiveStream(view.stream, messages);
  // Mounting LegendList empty then filling it drops `initialScrollAtEnd`, so the first paint
  // would show the oldest rows and jump. Wait until there is a tail to pin to.
  // Each send is tracked on its own row; none of them blocks the composer.
  const submitting = view.messages.some(isSubmittingSend);
  const starting = pendingNew !== null && !isFailedSend(pendingNew);
  // A note on a Bot's page gets no reply in this Chat; the Bot answers with `say`, shown as typing meanwhile.
  const pendingReply = (starting || submitting) && !bot;
  const retryDisabled = Boolean(sessionId) && !view.historyLoaded;
  const timelineReady = messages.length > 0 || view.historyLoaded || Boolean(liveStream) || submitting;
  // The list stays invisible until it has settled on the tail, so the opening state covers that too.
  const placeholder = !sessionId
    ? (pendingNew ? null : "draft")
    : chatThreadPlaceholder({
      messageCount: messages.length,
      historyLoaded: view.historyLoaded,
      error: view.error,
      hasLiveActivity: Boolean(liveStream || submitting),
    }) ?? (timelineReady && !listLoaded ? "opening" : null);
  const threadPlaceholder = placeholder === "opening" && !openingDelayElapsed ? null : placeholder;
  const running = Boolean(sessionId) && (latestTurnStatus === "running" || submitting || (liveStream && isLiveStreamStatus(view.stream?.status ?? "")));
  const appendVoiceText = useCallback((text: string) => {
    updateInput(appendDictation(inputRef.current, text));
  }, [updateInput]);
  const voice = useNativeVoiceInput({ getAccessToken, onFinal: appendVoiceText });

  const handleListLoad = useCallback(() => {
    listPlacedRef.current = true;
    setOpenPhase((current) => current === "placing" ? "placed" : current);
  }, []);

  useEffect(() => {
    entryRendersRef.current += 1;
    entryStatsRef.current = { messages: view.messages.length, turns: view.turns.length, hasStream: Boolean(view.stream), historyLoaded: view.historyLoaded };
  });

  useEffect(() => {
    markChatEntry("screen.mount", { ...entryStatsRef.current, nativeTimeline: nativeChatTimeline });
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
    const timer = setTimeout(() => setOpenPhase((current) => current === "placed" ? "settled" : current), OPEN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [openQuiet, openSettled]);

  useEffect(() => {
    let active = true;
    readStateLoadedRef.current = false;
    readSequenceRef.current = null;
    savedReadSequenceRef.current = null;
    if (!sessionId) return;
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
    if (nativeChatTimeline) {
      const timeline = timelineRef.current;
      const message = messages[index];
      if (!timeline || !message) {
        pendingScrollSequence.current = sequence;
        return;
      }
      pendingScrollSequence.current = null;
      initialScrollDone.current = true;
      // The native list lands on the row exactly, so there is nothing to retry.
      void timeline.scrollToMessage(messageRowKey(message), retry === 0).then((found) => {
        if (!found) pendingScrollSequence.current = sequence;
      });
      setCurrentTurnSequence(sequence);
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
  }, [messages, scheduleTurnScrollRetry, scrollToMessageIndex, setFollowingTail, targetMessageIndex, trace]);

  // A turn requested before its rows existed lands once they arrive; the JS list does this on content size.
  useEffect(() => {
    if (!nativeChatTimeline || pendingScrollSequence.current === null || !listLoaded) return;
    scrollToTurn(pendingScrollSequence.current);
  }, [listLoaded, messages, scrollToTurn]);

  const handleTurnJump = async (sequence: number) => {
    const requestId = ++traceRequestId.current;
    const cancelGeneration = traceCancelGeneration.current;
    setLoadingSequence(sequence);
    try {
      trace("turn.jumpStart", { sequence, origin: "navigator", requestId });
      const resolvedSequence = await jumpToTurn(sessionId, sequence);
      trace("turn.jumpResolved", { sequence, resolvedSequence, origin: "navigator", requestId, cancelledWhileWaiting: cancelGeneration !== traceCancelGeneration.current });
      scrollToTurn(resolvedSequence);
      closeOverlay("turns");
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
    scrollGestureRef.current = "idle";
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

  const appendAttachments = (next: AttachmentDraft[]) => {
    if (attachments.length + next.length > MAX_ATTACHMENTS) showToast({ title: t("chat.attachmentLimit", { count: MAX_ATTACHMENTS }), tone: "danger" });
    setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
  };
  // What another app shared fills a new Chat's composer once; the user reviews it and sends it themselves.
  const shareTakenRef = useRef(false);
  useEffect(() => {
    if (!draft?.fromShare || shareTakenRef.current) return;
    shareTakenRef.current = true;
    void takeIncomingShare().then((share) => {
      if (!share) return;
      if (share.text) updateInput([inputRef.current, share.text].filter(Boolean).join("\n\n"));
      if (share.attachments.length > 0) appendAttachments(share.attachments);
    }, (error: unknown) => showToast({ title: t("share.failed"), message: error instanceof Error ? error.message : undefined, tone: "danger" }));
    // Runs once per screen; `appendAttachments` only reads the attachment count for its limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.fromShare]);
  const pickAttachments = async () => {
    closeOverlay("attachments");
    try {
      const result = await withForegroundHandoff(() => DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true }));
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType || "application/octet-stream", size: asset.size ?? 0 })));
    } catch (error) { showToast({ title: t("chat.attachmentUnavailable.title"), message: error instanceof Error ? error.message : t("chat.attachmentUnavailable.body"), tone: "danger" }); }
  };
  const pickPhotos = async () => {
    closeOverlay("attachments");
    try {
      const permission = await withForegroundHandoff(() => ImagePicker.requestMediaLibraryPermissionsAsync());
      if (!permission.granted) { showToast({ title: t("chat.photoOff.title"), message: t("chat.photoOff.body"), tone: "danger" }); return; }
      const result = await withForegroundHandoff(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.88 }));
      if (result.canceled) return;
      appendAttachments(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName || `image-${index + 1}.jpg`, mimeType: asset.mimeType || "image/jpeg", size: asset.fileSize ?? 0 })));
    } catch (error) { showToast({ title: t("chat.photoPickerUnavailable.title"), message: error instanceof Error ? error.message : t("chat.photoPickerUnavailable.body"), tone: "danger" }); }
  };
  const takePhoto = async () => {
    closeOverlay("attachments");
    try {
      const permission = await withForegroundHandoff(() => ImagePicker.requestCameraPermissionsAsync());
      if (!permission.granted) { showToast({ title: t("chat.cameraOff.title"), message: t("chat.cameraOff.body"), tone: "danger" }); return; }
      const result = await withForegroundHandoff(() => ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.88 }));
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
    haptics.commit();
    try {
      // On a Bot's page the work runs in the Bot's working Chat; only a reply here belongs to this one.
      await abortSession(bot && botWork ? botWork.id : sessionId, { refresh: !bot });
      if (bot && botWork) await refreshSessionStatuses([botWork], { silent: true, force: true });
      recordDebugEvent("chat.stop.ended", { outcome: "success" });
    } catch (error) {
      recordDebugEvent("chat.stop.ended", { outcome: "failed" });
      showToast({ title: t("chat.stopFailed.title"), message: error instanceof Error ? error.message : t("chat.stopFailed.body"), tone: "danger" });
    } finally { setStopping(false); }
  };
  const runFollowupAction = async (turnId: string, action: "steer" | "cancel") => {
    if (!client || !spaceId || pendingFollowupAction !== null) return;
    setPendingFollowupAction(turnId);
    if (action === "steer") haptics.commit();
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
    const url = `${resolveWebBaseUrl({ env: config.environment })}/spaces/${encodeURIComponent(spaceId)}/sessions/${encodeURIComponent(sessionId)}`;
    try {
      await withForegroundHandoff(() => Share.share({ message: `${title}\n${url}`, url, title }));
    } catch (error) {
      showToast({ title: t("chat.shareFailed.title"), message: error instanceof Error ? error.message : t("chat.shareFailed.unavailable"), tone: "danger" });
    }
  };
  const copySessionTitle = useCallback(async () => {
    const title = session ? displaySessionTitle(session) : t("chat.title");
    try {
      await Clipboard.setStringAsync(title);
      showToast({ title: t("chat.titleCopied"), tone: "success" });
    } catch (error) {
      showToast({ title: t("chat.copyTitleFailed.title"), message: error instanceof Error ? error.message : t("chat.copyTitleFailed.body"), tone: "danger" });
    }
  }, [session, showToast, t]);
  const openTitleMenu = useCallback(() => {
    setOverlay("titleMenu");
    haptics.longPress();
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
    setOverlay("rename");
  };
  const reloadChatLabels = useCallback(() => {
    if (!client || !spaceId) return;
    setChatLabelsError(null);
    void fetchSessionLabels(client, spaceId)
      .then((tree) => setChatLabels(toUserSessionLabels(tree)))
      // Keep what was loaded: an empty list would read as "no labels".
      .catch((error: unknown) => setChatLabelsError(error instanceof Error ? error.message : t("labels.loadFailed")));
  }, [client, spaceId, t]);
  const openLabelSheet = () => {
    setOverlay("labels");
    reloadChatLabels();
  };
  const saveRename = async (title = renameValue) => {
    if (renameSavingRef.current) return;
    renameSavingRef.current = true;
    setRenameSaving(true);
    try { await renameSession(sessionId, title); closeOverlay("rename"); } catch (error) { showToast({ title: t("chat.renameFailed.title"), message: error instanceof Error ? error.message : t("chat.renameFailed.body"), tone: "danger" }); } finally {
      renameSavingRef.current = false;
      setRenameSaving(false);
    }
  };
  const archived = Boolean(session?.archivedAt);
  // Only the person whose run stopped can top up for it; other members see the Turn as stopped.
  const billingStopped = useMemo(() => {
    const turn = view.turns.at(-1);
    return turn?.status === "interrupted" && turn.summary?.reason === "billing" && turn.userUuid === userUuid;
  }, [userUuid, view.turns]);
  const [archiving, setArchiving] = useState(false);
  const toggleArchive = async () => {
    if (!session || archiving) return;
    setArchiving(true);
    try { await setSessionArchived(session, !archived); } catch (error) { showToast({ title: t("session.archive.failed"), message: error instanceof Error ? error.message : undefined, tone: "danger" }); } finally {
      setArchiving(false);
    }
  };
  const titleActions: AnchoredMenuAction[] = [
    { icon: "copy", title: t("chat.titleActions.copy"), onPress: () => void copySessionTitle() },
    { icon: "square-pen", title: t("chat.titleActions.edit"), onPress: openRename },
  ];
  // Grouped as iOS menus are: this Chat, then its Space under the Space's name.
  const chatSections: AnchoredMenuSection[] = [
    { actions: [
      { icon: "share", title: t("chat.actions.share"), onPress: () => void shareChat() },
      { icon: "square-pen", title: t("chat.actions.rename"), onPress: openRename },
      { icon: "tag", title: t("chat.actions.labels"), disabled: !client || !spaceId, onPress: openLabelSheet },
      // The server refuses to archive a running Chat; the item says why instead of failing.
      { icon: "archive", title: archived ? t("session.unarchive") : running ? t("session.archive.running") : t("session.archive"), disabled: !client || !session || archiving || (!archived && running), onPress: () => void toggleArchive() },
    ] },
    { title: spaceName, actions: [
      { icon: "messages", title: t("chat.actions.openChats"), disabled: !spaceId, onPress: () => setActivePanel("chat") },
      { icon: "folder-open", title: t("chat.actions.openFiles"), disabled: !spaceId, onPress: () => setActivePanel("files") },
    ] },
    ...(tracing ? [{ actions: [{ icon: "activity" as const, title: "Scroll Diagnostics", onPress: () => { trace("experiment.mark", { origin: "chatMenu" }); router.push("/debug/chat-scroll"); } }] }] : []),
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
    const { distanceToLatest, distanceToOldest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height, keyboardInsetRef.current);
    setFollowingTail(nextChatTailFollowing({
      currentlyFollowing: followingTailRef.current,
      distanceToBottom: distanceToLatest,
      userInteracting: chatTailScrolledAway({ dragging: scrollGestureRef.current === "dragging", momentum: scrollGestureRef.current === "momentum", contentGrew: grew, offsetDelta }),
      pendingTarget: pendingScrollSequence.current !== null || (turnScrollTargetRef.current !== null && !targetIsLatestMessage()),
      detached: view.hasMoreNewer,
    }));
    // Native animated scrollTo cannot retarget; snap once a burst opens a gap the pin would chase.
    setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
    if (initialScrollDone.current && followingTailRef.current && chatTailDisplaced({ dragging: scrollGestureRef.current === "dragging", momentum: scrollGestureRef.current === "momentum", contentGrew: grew, offsetDelta, distanceToLatest })) {
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
    if (initialScrollDone.current && followingTailRef.current && scrollGestureRef.current === "idle" && turnScrollTargetRef.current === null) {
      if (followTailFrameRef.current !== null) cancelAnimationFrame(followTailFrameRef.current);
      const yAtSchedule = lastScrollRef.current.y;
      followTailFrameRef.current = requestAnimationFrame(() => {
        followTailFrameRef.current = null;
        if (!followingTailRef.current || scrollGestureRef.current !== "idle") return;
        const { distanceToLatest } = chatListDistances(lastScrollRef.current.y, height, lastScrollRef.current.viewport, keyboardInsetRef.current);
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
    scrollGestureRef.current = "dragging";
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
      scrollGestureRef.current = "momentum";
      return;
    }
    scrollGestureRef.current = "idle";
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const { distanceToLatest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height, keyboardInsetRef.current);
    setFollowingTail(nextChatTailFollowing({ currentlyFollowing: followingTailRef.current, distanceToBottom: distanceToLatest, userInteracting: false, pendingTarget: pendingScrollSequence.current !== null || turnScrollTargetRef.current !== null, detached: view.hasMoreNewer }));
    setFollowPinAnimated(chatFollowPinAnimated(distanceToLatest, followPinAnimatedRef.current));
    requestFollowTail();
  }, [requestFollowTail, setFollowPinAnimated, setFollowingTail, trace, view.hasMoreNewer]);

  const handleMomentumScrollBegin = useCallback(() => {
    traceAction("chat_list_momentum_begin");
    trace("list.momentumBegin");
    if (scrollGestureRef.current === "dragging") scrollGestureRef.current = "momentum";
  }, [trace]);

  const handleMomentumScrollEnd = useCallback((event: ChatScrollEvent) => {
    traceAction("chat_list_momentum_end", { offsetY: Math.round(event.nativeEvent.contentOffset.y) });
    trace("list.momentumEnd", { offsetY: event.nativeEvent.contentOffset.y });
    scrollGestureRef.current = "idle";
    if (pendingScrollSequence.current !== null) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const { distanceToLatest } = chatListDistances(contentOffset.y, contentSize.height, layoutMeasurement.height, keyboardInsetRef.current);
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

  const handleCopyMessage = useCallback(async (text: string) => {
    recordDebugEvent("chat.message.copy", { session: debugAlias("session", sessionId), length: text.length });
    try {
      await copyMessageText(text);
    } catch (error) {
      showToast({ title: t("chat.copyFailed.title"), message: error instanceof Error ? error.message : t("chat.copyFailed.body"), tone: "danger" });
      throw error;
    }
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

  // Reading on demand keeps related-Chat links from re-rendering every row on each dispatch.
  const lookupSession = useCallback((id: string): SessionRecord | null => {
    const state = getAppState();
    return state.sessionViews[id]?.session ?? state.sessions.find((item) => item.id === id) ?? null;
  }, [getAppState]);
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

  // The flight from the composer for the send about to be inserted: measured before the composer
  // clears, never awaited, and dropped unless it is ready before the bubble's first frame.
  const beginSendFlight = (text: string, files: AttachmentDraft[]) => {
    const generation = sendGenerationRef.current;
    const token = ++sendTokenRef.current;
    setSendTransition(null);
    const flight = createSendFlight((message, source) => {
      if (token !== sendTokenRef.current || generation !== sendGenerationRef.current) return;
      recordDebugEvent("chat.send_transition.source_measured", { ...source });
      setSendTransition({ message, text, source, attachments: files, destination: isOptimisticFollowup(message) ? "queue" : "bubble" });
    });
    if (reducedMotion) flight.expire();
    else {
      const { input: field, scrollY } = composerMeasurementRef.current;
      measureSendBubbleSource(files.length > 0 ? attachmentSourceRef.current : field, sendRootRef.current, files.length > 0 ? attachmentScrollYRef.current : scrollY, flight.measured);
    }
    return {
      inserted: (message: MessageRecord) => {
        flight.inserted(message);
        requestAnimationFrame(flight.expire);
      },
    };
  };
  const showSent = () => {
    setSendFeedback("success");
    if (sendFeedbackTimerRef.current !== null) clearTimeout(sendFeedbackTimerRef.current);
    sendFeedbackTimerRef.current = setTimeout(() => {
      sendFeedbackTimerRef.current = null;
      setSendFeedback("idle");
    }, 700);
  };
  const clearComposer = () => {
    inputRef.current = "";
    attachmentsRef.current = [];
    setInput("");
    setAttachments([]);
  };
  // Nothing on screen holds a message that failed before its bubble existed, so it goes back to the
  // composer, ahead of anything typed since.
  const restoreComposer = (text: string, files: AttachmentDraft[]) => {
    updateInput([text, inputRef.current].filter(Boolean).join("\n\n"));
    setAttachments((current) => [...files, ...current]);
  };

  // A new Chat's first message: its bubble and the starting reply show at once; the server's Chat
  // takes over this same surface, and a failure stays on the bubble with retry and delete.
  const startNewChat = (text: string, files: AttachmentDraft[], model: ChatModelSelection | null, harness: RuntimeHarness, flight: { inserted: (message: MessageRecord) => void } | null) => {
    if (!draftSpace) return;
    let pending: MessageRecord | null = null;
    sendNewMessage(draftSpace.id, text, files, {
      model,
      harness,
      ...(harness === composerHarness && execution ? { execution } : {}),
      onOptimistic: (message) => {
        pending = message;
        setNewChat({ pending: message });
        flight?.inserted(message);
      },
    }).then((result) => {
      newChatDraft.accepted(!mountedRef.current);
      if (!mountedRef.current) return;
      takeoverRef.current = true;
      setNewChat({ sessionId: result.session.id });
      onCreated?.(result.session.id);
      showSent();
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : t("chat.startFailed.body");
      if (!mountedRef.current) return;
      if (pending) {
        setNewChat({ pending: failedSendMessage(pending, message) });
        return;
      }
      restoreComposer(text, files);
      newChatDraft.discard(inputRef.current);
      showToast({ title: t("chat.startFailed.title"), message, tone: "danger" });
    });
  };

  // Step two of a send on a Bot's page: the note's words, as the server stored them, go to the Chat the Bot works in.
  const relayToBotChat = async (clientMessageId: string) => {
    setRelayFailed(withMember(clientMessageId, false));
    const note = getAppState().sessionViews[sessionId]?.turns.find((turn) => turn.meta?.clientMessageId === clientMessageId);
    try {
      if (!client || !botChats?.session || !note) throw new Error(t("bots.relayFailed"));
      const content = note.userContent?.length ? note.userContent : note.userText ? [{ type: "text" as const, text: note.userText }] : [];
      if (await relayToBot(client, { spaceId, sessionId: botChats.session.id, content, reminder: await loadBotReminder(client), model: activeModel })) showToast({ title: t("bots.busy") });
    } catch {
      setRelayFailed(withMember(clientMessageId, true));
    }
  };

  const submit = () => {
    const text = inputRef.current;
    const files = attachmentsRef.current;
    if (!text.trim() && files.length === 0) return;
    const harness = composerHarness;
    recordDebugEvent("chat.send.pressed", { hasText: Boolean(text.trim()), attachmentCount: files.length, keyboardExpected: true, newChat: !sessionId });
    if (!canUseRuntimeHarness(runtime.status, harness)) {
      showToast({ title: t("runtime.unavailable.title"), message: t("runtime.unavailable.body"), tone: "danger" });
      return;
    }
    if (!sessionId && pendingNew) {
      showToast({ title: t("chat.startFailed.title"), message: t("chat.draft.retryFirst"), tone: "danger" });
      return;
    }
    const flight = beginSendFlight(text, files);
    haptics.commit();
    if (!sessionId) {
      newChatDraft.send(text, "");
      clearComposer();
      startNewChat(text, files, activeModel, harness, flight);
      return;
    }
    clearComposer();
    void clearComposerDraft(spaceId, draftScope).catch(() => undefined);
    recordDebugEvent("chat.send.composer_cleared");
    let optimisticCreated = false;
    let noteId: string | null = null;
    sendMessage(sessionId, text, files, {
      // On a Bot's page the words are written here as a note first, then handed to the Bot.
      ...(bot ? { note: true } : { model: activeModel, harness, ...(execution ? { execution } : {}) }),
      onOptimistic: (message) => {
        optimisticCreated = true;
        if (bot) noteId = clientMessageIdOf(message);
        flight.inserted(message);
        if (!isOptimisticFollowup(message)) {
          cancelTurnScroll();
          setFollowingTail(true);
          requestFollowTail(!reducedMotion);
        }
      },
    }).then(() => {
      showSent();
      if (noteId) void relayToBotChat(noteId);
    }, (error: unknown) => {
      // Once the bubble exists it carries the failure and its retry.
      if (optimisticCreated) return;
      restoreComposer(text, files);
      showToast({ title: t("chat.sendFailed.title"), message: error instanceof Error ? error.message : t("data.messageSendFailed"), tone: "danger" });
    });
  };

  const retrySend = (message: MessageRecord) => {
    // Already written here; only handing it to the Bot failed, so only that is redone.
    const relayId = clientMessageIdOf(message);
    if (message.meta?.relayFailed === true && relayId) {
      haptics.commit();
      void relayToBotChat(relayId);
      return;
    }
    const draft = failedSendDraft(message);
    if (!draft) return;
    if (!sessionId) {
      if (pendingNew?.id !== message.id) return;
      haptics.commit();
      newChatDraft.send(draft.text, inputRef.current);
      startNewChat(draft.text, draft.attachments, draft.model, draft.harness ?? "cohub", null);
      return;
    }
    // Until the server history lands, a cached failed row may be a send it already accepted.
    if (!getAppState().sessionViews[sessionId]?.historyLoaded) return;
    haptics.commit();
    let replaced = false;
    let noteId: string | null = null;
    sendMessage(sessionId, draft.text, draft.attachments, {
      ...(bot ? { note: true } : { model: draft.model, ...(draft.harness ? { harness: draft.harness } : {}) }),
      retryOf: message,
      onOptimistic: (optimistic) => {
        replaced = true;
        if (bot) noteId = clientMessageIdOf(optimistic);
        if (isOptimisticFollowup(optimistic)) return;
        cancelTurnScroll();
        setFollowingTail(true);
        requestFollowTail(!reducedMotion);
      },
    }).then(() => { if (noteId) void relayToBotChat(noteId); }, (error: unknown) => {
      if (!replaced) showToast({ title: t("chat.sendFailed.title"), message: error instanceof Error ? error.message : t("data.messageSendFailed"), tone: "danger" });
    });
  };
  // Rows keep their handler identity across sends, so they call through to the latest closure.
  const retrySendRef = useRef(retrySend);
  useLayoutEffect(() => { retrySendRef.current = retrySend; });
  const retryRow = useCallback((message: MessageRecord) => retrySendRef.current(message), []);
  const discardSend = useCallback((message: MessageRecord) => {
    if (sessionId) {
      discardFailedSend(sessionId, message.id);
      return;
    }
    setNewChat((current) => ("pending" in current && current.pending?.id === message.id ? { pending: null } : current));
    newChatDraft.discard(inputRef.current);
  }, [discardFailedSend, newChatDraft, sessionId]);

  // FlatList and its cells are PureComponents: bailing out depends on every prop keeping its
  // identity. These are stable across stream batches, so a live turn no longer re-renders every
  // mounted row (the live step list subscribes on its own instead).
  const streamTurnId = view.stream?.turnId ?? null;
  const replyAnchor = liveStream || pendingReply ? liveReplyAnchor(messages, liveStream ? streamTurnId : null, view.hasMoreNewer) : null;
  // LegendList memoizes each row on [item, extraData]; fork/send-transition state renders
  // inside a row but never changes `messages`, so it must flow through extraData to reach it.
  const rowExtraData = useMemo(
    () => ({ forkingTurnId, forkOrigin, sendTransition, queueTransitionActive, streamTurnId, replyAnchor, liveStream, pendingReply, arrivalBaseline, retryDisabled, bot, botLayout, botPeers, t, theme }),
    [forkingTurnId, forkOrigin, sendTransition, queueTransitionActive, streamTurnId, replyAnchor, liveStream, pendingReply, arrivalBaseline, retryDisabled, bot, botLayout, botPeers, t, theme],
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
  const handleListRefresh = useCallback(() => { if (sessionId) void refreshSession(sessionId); }, [refreshSession, sessionId]);
  const pullRefresh = useBrandRefresh({ refreshing: view.refreshing, onRefresh: handleListRefresh, scrollEventThrottle: 100 });
  const { onScroll: trackPull, onScrollBeginDrag: trackPullStart, onScrollEndDrag: trackPullEnd } = pullRefresh;
  const handleListScroll = useCallback((event: ChatScrollEvent) => { handleScroll(event); trackPull(event); }, [handleScroll, trackPull]);
  const timelineVisible = useCallback((visible: VisibleMessage[]) => {
    onVisibleRows({ viewableItems: visible.map(({ message, index, key }) => ({ item: message, index, key, isViewable: true })) });
  }, [onVisibleRows]);
  const timelineNearEdge = useCallback((edge: "older" | "newer") => {
    if (edge === "older" && initialScrollDone.current && view.hasMoreOlder && !view.loadingOlder) void loadOlderTurns(sessionId);
    if (edge === "newer" && view.hasMoreNewer && !view.loadingNewer) void loadNewerTurns(sessionId);
  }, [loadNewerTurns, loadOlderTurns, sessionId, view.hasMoreNewer, view.hasMoreOlder, view.loadingNewer, view.loadingOlder]);
  const timelineDragBegin = useCallback(() => {
    traceAction("chat_list_drag_begin");
    cancelTurnScroll();
  }, [cancelTurnScroll]);
  const timelineScrollOffset = useCallback((offsetY: number) => trackPull({ nativeEvent: { contentOffset: { y: offsetY } } }), [trackPull]);
  const timelineFlight = useMemo(() => {
    if (!sendTransition || sendTransition.destination !== "bubble" || queueTransitionActive) return null;
    const sent = sendTransition.message;
    return { matches: (message: MessageRecord) => isSendBubbleMessage(message, sent), source: sendTransition.source };
  }, [queueTransitionActive, sendTransition]);
  const timelineFlightEnd = useCallback(() => setSendTransition(null), []);
  const timelineLoadOlder = useCallback(() => { void loadOlderTurns(sessionId); }, [loadOlderTurns, sessionId]);
  const timelineLoadNewer = useCallback(() => { void loadNewerTurns(sessionId); }, [loadNewerTurns, sessionId]);
  const handleListDragBegin = useCallback((event: ChatScrollEvent) => { trackPullStart(event); handleScrollBeginDrag(); }, [handleScrollBeginDrag, trackPullStart]);
  const handleListDragEnd = useCallback((event: ChatScrollEvent) => { trackPullEnd(); handleScrollEndDrag(event); }, [handleScrollEndDrag, trackPullEnd]);
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
    const placement = botLayout?.get(item.id);
    const writer = bot ? botMessageSpace(item, sequenceTurns?.[0] ?? messageTurn) : null;
    return <View ref={(row) => trackRow(messageRowKey(item), row)} collapsable={false} style={bot ? placement?.gap ? { paddingTop: placement.gap } : undefined : item.role === "user" ? TURN_START_STYLE : undefined} onLayout={(event) => { const { height } = event.nativeEvent.layout; if (chatScrollTrace.isRecording()) trace("row.layout", { message: chatScrollTrace.alias("message", item.id), index, sequence, ...event.nativeEvent.layout }); const measurement = rowHeightMeasurement(measuredMessages, chronologicalIndex, item.id, height); if (measurement) measurements.measure(measurement.message, measurement.height); }}><ArrivalRow arrival={isCatchUpArrival(arrivalBaseline, item) && !isTransitionMessage} reducedMotion={reducedMotion}>{bot ? <>{placement?.time ? <BotTimeDivider at={placement.time} /> : null}{writer
      ? <BotNoteBubble message={item} spaceId={spaceId || null} availableWidth={listWidth || paneWidth} sender={botSender(botPeers, writer, spaceId, t("bots.otherBot"))} />
      : <MessageBubble message={item} local={item.meta?.optimistic === true} hidden={isTransitionMessage} bubbleRef={isTransitionMessage ? sendBubbleRef : undefined} availableWidth={listWidth || paneWidth} onRetry={retryRow} retryDisabled={retryDisabled} onDiscard={item.meta?.relayFailed === true ? undefined : discardSend} spaceId={spaceId || null} rowInset={BOT_BUBBLE_INSET} />}</>
      : <>{sequenceTurns?.[0] ? <SentFromLink turn={sequenceTurns[0]} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /> : null}<MessageBubble message={item} local={item.meta?.optimistic === true} hidden={isTransitionMessage} bubbleRef={isTransitionMessage ? sendBubbleRef : undefined} availableWidth={listWidth || paneWidth} onCopy={handleCopyMessage} onRetry={retryRow} retryDisabled={retryDisabled} onDiscard={discardSend} onFork={messageTurn && isTerminalTurnStatus(messageTurn.status) ? forkMessage : undefined} forkDisabled={forkingTurnId !== null} forking={forkingTurnId !== null && forkingTurnId === item.meta?.turnId} spaceId={spaceId || null} />{sequenceTurns?.map((entry) => <View key={entry.id}>{isActiveTurnStatus(entry.status) || entry.id === streamTurnId ? <LiveTurnProcess sessionId={sessionId} turn={entry} client={client} spaceId={spaceId} /> : <TurnProcess turn={entry} client={client} spaceId={spaceId} />}<SentToList turn={entry} spaceId={spaceId} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /></View>)}{item.id === replyAnchor ? <LiveReply sessionId={sessionId} showStream={liveStream} pending={pendingReply} processInRow={Boolean(sequenceTurns?.some((entry) => entry.id === streamTurnId))} availableWidth={listWidth || paneWidth} /> : null}{endsForkPrefix ? <ForkedFromDivider origin={forkOrigin.ref} client={client} lookupSession={lookupSession} onOpen={openRelatedSession} /> : null}</>}</ArrivalRow></View>;
  }, [arrivalBaseline, bot, botLayout, botPeers, client, discardSend, forkMessage, forkOrigin, forkingTurnId, handleCopyMessage, retryRow, retryDisabled, listWidth, lookupSession, measuredMessages, measurements, messages, liveStream, openRelatedSession, pendingReply, reducedMotion, replyAnchor, queueTransitionActive, sendBubbleRef, sendTransition, sessionId, spaceId, streamTurnId, t, trace, trackRow, turnsById, turnsBySequence, paneWidth]);

  if (draft && !draftSpace && !sessionId) {
    const failure = spaceLookup.error && !spaceLookup.isFetching ? spaceLookup.error : null;
    if (!failure) return <Screen><TopBar drawn title={t("chat.title")} onBack={() => router.back()} /><LoadingState label={t("chat.draft.loadingSpace")} /></Screen>;
    if (!(failure instanceof HttpError && (failure.status === 404 || failure.status === 403))) return <Screen><TopBar drawn title={t("chat.title")} onBack={() => router.back()} /><View className="flex-1 justify-center"><DataError message={failure.message.trim() || t("chat.draft.loadSpaceFailed")} onRetry={() => void spaceLookup.refetch()} /></View></Screen>;
    return <Screen><TopBar drawn title={t("chat.spaceUnavailable")} onBack={() => router.back()} /><View className="flex-1 items-center justify-center p-6"><Text className="text-body text-fg-muted text-center">{t("chat.spaceUnavailable.body")}</Text></View></Screen>;
  }
  if (view.loading && !session && view.messages.length === 0 && view.turns.length === 0) return <Screen edgeToEdge><EdgeHeader onLayout={onHeaderLayout}><TopBar transparent title={bot ? spaceName : t("chat.title")} onBack={() => { traceBackPress(); router.back(); }} /></EdgeHeader><View style={{ flex: 1, paddingTop: headerHeight }}><ChatThreadPlaceholder kind="opening" /></View></Screen>;
  return <Screen edgeToEdge blurTarget={blurTarget}>
    <View className="flex-1" accessibilityElementsHidden={moreOpen || titleMenuOpen} importantForAccessibility={moreOpen || titleMenuOpen ? "no-hide-descendants" : "auto"}>
    <SpacePanels edgeToEdge key={spaceId || sessionId} chatPanel={!bot} spaceId={spaceId} spaceName={spaceName} spaceAvatarUrl={listedSpaceAvatarUrl ?? view.space?.publicProfile?.avatarUrl} sessions={spaceSessions} client={client} activePanel={activePanel} onActivePanelChange={setActivePanel} onOpenSession={(nextSessionId, target) => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: nextSessionId, ...(target?.turn != null ? { turn: String(target.turn) } : {}), ...(target?.turnId ? { turnId: target.turnId } : {}) } })} onNewChat={() => { if (spaceId) router.push({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId } }); }} onOpenFile={(path) => { if (spaceId) router.push({ pathname: "/space/[spaceId]/file", params: { spaceId, path } }); }} onOpenFilesPage={() => { if (spaceId) router.push({ pathname: "/space/[spaceId]/files", params: { spaceId } }); }}>
      <ScreenBlurTarget attach={attachScreenBlurTarget}><Animated.View ref={sendRootRef} collapsable={false} className="flex-1 min-h-0">
        <EdgeHeader onLayout={onHeaderLayout}>
        {/* A Bot's page is the Bot alone: its face and name, which open its profile, and its work log. */}
        {bot ? <TopBar transparent title={spaceName} onBack={() => { traceBackPress(); router.back(); }} actions={<IconButton name="list-tree" label={t("bots.profile.workLog")} size={38} disabled={!botWork} onPress={() => { if (botWork) router.push({ pathname: "/chat/[sessionId]", params: { sessionId: botWork.id, log: "1" } }); }} />}><BotTitle name={spaceName} avatarUrl={spaceAvatarUrl} onPress={() => router.push({ pathname: "/bot/[spaceId]", params: { spaceId } })} /></TopBar> : !sessionId ? <TopBar transparent title={spaceName} onBack={() => { traceBackPress(); router.back(); }} actions={<><IconButton name="messages" label={t("chat.actions.openChats")} size={38} onPress={() => setActivePanel("chat")} /><IconButton name="folder-open" label={t("chat.actions.openFiles")} size={38} onPress={() => setActivePanel("files")} /></>} /> : <TopBar transparent title={session ? displaySessionTitle(session) : t("chat.title")} subtitle={spaceName} titleRef={titleRef} onTitleLongPress={session ? openTitleMenu : undefined} titleMenu={session ? { menu: "chat-title-actions-menu", actions: titleActions } : undefined} titleLongPressLabel={t("chat.titleActions.open")} onBack={() => { traceBackPress(); router.back(); }} actions={<><IconButton name="list-tree" label={t("chat.turns.open")} size={38} onPress={() => setOverlay("turns")} disabled={view.turnIndex.length === 0 && view.loading} />{nativeMenus ? <NativeMenuButton appearance="bar" icon="more" label={t("chat.more")} sections={chatSections} testID="chat-actions-menu" /> : <MenuAnchor ref={moreButtonRef} open={moreOpen}><IconButton name="more" label={t("chat.more")} size={38} onPress={() => { closeOverlay("titleMenu"); setOverlay("more"); }} /></MenuAnchor>}</>} />}
        <ConnectionBanner visible={connectionUnavailable} />
        {view.error ? <ChatErrorBanner message={view.error} belowConnectionBanner={connectionUnavailable} onRetry={() => void refreshSession(sessionId)} /> : null}
        </EdgeHeader>
        <View ref={listContainerRef} collapsable={false} className="flex-1 min-h-0 bg-background">
        <EdgeBlurTarget attach={attachBlurTarget}>
        {/* Android selectable text must not reposition the timeline when it gains focus. Explicit turn/tail scrolling remains enabled. */}
        <RenderErrorBoundary name="chat-timeline" resetKeys={[listGeneration]} fallback={(failure) => <View className="flex-1" style={{ paddingTop: headerHeight, paddingBottom: footerHeight }}><RenderFailureView {...failure} title={t("ui.renderFailed.chatTitle")} /></View>}>
        {timelineReady && nativeChatTimeline ? <BrandRefreshArea refresh={pullRefresh} top={headerHeight}><NativeChatTimeline
          key={listGeneration}
          ref={timelineRef}
          sessionId={sessionId}
          bot={bot}
          botPeers={botPeers}
          spaceId={spaceId}
          client={client}
          messages={messages}
          turnsById={turnsById}
          turnsBySequence={turnsBySequence}
          streamTurnId={streamTurnId}
          replyAnchor={replyAnchor}
          liveStream={liveStream}
          forkOrigin={forkOrigin}
          hasMoreOlder={view.hasMoreOlder}
          hasMoreNewer={view.hasMoreNewer}
          loadingOlder={view.loadingOlder}
          loadingNewer={view.loadingNewer}
          retryDisabled={retryDisabled}
          pendingReply={pendingReply}
          arrivalBaseline={arrivalBaseline}
          forkingTurnId={forkingTurnId}
          flight={timelineFlight}
          headerHeight={headerHeight}
          footerHeight={footerHeight}
          keyboardCoveredInset={keyboardCoveredInset}
          keyboardFrozen={keyboardFrozen}
          reducedMotion={reducedMotion}
          lookupSession={lookupSession}
          onOpenRelated={openRelatedSession}
          onCopy={handleCopyMessage}
          onRetry={retryRow}
          onDiscard={discardSend}
          onFork={forkMessage}
          onLoadOlder={timelineLoadOlder}
          onLoadNewer={timelineLoadNewer}
          onFollowingChange={setFollowingTail}
          onVisibleMessages={timelineVisible}
          onNearEdge={timelineNearEdge}
          onLoad={handleListLoad}
          onDragBegin={timelineDragBegin}
          onFlightEnd={timelineFlightEnd}
          onScrollOffset={timelineScrollOffset}
          onWidth={setListWidth}
          refreshing={view.refreshing}
          onRefresh={handleListRefresh}
        /></BrandRefreshArea> : timelineReady ? <BrandRefreshArea refresh={pullRefresh} top={headerHeight}><KeyboardAwareLegendList
          key={listGeneration}
          {...traceTouches}
          ref={listRef}
          data={messages}
          extraData={rowExtraData}
          alignItemsAtEnd
          keyboardLiftBehavior="always"
          keyboardOffset={keyboardCoveredInset}
          freeze={listKeyboardFrozen}
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
          scrollEventThrottle={pullRefresh.listScrollEventThrottle}
          onScroll={handleListScroll}
          onScrollBeginDrag={handleListDragBegin}
          onScrollEndDrag={handleListDragEnd}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          contentInsetAdjustmentBehavior="never"
          scrollIndicatorInsets={listIndicatorInsets}
          contentContainerStyle={listContentStyle}
          onContentSizeChange={handleContentSizeChange}
          {...pullRefresh.listProps}
          ListHeaderComponent={<>{pullRefresh.header}{view.hasMoreOlder ? <LoadMoreCapsule icon="chevrons-up" label={t("chat.loadOlder.short")} accessibilityLabel={t("chat.loadOlder")} loading={view.loadingOlder} onPress={() => void loadOlderTurns(sessionId)} /> : null}</>}
          ListFooterComponent={<View>{view.hasMoreNewer ? <LoadMoreCapsule icon="chevrons-down" label={t("chat.loadNewer.short")} accessibilityLabel={t("chat.loadNewer")} loading={view.loadingNewer} onPress={() => void loadNewerTurns(sessionId)} /> : null}{messages.length === 0 ? <LiveReply sessionId={sessionId} showStream={liveStream} pending={pendingReply} processInRow={false} availableWidth={listWidth || paneWidth} /> : null}</View>}
        /></BrandRefreshArea> : null}
        </RenderErrorBoundary>
        {threadPlaceholder ? <KeyboardLiftPadding style={{ position: "absolute", top: headerHeight, right: 0, bottom: footerHeight, left: 0 }}><ChatThreadPlaceholder kind={threadPlaceholder} /></KeyboardLiftPadding> : null}

        </EdgeBlurTarget>
        </View>
        <EdgeFooter keyboard onLayout={onFooterLayout}>
        {/* Outside the measured chrome: in the list footer it moved the followed tail twice per catch-up. */}
        {catchUpLoader && !view.hasMoreNewer && !liveStream ? <View pointerEvents="none" className="absolute left-0 right-0 bottom-full"><ListEdgeLoader label={t("chat.catchingUp")} /></View> : null}
        {!followingTail ? <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fadeOut.duration)} className="absolute right-4 z-4" style={ABOVE_FOOTER_BUTTON}><Pressable accessibilityRole="button" accessibilityLabel={t("chat.jumpLatest")} accessibilityState={{ busy: jumpingToLatest, disabled: jumpingToLatest }} disabled={jumpingToLatest} onPress={() => void jumpToLatest()} className="size-11 items-center justify-center rounded-full shadow-float active:opacity-70"><GlassBackground radius={22} />{jumpingToLatest ? <Loader /> : <AppIcon name="arrow-down" size={18} tone="accent" />}</Pressable></Animated.View> : null}
        {bot && botWorking ? <BotTyping /> : null}
        {queueItems.length > 0 ? <Animated.View entering={footerRowEntering} exiting={FadeOut.duration(motion.fadeOut.duration)} className="px-3 pt-2 pb-2 gap-2">
          <Text className="text-micro font-semibold text-fg-muted">{t("chat.followups", { count: queueItems.length })}</Text>
          <ScrollView ref={queueScrollRef} style={{ maxHeight: 180, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => { if (queueTransitionActive || queueItems.some((item) => item.turn === null)) queueScrollRef.current?.scrollToEnd({ animated: false }); }}>
            {queueItems.map((item) => {
              const turn = item.turn;
              const inFlight = transitionQueueItem?.key === item.key;
              return <QueuedFollowupRow key={item.key} preview={item.preview} pending={!turn || pendingFollowupAction === turn.id} hidden={inFlight} rowRef={inFlight ? sendQueueRef : undefined} onSteer={turn ? () => void runFollowupAction(turn.id, "steer") : undefined} onCancel={turn ? () => void runFollowupAction(turn.id, "cancel") : undefined} />;
            })}
          </ScrollView>
        </Animated.View> : null}
        {attachments.length > 0 ? <View className="px-3 pt-1 bg-background"><View ref={attachmentSourceRef} collapsable={false} style={{ maxHeight: ATTACHMENT_LIST_MAX_HEIGHT }}><ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled" onScroll={(event) => { attachmentScrollYRef.current = event.nativeEvent.contentOffset.y; }}>{attachments.map((attachment, index) => <ComposerAttachmentChip key={`${attachment.uri}-${index}`} target={uploadTarget} attachment={attachment} onRemove={() => { releaseUpload(attachment); setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index)); }} />)}</ScrollView></View></View> : null}
        {/* Only local Harnesses ask for approval, so Cloud-only Chats never read for it. */}
        {sessionId && spaceId && (composerHarness !== "cohub" || view.turns.some((turn) => runtimeHarnessFromTurn(turn) !== "cohub")) ? <SessionApprovals client={client} spaceId={spaceId} sessionId={sessionId} running={running} harnessOf={(turnId) => runtimeHarnessFromTurn(view.turns.find((turn) => turn.id === turnId))} /> : null}
        {billingStopped ? <ComposerNotice icon="wallet" text={t("chat.billingStopped.notice")} action={t("chat.billingStopped.action")} onAction={() => router.push("/settings/billing")} /> : null}
        {archived ? <ComposerNotice icon="archive" text={t("chat.archived.notice")} action={t("session.unarchive")} busy={archiving} onAction={() => void toggleArchive()} /> : null}
        {voice.partial || voice.error ? <VoiceStatusRow error={voice.error} partial={voice.partial} /> : null}
        <ComposerInput onPasteImages={appendAttachments} menuSourceRef={composerMenuSourceRef} harnessSections={harnessMenuSections({ value: composerHarness, status: runtime.status, t, onSelect: setSelectedHarness, onRefresh: () => void runtime.refresh(), execution: executionMenu })} anchorRef={composerRef} measurementRef={composerMeasurementRef} attachmentMenuOpen={attachmentMenuOpen} modelMenuOpen={modelSelectorOpen} showHarnessPicker={!bot && runtime.status?.kind === "local"} harness={composerHarness} harnessMenuOpen={harnessMenuOpen} onHarnessPress={() => { freezeListForComposerMenu(); closeOverlay("model"); setOverlay("harness"); void runtime.refresh(); }} sendFeedback={sendFeedback} value={mentions.displayValue} onChangeText={mentions.onChangeText} onSelectionChange={mentions.onSelectionChange} onFocusChange={handleComposerFocus} onSend={submit} onStop={sessionId ? () => void stopGeneration() : undefined} onAttach={() => { freezeListForComposerMenu(); closeOverlay("model"); closeOverlay("harness"); setOverlay("attachments"); }} attachmentActions={[
          { icon: "camera", title: t("chat.attachment.camera"), onPress: () => void takePhoto() },
          { icon: "images", title: t("chat.attachment.photos"), onPress: () => void pickPhotos() },
          { icon: "paperclip", title: t("chat.attachment.file"), onPress: () => void pickAttachments() },
        ]} sending={starting} onVoice={() => voice.isRecording ? voice.stop() : void voice.start()} variant={bot ? "bot" : "chat"} onModelPress={() => { freezeListForComposerMenu(); closeOverlay("attachments"); if (composerHarness === "cohub") void Promise.all([loadModels(), loadModelStatus()]).catch(() => undefined); else void runtime.refresh(); setOverlay("model"); }} modelLabel={modelLabel} modelDetail={modelTriggerDetail} modelStatus={activeStatus} voiceActive={voice.isRecording} voiceStarting={voice.isStarting} disabled={stopping} running={bot ? botWorking : running} hasAttachment={attachments.length > 0} placeholder={starting ? t("chat.draft.starting") : bot ? (botWorking ? t("ui.composer.working") : t("bots.composer.placeholder", { name: spaceName })) : running ? t("ui.composer.working") : t("ui.composer.placeholder")} />
        </EdgeFooter>
        {mentions.menu || slash.menu ? <EdgeFooterOverlay footerHeight={footerHeight}>
          {mentions.menu ? <SpaceMentionMenu menu={mentions.menu} onSelect={mentions.select} onDismiss={mentions.dismiss} style={FOOTER_MENU} /> : null}
          {slash.menu ? <SlashCommandMenu menu={slash.menu} onSelect={slash.select} onDismiss={slash.dismiss} style={FOOTER_MENU} /> : null}
        </EdgeFooterOverlay> : null}
        {sendTransition && transitionMessage && ((sendTransition.destination === "bubble" && !nativeChatTimeline) || transitionQueueItem) ? <SendBubbleOverlay key={sendTransition.message.id} transition={sendTransition} message={transitionMessage} queueItem={transitionQueueItem} rootRef={sendRootRef} targetRef={queueTransitionActive ? sendQueueRef : sendBubbleRef} availableWidth={listWidth || paneWidth} spaceId={spaceId || null} onComplete={completeSendTransition} /> : null}
        {labelSheetOpen && client && session && spaceId ? <SessionLabelSheet client={client} spaceId={spaceId} session={session} labels={chatLabels} labelsError={chatLabelsError} onLabelsReload={reloadChatLabels} onClose={() => closeOverlay("labels")} onChanged={() => undefined} /> : null}
        <GlassBackdrop target={screenBlurTarget}><MenuPresence open={attachmentMenuOpen}><AttachmentMenu anchorRef={composerMenuSourceRef} onClose={() => closeOverlay("attachments")} onCamera={() => void takePhoto()} onPhotos={() => void pickPhotos()} onFile={() => void pickAttachments()} /></MenuPresence></GlassBackdrop>
        <TurnNavigatorSheet visible={turnNavigatorOpen} turns={view.turnIndex} currentSequence={currentTurnSequence} loading={view.turnIndexLoading} loadingSequence={loadingSequence} onClose={() => closeOverlay("turns")} onJump={(sequence) => handleTurnJump(sequence)} onRetry={() => void loadTurnIndex(sessionId, { force: true }).catch(() => undefined)} />
        <GlassBackdrop target={screenBlurTarget}>{!bot && runtime.status?.kind === "local" ? <HarnessPicker anchorRef={composerMenuSourceRef} value={composerHarness} status={runtime.status} execution={executionMenu} open={harnessMenuOpen} onClose={() => closeOverlay("harness")} onRefresh={() => void runtime.refresh()} onSelect={(harness) => { setSelectedHarness(harness); closeOverlay("harness"); }} /> : null}
        <MenuPresence open={modelSelectorOpen}>{composerHarness === "cohub" ? <ModelSelectorMenu anchorRef={composerMenuSourceRef} models={models} loading={modelsLoading} error={modelsError || modelStatusError} modelStatus={modelStatus?.models ?? null} modelStatusLoading={modelStatusLoading} currentModel={modelOverride ? selectedModel : recordedModel} onClose={() => closeOverlay("model")} onRetry={() => void Promise.all([loadModels({ force: true }), loadModelStatus({ force: true })]).catch(() => undefined)} onSelect={(model) => { setSelectedModel(model); setModelOverride(true); closeOverlay("model"); }} /> : <ModelSelectorMenu anchorRef={composerMenuSourceRef} title={t("model.runtimeTitle", { harness: harnessLabel(composerHarness) })} automaticLabel={t("model.runtimeAutomatic")} automaticDetail={t("model.runtimeAutomaticDetail")} models={runtimeCatalogModels(runtime.status, composerHarness)} loading={runtime.loading} error={runtime.error} currentModel={activeModel} onClose={() => closeOverlay("model")} onRetry={() => void runtime.refresh()} onSelect={(model) => { setLocalModelsByHarness((current) => ({ ...current, [composerHarness]: model })); closeOverlay("model"); }} />}</MenuPresence></GlassBackdrop>
        <NoticeSheet notice={notice} fallbackTitle={t("common.notice")} onClose={() => setNotice(null)} testID="chat-notice-sheet" />
        <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => closeOverlay("rename")}>
          {/* A Modal is its own window, so the core avoider (keyboard events) rather than the app-level one. */}
          <RNKeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            <Pressable accessible={false} onPress={() => closeOverlay("rename")} className="flex-1 justify-center p-6" style={SCRIM}>
              {/* Claims the touch so a tap inside the dialog does not reach the scrim. */}
              <View onStartShouldSetResponder={() => true} className="gap-4 rounded-lg bg-surface p-5" style={{ borderCurve: "continuous" }}>
                <Text className="text-headline font-semibold text-fg">{t("chat.rename.title")}</Text>
                <TextInput autoFocus value={renameValue} onChangeText={setRenameValue} editable={!renameSaving} maxLength={RENAME_MAX_LENGTH} returnKeyType="done" onSubmitEditing={() => void saveRename()} placeholder={t("chat.rename.placeholder")} placeholderTextColor={theme.colors.textFaint} className={FIELD_INPUT_CLASS} />
                <View className="flex-row justify-end gap-2"><PrimaryButton variant="ghost" label={t("common.cancel")} onPress={() => closeOverlay("rename")} /><PrimaryButton label={t("common.save")} loading={renameSaving} onPress={() => void saveRename()} /></View>
              </View>
            </Pressable>
          </RNKeyboardAvoidingView>
          <ToastViewport />
        </Modal>
      </Animated.View></ScreenBlurTarget>
    </SpacePanels>
    </View>
    {/* The header hides the timeline under it, so its menus refract the whole screen rather than that hidden text. */}
    <GlassBackdrop target={screenBlurTarget}>
    <MenuPresence open={titleMenuOpen}><AnchoredActionMenu
      anchorRef={titleRef}
      title={session ? displaySessionTitle(session) : t("chat.title")}
      testID="chat-title-actions-menu"
      onClose={closeTitleMenu}
      actions={titleActions}
    /></MenuPresence>
    <MenuPresence open={moreOpen}><AnchoredActionMenu
      anchorRef={moreButtonRef}
      title={session ? displaySessionTitle(session) : t("chat.title")}
      testID="chat-actions-menu"
      onClose={closeMore}
      sections={chatSections}
    /></MenuPresence>
    </GlassBackdrop>
  </Screen>;
}

function clientMessageIdOf(message: MessageRecord) {
  return typeof message.meta?.clientMessageId === "string" ? message.meta.clientMessageId : null;
}

function withMember(id: string, member: boolean) {
  return (current: ReadonlySet<string>): ReadonlySet<string> => {
    const next = new Set(current);
    if (member) next.add(id);
    else next.delete(id);
    return next;
  };
}

/**
 * Live step list for an active turn. Subscribing to the stream here instead of inside
 * `renderItem` keeps the row list's callback identity stable, so stream batches stop
 * re-rendering every mounted cell. The fallback matches the persisted turn process.
 */
function LiveTurnProcess({ sessionId, turn, client, spaceId }: { sessionId: string; turn: SessionTurnRecord; client: CohubClient | null; spaceId: string }) {
  const stream = useSessionStream(sessionId);
  const thinking = thinkingBlocks(stream?.contentBlocks);
  if (stream?.turnId === turn.id && (stream.intermediateMessages.length > 0 || thinking.length > 0)) return <StreamingTurnProcess messages={stream.intermediateMessages} thinking={thinking} />;
  return <TurnProcess turn={turn} client={client} spaceId={spaceId} />;
}

function LiveReply({ sessionId, showStream, pending, processInRow, availableWidth }: { sessionId: string; showStream: boolean; pending: boolean; processInRow: boolean; availableWidth: number }) {
  const stream = useSessionStream(sessionId);
  const streamStartedAt = useAppSelector(({ state }) => {
    const turn = stream?.turnId ? state.sessionViews[sessionId]?.turns.find((item) => item.id === stream.turnId) : undefined;
    return turn ? turn.startedAt ?? turn.createdAt : null;
  });
  if (showStream && stream) return <View testID="chat-live-reply">
    {!processInRow ? <StreamingTurnProcess messages={stream.intermediateMessages} thinking={thinkingBlocks(stream.contentBlocks)} /> : null}
    <StreamCard content={stream.contentBlocks} status={stream.status} runtimePhase={stream.runtimePhase} runtimeModel={stream.runtimeModel} startedAt={stream.outputAt ?? streamStartedAt} availableWidth={availableWidth} />
  </View>;
  return pending ? <StreamCard content={[]} status="pending" availableWidth={availableWidth} /> : null;
}

function ChatThreadPlaceholder({ kind }: { kind: "opening" | "empty" | "draft" }) {
  const { t } = useTranslation();
  if (kind === "opening") return <LoadingState label={t("chat.placeholder.opening")} />;
  if (kind === "draft") return (
    <View className="flex-1 items-center justify-center px-7 pb-4">
      <Mascot size={84} blink />
      <Text className="mt-4 text-center text-headline font-semibold text-fg">{t("chat.draft.title")}</Text>
      <Text className="text-body text-fg-muted mt-2 max-w-72 text-center">{t("chat.draft.body")}</Text>
      <Text className="text-caption text-fg-faint mt-4">{t("chat.draft.subtitle")}</Text>
    </View>
  );
  return (
    <View className="flex-1 items-center justify-center p-7">
      <Mascot size={72} />
      <Text className="text-headline font-semibold text-fg mt-4 text-center">{t("chat.placeholder.empty.title")}</Text>
      <Text className="text-body text-fg-muted text-center mt-2 max-w-72">{t("chat.placeholder.empty.body")}</Text>
    </View>
  );
}

/** The model the Chat last ran with, from the newest agent Turn or, before any, the newest reply. */
function recordedChatModel(turnsNewestFirst: readonly SessionTurnRecord[], messages: readonly MessageRecord[], models: readonly ModelCatalogEntry[]): ChatModelSelection | null {
  const selection = (provider: string, id: string, meta: unknown): ChatModelSelection => {
    const name = models.find((item) => item.provider === provider && item.id === id)?.model?.name;
    const requestedLevel = requestedThinkingLevel(meta);
    return { provider, id, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}), ...(requestedLevel ? { thinkingLevel: requestedLevel } : {}) };
  };
  const turn = turnsNewestFirst.find((item) => isAgentTurn(item) && item.provider !== "generation");
  if (turn) return turn.model ? selection(turn.provider || "cohub", turn.model, turn.meta) : null;
  const message = messages.findLast((item) => item.meta?.messageKind !== "generation_result" && item.provider !== "generation" && (Boolean(item.model) || item.role === "assistant"));
  return message?.model ? selection(message.provider || "cohub", message.model, message.meta) : null;
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

/** A state of the Chat the composer answers, with the one action that changes it. */
function ComposerNotice({ icon, text, action, busy = false, onAction }: { icon: IconName; text: string; action: string; busy?: boolean; onAction: () => void }) {
  return <Animated.View entering={footerRowEntering} exiting={FadeOut.duration(motion.fadeOut.duration)} accessibilityRole="summary" className="flex-row items-center gap-2 bg-background pl-4 pr-2">
    <AppIcon name={icon} size={14} tone="muted" />
    <Text className="flex-1 text-caption text-fg-muted">{text}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onAction} className="min-h-11 justify-center px-2 active:opacity-70 disabled:opacity-55">
      <Text className="text-caption font-semibold text-accent">{action}</Text>
    </Pressable>
  </Animated.View>;
}

function VoiceStatusRow({ error, partial }: { error: string | null; partial: string }) {
  const { t } = useTranslation();
  return <Animated.View entering={footerRowEntering} exiting={FadeOut.duration(motion.fadeOut.duration)} className="bg-background px-4 pt-1">
    <Text className={`text-caption ${error ? "text-danger" : "text-fg-muted"}`}>{error ? error : t("chat.listening", { text: partial })}</Text>
  </Animated.View>;
}

/** Floats under the header like ConnectionBanner, so it never changes the header height the list is laid out against. */
function ChatErrorBanner({ message, belowConnectionBanner, onRetry }: { message: string; belowConnectionBanner: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return <Animated.View entering={FadeIn.duration(motion.fade.duration)} exiting={FadeOut.duration(motion.fadeOut.duration)} pointerEvents="box-none" className="absolute left-4 right-4 top-full" style={{ marginTop: belowConnectionBanner ? 48 : 8 }}>
    <View accessibilityRole="alert" className="flex-row items-center gap-2 rounded-md bg-danger-soft py-1 pl-3 pr-1 shadow-float" style={{ borderCurve: "continuous" }}>
      <AppIcon name="alert" size={16} tone="danger" />
      <Text selectable numberOfLines={3} className="flex-1 text-caption text-danger">{message}</Text>
      <IconButton name="refresh" label={t("common.retry")} tone="danger" onPress={onRetry} />
    </View>
  </Animated.View>;
}

/** Pagination control at either end of the thread: a short centered capsule, the full action spoken. */
function LoadMoreCapsule({ icon, label, accessibilityLabel, loading, onPress }: { icon: IconName; label: string; accessibilityLabel: string; loading: boolean; onPress: () => void }) {
  return <View className="items-center py-2">
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ busy: loading, disabled: loading }} disabled={loading} onPress={onPress} hitSlop={4} className="min-h-10 flex-row items-center gap-2 rounded-full bg-surface-raised px-4 active:bg-surface-pressed">
      {loading ? <Loader /> : <AppIcon name={icon} size={16} tone="accent" />}
      <Text className="text-caption font-semibold text-accent">{label}</Text>
    </Pressable>
  </View>;
}

// design-system: modal scrims dim whatever theme sits underneath, so they stay black.
const SCRIM = { backgroundColor: "rgba(0,0,0,0.6)" } as const;

/**
 * Uploads composer attachments as they are added, so sending does not wait on them. Removing a chip,
 * or leaving with attachments still in the composer, stops their unsent uploads.
 */
function useComposerUploads(spaceId: string, sessionId: string | undefined, attachments: AttachmentDraft[]) {
  const { prepareAttachments, releaseAttachments } = useAppActions();
  const target = useMemo<UploadTarget | null>(() => spaceId ? { spaceId, ...(sessionId ? { sessionId } : {}) } : null, [sessionId, spaceId]);
  useEffect(() => {
    if (target && attachments.length > 0) prepareAttachments(target, attachments);
  }, [attachments, prepareAttachments, target]);
  const latest = useRef({ target, attachments });
  useEffect(() => { latest.current = { target, attachments }; }, [attachments, target]);
  useEffect(() => () => {
    const { target: current, attachments: pending } = latest.current;
    if (current) releaseAttachments(current, pending);
  }, [releaseAttachments]);
  const release = (attachment: AttachmentDraft) => { if (target) releaseAttachments(target, [attachment]); };
  return { target, release };
}

function ComposerAttachmentChip({ target, attachment, onRemove }: { target: UploadTarget | null; attachment: AttachmentDraft; onRemove: () => void }) {
  const { t } = useTranslation();
  const showToast = useToast();
  const upload = useAttachmentUploadState(target, attachment.uri);
  const preview = () => {
    void previewLocalFile(attachment.uri, { title: attachment.name, mimeType: attachment.mimeType }).then(
      (shown) => { if (!shown) showToast({ title: t("ui.attachment.previewUnavailable"), tone: "neutral" }); },
      (error: unknown) => showToast({ title: t("ui.attachment.previewUnavailable"), message: error instanceof Error ? error.message : undefined, tone: "danger" }),
    );
  };
  return <AttachmentChip name={attachment.name} uri={attachment.uri} mimeType={attachment.mimeType} upload={upload} onPreview={preview} onRemove={onRemove} />;
}
