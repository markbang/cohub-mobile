import { Pressable, Text, View } from "react-native";
import { Avatar, AppIcon, IconButton } from "@/src/ui";
import type { RemoteSessionSearchHit, RemoteSpaceSearchHit, SessionNavigationTarget } from "@/src/data/session-search";
import { useAppTheme, typography } from "@/src/theme";
import { formatRelativeTime, shortPreview } from "@/src/utils";

type SessionSearchRowProps = {
  hit: RemoteSessionSearchHit;
  onPress: (target?: SessionNavigationTarget) => void;
  pinned?: boolean;
  pinning?: boolean;
  onTogglePin?: () => void;
};

export function SessionSearchRow({ hit, onPress, pinned = false, pinning = false, onTogglePin }: SessionSearchRowProps) {
  const theme = useAppTheme();
  const spaceName = hit.spaceName?.trim() || "Space";
  const target = hit.turnSequence == null && !hit.turnId ? undefined : { ...(hit.turnSequence != null ? { turn: hit.turnSequence } : {}), ...(hit.turnId ? { turnId: hit.turnId } : {}) };
  const content = <>
    <Avatar name={spaceName} uri={hit.spaceAvatarUrl} size={48} />
    <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text, flex: 1 }]}>{hit.title}</Text>
        <Text style={[typography.micro, { color: theme.colors.textFaint }]}>{formatRelativeTime(hit.updatedAt)}</Text>
      </View>
      <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]}>
        {spaceName} · {shortPreview(hit.preview, 84)}
      </Text>
    </View>
    <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />
  </>;
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({ flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minHeight: 78, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" });
  if (!onTogglePin) {
    return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${hit.title}`} onPress={() => onPress(target)} android_ripple={{ color: theme.colors.pressOverlay }} style={rowStyle}>{content}</Pressable>;
  }
  return <View style={{ flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${hit.title}`} onPress={() => onPress(target)} android_ripple={{ color: theme.colors.pressOverlay }} style={({ pressed }) => [rowStyle({ pressed }), { flex: 1, borderBottomWidth: 0, paddingRight: 4 }]}>{content}</Pressable>
    <View style={{ justifyContent: "center", paddingRight: 8 }}>
      <IconButton name={pinned ? "pin-off" : "pin"} label={pinned ? "Unpin Chat" : "Pin Chat"} size={36} tone={pinned ? "accent" : "default"} disabled={pinning} onPress={() => onTogglePin()} />
    </View>
  </View>;
}

export function SpaceSearchRow({ hit, onPress }: { hit: RemoteSpaceSearchHit; onPress: () => void }) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${hit.title}`}
      onPress={onPress}
      android_ripple={{ color: theme.colors.pressOverlay }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 13, minHeight: 84, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfacePressed : "transparent" })}
    >
      <Avatar name={hit.title} uri={hit.avatarUrl} size={50} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text }]}>{hit.title}</Text>
        <Text numberOfLines={2} style={[typography.caption, { color: theme.colors.textMuted, marginTop: 4 }]}>{hit.description || "Matching Space"}</Text>
        <Text style={[typography.micro, { color: theme.colors.textFaint, marginTop: 5 }]}>{hit.updatedAt ? `Active ${formatRelativeTime(hit.updatedAt)}` : "Space"}</Text>
      </View>
      <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />
    </Pressable>
  );
}
