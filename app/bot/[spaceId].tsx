import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SettingsRow } from "@/src/components/SettingsRow";
import { botDirectory } from "@/src/data/bot-mode";
import { useAppActions, useAppSelector } from "@/src/data/context";
import { useSpaceDirectory } from "@/src/data/use-space-directory";
import { useTranslation } from "@/src/i18n";
import { Avatar, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { displaySpaceName } from "@/src/utils";

/** A Bot's profile: who it is, and links into the Space pages that hold its persona, memory, skills, schedules, and files. */
export default function BotProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { client } = useAppActions();
  const params = useLocalSearchParams<{ spaceId?: string | string[] }>();
  const spaceId = (Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId) ?? "";
  const space = useAppSelector((app) => app.state.spaces.find((item) => item.id === spaceId) ?? null);
  const name = displaySpaceName(space);
  // Where the bot mod keeps a Bot: persona, memory loaded every session (AGENTS.md), other memory, learned skills.
  // A new Bot may have none of them yet: what is missing shows as empty and does not open.
  const root = botDirectory(useSpaceDirectory(client, spaceId, ""));
  const agents = botDirectory(useSpaceDirectory(client, spaceId, ".agents"));
  const memory = botDirectory(useSpaceDirectory(client, spaceId, "memory"));
  const has = (directory: typeof root, entryName: string) => directory.entries.some((entry) => entry.name === entryName);
  const persona = has(agents, "APPEND_SYSTEM.md");
  const coreMemory = has(root, "AGENTS.md");
  const skills = has(agents, "skills");
  const memoryFiles = memory.entries.filter((entry) => entry.type !== "dir");
  const openFile = (path: string) => router.push({ pathname: "/space/[spaceId]/file", params: { spaceId, path } });
  const none = (known: boolean) => known ? t("bots.profile.none") : undefined;
  const failure = root.error ?? agents.error ?? memory.error;
  return <Screen>
    <TopBar title={name} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View className="items-center gap-3 px-4 pb-6 pt-4">
        <Avatar name={name} uri={space?.publicProfile?.avatarUrl} size={88} />
        <Text selectable numberOfLines={2} className="text-center text-display font-semibold text-fg">{name}</Text>
      </View>
      {failure ? <Text selectable className="px-8 pb-4 text-caption text-danger">{failure}</Text> : null}
      <SettingsGroup>
        <SettingsRow icon="user" title={t("bots.profile.persona")} detail={persona ? undefined : none(agents.known)} onPress={persona ? () => openFile(".agents/APPEND_SYSTEM.md") : undefined} />
        <SettingsRow icon="sparkles" title={t("bots.profile.skills")} detail={skills ? undefined : none(agents.known)} onPress={skills ? () => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId, path: ".agents/skills" } }) : undefined} last />
      </SettingsGroup>
      <SettingsGroup label={t("bots.profile.memory")}>
        <SettingsRow icon="book-open" title={t("bots.profile.memory.core")} detail={coreMemory ? undefined : none(root.known)} onPress={coreMemory ? () => openFile("AGENTS.md") : undefined} last={memoryFiles.length === 0 && !memory.known} />
        {memoryFiles.map((entry, index) => <SettingsRow key={entry.path} icon="file-text" title={entry.name} onPress={() => openFile(entry.path)} last={index === memoryFiles.length - 1} />)}
        {memoryFiles.length === 0 && memory.known ? <Text className="bg-surface px-4 py-3 text-caption text-fg-muted">{t("bots.profile.memory.empty")}</Text> : null}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow icon="clock" title={t("bots.profile.schedules")} onPress={() => router.push({ pathname: "/space/[spaceId]/settings", params: { spaceId } })} />
        <SettingsRow icon="folder-open" title={t("bots.profile.files")} onPress={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId } })} last />
      </SettingsGroup>
    </ScrollView>
  </Screen>;
}
