import { useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LegendList, type LegendListRef, type ViewToken } from "@legendapp/list/react-native";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { AnchoredActionMenu } from "@/src/components/AnchoredActionMenu";
import { NativeMenuButton, nativeMenus, type NativeMenuAction } from "@/src/components/NativeMenu";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { SessionSearchRow, SpaceSearchRow } from "@/src/components/SearchResultRow";
import { SessionRow } from "@/src/components/SessionRow";
import { useToast } from "@/src/components/Toast";
import { normalizeSearchQuery, useRemoteSearch, type RemoteSessionSearchHit, type RemoteSpaceSearchHit, type SessionNavigationTarget } from "@/src/data/session-search";
import { useSpaceSessionCounts } from "@/src/data/space-session-counts";
import { useApp } from "@/src/data/context";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, ConnectionBanner, DataError, EmptyState, ExpandableSearchBar, IconButton, LoadingRows, Screen } from "@/src/ui";
import { loadSessionSourcePreference, saveSessionSourcePreference, useSessionSourcePreference } from "@/src/data/session-filter-preference";
import type { SessionSourceFilter } from "@/src/data/session-source";
import { useSourceSessions } from "@/src/data/use-source-sessions";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { SpaceRow } from "@/src/components/SpaceRow";
import { buildSessionForkTree, type SessionTreePosition } from "@/src/data/session-fork-tree";
import { EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";

type ChatListItem =
  | { kind: "local-session"; session: import("@neta-art/cohub").UserSessionListItem; fork: import("@neta-art/cohub").SessionListFork | null; tree: SessionTreePosition | null }
  | { kind: "remote-session"; hit: RemoteSessionSearchHit }
  | { kind: "local-space"; space: import("@neta-art/cohub").SpaceRecord }
  | { kind: "remote-space"; hit: RemoteSpaceSearchHit };
const CHAT_SEARCH_TYPES = ["chat", "space"] as const;

export default function ChatsScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout, scrollY, onScroll } = useEdgeChrome();
  const { state, client, connectionUnavailable, refreshHome, refreshChats, refreshSessionStatuses, loadMoreSessions, prefetchSession } = useApp();
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<LegendListRef>(null);
  useScrollToTop(listRef);
  const [query, setQuery] = useState("");
  const sourcePreference = useSessionSourcePreference();
  const sourceFilter = sourcePreference.filter;
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const sourceButtonRef = useRef<View>(null);
  const toast = useToast();
  const selectSource = (next: SessionSourceFilter) => {
    if (next === sourceFilter) return;
    void saveSessionSourcePreference(next).catch(() => toast({ title: t("chats.source.saveFailed") }));
  };
  const sourceSessions = useSourceSessions(client, sourceFilter);
  const sourceSessionList = sourceSessions.sessions;
  const sourceLoadMore = sourceSessions.loadMore;
  const sourceLoadingMore = sourceSessions.loadingMore;
  const baseSessions = sourceFilter === "all" ? state.sessions : sourceSessionList;
  const [visibleSpaceIds, setVisibleSpaceIds] = useState<string[]>([]);
  useSpaceRealtime(visibleSpaceIds);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatListItem>[] }) => {
    const ids = [...new Set(viewableItems.filter((token) => token.isViewable).map(({ item }) => item.kind === "local-session" ? item.session.spaceId : item.kind === "local-space" ? item.space.id : item.hit.spaceId))].slice(0, 10);
    setVisibleSpaceIds((previous) => previous.join(",") === ids.join(",") ? previous : ids);
  }, []);
  useSyncScope("chats", refreshChats, 15_000, sourceFilter === "all" && !state.booting);
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
    if (!trimmedQuery && sourceFilter === "all") return buildSessionForkTree(localSessions, sessionForks).map((row) => ({ kind: "local-session", ...row }));
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
  }, [localSessions, localSpaces, remoteSearch.query, remoteSearch.sessions, remoteSearch.spaces, sessionForks, sourceFilter, trimmedQuery]);

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
    { value: "web", label: t("chats.source.web"), icon: "globe" },
    { value: "other", label: t("chats.source.other"), icon: "globe" },
  ] as const satisfies readonly { value: SessionSourceFilter; label: string; icon: NativeMenuAction["icon"] }[];
  const sourceLabel = sourceOptions.find((option) => option.value === sourceFilter)?.label ?? t("chats.source.all");
  // Android menus have no check mark of their own, so the chosen source trades its glyph for one.
  const sourceActions: NativeMenuAction[] = sourceOptions.map((option) => ({ icon: !nativeMenus && option.value === sourceFilter ? "check" : option.icon, title: option.label, checked: option.value === sourceFilter, onPress: () => selectSource(option.value) }));
  const hasActiveFilter = Boolean(trimmedQuery) || sourceFilter !== "all";
  const searchEmpty = trimmedQuery.length >= 2 && remoteSearch.query === trimmedQuery && remoteSearch.loading && listItems.length === 0
    ? <View className="min-h-45 flex-1 items-center justify-center"><ActivityIndicator accessibilityLabel={t("chats.searching")} size="small" color={theme.colors.accent} /></View>
    : <EmptyState icon={hasActiveFilter ? "search" : "messages"} title={hasActiveFilter ? t("chats.empty.matching.title") : t("chats.empty.none.title")} action={hasActiveFilter ? { icon: "x", label: t("chats.action.clearFilters"), onPress: () => { setQuery(""); selectSource("all"); } } : undefined} />;

  return (
    <Screen edgeToEdge>
      <EdgeHeader onLayout={onHeaderLayout} scrollY={scrollY}>
      <ExpandableSearchBar
        transparent
        title={t("tabs.chats")}
        createLabel={t("chats.action.newChat")}
        query={query}
        onQueryChange={setQuery}
        queryRef={searchRef}
        filters={<View className="flex-row">
          {nativeMenus
            ? <NativeMenuButton appearance="chip" icon="filter" label={t("chats.source.filter")} title={sourceLabel} actions={sourceActions} testID="chats-source-menu" />
            : <View ref={sourceButtonRef} collapsable={false}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("chats.source.filter")}, ${sourceLabel}`}
                accessibilityState={{ expanded: sourceMenuOpen }}
                hitSlop={{ top: 5, bottom: 5 }}
                onPress={() => setSourceMenuOpen(true)}
                className={`min-h-8.5 flex-row items-center gap-1.5 rounded-full pl-3.5 pr-2.5 ${sourceFilter !== "all" ? "bg-accent-soft active:bg-surface-pressed" : "bg-surface-raised active:bg-surface-pressed"}`}
              >
                <Text numberOfLines={1} className={`text-subhead font-semibold ${sourceFilter !== "all" ? "text-accent" : "text-fg"}`}>{sourceLabel}</Text>
                <AppIcon name="chevron-down" size={14} tone={sourceFilter !== "all" ? "accent" : "muted"} />
              </Pressable>
            </View>}
        </View>}
        onCreate={() => router.push("/new-chat")}
      />
      <ConnectionBanner visible={connectionUnavailable} />
      {dataError ? <DataError message={dataError} onRetry={refresh} /> : null}
      </EdgeHeader>
      <LegendList
        ref={listRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={listItems}
        extraData={rowExtraData}
        estimatedItemSize={80}
        // Recent-activity reordering must not scroll the list to follow an old row.
        maintainVisibleContentPosition={false}
        onViewableItemsChanged={onViewableItemsChanged}
        keyExtractor={(item) => item.kind === "remote-session" ? `remote-session:${item.hit.sessionId}` : item.kind === "local-session" ? `session:${item.session.id}` : item.kind === "remote-space" ? `remote-space:${item.hit.spaceId}` : `space:${item.space.id}`}
        renderItem={({ item }) => {
          if (item.kind === "remote-session") return <SessionSearchRow hit={item.hit} onPress={(target) => openSearchSession(item.hit.sessionId, target)} onPressIn={() => prefetchSession(item.hit.sessionId)} />;
          if (item.kind === "local-session") return <SessionRow session={item.session} fork={item.fork} tree={item.tree} onPress={() => openSearchSession(item.session.id)} onPressIn={() => prefetchSession(item.session.id)} />;
          if (item.kind === "remote-space") return <SpaceSearchRow hit={item.hit} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.hit.spaceId } })} />;
          return <SpaceRow space={item.space} sessionCount={spaceSessionCounts[item.space.id] ?? null} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.space.id } })} />;
        }}
        keyboardShouldPersistTaps="handled"
        refreshing={pullRefreshing}
        onRefresh={refreshOnPull}
        onEndReached={() => { if (trimmedQuery) return; if (sourceFilter !== "all") { sourceLoadMore(); return; } void loadMoreSessions(); }}
        onEndReachedThreshold={0.7}
        contentInsetAdjustmentBehavior="never"
        progressViewOffset={headerHeight}
        scrollIndicatorInsets={{ top: headerHeight, bottom: tabBarInset }}
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: tabBarInset, flexGrow: listItems.length === 0 ? 1 : undefined }}
        ListHeaderComponent={<View className="px-3">
          {remoteSearch.query === trimmedQuery && remoteSearch.loading ? <View className="min-h-4 items-end"><ActivityIndicator accessibilityLabel={t("chats.searching")} size="small" color={theme.colors.accent} /></View> : null}
          {remoteSearch.query === trimmedQuery && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2 pl-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable numberOfLines={2} className="flex-1 text-caption text-danger">{remoteSearch.error}</Text><IconButton name="refresh" label={t("chats.search.retry")} onPress={remoteSearch.retry} tone="accent" /></View> : null}
        </View>}
        ListEmptyComponent={dataError ? <EmptyState icon="cloud-off" title={t("chats.error.title")} description={t("chats.error.body")} /> : state.booting || (sourceFilter !== "all" && (sourceSessions.loading || !sourceSessions.initialized)) ? <LoadingRows count={5} /> : searchEmpty}
        ListFooterComponent={!dataError && (state.sessionsLoadingMore || (sourceFilter !== "all" && sourceLoadingMore)) ? <View className="items-center py-4.5"><ActivityIndicator accessibilityLabel={t("chats.loadingStatuses")} size="small" color={theme.colors.accent} /></View> : null}
      />
      {sourceMenuOpen ? <AnchoredActionMenu
        anchorRef={sourceButtonRef}
        title={t("chats.source.title")}
        testID="chats-source-menu"
        onClose={() => setSourceMenuOpen(false)}
        actions={sourceActions}
      /> : null}
    </Screen>
  );
}

