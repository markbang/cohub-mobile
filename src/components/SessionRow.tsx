import type { SessionListFork, UserSessionListItem } from "@neta-art/cohub";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Avatar } from "@/src/ui";
import { AvatarStatus, LIST_AVATAR_SIZE, ListRow, Tag } from "@/src/ui/ListRow";
import { displayForkSessionTitle, formatRelativeTime, previewText } from "@/src/utils";
import type { SessionTreePosition } from "@/src/data/session-fork-tree";
import { sessionListStatus } from "@/src/data/session-status";
import { sessionActivity } from "@/src/data/session-activity";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { debugAlias } from "@/src/data/debug-session";
import { traceAction } from "@/src/data/interaction-trace";
import { ContextMenu } from "@/src/components/ContextMenu";
import { NativeContextMenu, nativeContextMenus } from "@/src/components/NativeContextMenu";
import { haptics } from "@/src/platform/haptics";
import { SwipeActions } from "@/src/ui/SwipeActions";

type SessionRowProps = {
  session: UserSessionListItem;
  onPress: () => void;
  onPressIn?: () => void;
  /** Long-press opens label management (only when connected). */
  onLongPress?: () => void;
  /** Labels shown as small chips at the end of the second line. */
  labels?: { id: string; name: string; system: boolean }[];
  showSpace?: boolean;
  fork?: SessionListFork | null;
  tree?: SessionTreePosition | null;
};

const AVATAR_SIZE = LIST_AVATAR_SIZE;
const BRANCH_COLUMN = 16;
const TREE_STEP = 12;

function railX(level: number, showSpace: boolean) {
  return (showSpace ? AVATAR_SIZE / 2 - 0.5 : 3.5) + (level - 1) * TREE_STEP;
}

export function SessionRow({ session, onPress, onPressIn, onLongPress, labels = [], showSpace = true, fork = null, tree = null }: SessionRowProps) {
  const { t } = useTranslation();
  const { state } = useApp();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const spaceName = session.space?.name?.trim() || t("space.fallbackName");
  const status = sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses);
  const latestTurn = state.sessionLatestTurns[session.id];
  const activity = sessionActivity(session, { status, latestTurn, live: state.sessionViews[session.id]?.stream ?? null, t });
  const glyph = status === "running" || status === "failed" || status === "stopped" ? status : null;
  const depth = tree?.depth ?? 0;
  const branch = depth > 0;
  const title = displayForkSessionTitle(session, fork);
  const forkLabel = !fork ? null : fork.parentSessionId === null ? t("session.forkedFromUnavailable") : fork.parentTitle?.trim() ? t("session.forkedFrom", { title: fork.parentTitle.trim() }) : t("session.forkedFromChat");
  const statusLabel = activity?.text ?? null;
  // Fork children hang off the parent's avatar column; rails span the whole row height.
  const leading = branch && tree
    ? <View className="flex-1" style={{ width: (showSpace ? AVATAR_SIZE : BRANCH_COLUMN) + (depth - 1) * TREE_STEP }}>
      {tree.rails.map((continues, index) => continues ? <View key={index} className="absolute bottom-0 top-0 w-px bg-border-strong" style={{ left: railX(index + 1, showSpace) }} /> : null)}
      <View className="absolute top-0 w-px bg-border-strong" style={{ left: railX(depth, showSpace), bottom: tree.last ? "50%" : 0 }} />
      <View className="absolute top-1/2 h-px bg-border-strong" style={{ left: railX(depth, showSpace), right: showSpace ? 6 : 0 }} />
      {tree.hasChildren ? <View className="absolute bottom-0 top-1/2 w-px bg-border-strong" style={{ left: railX(depth + 1, showSpace) }} /> : null}
    </View>
    : showSpace
      ? <View className="flex-1 justify-center">
        {tree?.hasChildren ? <View className="absolute bottom-0 top-1/2 w-px bg-border-strong" style={{ left: railX(1, true) }} /> : null}
        <AvatarStatus status={glyph} size={AVATAR_SIZE}><Avatar name={spaceName} uri={session.space?.publicProfile?.avatarUrl} size={AVATAR_SIZE} /></AvatarStatus>
      </View>
      : null;
  // Rows without an avatar carry state as a leading title icon instead of the avatar ring; a fork keeps its cue beside it.
  const statusIcon = glyph && (branch || !showSpace)
    ? <AppIcon name={glyph === "running" ? "sync" : glyph === "failed" ? "alert" : "stop"} size={13} tone={glyph === "running" ? "accent" : glyph === "failed" ? "danger" : "muted"} />
    : null;
  const forkIcon = fork && !branch ? <AppIcon name="git-fork" size={13} tone="faint" /> : null;
  const titlePrefix = statusIcon || forkIcon ? <>{statusIcon}{forkIcon}</> : null;
  // `latestMessageText` is empty after tool-only or reasoning-only messages even
  // though the Chat has history, so it is never evidence of a Chat without messages.
  const turnText = latestTurn?.assistantText || latestTurn?.userText;
  const preview = previewText(session.latestMessageText, 84) || previewText(turnText, 84);
  const hasMessages = Boolean(session.lastMessageId);
  const detail = activity?.text || preview || (hasMessages ? "" : t("session.noMessages"));
  const subtitle = showSpace && !branch ? [spaceName, detail].filter(Boolean).join(" · ") : detail || undefined;
  const subtitleNode = typeof subtitle === "string" && activity?.tone === "danger"
    ? <Text numberOfLines={1} className="text-subhead text-danger">{subtitle}</Text>
    : subtitle;
  const shownLabels = labels.slice(0, 2);
  // A hold peeks at the last exchange; rows whose hold already manages labels keep it.
  const peek = !onLongPress;
  const actions = [{ icon: "arrow-right", title: t("common.open"), onPress }] as const;
  const peekPreview = { title, subtitle: showSpace ? spaceName : undefined, body: previewText(latestTurn?.assistantText || turnText || session.latestMessageText, 600) || detail || undefined, footnote: statusLabel ?? formatRelativeTime(session.lastMessageAt ?? session.updatedAt) };
  const row = <ListRow
    leading={leading}
    compact={branch}
    title={title}
    titlePrefix={titlePrefix}
    meta={formatRelativeTime(session.lastMessageAt ?? session.updatedAt)}
    subtitle={subtitleNode}
    trailing={shownLabels.length ? <View className="flex-row gap-1">{shownLabels.map((label) => <Tag key={label.id} label={label.name} tone={label.system ? "info" : "accent"} />)}</View> : null}
    // A fork tree reads as one item: its guide lines run unbroken and only its end draws a separator.
    group={!tree ? "single" : tree.depth === 0 ? (tree.lastInGroup ? "single" : "first") : tree.lastInGroup ? "last" : "middle"}
    accessibilityLabel={[t("ui.openNamed", { name: title }), statusLabel, forkLabel, ...labels.map((label) => label.name)].filter(Boolean).join(", ")}
    onPress={() => { traceAction("session_row", { session: debugAlias("session", session.id), status }); onPress(); }}
    onPressIn={onPressIn}
    onLongPress={!peek ? onLongPress : nativeContextMenus ? () => undefined : (event) => { const { pageX, pageY } = event.nativeEvent; haptics.longPress(); setMenuAt({ x: pageX, y: pageY }); }}
  />;
  if (!peek) return onLongPress ? <SwipeActions trailing={[{ icon: "tag", label: t("labels.title"), tone: "neutral", onPress: onLongPress }]}>{row}</SwipeActions> : row;
  if (nativeContextMenus) return <NativeContextMenu menu="session-row" actions={actions} preview={peekPreview}>{row}</NativeContextMenu>;
  return <>
    {row}
    {menuAt ? <ContextMenu visible x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} preview={peekPreview} actions={[...actions]} /> : null}
  </>;
}

export function SessionForkToggle({ hidden, expanded, showSpace = true, onPress }: { hidden: number; expanded: boolean; showSpace?: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const label = expanded ? t("session.forks.showFewer") : t("session.forks.showMore", { count: hidden });
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ expanded }}
    onPress={() => { traceAction("session_fork_toggle", { expanded: !expanded, hidden }); onPress(); }}
    className="min-h-11 flex-row items-center gap-1.5 border-border pr-4 active:bg-surface-pressed"
    style={{ paddingLeft: 16 + (showSpace ? AVATAR_SIZE + 14 : 0), borderBottomWidth: StyleSheet.hairlineWidth }}
  >
    <AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={15} tone="accent" />
    <Text numberOfLines={1} className="text-caption font-semibold text-accent">{label}</Text>
  </Pressable>;
}
