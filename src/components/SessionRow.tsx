import type { UserSessionListItem } from "@neta-art/cohub";
import { Pressable, Text, View } from "react-native";
import { Avatar, AppIcon, IconButton, StatusPill } from "@/src/ui";
import { useAppTheme, typography } from "@/src/theme";
import { displaySessionTitle, formatRelativeTime, isNeedsAttentionStatus, isRunningStatus, shortPreview } from "@/src/utils";

type SessionRowProps = {
  session: UserSessionListItem;
  onPress: () => void;
  pinned?: boolean;
  pinning?: boolean;
  onTogglePin?: () => void;
};

export function SessionRow({ session, onPress, pinned = false, pinning = false, onTogglePin }: SessionRowProps) {
  const theme = useAppTheme();
  const spaceName = session.space?.name?.trim() || "Space";
  const running = isRunningStatus(session.status);
  const attention = isNeedsAttentionStatus(session.status);
  const rowContent = <>
    <Avatar name={spaceName} uri={session.space?.publicProfile?.avatarUrl} size={48} online={running} />
    <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text, flex: 1 }]}>{displaySessionTitle(session)}</Text>
        <Text style={[typography.micro, { color: theme.colors.textFaint }]}>{formatRelativeTime(session.lastMessageAt ?? session.updatedAt)}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
        <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textMuted, flex: 1 }]}>{spaceName} · {shortPreview(session.latestMessageText, 84)}</Text>
        {running ? <StatusPill label="Running" tone="warning" /> : attention ? <StatusPill label="Needs you" tone="danger" /> : null}
      </View>
    </View>
    <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />
  </>;
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({ flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minHeight: 78, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" });
  if (!onTogglePin) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${displaySessionTitle(session)}`} onPress={onPress} android_ripple={{ color: theme.colors.pressOverlay }} style={rowStyle}>{rowContent}</Pressable>;
  }
  return <View style={{ flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${displaySessionTitle(session)}`} onPress={onPress} android_ripple={{ color: theme.colors.pressOverlay }} style={({ pressed }) => [rowStyle({ pressed }), { flex: 1, borderBottomWidth: 0, paddingRight: 4 }]}>{rowContent}</Pressable>
    <View style={{ justifyContent: "center", paddingRight: 8 }}>
      <IconButton name={pinned ? "pin-off" : "pin"} label={pinned ? "Unpin Chat" : "Pin Chat"} size={36} tone={pinned ? "accent" : "default"} disabled={pinning} onPress={() => onTogglePin()} />
    </View>
  </View>;
}
