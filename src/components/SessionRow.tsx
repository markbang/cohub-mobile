import type { SessionListFork, UserSessionListItem } from "@neta-art/cohub";
import { useEffect, useReducer, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppIcon, Avatar } from "@/src/ui";
import { AvatarStatus, LIST_AVATAR_SIZE, ListRow, Tag } from "@/src/ui/ListRow";
import { displayForkSessionTitle, previewText } from "@/src/utils";
import { useRelativeTime } from "@/src/data/use-relative-time";
import type { SessionTreePosition } from "@/src/data/session-fork-tree";
import { sessionListStatus } from "@/src/data/session-status";
import { sessionActivity } from "@/src/data/session-activity";
import { shallowEqual, useAppActions, useAppSelector } from "@/src/data/context";
import { isSessionUnread } from "@/src/data/chat-read-state";
import { useToast } from "@/src/components/Toast";
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
  /** Off inside the Space pager, whose own leading swipe opens the Chats panel. */
  swipeToRead?: boolean;
  /** The Chat open beside the list in a split window. */
  selected?: boolean;
};

const AVATAR_SIZE = LIST_AVATAR_SIZE;
const BRANCH_COLUMN = 16;
const TREE_STEP = 12;

function railX(level: number, showSpace: boolean) {
  return (showSpace ? AVATAR_SIZE / 2 - 0.5 : 3.5) + (level - 1) * TREE_STEP;
}

export function SessionRow({ session, onPress, onPressIn, onLongPress, labels = [], showSpace = true, fork = null, tree = null, swipeToRead = true, selected = false }: SessionRowProps) {
  const { t } = useTranslation();
  // Only this Chat's status inputs; token batches keep the live stream's identity and phase.
  const { status, latestTurn, liveTurnId, liveStatus, spaceName: canonicalName, spaceAvatarUrl } = useAppSelector(({ state }) => {
    const live = state.sessionViews[session.id]?.stream;
    const spaceId = session.space?.id;
    const canonicalSpace = spaceId ? state.spaces.find((space) => space.id === spaceId) : undefined;
    return {
      status: sessionListStatus(session, state.sessionLatestTurns[session.id], state.sessionTurnStatuses),
      latestTurn: state.sessionLatestTurns[session.id],
      liveTurnId: live?.turnId ?? null,
      liveStatus: live?.status ?? null,
      spaceName: canonicalSpace?.name?.trim() || session.space?.name?.trim() || "",
      spaceAvatarUrl: canonicalSpace?.publicProfile?.avatarUrl ?? session.space?.publicProfile?.avatarUrl ?? null,
    };
  }, shallowEqual);
  const { markSessionSeen, markSessionUnread, setSessionArchived } = useAppActions();
  const toast = useToast();
  const unreadMark = useAppSelector((app) => isSessionUnread(session, app.sessionSeen));
  // The running label shows elapsed minutes, which used to advance only with unrelated app re-renders.
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (status !== "running") return;
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [status]);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const spaceName = canonicalName || t("space.fallbackName");
  const activity = sessionActivity(session, { status, latestTurn, live: liveStatus ? { turnId: liveTurnId, status: liveStatus } : null, t });
  const glyph = status === "running" || status === "failed" || status === "stopped" ? status : null;
  // A running Chat already shows its ring; the dot arrives once the agent has finished.
  const unread = unreadMark && glyph !== "running";
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
        <AvatarStatus status={glyph} size={AVATAR_SIZE}><Avatar name={spaceName} uri={spaceAvatarUrl} size={AVATAR_SIZE} /></AvatarStatus>
      </View>
      : null;
  // Rows without an avatar carry state as a leading title icon instead of the avatar ring; a fork keeps its cue beside it.
  const statusIcon = glyph && (branch || !showSpace)
    ? <AppIcon name={glyph === "running" ? "sync" : glyph === "failed" ? "alert" : "stop"} size={14} tone={glyph === "running" ? "accent" : glyph === "failed" ? "danger" : "muted"} />
    : null;
  const forkIcon = fork && !branch ? <AppIcon name="git-fork" size={14} tone="faint" /> : null;
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
  const age = useRelativeTime(session.lastMessageAt ?? session.updatedAt);
  const toggleRead = () => {
    const write = unread ? markSessionSeen(session.id, session.lastMessageId) : markSessionUnread(session.id);
    void write.catch(() => toast({ title: t("session.readState.saveFailed"), tone: "danger" }));
  };
  const readAction = unread
    ? { icon: "check-check", title: t("session.markRead"), onPress: toggleRead } as const
    : { icon: "message-square", title: t("session.markUnread"), onPress: toggleRead } as const;
  const archived = Boolean(session.archivedAt);
  // The server refuses to archive a running Chat; restoring one is always allowed.
  const canToggleArchive = archived || status !== "running";
  const toggleArchive = () => {
    void setSessionArchived(session, !archived).catch((error: unknown) => toast({ title: t("session.archive.failed"), message: error instanceof Error ? error.message : undefined, tone: "danger" }));
  };
  const archiveAction = { icon: "archive", title: archived ? t("session.unarchive") : canToggleArchive ? t("session.archive") : t("session.archive.running"), disabled: !canToggleArchive, onPress: toggleArchive } as const;
  const actions = [{ icon: "arrow-right", title: t("common.open"), onPress }, readAction, archiveAction] as const;
  // Mail toggles read from the leading edge and archives from the trailing one; labels stay short to fit.
  const readSwipe = swipeToRead ? [{ icon: readAction.icon, label: unread ? t("session.read") : t("session.unread"), tone: "accent", onPress: toggleRead } as const] : [];
  const archiveSwipe = swipeToRead && canToggleArchive ? [{ icon: "archive", label: archived ? t("session.unarchive.short") : t("session.archive.short"), tone: "neutral", onPress: toggleArchive } as const] : [];
  const peekPreview = { title, subtitle: showSpace ? spaceName : undefined, body: previewText(latestTurn?.assistantText || turnText || session.latestMessageText, 600) || detail || undefined, footnote: statusLabel ?? age };
  const row = <ListRow
    leading={leading}
    compact={branch}
    title={title}
    titlePrefix={titlePrefix}
    meta={age}
    subtitle={subtitleNode}
    trailing={shownLabels.length ? <View className="flex-row gap-1">{shownLabels.map((label) => <Tag key={label.id} label={label.name} tone={label.system ? "info" : "accent"} />)}</View> : null}
    // A fork tree reads as one item: its guide lines run unbroken and only its end draws a separator.
    group={!tree ? "single" : tree.depth === 0 ? (tree.lastInGroup ? "single" : "first") : tree.lastInGroup ? "last" : "middle"}
    unread={unread}
    selected={selected}
    accessibilityLabel={[t("ui.openNamed", { name: title }), unread ? t("session.unread") : null, statusLabel, forkLabel, ...labels.map((label) => label.name)].filter(Boolean).join(", ")}
    accessibilityActions={[{ name: "toggleRead", label: readAction.title }, ...(canToggleArchive ? [{ name: "toggleArchive", label: archiveAction.title }] : [])]}
    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "toggleRead") toggleRead(); else if (event.nativeEvent.actionName === "toggleArchive") toggleArchive(); }}
    onPress={() => { traceAction("session_row", { session: debugAlias("session", session.id), status }); onPress(); }}
    onPressIn={onPressIn}
    onLongPress={!peek ? onLongPress : nativeContextMenus ? () => undefined : (event) => { const { pageX, pageY } = event.nativeEvent; haptics.longPress(); setMenuAt({ x: pageX, y: pageY }); }}
  />;
  if (!peek) return onLongPress ? <SwipeActions trailing={[{ icon: "tag", label: t("labels.title"), tone: "neutral", onPress: onLongPress }]}>{row}</SwipeActions> : row;
  if (nativeContextMenus) return <SwipeActions leading={readSwipe} trailing={archiveSwipe}><NativeContextMenu menu="session-row" actions={actions} preview={peekPreview}>{row}</NativeContextMenu></SwipeActions>;
  return <>
    <SwipeActions leading={readSwipe} trailing={archiveSwipe}>{row}</SwipeActions>
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
    className="min-h-11 flex-row items-center gap-2 border-border pr-4 active:bg-surface-pressed"
    style={{ paddingLeft: 16 + (showSpace ? AVATAR_SIZE + 12 : 0), borderBottomWidth: StyleSheet.hairlineWidth }}
  >
    <AppIcon name={expanded ? "chevron-up" : "chevron-down"} size={16} tone="accent" />
    <Text numberOfLines={1} className="text-caption font-semibold text-accent">{label}</Text>
  </Pressable>;
}
