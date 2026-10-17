import type { AppRecord, CheckpointRecord, SpaceActivityResponse, SpaceRecord, TaskRunRecord, UserSessionListItem } from "@neta-art/cohub";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { AnchoredActionMenu } from "@/src/components/AnchoredActionMenu";
import { ActivityHeatmap } from "@/src/components/ActivityHeatmap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionRow } from "@/src/components/SessionRow";
import { SpacePanels, type SpacePanel } from "@/src/components/SpacePanels";
import { useApp } from "@/src/data/context";
import { activityContributorName } from "@/src/data/activity";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { mergeTaskRuns, refreshTaskRuns } from "@/src/data/task-sync";
import { publishSpaceSessionCount, SPACE_SESSION_COUNT_PAGE_SIZE } from "@/src/data/space-session-counts";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, TopBar, IconButton, PrimaryButton, Screen, SectionHeader, type IconName, type IconTone } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow, Meta } from "@/src/ui/ListRow";
import { displaySpaceName, formatNumber, formatRelativeTime, sortByRecent } from "@/src/utils";

type Params = { spaceId?: string | string[] };

type Resources = {
  checkpoints: CheckpointRecord[];
  apps: AppRecord[];
  tasks: TaskRunRecord[];
  activity: SpaceActivityResponse | null;
};

type ResourceKey = keyof Resources;
type ResourceFailures = Record<ResourceKey, boolean>;
type ResourceLoading = Record<ResourceKey, boolean>;

const emptyResources: Resources = { checkpoints: [], apps: [], tasks: [], activity: null };
const noResourceFailures: ResourceFailures = { checkpoints: false, apps: false, tasks: false, activity: false };
const allResourcesLoading: ResourceLoading = { checkpoints: true, apps: true, tasks: true, activity: true };
const SPACE_REFRESH_INTERVAL_MS = 60_000;

export default function SpaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const spaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const theme = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { state, client, refreshHome, refreshSessionStatuses, refreshSpacePin, toggleSpacePin, upsertSpace, prefetchSession, spaceList: { recordVisit } } = useApp();
  useFocusEffect(useCallback(() => {
    if (spaceId) recordVisit(spaceId);
  }, [recordVisit, spaceId]));
  const [loadedSpace, setLoadedSpace] = useState<SpaceRecord | null>(null);
  const [spaceLoading, setSpaceLoading] = useState(true);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [resources, setResources] = useState<Resources>(emptyResources);
  const [resourceLoading, setResourceLoading] = useState<ResourceLoading>(allResourcesLoading);
  const loadingResources = resourceLoading.checkpoints || resourceLoading.apps || resourceLoading.tasks || resourceLoading.activity;
  const [taskCursor, setTaskCursor] = useState<string | null>(null);
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false);
  const [resourceFailures, setResourceFailures] = useState<ResourceFailures>(noResourceFailures);
  const [spaceSessions, setSpaceSessions] = useState<UserSessionListItem[]>([]);
  const [spaceSessionsHasMore, setSpaceSessionsHasMore] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [spaceActionsOpen, setSpaceActionsOpen] = useState(false);
  const spaceActionsRef = useRef<View>(null);
  const closeSpaceActions = useCallback(() => setSpaceActionsOpen(false), []);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [checkpointing, setCheckpointing] = useState(false);
  const [activePanel, setActivePanel] = useState<SpacePanel | null>(null);
  const spaceRefreshAtRef = useRef<{ spaceId: string; at: number } | null>(null);
  const spaceRefreshInFlightRef = useRef<{ spaceId: string; token: number } | null>(null);
  const spaceRefreshTokenRef = useRef(0);
  const resourcesRefreshAtRef = useRef(0);
  const resourcesRequestRef = useRef(0);
  const sessionsRefreshAtRef = useRef(0);
  const sessionsRequestRef = useRef(0);
  const resourcesInFlightRef = useRef(false);
  const sessionsInFlightRef = useRef(false);
  const tasksInFlightRef = useRef(false);
  const tasksRequestRef = useRef(0);
  const cachedSpace = state.spaces.find((item) => item.id === spaceId) ?? null;
  const cachedSpaceRef = useRef<SpaceRecord | null>(cachedSpace);
  useEffect(() => {
    cachedSpaceRef.current = cachedSpace;
  }, [cachedSpace]);
  const space = cachedSpace ?? (loadedSpace?.id === spaceId ? loadedSpace : null);
  const sessions = useMemo(() => {
    const byId = new Map<string, UserSessionListItem>();
    for (const session of state.sessions) {
      if (session.spaceId === spaceId) byId.set(session.id, session);
    }
    // The page fetches its own page of Chats; cached entries still win when newer.
    for (const session of spaceSessions) {
      const previous = byId.get(session.id);
      byId.set(session.id, previous ? preferRecentSession(previous, session) : session);
    }
    return sortByRecent([...byId.values()]);
  }, [spaceId, spaceSessions, state.sessions]);

  const loadSpace = useCallback(async (options: { force?: boolean } = {}) => {
    if (!client || !spaceId) return;
    if (spaceRefreshInFlightRef.current?.spaceId === spaceId) return;
    const lastRefresh = spaceRefreshAtRef.current;
    const cached = cachedSpaceRef.current;
    if (!options.force && cached?.id === spaceId && (!lastRefresh || (lastRefresh.spaceId === spaceId && Date.now() - lastRefresh.at < SPACE_REFRESH_INTERVAL_MS))) {
      // Home/cache data is enough for first paint; global Space reconciliation keeps it fresh.
      spaceRefreshAtRef.current ??= { spaceId, at: Date.now() };
      setSpaceLoading(false);
      setSpaceError(null);
      if (cached.isPinned === undefined) void refreshSpacePin(spaceId).catch((error: unknown) => console.warn("[mobile-space] failed to refresh pin state", error));
      return;
    }
    const requestToken = spaceRefreshTokenRef.current + 1;
    spaceRefreshTokenRef.current = requestToken;
    spaceRefreshInFlightRef.current = { spaceId, token: requestToken };
    setSpaceLoading(true);
    setSpaceError(null);
    // Pin state is private metadata, not a prerequisite for rendering the Space shell.
    const pinRequest = refreshSpacePin(spaceId).catch((error: unknown) => {
      console.warn("[mobile-space] failed to refresh pin state", error);
      return null;
    });
    try {
      const remoteSpace = await client.spaces.get(spaceId);
      if (spaceRefreshInFlightRef.current?.token !== requestToken) return;
      spaceRefreshAtRef.current = { spaceId, at: Date.now() };
      setLoadedSpace(remoteSpace);
      upsertSpace(remoteSpace);
      setSpaceLoading(false);
      void pinRequest.then((pinned) => {
        if (pinned === null || spaceRefreshTokenRef.current !== requestToken) return;
        const resolved = { ...remoteSpace, isPinned: pinned };
        setLoadedSpace(resolved);
        upsertSpace(resolved);
      });
    } catch (error) {
      if (spaceRefreshInFlightRef.current?.token !== requestToken) return;
      setSpaceLoading(false);
      setSpaceError(error instanceof Error && error.message.trim() ? error.message : t("space.unavailable"));
    } finally {
      if (spaceRefreshInFlightRef.current?.token === requestToken) spaceRefreshInFlightRef.current = null;
    }
  }, [client, refreshSpacePin, spaceId, t, upsertSpace]);

  const loadResources = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (!client || !spaceId || resourcesInFlightRef.current) return;
    if (!options.force && Date.now() - resourcesRefreshAtRef.current < SPACE_REFRESH_INTERVAL_MS) return;
    const requestToken = ++resourcesRequestRef.current;
    resourcesInFlightRef.current = true;
    const taskToken = ++tasksRequestRef.current;
    if (!options.silent) setResourceLoading(allResourcesLoading);
    const settle = (key: ResourceKey, failed: boolean) => {
      if (resourcesRequestRef.current !== requestToken) return;
      setResourceFailures((current) => ({ ...current, [key]: failed }));
      setResourceLoading((current) => ({ ...current, [key]: false }));
    };
    const checkpointRequest = client.space(spaceId).checkpoints.list({ limit: 5 }).then((result) => {
      if (resourcesRequestRef.current === requestToken) setResources((current) => ({ ...current, checkpoints: result.checkpoints }));
      settle("checkpoints", false);
      return result;
    }).catch((error: unknown) => { settle("checkpoints", true); throw error; });
    const appRequest = client.apps.listBySpace(spaceId).then((result) => {
      if (resourcesRequestRef.current === requestToken) setResources((current) => ({ ...current, apps: result.apps }));
      settle("apps", false);
      return result;
    }).catch((error: unknown) => { settle("apps", true); throw error; });
    const taskRequest = client.tasks.list({ spaceId, limit: 8 }).then((result) => {
      if (resourcesRequestRef.current === requestToken && taskToken === tasksRequestRef.current) {
        setResources((current) => ({ ...current, tasks: options.silent ? mergeTaskRuns(current.tasks, result.runs) : result.runs }));
        if (!options.silent) setTaskCursor(result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null);
      }
      settle("tasks", false);
      return result;
    }).catch((error: unknown) => { settle("tasks", true); throw error; });
    const activityRequest = (async () => {
      try {
        const space = client.space(spaceId);
        if (!space.activity?.get) {
          settle("activity", false);
          return null;
        }
        const result = await space.activity.get(7);
        if (resourcesRequestRef.current === requestToken) {
          setResources((current) => ({ ...current, activity: result }));
        }
        settle("activity", false);
        return result;
      } catch (error: unknown) {
        settle("activity", true);
        throw error;
      }
    })();
    const results = await Promise.allSettled([checkpointRequest, appRequest, taskRequest, activityRequest]);
    resourcesInFlightRef.current = false;
    if (resourcesRequestRef.current !== requestToken) return;
    if (results.every((result) => result.status === "fulfilled")) resourcesRefreshAtRef.current = Date.now();
    const failed = results.find((result) => result.status === "rejected");
    if (options.silent && failed?.status === "rejected") throw failed.reason;
  }, [client, spaceId]);

  const loadMoreTasks = async () => {
    if (!client || !spaceId || !taskCursor || tasksLoadingMore) return;
    setTasksLoadingMore(true);
    try {
      const result = await client.tasks.list({ spaceId, limit: 8, cursor: taskCursor });
      setResources((current) => ({ ...current, tasks: mergeTaskRuns(current.tasks, result.runs) }));
      setTaskCursor(result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null);
    } finally {
      setTasksLoadingMore(false);
    }
  };

  const loadSessions = useCallback(async (options: { force?: boolean; silent?: boolean } = {}) => {
    if (!client || !spaceId || sessionsInFlightRef.current) return;
    if (!options.force && Date.now() - sessionsRefreshAtRef.current < SPACE_REFRESH_INTERVAL_MS) return;
    const requestToken = ++sessionsRequestRef.current;
    sessionsInFlightRef.current = true;
    if (!options.silent) setSessionsLoading(true);
    try {
      const response = await client.space(spaceId).sessions.list({ limit: SPACE_SESSION_COUNT_PAGE_SIZE });
      if (sessionsRequestRef.current !== requestToken) return;
      sessionsRefreshAtRef.current = Date.now();
      const hasMore = Boolean(response.pageInfo?.hasMore);
      setSpaceSessions(response.sessions);
      setSpaceSessionsHasMore(hasMore);
      setSessionsFailed(false);
      publishSpaceSessionCount(client, spaceId, response.sessions.length, hasMore);
      setSessionsLoading(false);
      void refreshSessionStatuses(response.sessions, { silent: options.silent });
    } catch (error) {
      if (sessionsRequestRef.current !== requestToken) return;
      setSessionsFailed(true);
      if (options.silent) throw error;
    } finally {
      sessionsInFlightRef.current = false;
      if (sessionsRequestRef.current === requestToken) setSessionsLoading(false);
    }
  }, [client, refreshSessionStatuses, spaceId]);

  const reloadDetails = useCallback(() => Promise.allSettled([
    loadResources({ force: true }),
    loadSessions({ force: true }),
  ]), [loadResources, loadSessions]);

  const refreshPage = useCallback(async () => {
    setPageRefreshing(true);
    try {
      await Promise.allSettled([refreshHome(), reloadDetails()]);
    } finally {
      setPageRefreshing(false);
    }
  }, [refreshHome, reloadDetails]);

  useFocusEffect(useCallback(() => {
    void loadSpace();
    void loadResources();
    void loadSessions();
  }, [loadResources, loadSessions, loadSpace]));

  useEffect(() => () => {
    spaceRefreshTokenRef.current += 1;
    spaceRefreshInFlightRef.current = null;
    resourcesRequestRef.current += 1;
    sessionsRequestRef.current += 1;
    tasksRequestRef.current += 1;
    resourcesInFlightRef.current = false;
    sessionsInFlightRef.current = false;
    tasksInFlightRef.current = false;
  }, [client, spaceId]);

  const refreshTasks = useCallback(async () => {
    if (!client || !spaceId || resourcesInFlightRef.current || tasksInFlightRef.current) return;
    const token = ++tasksRequestRef.current;
    tasksInFlightRef.current = true;
    try {
      const runs = await refreshTaskRuns(client, spaceId, resources.tasks);
      if (token !== tasksRequestRef.current) return;
      setResources((current) => ({ ...current, tasks: mergeTaskRuns(current.tasks, runs) }));
      setResourceFailures((current) => ({ ...current, tasks: false }));
    } catch (error) {
      if (token === tasksRequestRef.current) setResourceFailures((current) => ({ ...current, tasks: true }));
      throw error;
    } finally {
      tasksInFlightRef.current = false;
    }
  }, [client, resources.tasks, spaceId]);
  useSyncScope(`space:${spaceId}:chats`, () => loadSessions({ force: true, silent: true }), 15_000, Boolean(spaceId));
  useSyncScope(`space:${spaceId}:resources`, () => loadResources({ force: true, silent: true }), 60_000, Boolean(spaceId));
  useSyncScope(`space:${spaceId}:tasks`, refreshTasks, resources.tasks.some((task) => task.status === "running" || task.status === "pending") ? 10_000 : 60_000, Boolean(spaceId));

  if (!space) {
    const opening = Boolean(spaceId) && (state.booting || !client || spaceLoading);
    return <Screen>
      <TopBar title={t("space.title")} onBack={() => router.back()} />
      <View className="flex-1 items-center justify-center p-6">
        {opening
          ? <Text className="text-body text-fg-muted">{t("space.opening")}</Text>
          : <><Text className="text-body text-fg-muted text-center">{t("space.unavailable")}</Text>{spaceError ? <Text selectable className="text-caption text-danger text-center mt-2">{spaceError}</Text> : null}{spaceId ? <PrimaryButton label={t("common.retry")} icon="refresh" onPress={() => void loadSpace({ force: true })} className="mt-4" /> : null}</>}
      </View>
    </Screen>;
  }

  const name = displaySpaceName(space);
  const togglePin = async () => {
    if (pinning) return;
    setPinning(true);
    setPinError(null);
    try {
      await toggleSpacePin(space.id);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : t("spaces.pin.error"));
    } finally {
      setPinning(false);
    }
  };
  const activeTasks = resources.tasks.filter((task) => task.status === "pending" || task.status === "running").length;
  const createCheckpoint = async () => {
    if (checkpointing || !client) return;
    setCheckpointing(true);
    try {
      await client.space(space.id).checkpoints.create();
      await loadResources({ force: true });
    } finally {
      setCheckpointing(false);
    }
  };
  const detailsFailed = resourceFailures.checkpoints || resourceFailures.apps || resourceFailures.tasks || resourceFailures.activity || sessionsFailed;
  const activity = resources.activity;
  return <Screen>
    <View className="flex-1" accessibilityElementsHidden={spaceActionsOpen} importantForAccessibility={spaceActionsOpen ? "no-hide-descendants" : "auto"}>
    <SpacePanels
      key={space.id}
      spaceId={space.id}
      spaceName={name}
      sessions={sessions}
      client={client}
      activePanel={activePanel}
      onActivePanelChange={setActivePanel}
      onOpenSession={(sessionId, target) => router.push({ pathname: "/chat/[sessionId]", params: { sessionId, ...(target?.turn != null ? { turn: String(target.turn) } : {}), ...(target?.turnId ? { turnId: target.turnId } : {}) } })}
      onNewChat={() => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId: space.id } })}
      onOpenFile={(path) => router.push({ pathname: "/space/[spaceId]/file", params: { spaceId: space.id, path } })}
      onOpenFilesPage={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId: space.id } })}
    >
      <View className="flex-1">
    <TopBar
      title={name}
      onBack={() => router.back()}
      actions={<><IconButton name="folder-open" label={t("space.openFilesPanel")} onPress={() => setActivePanel("files")} /><IconButton name="settings" label={t("space.settings")} onPress={() => router.push({ pathname: "/space/[spaceId]/settings", params: { spaceId: space.id } })} /><View ref={spaceActionsRef} collapsable={false}><IconButton name="more" label={t("space.actions")} onPress={() => setSpaceActionsOpen(true)} /></View></>}
    />
    {state.realtimeError ? <Text selectable className="text-caption text-danger mx-4 mt-2">{state.realtimeError}</Text> : null}
    {pinError ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.pin.dismiss")} onPress={() => setPinError(null)} className="mx-4 mt-2 p-2 rounded-sm bg-danger-soft"><Text className="text-caption text-danger">{pinError}</Text></Pressable> : null}
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={state.refreshing || pageRefreshing} onRefresh={() => void refreshPage()} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />}
    >
    {/* The bar already names the Space; the header adds what the name cannot: who, what, how busy. */}
    <View className="flex-row items-start gap-4 px-4 pb-2 pt-3">
      <Avatar name={name} uri={space.publicProfile?.avatarUrl} size={56} online={space.status === "running"} />
      <View className="min-w-0 flex-1 gap-2">
        {space.description ? <Text numberOfLines={3} className="text-subhead text-fg-secondary">{space.description}</Text> : null}
        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
          <Meta icon="messages" value={`${sessions.length}${spaceSessionsHasMore ? "+" : ""}`} label={`${t("space.metric.chats")}: ${sessions.length}`} />
          <Meta icon="rocket" value={String(resources.apps.length)} label={`${t("space.metric.works")}: ${resources.apps.length}`} />
          <Meta icon="sync" value={String(activeTasks)} label={`${t("space.metric.running")}: ${activeTasks}`} tone={activeTasks > 0 ? "accent" : "muted"} />
        </View>
      </View>
    </View>
    
    {activity && (
      <View className="px-4 pt-4 gap-4">
        <Text className="text-headline font-semibold text-fg">{t("space.activity.title")}</Text>
        
        <ActivityHeatmap hourly={activity.hourly} days={activity.days} />
        
        {activity.rankings.apps.length > 0 && (
          <View>
            <Text className="text-body font-semibold text-fg mb-2">{t("space.activity.topApps")}</Text>
            <View className="flex-row gap-2 flex-wrap">
              {activity.rankings.apps.slice(0, 3).map((app) => (
                <View key={app.appId} className="min-w-25 flex-1 gap-1 rounded-md bg-surface p-3" style={{ borderCurve: "continuous" }}>
                  <Text numberOfLines={1} className="text-subhead font-semibold text-fg">{app.title || "App"}</Text>
                  <Meta icon="eye" value={formatNumber(app.viewCount)} label={`${app.viewCount}`} />
                </View>
              ))}
            </View>
          </View>
        )}
        
        {activity.contributors.items.length > 0 && (
          <View>
            <Text className="text-body font-semibold text-fg mb-2">{t("space.activity.contributors")}</Text>
            <View className="gap-2">
              {activity.contributors.items.slice(0, 5).map((contributor) => {
                const contributorName = activityContributorName(contributor, t("space.activity.unknownContributor"));
                return <View key={contributor.userUuid} className="flex-row items-center gap-2">
                  <Avatar name={contributorName} uri={contributor.profile?.avatarUrl} size={32} />
                  <Text numberOfLines={1} className="text-body flex-1 min-w-0 text-fg">{contributorName}</Text>
                  <Meta icon="zap" value={formatNumber(contributor.requests)} label={`${t("activity.metric.requests")}: ${contributor.requests.toLocaleString()}`} />
                </View>;
              })}
            </View>
          </View>
        )}
      </View>
    )}
    {detailsFailed ? <View className="mt-3 flex-row items-center gap-2 pl-4 pr-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable className="flex-1 text-caption text-danger">{t("space.resourcesFailed")}</Text><IconButton name="refresh" label={t("space.resourcesRetry")} tone="accent" disabled={loadingResources || sessionsLoading} onPress={() => void reloadDetails()} /></View> : null}

    <SectionHeader title={t("space.section.chats")} action={{ icon: "plus", label: t("space.newChat"), onPress: () => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId: space.id } }) }} />
    <View>{sessions.length > 0 ? sessions.map((session) => <SessionRow key={session.id} session={{ ...session, space: session.space ?? { id: space.id, name, slug: space.slug, publicProfile: space.publicProfile ?? null } }} onPress={() => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: session.id } })} onPressIn={() => prefetchSession(session.id)} />) : <ResourceEmpty text={sessionsLoading ? t("space.empty.chatsLoading") : sessionsFailed ? t("space.empty.loadFailed") : t("space.empty.chats")} />}</View>

    <SectionHeader title={t("space.section.works")} />
    <View>{resources.apps.length > 0 ? resources.apps.map((app) => <ResourceRow key={app.id} icon="rocket" tone={app.status === "published" ? "accent" : "faint"} status={app.status === "published" ? t("space.published") : t("space.disabled")} title={app.meta?.title || app.meta?.name || app.slug} subtitle={t("space.workSubtitle", { target: app.targetType, version: app.latestVersion })} onPress={() => router.push({ pathname: "/work/[appId]", params: { appId: app.id } })} />) : <ResourceEmpty text={resourceLoading.apps ? t("space.empty.worksLoading") : resourceFailures.apps ? t("space.empty.loadFailed") : t("space.empty.works")} />}</View>

    <SectionHeader title={t("space.section.saves")} />
    <View>{resources.checkpoints.length > 0 ? resources.checkpoints.map((checkpoint) => <ResourceRow key={checkpoint.id} icon="bookmark" tone="muted" title={checkpoint.description || t("space.save", { hash: checkpoint.commitHash.slice(0, 8) })} meta={formatRelativeTime(checkpoint.createdAt)} subtitle={checkpoint.commitHash.slice(0, 8)} />) : <ResourceEmpty text={resourceLoading.checkpoints ? t("space.empty.savesLoading") : resourceFailures.checkpoints ? t("space.empty.loadFailed") : t("space.empty.saves")} />}</View>

    <SectionHeader title={t("space.section.tasks")} />
    <View className="pb-6">{resources.tasks.length > 0 ? resources.tasks.map((task) => <ResourceRow key={task.id} icon={task.status === "running" || task.status === "pending" ? "sync" : task.status === "failed" ? "alert" : "check-circle"} tone={task.status === "failed" ? "danger" : task.status === "running" || task.status === "pending" ? "accent" : "success"} status={task.status} title={task.taskType.replaceAll("_", " ")} meta={formatRelativeTime(task.updatedAt)} subtitle={task.errorMessage || t("space.taskAttempt", { time: formatRelativeTime(task.updatedAt), count: task.attemptCount })} onPress={() => router.push({ pathname: "/task/[taskId]", params: { taskId: task.id } })} />) : <ResourceEmpty text={resourceLoading.tasks ? t("space.empty.tasksLoading") : resourceFailures.tasks ? t("space.empty.loadFailed") : t("space.empty.tasks")} />}</View>
    {taskCursor ? <View className="mb-5 items-center"><PrimaryButton variant="ghost" icon="chevrons-down" label={tasksLoadingMore ? t("space.tasks.loadingMore") : t("space.tasks.loadMore")} loading={tasksLoadingMore} onPress={() => void loadMoreTasks()} /></View> : null}
    </ScrollView>
      </View>
    </SpacePanels>
    </View>
    {spaceActionsOpen ? <AnchoredActionMenu
      anchorRef={spaceActionsRef}
      title={name}
      testID="space-actions-menu"
      onClose={closeSpaceActions}
      actions={[
        { icon: "messages", title: t("chat.actions.openChats"), onPress: () => setActivePanel("chat") },
        { icon: "square-pen", title: t("space.edit.action"), onPress: () => router.push({ pathname: "/space/[spaceId]/edit", params: { spaceId: space.id } }) },
        { icon: space.isPinned ? "pin-off" : "pin", title: space.isPinned ? t("space.unpin") : t("space.pin"), disabled: pinning, onPress: () => void togglePin() },
        { icon: "folder-open", title: t("space.openFiles"), onPress: () => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId: space.id } }) },
        { icon: "bookmark", title: checkpointing ? t("space.saveCheckpointSaving") : t("space.saveCheckpoint"), disabled: checkpointing, onPress: () => void createCheckpoint() },
      ]}
    /> : null}
  </Screen>;
}

function ResourceRow({ icon, tone, status, title, meta, subtitle, onPress }: { icon: IconName; tone: IconTone; status?: string; title: string; meta?: string; subtitle: string; onPress?: () => void }) {
  return <ListRow
    leading={<View className="flex-1 justify-center"><View className="items-center justify-center rounded-sm bg-surface" style={{ width: LIST_AVATAR_SIZE, height: LIST_AVATAR_SIZE, borderCurve: "continuous" }}><AppIcon name={icon} size={20} tone={tone} /></View></View>}
    title={title}
    meta={meta}
    subtitle={subtitle}
    accessibilityLabel={[title, status, subtitle].filter(Boolean).join(", ")}
    onPress={onPress}
  />;
}

function ResourceEmpty({ text }: { text: string }) {
  return <Text className="text-body text-fg-muted px-4 py-3">{text}</Text>;
}

function preferRecentSession(current: UserSessionListItem, incoming: UserSessionListItem) {
  const currentTime = Date.parse(current.lastMessageAt ?? current.updatedAt);
  const incomingTime = Date.parse(incoming.lastMessageAt ?? incoming.updatedAt);
  return Number.isFinite(currentTime) && currentTime > incomingTime ? current : incoming;
}
