import type { SpaceRecord } from "@neta-art/cohub";
import { Pressable, Text, View } from "react-native";
import { Avatar, AppIcon, IconButton, StatusPill } from "@/src/ui";
import { useAppTheme, typography } from "@/src/theme";
import { displaySpaceName, formatRelativeTime } from "@/src/utils";

type SpaceRowProps = {
  space: SpaceRecord;
  chatCount: number;
  onPress: () => void;
  pinning?: boolean;
  onTogglePin?: () => void;
};

export function SpaceRow({ space, chatCount, onPress, pinning = false, onTogglePin }: SpaceRowProps) {
  const theme = useAppTheme();
  const name = displaySpaceName(space);
  const active = space.status === "running" || space.status === "bootstrapping";
  const pinned = space.isPinned === true;
  const content = <>
    <Avatar name={name} uri={space.publicProfile?.avatarUrl} size={50} online={active} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text, flex: 1 }]}>{name}</Text>{active ? <StatusPill label="Active" tone="success" /> : null}</View>
      <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]}>{space.description?.trim() || `${chatCount} ${chatCount === 1 ? "Chat" : "Chats"}`}</Text>
      <Text style={[typography.micro, { color: theme.colors.textFaint, marginTop: 5 }]}>{space.lastActivityAt ? `Active ${formatRelativeTime(space.lastActivityAt)} ago` : "Ready for work"}</Text>
    </View>
    <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />
  </>;
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({ flexDirection: "row" as const, alignItems: "center" as const, gap: 13, minHeight: 84, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" });
  if (!onTogglePin) return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}`} onPress={onPress} android_ripple={{ color: theme.colors.pressOverlay }} style={rowStyle}>{content}</Pressable>;
  return <View style={{ flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}`} onPress={onPress} android_ripple={{ color: theme.colors.pressOverlay }} style={({ pressed }) => [rowStyle({ pressed }), { flex: 1, borderBottomWidth: 0, paddingRight: 4 }]}>{content}</Pressable>
    <View style={{ justifyContent: "center", paddingRight: 8 }}><IconButton name={pinned ? "pin-off" : "pin"} label={pinned ? "Unpin Space" : "Pin Space"} size={36} tone={pinned ? "accent" : "default"} disabled={pinning} onPress={() => onTogglePin()} /></View>
  </View>;
}
