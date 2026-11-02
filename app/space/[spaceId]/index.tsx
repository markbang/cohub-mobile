import type { AppRecord, CheckpointRecord, SpaceActivityResponse, SpaceRecord, TaskRunRecord, UserSessionListItem } from "@neta-art/cohub";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AnchoredActionMenu, type AnchoredMenuAction } from "@/src/components/AnchoredActionMenu";
import { MenuPresence } from "@/src/ui/MorphMenuSurface";
import { NativeMenuButton, nativeMenus } from "@/src/components/NativeMenu";
import { ActivityHeatmap } from "@/src/components/ActivityHeatmap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionRow } from "@/src/components/SessionRow";
import { SpacePanels, type SpacePanel } from "@/src/components/SpacePanels";
import { useToast } from "@/src/components/Toast";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { activityContributorName } from "@/src/data/activity";
import { usePagedQuery, useScreenQuery, useSyncQuery, type Page } from "@/src/data/query";
import { useQueryClient } from "@tanstack/react-query";
import { useSpaceRealtime } from "@/src/data/use-space-realtime";
import { mergeTaskRuns, refreshTaskRuns } from "@/src/data/task-sync";
import { publishSpaceSessionCount, SPACE_SESSION_COUNT_PAGE_SIZE } from "@/src/data/space-session-counts";
import { useTranslation } from "@/src/i18n";
import { AppIcon, AppRefreshControl, Avatar, TopBar, IconButton, LoadingState, PrimaryButton, Screen, SectionHeader, type IconName, type IconTone } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow, Meta } from "@/src/ui/ListRow";
import { displaySpaceName, formatNumber, formatRelativeTime, sortByRecent } from "@/src/utils";

type Params = { spaceId?: string | string[] };

type Resources = {
  checkpoints: CheckpointRecord[];
  apps: AppRecord[];
  tasks: TaskRunRecord[];
  activity: SpaceActivityResponse | null;
};

const SPACE_REFRESH_INTERVAL_MS = 60_000;
const NO_SESSIONS: UserSessionListItem[] = [];
const NO_CHECKPOINTS: CheckpointRecord[] = [];
const NO_APPS: AppRecord[] = [];
const NO_TASKS: TaskRunRecord[] = [];

export default function SpaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const spaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  useSpaceRealtime(spaceId ? [spaceId] : []);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { client, refreshHome, refreshSessionStatuses, refreshSpacePin, toggleSpacePin, upsertSpace, prefetchSession, recordSpaceVisit: recordVisit } = useAppActions();
  const { booting, refreshing, realtimeError } = useAppSelector((app) => ({ booting: app.state.booting, refreshing: app.state.refreshing, realtimeError: app.state.realtimeError }), shallowEqual);
  useFocusEffect(useCallback(() => {
    if (spaceId) recordVisit(spaceId);
  }, [recordVisit, spaceId]));
  const queryClient = useQueryClient();
  const ready = Boolean(client && spaceId);
  const cachedSpace = useAppSelector((app) => app.state.spaces.find((item) => item.id === spaceId) ?? null);
  const cachedSessions = useAppSelector((app) => app.state.sessions.filter((session) => session.spaceId === spaceId), shallowEqual);
  // Home/cache data is enough to paint; global Space reconciliation keeps it fresh, so only an unknown Space is read here.
  const spaceQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:detail`],
    queryFn: async (): Promise<SpaceRecord> => {
      // Pin state is private metadata, not a prerequisite for rendering the Space shell.
      const pinRequest = refreshSpacePin(spaceId!).catch((error: unknown) => {
        console.warn("[mobile-space] failed to refresh pin state", error);
        return null;
      });
      const remoteSpace = await client!.spaces.get(spaceId!);
      upsertSpace(remoteSpace);
      void pinRequest.then((pinned) => { if (pinned !== null) upsertSpace({ ...remoteSpace, isPinned: pinned }); });
      return remoteSpace;
    },
    enabled: ready && !cachedSpace,
    staleTime: SPACE_REFRESH_INTERVAL_MS,
  });
  useSyncQuery(`space:${spaceId}:pin`, () => refreshSpacePin(spaceId!), SPACE_REFRESH_INTERVAL_MS, ready && cachedSpace?.isPinned === undefined);
  const space = cachedSpace ?? spaceQuery.data ?? null;
  const spaceLoading = ready && !cachedSpace && spaceQuery.isFetching;
  const spaceError = spaceQuery.error ? spaceQuery.error.message.trim() || t("space.unavailable") : null;

  const sessionsQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:chats`],
    queryFn: async (): Promise<{ sessions: UserSessionListItem[]; hasMore: boolean }> => {
      const response = await client!.space(spaceId!).sessions.list({ limit: SPACE_SESSION_COUNT_PAGE_SIZE });
      const hasMore = Boolean(response.pageInfo?.hasMore);
      publishSpaceSessionCount(queryClient, spaceId!, response.sessions.length, hasMore);
      void refreshSessionStatuses(response.sessions, { silent: queryClient.getQueryData([`space:${spaceId}:chats`]) !== undefined });
      return { sessions: response.sessions, hasMore };
    },
    enabled: ready,
    staleTime: SPACE_REFRESH_INTERVAL_MS,
    intervalMs: 15_000,
  });
  const spaceSessions = sessionsQuery.data?.sessions ?? NO_SESSIONS;
  const spaceSessionsHasMore = sessionsQuery.data?.hasMore ?? false;
  const sessionsLoading = ready && sessionsQuery.isPending;
  const sessionsFailed = sessionsQuery.isError;
  const sessions = useMemo(() => {
    const byId = new Map<string, UserSessionListItem>();
    for (const session of cachedSessions) byId.set(session.id, session);
    // The page fetches its own page of Chats; cached entries still win when newer.
    for (const session of spaceSessions) {
      const previous = byId.get(session.id);
      byId.set(session.id, previous ? preferRecentSession(previous, session) : session);
    }
    return sortByRecent([...byId.values()]);
  }, [cachedSessions, spaceSessions]);

  const resourceOptions = { enabled: ready, staleTime: SPACE_REFRESH_INTERVAL_MS, intervalMs: SPACE_REFRESH_INTERVAL_MS };
  const checkpointsQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:resources`, "checkpoints"],
    queryFn: async (): Promise<CheckpointRecord[]> => (await client!.space(spaceId!).checkpoints.list({ limit: 5 })).checkpoints,
    ...resourceOptions,
  });
  const appsQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:resources`, "apps"],
    queryFn: async (): Promise<AppRecord[]> => (await client!.apps.listBySpace(spaceId!)).apps,
    ...resourceOptions,
  });
  const activityQuery = useScreenQuery({
    queryKey: [`space:${spaceId}:resources`, "activity"],
    queryFn: async (): Promise<SpaceActivityResponse | null> => {
      const remote = client!.space(spaceId!);
      return remote.activity?.get ? remote.activity.get(7) : null;
    },
    ...resourceOptions,
  });
  const taskList = usePagedQuery<TaskRunRecord>({
    queryKey: [`space:${spaceId}:tasks`],
    enabled: ready,
    intervalMs: (loaded) => loaded?.items.some((task) => task.status === "running" || task.status === "pending") ? 10_000 : 60_000,
    id: (task) => task.id,
    fetchPage: async (cursor) => {
      if (cursor) {
        const result = await client!.tasks.list({ spaceId: spaceId!, limit: 8, cursor });
        return { items: result.runs, cursor: result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null };
      }
      const loaded = queryClient.getQueryData<Page<TaskRunRecord>>([`space:${spaceId}:tasks`]);
      if (!loaded) {
        const result = await client!.tasks.list({ spaceId: spaceId!, limit: 8 });
        return { items: result.runs, cursor: result.pageInfo?.hasMore ? result.pageInfo.nextCursor : null };
      }
      // Loaded active runs are rechecked even when newer tasks push them out of the first page.
      return { items: await refreshTaskRuns(client!, spaceId!, loaded.items), cursor: loaded.cursor };
    },
    mergeHead: (loaded, head) => ({ items: mergeTaskRuns(loaded.items, head.items), cursor: loaded.cursor }),
  });
  const resources: Resources = {
    checkpoints: checkpointsQuery.data ?? NO_CHECKPOINTS,
    apps: appsQuery.data ?? NO_APPS,
    tasks: taskList.items ?? NO_TASKS,
    activity: activityQuery.data ?? null,
  };
  const loadingResources = checkpointsQuery.isFetching || appsQuery.isFetching || activityQuery.isFetching || taskList.query.isFetching;
  const resourceLoading = { checkpoints: ready && checkpointsQuery.isPending, apps: ready && appsQuery.isPending, tasks: ready && taskList.query.isPending };
  const resourceFailures = { checkpoints: checkpointsQuery.isError, apps: appsQuery.isError, tasks: taskList.query.isError, activity: activityQuery.isError };
  const taskCursor = taskList.hasMore;
  const tasksLoadingMore = taskList.loadingMore;
  const [pageRefreshing, setPageRefreshing] = useState(false);
  const [spaceActionsOpen, setSpaceActionsOpen] = useState(false);
  const spaceActionsRef = useRef<View>(null);
  const closeSpaceActions = useCallback(() => setSpaceActionsOpen(false), []);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [checkpointing, setCheckpointing] = useState(false);
  const [activePanel, setActivePanel] = useState<SpacePanel | null>(null);

  const loadMoreTasks = async () => {
    try {
      await taskList.loadMore();
    } catch (error) {
      toast({ title: t("space.tasks.loadMoreFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    }
  };

  const reloadDetails = useCallback(() => Promise.allSettled([
    queryClient.refetchQueries({ queryKey: [`space:${spaceId}:resources`] }),
    queryClient.refetchQueries({ queryKey: [`space:${spaceId}:tasks`] }),
    queryClient.refetchQueries({ queryKey: [`space:${spaceId}:chats`] }),
  ]), [queryClient, spaceId]);

  const refreshPage = useCallback(async () => {
    setPageRefreshing(true);
    try {
      await Promise.allSettled([refreshHome(), reloadDetails()]);
    } finally {
      setPageRefreshing(false);
    }
  }, [refreshHome, reloadDetails]);

  if (!space) {
    const opening = Boolean(spaceId) && (booting || !client || spaceLoading);
    return <Screen>
      <TopBar drawn title={t("space.title")} onBack={() => router.back()} />
      <View className="flex-1 items-center justify-center p-6">
        {opening
          ? <LoadingState label={t("space.opening")} />
          : <><Text className="text-body text-fg-muted text-center">{t("space.unavailable")}</Text>{spaceError ? <Text selectable className="text-caption text-danger text-center mt-2">{spaceError}</Text> : null}{spaceId ? <PrimaryButton label={t("common.retry")} icon="refresh" onPress={() => void spaceQuery.refetch()} className="mt-4" /> : null}</>}
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
      await queryClient.refetchQueries({ queryKey: [`space:${space.id}:resources`, "checkpoints"] });
    } catch (error) {
      toast({ title: t("space.saveCheckpointFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setCheckpointing(false);
    }
  };
  const detailsFailed = resourceFailures.checkpoints || resourceFailures.apps || resourceFailures.tasks || resourceFailures.activity || sessionsFailed;
  const activity = resources.activity;
  const spaceActions: AnchoredMenuAction[] = [
    { icon: "messages", title: t("chat.actions.openChats"), onPress: () => setActivePanel("chat") },
    { icon: "square-pen", title: t("space.edit.action"), onPress: () => router.push({ pathname: "/space/[spaceId]/edit", params: { spaceId: space.id } }) },
    { icon: space.isPinned ? "pin-off" : "pin", title: space.isPinned ? t("space.unpin") : t("space.pin"), disabled: pinning, onPress: () => void togglePin() },
    { icon: "folder-open", title: t("space.openFiles"), onPress: () => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId: space.id } }) },
    { icon: "bookmark", title: checkpointing ? t("space.saveCheckpointSaving") : t("space.saveCheckpoint"), disabled: checkpointing, onPress: () => void createCheckpoint() },
  ];
  return <Screen>
    <View className="flex-1" accessibilityElementsHidden={spaceActionsOpen} importantForAccessibility={spaceActionsOpen ? "no-hide-descendants" : "auto"}>
    <SpacePanels
      key={space.id}
      spaceId={space.id}
      spaceName={name}
      spaceAvatarUrl={space.publicProfile?.avatarUrl}
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
      drawn
      title={name}
      onBack={() => router.back()}
      actions={<><IconButton name="folder-open" label={t("space.openFilesPanel")} onPress={() => setActivePanel("files")} /><IconButton name="settings" label={t("space.settings")} onPress={() => router.push({ pathname: "/space/[spaceId]/settings", params: { spaceId: space.id } })} />{nativeMenus ? <NativeMenuButton appearance="bar" icon="more" label={t("space.actions")} actions={spaceActions} testID="space-actions-menu" /> : <View ref={spaceActionsRef} collapsable={false} className={spaceActionsOpen ? "opacity-0" : undefined}><IconButton name="more" label={t("space.actions")} onPress={() => setSpaceActionsOpen(true)} /></View>}</>}
    />
    {realtimeError ? <Text selectable className="text-caption text-danger mx-4 mt-2">{realtimeError}</Text> : null}
    {pinError ? <Pressable accessibilityRole="button" accessibilityLabel={t("space.pin.dismiss")} onPress={() => setPinError(null)} className="mx-4 mt-2 p-2 rounded-sm bg-danger-soft"><Text className="text-caption text-danger">{pinError}</Text></Pressable> : null}
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<AppRefreshControl refreshing={refreshing || pageRefreshing} onRefresh={() => void refreshPage()} />}
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
    <View>{resources.apps.length > 0 ? resources.apps.map((app) => <ResourceRow key={app.id} icon={app.status === "published" ? "rocket" : "eye-off"} tone={app.status === "published" ? "accent" : "faint"} status={app.status === "published" ? t("space.published") : t("space.disabled")} title={app.meta?.title || app.meta?.name || app.slug} subtitle={t("space.workSubtitle", { target: app.targetType, version: app.latestVersion })} onPress={() => router.push({ pathname: "/work/[appId]", params: { appId: app.id } })} />) : <ResourceEmpty text={resourceLoading.apps ? t("space.empty.worksLoading") : resourceFailures.apps ? t("space.empty.loadFailed") : t("space.empty.works")} />}</View>

    <SectionHeader title={t("space.section.saves")} action={{ icon: "arrow-right", label: t("save.seeAll"), onPress: () => router.push({ pathname: "/space/[spaceId]/saves", params: { spaceId: space.id } }) }} />
    <View>{resources.checkpoints.length > 0 ? resources.checkpoints.map((checkpoint) => <ResourceRow key={checkpoint.id} icon="bookmark" tone="muted" title={checkpoint.description || t("space.save", { hash: checkpoint.commitHash.slice(0, 8) })} meta={formatRelativeTime(checkpoint.createdAt)} subtitle={checkpoint.commitHash.slice(0, 8)} onPress={() => router.push({ pathname: "/space/[spaceId]/save/[checkpointId]", params: { spaceId: space.id, checkpointId: checkpoint.id } })} />) : <ResourceEmpty text={resourceLoading.checkpoints ? t("space.empty.savesLoading") : resourceFailures.checkpoints ? t("space.empty.loadFailed") : t("space.empty.saves")} />}</View>

    <SectionHeader title={t("space.section.tasks")} />
    <View className="pb-6">{resources.tasks.length > 0 ? resources.tasks.map((task) => <ResourceRow key={task.id} icon={task.status === "running" || task.status === "pending" ? "sync" : task.status === "failed" ? "alert" : "check-circle"} tone={task.status === "failed" ? "danger" : task.status === "running" || task.status === "pending" ? "accent" : "success"} status={task.status} title={sentenceCase(task.taskType.replaceAll("_", " "))} meta={formatRelativeTime(task.updatedAt)} subtitle={task.errorMessage || t("space.taskAttempt", { time: formatRelativeTime(task.updatedAt), count: task.attemptCount })} onPress={() => router.push({ pathname: "/task/[taskId]", params: { taskId: task.id } })} />) : <ResourceEmpty text={resourceLoading.tasks ? t("space.empty.tasksLoading") : resourceFailures.tasks ? t("space.empty.loadFailed") : t("space.empty.tasks")} />}</View>
    {taskCursor ? <View className="mb-5 items-center"><PrimaryButton variant="ghost" icon="chevrons-down" label={tasksLoadingMore ? t("space.tasks.loadingMore") : t("space.tasks.loadMore")} loading={tasksLoadingMore} onPress={() => void loadMoreTasks()} /></View> : null}
    </ScrollView>
      </View>
    </SpacePanels>
    </View>
    <MenuPresence open={spaceActionsOpen}><AnchoredActionMenu
      anchorRef={spaceActionsRef}
      title={name}
      testID="space-actions-menu"
      onClose={closeSpaceActions}
      actions={spaceActions}
    /></MenuPresence>
  </Screen>;
}

function ResourceRow({ icon, tone, status, title, meta, subtitle, onPress }: { icon: IconName; tone: IconTone; status?: string; title: string; meta?: string; subtitle: string; onPress?: () => void }) {
  return <ListRow
    leading={<View className="flex-1 justify-center"><View className="items-center justify-center rounded-sm bg-surface-raised" style={{ width: LIST_AVATAR_SIZE, height: LIST_AVATAR_SIZE, borderCurve: "continuous" }}><AppIcon name={icon} size={20} tone={tone} /></View></View>}
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

/** Task types arrive as snake_case identifiers; titles follow the sentence-case copy rule. */
function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function preferRecentSession(current: UserSessionListItem, incoming: UserSessionListItem) {
  const currentTime = Date.parse(current.lastMessageAt ?? current.updatedAt);
  const incomingTime = Date.parse(incoming.lastMessageAt ?? incoming.updatedAt);
  return Number.isFinite(currentTime) && currentTime > incomingTime ? current : incoming;
}
