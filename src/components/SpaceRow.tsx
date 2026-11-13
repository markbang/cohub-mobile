import type { SpaceListSpace } from "@/src/data/space-list";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { ContextMenu } from "@/src/components/ContextMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import { type SpaceSessionCount } from "@/src/data/space-session-counts";
import { Avatar, AppIcon } from "@/src/ui";
import { LIST_AVATAR_SIZE, ListRow, Meta } from "@/src/ui/ListRow";
import { displaySpaceName } from "@/src/utils";
import { useRelativeTime } from "@/src/data/use-relative-time";
import { useTranslation } from "@/src/i18n";
import { debugAlias } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { SwipeActions } from "@/src/ui/SwipeActions";
import { haptics } from "@/src/platform/haptics";
import { motion } from "@/src/motion";

type SpaceRowProps = {
  space: SpaceListSpace;
  sessionCount?: SpaceSessionCount | null;
  onPress: () => void;
  onTogglePin?: () => void;
};

export function SpaceRow({ space, sessionCount, onPress, onTogglePin }: SpaceRowProps) {
  const { t } = useTranslation();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const name = displaySpaceName(space);
  const active = space.status === "running" || space.status === "bootstrapping";
  const pinned = space.isPinned === true;
  const age = useRelativeTime(space.lastActivityAt);
  // A count already known at mount (cache, recycled row) appears without a fade.
  const [countKnownAtMount] = useState(() => sessionCount != null);
  const countLabel = sessionCount
    ? sessionCount.hasMore
      ? t("space.chatCount.more", { count: sessionCount.count })
      : t(sessionCount.count === 1 ? "space.chatCount.one" : "space.chatCount.other", { count: sessionCount.count })
    : null;
  // The second line carries either the description or the chat count; never both.
  const description = space.description?.trim() || null;
  // Without a description the second line is always laid out, so a count arriving later fades in
  // without re-centering the title and time.
  const subtitle = description ?? <Text className="text-subhead" importantForAccessibility="no" accessibilityElementsHidden> </Text>;
  const row = (
    <ListRow
      leading={<View className="flex-1 justify-center"><Avatar name={name} uri={space.publicProfile?.avatarUrl} size={LIST_AVATAR_SIZE} online={active} /></View>}
      title={name}
      titlePrefix={pinned ? <AppIcon name="pin" size={12} tone="faint" /> : null}
      meta={age}
      subtitle={subtitle}
      trailing={sessionCount && countLabel && !description ? <Animated.View entering={countKnownAtMount ? undefined : FadeIn.duration(motion.fade.duration)}><Meta icon="messages" value={`${sessionCount.count}${sessionCount.hasMore ? "+" : ""}`} label={countLabel} tone="faint" /></Animated.View> : null}
      accessibilityLabel={[t("ui.openNamed", { name }), active ? t("ui.active") : null, pinned ? t("space.pinned") : null].filter(Boolean).join(", ")}
      accessibilityHint={onTogglePin ? t("space.longPressHint") : undefined}
      onPress={() => { traceAction("space_row", { space: debugAlias("space", space.id), active, pinned }); onPress(); }}
      // On iOS the system context menu owns the hold; the no-op still keeps a hold from becoming a press.
      onLongPress={nativeContextMenus ? () => undefined : (event) => { const { pageX, pageY } = event.nativeEvent; haptics.longPress(); setMenuAt({ x: pageX, y: pageY }); }}
      accessibilityActions={onTogglePin ? [{ name: "togglePin", label: pinned ? t("space.unpin") : t("space.pin") }] : undefined}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "togglePin" && onTogglePin) onTogglePin(); }}
    />
  );
  // iOS lifts the row into the system context menu; Android opens the drawn menu at the touch.
  const actions = [
    { icon: "arrow-right", title: t("common.open"), onPress },
    ...(onTogglePin ? [{ icon: pinned ? "pin-off" : "pin", title: pinned ? t("space.unpin") : t("space.pin"), onPress: onTogglePin } as const] : []),
  ] as const;
  const preview = { title: name, body: space.description?.trim() || undefined, footnote: [active ? t("ui.active") : null, countLabel, age].filter(Boolean).join(" · ") };
  // Messages pins from the leading edge.
  const swipe = onTogglePin ? [{ icon: pinned ? "pin-off" : "pin", label: pinned ? t("space.unpin") : t("space.pin"), tone: "accent", onPress: onTogglePin } as const] : [];
  if (nativeContextMenus) return <SwipeActions leading={swipe}><NativeContextMenu menu="space-row" actions={actions} preview={preview}>{row}</NativeContextMenu></SwipeActions>;
  return (
    <>
      <SwipeActions leading={swipe}>{row}</SwipeActions>
      {menuAt ? <ContextMenu
        visible
        x={menuAt.x}
        y={menuAt.y}
        onClose={() => setMenuAt(null)}
        preview={preview}
        actions={actions.map((action) => ({ icon: action.icon, title: action.title, onPress: () => { if (!("disabled" in action && action.disabled)) action.onPress(); } }))}
      /> : null}
    </>
  );
}
