import type { SessionRecord, SpaceRecord } from "@neta-art/cohub";
import { useState } from "react";
import { View } from "react-native";
import { ContextMenu } from "@/src/components/ContextMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import type { BotEntry } from "@/src/data/bot-mode";
import { useRelativeTime } from "@/src/data/use-relative-time";
import { useTranslation } from "@/src/i18n";
import { haptics } from "@/src/platform/haptics";
import { Avatar } from "@/src/ui";
import { Loader } from "@/src/ui/Loader";
import { LIST_AVATAR_SIZE, ListRow, Tag } from "@/src/ui/ListRow";
import { displaySessionTitle, displaySpaceName, previewText } from "@/src/utils";

/** A Bot as a contact: its latest reply under its name, and whether it is working or waiting on the user. */
export function BotRow({ entry, onPress, onNewChat }: { entry: BotEntry<SpaceRecord, SessionRecord>; onPress: () => void; onNewChat: () => void }) {
  const { t } = useTranslation();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const { space, latest, running, needsYou } = entry;
  const name = displaySpaceName(space);
  const age = useRelativeTime(latest ? latest.lastMessageAt ?? latest.updatedAt : space.lastActivityAt);
  const subtitle = latest ? previewText(latest.latestMessageText) || displaySessionTitle(latest) : "";
  const row = <ListRow
    leading={<View className="flex-1 justify-center"><Avatar name={name} uri={space.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} /></View>}
    title={name}
    meta={age}
    subtitle={subtitle || undefined}
    trailing={needsYou ? <Tag label={t("bots.needsYou")} /> : null}
    accessory={running ? <Loader accessibilityLabel={t("bots.running")} /> : null}
    accessibilityLabel={[t("ui.openNamed", { name }), running ? t("bots.running") : null, needsYou ? t("bots.needsYou") : null].filter(Boolean).join(", ")}
    accessibilityActions={[{ name: "newChat", label: t("chats.action.newChat") }]}
    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "newChat") onNewChat(); }}
    onPress={onPress}
    onLongPress={nativeContextMenus ? () => undefined : (event) => { haptics.longPress(); setMenuAt({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }); }}
  />;
  const actions = [
    { icon: "arrow-right", title: t("common.open"), onPress },
    { icon: "square-pen", title: t("chats.action.newChat"), onPress: onNewChat },
  ] as const;
  const preview = { title: name, body: subtitle || undefined, footnote: age };
  if (nativeContextMenus) return <NativeContextMenu menu="bot-row" actions={actions} preview={preview}>{row}</NativeContextMenu>;
  return <>
    {row}
    {menuAt ? <ContextMenu visible x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} preview={preview} actions={actions.map((action) => ({ icon: action.icon, title: action.title, onPress: action.onPress }))} /> : null}
  </>;
}

/** A Chat a Bot flagged for the user, naming both the Bot and the Chat. */
export function NeedsYouRow({ space, session, onPress }: { space: SpaceRecord; session: SessionRecord; onPress: () => void }) {
  const { t } = useTranslation();
  const bot = displaySpaceName(space);
  const chat = displaySessionTitle(session);
  const age = useRelativeTime(session.lastMessageAt ?? session.updatedAt);
  return <ListRow
    leading={<View className="flex-1 justify-center"><Avatar name={bot} uri={space.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} /></View>}
    title={chat}
    meta={age}
    subtitle={bot}
    trailing={<Tag label={t("bots.needsYou")} />}
    accessibilityLabel={t("bots.needsYou.row", { chat, bot })}
    onPress={onPress}
  />;
}
