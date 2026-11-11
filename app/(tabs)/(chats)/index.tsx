import { useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LegendListRef, type ViewToken } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { Text, View } from "react-native";
import { AnchoredActionMenu } from "@/src/components/AnchoredActionMenu";
import { MenuAnchor, MenuPresence } from "@/src/ui/MorphMenuSurface";
import type { NativeMenuAction } from "@/src/components/NativeMenu";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { SessionSearchRow, SpaceSearchRow } from "@/src/components/SearchResultRow";
import { SessionForkToggle, SessionRow } from "@/src/components/SessionRow";
import { useToast } from "@/src/components/Toast";
import { normalizeSearchQuery, useRemoteSearch, type RemoteSessionSearchHit, type RemoteSpaceSearchHit, type SessionNavigationTarget } from "@/src/data/session-search";
import { useSpaceSessionCounts } from "@/src/data/space-session-counts";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, ConnectionBanner, DataError, EmptyState, IconButton, ListEdgeLoader, LoadingRows, LoadingState, Screen } from "@/src/ui";
import { loadSessionSourcePreference, saveSessionSourcePreference, useSessionSourcePreference, type ChatsSource } from "@/src/data/session-filter-preference";
import { useSourceSessions, type ChatsListFilter } from "@/src/data/use-source-sessions";
import { useSyncQuery } from "@/src/data/query";
import { uiSnapshots } from "@/src/config";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { SpaceRow } from "@/src/components/SpaceRow";
import { buildSessionForkTree, type SessionTreePosition } from "@/src/data/session-fork-tree";
import { sessionListStatus } from "@/src/data/session-status";
import { EdgeBlurTarget, EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";
import { LargeTitle, LargeTitleBar, LargeTitleSearch, largeTitleScroll, LargeTitleSearchLift, useLargeTitleSearch, useLargeTitleSnap } from "@/src/ui/LargeTitle";
import { BrandRefreshArea, useBrandRefresh } from "@/src/ui/BrandRefresh";
import { NAVIGATION_BAR_INSETS, nativeHeaders, useEmptyListFill, useNativeHeader } from "@/src/ui/NativeHeader";
import { useOpenChat, useScreenVisibleEffect, useSplitLayout } from "@/src/ui/pane";
import { ListContinuityProvider, ListContinuityRow, useListContinuity } from "@/src/ui/list-continuity";
import { BotRow } from "@/src/components/BotRow";
import { isBotSpace, PRIMARY_BOT_SLUG, type BotEntry } from "@/src/data/bot-mode";
import { isSessionUnread } from "@/src/data/chat-read-state";
import { useBotMode } from "@/src/data/bot-mode-preference";
import { useBots } from "@/src/data/use-bots";
import { displaySpaceName } from "@/src/utils";

type ChatListItem =
  | { kind: "local-session"; session: import("@neta-art/cohub").UserSessionListItem; fork: import("@neta-art/cohub").SessionListFork | null; tree: SessionTreePosition | null }
  | { kind: "remote-session"; hit: RemoteSessionSearchHit }
  | { kind: "local-space"; space: import("@neta-art/cohub").SpaceRecord }
  | { kind: "remote-space"; hit: RemoteSpaceSearchHit }
  | { kind: "fork-toggle"; rootId: string; hidden: number; expanded: boolean }
  | { kind: "bot"; entry: BotEntry<import("@neta-art/cohub").SpaceRecord> };
const CHAT_SEARCH_TYPES = ["chat", "space"] as const;
/** How long the row order stays held after a drag or fling settles, so a follow-up tap lands on the row it aimed at. */
const ORDER_SETTLE_MS = 800;
/** Android drops `onScrollEndDrag` when a gesture is cancelled, so no hold may outlast this. */
const ORDER_HOLD_MAX_MS = 5000;

export default function ChatsScreen() {
  const router = useRouter();
  const openChat = useOpenChat();
  // The right pane's Chat, highlighted in the list; null in a compact window.
  const { selectedChatId } = useSplitLayout();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout, scrollY, scrollRef, blurTarget, attachBlurTarget } = useEdgeChrome({ trackScroll: true });
  const titleScroll = largeTitleScroll(true);
  const { client, userUuid, refreshHome, refreshChats, refreshSessionStatuses, loadMoreSessions, prefetchSession, loadComposerDraft, saveComposerDraft, markAllSessionsSeen } = useAppActions();
  // Stream batches touch only `sessionViews`, which this tab never reads.
  const state = useAppSelector(({ state }) => ({ booting: state.booting, error: state.error, sessionsError: state.sessionsError, sessionStatusError: state.sessionStatusError, sessionsLoadingMore: state.sessionsLoadingMore, sessions: state.sessions, spaces: state.spaces, sessionForks: state.sessionForks }), shallowEqual);
  // Rows read their own status; the list only needs which Chats run, so a Turn update re-renders one row, not every row.
  const runningIds = useAppSelector(({ state }) => state.sessions.filter((session) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running").map((session) => session.id), shallowEqual);
  const connectionUnavailable = useAppSelector((app) => app.connectionUnavailable);
  const listRef = useRef<LegendListRef>(null);
  useScrollToTop(listRef);
  const [query, setQuery] = useState("");
  const search = useLargeTitleSearch({ onQueryChange: setQuery, scrollY, scrollRef, headerHeight });
  // An active search pins its field; the bar does not snap under it.
  const titleSnap = useLargeTitleSnap(scrollRef, titleScroll, !nativeHeaders && !search.held);
  const sourcePreference = useSessionSourcePreference();
  const botMode = useBotMode(userUuid).enabled;
  // The Bots view is not a server source; with Bot mode off a saved choice of it reads as every source.
  const sourceFilter = sourcePreference.filter === "bots" ? "all" : sourcePreference.filter;
  // The archive is a place to visit, not a saved preference: the tab reopens on the chosen source.
  const [archivedView, setArchivedView] = useState(false);
  // Turning Bot mode on selects the Bots view from Settings; arriving there also leaves the archive.
  const botsChosen = botMode && sourcePreference.filter === "bots";
  const [seenBotsChosen, setSeenBotsChosen] = useState(botsChosen);
  if (seenBotsChosen !== botsChosen) {
    setSeenBotsChosen(botsChosen);
    if (botsChosen) setArchivedView(false);
  }
  const botsView = botMode && !archivedView && sourcePreference.filter === "bots";
  const shownSource: ChatsSource = botsView ? "bots" : sourceFilter;
  const bots = useBots(botsView);
  const listFilter: ChatsListFilter = archivedView ? "archived" : sourceFilter;
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [expandedForks, setExpandedForks] = useState<ReadonlySet<string>>(() => new Set());
  const sourceButtonRef = useRef<View>(null);
  const toast = useToast();
  const selectSource = (next: ChatsSource) => {
    setArchivedView(false);
    if (next === shownSource) return;
    void saveSessionSourcePreference(next).catch(() => toast({ title: t("chats.source.saveFailed"), tone: "danger" }));
  };
  const sourceSessions = useSourceSessions(client, listFilter);
  const sourceSessionList = sourceSessions.sessions;
  const sourceLoadMore = sourceSessions.loadMore;
  const sourceLoadingMore = sourceSessions.loadingMore;
  const baseSessions = listFilter === "all" ? state.sessions : sourceSessionList;
  const [visibleSpaceIds, setVisibleSpaceIds] = useState<string[]>([]);
  useSpaceRealtime(visibleSpaceIds);
  const visibleRowsRef = useRef<(keys: readonly string[]) => void>(() => undefined);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatListItem>[] }) => {
    visibleRowsRef.current(viewableItems.filter((token) => token.isViewable).map((token) => token.key));
    const ids = [...new Set(viewableItems.filter((token) => token.isViewable).flatMap(({ item }) => item.kind === "fork-toggle" ? [] : [item.kind === "local-session" ? item.session.spaceId : item.kind === "local-space" ? item.space.id : item.kind === "bot" ? item.entry.space.id : item.hit.spaceId]))].slice(0, 10);
    setVisibleSpaceIds((previous) => previous.join(",") === ids.join(",") ? previous : ids);
  }, []);
  useSyncQuery("chats", refreshChats, 15_000, listFilter === "all" && !state.booting);
  const dataError = (botsView ? bots.error : null) ?? state.sessionsError ?? sourceSessions.error ?? sourcePreference.error ?? state.error ?? state.sessionStatusError;
  const remoteSearch = useRemoteSearch(client, query, { enabled: listFilter === "all" && !botsView, types: CHAT_SEARCH_TYPES });
  const trimmedQuery = normalizeSearchQuery(query);
  useEffect(() => {
    if (listFilter === "all" || sourceSessionList.length === 0) return;
    void refreshSessionStatuses(sourceSessionList, { silent: true });
  }, [refreshSessionStatuses, listFilter, sourceSessionList]);

  // In Bot mode a Bot is reached only as a Bot: its Spaces' Chats leave the other views and search.
  const botSpaceIds = useMemo(() => new Set(botMode ? state.spaces.filter(isBotSpace).map((space) => space.id) : []), [botMode, state.spaces]);
  const localSessions = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    const shown = baseSessions.filter((session) => !botSpaceIds.has(session.spaceId));
    if (!needle) return shown;
    return shown.filter((session) => [session.title, session.latestMessageText, session.space?.name].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [baseSessions, botSpaceIds, trimmedQuery]);
  const localSpaces = useMemo(() => {
    if (listFilter !== "all" || !trimmedQuery) return [];
    const needle = trimmedQuery.toLowerCase();
    return state.spaces.filter((space) => !botSpaceIds.has(space.id) && [space.name, space.title, space.description].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [botSpaceIds, listFilter, state.spaces, trimmedQuery]);
  const countSpaceIds = useMemo(() => localSpaces.filter((space) => !space.description?.trim()).map((space) => space.id), [localSpaces]);
  // Search results reuse already-probed counts; they do not fan out probes of their own.
  const spaceSessionCounts = useSpaceSessionCounts(client, countSpaceIds, { probe: false });
  const sessionForks = state.sessionForks;
  const listItems = useMemo<ChatListItem[]>(() => {
    const flatSession = (session: (typeof localSessions)[number]) => ({ kind: "local-session" as const, session, fork: sessionForks[session.id] ?? null, tree: null });
    if (botsView) {
      const needle = trimmedQuery.toLowerCase();
      return bots.entries.filter((entry) => !needle || normalizeSearchQuery(displaySpaceName(entry.space)).toLowerCase().includes(needle)).map((entry) => ({ kind: "bot" as const, entry }));
    }
    if (!trimmedQuery && listFilter === "all") {
      const running = new Set(runningIds);
      const keep = (session: (typeof localSessions)[number]) => running.has(session.id);
      return buildSessionForkTree(localSessions, sessionForks, { expanded: expandedForks, keep }).map((entry): ChatListItem => entry.type === "toggle"
        ? { kind: "fork-toggle", rootId: entry.rootId, hidden: entry.hidden, expanded: entry.expanded }
        : { kind: "local-session", session: entry.session, fork: entry.fork, tree: entry.tree });
    }
    if (!trimmedQuery || listFilter !== "all") return localSessions.map(flatSession);
    const remoteQueryMatches = remoteSearch.query === trimmedQuery;
    const remoteSessions = remoteQueryMatches ? remoteSearch.sessions.filter((hit) => !botSpaceIds.has(hit.spaceId)) : [];
    const remoteSpaces = remoteQueryMatches ? remoteSearch.spaces.filter((hit) => !botSpaceIds.has(hit.spaceId)) : [];
    const remoteSessionIds = new Set(remoteSessions.map((hit) => hit.sessionId));
    const remoteSpaceIds = new Set(remoteSpaces.map((hit) => hit.spaceId));
    return [
      ...remoteSessions.map((hit) => ({ kind: "remote-session" as const, hit })),
      ...localSessions.filter((session) => !remoteSessionIds.has(session.id)).map(flatSession),
      ...remoteSpaces.map((hit) => ({ kind: "remote-space" as const, hit })),
      ...localSpaces.filter((space) => !remoteSpaceIds.has(space.id)).map((space) => ({ kind: "local-space" as const, space })),
    ];
  }, [botSpaceIds, bots.entries, botsView, expandedForks, listFilter, localSessions, localSpaces, remoteSearch.query, remoteSearch.sessions, remoteSearch.spaces, runningIds, sessionForks, trimmedQuery]);

  // Running Chats move up by recent activity; while the list is moving under a finger the order
  // holds and only row content updates, so the row being reached for is not swapped out.
  // Release follows whichever comes last of drag end, momentum end, or a scroll event (iOS skips momentum end
  // when a touch stops a fling); blur and a hard cap cover gestures whose end never arrives.
  const orderContext = `${botsView ? "bots" : listFilter}\n${trimmedQuery}`;
  const [heldOrder, setHeldOrder] = useState<{ context: string; keys: readonly string[] } | null>(null);
  const shownKeysRef = useRef<readonly string[]>([]);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const shownItems = useMemo(() => heldOrder?.context === orderContext ? holdOrder(listItems, heldOrder.keys) : listItems, [heldOrder, listItems, orderContext]);
  const rowMotion = useListContinuity({
    items: shownItems,
    keyOf: chatItemKey,
    list: botsView ? "bots" : listFilter,
    query: trimmedQuery,
    // A held order is a finger on the list; the rows it frees afterwards do move.
    quiet: () => heldOrder !== null || pullRefreshing || state.booting,
    scrollY,
    contentInset: nativeHeaders ? 0 : headerHeight,
  });
  const emptyFill = useEmptyListFill(shownItems.length === 0);
  useEffect(() => { visibleRowsRef.current = rowMotion.setVisibleKeys; });
  useEffect(() => { shownKeysRef.current = shownItems.map(chatItemKey); }, [shownItems]);
  const clearOrderTimers = useCallback(() => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    if (holdLimitTimerRef.current) clearTimeout(holdLimitTimerRef.current);
    releaseTimerRef.current = null;
    holdLimitTimerRef.current = null;
  }, []);
  const dropHeldOrder = useCallback(() => {
    clearOrderTimers();
    draggingRef.current = false;
    setHeldOrder(null);
  }, [clearOrderTimers]);
  const holdRowOrder = useCallback(() => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
    // The cap restarts with each drag, so a long run of flings is never reordered under the finger.
    if (holdLimitTimerRef.current) clearTimeout(holdLimitTimerRef.current);
    holdLimitTimerRef.current = setTimeout(dropHeldOrder, ORDER_HOLD_MAX_MS);
    setHeldOrder((current) => current?.context === orderContext ? current : { context: orderContext, keys: shownKeysRef.current });
  }, [dropHeldOrder, orderContext]);
  const releaseRowOrder = useCallback(() => {
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(dropHeldOrder, ORDER_SETTLE_MS);
  }, [dropHeldOrder]);
  useScreenVisibleEffect(useCallback(() => dropHeldOrder, [dropHeldOrder]));
  useEffect(() => clearOrderTimers, [clearOrderTimers]);
  const emptyError = Boolean(dataError) && shownItems.length === 0;
  // Offered only while a shown row has a dot; a running Chat's row shows its ring instead.
  const hasUnread = useAppSelector((app) => shownItems.some((item) => item.kind === "local-session"
    ? !runningIds.includes(item.session.id) && isSessionUnread(item.session, app.sessionSeen)
    : item.kind === "bot" && item.entry.note !== null && item.entry.chatId !== null && isSessionUnread({ id: item.entry.chatId, lastMessageId: item.entry.note.messageId, lastMessageAt: item.entry.note.at }, app.sessionSeen)));

  // LegendList memoizes each row on [item, extraData]; cached space counts load after the
  // first render but never change `listItems`, so they must flow through extraData.
  const rowExtraData = useMemo(
    () => ({ spaceSessionCounts, t, theme, prefetchSession, selectedChatId }),
    [spaceSessionCounts, t, theme, prefetchSession, selectedChatId],
  );

  const refresh = () => { if (botsView) void bots.refetch(); if (listFilter !== "all") sourceSessions.reload(); void loadSessionSourcePreference().catch(() => undefined); return refreshHome().catch(() => undefined); };
  const refreshOnPull = async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  };

  const openSearchSession = (sessionId: string, target?: SessionNavigationTarget) => {
    openChat({ sessionId, turn: target?.turn != null ? String(target.turn) : undefined, turnId: target?.turnId || undefined });
  };
  // A Bot row always opens the user's Chat with that Bot, making it first if the Bot has none yet.
  const openBot = async (spaceId: string, prefill?: string) => {
    let sessionId: string;
    try {
      sessionId = await bots.openChat(spaceId);
    } catch (error) {
      toast({ title: t("bots.openFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
      return;
    }
    // Opening never waits on the prefill: a local draft failure still lands on the Bot.
    if (prefill) await loadComposerDraft(spaceId, { kind: "session", sessionId }).then((draft) => draft.trim() ? undefined : saveComposerDraft(spaceId, { kind: "session", sessionId }, prefill)).catch(() => undefined);
    openSearchSession(sessionId);
  };
  const primaryBot = bots.entries.find((entry) => entry.space.slug === PRIMARY_BOT_SLUG) ?? null;

  const sourceOptions: readonly { value: ChatsSource; label: string; detail?: string; icon: NativeMenuAction["icon"] }[] = [
    { value: "all", label: t("chats.source.all"), icon: "messages" },
    { value: "web", label: t("chats.source.web"), detail: t("chats.source.web.detail"), icon: "globe" },
    { value: "other", label: t("chats.source.other"), detail: t("chats.source.other.detail"), icon: "link" },
    ...(botMode ? [{ value: "bots" as const, label: t("chats.source.bots"), detail: t("chats.source.bots.detail"), icon: "sparkles" as const }] : []),
  ];
  const sourceLabel = archivedView ? t("chats.archived") : sourceOptions.find((option) => option.value === shownSource)?.label ?? t("chats.source.all");
  // Counting a source needs its own paged query, so each choice says what it covers instead.
  const sourceActions: NativeMenuAction[] = [
    ...sourceOptions.map((option) => ({ icon: option.icon, title: option.label, detail: option.detail, checked: !archivedView && option.value === shownSource, onPress: () => selectSource(option.value) })),
    { icon: "archive", title: t("chats.archived"), checked: archivedView, onPress: () => setArchivedView(true) },
    ...(hasUnread ? [{ icon: "check-check" as const, title: t("chats.action.markAllRead"), onPress: () => void markAllSessionsSeen().catch(() => toast({ title: t("chats.markAllRead.failed"), tone: "danger" })) }] : []),
  ];
  const hasActiveFilter = Boolean(trimmedQuery) || listFilter !== "all" || botsView;
  const newAction = botsView
    ? { label: t("bots.newBot"), icon: "plus" as const, disabled: !primaryBot, onPress: () => { if (primaryBot) void openBot(primaryBot.space.id, t("bots.newBot.prompt")); } }
    : { label: t("chats.action.newChat"), icon: "square-pen" as const, disabled: false, onPress: () => router.push("/new-chat") };
  const pullRefresh = useBrandRefresh({ refreshing: pullRefreshing, onRefresh: refreshOnPull });
  useNativeHeader({
    title: t("tabs.chats"),
    search: { query, onQueryChange: setQuery, placeholder: t("ui.search.placeholder") },
    // Leading to trailing: the prominent action takes the trailing edge, as on Android.
    items: [
      { kind: "menu", label: t("chats.source.filter"), icon: archivedView ? "archive" : "filter", title: sourceLabel, active: listFilter !== "all" || botsView, actions: sourceActions },
      { kind: "button", label: newAction.label, icon: newAction.icon, prominent: true, disabled: newAction.disabled, onPress: newAction.onPress },
    ],
  });
  const searchEmpty = trimmedQuery.length >= 2 && remoteSearch.query === trimmedQuery && remoteSearch.loading && listItems.length === 0
    ? <LoadingState label={t("chats.searching")} />
    : archivedView && !trimmedQuery
      ? <EmptyState icon="archive" title={t("chats.empty.archived.title")} description={t("chats.empty.archived.body")} action={{ icon: "x", label: t("chats.action.clearFilters"), onPress: () => selectSource("all") }} />
      : botsView && !trimmedQuery
        ? <EmptyState icon="sparkles" title={t("bots.empty")} />
      : <EmptyState icon={hasActiveFilter ? "search" : "messages"} title={hasActiveFilter ? t("chats.empty.matching.title") : t("chats.empty.none.title")} action={hasActiveFilter ? { icon: "x", label: t("chats.action.clearFilters"), onPress: () => { setQuery(""); if (!botsView) selectSource("all"); } } : undefined} />;

  const renderChatRow = (item: ChatListItem) => {
    if (item.kind === "remote-session") return <SessionSearchRow hit={item.hit} onPress={(target) => openSearchSession(item.hit.sessionId, target)} onPressIn={() => prefetchSession(item.hit.sessionId)} />;
    if (item.kind === "local-session") return <SessionRow session={item.session} fork={item.fork} tree={item.tree} selected={item.session.id === selectedChatId} onPress={() => openSearchSession(item.session.id)} onPressIn={() => prefetchSession(item.session.id)} />;
    if (item.kind === "fork-toggle") return <SessionForkToggle hidden={item.hidden} expanded={item.expanded} onPress={() => { dropHeldOrder(); setExpandedForks((current) => toggleSetMember(current, item.rootId)); }} />;
    if (item.kind === "bot") return <BotRow entry={item.entry} onPress={() => void openBot(item.entry.space.id)} onPressIn={item.entry.chatId ? () => prefetchSession(item.entry.chatId!, { notesOnly: true }) : undefined} />;
    if (item.kind === "remote-space") return <SpaceSearchRow hit={item.hit} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.hit.spaceId } })} />;
    return <SpaceRow space={item.space} sessionCount={spaceSessionCounts[item.space.id] ?? null} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.space.id } })} />;
  };

  return (
    <Screen edgeToEdge blurTarget={blurTarget}>
      {nativeHeaders ? null : <EdgeHeader onLayout={onHeaderLayout} scrollY={scrollY} blurTarget={blurTarget} edgeRange={titleScroll.edge} hidden={search}>
      <LargeTitleBar title={t("tabs.chats")} scrollY={scrollY} hold={titleScroll.hold} actions={<>
        <MenuAnchor ref={sourceButtonRef} open={sourceMenuOpen}>
          <IconButton name={archivedView ? "archive" : "filter"} label={`${t("chats.source.filter")}, ${sourceLabel}`} tone={listFilter !== "all" || botsView ? "active" : "default"} onPress={() => setSourceMenuOpen(true)} testID="chats-source-menu-button" />
        </MenuAnchor>
        <IconButton name={newAction.icon} label={newAction.label} tone="accent" disabled={newAction.disabled} onPress={newAction.onPress} />
      </>} />
      <ConnectionBanner visible={connectionUnavailable} />
      {dataError && !emptyError ? <DataError message={dataError} onRetry={refresh} /> : null}
      </EdgeHeader>}
      <EdgeBlurTarget attach={attachBlurTarget}>
      <LargeTitleSearchLift search={nativeHeaders ? undefined : search}>
      <BrandRefreshArea refresh={pullRefresh} top={headerHeight}>
      <ListContinuityProvider rows={rowMotion.rows}>
      <AnimatedLegendList
        ref={listRef}
        refScrollView={scrollRef}
        onScroll={(event) => { pullRefresh.onScroll(event); if (!draggingRef.current && releaseTimerRef.current) releaseRowOrder(); }}
        onScrollBeginDrag={(event) => { draggingRef.current = true; holdRowOrder(); pullRefresh.onScrollBeginDrag(event); }}
        onScrollEndDrag={(event) => { draggingRef.current = false; releaseRowOrder(); titleSnap.onScrollEndDrag?.(event); }}
        onMomentumScrollBegin={titleSnap.onMomentumScrollBegin}
        onMomentumScrollEnd={(event) => { draggingRef.current = false; releaseRowOrder(); titleSnap.onMomentumScrollEnd?.(event); }}
        scrollEventThrottle={16}
        data={rowMotion.data}
        itemLayoutAnimation={rowMotion.itemLayoutAnimation}
        extraData={rowExtraData}
        estimatedItemSize={80}
        // Recent-activity reordering must not scroll the list to follow an old row.
        maintainVisibleContentPosition={false}
        onViewableItemsChanged={onViewableItemsChanged}
        keyExtractor={chatItemKey}
        renderItem={({ item }) => <ListContinuityRow rowKey={chatItemKey(item)}>{renderChatRow(item)}</ListContinuityRow>}
        keyboardShouldPersistTaps="handled"
        // UI captures hide the scroll bar, which Android leaves up after a tab switch.
        showsVerticalScrollIndicator={!uiSnapshots}
        {...pullRefresh.listProps}
        onEndReached={() => { if (trimmedQuery || botsView) return; if (listFilter !== "all") { sourceLoadMore(); return; } void loadMoreSessions(); }}
        onEndReachedThreshold={0.7}
        {...(nativeHeaders ? NAVIGATION_BAR_INSETS : { contentInsetAdjustmentBehavior: "never", scrollIndicatorInsets: { top: headerHeight, bottom: tabBarInset } })}
        contentContainerStyle={{ paddingTop: nativeHeaders ? 0 : headerHeight, paddingBottom: tabBarInset, ...emptyFill.style }}
        onLayout={(event) => { emptyFill.onLayout?.(event); rowMotion.onListLayout(event); }}
        ListHeaderComponentStyle={search.listHeaderStyle}
        ListHeaderComponent={<View onLayout={rowMotion.onHeaderLayout}>
          {pullRefresh.header}
          {nativeHeaders ? null : <LargeTitle title={t("tabs.chats")} scrollY={scrollY} hold={titleScroll.hold} search={search} />}
          {nativeHeaders ? null : <LargeTitleSearch scrollY={scrollY} field={{ value: query, onChangeText: setQuery }} search={search} />}
          <View className="px-3">
          {nativeHeaders ? <><ConnectionBanner visible={connectionUnavailable} />{dataError && !emptyError ? <DataError message={dataError} onRetry={refresh} /> : null}</> : null}
          {remoteSearch.query === trimmedQuery && remoteSearch.loading && listItems.length > 0 ? <ListEdgeLoader label={t("chats.searching")} /> : null}
          {remoteSearch.query === trimmedQuery && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2 pl-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable numberOfLines={2} className="flex-1 text-caption text-danger">{remoteSearch.error}</Text><IconButton name="refresh" label={t("chats.search.retry")} onPress={remoteSearch.retry} tone="accent" /></View> : null}
          </View>
        </View>}
        ListEmptyComponent={emptyError ? <EmptyState icon="cloud-off" title={t("chats.error.title")} description={t("chats.error.body")} action={{ icon: "refresh", label: t("common.retry"), onPress: () => void refresh() }} /> : state.booting || (botsView && bots.loading) || (listFilter !== "all" && (sourceSessions.loading || !sourceSessions.initialized)) ? <LoadingRows count={5} /> : searchEmpty}
        ListFooterComponent={!dataError && (state.sessionsLoadingMore || (listFilter !== "all" && sourceLoadingMore)) ? <ListEdgeLoader label={t("chats.loadingMore")} /> : null}
      />
      </ListContinuityProvider>
      </BrandRefreshArea>
      </LargeTitleSearchLift>
      </EdgeBlurTarget>
      <MenuPresence open={sourceMenuOpen}><AnchoredActionMenu
        anchorRef={sourceButtonRef}
        title={t("chats.source.title")}
        heading={sourceLabel}
        testID="chats-source-menu"
        onClose={() => setSourceMenuOpen(false)}
        actions={sourceActions}
      /></MenuPresence>
    </Screen>
  );
}

function chatItemKey(item: ChatListItem) {
  if (item.kind === "bot") return `bot:${item.entry.space.id}`;
  return item.kind === "remote-session" ? `remote-session:${item.hit.sessionId}` : item.kind === "local-session" ? `session:${item.session.id}` : item.kind === "fork-toggle" ? `forks:${item.rootId}` : item.kind === "remote-space" ? `remote-space:${item.hit.spaceId}` : `space:${item.space.id}`;
}

/** A group is a top-level row with the fork rows and toggle drawn under it. */
function chatItemGroups(items: readonly ChatListItem[]) {
  const groups: { key: string; items: ChatListItem[] }[] = [];
  for (const item of items) {
    const nested = item.kind === "fork-toggle" || (item.kind === "local-session" && (item.tree?.depth ?? 0) > 0);
    const current = groups.at(-1);
    if (nested && current) current.items.push(item);
    else groups.push({ key: chatItemKey(item), items: [item] });
  }
  return groups;
}

/**
 * Held groups keep their slots with fresh content; groups that arrived meanwhile append, so nothing
 * above them shifts. Rows inside a group take the fresh order, which keeps fork rows under their parent.
 */
function holdOrder(items: ChatListItem[], keys: readonly string[]): ChatListItem[] {
  const byKey = new Map(chatItemGroups(items).map((group) => [group.key, group.items] as const));
  const held = keys.flatMap((key) => {
    const group = byKey.get(key);
    if (!group) return [];
    byKey.delete(key);
    return group;
  });
  return [...held, ...[...byKey.values()].flat()];
}

function toggleSetMember(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}
