import type { SessionListFork, UserSessionListItem } from "@neta-art/cohub";
import { Text, View } from "react-native";
import { Avatar, AppIcon, StatusPill } from "@/src/ui";
import { PressableScale } from "@/src/ui/PressableScale";
import { useAppTheme, typography } from "@/src/theme";
import { displayForkSessionTitle, formatRelativeTime, shortPreview } from "@/src/utils";
import type { SessionTreePosition } from "@/src/data/session-fork-tree";
import { sessionListStatus } from "@/src/data/session-status";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";

type SessionRowProps = {
  session: UserSessionListItem;
  onPress: () => void;
  onPressIn?: () => void;
  /** Long-press opens label management (only when connected). */
  onLongPress?: () => void;
  /** Labels shown as small chips under the preview line. */
  labels?: { id: string; name: string; system: boolean }[];
  showSpace?: boolean;
  fork?: SessionListFork | null;
  tree?: SessionTreePosition | null;
};

const AVATAR_SIZE = 48;
const ROW_PADDING_Y = 10;

export function SessionRow({ session, onPress, onPressIn, onLongPress, labels = [], showSpace = true, fork = null, tree = null }: SessionRowProps) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const { state } = useApp();
  const spaceName = session.space?.name?.trim() || t("space.fallbackName");
  const sessionStatus = sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses);
  const running = sessionStatus === "running";
  const branch = tree?.depth === 1;
  const title = displayForkSessionTitle(session, fork);
  const forkLabel = !fork ? null : fork.parentSessionId === null ? t("session.forkedFromUnavailable") : fork.parentTitle?.trim() ? t("session.forkedFrom", { title: fork.parentTitle.trim() }) : t("session.forkedFromChat");
  const guideColumn = showSpace ? AVATAR_SIZE : 16;
  const guideX = showSpace ? AVATAR_SIZE / 2 - 0.5 : 3.5;
  const guideColor = theme.colors.borderStrong;
  const leading = branch
    ? <View style={{ width: guideColumn, alignSelf: "stretch", marginVertical: -ROW_PADDING_Y }}>
      <View style={{ position: "absolute", left: guideX, width: 1, top: 0, bottom: tree.lastInGroup ? "50%" : 0, backgroundColor: guideColor }} />
      <View style={{ position: "absolute", left: guideX, right: showSpace ? 6 : 0, top: "50%", height: 1, backgroundColor: guideColor }} />
    </View>
    : showSpace
      ? <View style={{ alignSelf: "stretch", justifyContent: "center", marginVertical: -ROW_PADDING_Y }}>
        {tree?.hasChildren ? <View style={{ position: "absolute", left: guideX, width: 1, top: "50%", bottom: 0, backgroundColor: guideColor }} /> : null}
        <Avatar name={spaceName} uri={session.space?.publicProfile?.avatarUrl} size={AVATAR_SIZE} online={running} />
      </View>
      : null;
  const rowContent = <>
    {leading}
    <View style={{ flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={[typography.bodyMedium, { color: theme.colors.text, flex: 1 }]}>{title}</Text>
        <Text style={[typography.micro, { color: theme.colors.textFaint }]}>{formatRelativeTime(session.lastMessageAt ?? session.updatedAt)}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
        <Text numberOfLines={1} style={[typography.caption, { color: theme.colors.textMuted, flex: 1 }]}>{showSpace && !branch ? `${spaceName} · ` : ""}{shortPreview(session.latestMessageText, 84)}</Text>
        {sessionStatus === "running" ? <StatusPill label={t("ui.status.running")} tone="warning" /> : sessionStatus === "failed" ? <StatusPill label={t("ui.status.failed")} tone="danger" /> : sessionStatus === "stopped" ? <StatusPill label={t("ui.status.stopped")} tone="neutral" /> : null}
      </View>
      {forkLabel && !branch ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
        <AppIcon name="git-fork" size={12} color={theme.colors.textFaint} />
        <Text numberOfLines={1} style={[typography.micro, { color: theme.colors.textFaint, flexShrink: 1 }]}>{forkLabel}</Text>
      </View> : null}
      {labels.length > 0 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
        {labels.slice(0, 3).map((label) => <View key={label.id} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: label.system ? theme.colors.infoSoft : theme.colors.accentSoft }}>
          <Text numberOfLines={1} style={[typography.micro, { color: label.system ? theme.colors.info : theme.colors.accent }]}>{label.name}</Text>
        </View>)}
        {labels.length > 3 ? <View style={{ paddingHorizontal: 6, paddingVertical: 2, justifyContent: "center" }}><Text style={[typography.micro, { color: theme.colors.textFaint }]}>+{labels.length - 3}</Text></View> : null}
      </View> : null}
    </View>
    <AppIcon name="chevron-right" size={16} color={theme.colors.textFaint} />
  </>;
  const rowStyle = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, minHeight: branch ? 60 : showSpace ? 76 : 68, paddingHorizontal: showSpace ? 18 : 16, paddingVertical: ROW_PADDING_Y, backgroundColor: "transparent", borderBottomWidth: tree && !tree.lastInGroup ? 0 : 1, borderBottomColor: theme.colors.border };
  const rowPressedStyle = { backgroundColor: theme.colors.surfacePressed };
  const accessibilityLabel = [t("ui.openNamed", { name: title }), forkLabel].filter(Boolean).join(", ");
  return <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} onPressIn={onPressIn} onLongPress={onLongPress} haptic style={rowStyle} pressedStyle={rowPressedStyle}>{rowContent}</PressableScale>;
}
