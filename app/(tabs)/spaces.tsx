import { useFocusEffect, useRouter, useScrollToTop } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { LegendList, type LegendListRef, type ViewToken } from "@legendapp/list/react-native";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { AdaptiveSheet } from "@/src/components/AdaptiveSheet";
import { FilterChip } from "@/src/components/FilterChip";
import { useFloatingTabBarInset } from "@/src/components/FloatingTabBar";
import { AccountAvatar } from "@/src/components/AccountAvatar";
import { DeviceFolderBrowser, useDeviceFolderBrowser } from "@/src/components/DeviceFolderBrowser";
import { DeviceSpaceRow } from "@/src/components/DeviceSpaceRow";
import { useToast } from "@/src/components/Toast";
import { SpaceSearchRow } from "@/src/components/SearchResultRow";
import { SpaceRow } from "@/src/components/SpaceRow";
import { normalizeSearchQuery, useRemoteSearch, type RemoteSpaceSearchHit } from "@/src/data/session-search";
import { useSpaceSessionCounts } from "@/src/data/space-session-counts";
import { personalSpaceActivity, selectSpaceList, type SpaceListSpace, type SpaceFilter } from "@/src/data/space-list";
import { useApp } from "@/src/data/context";
import { deviceFolderName, deviceRuntimeRefusalKey, isDeviceRuntimeRunning, type DeviceFolderListing, type DeviceRuntimeInstance } from "@/src/data/device-runtime";
import { deviceRuntimeSupported, startDeviceRuntime, useDeviceRuntimeInstances } from "@/src/platform/device-runtime";
import { useSyncScope } from "@/src/data/use-sync-scope";
import { useAppTheme } from "@/src/theme";
import { useTranslation } from "@/src/i18n";
import { AppIcon, DataError, EmptyState, ExpandableSearchBar, Field, FIELD_INPUT_CLASS, IconButton, LoadingRows, PrimaryButton, Screen } from "@/src/ui";
import { displaySpaceName } from "@/src/utils";
import { EdgeHeader, useEdgeChrome } from "@/src/ui/EdgeChrome";

type SpaceListItem =
  | { kind: "local"; space: SpaceListSpace }
  | { kind: "remote"; hit: RemoteSpaceSearchHit }
  | { kind: "device"; instance: DeviceRuntimeInstance; space: SpaceListSpace | null };
/** "device" lists the Spaces this device serves, where their connection and screen sharing are managed. */
type SpacesTabFilter = SpaceFilter | "device";
const SPACE_SEARCH_TYPES = ["space"] as const;

export default function SpacesScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { t } = useTranslation();
  const tabBarInset = useFloatingTabBarInset();
  const { headerHeight, onHeaderLayout } = useEdgeChrome();
  const { state, client, refreshHome, createSpace, toggleSpacePin, spaceList, userUuid } = useApp();
  const dataError = state.error ?? state.spacesError ?? spaceList.error;
  const refreshSpaceList = spaceList.refresh;
  const [now, setNow] = useState(Date.now);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const refresh = () => Promise.all([refreshHome(), spaceList.refresh()]);
  const refreshOnPull = async () => {
    setPullRefreshing(true);
    try {
      await refresh();
    } finally {
      setPullRefreshing(false);
    }
  };
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    void refreshSpaceList();
  }, [refreshSpaceList]));
  useSyncScope("spaces-overview", async () => {
    setNow(Date.now());
    await refreshSpaceList({ silent: true });
  }, 60_000);
  const [query, setQuery] = useState("");
  const listRef = useRef<LegendListRef>(null);
  useScrollToTop(listRef);
  const [filter, setFilter] = useState<SpacesTabFilter>("recent");
  const [pinningSpaceId, setPinningSpaceId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const toast = useToast();
  const deviceInstances = useDeviceRuntimeInstances();
  const [placement, setPlacement] = useState<"cloud" | "device">("cloud");
  const [folder, setFolder] = useState<DeviceFolderListing | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const folderBrowser = useDeviceFolderBrowser(createOpen && pickingFolder);
  const onDevice = placement === "device";
  const linkedRunning = isDeviceRuntimeRunning(deviceInstances?.find((item) => item.spaceId === folder?.spaceId));
  const placementReady = !onDevice || (folder !== null && !linkedRunning);
  const remoteSearch = useRemoteSearch(client, query, { enabled: filter !== "pinned" && filter !== "device", types: SPACE_SEARCH_TYPES });
  const trimmedQuery = normalizeSearchQuery(query);
  const spaces = useMemo(() => {
    const needle = trimmedQuery.toLowerCase();
    const personalActivity = personalSpaceActivity(Object.values(state.sessionViews), userUuid);
    const listFilter = filter === "device" || (filter === "recent" && trimmedQuery) ? "all" : filter;
    const candidates = selectSpaceList({ spaces: state.spaces, sessions: state.sessions, overview: spaceList.overview, visits: spaceList.visits, personalActivity, filter: listFilter, now });
    return candidates.filter((space) => !needle || [displaySpaceName(space), space.description].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [filter, now, state.spaces, state.sessions, state.sessionViews, spaceList.overview, spaceList.visits, trimmedQuery, userUuid]);
  const [visibleSpaceIds, setVisibleSpaceIds] = useState<string[]>([]);
  const visibleSpaceKeyRef = useRef("");
  const onViewableItemsChanged = useCallback((info: { viewableItems: ViewToken<SpaceListItem>[] }) => {
    const ids = info.viewableItems.flatMap((token) => (token.item?.kind === "local" ? [token.item.space.id] : []));
    const key = ids.join(",");
    if (key === visibleSpaceKeyRef.current) return;
    visibleSpaceKeyRef.current = key;
    setVisibleSpaceIds(ids);
  }, []);
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 25 }), []);
  const spaceById = useMemo(() => new Map(spaces.map((space) => [space.id, space])), [spaces]);
  const countSpaceIds = useMemo(() => visibleSpaceIds.filter((id) => !spaceById.get(id)?.description?.trim()), [spaceById, visibleSpaceIds]);
  const spaceSessionCounts = useSpaceSessionCounts(client, countSpaceIds);
  const listItems = useMemo<SpaceListItem[]>(() => {
    if (filter === "device") {
      const needle = trimmedQuery.toLowerCase();
      const known = new Map<string, SpaceListSpace>(state.spaces.map((space) => [space.id, space]));
      return (deviceInstances ?? []).flatMap((instance) => {
        const space = known.get(instance.spaceId) ?? null;
        const matches = !needle || [space ? displaySpaceName(space) : null, space?.description, instance.label].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false);
        return matches ? [{ kind: "device" as const, instance, space }] : [];
      });
    }
    if (!trimmedQuery) return spaces.map((space) => ({ kind: "local", space }));
    const remoteQueryMatches = remoteSearch.query === trimmedQuery;
    const remoteSpaces = remoteQueryMatches ? remoteSearch.spaces : [];
    const remoteIds = new Set(remoteSpaces.map((hit) => hit.spaceId));
    return [
      ...remoteSpaces.map((hit) => ({ kind: "remote" as const, hit })),
      ...spaces.filter((space) => !remoteIds.has(space.id)).map((space) => ({ kind: "local" as const, space })),
    ];
  }, [deviceInstances, filter, remoteSearch.query, remoteSearch.spaces, spaces, state.spaces, trimmedQuery]);

  // LegendList memoizes each row on [item, extraData]; async counts and pin state are
  // read by renderItem but never change `listItems`, so they must flow through extraData.
  const rowExtraData = useMemo(
    () => ({ client, pinningSpaceId, spaceSessionCounts, t, theme }),
    [client, pinningSpaceId, spaceSessionCounts, t, theme],
  );

  const togglePin = async (spaceId: string) => {
    if (pinningSpaceId) return;
    setPinningSpaceId(spaceId);
    setPinError(null);
    try {
      await toggleSpacePin(spaceId);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : t("spaces.pin.error"));
    } finally {
      setPinningSpaceId(null);
    }
  };

  const closeCreate = () => {
    if (pickingFolder) setPickingFolder(false);
    else if (!creating) setCreateOpen(false);
  };

  const resetCreate = () => {
    setCreateOpen(false);
    setName("");
    setDescription("");
    setPlacement("cloud");
    setFolder(null);
  };

  const selectFolder = (next: DeviceFolderListing) => {
    setFolder(next);
    setPickingFolder(false);
    if (!name.trim()) setName(deviceFolderName(next));
  };

  // Connects the folder for a Space; a refusal leaves the Space created but stopped, so it is reported, not thrown.
  const connectFolder = async (spaceId: string, root: string) => {
    const refusal = await startDeviceRuntime(spaceId, root).catch(() => "failed" as const);
    if (refusal) toast({ title: t(refusal === "failed" ? "deviceRuntime.error.failed" : deviceRuntimeRefusalKey(refusal)), tone: "danger" });
  };

  const openLinkedSpace = async () => {
    if (!folder?.spaceId) return;
    const spaceId = folder.spaceId;
    if (!linkedRunning) await connectFolder(spaceId, folder.path);
    resetCreate();
    router.push({ pathname: "/space/[spaceId]", params: { spaceId } });
  };

  const submitCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const space = await createSpace(name, description, { onDevice });
      if (onDevice && folder) await connectFolder(space.id, folder.path);
      resetCreate();
      router.push({ pathname: "/space/[spaceId]", params: { spaceId: space.id } });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("spaces.create.error"));
    } finally {
      setCreating(false);
    }
  };

  const searchEmpty = remoteSearch.query === trimmedQuery && remoteSearch.loading && trimmedQuery.length >= 2 && listItems.length === 0
    ? <View className="min-h-45 flex-1 items-center justify-center"><ActivityIndicator accessibilityLabel={t("spaces.searching")} size="small" color={theme.colors.accent} /></View>
    : filter === "device" && !trimmedQuery
      ? <EmptyState icon="smartphone" title={t("spaces.empty.device.title")} description={t("spaces.empty.device.body")} action={{ icon: "plus", label: t("spaces.action.create"), onPress: () => { setCreateError(null); setPlacement("device"); setCreateOpen(true); } }} />
      : <EmptyState icon={filter === "pinned" ? "pin" : trimmedQuery ? "search" : "layers"} title={filter === "pinned" ? t("spaces.empty.pinned.title") : trimmedQuery ? t("spaces.empty.matching.title") : t("spaces.empty.none.title")} action={filter === "pinned" || trimmedQuery ? { icon: "x", label: t("spaces.action.clearFilters"), onPress: () => { setFilter("recent"); setQuery(""); } } : undefined} />;

  return <Screen edgeToEdge>
    <EdgeHeader onLayout={onHeaderLayout}>
    <ExpandableSearchBar
      transparent
      title={t("tabs.spaces")}
      createLabel={t("spaces.action.create")}
      query={query}
      onQueryChange={setQuery}
      placeholder={t("spaces.search.placeholder")}
      account={<AccountAvatar />}
      onCreate={() => { setCreateError(null); setCreateOpen(true); }}
    />
    {dataError ? <DataError message={dataError} onRetry={() => void refresh()} /> : null}
    </EdgeHeader>
    <LegendList
      ref={listRef}
      data={listItems}
      extraData={rowExtraData}
      estimatedItemSize={80}
      keyExtractor={(item) => item.kind === "remote" ? `remote-space:${item.hit.spaceId}` : item.kind === "device" ? `device-space:${item.instance.spaceId}` : `space:${item.space.id}`}
      renderItem={({ item }) => item.kind === "device" ? <DeviceSpaceRow instance={item.instance} space={item.space} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.instance.spaceId } })} /> : item.kind === "remote" ? <SpaceSearchRow hit={item.hit} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.hit.spaceId } })} /> : <SpaceRow space={item.space} sessionCount={spaceSessionCounts[item.space.id] ?? null} pinning={pinningSpaceId === item.space.id} onTogglePin={client ? () => void togglePin(item.space.id) : undefined} onPress={() => router.push({ pathname: "/space/[spaceId]", params: { spaceId: item.space.id } })} />}
      refreshing={pullRefreshing}
      onRefresh={refreshOnPull}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="never"
      progressViewOffset={headerHeight}
      scrollIndicatorInsets={{ top: headerHeight, bottom: tabBarInset }}
      contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: tabBarInset, flexGrow: listItems.length === 0 ? 1 : undefined }}
      ListHeaderComponent={<View className="px-3">
        <View className="flex-row flex-wrap items-center">
          <FilterChip label={t("spaces.filter.recent")} selected={filter === "recent"} onPress={() => setFilter("recent")} />
          <FilterChip label={t("spaces.filter.all")} selected={filter === "all"} onPress={() => setFilter("all")} />
          <FilterChip label={t("spaces.filter.pinned")} icon="pin" selected={filter === "pinned"} onPress={() => setFilter("pinned")} />
          {deviceRuntimeSupported ? <FilterChip label={t("deviceRuntime.thisDevice")} icon="smartphone" selected={filter === "device"} onPress={() => setFilter("device")} /> : null}
        </View>
        {remoteSearch.query === trimmedQuery && remoteSearch.loading ? <View className="min-h-4 items-end"><ActivityIndicator accessibilityLabel={t("spaces.searching")} size="small" color={theme.colors.accent} /></View> : null}
        {remoteSearch.query === trimmedQuery && remoteSearch.error && trimmedQuery.length >= 2 ? <View className="flex-row items-center gap-2 pl-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable numberOfLines={2} className="flex-1 text-caption text-danger">{remoteSearch.error}</Text><IconButton name="refresh" label={t("spaces.search.retry")} onPress={remoteSearch.retry} tone="accent" /></View> : null}
        {pinError ? <View className="flex-row items-center gap-2 pl-1"><AppIcon name="alert" size={14} tone="danger" /><Text selectable numberOfLines={2} className="flex-1 text-caption text-danger">{pinError}</Text><IconButton name="x" label={t("spaces.pin.dismiss")} onPress={() => setPinError(null)} /></View> : null}
      </View>}
      ListEmptyComponent={state.booting || (filter === "recent" && spaceList.loading && spaceList.overview === null) ? <LoadingRows count={4} /> : dataError ? <EmptyState icon="cloud-off" title={t("spaces.error.title")} description={t("spaces.error.body")} /> : searchEmpty}
    />
    <AdaptiveSheet
      visible={createOpen}
      title={pickingFolder ? t("deviceRuntime.chooseFolder") : t("spaces.create.title")}
      onClose={closeCreate}
      dismissible={!creating}
      testID="create-space-sheet"
      footer={pickingFolder
        ? <PrimaryButton label={t("deviceRuntime.useFolder")} icon="check" disabled={!folderBrowser.listing || folderBrowser.loading || Boolean(folderBrowser.failure)} onPress={() => { if (folderBrowser.listing) selectFolder(folderBrowser.listing); }} />
        : <PrimaryButton label={t("spaces.create.action")} icon="plus" loading={creating} disabled={!name.trim() || !placementReady} onPress={() => void submitCreate()} />}
    >
      {pickingFolder ? <DeviceFolderBrowser browser={folderBrowser} /> : <>
      <View className="gap-4">
        <Field label={t("spaces.create.name")}>
          <TextInput autoFocus={folder === null} value={name} onChangeText={setName} maxLength={80} placeholder={t("spaces.create.namePlaceholder")} placeholderTextColor={theme.colors.textFaint} className={FIELD_INPUT_CLASS} />
        </Field>
        <Field label={`${t("spaces.create.description")} (${t("common.optional")})`}>
          <TextInput value={description} onChangeText={setDescription} maxLength={240} multiline placeholder={t("spaces.create.descriptionPlaceholder")} placeholderTextColor={theme.colors.textFaint} className={`min-h-19 ${FIELD_INPUT_CLASS}`} style={{ textAlignVertical: "top" }} />
        </Field>
      </View>
      {deviceRuntimeSupported ? <>
        <Text className="mt-4 text-caption font-semibold text-fg-muted">{t("spaces.create.location")}</Text>
        <View accessibilityRole="tablist" className="-ml-3 flex-row">
          <FilterChip label={t("spaces.create.location.cloud")} icon="cloud" selected={!onDevice} onPress={() => setPlacement("cloud")} />
          <FilterChip label={t("deviceRuntime.thisDevice")} icon="smartphone" selected={onDevice} onPress={() => setPlacement("device")} />
        </View>
        {onDevice ? <>
          <Text className="text-caption text-fg-muted">{t("spaces.create.location.deviceHint")}</Text>
          <Text className="mt-4 text-caption font-semibold text-fg-muted">{t("spaces.create.folder")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={folder ? `${t("deviceRuntime.changeFolder")}: ${folder.label}` : t("deviceRuntime.chooseFolder")}
            disabled={creating}
            onPress={() => setPickingFolder(true)}
            className="min-h-12 flex-row items-center gap-2 rounded-sm bg-surface-raised px-3 py-2.5 active:bg-surface-pressed"
          >
            <AppIcon name="folder" size={18} tone="muted" />
            <Text numberOfLines={1} className={`min-w-0 flex-1 text-body ${folder ? "text-fg" : "text-fg-faint"}`}>{folder?.label ?? t("deviceRuntime.chooseFolder")}</Text>
            {folder ? <Text className="text-caption font-semibold text-accent">{t("deviceRuntime.changeFolder")}</Text> : <AppIcon name="chevron-right" size={16} tone="faint" />}
          </Pressable>
          {folder?.spaceId ? <View className="mt-2 gap-1">
            <Text className={`text-caption ${linkedRunning ? "text-danger" : "text-fg-muted"}`}>{linkedRunning ? t("deviceRuntime.folderInUse") : t("spaces.create.folderLinked")}</Text>
            <Pressable accessibilityRole="button" disabled={creating} onPress={() => void openLinkedSpace()} className="min-h-11 self-start justify-center active:opacity-60">
              <Text className="text-caption font-semibold text-accent">{t("spaces.create.openLinked")}</Text>
            </Pressable>
          </View> : null}
        </> : null}
      </> : null}
      {createError ? <Text accessibilityRole="alert" className="mt-2.5 text-caption text-danger">{createError}</Text> : null}
      </>}
    </AdaptiveSheet>
  </Screen>;
}
