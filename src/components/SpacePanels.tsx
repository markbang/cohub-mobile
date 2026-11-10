/* eslint-disable react-hooks/set-state-in-effect -- controlled panel state synchronizes the native animation surface. */
import type { CohubClient, SessionListFork, SpaceFsEntry, UserSessionListItem } from "@neta-art/cohub";
import { buildSessionForkTree, type SessionTreePosition } from "@/src/data/session-fork-tree";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LegendList } from "@legendapp/list/react-native";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Reanimated, { cancelAnimation, Extrapolation, interpolate, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, ReduceMotion } from "react-native-reanimated";
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
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { invalidateScopes, usePagedQuery, useScreenQuery } from "@/src/data/query";
import { useSpaceDirectory } from "@/src/data/use-space-directory";
import { useQueryClient } from "@tanstack/react-query";
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
import { usePredictiveBackBlock } from "@/src/platform/predictive-back";
import { AppIcon, Avatar, IconButton, ListEdgeLoader, Loader, LoadingState, PrimaryButton, SearchField, TopBar } from "@/src/ui";
import { normalizeSpacePath, parentSpacePath, sortByRecent, spacePathName } from "@/src/utils";
import { usePaneWidth } from "@/src/ui/pane";

export type SpacePanel = "chat" | "files";

type SpacePanelsProps = {
  spaceId: string;
  spaceName: string;
  spaceAvatarUrl?: string | null;
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
  /** Off for a Bot, which has one Chat: the swipe reaches only the files panel. */
  chatPanel?: boolean;
};

const PANEL_WIDTH_RATIO = 0.86;
const MAX_PANEL_WIDTH = 360;
type SwipePhase = "idle" | "dragging" | "released" | "settled";

const PANEL_SWIPE_SPRING = { duration: 300, dampingRatio: 1, overshootClamping: true } as const;

/**
 * Push-style pager. A native scroll would intercept any drag past its slop, however slanted;
 * a pan that only activates near horizontal drives the pages instead.
 * Native views that claim the touch (scrolling timeline, text selection, scrollable code blocks;
 * see NestedHorizontalScrollView in modules/react-native-enriched-markdown) cancel the pan. Do not disable the pager for messages
 * containing a fence — that blocks the swipe on almost every reply.
 */
export function SpacePanels({ spaceId, spaceName, spaceAvatarUrl, sessions, client, activePanel, onActivePanelChange, onOpenSession, onNewChat, onOpenFile, onOpenFilesPage, children, edgeToEdge = false, chatPanel = true }: SpacePanelsProps) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  // The Chat's pane, not the window: in a split window the panels slide within the right pane.
  const width = usePaneWidth();
  const panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(280, width * PANEL_WIDTH_RATIO));
  const centerOffset = panelWidth;
  // The right panel aligns to the viewport's right edge, not its left edge.
  const filesOffset = 2 * panelWidth;
  const minOffset = chatPanel ? 0 : centerOffset;
  // The transform alone positions the pages; the native scroll offset stays at 0. Android
  // repaints a scrolled view a frame after its scroll event, while Reanimated applies styles
  // inside that event, so pairing a scroll with a transform flashed a panel for one frame.
  const pagerOffset = useSharedValue(activePanel === "chat" ? 0 : activePanel === "files" ? filesOffset : centerOffset);
  const shownPanel = useSharedValue<PanelName | 0>(activePanel ?? 0);
  const [pagerSwipeEnabled, setPagerSwipeEnabled] = useState(true);
  const [visiblePanel, setVisiblePanel] = useState<PanelName | null>(activePanel);
  const [interactive, setInteractive] = useState(Boolean(activePanel));
  // The side panels mount on first use, not with the Chat: their queries and rows were measured
  // stalling the JS thread 0.5–1.2 s while a Chat opened. Once mounted they stay warm.
  const [panelsMounted, setPanelsMounted] = useState(Boolean(activePanel));
  if (!panelsMounted && (activePanel || visiblePanel)) setPanelsMounted(true);
  const visiblePanelRef = useRef<PanelName | null>(activePanel);
  const activePanelRef = useRef<PanelName | null>(activePanel);
  const pagerHeaderTouchHeight = (edgeToEdge ? insets.top : 0) + edgeChrome.headerMinHeight;
  const swipeOrigin = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  const swipePhase = useSharedValue<SwipePhase>("idle");

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
    const panel = panelForScrollOffset(pagerOffset.get(), centerOffset, filesOffset);
    recordDebugEvent("navigation.pager.settled", { panel, offset: Math.round(pagerOffset.get()) });
    if (panel) commitOpen(panel);
    else commitClosed();
  }, [centerOffset, commitClosed, commitOpen, filesOffset, pagerOffset]);

  const animatePager = useCallback((target: number) => {
    swipePhase.set("idle");
    pagerOffset.set(withSpring(target, { ...PANEL_SWIPE_SPRING, reduceMotion: ReduceMotion.System }, (finished) => {
      if (finished) scheduleOnRN(settle);
    }));
  }, [pagerOffset, settle, swipePhase]);

  const closePanel = useCallback(() => {
    activePanelRef.current = null;
    onActivePanelChange(null);
    animatePager(centerOffset);
  }, [animatePager, centerOffset, onActivePanelChange]);

  useAnimatedReaction(() => pagerOffset.get(), (offset) => {
    if (Math.abs(offset - centerOffset) <= 8) return;
    const panel: PanelName = offset < centerOffset ? "chat" : "files";
    if (shownPanel.get() === panel) return;
    shownPanel.set(panel);
    scheduleOnRN(showPanel, panel);
  }, [centerOffset, pagerOffset, showPanel, shownPanel]);

  usePredictiveBackBlock(isFocused && Boolean(activePanel || visiblePanel));
  useEffect(() => {
    if (!isFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!activePanelRef.current && !visiblePanelRef.current) return false;
      closePanel();
      return true;
    });
    return () => subscription.remove();
  }, [closePanel, isFocused]);

  // A width change moves every snap point; keep the current page in place.
  useLayoutEffect(() => {
    const panel = activePanelRef.current;
    cancelAnimation(pagerOffset);
    pagerOffset.set(panel === "chat" ? 0 : panel === "files" ? filesOffset : centerOffset);
  }, [centerOffset, filesOffset, pagerOffset]);

  useEffect(() => {
    if (activePanelRef.current === activePanel) return;
    activePanelRef.current = activePanel;
    visiblePanelRef.current = activePanel;
    setVisiblePanel(activePanel);
    setInteractive(Boolean(activePanel));
    shownPanel.set(activePanel ?? 0);
    animatePager(activePanel === "chat" ? 0 : activePanel === "files" ? filesOffset : centerOffset);
  }, [activePanel, animatePager, centerOffset, filesOffset, shownPanel]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(pagerOffset.value - centerOffset), [0, panelWidth], [0, 1], Extrapolation.CLAMP) * 0.52,
  }));
  const pagerPaintStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -pagerOffset.value }] }));
  const handleSwipeBegin = useCallback(() => {
    setPanelsMounted(true);
    recordDebugEvent("navigation.pager.drag_begin", { pagerSwipeEnabled, panel: visiblePanelRef.current });
  }, [pagerSwipeEnabled]);
  const handleSwipeEnd = useCallback(() => {
    recordDebugEvent("navigation.pager.drag_end", { pagerSwipeEnabled, offset: Math.round(pagerOffset.get()), panel: visiblePanelRef.current });
  }, [pagerOffset, pagerSwipeEnabled]);
  useAnimatedReaction(() => swipePhase.get(), (phase, previous) => {
    if (phase === previous) return;
    if (phase === "dragging") scheduleOnRN(handleSwipeBegin);
    else if (phase === "released") scheduleOnRN(handleSwipeEnd);
    else if (phase === "settled") scheduleOnRN(settle);
  }, [handleSwipeBegin, handleSwipeEnd, settle, swipePhase]);
  const swipe = useMemo(() => Gesture.Pan()
    .enabled(pagerSwipeEnabled)
    .activeOffsetX([-PANEL_SWIPE_ACTIVATION_PX, PANEL_SWIPE_ACTIVATION_PX])
    .failOffsetY([-PANEL_SWIPE_VERTICAL_SLOP_PX, PANEL_SWIPE_VERTICAL_SLOP_PX])
    // Keep the header for the back button and iOS edge-back.
    .hitSlop({ top: -pagerHeaderTouchHeight })
    .onStart((event) => {
      // Continue from the current offset without jumping by the activation travel.
      cancelAnimation(pagerOffset);
      swipeStart.set(pagerOffset.get());
      swipeOrigin.set(pagerOffset.get() + event.translationX);
      swipePhase.set("dragging");
    })
    .onUpdate((event) => {
      pagerOffset.set(Math.min(filesOffset, Math.max(minOffset, swipeOrigin.get() - event.translationX)));
    })
    .onEnd((event) => {
      const offset = Math.min(filesOffset, Math.max(minOffset, swipeOrigin.get() - event.translationX));
      const target = Math.max(minOffset, panelSwipeTarget(swipeStart.get(), offset, event.velocityX, panelWidth));
      pagerOffset.set(withSpring(target, { ...PANEL_SWIPE_SPRING, velocity: -event.velocityX, reduceMotion: ReduceMotion.System }, (finished) => {
        if (finished) swipePhase.set("settled");
      }));
      swipePhase.set("released");
    }), [filesOffset, minOffset, pagerHeaderTouchHeight, pagerOffset, pagerSwipeEnabled, panelWidth, swipeOrigin, swipePhase, swipeStart]);
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
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-background"
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
        // Never scrolls: Android would otherwise scroll it to reveal a focused descendant.
        scrollsChildToFocus={false}
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
            {panelsMounted ? <ChatPanel spaceId={spaceId} spaceName={spaceName} spaceAvatarUrl={spaceAvatarUrl} sessions={sessions} client={client} onChipsTouchChange={handleChipsTouchChange} onClose={closePanel} onNewChat={() => { closePanel(); onNewChat(); }} onOpenSession={(sessionId, target) => { closePanel(); onOpenSession(sessionId, target); }} /> : null}
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
            {panelsMounted ? <FilesPanel enabled spaceId={spaceId} spaceName={spaceName} client={client} onClose={closePanel} onOpenFile={(path) => { closePanel(); onOpenFile(path); }} onOpenFilesPage={() => { closePanel(); onOpenFilesPage(); }} /> : null}
          </View>
        </Reanimated.View>
      </ScrollView>
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
  | { kind: "label"; label: SessionLabel; ref: string }
  | { kind: "archived" };

type PanelScope = { sessions: UserSessionListItem[]; cursor: string | null; hasMore: boolean; tailLoaded: boolean };
const EMPTY_SESSIONS: UserSessionListItem[] = [];
const EMPTY_LABELS: SessionLabel[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

function ChatPanel({ spaceId, spaceName, spaceAvatarUrl, sessions, client, onChipsTouchChange, onClose, onNewChat, onOpenSession }: { spaceId: string; spaceName: string; spaceAvatarUrl?: string | null; sessions: UserSessionListItem[]; client: CohubClient | null; onChipsTouchChange: (touching: boolean) => void; onClose: () => void; onNewChat: () => void; onOpenSession: (sessionId: string, target?: SessionNavigationTarget) => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { prefetchSession, refreshSessionStatuses, rememberSessionForks } = useAppActions();
  const state = useAppSelector((app) => ({ sessionForks: app.state.sessionForks, sessionLatestTurns: app.state.sessionLatestTurns, sessionTurnStatuses: app.state.sessionTurnStatuses, sessionStatusError: app.state.sessionStatusError }), shallowEqual);
  const [query, setQuery] = useState("");
  const [expandedForks, setExpandedForks] = useState<ReadonlySet<string>>(() => new Set());
  const queryClient = useQueryClient();
  const scopeKey = useMemo(() => [`space:${spaceId}:chat-panel`], [spaceId]);
  // The head refresh reconciles into loaded pages; once older pages load, their cursor wins.
  const scopeQuery = useScreenQuery({
    queryKey: scopeKey,
    queryFn: async (): Promise<PanelScope> => {
      const requestStartedAt = Date.now();
      const response = await client!.space(spaceId).sessions.list({ limit: 60, includeForks: true });
      rememberSessionForks(response.forks ?? []);
      void refreshSessionStatuses(response.sessions, { silent: true });
      const loaded = queryClient.getQueryData<PanelScope>(scopeKey);
      const hasMore = response.pageInfo?.hasMore === true;
      const merged = reconcileSessionHead(loaded?.sessions ?? [], response.sessions, hasMore, requestStartedAt);
      return loaded?.tailLoaded ? { ...loaded, sessions: merged } : { sessions: merged, cursor: response.pageInfo?.nextCursor ?? null, hasMore, tailLoaded: false };
    },
    enabled: Boolean(client && spaceId),
    intervalMs: 15_000,
  });
  const extraSessions = scopeQuery.data?.sessions ?? EMPTY_SESSIONS;
  const scopeInitialized = scopeQuery.data !== undefined;
  const scopeHasMore = scopeQuery.data?.hasMore ?? false;
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailure, setLoadMoreFailure] = useState<{ message: string; at: number } | null>(null);
  // A later successful refresh supersedes a load-more failure, as the refresh error does.
  const loadMoreError = loadMoreFailure && loadMoreFailure.at > scopeQuery.dataUpdatedAt
    ? loadMoreFailure.message
    : scopeQuery.error && !scopeQuery.isFetching ? scopeQuery.error.message || t("space.panel.loadMoreError") : null;
  const [listFilter, setListFilter] = useState<ChatListFilter>({ kind: "all" });
  const selectedLabelRef = listFilter.kind === "label" ? listFilter.ref : null;
  const [labelSheetSession, setLabelSheetSession] = useState<UserSessionListItem | null>(null);
  const labelsQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:labels`],
    queryFn: async () => toUserSessionLabels(await fetchSessionLabels(client!, spaceId)),
    enabled: Boolean(client && spaceId),
    intervalMs: 15_000,
  });
  const labels = labelsQuery.data ?? EMPTY_LABELS;
  const labelsError = labelsQuery.error ? labelsQuery.error.message || t("labels.error") : null;
  const labelMembersQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:label-members:${selectedLabelRef}`],
    queryFn: async () => new Set(await fetchLabelSessionIds(client!, spaceId, selectedLabelRef!)),
    enabled: Boolean(client && spaceId) && selectedLabelRef !== null,
    intervalMs: 15_000,
  });
  const labelSessionIds = labelMembersQuery.data ?? EMPTY_IDS;
  // The Space's archive is its own server list: the default one never holds archived Chats.
  const archivedList = usePagedQuery<UserSessionListItem>({
    queryKey: [`space:${spaceId}:archived-chats`],
    enabled: Boolean(client && spaceId) && listFilter.kind === "archived",
    intervalMs: 15_000,
    id: (session) => session.id,
    fetchPage: async (cursor) => {
      const response = await client!.space(spaceId).sessions.list({ limit: 60, archived: "only", ...(cursor ? { cursor } : {}) });
      return { items: mergePanelSessions([], response.sessions, spaceId, spaceName), cursor: response.pageInfo?.hasMore ? response.pageInfo.nextCursor ?? null : null };
    },
  });
  const archivedSessions = archivedList.items ?? EMPTY_SESSIONS;
  const archivedLoading = listFilter.kind === "archived" && archivedList.items === null && !archivedList.query.error;
  const archivedError = listFilter.kind === "archived" ? (archivedList.loadMoreError ?? archivedList.query.error)?.message || null : null;
  const labelSessionsLoading = labelMembersQuery.isPending && labelMembersQuery.fetchStatus === "fetching";
  const labelSessionsError = labelMembersQuery.error ? labelMembersQuery.error.message || t("labels.loadedLabeledChatsError") : null;
  const reloadLabels = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [`space:${spaceId}:labels`] });
    invalidateScopes(queryClient, { exact: [], prefixes: [`space:${spaceId}:label-members:`] });
  }, [queryClient, spaceId]);
  const remoteSearch = useRemoteSearch(client, query, { enabled: Boolean(spaceId), spaceId, types: ["chat"] });
  const displaySessions = useMemo(() => mergePanelSessions(extraSessions, sessions, spaceId, spaceName), [extraSessions, sessions, spaceId, spaceName]);
  const remoteQueryMatches = remoteSearch.query === normalizeSearchQuery(query);

  useEffect(() => {
    setListFilter({ kind: "all" });
    setLabelSheetSession(null);
  }, [client, spaceId]);

  const openLabelSheet = useCallback((session: UserSessionListItem) => {
    setLabelSheetSession(session);
  }, []);
  const closeLabelSheet = useCallback(() => setLabelSheetSession(null), []);

  const trimmedQuery = normalizeSearchQuery(query);
  const needle = trimmedQuery.toLowerCase();
  // Stable across input-free re-renders (focus, the page's menu) so LegendList, which memoizes rows on the item, redraws none.
  const filteredSessions = useMemo(() => {
    const matchesListFilter = (session: UserSessionListItem) => {
      if (listFilter.kind === "all" || listFilter.kind === "archived") return true;
      if (listFilter.kind === "source") return sessionSourceGroup(session) === listFilter.source;
      return labelSessionIds.has(session.id);
    };
    return (listFilter.kind === "archived" ? archivedSessions : displaySessions).filter((session) =>
      (!needle || [session.title, session.latestMessageText, session.space?.name].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false)) &&
      matchesListFilter(session),
    );
  }, [archivedSessions, displaySessions, labelSessionIds, listFilter, needle]);
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
    const remoteSessions = remoteQueryMatches && listFilter.kind !== "archived"
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
    const current = queryClient.getQueryData<PanelScope>(scopeKey);
    if (current && !current.hasMore) {
      if (loadMoreError) await scopeQuery.refetch();
      return;
    }
    setLoadingMore(true);
    setLoadMoreFailure(null);
    try {
      const cursor = current?.cursor ?? cursorAfterOldestSession(sessions);
      const response = await client.space(spaceId).sessions.list({ limit: 60, includeForks: true, ...(cursor ? { cursor } : {}) });
      rememberSessionForks(response.forks ?? []);
      queryClient.setQueryData<PanelScope>(scopeKey, (latest) => ({
        sessions: mergePanelSessions(latest?.sessions ?? [], response.sessions, spaceId, spaceName),
        cursor: response.pageInfo?.nextCursor ?? null,
        hasMore: Boolean(response.pageInfo?.hasMore),
        tailLoaded: true,
      }));
      void refreshSessionStatuses(response.sessions, { silent: true });
    } catch (error) {
      setLoadMoreFailure({ message: error instanceof Error ? error.message : t("space.panel.loadMoreError"), at: Date.now() });
    } finally {
      setLoadingMore(false);
    }
  };
  const archivedView = listFilter.kind === "archived";
  const showLoadMore = archivedView
    ? Boolean(client && !trimmedQuery && (archivedList.hasMore || archivedError))
    : Boolean(client && !trimmedQuery && (!scopeInitialized || scopeHasMore || loadMoreError));
  const footerError = archivedView ? archivedError : loadMoreError;
  const footerLoading = archivedView ? archivedList.loadingMore : loadingMore;
  const pressLoadMore = () => {
    if (!archivedView) { void loadMore(); return; }
    if (archivedList.hasMore) void archivedList.loadMore().catch(() => undefined);
    else void archivedList.query.refetch();
  };
  const emptyLoading = (remoteQueryMatches && remoteSearch.loading) || labelSessionsLoading || archivedLoading;
  const emptyLabel = archivedView
    ? t("space.panel.empty.archived")
    : listFilter.kind === "label"
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
    { key: "archived", label: t("chats.archived"), icon: "archive", filter: { kind: "archived" } },
  ];
  const chipRow = <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
    {filterChips.map((chip) => (
      <FilterChip
        key={chip.key}
        label={chip.label}
        icon={chip.icon}
        selected={chip.filter.kind === "all" || chip.filter.kind === "archived" ? listFilter.kind === chip.filter.kind : chip.filter.kind === "source" ? listFilter.kind === "source" && listFilter.source === chip.filter.source : listFilter.kind === "label" && listFilter.label.id === chip.filter.label.id}
        onPress={() => setListFilter(chip.filter)}
      />
    ))}
    {labelsError ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryLabelsA11y")} onPress={reloadLabels}><Text className="text-caption text-accent">{t("space.panel.retryLabels")}</Text></Pressable> : null}
  </ScrollView>;
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={PANEL_FILL}>
      <TopBar title={spaceName} subtitle={t("space.panel.chats")} leading={<Avatar name={spaceName} uri={spaceAvatarUrl ?? displaySessions.find((session) => session.space?.publicProfile?.avatarUrl)?.space?.publicProfile?.avatarUrl} size={38} />} actions={<IconButton name="x" label={t("ui.sheet.close", { title: t("space.panel.chats") })} onPress={onClose} />} />
      <View className="px-4 pt-3 pb-2 gap-2">
        <PrimaryButton label={t("space.newChat")} icon="plus" onPress={onNewChat} className="min-h-11" />
        <View className="flex-row items-center gap-2">
          <View className="flex-1"><SearchField value={query} onChangeText={setQuery} placeholder={t("space.panel.searchChats")} /></View>
        </View>
        <View onTouchStart={() => onChipsTouchChange(true)} onTouchEnd={() => onChipsTouchChange(false)} onTouchCancel={() => onChipsTouchChange(false)}>{chipRow}</View>
        {remoteQueryMatches && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2"><Text selectable className="text-micro font-semibold text-danger flex-1">{remoteSearch.error}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("chats.search.retry")} onPress={remoteSearch.retry}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
        {state.sessionStatusError ? <View className="flex-row items-center gap-2"><Text className="text-micro font-semibold text-danger flex-1">{state.sessionStatusError}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryStatuses")} onPress={() => void refreshSessionStatuses(displaySessions)}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
        {labelSessionsError ? <View className="flex-row items-center gap-2"><Text selectable className="text-micro font-semibold text-danger flex-1">{labelSessionsError}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.retryLabeledChats")} onPress={reloadLabels}><Text className="text-micro font-semibold text-accent">{t("common.retry")}</Text></Pressable></View> : null}
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
        ListFooterComponent={showLoadMore ? <View>{footerError ? <Text selectable className="text-micro font-semibold text-danger mx-4 mt-2">{footerError}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={footerError ? t("space.panel.retryLoadMore") : t("space.panel.loadMore")} disabled={footerLoading} onPress={pressLoadMore} className="min-h-10 mx-4 mt-2 rounded-sm items-center justify-center active:bg-surface-pressed">{footerLoading ? <Loader /> : <Text className="text-caption text-accent">{footerError ? t("space.panel.retryLoadMore") : t("space.panel.loadMore")}</Text>}</Pressable></View> : null}
        ListHeaderComponent={remoteQueryMatches && remoteSearch.loading && listItems.length > 0 ? <ListEdgeLoader label={t("chats.searching")} /> : null}
        ListEmptyComponent={emptyLoading ? <LoadingState label={trimmedQuery ? t("chats.searching") : undefined} /> : <View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name={archivedView ? "archive" : listFilter.kind === "label" ? "tag" : trimmedQuery ? "search" : "messages"} size={28} tone="muted" /><Text className="text-body text-fg-muted mt-2 text-center">{emptyLabel}</Text></View>}
      />
      {labelSheetSession && client ? <SessionLabelSheet client={client} spaceId={spaceId} session={labelSheetSession} labels={labels} labelsError={labelsError} onLabelsReload={reloadLabels} onClose={closeLabelSheet} onChanged={reloadLabels} /> : null}
    </KeyboardAvoidingView>
  );
}

function FilesPanel({ enabled = true, spaceId, spaceName, client, onClose, onOpenFile, onOpenFilesPage }: { enabled?: boolean; spaceId: string; spaceName: string; client: CohubClient | null; onClose: () => void; onOpenFile: (path: string) => void; onOpenFilesPage: () => void }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const directory = useSpaceDirectory(client, spaceId, path, enabled);
  const { entries, loading } = directory;
  const error = enabled && !client ? t("files.panelConnect") : directory.error ? directory.error.message || t("files.loadError") : null;
  const load = directory.refetch;

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
      {path ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.panel.backToParent")} onPress={() => setPath(parentSpacePath(path))} className="min-h-11 flex-row items-center gap-2 border-b border-border px-4 active:bg-surface-pressed"><AppIcon name="arrow-left" size={16} tone="muted" /><Text className="text-caption text-fg-secondary">{parentSpacePath(path) ? t("files.backTo", { name: spacePathName(parentSpacePath(path)) }) : t("files.backToFiles")}</Text></Pressable> : null}
      {error && entries.length > 0 ? <Text selectable className="text-caption text-danger p-4">{error}</Text> : null}
      {loading ? (
        <LoadingState label={t("files.loading")} />
      ) : error && entries.length === 0 ? (
        <View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name="cloud-off" size={28} tone="danger" /><Text className="text-body text-danger text-center mt-2">{error}</Text><PrimaryButton label={t("common.retry")} icon="refresh" onPress={() => void load()} className="mt-4 min-h-10" /></View>
      ) : (
        <LegendList
          estimatedItemSize={68}
          scrollsChildToFocus={false}
          data={entries}
          extraData={rowExtraData}
          keyExtractor={(item) => item.path}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 24, flexGrow: entries.length === 0 ? 1 : undefined }}
          renderItem={({ item }) => <SpaceFileRow entry={item} compact onPress={() => openEntry(item)} />}
          ListEmptyComponent={<View className="flex-1 min-h-45 items-center justify-center p-6"><AppIcon name="folder-open" size={28} tone="muted" /><Text className="text-body text-fg-muted mt-2 text-center">{path ? t("files.emptyFolder") : t("files.emptyWorkspace")}</Text></View>}
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
