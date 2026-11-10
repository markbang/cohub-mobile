import type { SessionRecord, SpaceRecord } from "@neta-art/cohub";
import { View } from "react-native";
import type { BotEntry } from "@/src/data/bot-mode";
import { isSessionUnread } from "@/src/data/chat-read-state";
import { useAppSelector } from "@/src/data/context";
import { useRelativeTime } from "@/src/data/use-relative-time";
import { useTranslation } from "@/src/i18n";
import { Avatar } from "@/src/ui";
import { Loader } from "@/src/ui/Loader";
import { LIST_AVATAR_SIZE, ListRow, Tag } from "@/src/ui/ListRow";
import { displaySpaceName, previewText } from "@/src/utils";

/** A Bot as a contact: its last message, and whether it is working, waiting on the user, or has news. */
export function BotRow({ entry, onPress }: { entry: BotEntry<SpaceRecord, SessionRecord>; onPress: () => void }) {
  const { t } = useTranslation();
  const { space, session, running, needsYou } = entry;
  const name = displaySpaceName(space);
  const age = useRelativeTime(session ? session.lastMessageAt ?? session.updatedAt : space.lastActivityAt);
  // Read state is the device's record of when this Bot's Chat was last open, as for any Chat.
  const unread = useAppSelector((app) => session ? isSessionUnread(session, app.sessionSeen) : false);
  const preview = session ? previewText(session.latestMessageText) : "";
  return <ListRow
    leading={<View className="flex-1 justify-center"><Avatar name={name} uri={space.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} /></View>}
    title={name}
    meta={age}
    subtitle={preview || undefined}
    trailing={needsYou ? <Tag label={t("bots.needsYou")} /> : null}
    accessory={running ? <Loader accessibilityLabel={t("bots.running")} /> : null}
    unread={unread}
    accessibilityLabel={[t("ui.openNamed", { name }), running ? t("bots.running") : null, needsYou ? t("bots.needsYou") : null, unread ? t("session.unread") : null].filter(Boolean).join(", ")}
    onPress={onPress}
  />;
}
