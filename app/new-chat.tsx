import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/src/data/context";
import { normalizeSearchQuery } from "@/src/data/session-search";
import { selectSpaceList } from "@/src/data/space-list";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, DataError, EmptyState, IconButton, LoadingRows, Screen, SearchField, TopBar } from "@/src/ui";
import { displaySpaceName } from "@/src/utils";

type Params = { spaceId?: string | string[] };

export default function NewChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const initialSpaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { state, refreshHome, spaceList } = useApp();
  const error = state.spacesError ?? state.error;
  const [selectedSpaceId, setSelectedSpaceId] = useState(initialSpaceId || "");
  const [query, setQuery] = useState("");
  const [now] = useState(Date.now);
  const needle = normalizeSearchQuery(query).toLowerCase();

  const spaces = useMemo(() => {
    const ranked = selectSpaceList({ spaces: state.spaces, sessions: state.sessions, overview: null, visits: spaceList.visits, personalActivity: new Map(), filter: "all", now });
    if (!needle) return ranked;
    return ranked.filter((space) => [displaySpaceName(space), space.description].some((value) => value ? normalizeSearchQuery(value).toLowerCase().includes(needle) : false));
  }, [needle, now, spaceList.visits, state.sessions, state.spaces]);

  const openSpaceDraft = (spaceId: string) => {
    setSelectedSpaceId(spaceId);
    router.replace({ pathname: "/chat/[sessionId]", params: { sessionId: "new", spaceId } });
  };

  const empty = state.spaces.length === 0
    ? state.booting || state.refreshing ? <LoadingRows count={4} /> : error ? null : <EmptyState icon="layers" title={t("newChat.noSpaces")} description={t("newChat.createSpaceHint")} action={{ icon: "layers", label: t("tabs.spaces"), onPress: () => router.dismissTo("/(tabs)/spaces") }} />
    : <EmptyState icon="search" title={t("spaces.empty.matching.title")} description={t("spaces.empty.matching.body")} />;

  return <Screen keyboard>
    <TopBar title={t("route.newChat")} actions={<IconButton name="x" label={t("ui.sheet.close", { title: t("route.newChat") })} onPress={() => router.back()} />} />
    {state.spaces.length > 0 ? <View className="px-4 pb-2">
      <SearchField value={query} onChangeText={setQuery} placeholder={t("spaces.search.placeholder")} />
    </View> : null}
    {error ? <DataError message={error} onRetry={() => void refreshHome()} /> : null}
    <FlatList
      data={spaces}
      keyExtractor={(space) => space.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30, flexGrow: 1 }}
      ListEmptyComponent={empty}
      renderItem={({ item: space }) => {
        const selected = selectedSpaceId === space.id;
        return <Pressable
          accessibilityRole="button"
          accessibilityLabel={displaySpaceName(space)}
          onPress={() => openSpaceDraft(space.id)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 11, minHeight: 66, paddingHorizontal: 12, backgroundColor: selected ? theme.colors.accentSoft : pressed ? theme.colors.surfacePressed : "transparent", borderBottomWidth: 1, borderBottomColor: theme.colors.border })}
        >
          <Avatar name={displaySpaceName(space)} uri={space.publicProfile?.avatarUrl} size={38} />
          <View className="flex-1 min-w-0">
            <Text numberOfLines={1} className="text-body font-semibold text-fg">{displaySpaceName(space)}</Text>
            {space.description ? <Text numberOfLines={1} className="text-caption text-fg-muted mt-0.5">{space.description}</Text> : null}
          </View>
          <AppIcon name="arrow-right" size={18} tone={selected ? "accent" : "faint"} />
        </Pressable>;
      }}
    />
  </Screen>;
}
