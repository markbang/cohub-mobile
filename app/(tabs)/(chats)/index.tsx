import { useFocusEffect, useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LegendList, type LegendListRef, type ViewToken } from "@legendapp/list/react-native";
import { Text, TextInput, View } from "react-native";
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
import { AppIcon, ConnectionBanner, DataError, EmptyState, IconButton, ListEdgeLoader, LoadingRows, LoadingState, Screen, SearchField } from "@/src/ui";
import { loadSessionSourcePreference, saveSessionSourcePreference, useSessionSourcePreference } from "@/src/data/session-filter-preference";
import type { SessionSourceFilter } from "@/src/data/session-source";
import { useSourceSessions } from "@/src/data/use-source-sessions";
import { useSyncQuery } from "@/src/data/query";
import { uiSnapshots } from "@/src/config";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { SpaceRow } from "@/src/components/SpaceRow";
import { buildSessionForkTree, type SessionTreePosition } from "@/src/data/session-fork-tree";
import { sessionListStatus } from "@/src/data/session-status";
import { EdgeBlurTarget, EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";
import { LargeTitle, LargeTitleBar, LargeTitleSearch, largeTitleScroll, useLargeTitleSnap } from "@/src/ui/LargeTitle";
import { BrandRefreshArea, useBrandRefresh } from "@/src/ui/BrandRefresh";
import { NAVIGATION_BAR_INSETS, nativeHeaders, useEmptyListFill, useNativeHeader } from "@/src/ui/NativeHeader";

type ChatListItem =
  | { kind: "local-session"; session: import("@neta-art/cohub").UserSessionListItem; fork: import("@neta-art/cohub").SessionListFork | null; tree: SessionTreePosition | null }
  | { kind: "remote-session"; hit: RemoteSessionSearchHit }
  | { kind: "local-space"; space: import("@neta-art/cohub").SpaceRecord }
  | { kind: "remote-space"; hit: RemoteSpaceSearchHit }
  | { kind: "fork-toggle"; rootId: string; hidden: number; expanded: boolean };
const CHAT_SEARCH_TYPES = ["chat", "space"] as const;
/** How long the row order stays held after a drag or fling settles, so a follow-up tap lands on the row it aimed at. */
const ORDER_SETTLE_MS = 800;
/** Android drops `onScrollEndDrag` when a gesture is cancelled, so no hold may outlast this. */
const ORDER_HOLD_MAX_MS = 5000;

export default function ChatsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout, scrollY, scrollRef, blurTarget, attachBlurTarget } = useEdgeChrome({ trackScroll: true });
  const titleScroll = largeTitleScroll(true);
  const titleSnap = useLargeTitleSnap(scrollRef, titleScroll, !nativeHeaders);
  const { client, refreshHome, refreshChats, refreshSessionStatuses, loadMoreSessions, prefetchSession } = useAppActions();
  // Stream batches touch only `sessionViews`, which this tab never reads.
  const state = useAppSelector(({ state }) => ({ booting: state.booting, error: state.error, sessionsError: state.sessionsError, sessionStatusError: state.sessionStatusError, sessionsLoadingMore: state.sessionsLoadingMore, sessions: state.sessions, spaces: state.spaces, sessionForks: state.sessionForks }), shallowEqual);
  // Rows read their own status; the list only needs which Chats run, so a Turn update re-renders one row, not every row.
  const runningIds = useAppSelector(({ state }) => state.sessions.filter((session) => sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses) === "running").map((session) => session.id), shallowEqual);
  const connectionUnavailable = useAppSelector((app) => app.connectionUnavailable);
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<LegendListRef>(null);
  useScrollToTop(listRef);
  const [query, setQuery] = useState("");
  const sourcePreference = useSessionSourcePreference();
  const sourceFilter = sourcePreference.filter;
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [expandedForks, setExpandedForks] = useState<ReadonlySet<string>>(() => new Set());
  const sourceButtonRef = useRef<View>(null);
  const toast = useToast();
  const selectSource = (next: SessionSourceFilter) => {
    if (next === sourceFilter) return;
    void saveSessionSourcePreference(next).catch(() => toast({ title: t("chats.source.saveFailed"), tone: "danger" }));
  };
  const sourceSessions = useSourceSessions(client, sourceFilter);
  const sourceSessionList = sourceSessions.sessions;
  const sourceLoadMore = sourceSessions.loadMore;
  const sourceLoadingMore = sourceSessions.loadingMore;
  const baseSessions = sourceFilter === "all" ? state.sessions : sourceSessionList;
  const [visibleSpaceIds, setVisibleSpaceIds] = useState<string[]>([]);
  useSpaceRealtime(visibleSpaceIds);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatListItem>[] }) => {
    const ids = [...new Set(viewableItems.filter((token) => token.isViewable).flatMap(({ item }) => item.kind === "fork-toggle" ? [] : [item.kind === "local-session" ? item.session.spaceId : item.kind === "local-space" ? item.space.id : item.hit.spaceId]))].slice(0, 10);
    setVisibleSpaceIds((previous) => previous.join(",") === ids.join(",") ? previous : ids);
  }, []);
  useSyncQuery("chats", refreshChats, 15_000, sourceFilter === "all" && !state.booting);
  const dataError = state.sessionsError ?? sourceSessions.error ?? sourcePreference.error ?? state.error ?? state.sessionStatusError;
  const remoteSearch = useRemoteSearch(client, query, { enabled: sourceFilter === "all", types: CHAT_SEARCH_TYPES });
  const trimmedQuery = normalizeSearchQuery(query);
  useEffect(() => {
    if (sourceFilter === "all" || sourceSessionList.length === 0) return;
    void refreshSessionStatuses(sourceSessionList, { silent: true });
  }, [refreshSessionStatuses, sourceFilter, sourceSessionList]);

  const localSessions = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    if (!needle) return baseSessions;
    return baseSessions.filter((session) => [session.title, session.latestMessageText, session.space?.name].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [baseSessions, trimmedQuery]);
  const localSpaces = useMemo(() => {
    if (sourceFilter !== "all" || !trimmedQuery) return [];
    const needle = trimmedQuery.toLowerCase();
    return state.spaces.filter((space) => [space.name, space.title, space.description].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [sourceFilter, state.spaces, trimmedQuery]);
  const countSpaceIds = useMemo(() => localSpaces.filter((space) => !space.description?.trim()).map((space) => space.id), [localSpaces]);
  // Search results reuse already-probed counts; they do not fan out probes of their own.
  const spaceSessionCounts = useSpaceSessionCounts(client, countSpaceIds, { probe: false });
  const sessionForks = state.sessionForks;
  const listItems = useMemo<ChatListItem[]>(() => {
    const flatSession = (session: (typeof localSessions)[number]) => ({ kind: "local-session" as const, session, fork: sessionForks[session.id] ?? null, tree: null });
    if (!trimmedQuery && sourceFilter === "all") {
      const running = new Set(runningIds);
      const keep = (session: (typeof localSessions)[number]) => running.has(session.id);
      return buildSessionForkTree(localSessions, sessionForks, { expanded: expandedForks, keep }).map((entry): ChatListItem => entry.type === "toggle"
        ? { kind: "fork-toggle", rootId: entry.rootId, hidden: entry.hidden, expanded: entry.expanded }
        : { kind: "local-session", session: entry.session, fork: entry.fork, tree: entry.tree });
    }
    if (!trimmedQuery || sourceFilter !== "all") return localSessions.map(flatSession);
    const remoteQueryMatches = remoteSearch.query === trimmedQuery;
    const remoteSessions = remoteQueryMatches ? remoteSearch.sessions : [];
    const remoteSpaces = remoteQueryMatches ? remoteSearch.spaces : [];
    const remoteSessionIds = new Set(remoteSessions.map((hit) => hit.sessionId));
    const remoteSpaceIds = new Set(remoteSpaces.map((hit) => hit.spaceId));
    return [
      ...remoteSessions.map((hit) => ({ kind: "remote-session" as const, hit })),
      ...localSessions.filter((session) => !remoteSessionIds.has(session.id)).map(flatSession),
      ...remoteSpaces.map((hit) => ({ kind: "remote-space" as const, hit })),
      ...localSpaces.filter((space) => !remoteSpaceIds.has(space.id)).map((space) => ({ kind: "local-space" as const, space })),
    ];
  }, [expandedForks, localSessions, localSpaces, remoteSearch.query, remoteSearch.sessions, remoteSearch.spaces, runningIds, sessionForks, sourceFilter, trimmedQuery]);

  // Running Chats move up by recent activity; while the list is moving under a finger the order
  // holds and only row content updates, so the row being reached for is not swapped out.
  // Release follows whichever comes last of drag end, momentum end, or a scroll event (iOS skips momentum end
  // when a touch stops a fling); blur and a hard cap cover gestures whose end never arrives.
  const orderContext = `${sourceFilter}\n${trimmedQuery}`;
  const [heldOrder, setHeldOrder] = useState<{ context: string; keys: readonly string[] } | null>(null);
  const shownKeysRef = useRef<readonly string[]>([]);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const shownItems = useMemo(() => heldOrder?.context === orderContext ? holdOrder(listItems, heldOrder.keys) : listItems, [heldOrder, listItems, orderContext]);
  const emptyFill = useEmptyListFill(shownItems.length === 0);
  // iOS 27 opens Chats with its search field tucked under the Large Title, to be pulled down; the drawn bar
  // does the same once the first rows are in, unless the list has already been scrolled.
  const searchTucked = useRef(nativeHeaders);
  const hasRows = shownItems.length > 0;
  useEffect(() => {
    if (searchTucked.current || !hasRows) return;
    const frame = requestAnimationFrame(() => {
      searchTucked.current = true;
      if (scrollY.get() === 0) scrollRef.current?.scrollTo({ y: titleScroll.hold, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [hasRows, scrollRef, scrollY, titleScroll.hold]);
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
  useFocusEffect(useCallback(() => dropHeldOrder, [dropHeldOrder]));
  useEffect(() => clearOrderTimers, [clearOrderTimers]);
  const emptyError = Boolean(dataError) && shownItems.length === 0;

  // LegendList memoizes each row on [item, extraData]; cached space counts load after the
  // first render but never change `listItems`, so they must flow through extraData.
  const rowExtraData = useMemo(
    () => ({ spaceSessionCounts, t, theme, prefetchSession }),
    [spaceSessionCounts, t, theme, prefetchSession],
  );

  const refresh = () => { if (sourceFilter !== "all") sourceSessions.reload(); void loadSessionSourcePreference().catch(() => undefined); return refreshHome().catch(() => undefined); };
  const refreshOnPull = async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  };

  const openSearchSession = (sessionId: string, target?: SessionNavigationTarget) => {
    router.push({ pathname: "/chat/[sessionId]", params: { sessionId, ...(target?.turn != null ? { turn: String(target.turn) } : {}), ...(target?.turnId ? { turnId: target.turnId } : {}) } });
  };

  const sourceOptions = [
    { value: "all", label: t("chats.source.all"), icon: "messages" },
    { value: "web", label: t("chats.source.web"), detail: t("chats.source.web.detail"), icon: "globe" },
    { value: "other", label: t("chats.source.other"), detail: t("chats.source.other.detail"), icon: "link" },
  ] as const satisfies readonly { value: SessionSourceFilter; label: string; detail?: string; icon: NativeMenuAction["icon"] }[];
  const sourceLabel = sourceOptions.find((option) => option.value === sourceFilter)?.label ?? t("chats.source.all");
  // Counting a source needs its own paged query, so each choice says what it covers instead.
  const sourceActions: NativeMenuAction[] = sourceOptions.map((option) => ({ icon: option.icon, title: option.label, detail: "detail" in option ? option.detail : undefined, checked: option.value === sourceFilter, onPress: () => selectSource(option.value) }));
  const hasActiveFilter = Boolean(trimmedQuery) || sourceFilter !== "all";
  const pullRefresh = useBrandRefresh({ refreshing: pullRefreshing, onRefresh: refreshOnPull });
  useNativeHeader({
    title: t("tabs.chats"),
    search: { query, onQueryChange: setQuery, placeholder: t("ui.search.placeholder") },
    // Leading to trailing: the prominent action takes the trailing edge, as on Android.
    items: [
      { kind: "menu", label: t("chats.source.filter"), icon: "filter", title: sourceLabel, active: sourceFilter !== "all", actions: sourceActions },
      { kind: "button", label: t("chats.action.newChat"), icon: "square-pen", prominent: true, onPress: () => router.push("/new-chat") },
    ],
  });
  const searchEmpty = trimmedQuery.length >= 2 && remoteSearch.query === trimmedQuery && remoteSearch.loading && listItems.length === 0
    ? <LoadingState label={t("chats.searching")} />
    : <EmptyState icon={hasActiveFilter ? "search" : "messages"} title={hasActiveFilter ? t("chats.empty.matching.title") : t("chats.empty.none.title")} action={hasActiveFilter ? { icon: "x", label: t("chats.action.clearFilters"), onPress: () => { setQuery(""); selectSource("all"); } } : undefined} />;

  return (
    <Screen edgeToEdge blurTarget={blurTarget}>
      {nativeHeaders ? null : <EdgeHeader onLayout={onHeaderLayout} scrollY={scrollY} blurTarget={blurTarget} edgeRange={titleScroll.edge}>
      <LargeTitleBar title={t("tabs.chats")} scrollY={scrollY} hold={titleScroll.hold} actions={<>
        <MenuAnchor ref={sourceButtonRef} open={sourceMenuOpen}>
          <IconButton name="filter" label={`${t("chats.source.filter")}, ${sourceLabel}`} tone={sourceFilter !== "all" ? "active" : "default"} onPress={() => setSourceMenuOpen(true)} testID="chats-source-menu-button" />
        </MenuAnchor>
        <IconButton name="square-pen" label={t("chats.action.newChat")} tone="accent" onPress={() => router.push("/new-chat")} />
      </>} />
      <ConnectionBanner visible={connectionUnavailable} />
      {dataError && !emptyError ? <DataError message={dataError} onRetry={refresh} /> : null}
      </EdgeHeader>}
      <EdgeBlurTarget attach={attachBlurTarget}>
      <BrandRefreshArea refresh={pullRefresh} top={headerHeight}>
      <LegendList
        ref={listRef}
        refScrollView={scrollRef}
        onScroll={(event) => { pullRefresh.onScroll(event); if (!draggingRef.current && releaseTimerRef.current) releaseRowOrder(); }}
        onScrollBeginDrag={(event) => { draggingRef.current = true; holdRowOrder(); pullRefresh.onScrollBeginDrag(event); }}
        onScrollEndDrag={(event) => { draggingRef.current = false; releaseRowOrder(); titleSnap.onScrollEndDrag?.(event); }}
        onMomentumScrollBegin={titleSnap.onMomentumScrollBegin}
        onMomentumScrollEnd={(event) => { draggingRef.current = false; releaseRowOrder(); titleSnap.onMomentumScrollEnd?.(event); }}
        scrollEventThrottle={16}
        data={shownItems}
        extraData={rowExtraData}
        estimatedItemSize={80}
        // Recent-activity reordering must not scroll the list to follow an old row.
        maintainVisibleContentPosition={false}
        onViewableItemsChanged={onViewableItemsChanged}
        keyExtractor={chatItemKey}
        renderItem={({ item }) => {
          if (item.kind === "remote-session") return <SessionSearchRow hit={item.hit} onPress={(target) => openSearchSession(item.hit.sessionId, target)} onPressIn={() => prefetchSession(item.hit.sessionId)} />;
          if (item.kind === "local-session") return <SessionRow session={item.session} fork={item.fork} tree={item.tree} onPress={() => openSearchSession(item.session.id)} onPressIn={() => prefetchSession(item.session.id)} />;
          if (item.kind === "fork-toggle") return <SessionForkToggle hidden={item.hidden} expanded={item.expanded} onPress={() => { dropHeldOrder(); setExpandedForks((current) => toggleSetMember(current, item.rootId)); }} />;
          if (item.kind === "remote-space") return <SpaceSearchRow hit={item.hit} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.hit.spaceId } })} />;
          return <SpaceRow space={item.space} sessionCount={spaceSessionCounts[item.space.id] ?? null} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.space.id } })} />;
        }}
        keyboardShouldPersistTaps="handled"
        // UI captures hide the scroll bar, which Android leaves up after a tab switch.
        showsVerticalScrollIndicator={!uiSnapshots}
        {...pullRefresh.listProps}
        onEndReached={() => { if (trimmedQuery) return; if (sourceFilter !== "all") { sourceLoadMore(); return; } void loadMoreSessions(); }}
        onEndReachedThreshold={0.7}
        {...(nativeHeaders ? NAVIGATION_BAR_INSETS : { contentInsetAdjustmentBehavior: "never", scrollIndicatorInsets: { top: headerHeight, bottom: tabBarInset } })}
        contentContainerStyle={{ paddingTop: nativeHeaders ? 0 : headerHeight, paddingBottom: tabBarInset, ...emptyFill.style }}
        onLayout={emptyFill.onLayout}
        ListHeaderComponent={<View>
          {pullRefresh.header}
          {nativeHeaders ? null : <LargeTitle title={t("tabs.chats")} scrollY={scrollY} hold={titleScroll.hold} />}
          {nativeHeaders ? null : <LargeTitleSearch scrollY={scrollY}><SearchField value={query} onChangeText={setQuery} inputRef={searchRef} /></LargeTitleSearch>}
          <View className="px-3">
          {nativeHeaders ? <><ConnectionBanner visible={connectionUnavailable} />{dataError && !emptyError ? <DataError message={dataError} onRetry={refresh} /> : null}</> : null}
          {remoteSearch.query === trimmedQuery && remoteSearch.loading && listItems.length > 0 ? <ListEdgeLoader label={t("chats.searching")} /> : null}
          {remoteSearch.query === trimmedQuery && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2 pl-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable numberOfLines={2} className="flex-1 text-caption text-danger">{remoteSearch.error}</Text><IconButton name="refresh" label={t("chats.search.retry")} onPress={remoteSearch.retry} tone="accent" /></View> : null}
          </View>
        </View>}
        ListEmptyComponent={emptyError ? <EmptyState icon="cloud-off" title={t("chats.error.title")} description={t("chats.error.body")} action={{ icon: "refresh", label: t("common.retry"), onPress: () => void refresh() }} /> : state.booting || (sourceFilter !== "all" && (sourceSessions.loading || !sourceSessions.initialized)) ? <LoadingRows count={5} /> : searchEmpty}
        ListFooterComponent={!dataError && (state.sessionsLoadingMore || (sourceFilter !== "all" && sourceLoadingMore)) ? <ListEdgeLoader label={t("chats.loadingMore")} /> : null}
      />
      </BrandRefreshArea>
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
