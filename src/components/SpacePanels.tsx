/* eslint-disable react-hooks/immutability -- Reanimated shared values are intentionally mutated by gesture worklets. */
/* eslint-disable react-hooks/set-state-in-effect -- controlled panel state synchronizes the native animation surface. */
import type { CohubClient, SessionListFork, SpaceFsEntry, UserSessionListItem } from "@neta-art/cohub";
import { buildSessionForkTree, type SessionTreePosition } from "@/src/data/session-fork-tree";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LegendList } from "@legendapp/list/react-native";
import { BackHandler, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Reanimated, { cancelAnimation, Extrapolation, interpolate, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, ReduceMotion } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionSearchRow } from "@/src/components/SearchResultRow";
import { SessionForkToggle, SessionRow } from "@/src/components/SessionRow";
import { sessionListStatus } from "@/src/data/session-status";
import { SessionLabelSheet } from "@/src/components/SessionLabelSheet";
import { SpaceFileRow } from "@/src/components/SpaceFileRow";
import { FilterChip } from "@/src/components/FilterChip";
import { edgeChrome, useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { normalizeSearchQuery, useRemoteSearch, type RemoteSessionSearchHit, type SessionNavigationTarget } from "@/src/data/session-search";
import { useApp } from "@/src/data/context";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { reconcileSessionHead } from "@/src/data/session-list-sync";
import {
  fetchLabelSessionIds,
  fetchSessionLabels,
  formatLabelRef,
  sessionSourceGroup,
  toUserSessionLabels,
  type SessionLabel,
  type SessionSourceGroup,
} from "@/src/data/session-labels";
import { PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_VERTICAL_SLOP_PX, panelForScrollOffset, panelSwipeTarget, type PanelName } from "@/src/data/space-panel-pager";
import { record as recordDebugEvent } from "@/src/data/debug-session";
import { chatScrollTrace } from "@/src/data/chat-scroll-trace";
import { AppIcon, Avatar, IconButton, ListEdgeLoader, Loader, LoadingState, PrimaryButton, SearchField, TopBar } from "@/src/ui";
import { normalizeSpacePath, parentSpacePath, sortByRecent, spacePathName } from "@/src/utils";

export type SpacePanel = "chat" | "files";

type SpacePanelsProps = {
  spaceId: string;
  spaceName: string;
  sessions: UserSessionListItem[];
  client: CohubClient | null;
  activePanel: SpacePanel | null;
  onActivePanelChange: (panel: SpacePanel | null) => void;
  onOpenSession: (sessionId: string, target?: SessionNavigationTarget) => void;
  onNewChat: () => void;
  onOpenFile: (path: string) => void;
  onOpenFilesPage: () => void;
  children: ReactNode;
  edgeToEdge?: boolean;
};

const PANEL_WIDTH_RATIO = 0.86;
const MAX_PANEL_WIDTH = 360;
/** A programmatic close has no drag-end event; give the native scroll animation time to land. */
const PANEL_CLOSE_SETTLE_MS = 380;
/** The seed needs one native scroll event; re-issue the scroll, then force-complete the seed. */
const PANEL_SEED_RETRY_MS = 240;
const PANEL_SEED_FORCE_MS = 480;

type SwipePhase = "idle" | "dragging" | "released" | "settled";

const PANEL_SWIPE_SPRING = { duration: 300, dampingRatio: 1, overshootClamping: true } as const;

/**
 * Push-style pager. The native ScrollView never drags itself: it would intercept any drag past
 * its slop, however slanted. A pan that only activates near horizontal drives it instead.
 * Native views that claim the touch (scrolling timeline, text selection, scrollable code blocks;
 * see NestedHorizontalScrollView in modules/react-native-enriched-markdown) cancel the pan. Do not disable the pager for messages
 * containing a fence — that blocks the swipe on almost every reply.
 */
export function SpacePanels({ spaceId, spaceName, sessions, client, activePanel, onActivePanelChange, onOpenSession, onNewChat, onOpenFile, onOpenFilesPage, children, edgeToEdge = false }: SpacePanelsProps) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(280, width * PANEL_WIDTH_RATIO));
  const centerOffset = panelWidth;
  // The right panel aligns to the viewport's right edge, not its left edge.
  const filesOffset = 2 * panelWidth;
  const pagerRef = useAnimatedRef<Reanimated.ScrollView>();
  const scrollOffset = useSharedValue(centerOffset);
  const scrim = useSharedValue(activePanel ? 1 : 0);
  const shownPanel = useSharedValue<PanelName | 0>(activePanel ?? 0);
  const [pagerSwipeEnabled, setPagerSwipeEnabled] = useState(true);
  const [visiblePanel, setVisiblePanel] = useState<PanelName | null>(activePanel);
  const [interactive, setInteractive] = useState(Boolean(activePanel));
  const visiblePanelRef = useRef<PanelName | null>(activePanel);
  const activePanelRef = useRef<PanelName | null>(activePanel);
  const pagerHeaderTouchHeight = (edgeToEdge ? insets.top : 0) + edgeChrome.headerMinHeight;
  const layoutRef = useRef({ width: 0, height: 0, contentWidth: 0 });
  const [pagerReady, setPagerReady] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Compensate inside the viewport until native layout acknowledges the target offset.
  // Translating the ScrollView itself clips away an entire panel-width of the Chat.
  const pagerSeed = useSharedValue(1);
  const pagerLayoutReady = useSharedValue(0);
  const pagerTarget = useSharedValue(activePanel === "chat" ? 0 : activePanel === "files" ? filesOffset : centerOffset);
  const pagerNativeX = useSharedValue(0);
  const pagerObserved = useSharedValue(false);
  const seedFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only changes during a swipe; negative until then so mounting does not scroll.
  const swipeOffset = useSharedValue(-1);
  const swipeOrigin = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  const swipePhase = useSharedValue<SwipePhase>("idle");

  const clearSeedFallback = useCallback(() => {
    if (seedFallbackRef.current === null) return;
    clearTimeout(seedFallbackRef.current);
    seedFallbackRef.current = null;
  }, []);

  // The seed handshake depends on a single native scroll event. When the first chat frame
  // saturates the UI thread, that event can be swallowed (a disabled ScrollView never emits
  // one later), which used to leave the panel swipe dead for the screen's lifetime.
  const armSeedFallback = useCallback((target: number) => {
    clearSeedFallback();
    const tick = (attempt: number) => {
      seedFallbackRef.current = setTimeout(() => {
        seedFallbackRef.current = null;
        // A completed handshake, a newer seed, or an external panel command owns the pager now.
        if (pagerSeed.get() === 0 || pagerTarget.get() !== target) return;
        if (attempt === 0) {
          chatScrollTrace.record("pager.seed.retry", "space-panel", { target });
          pagerRef.current?.scrollTo({ x: target, animated: false });
          tick(1);
          return;
        }
        // Re-issued with no acknowledgement: the scroll commands have landed, so native sits on
        // the target. Stop compensating and enable the gesture instead of waiting forever.
        chatScrollTrace.record("pager.seed.timeout", "space-panel", { target });
        pagerRef.current?.scrollTo({ x: target, animated: false });
        pagerSeed.set(0);
        setPagerReady(true);
      }, attempt === 0 ? PANEL_SEED_RETRY_MS : PANEL_SEED_FORCE_MS);
    };
    tick(0);
    // State setters are stable identities and stay out of the dependency list.
  }, [clearSeedFallback, pagerRef, pagerSeed, pagerTarget]);

  const seedPager = useCallback(() => {
    if (pagerSeed.get() === 0) return;
    const layout = layoutRef.current;
    const ready = layout.height > 0 && Math.abs(layout.width - width) <= 1 && Math.abs(layout.contentWidth - (2 * panelWidth + width)) <= 1;
    pagerLayoutReady.set(ready ? 1 : 0);
    if (!ready) return;
    const panel = activePanelRef.current;
    const target = panel === "chat" ? 0 : panel === "files" ? filesOffset : centerOffset;
    pagerTarget.set(target);
    chatScrollTrace.record("pager.seed.request", "space-panel", { target, viewportWidth: layout.width, contentWidth: layout.contentWidth });
    pagerRef.current?.scrollTo({ x: target, animated: false });
    // A resize can keep the same offset; native scrollTo then emits no new event.
    if (pagerObserved.get() && Math.abs(pagerNativeX.get() - target) <= 1) {
      pagerSeed.set(0);
      setPagerReady(true);
      chatScrollTrace.record("pager.seed.retained", "space-panel", { offset: target });
      return;
    }
    armSeedFallback(target);
  }, [armSeedFallback, centerOffset, filesOffset, pagerLayoutReady, pagerNativeX, pagerObserved, pagerRef, pagerSeed, pagerTarget, panelWidth, width]);

  const acknowledgeSeed = useCallback((offset: number) => {
    if (pagerSeed.get() !== 0 || Math.abs(pagerTarget.get() - offset) > 1) return;
    clearSeedFallback();
    setPagerReady(true);
    chatScrollTrace.record("pager.seed.ready", "space-panel", { offset });
  }, [clearSeedFallback, pagerSeed, pagerTarget]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current === null) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);
  useEffect(() => clearIdleTimer, [clearIdleTimer]);
  useEffect(() => clearSeedFallback, [clearSeedFallback]);

  const showPanel = useCallback((panel: PanelName) => {
    if (visiblePanelRef.current === panel) return;
    visiblePanelRef.current = panel;
    setVisiblePanel(panel);
  }, []);

  const commitOpen = useCallback((panel: PanelName) => {
    activePanelRef.current = panel;
    visiblePanelRef.current = panel;
    setVisiblePanel(panel);
    setInteractive(true);
    onActivePanelChange(panel);
  }, [onActivePanelChange]);

  const commitClosed = useCallback(() => {
    activePanelRef.current = null;
    visiblePanelRef.current = null;
    setVisiblePanel(null);
    setInteractive(false);
    shownPanel.set(0);
    onActivePanelChange(null);
  }, [onActivePanelChange, shownPanel]);

  const settle = useCallback(() => {
    clearIdleTimer();
    if (pagerSeed.get() !== 0) return;
    const panel = panelForScrollOffset(scrollOffset.get(), centerOffset, filesOffset);
    recordDebugEvent("navigation.pager.settled", { panel, offset: Math.round(scrollOffset.get()) });
    if (panel) commitOpen(panel);
    else commitClosed();
  }, [centerOffset, clearIdleTimer, commitClosed, commitOpen, filesOffset, pagerSeed, scrollOffset]);

  const closePanel = useCallback(() => {
    clearIdleTimer();
    cancelAnimation(swipeOffset);
    pagerTarget.set(centerOffset);
    if (pagerSeed.get() !== 0) {
      commitClosed();
      scrim.set(0);
      seedPager();
    } else {
      activePanelRef.current = null;
      onActivePanelChange(null);
      pagerRef.current?.scrollTo({ x: centerOffset, animated: true });
      idleTimer.current = setTimeout(settle, PANEL_CLOSE_SETTLE_MS);
    }
  }, [centerOffset, clearIdleTimer, commitClosed, onActivePanelChange, pagerSeed, pagerTarget, pagerRef, scrim, seedPager, settle, swipeOffset]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const offset = event.contentOffset.x;
      pagerNativeX.value = offset;
      pagerObserved.value = true;
      scrollOffset.value = offset;
      if (pagerSeed.value !== 0) {
        if (pagerLayoutReady.value === 0 || Math.abs(offset - pagerTarget.value) > 1) return;
        pagerSeed.value = 0;
        scheduleOnRN(acknowledgeSeed, offset);
      }
      const distance = Math.abs(offset - centerOffset);
      scrim.value = interpolate(distance, [0, panelWidth], [0, 1], Extrapolation.CLAMP);
      if (distance <= 8) return;
      const panel: PanelName = offset < centerOffset ? "chat" : "files";
      if (shownPanel.value === panel) return;
      shownPanel.value = panel;
      scheduleOnRN(showPanel, panel);
    },
  }, [acknowledgeSeed, centerOffset, pagerLayoutReady, pagerNativeX, pagerObserved, pagerSeed, pagerTarget, panelWidth, scrim, scrollOffset, showPanel, shownPanel]);

  useEffect(() => {
    if (!isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!activePanelRef.current && !visiblePanelRef.current) return false;
      closePanel();
      return true;
    });
    return () => subscription.remove();
  }, [closePanel, isFocused]);

  useLayoutEffect(() => {
    clearIdleTimer();
    pagerSeed.set(1);
    pagerLayoutReady.set(0);
    setPagerReady(false);
    const panel = activePanelRef.current;
    pagerTarget.set(panel === "chat" ? 0 : panel === "files" ? filesOffset : centerOffset);
    seedPager();
  }, [centerOffset, clearIdleTimer, filesOffset, pagerLayoutReady, pagerSeed, pagerTarget, seedPager]);

  useEffect(() => {
    if (activePanelRef.current === activePanel) return;
    activePanelRef.current = activePanel;
    visiblePanelRef.current = activePanel;
    setVisiblePanel(activePanel);
    setInteractive(Boolean(activePanel));
    shownPanel.set(activePanel ?? 0);
    clearIdleTimer();
    cancelAnimation(swipeOffset);
    const target = activePanel === "chat" ? 0 : activePanel === "files" ? filesOffset : centerOffset;
    pagerTarget.set(target);
    if (pagerSeed.get() !== 0) seedPager();
    else pagerRef.current?.scrollTo({ x: target, animated: true });
  }, [activePanel, centerOffset, clearIdleTimer, filesOffset, pagerRef, pagerSeed, pagerTarget, seedPager, shownPanel, swipeOffset]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value * 0.52 }));
  const pagerPaintStyle = useAnimatedStyle(() => {
    if (pagerSeed.value === 0) return { transform: [{ translateX: 0 }] };
    return { transform: [{ translateX: pagerNativeX.value - pagerTarget.value }] };
  });
  const handleSwipeBegin = useCallback(() => {
    recordDebugEvent("navigation.pager.drag_begin", { pagerReady, pagerSwipeEnabled, panel: visiblePanelRef.current });
    clearIdleTimer();
  }, [clearIdleTimer, pagerReady, pagerSwipeEnabled]);
  const handleSwipeEnd = useCallback(() => {
    recordDebugEvent("navigation.pager.drag_end", { pagerReady, pagerSwipeEnabled, offset: Math.round(swipeOffset.get()), panel: visiblePanelRef.current });
  }, [pagerReady, pagerSwipeEnabled, swipeOffset]);
  useAnimatedReaction(() => swipeOffset.get(), (offset) => {
    if (offset >= 0) scrollTo(pagerRef, offset, 0, false);
  }, [pagerRef, swipeOffset]);
  useAnimatedReaction(() => swipePhase.get(), (phase, previous) => {
    if (phase === previous) return;
    if (phase === "dragging") scheduleOnRN(handleSwipeBegin);
    else if (phase === "released") scheduleOnRN(handleSwipeEnd);
    else if (phase === "settled") scheduleOnRN(settle);
  }, [handleSwipeBegin, handleSwipeEnd, settle, swipePhase]);
  const swipe = useMemo(() => Gesture.Pan()
    .enabled(pagerReady && pagerSwipeEnabled)
    .activeOffsetX([-PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_ACTIVATION_PX])
    .failOffsetY([-PANEL_SWIPE_VERTICAL_SLOP_PX, PANEL_SWIPE_VERTICAL_SLOP_PX])
    // Keep the header for the back button and iOS edge-back.
    .hitSlop({ top: -pagerHeaderTouchHeight })
    .onStart((event) => {
      // Continue from the current offset without jumping by the activation travel.
      cancelAnimation(swipeOffset);
      swipeOffset.set(scrollOffset.get());
      swipeStart.set(scrollOffset.get());
      swipeOrigin.set(scrollOffset.get() + event.translationX);
      swipePhase.set("dragging");
    })
    .onUpdate((event) => {
      swipeOffset.set(Math.min(filesOffset, Math.max(0, swipeOrigin.get() - event.translationX)));
    })
    .onEnd((event) => {
      const offset = Math.min(filesOffset, Math.max(0, swipeOrigin.get() - event.translationX));
      const target = panelSwipeTarget(swipeStart.get(), offset, event.velocityX, panelWidth);
      swipeOffset.set(withSpring(target, { ...PANEL_SWIPE_SPRING, velocity: -event.velocityX, reduceMotion: ReduceMotion.System }, (finished) => {
        if (!finished) return;
        scrollOffset.set(target);
        swipePhase.set("settled");
      }));
      swipePhase.set("released");
    }), [filesOffset, pagerHeaderTouchHeight, pagerReady, pagerSwipeEnabled, panelWidth, scrollOffset, swipeOffset, swipeOrigin, swipePhase, swipeStart]);
  const handleChipsTouchChange = useCallback((touching: boolean) => {
    setPagerSwipeEnabled(!touching);
  }, []);

  const pageStyle = (panel: PanelName) => [
    styles.panelPage,
    panel === "chat" ? styles.panelPageLeft : styles.panelPageRight,
    {
      width: panelWidth,
      paddingTop: edgeToEdge ? insets.top : 0,
      paddingBottom: insets.bottom,
    },
  ];

  return (
    <View className="flex-1 min-h-0 overflow-hidden bg-background" collapsable={false}>
      <GestureDetector gesture={swipe}>
      <Reanimated.ScrollView
        ref={pagerRef}
        horizontal
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-background"
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        scrollEventThrottle={16}
        scrollEnabled={false}
        onScroll={scrollHandler}
        onMomentumScrollBegin={clearIdleTimer}
        onMomentumScrollEnd={settle}
        onLayout={({ nativeEvent: { layout } }) => {
          layoutRef.current.width = layout.width;
          layoutRef.current.height = layout.height;
          seedPager();
        }}
        onContentSizeChange={(contentWidth) => {
          layoutRef.current.contentWidth = contentWidth;
          seedPager();
        }}
      >
        {/* Pages fill the pager's own height. Seeding it from the window height overshot by the
            status bar, top inset, and Android navigation bar whenever the pager's onLayout did
            not correct it, which pushed the composer below the visible area. */}
        <Reanimated.View style={[styles.pages, { width: 2 * panelWidth + width }, pagerPaintStyle]}>
          <View
            className="border-border bg-background"
            style={pageStyle("chat")}
            pointerEvents={interactive && visiblePanel === "chat" ? "auto" : "none"}
            accessibilityViewIsModal={interactive && visiblePanel === "chat"}
            accessibilityElementsHidden={!(interactive && visiblePanel === "chat")}
            importantForAccessibility={interactive && visiblePanel === "chat" ? "yes" : "no-hide-descendants"}
          >
            <ChatPanel spaceId={spaceId} spaceName={spaceName} sessions={sessions} client={client} onChipsTouchChange={handleChipsTouchChange} onClose={closePanel} onNewChat={() => { closePanel(); onNewChat(); }} onOpenSession={(sessionId, target) => { closePanel(); onOpenSession(sessionId, target); }} />
          </View>
          <View className="h-full bg-background" style={{ width }} accessibilityElementsHidden={visiblePanel !== null} importantForAccessibility={visiblePanel ? "no-hide-descendants" : "auto"}>
            {children}
            <Reanimated.View style={[styles.backdrop, scrimStyle]} pointerEvents={interactive ? "auto" : "none"}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.close")} className="flex-1" onPress={closePanel} />
            </Reanimated.View>
          </View>
          <View
            className="border-border bg-background"
            style={pageStyle("files")}
            pointerEvents={interactive && visiblePanel === "files" ? "auto" : "none"}
            accessibilityViewIsModal={interactive && visiblePanel === "files"}
            accessibilityElementsHidden={!(interactive && visiblePanel === "files")}
            importantForAccessibility={interactive && visiblePanel === "files" ? "yes" : "no-hide-descendants"}
          >
            <FilesPanel enabled spaceId={spaceId} spaceName={spaceName} client={client} onClose={closePanel} onOpenFile={(path) => { closePanel(); onOpenFile(path); }} onOpenFilesPage={() => { closePanel(); onOpenFilesPage(); }} />
          </View>
        </Reanimated.View>
      </Reanimated.ScrollView>
      </GestureDetector>
    </View>
  );
}

function mergePanelSessions(current: UserSessionListItem[], incoming: UserSessionListItem[], spaceId: string, spaceName: string) {
  const knownSpace = current.find((session) => session.space)?.space ?? { id: spaceId, name: spaceName, slug: null, publicProfile: null };
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    const previous = byId.get(session.id);
    if (previous && Date.parse(previous.updatedAt) > Date.parse(session.updatedAt)) continue;
    byId.set(session.id, { ...previous, ...session, space: session.space ?? previous?.space ?? knownSpace });
  }
  return sortByRecent([...byId.values()]);
}

function isOlderSession(left: UserSessionListItem, right: UserSessionListItem) {
  const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : null;
  const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : null;
  if (leftTime === null && rightTime !== null) return true;
  if (leftTime !== null && rightTime === null) return false;
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime < rightTime;
  return left.id < right.id;
}

function cursorAfterOldestSession(sessions: UserSessionListItem[]) {
  const oldest = sessions.reduce<UserSessionListItem | null>((current, session) => {
    if (!current || isOlderSession(session, current)) return session;
    return current;
  }, null);
  if (!oldest) return null;
  const date = oldest.lastMessageAt ? new Date(oldest.lastMessageAt) : null;
  if (date && !Number.isFinite(date.getTime())) return null;
  return `${date ? date.toISOString() : "null"}|${oldest.id}`;
}

type ChatPanelItem =
  | { kind: "local"; session: UserSessionListItem; fork: SessionListFork | null; tree: SessionTreePosition | null }
  | { kind: "remote"; hit: RemoteSessionSearchHit }
  | { kind: "fork-toggle"; rootId: string; hidden: number; expanded: boolean };

type ChatListFilter =
  | { kind: "all" }
  | { kind: "source"; source: SessionSourceGroup }
  | { kind: "label"; label: SessionLabel; ref: string };

function ChatPanel({ spaceId, spaceName, sessions, client, onChipsTouchChange, onClose, onNewChat, onOpenSession }: { spaceId: string; spaceName: string; sessions: UserSessionListItem[]; client: CohubClient | null; onChipsTouchChange: (touching: boolean) => void; onClose: () => void; onNewChat: () => void; onOpenSession: (sessionId: string, target?: SessionNavigationTarget) => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { state, sync, prefetchSession, refreshSessionStatuses, rememberSessionForks } = useApp();
  const [query, setQuery] = useState("");
  const [expandedForks, setExpandedForks] = useState<ReadonlySet<string>>(() => new Set());
  const [extraSessions, setExtraSessions] = useState<UserSessionListItem[]>([]);
  const [scopeCursor, setScopeCursor] = useState<string | null>(null);
  const [scopeHasMore, setScopeHasMore] = useState(false);
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const tailLoadedRef = useRef(false);
  const scopeGenerationRef = useRef(0);
  useEffect(() => () => { scopeGenerationRef.current += 1; }, [client, spaceId]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<ChatListFilter>({ kind: "all" });
  const [labels, setLabels] = useState<SessionLabel[]>([]);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsReloadToken, setLabelsReloadToken] = useState(0);
  const [labelSessionIds, setLabelSessionIds] = useState<Set<string>>(new Set());
  const [labelSessionsLoading, setLabelSessionsLoading] = useState(false);
  const [labelSessionsError, setLabelSessionsError] = useState<string | null>(null);
  const labelsRequestRef = useRef<Promise<void> | null>(null);
  const labelMembersRequestRef = useRef<Promise<void> | null>(null);
  const labelMembersGeneration = useRef(0);
  const selectedLabelRef = listFilter.kind === "label" ? listFilter.ref : null;
  const [labelSheetSession, setLabelSheetSession] = useState<UserSessionListItem | null>(null);
  const remoteSearch = useRemoteSearch(client, query, { enabled: Boolean(spaceId), spaceId, types: ["chat"] });
  const displaySessions = useMemo(() => mergePanelSessions(extraSessions, sessions, spaceId, spaceName), [extraSessions, sessions, spaceId, spaceName]);
  const remoteQueryMatches = remoteSearch.query === normalizeSearchQuery(query);

  useEffect(() => {
    setLabels([]);
    setLabelsError(null);
    setListFilter({ kind: "all" });
    setLabelSheetSession(null);
  }, [client, spaceId]);

  const refreshLabels = useCallback((): Promise<void> => {
    if (!client || !spaceId) return Promise.resolve();
    if (labelsRequestRef.current) return labelsRequestRef.current;
    const generation = scopeGenerationRef.current;
    const request = fetchSessionLabels(client, spaceId).then((tree) => {
      if (generation !== scopeGenerationRef.current) return;
      setLabels(toUserSessionLabels(tree));
      setLabelsError(null);
    }).catch((error: unknown) => {
      if (generation === scopeGenerationRef.current) setLabelsError(error instanceof Error ? error.message : t("labels.error"));
      throw error;
    });
    labelsRequestRef.current = request;
    void request.finally(() => { if (labelsRequestRef.current === request) labelsRequestRef.current = null; }).catch(() => undefined);
    return request;
  }, [client, spaceId, t]);
  useSyncScope(`space:${spaceId}:labels`, refreshLabels, 15_000);

  useEffect(() => {
    labelMembersGeneration.current += 1;
    labelMembersRequestRef.current = null;
    setLabelSessionIds(new Set());
    setLabelSessionsError(null);
    setLabelSessionsLoading(selectedLabelRef !== null);
    return () => { labelMembersGeneration.current += 1; };
  }, [client, selectedLabelRef, spaceId]);

  const refreshLabelMembers = useCallback((): Promise<void> => {
    if (!client || selectedLabelRef === null) return Promise.resolve();
    if (labelMembersRequestRef.current) return labelMembersRequestRef.current;
    const generation = labelMembersGeneration.current;
    const request = fetchLabelSessionIds(client, spaceId, selectedLabelRef).then((ids) => {
      if (generation !== labelMembersGeneration.current) return;
      setLabelSessionIds(new Set(ids));
      setLabelSessionsError(null);
    }).catch((error: unknown) => {
      if (generation === labelMembersGeneration.current) setLabelSessionsError(error instanceof Error ? error.message : t("labels.loadedLabeledChatsError"));
      throw error;
    }).finally(() => {
      if (generation === labelMembersGeneration.current) setLabelSessionsLoading(false);
    });
    labelMembersRequestRef.current = request;
    void request.finally(() => { if (labelMembersRequestRef.current === request) labelMembersRequestRef.current = null; }).catch(() => undefined);
    return request;
  }, [client, selectedLabelRef, spaceId, t]);
  useSyncScope(`space:${spaceId}:label-members:${selectedLabelRef}`, refreshLabelMembers, 15_000, selectedLabelRef !== null);

  useEffect(() => {
    sync.invalidate(`space:${spaceId}:labels`);
    sync.invalidatePrefix(`space:${spaceId}:label-members:`);
  }, [labelsReloadToken, spaceId, sync]);

  const openLabelSheet = useCallback((session: UserSessionListItem) => {
    setLabelSheetSession(session);
  }, []);
  const closeLabelSheet = useCallback(() => setLabelSheetSession(null), []);

  const trimmedQuery = normalizeSearchQuery(query);
  const needle = trimmedQuery.toLowerCase();
  const matchesListFilter = (session: UserSessionListItem) => {
    if (listFilter.kind === "all") return true;
    if (listFilter.kind === "source") return sessionSourceGroup(session) === listFilter.source;
    return labelSessionIds.has(session.id);
  };
  const filteredSessions = displaySessions.filter((session) =>
    (!needle || [session.title, session.latestMessageText, session.space?.name].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false)) &&
    matchesListFilter(session),
  );
  const sessionsById = useMemo(() => new Map(displaySessions.map((session) => [session.id, session])), [displaySessions]);
  const sessionForks = state.sessionForks;
  const listItems = useMemo<ChatPanelItem[]>(() => {
    const flatSession = (session: UserSessionListItem) => ({ kind: "local" as const, session, fork: sessionForks[session.id] ?? null, tree: null });
    if (!trimmedQuery && listFilter.kind === "all") {
      const keep = (session: UserSessionListItem) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running";
      return buildSessionForkTree(filteredSessions, sessionForks, { expanded: expandedForks, keep }).map((entry): ChatPanelItem => entry.type === "toggle"
        ? { kind: "fork-toggle", rootId: entry.rootId, hidden: entry.hidden, expanded: entry.expanded }
        : { kind: "local", session: entry.session, fork: entry.fork, tree: entry.tree });
    }
    if (!trimmedQuery) return filteredSessions.map(flatSession);
    const remoteSessions = remoteQueryMatches
      ? remoteSearch.sessions.filter((hit) => {
        const session = sessionsById.get(hit.sessionId);
        if (listFilter.kind === "all") return true;
        if (listFilter.kind === "source") return session ? sessionSourceGroup(session) === listFilter.source : false;
        return labelSessionIds.has(hit.sessionId);
      })
      : [];
    const remoteIds = new Set(remoteSessions.map((hit) => hit.sessionId));
    return [
      ...remoteSessions.map((hit) => ({ kind: "remote" as const, hit })),
      ...filteredSessions.filter((session) => !remoteIds.has(session.id)).map(flatSession),
    ];
  }, [expandedForks, filteredSessions, labelSessionIds, listFilter, remoteQueryMatches, remoteSearch.sessions, sessionForks, sessionsById, state.sessionLatestTurns, state.sessionTurnStatuses, trimmedQuery]);
  // LegendList memoizes each row on [item, extraData]; the row reads client/theme/locale,
  // which never change `listItems`, so they must flow through extraData.
  const rowExtraData = useMemo(() => ({ client, t, theme, prefetchSession }), [client, t, theme, prefetchSession]);
  const loadMore = async () => {
    if (!client || loadingMore) return;
    if (scopeInitialized && !scopeHasMore) {
      if (loadMoreError) await refreshPanel().catch(() => undefined);
      return;
    }
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = scopeGenerationRef.current;
    try {
      const cursor = scopeCursor ?? cursorAfterOldestSession(sessions);
      const response = await client.space(spaceId).sessions.list({ limit: 60, includeForks: true, ...(cursor ? { cursor } : {}) });
      if (generation !== scopeGenerationRef.current) return;
      rememberSessionForks(response.forks ?? []);
      tailLoadedRef.current = true;
      setExtraSessions((current) => mergePanelSessions(current, response.sessions, spaceId, spaceName));
      void refreshSessionStatuses(response.sessions, { silent: true });
      setScopeCursor(response.pageInfo?.nextCursor ?? null);
      setScopeHasMore(Boolean(response.pageInfo?.hasMore));
      setScopeInitialized(true);
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : t("space.panel.loadMoreError"));
    } finally {
      setLoadingMore(false);
    }
  };
  const refreshPanel = async () => {
    if (!client) return;
    const generation = scopeGenerationRef.current;
    const requestStartedAt = Date.now();
    try {
      const response = await client.space(spaceId).sessions.list({ limit: 60, includeForks: true });
      if (generation !== scopeGenerationRef.current) return;
      rememberSessionForks(response.forks ?? []);
      setExtraSessions((current) => reconcileSessionHead(current, response.sessions, response.pageInfo?.hasMore === true, requestStartedAt));
      if (!tailLoadedRef.current) {
        setScopeCursor(response.pageInfo?.nextCursor ?? null);
        setScopeHasMore(response.pageInfo?.hasMore === true);
        setScopeInitialized(true);
      }
      setLoadMoreError(null);
      void refreshSessionStatuses(response.sessions, { silent: true });
    } catch (error) {
      if (generation === scopeGenerationRef.current) setLoadMoreError(error instanceof Error ? error.message : t("space.panel.loadMoreError"));
      throw error;
    }
  };
  useSyncScope(`space:${spaceId}:chat-panel`, refreshPanel, 15_000);
  const showLoadMore = Boolean(client && !trimmedQuery && (!scopeInitialized || scopeHasMore || loadMoreError));
  const emptyLoading = (remoteQueryMatches && remoteSearch.loading) || labelSessionsLoading;
  const emptyLabel = listFilter.kind === "label"
    ? t("space.panel.empty.labeled", { name: listFilter.label.name })
    : listFilter.kind === "source"
      ? listFilter.source === "web" ? t("space.panel.empty.web") : t("space.panel.empty.other")
    : trimmedQuery
      ? t("space.panel.empty.matching")
      : t("space.panel.empty.none");
  const filterChips: { key: string; label: string; icon?: React.ComponentProps<typeof AppIcon>["name"]; filter: ChatListFilter }[] = [
    { key: "all", label: t("space.panel.filter.all"), filter: { kind: "all" } },
    { key: "web", label: t("space.panel.filter.webApp"), icon: "globe", filter: { kind: "source", source: "web" } },
    { key: "other", label: t("space.panel.filter.other"), icon: "globe", filter: { kind: "source", source: "other" } },
    ...labels.map((label) => ({ key: `label:${label.id}`, label: label.name, filter: { kind: "label" as const, label, ref: formatLabelRef(label) } })),
  ];
  const chipRow = <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
    {filterChips.map((chip) => (
      <FilterChip
        key={chip.key}
        label={chip.label}
        icon={chip.icon}
        selected={chip.filter.kind === "all" ? listFilter.kind === "all" : chip.filter.kind === "source" ? listFilter.kind === "source" && listFilter.source === chip.filter.source : listFilter.kind === "label" && listFilter.label.id === chip.filter.label.id}
        onPress={() => setListFilter(chip.filter)}
      />
    ))}
    {labelsError ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryLabelsA11y")} onPress={() => setLabelsReloadToken((value) => value + 1)}><Text className="text-caption text-accent">{t("space.panel.retryLabels")}</Text></Pressable> : null}
  </ScrollView>;
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={PANEL_FILL}>
      <TopBar title={spaceName} subtitle={t("space.panel.chats")} leading={<Avatar name={spaceName} uri={displaySessions.find((session) => session.space?.publicProfile?.avatarUrl)?.space?.publicProfile?.avatarUrl} size={38} />} actions={<IconButton name="x" label={t("ui.sheet.close", { title: t("space.panel.chats") })} onPress={onClose} />} />
      <View className="px-4 pt-3 pb-2 gap-2">
        <PrimaryButton label={t("space.newChat")} icon="plus" onPress={onNewChat} className="min-h-11" />
        <View className="flex-row items-center gap-2">
          <View className="flex-1"><SearchField value={query} onChangeText={setQuery} placeholder={t("space.panel.searchChats")} /></View>
        </View>
        <View onTouchStart={() => onChipsTouchChange(true)} onTouchEnd={() => onChipsTouchChange(false)} onTouchCancel={() => onChipsTouchChange(false)}>{chipRow}</View>
        {remoteQueryMatches && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2"><Text selectable className="text-micro font-semibold text-danger flex-1">{remoteSearch.error}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("chats.search.retry")} onPress={remoteSearch.retry}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
        {state.sessionStatusError ? <View className="flex-row items-center gap-2"><Text className="text-micro font-semibold text-danger flex-1">{state.sessionStatusError}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryStatuses")} onPress={() => void refreshSessionStatuses(displaySessions)}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
        {labelSessionsError ? <View className="flex-row items-center gap-2"><Text selectable className="text-micro font-semibold text-danger flex-1">{labelSessionsError}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryLabeledChats")} onPress={() => setLabelsReloadToken((value) => value + 1)}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
      </View>
      <LegendList
        estimatedItemSize={68}
        maintainVisibleContentPosition
        scrollsChildToFocus={false}
        data={listItems}
        extraData={rowExtraData}
        keyExtractor={(item) => item.kind === "remote" ? `remote:${item.hit.sessionId}` : item.kind === "fork-toggle" ? `forks:${item.rootId}` : `local:${item.session.id}`}
        renderItem={({ item }) => item.kind === "fork-toggle"
          ? <SessionForkToggle hidden={item.hidden} expanded={item.expanded} showSpace={false} onPress={() => setExpandedForks((current) => { const next = new Set(current); if (!next.delete(item.rootId)) next.add(item.rootId); return next; })} />
          : item.kind === "remote"
          ? <SessionSearchRow hit={item.hit} showSpace={false} onPress={(target) => onOpenSession(item.hit.sessionId, target)} onPressIn={() => prefetchSession(item.hit.sessionId)} />
          : <SessionRow session={item.session} fork={item.fork} tree={item.tree} showSpace={false} onPress={() => onOpenSession(item.session.id)} onPressIn={() => prefetchSession(item.session.id)} onLongPress={client ? () => openLabelSheet(item.session) : undefined} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24, flexGrow: listItems.length === 0 ? 1 : undefined }}
        ListFooterComponent={showLoadMore ? <View>{loadMoreError ? <Text selectable className="text-micro font-semibold text-danger mx-4 mt-2">{loadMoreError}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={loadMoreError ? t("space.panel.retryLoadMore") : t("space.panel.loadMore")} disabled={loadingMore} onPress={() => void loadMore()} className="min-h-10 mx-4 mt-2 rounded-sm items-center justify-center active:bg-surface-pressed">{loadingMore ? <Loader /> : <Text className="text-caption text-accent">{loadMoreError ? t("space.panel.retryLoadMore") : t("space.panel.loadMore")}</Text>}</Pressable></View> : null}
        ListHeaderComponent={remoteQueryMatches && remoteSearch.loading && listItems.length > 0 ? <ListEdgeLoader label={t("chats.searching")} /> : null}
        ListEmptyComponent={emptyLoading ? <LoadingState label={trimmedQuery ? t("chats.searching") : undefined} /> : <View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name={listFilter.kind === "label" ? "tag" : trimmedQuery ? "search" : "messages"} size={26} tone="muted" /><Text className="text-body text-fg-muted mt-2 text-center">{emptyLabel}</Text></View>}
      />
      {labelSheetSession && client ? <SessionLabelSheet client={client} spaceId={spaceId} session={labelSheetSession} labels={labels} labelsError={labelsError} onLabelsReload={() => setLabelsReloadToken((value) => value + 1)} onClose={closeLabelSheet} onChanged={() => { setLabelSessionIds(new Set()); setLabelsReloadToken((value) => value + 1); }} /> : null}
    </KeyboardAvoidingView>
  );
}

function FilesPanel({ enabled = true, spaceId, spaceName, client, onClose, onOpenFile, onOpenFilesPage }: { enabled?: boolean; spaceId: string; spaceName: string; client: CohubClient | null; onClose: () => void; onOpenFile: (path: string) => void; onOpenFilesPage: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<SpaceFsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!enabled || inFlightRef.current) return;
    const currentRequest = ++requestIdRef.current;
    if (!client) {
      setEntries([]);
      setError(t("files.panelConnect"));
      setLoading(false);
      return;
    }
    inFlightRef.current = true;
    if (!options.silent) { setLoading(true); setError(null); setEntries([]); }
    try {
      const result = await client.space(spaceId).files.list(path || undefined);
      if (currentRequest === requestIdRef.current) { setEntries(result.entries); setError(null); }
    } catch (caught) {
      if (currentRequest === requestIdRef.current) setError(caught instanceof Error ? caught.message : t("files.loadError"));
      if (options.silent) throw caught;
    } finally {
      if (currentRequest === requestIdRef.current) { inFlightRef.current = false; setLoading(false); }
    }
  }, [client, enabled, path, spaceId, t]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      requestIdRef.current += 1;
      inFlightRef.current = false;
    };
  }, [enabled, load]);
  useSyncScope(`space:${spaceId}:files-panel:${path}`, () => load({ silent: true }), 30_000, enabled);

  const openEntry = (entry: SpaceFsEntry) => {
    if (entry.type === "dir") {
      setPath(normalizeSpacePath(entry.path));
      return;
    }
    onOpenFile(entry.path);
  };

  // LegendList memoizes each row on [item, extraData]; the row's child reads theme/locale,
  // which never change `entries`, so they must flow through extraData.
  const rowExtraData = useMemo(() => ({ t, theme }), [t, theme]);

  return (
    <View className="flex-1 min-h-0">
      <TopBar title={path ? spacePathName(path) : t("files.title")} subtitle={path ? `${spaceName} / ${path}` : spaceName} actions={<><IconButton name="external-link" label={t("space.panel.openFullFiles")} onPress={onOpenFilesPage} /><IconButton name="x" label={t("ui.sheet.close", { title: t("files.title") })} onPress={onClose} /></>} />
      {path ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.backToParent")} onPress={() => setPath(parentSpacePath(path))} className="min-h-11 flex-row items-center gap-2 border-b border-border px-3.5 active:bg-surface-pressed"><AppIcon name="arrow-left" size={16} tone="muted" /><Text className="text-caption text-fg-secondary">{parentSpacePath(path) ? t("files.backTo", { name: spacePathName(parentSpacePath(path)) }) : t("files.backToFiles")}</Text></Pressable> : null}
      {error && entries.length > 0 ? <Text selectable className="text-caption text-danger p-4">{error}</Text> : null}
      {loading ? (
        <LoadingState label={t("files.loading")} />
      ) : error && entries.length === 0 ? (
        <View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name="cloud-off" size={25} tone="danger" /><Text className="text-body text-danger text-center mt-2">{error}</Text><PrimaryButton label={t("common.retry")} icon="refresh" onPress={() => void load()} className="mt-4 min-h-10" /></View>
      ) : (
        <LegendList
          estimatedItemSize={68}
          scrollsChildToFocus={false}
          data={entries}
          extraData={rowExtraData}
          keyExtractor={(item) => item.path}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24, flexGrow: entries.length === 0 ? 1 : undefined }}
          renderItem={({ item }) => <SpaceFileRow entry={item} compact onPress={() => openEntry(item)} />}
          ListEmptyComponent={<View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name="folder-open" size={26} tone="muted" /><Text className="text-body text-fg-muted mt-2 text-center">{path ? t("files.emptyFolder") : t("files.emptyWorkspace")}</Text></View>}
        />
      )}
    </View>
  );
}

const styles = {
  pages: { flexDirection: "row" as const, height: "100%" as const },
  // design-system: the panel's edge shadow and scrim are darkness, not a themed hue, so they stay black.
  panelPage: { height: "100%" as const, borderLeftWidth: 1, borderRightWidth: 1, shadowColor: "#000000", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 12 },
  panelPageLeft: { borderLeftWidth: 0 },
  panelPageRight: { borderRightWidth: 0 },
  // design-system: scrim, see panelPage.
  backdrop: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#000000" },
} satisfies Record<string, object>;
const PANEL_FILL = { flex: 1, minHeight: 0 } as const;
