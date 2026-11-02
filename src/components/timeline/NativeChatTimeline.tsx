import type { CohubClient, MessageRecord, SessionRecord, SessionTurnRecord } from "@neta-art/cohub";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Platform, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import type { ChatTimelineViewRef, TimelineFlight, TimelineNode, TimelineRowSpec, TimelineScrollEvent } from "@/modules/cohub-chat-timeline";
import { useOpenMessageLink } from "@/src/components/MessageContent";
import { turnStepsQuery } from "@/src/components/TurnProcess";
import { isCatchUpArrival } from "@/src/components/use-chat-catch-up";
import { useRevealedStreamText } from "@/src/components/useRevealedStreamText";
import { arrivalAnimations, assistantMessageNode, compactionNode, EMPTY_NODE, forkDividerNode, loadMoreNode, SEND_FLIGHT_EASING, sentFromNode, sentToNode, streamCardNode, streamingProcessNode, systemMessageNode, turnProcessNode, userMessageNode, type NodeContext, type StepsState } from "@/src/components/timeline/nodes";
import { answerBlocks, thinkingBlocks } from "@/src/data/chat-rendering";
import { CHAT_PAGE_THRESHOLD, CHAT_TAIL_THRESHOLD } from "@/src/data/chat-scroll";
import { isActiveTurnStatus, isTerminalTurnStatus } from "@/src/data/chat-stream";
import { timelineRows, timelineTargetKey, visibleTimelineMessages, type TimelineRow } from "@/src/data/chat-timeline-rows";
import { compactionFromMessage } from "@/src/data/compaction";
import { useAppSelector, useSessionStream } from "@/src/data/context";
import { debugAlias, record as recordDebugEvent } from "@/src/data/debug-session";
import { isOptimisticFollowup } from "@/src/data/followup-queue";
import { setImageViewerPayload } from "@/src/data/image-viewer";
import { sentFrom, sentSessions, type RelatedSessionRef } from "@/src/data/related-sessions";
import { useRelatedSessions } from "@/src/data/use-related-session";
import { useTranslation } from "@/src/i18n";
import { ChatTimelineView } from "@/src/platform/chat-timeline";
import { motion } from "@/src/motion";
import { useAppTheme } from "@/src/theme";
import { contentText, displaySessionTitle, hasRenderableMessage, messageText } from "@/src/utils";

const COPIED_MS = 1600;
const TURN_START_PADDING = 8;
const TARGET_POSITION = { viewPosition: 0.15, viewOffset: 8 };
const IDLE_STEPS: StepsState = { status: "idle", content: null, error: null };
const ROWS_RETRY_LIMIT = 5;
const SCROLL_LOG_MS = 250;

export type NativeChatTimelineHandle = {
  scrollToEnd(animated: boolean): void;
  /** Resolves false when the message has no row yet. */
  scrollToMessage(messageKey: string, animated: boolean): Promise<boolean>;
};

export type VisibleMessage = { message: MessageRecord; index: number; key: string };

type Props = {
  sessionId: string;
  spaceId: string;
  client: CohubClient | null;
  messages: MessageRecord[];
  turnsById: ReadonlyMap<string, SessionTurnRecord>;
  turnsBySequence: ReadonlyMap<number, SessionTurnRecord[]>;
  streamTurnId: string | null;
  replyAnchor: string | null;
  liveStream: boolean;
  forkOrigin: { sequence: number; ref: RelatedSessionRef } | null;
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  historyLoaded: boolean;
  arrivalBaseline: ReadonlySet<string> | null;
  forkingTurnId: string | null;
  /** The just-sent message flies from the composer onto its bubble. */
  flight: { matches: (message: MessageRecord) => boolean; source: { x: number; y: number; width: number; height: number } } | null;
  headerHeight: number;
  footerHeight: number;
  keyboardCoveredInset: number;
  keyboardFrozen: boolean;
  reducedMotion: boolean;
  lookupSession: (sessionId: string) => SessionRecord | null;
  onOpenRelated: (ref: RelatedSessionRef) => void;
  onCopy: (text: string) => Promise<void>;
  onRetry: (message: MessageRecord) => void;
  onDiscard: (message: MessageRecord) => void;
  onFork: (message: MessageRecord) => void;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  onFollowingChange: (following: boolean) => void;
  onVisibleMessages: (visible: VisibleMessage[]) => void;
  onNearEdge: (edge: "older" | "newer") => void;
  onLoad: () => void;
  onDragBegin: () => void;
  onFlightEnd: () => void;
  onScrollOffset: (offsetY: number) => void;
  onWidth: (width: number) => void;
  /** iOS pulls to refresh natively; Android wraps the view in `BrandRefreshArea`. */
  refreshing: boolean;
  onRefresh: () => void;
};

type Cached = { deps: unknown[]; spec: TimelineRowSpec };

function sameDeps(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

/** The bridge rejects `undefined` inside an object; builders use it freely for absent props. */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined) out[key] = withoutUndefined(entry);
  return out as T;
}

/** The expanded disclosures that live in one row, as a cache key for that row only. */
function expandedIn(expanded: ReadonlySet<string>, scopes: readonly string[]) {
  let signature = "";
  for (const id of expanded) if (scopes.some((scope) => id.includes(scope))) signature += `${id}|`;
  return signature;
}

/**
 * Android's Chat timeline, drawn by the native `CohubChatTimeline` view. This component turns the
 * Chat's state into row descriptions and reacts to the view's events; the view recycles, lays out,
 * scrolls, follows the tail, and animates. Only rows whose description changed cross to native.
 */
export const NativeChatTimeline = forwardRef<NativeChatTimelineHandle, Props>(function NativeChatTimeline(props, ref) {
  const { sessionId, spaceId, client, messages, turnsById, turnsBySequence, streamTurnId, replyAnchor, forkOrigin, lookupSession } = props;
  const NativeView = ChatTimelineView!;
  const theme = useAppTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const openLink = useOpenMessageLink(spaceId || null);
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // Whole points: the measured width differs from the window width by a fraction, which would rebuild every row once.
  const rowWidth = Math.round(width || windowWidth);
  const nativeRef = useRef<ChatTimelineViewRef>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedKey) return;
    const timer = setTimeout(() => setCopiedKey(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedKey]);

  // Stream batches re-render this component only; rows other than the live ones keep their cached descriptions.
  const stream = useSessionStream(sessionId);
  const streamStartedAt = useAppSelector(({ state }) => {
    const turn = stream?.turnId ? state.sessionViews[sessionId]?.turns.find((item) => item.id === stream.turnId) : undefined;
    return turn ? turn.startedAt ?? turn.createdAt : null;
  });
  const pendingReply = useAppSelector(({ state }) => {
    const view = state.sessionViews[sessionId];
    return Boolean(view?.sending && !view.messages.some(isOptimisticFollowup));
  });
  const [firstSeenAt] = useState(() => new Date().toISOString());
  const liveAnswer = useMemo(() => answerBlocks(stream?.contentBlocks), [stream?.contentBlocks]);
  const liveTextBlock = liveAnswer.findLast((block) => block.type === "text");
  const liveStatus = stream?.status ?? "";
  const pacedText = useRevealedStreamText(liveTextBlock?.type === "text" ? liveTextBlock.text : "", liveStatus === "pending" || liveStatus === "streaming");

  const rows = useMemo(() => timelineRows({
    messages,
    turnsBySequence,
    forkSequence: forkOrigin?.sequence ?? null,
    replyAnchor,
    streamTurnId,
    isActiveTurn: (turn) => isActiveTurnStatus(turn.status),
    hasMoreOlder: props.hasMoreOlder,
    hasMoreNewer: props.hasMoreNewer,
  }), [forkOrigin?.sequence, messages, props.hasMoreNewer, props.hasMoreOlder, replyAnchor, streamTurnId, turnsBySequence]);
  const rowsRef = useRef<TimelineRow[]>(rows);
  rowsRef.current = rows;

  const relatedRefs = useMemo(() => {
    const refs: RelatedSessionRef[] = [];
    for (const row of rows) {
      if (row.kind === "sentFrom") { const source = sentFrom(row.turn); if (source) refs.push(source); }
      if (row.kind === "sentTo") refs.push(...sentSessions(row.turn, spaceId));
    }
    if (forkOrigin) refs.push(forkOrigin.ref);
    return refs;
  }, [forkOrigin, rows, spaceId]);
  const relatedView = useRelatedSessions(client, relatedRefs, lookupSession);

  const expandedTurns = useMemo(() => [...expanded].flatMap((id) => {
    if (!id.startsWith("steps:")) return [];
    const turn = turnsById.get(id.slice("steps:".length));
    return turn?.intermediateIndex?.messagesObjectKey ? [turn] : [];
  }), [expanded, turnsById]);
  const stepQueries = useQueries({ queries: expandedTurns.map((turn) => ({ ...turnStepsQuery(client, spaceId, turn), enabled: Boolean(client) })) });
  const stepsByTurn = new Map<string, StepsState>();
  expandedTurns.forEach((turn, index) => {
    const query = stepQueries[index];
    if (!query) return;
    stepsByTurn.set(turn.id, { status: query.data ? "ready" : query.error && !query.isFetching ? "error" : "loading", content: query.data ?? null, error: query.error?.message ?? null });
  });
  const stepsSignature = expandedTurns.map((turn) => `${turn.id}:${stepsByTurn.get(turn.id)?.status}:${stepsByTurn.get(turn.id)?.content?.length ?? -1}`).join("|");

  const ctx = useMemo<NodeContext>(() => ({ theme, t, width: rowWidth, fontScale, reducedMotion: props.reducedMotion, expanded }), [expanded, fontScale, props.reducedMotion, rowWidth, t, theme]);
  const cacheRef = useRef(new Map<string, Cached>());
  const { flight, forkingTurnId, historyLoaded, arrivalBaseline } = props;
  const specs = useMemo(() => {
    const cache = cacheRef.current;
    const next = new Map<string, Cached>();
    const out: Record<string, TimelineRowSpec> = {};
    const base = [theme, t, rowWidth, fontScale, props.reducedMotion];
    const firstOfOwner = new Set<string>();
    const appear = arrivalAnimations(props.reducedMotion);
    const messageByKey = new Map<string, MessageRecord>();
    for (const row of rows) if (row.kind === "message") messageByKey.set(row.key, row.message);
    for (const row of rows) {
      const owner = row.owner ? messageByKey.get(row.owner) : undefined;
      const turnStart = row.owner !== null && !firstOfOwner.has(row.owner) && owner?.role === "user";
      if (row.owner) firstOfOwner.add(row.owner);
      const arrival = owner ? isCatchUpArrival(arrivalBaseline, owner) : false;
      const build = (deps: unknown[], make: () => { type: string; node: TimelineNode | null; flight?: TimelineFlight; anchor?: false }) => {
        const all = [...base, turnStart, arrival, ...deps];
        const cached = cache.get(row.key);
        if (cached && sameDeps(cached.deps, all)) {
          next.set(row.key, cached);
          out[row.key] = cached.spec;
          return;
        }
        const made = make();
        const node = made.node ?? EMPTY_NODE;
        const spec: TimelineRowSpec = {
          type: made.type,
          ...(made.anchor === false ? { anchor: false } : {}),
          node: turnStart ? { type: "view", style: { paddingTop: TURN_START_PADDING }, children: [node] } : node,
          ...(arrival ? { appear } : {}),
          ...(made.flight ? { flight: made.flight } : {}),
        };
        next.set(row.key, { deps: all, spec });
        out[row.key] = spec;
      };
      switch (row.kind) {
        case "older":
        case "newer": {
          const loading = row.kind === "older" ? props.loadingOlder : props.loadingNewer;
          build([loading], () => ({ type: "capsule", node: loadMoreNode(ctx, row.kind, loading), anchor: false }));
          break;
        }
        case "message": {
          const message = row.message;
          const sig = expandedIn(expanded, [message.id, row.key]);
          if (message.role === "user") {
            const flies = flight && flight.matches(message) ? flight.source : null;
            build([message, historyLoaded, sig, flies], () => ({
              type: "user",
              node: hasRenderableMessage(message) ? userMessageNode(ctx, message, { local: message.meta?.optimistic === true, retryDisabled: !historyLoaded, topPadding: 0 }) : null,
              flight: flies ? { nodeId: "bubble", ...flies, duration: motion.sendBubble.duration, easing: SEND_FLIGHT_EASING } : undefined,
            }));
          } else {
            const turnId = typeof message.meta?.turnId === "string" ? message.meta.turnId : null;
            const turn = turnId ? turnsById.get(turnId) ?? null : null;
            const canFork = Boolean(turn && isTerminalTurnStatus(turn.status));
            const copied = copiedKey === row.key;
            const forking = forkingTurnId !== null && forkingTurnId === turnId;
            build([message, sig, canFork, copied, forkingTurnId !== null, forking], () => {
              const compaction = compactionFromMessage(message);
              if (compaction && (message.content ?? []).every((block) => block.type === "system_note")) return { type: "compaction", node: compactionNode(ctx, row.key, compaction) };
              if (!hasRenderableMessage(message)) return { type: "empty", node: null };
              if (message.role === "system") return { type: "system", node: systemMessageNode(ctx, message) };
              return { type: "assistant", node: assistantMessageNode(ctx, row.key, message, { copied, canFork, forkDisabled: forkingTurnId !== null, forking }) };
            });
          }
          break;
        }
        case "sentFrom": {
          const source = sentFrom(row.turn);
          const view = source ? relatedView(source.sessionId) : null;
          build([source?.sessionId, view], () => ({ type: "related", node: source && view ? sentFromNode(ctx, source, view, displaySessionTitle) : null }));
          break;
        }
        case "sentTo": {
          const sessions = sentSessions(row.turn, spaceId);
          const views = sessions.map((session) => relatedView(session.sessionId));
          build([row.turn.meta, expandedIn(expanded, [`sentTo:${row.turn.id}`]), ...views], () => ({ type: "related", node: sentToNode(ctx, row.turn.id, sessions, relatedView, displaySessionTitle) }));
          break;
        }
        case "fork": {
          const view = forkOrigin ? relatedView(forkOrigin.ref.sessionId) : null;
          build([forkOrigin?.ref, view], () => ({ type: "fork", node: forkOrigin && view ? forkDividerNode(ctx, forkOrigin.ref, view, displaySessionTitle) : null }));
          break;
        }
        case "process": {
          const turn = row.turn;
          const sig = expandedIn(expanded, [turn.id]);
          const thinking = row.live && stream?.turnId === turn.id ? thinkingBlocks(stream.contentBlocks) : [];
          if (row.live && stream?.turnId === turn.id && (stream.intermediateMessages.length > 0 || thinking.length > 0)) {
            // Collapsed, only the step count shows, so token batches do not touch this row.
            const open = expanded.has(`steps:${turn.id}`);
            build([stream.intermediateMessages, open ? stream.contentBlocks : thinking.length > 0, sig, "live"], () => ({ type: "process", node: streamingProcessNode(ctx, turn.id, stream.intermediateMessages, thinking) }));
          } else {
            const steps = stepsByTurn.get(turn.id) ?? IDLE_STEPS;
            build([turn, sig, steps.status, steps.content, Boolean(client)], () => ({ type: "process", node: turnProcessNode(ctx, turn, steps, Boolean(client)) }));
          }
          break;
        }
        case "live": {
          const show = props.liveStream && stream;
          build([show ? stream : null, show ? pacedText : null, pendingReply, row.processInRow, streamStartedAt, expandedIn(expanded, ["live", stream?.turnId ?? "-"])], () => {
            if (show) {
              const live = stream.status === "pending" || stream.status === "streaming";
              const card = streamCardNode(ctx, { content: stream.contentBlocks, status: stream.status, runtimePhase: stream.runtimePhase, runtimeModel: stream.runtimeModel, startedAt: streamStartedAt ?? firstSeenAt, streamingText: live ? pacedText : null });
              const process = row.processInRow ? null : streamingProcessNode(ctx, stream.turnId ?? "live", stream.intermediateMessages, thinkingBlocks(stream.contentBlocks));
              return { type: "live", node: { type: "view", children: process ? [process, card] : [card] } };
            }
            return { type: "live", node: pendingReply ? streamCardNode(ctx, { content: [], status: "pending", runtimePhase: null, runtimeModel: null, startedAt: firstSeenAt, streamingText: null }) : null };
          });
          break;
        }
      }
    }
    cacheRef.current = next;
    return { keys: rows.map((row) => row.key), rows: out };
    // `stepsByTurn` is summarized by `stepsSignature`; `ctx` by its parts in `base`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ctx, expanded, copiedKey, flight, forkingTurnId, historyLoaded, arrivalBaseline, relatedView, stream, pacedText, pendingReply, streamStartedAt, stepsSignature, props.loadingOlder, props.loadingNewer, props.liveStream, client, spaceId, forkOrigin, turnsById]);

  // Only descriptions whose identity changed cross the bridge.
  const sentRef = useRef(new Map<string, TimelineRowSpec>());
  const sentKeysRef = useRef<string[]>([]);
  // A call made before the native view mounts is rejected; nothing else may change to resend it.
  const [resend, setResend] = useState(0);
  const rowsFailuresRef = useRef(0);
  useEffect(() => {
    const view = nativeRef.current;
    if (!view) return;
    const changed: Record<string, TimelineRowSpec> = {};
    let any = false;
    for (const key of specs.keys) {
      const spec = specs.rows[key]!;
      if (sentRef.current.get(key) !== spec) {
        changed[key] = withoutUndefined(spec);
        any = true;
      }
    }
    const previous = sentKeysRef.current;
    const sameKeys = previous.length === specs.keys.length && previous.every((key, index) => key === specs.keys[index]);
    if (!any && sameKeys) return;
    const sent = new Map<string, TimelineRowSpec>();
    for (const key of specs.keys) sent.set(key, specs.rows[key]!);
    sentRef.current = sent;
    sentKeysRef.current = specs.keys;
    view.setRows(specs.keys, changed).then(() => { rowsFailuresRef.current = 0; }, (error: unknown) => {
      // Native kept its previous rows, so the next attempt sends every row again.
      sentRef.current = new Map();
      sentKeysRef.current = [];
      const attempt = ++rowsFailuresRef.current;
      recordDebugEvent("chat.timeline.rows_failed", { attempt, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
      if (attempt <= ROWS_RETRY_LIMIT) requestAnimationFrame(() => setResend((count) => count + 1));
    });
  }, [specs, resend]);

  const { onCopy, onRetry, onDiscard, onFork, onOpenRelated, onLoadOlder, onLoadNewer } = props;
  const handleAction = useCallback(({ nativeEvent }: { nativeEvent: { key: string | null; action: string; payload: Record<string, unknown> | null } }) => {
    const { key, action, payload } = nativeEvent;
    const row = key ? rowsRef.current.find((item) => item.key === key) : undefined;
    const message = row?.kind === "message" ? row.message : undefined;
    switch (action) {
      case "toggle": {
        const id = payload?.id;
        if (typeof id !== "string") return;
        setExpanded((current) => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        });
        return;
      }
      case "copy":
        if (message && key) {
          const text = thinkingBlocks(message.content).length > 0 ? contentText(answerBlocks(message.content)).trim() : messageText(message);
          void onCopy(text).then(() => setCopiedKey(key), () => setCopiedKey(null));
        }
        return;
      case "fork":
        if (message) onFork(message);
        return;
      case "retry":
        if (message) onRetry(message);
        return;
      case "discard":
        if (message) onDiscard(message);
        return;
      case "openSession":
        if (payload && typeof payload.sessionId === "string" && typeof payload.spaceId === "string") onOpenRelated({ spaceId: payload.spaceId, sessionId: payload.sessionId, turnId: typeof payload.turnId === "string" ? payload.turnId : "" });
        return;
      case "loadOlder":
        onLoadOlder();
        return;
      case "loadNewer":
        onLoadNewer();
        return;
      case "link":
        if (typeof payload?.url === "string") openLink(payload.url);
        return;
      case "openImage":
        if (Array.isArray(payload?.uris) && typeof payload.index === "number") {
          setImageViewerPayload({ uris: payload.uris as string[], index: payload.index, zoom: false });
          router.push("/image-viewer");
        }
        return;
      case "imageError":
        recordDebugEvent("chat.timeline.image_failed", { session: debugAlias("session", sessionId), stage: payload?.stage ?? null, scheme: payload?.scheme ?? null, host: payload?.host ?? null, status: payload?.status ?? null, error: payload?.error ?? null });
        return;
      case "stepsRetry":
        // A failed query refetches when its disclosure opens again.
        if (typeof payload?.turnId === "string") {
          const id = `steps:${payload.turnId}`;
          setExpanded((current) => { const next = new Set(current); next.delete(id); return next; });
          setTimeout(() => setExpanded((current) => new Set(current).add(id)), 0);
        }
        return;
    }
  }, [onCopy, onDiscard, onFork, onLoadNewer, onLoadOlder, onOpenRelated, onRetry, openLink, router, sessionId]);

  useImperativeHandle(ref, () => ({
    scrollToEnd: (animated) => { void nativeRef.current?.scrollToEnd(animated); },
    scrollToMessage: async (messageKey, animated) => {
      const key = timelineTargetKey(rowsRef.current, messageKey);
      if (!key || !nativeRef.current) return false;
      return nativeRef.current.scrollToKey(key, { animated, ...TARGET_POSITION });
    },
  }), []);

  const { onVisibleMessages, onFollowingChange, onNearEdge, onLoad, onDragBegin, onFlightEnd, onScrollOffset, onWidth } = props;
  const scrollLogRef = useRef({ at: 0, y: 0 });
  const handleScroll = useCallback(({ nativeEvent }: { nativeEvent: TimelineScrollEvent }) => {
    onScrollOffset(nativeEvent.offsetY);
    const now = Date.now();
    if (now - scrollLogRef.current.at < SCROLL_LOG_MS) return;
    // The fields of the JS list's event, so logs from before and after the native timeline compare.
    recordDebugEvent("chat.list.scroll", {
      session: debugAlias("session", sessionId),
      offsetY: Math.round(nativeEvent.offsetY),
      deltaY: Math.round(nativeEvent.offsetY - scrollLogRef.current.y),
      contentHeight: Math.round(nativeEvent.contentHeight),
      viewportHeight: Math.round(nativeEvent.viewportHeight),
      following: nativeEvent.following,
      distanceToLatest: nativeEvent.distanceToLatest === null ? null : Math.round(nativeEvent.distanceToLatest),
      dragging: nativeEvent.dragging,
      momentum: nativeEvent.momentum,
    });
    scrollLogRef.current = { at: now, y: nativeEvent.offsetY };
  }, [onScrollOffset, sessionId]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
    onWidth(event.nativeEvent.layout.width);
  }, [onWidth]);
  const contentInset = useMemo(() => ({ top: props.headerHeight + 12, bottom: props.footerHeight + 12 }), [props.footerHeight, props.headerHeight]);
  const viewportInset = useMemo(() => ({ top: props.headerHeight, bottom: props.footerHeight }), [props.footerHeight, props.headerHeight]);
  const thresholds = useMemo(() => ({ follow: CHAT_TAIL_THRESHOLD, page: CHAT_PAGE_THRESHOLD, visibleFraction: 0.2, scrollEventThrottle: 100 }), []);
  const keyboard = useMemo(() => ({ enabled: !props.keyboardFrozen, coveredInset: props.keyboardCoveredInset }), [props.keyboardCoveredInset, props.keyboardFrozen]);

  return <View className="flex-1" onLayout={handleLayout} collapsable={false}>
    <NativeView
      ref={nativeRef}
      style={{ flex: 1 }}
      contentInset={contentInset}
      viewportInset={viewportInset}
      thresholds={thresholds}
      detached={props.hasMoreNewer}
      keyboard={keyboard}
      onRowAction={handleAction}
      onVisibleRows={({ nativeEvent }) => onVisibleMessages(visibleTimelineMessages(rowsRef.current, nativeEvent.keys))}
      onFollowingChange={({ nativeEvent }) => onFollowingChange(nativeEvent.following)}
      onNearEdge={({ nativeEvent }) => onNearEdge(nativeEvent.edge)}
      onTimelineLoad={() => onLoad()}
      onScrollPhase={({ nativeEvent }) => { if (nativeEvent.phase === "dragBegin") onDragBegin(); }}
      onFlightEnd={() => onFlightEnd()}
      onTimelineScroll={handleScroll}
      {...(Platform.OS === "ios" ? { refreshEnabled: true, refreshing: props.refreshing, onRefresh: props.onRefresh } : null)}
    />
  </View>;
});
