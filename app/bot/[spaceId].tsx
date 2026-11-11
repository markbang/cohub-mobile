import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ModelSelectorMenu } from "@/src/components/ModelSelectorMenu";
import { SettingsRow } from "@/src/components/SettingsRow";
import { SettingsSelectRow } from "@/src/components/SettingsSelectRow";
import { BOT_CONTEXT_WINDOWS } from "@/src/config";
import { botDirectory, turnModelSelection } from "@/src/data/bot-mode";
import { useBotContextWindow, useBotModel } from "@/src/data/bot-model";
import { useAppActions, useAppSelector, useModelCatalog } from "@/src/data/context";
import { botFileQuery } from "@/src/data/use-bots";
import { useSpaceDirectory } from "@/src/data/use-space-directory";
import { useToast } from "@/src/components/Toast";
import { useTranslation } from "@/src/i18n";
import { formatThinkingLevel } from "@/src/model-catalog";
import { Avatar, Screen, SettingsGroup, TopBar } from "@/src/ui";
import { MenuAnchor, MenuPresence } from "@/src/ui/MorphMenuSurface";
import { displaySpaceName } from "@/src/utils";

/** A Bot's profile: who it is, and links into the Space pages that hold its persona, memory, skills, schedules, and files. */
export default function BotProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { client, loadModels, loadModelStatus, refreshSessionStatuses } = useAppActions();
  const { models, modelsLoading, modelsError, modelStatus, modelStatusLoading, modelStatusError } = useModelCatalog();
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
  const file = useQuery({ ...botFileQuery(client, spaceId), enabled: Boolean(client && spaceId) });
  const workChat = file.data?.session ?? null;
  const failure = root.error ?? agents.error ?? memory.error;
  // The model the Bot's turns run with; unchosen, the page shows the one its working Chat last ran with.
  const [model, setModel] = useBotModel(client, spaceId);
  const botLastTurn = useAppSelector((app) => (workChat ? app.state.sessionLatestTurns[workChat.id] : null));
  useEffect(() => {
    if (workChat && model === undefined && !botLastTurn?.model) void refreshSessionStatuses([workChat], { silent: true });
  }, [botLastTurn?.model, model, refreshSessionStatuses, workChat]);
  const effectiveModel = useMemo(() => {
    const base = model ?? turnModelSelection(botLastTurn);
    const name = base ? models.find((item) => item.provider === base.provider && item.id === base.id)?.model?.name : null;
    return base ? { ...base, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}) } : null;
  }, [botLastTurn, model, models]);
  const [modelOpen, setModelOpen] = useState(false);
  const showToast = useToast();
  const modelRowRef = useRef<View>(null);
  const openModels = () => { setModelOpen(true); void Promise.all([loadModels(), loadModelStatus()]).catch(() => undefined); };
  const saveFailed = (error: unknown) => showToast({ title: t("bots.settings.saveFailed"), message: error instanceof Error ? error.message : undefined, tone: "danger" });
  const chooseModel = (next: Parameters<typeof setModel>[0]) => {
    setModelOpen(false);
    void setModel(next).catch(saveFailed);
  };
  // The three windows on offer, plus one written into bot.json by hand.
  const [contextWindow, setContextWindow] = useBotContextWindow(client, spaceId);
  const contextWindows = BOT_CONTEXT_WINDOWS.includes(contextWindow) ? BOT_CONTEXT_WINDOWS : [...BOT_CONTEXT_WINDOWS, contextWindow].sort((left, right) => left - right);
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
        {/* The Chat the Bot works in, as an ordinary Chat: its steps, tools, and raw replies. */}
        <SettingsRow icon="list-tree" title={t("bots.profile.workLog")} onPress={workChat ? () => router.push({ pathname: "/chat/[sessionId]", params: { sessionId: workChat.id, log: "1" } }) : undefined} />
        <MenuAnchor ref={modelRowRef} open={modelOpen}><SettingsRow icon="zap" title={t("bots.profile.model")} detail={[effectiveModel?.name || effectiveModel?.id, effectiveModel?.thinkingLevel ? formatThinkingLevel(effectiveModel.thinkingLevel) : null].filter(Boolean).join(" · ") || undefined} onPress={openModels} /></MenuAnchor>
        <SettingsSelectRow icon="layers" title={t("bots.profile.contextWindow")} value={String(contextWindow)} disabled={!file.data} options={contextWindows.map((value) => ({ value: String(value), label: `${value / 1000}k` }))} onChange={(next) => void setContextWindow(Number(next)).catch(saveFailed)} testID="bot-context-window-select" />
        <SettingsRow icon="clock" title={t("bots.profile.schedules")} onPress={() => router.push({ pathname: "/space/[spaceId]/settings", params: { spaceId } })} />
        <SettingsRow icon="folder-open" title={t("bots.profile.files")} onPress={() => router.push({ pathname: "/space/[spaceId]/files", params: { spaceId } })} last />
      </SettingsGroup>
    </ScrollView>
    <MenuPresence open={modelOpen}><ModelSelectorMenu anchorRef={modelRowRef} models={models} loading={modelsLoading} error={modelsError || modelStatusError} modelStatus={modelStatus?.models ?? null} modelStatusLoading={modelStatusLoading} currentModel={effectiveModel} onClose={() => setModelOpen(false)} onRetry={() => void Promise.all([loadModels({ force: true }), loadModelStatus({ force: true })]).catch(() => undefined)} onSelect={chooseModel} /></MenuPresence>
  </Screen>;
}
