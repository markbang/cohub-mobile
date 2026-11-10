import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SettingsRow } from "@/src/components/SettingsRow";
import { useAppSelector } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { Avatar, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { displaySpaceName } from "@/src/utils";

/** A Bot's profile: who it is, and links into the Space pages that hold its persona, memory, schedules, and files. */
export default function BotProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ spaceId?: string | string[] }>();
  const spaceId = (Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId) ?? "";
  const space = useAppSelector((app) => app.state.spaces.find((item) => item.id === spaceId) ?? null);
  const name = displaySpaceName(space);
  return <Screen>
    <TopBar title={name} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="items-center gap-3 px-4 pb-6 pt-4">
        <Avatar name={name} uri={space?.publicProfile?.avatarUrl} size={88} />
        <Text selectable numberOfLines={2} className="text-center text-display font-semibold text-fg">{name}</Text>
      </View>
      <SettingsGroup>
        <SettingsRow icon="user" title={t("bots.profile.persona")} onPress={() => router.push({ pathname: "/space/[spaceId]/file", params: { spaceId, path: ".agents/APPEND_SYSTEM.md" } })} />
        <SettingsRow icon="database" title={t("bots.profile.memory")} onPress={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId, path: "memory" } })} />
        <SettingsRow icon="clock" title={t("bots.profile.schedules")} onPress={() => router.push({ pathname: "/space/[spaceId]/settings", params: { spaceId } })} />
        <SettingsRow icon="folder-open" title={t("bots.profile.files")} onPress={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId } })} last />
      </SettingsGroup>
    </ScrollView>
  </Screen>;
}
