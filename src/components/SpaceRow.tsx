import type { SpaceListSpace } from "@/src/data/space-list";
import { useState } from "react";
import { View } from "react-native";
import { ContextMenu } from "@/src/components/ContextMenu";
import { type SpaceSessionCount } from "@/src/data/space-session-counts";
import { Avatar, AppIcon } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow, Meta } from "@/src/ui/ListRow";
import { displaySpaceName, formatRelativeTime } from "@/src/utils";
import { useTranslation } from "@/src/i18n";

type SpaceRowProps = {
  space: SpaceListSpace;
  sessionCount?: SpaceSessionCount | null;
  onPress: () => void;
  pinning?: boolean;
  onTogglePin?: () => void;
};

export function SpaceRow({ space, sessionCount, onPress, pinning = false, onTogglePin }: SpaceRowProps) {
  const { t } = useTranslation();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const name = displaySpaceName(space);
  const active = space.status === "running" || space.status === "bootstrapping";
  const pinned = space.isPinned === true;
  const countLabel = sessionCount
    ? sessionCount.hasMore
      ? t("space.chatCount.more", { count: sessionCount.count })
      : t(sessionCount.count === 1 ? "space.chatCount.one" : "space.chatCount.other", { count: sessionCount.count })
    : null;
  // The second line carries either the description or the chat count; never both.
  const subtitle = space.description?.trim() || null;
  return (
    <>
      <ListRow
        leading={<View className="flex-1 justify-center"><Avatar name={name} uri={space.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} online={active} /></View>}
        title={name}
        titlePrefix={pinned ? <AppIcon name="pin" size={12} tone="faint" /> : null}
        meta={formatRelativeTime(space.lastActivityAt)}
        subtitle={subtitle}
        trailing={sessionCount && countLabel && !subtitle ? <Meta icon="messages" value={`${sessionCount.count}${sessionCount.hasMore ? "+" : ""}`} label={countLabel} tone="faint" /> : null}
        accessibilityLabel={[t("ui.openNamed", { name }), active ? t("ui.active") : null, pinned ? t("space.pinned") : null].filter(Boolean).join(", ")}
        accessibilityHint={onTogglePin && !pinning ? t("space.longPressHint") : undefined}
        onPress={onPress}
        // The handler stays attached while pinning: without one, Pressable would turn the hold into a press and navigate.
        onLongPress={onTogglePin ? (event) => { if (pinning) return; const { pageX, pageY } = event.nativeEvent; setMenuAt({ x: pageX, y: pageY }); } : undefined}
        accessibilityActions={onTogglePin && !pinning ? [{ name: "togglePin", label: pinned ? t("space.unpin") : t("space.pin") }] : undefined}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "togglePin" && onTogglePin && !pinning) onTogglePin(); }}
      />
      {menuAt && onTogglePin ? <ContextMenu
        visible
        x={menuAt.x}
        y={menuAt.y}
        onClose={() => setMenuAt(null)}
        actions={[{ icon: pinned ? "pin-off" : "pin", title: pinned ? t("space.unpin") : t("space.pin"), onPress: () => { if (!pinning) onTogglePin(); } }]}
      /> : null}
    </>
  );
}
