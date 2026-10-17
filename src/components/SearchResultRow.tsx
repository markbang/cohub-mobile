import { View } from "react-native";
import { Avatar } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow } from "@/src/ui/ListRow";
import type { RemoteSessionSearchHit, RemoteSpaceSearchHit, SessionNavigationTarget } from "@/src/data/session-search";
import { useTranslation } from "@/src/i18n";
import { mentionDisplayText } from "@/src/data/space-mentions";
import { formatRelativeTime, shortPreview } from "@/src/utils";

type SessionSearchRowProps = {
  hit: RemoteSessionSearchHit;
  onPress: (target?: SessionNavigationTarget) => void;
  onPressIn?: () => void;
  showSpace?: boolean;
};

export function SessionSearchRow({ hit, onPress, onPressIn, showSpace = true }: SessionSearchRowProps) {
  const { t } = useTranslation();
  const spaceName = hit.spaceName?.trim() || t("space.fallbackName");
  const title = mentionDisplayText(hit.title);
  const target = hit.turnSequence == null && !hit.turnId ? undefined : { ...(hit.turnSequence != null ? { turn: hit.turnSequence } : {}), ...(hit.turnId ? { turnId: hit.turnId } : {}) };
  const preview = shortPreview(hit.preview, 84);
  return <ListRow
    leading={showSpace ? <View className="flex-1 justify-center"><Avatar name={spaceName} uri={hit.spaceAvatarUrl} size={LIST_AVATAR_SIZE} /></View> : null}
    title={title}
    meta={formatRelativeTime(hit.updatedAt)}
    subtitle={showSpace ? `${spaceName} · ${preview}` : preview}
    accessibilityLabel={t("ui.openNamed", { name: title })}
    onPress={() => onPress(target)}
    onPressIn={onPressIn}
  />;
}

export function SpaceSearchRow({ hit, onPress }: { hit: RemoteSpaceSearchHit; onPress: () => void }) {
  const { t } = useTranslation();
  return <ListRow
    leading={<View className="flex-1 justify-center"><Avatar name={hit.title} uri={hit.avatarUrl} size={LIST_AVATAR_SIZE} /></View>}
    title={hit.title}
    meta={formatRelativeTime(hit.updatedAt)}
    subtitle={hit.description || t("space.matching")}
    accessibilityLabel={t("ui.openNamed", { name: hit.title })}
    onPress={onPress}
  />;
}
