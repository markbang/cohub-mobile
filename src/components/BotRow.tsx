import type { SpaceRecord } from "@neta-art/cohub";
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";
import { ContextMenu } from "@/src/components/ContextMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import { PRIMARY_BOT_SLUG, type BotEntry } from "@/src/data/bot-mode";
import { isSessionUnread } from "@/src/data/chat-read-state";
import { useAppSelector } from "@/src/data/context";
import { useRelativeTime } from "@/src/data/use-relative-time";
import { useTranslation } from "@/src/i18n";
import { haptics } from "@/src/platform/haptics";
import { MAX_FONT_SCALE, useAppTheme } from "@/src/theme";
import { AppIcon, Avatar } from "@/src/ui";
import { AvatarStatus, ListRow, Tag } from "@/src/ui/ListRow";
import { displaySpaceName, previewText } from "@/src/utils";

/** Larger than a Chat row's 46, as a messaging app's contacts. */
const BOT_ROW_AVATAR_SIZE = 52;
/** A pinned face is a step larger than a row's, and a circle. */
const PINNED_BOT_AVATAR_SIZE = 56;
/** One face's column, which its name truncates to; 8 on each side of the face lines the first one up with the rows' avatars. */
const PINNED_BOT_WIDTH = 72;

type BotProps = { entry: BotEntry<SpaceRecord>; onPress: () => void; onPressIn?: () => void; onTogglePin?: () => void };

/**
 * What a Bot's row and its pinned face share: who it is, whether it has news, and the long-press menu that
 * pins it, as a Space row's (the system's on iOS, drawn at the touch on Android).
 */
function useBot({ entry, onPress, onTogglePin }: BotProps) {
  const { t } = useTranslation();
  const { space, note, chatId, running, needsYou } = entry;
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const name = displaySpaceName(space);
  const primary = space.slug === PRIMARY_BOT_SLUG;
  const pinned = space.isPinned === true;
  // Unread is the device's record of when the user's Chat with this Bot was last open, as for any Chat.
  const unread = useAppSelector((app) => note && chatId ? isSessionUnread({ id: chatId, lastMessageId: note.messageId, lastMessageAt: note.at }, app.sessionSeen) : false);
  const pinTitle = pinned ? t("bots.unpin") : t("bots.pin");
  const actions = [
    { icon: "arrow-right", title: t("common.open"), onPress },
    ...(onTogglePin ? [{ icon: pinned ? "pin-off" : "pin", title: pinTitle, onPress: onTogglePin } as const] : []),
  ] as const;
  return {
    name,
    primary,
    unread,
    press: {
      accessibilityLabel: [t("ui.openNamed", { name }), primary ? t("bots.primary") : null, running ? t("bots.running") : null, needsYou ? t("bots.needsYou") : null, unread ? t("session.unread") : null, pinned ? t("space.pinned") : null].filter(Boolean).join(", "),
      accessibilityHint: onTogglePin ? t("space.longPressHint") : undefined,
      accessibilityActions: onTogglePin ? [{ name: "togglePin", label: pinTitle }] : undefined,
      onAccessibilityAction: (event: AccessibilityActionEvent) => { if (event.nativeEvent.actionName === "togglePin") onTogglePin?.(); },
      // On iOS the system context menu owns the hold; the no-op still keeps a hold from becoming a press.
      onLongPress: nativeContextMenus ? () => undefined : (event: GestureResponderEvent) => { const { pageX, pageY } = event.nativeEvent; haptics.longPress(); setMenuAt({ x: pageX, y: pageY }); },
    },
    menu: (view: ReactElement) => nativeContextMenus
      ? <NativeContextMenu menu="bot" actions={actions}>{view}</NativeContextMenu>
      : <>{view}{menuAt ? <ContextMenu visible x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} actions={[...actions]} /> : null}</>,
  };
}

/** Drawn after the running ring, so the ring never crosses the star. */
function PrimaryStar() {
  const theme = useAppTheme();
  return <View pointerEvents="none" className="absolute -bottom-1 -right-1 size-5.5 items-center justify-center rounded-full border-2 border-background bg-accent"><AppIcon name="star" size={11} tone="onAccent" fill={theme.colors.accentText} strokeWidth={1.5} /></View>;
}

/** A Bot as a contact: the last thing it said, and whether it is working, waiting on the user, or has news. */
export function BotRow(props: BotProps) {
  const { t } = useTranslation();
  const { space, note, running, needsYou } = props.entry;
  const bot = useBot(props);
  const age = useRelativeTime(note?.at ?? space.lastActivityAt);
  // Another Bot's message reads as theirs, as in a group chat's preview.
  const writer = useAppSelector((app) => note?.from ? app.state.spaces.find((item) => item.id === note.from) ?? null : null);
  const text = note ? previewText(note.text) : "";
  const preview = note?.from && text ? t("bots.preview.from", { name: writer ? displaySpaceName(writer) : t("bots.otherBot"), text }) : text;
  // Working is the avatar's ring, as on a running Chat's row, and needing the user a chip on the name's line,
  // so the preview keeps the whole second line.
  return bot.menu(<ListRow
    leading={<View className="flex-1 justify-center"><View>
      <AvatarStatus status={running ? "running" : null} size={BOT_ROW_AVATAR_SIZE}><Avatar name={bot.name} uri={space.publicProfile?.avatarUrl} size={BOT_ROW_AVATAR_SIZE} /></AvatarStatus>
      {bot.primary ? <PrimaryStar /> : null}
    </View></View>}
    title={bot.name}
    titleBadge={needsYou ? <Tag label={t("bots.needsYou")} /> : null}
    meta={age}
    subtitle={preview || undefined}
    divider={false}
    unread={bot.unread}
    onPress={props.onPress}
    onPressIn={props.onPressIn}
    {...bot.press}
  />);
}

/**
 * The pinned Bots as a row of faces above the list, as a messaging app's pinned chats; it scrolls sideways once
 * they outgrow the screen. Working is the same ring as a row's. A face has no second line, so one dot stands for
 * both news and needing the user, and its label says which.
 */
export function PinnedBots({ entries, onPress, onPressIn, onTogglePin }: { entries: readonly BotEntry<SpaceRecord>[]; onPress: (entry: BotEntry<SpaceRecord>) => void; onPressIn?: (entry: BotEntry<SpaceRecord>) => void; onTogglePin?: (entry: BotEntry<SpaceRecord>) => void }) {
  if (entries.length === 0) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="px-2">
    {entries.map((entry) => <PinnedBot key={entry.space.id} entry={entry} onPress={() => onPress(entry)} onPressIn={onPressIn ? () => onPressIn(entry) : undefined} onTogglePin={onTogglePin ? () => onTogglePin(entry) : undefined} />)}
  </ScrollView>;
}

function PinnedBot(props: BotProps) {
  const { space, running, needsYou } = props.entry;
  const bot = useBot(props);
  // The column's width is set on both: iOS hosts the pressable in the system menu, which sizes it from its own style.
  return <View style={{ width: PINNED_BOT_WIDTH }}>{bot.menu(<Pressable accessibilityRole="button" onPress={props.onPress} onPressIn={props.onPressIn} delayLongPress={350} className="items-center gap-1.5 pb-2 pt-1 active:opacity-70" style={{ width: PINNED_BOT_WIDTH }} {...bot.press}>
    <View>
      <AvatarStatus status={running ? "running" : null} size={PINNED_BOT_AVATAR_SIZE} round><Avatar name={bot.name} uri={space.publicProfile?.avatarUrl} size={PINNED_BOT_AVATAR_SIZE} round /></AvatarStatus>
      {bot.unread || needsYou ? <View pointerEvents="none" className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-background bg-accent" /> : null}
      {bot.primary ? <PrimaryStar /> : null}
    </View>
    <Text numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE.control} className="max-w-full px-1 text-micro text-fg-secondary">{bot.name}</Text>
  </Pressable>)}</View>;
}
