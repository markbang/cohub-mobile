import type { SpaceRecord } from "@neta-art/cohub";
import { View } from "react-native";
import { PRIMARY_BOT_SLUG, type BotEntry } from "@/src/data/bot-mode";
import { isSessionUnread } from "@/src/data/chat-read-state";
import { useAppSelector } from "@/src/data/context";
import { useRelativeTime } from "@/src/data/use-relative-time";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar } from "@/src/ui";
import { AvatarStatus, ListRow, Tag } from "@/src/ui/ListRow";
import { displaySpaceName, previewText } from "@/src/utils";

/** Larger than a Chat row's 46, as a messaging app's contacts. */
const BOT_ROW_AVATAR_SIZE = 52;

/** A Bot as a contact: the last thing it said, and whether it is working, waiting on the user, or has news. */
export function BotRow({ entry, onPress }: { entry: BotEntry<SpaceRecord>; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { space, note, chatId, running, needsYou } = entry;
  const name = displaySpaceName(space);
  const primary = space.slug === PRIMARY_BOT_SLUG;
  const age = useRelativeTime(note?.at ?? space.lastActivityAt);
  // Unread is the device's record of when the user's Chat with this Bot was last open, as for any Chat.
  const unread = useAppSelector((app) => note && chatId ? isSessionUnread({ id: chatId, lastMessageId: note.messageId, lastMessageAt: note.at }, app.sessionSeen) : false);
  const preview = note ? previewText(note.text) : "";
  // Working is the avatar's ring, as on a running Chat's row, and needing the user a chip on the name's line,
  // so the preview keeps the whole second line.
  return <ListRow
    leading={<View className="flex-1 justify-center"><View>
      <AvatarStatus status={running ? "running" : null} size={BOT_ROW_AVATAR_SIZE}><Avatar name={name} uri={space.publicProfile?.avatarUrl} size={BOT_ROW_AVATAR_SIZE} /></AvatarStatus>
      {/* After the running ring, so the ring never crosses the star. */}
      {primary ? <View pointerEvents="none" className="absolute -bottom-1 -right-1 size-5.5 items-center justify-center rounded-full border-2 border-background bg-accent"><AppIcon name="star" size={11} tone="onAccent" fill={theme.colors.accentText} strokeWidth={1.5} /></View> : null}
    </View></View>}
    title={name}
    titleBadge={needsYou ? <Tag label={t("bots.needsYou")} /> : null}
    meta={age}
    subtitle={preview || undefined}
    divider={false}
    unread={unread}
    accessibilityLabel={[t("ui.openNamed", { name }), primary ? t("bots.primary") : null, running ? t("bots.running") : null, needsYou ? t("bots.needsYou") : null, unread ? t("session.unread") : null].filter(Boolean).join(", ")}
    onPress={onPress}
  />;
}
