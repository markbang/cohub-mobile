import type { CohubClient, SessionRecord, SessionTurnRecord } from "@neta-art/cohub";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { sentFrom, sentSessions, type RelatedSessionRef, type RelatedSessionView, type SentSession } from "@/src/data/related-sessions";
import { useRelatedSession } from "@/src/data/use-related-session";
import { useTranslation } from "@/src/i18n";
import { colorWithOpacity, typography, useAppTheme } from "@/src/theme";
import { AppIcon } from "@/src/ui";
import { displaySessionTitle } from "@/src/utils";

export type RelatedSessionLinkProps = {
  client: CohubClient | null;
  lookupSession: (sessionId: string) => SessionRecord | null;
  onOpen: (ref: RelatedSessionRef) => void;
};

const VISIBLE_SENT_SESSIONS = 3;

function relatedTitle(view: RelatedSessionView) {
  return view.status === "ready" ? displaySessionTitle(view.session) : null;
}

function Dot() {
  const theme = useAppTheme();
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colorWithOpacity(theme.colors.accent, 0.7) }} />;
}

export function SentFromLink({ turn, client, lookupSession, onOpen }: RelatedSessionLinkProps & { turn: Pick<SessionTurnRecord, "sessionId" | "meta"> }) {
  const ref = sentFrom(turn);
  return ref ? <SentFromRow sourceRef={ref} client={client} lookupSession={lookupSession} onOpen={onOpen} /> : null;
}

function SentFromRow({ sourceRef, client, lookupSession, onOpen }: RelatedSessionLinkProps & { sourceRef: RelatedSessionRef }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const view = useRelatedSession(client, sourceRef, lookupSession(sourceRef.sessionId));
  const title = relatedTitle(view);
  const unavailable = view.status === "unavailable";
  const label = title ? t("turn.related.from", { title }) : unavailable ? t("turn.related.fromUnavailable") : t("turn.related.fromChat");
  return <View style={{ alignItems: "flex-end", paddingHorizontal: 16, marginTop: 4 }}>
    <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={() => onOpen(sourceRef)} hitSlop={{ top: 6, bottom: 6 }} style={({ pressed }) => ({ maxWidth: "86%", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.55 : 1 })}>
      <Dot />
      <Text numberOfLines={1} style={[typography.caption, { flexShrink: 1, color: unavailable ? theme.colors.textFaint : theme.colors.textMuted }]}>{label}</Text>
      {unavailable ? null : <AppIcon name="chevron-right" size={13} color={theme.colors.textFaint} />}
    </Pressable>
  </View>;
}

export function SentToList({ turn, spaceId, client, lookupSession, onOpen }: RelatedSessionLinkProps & { turn: Pick<SessionTurnRecord, "sessionId" | "meta">; spaceId: string }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const sessions = sentSessions(turn, spaceId);
  if (sessions.length === 0) return null;
  const first = sessions[0];
  if (sessions.length === 1 && first) return <View style={{ marginHorizontal: 18 }}><SentSessionRow session={first} single client={client} lookupSession={lookupSession} onOpen={onOpen} /></View>;
  // Never fold a single leftover row behind a button.
  const collapsed = !expanded && sessions.length > VISIBLE_SENT_SESSIONS + 1;
  const visible = collapsed ? sessions.slice(0, VISIBLE_SENT_SESSIONS) : sessions;
  return <View style={{ marginHorizontal: 18 }}>
    <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Dot />
      <Text style={[typography.caption, { color: theme.colors.textMuted }]}>{t("turn.related.sentCount", { count: sessions.length })}</Text>
    </View>
    <View style={{ marginLeft: 2, borderLeftWidth: 1, borderLeftColor: theme.colors.border, paddingLeft: 12 }}>
      {visible.map((session) => <SentSessionRow key={`${session.spaceId}:${session.sessionId}`} session={session} client={client} lookupSession={lookupSession} onOpen={onOpen} />)}
      {collapsed ? <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.55 : 1 })}>
        <Text style={[typography.caption, { color: theme.colors.accent }]}>{t("turn.related.showMore", { count: sessions.length - VISIBLE_SENT_SESSIONS })}</Text>
      </Pressable> : null}
    </View>
  </View>;
}

function SentSessionRow({ session, single = false, client, lookupSession, onOpen }: RelatedSessionLinkProps & { session: SentSession; single?: boolean }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const view = useRelatedSession(client, session, lookupSession(session.sessionId));
  const title = relatedTitle(view);
  const unavailable = view.status === "unavailable";
  const name = title ?? (unavailable ? t("turn.related.unavailable") : t("turn.related.otherChat"));
  const label = single ? title ? t("turn.related.sentTo", { title }) : unavailable ? t("turn.related.unavailable") : t("turn.related.sentToChat") : name;
  return <Pressable accessibilityRole="link" accessibilityLabel={unavailable ? label : t("turn.related.open", { title: name })} accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={() => onOpen(session)} style={({ pressed }) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.55 : 1 })}>
    {single ? <Dot /> : null}
    <Text numberOfLines={1} style={[typography.caption, { flexShrink: 1, color: unavailable ? theme.colors.textFaint : theme.colors.textSecondary }]}>{label}</Text>
    {session.count > 1 ? <Text style={[typography.caption, { color: theme.colors.textFaint, fontVariant: ["tabular-nums"] }]}>×{session.count}</Text> : null}
    <View style={{ flex: 1 }} />
    {unavailable ? null : <AppIcon name="chevron-right" size={14} color={theme.colors.textFaint} />}
  </Pressable>;
}

export function ForkedFromDivider({ origin, client, lookupSession, onOpen }: RelatedSessionLinkProps & { origin: RelatedSessionRef }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const view = useRelatedSession(client, origin, lookupSession(origin.sessionId));
  const title = relatedTitle(view);
  const unavailable = view.status === "unavailable";
  const label = title ? t("session.forkedFrom", { title }) : unavailable ? t("session.forkedFromUnavailable") : t("session.forkedFromChat");
  const color = unavailable ? theme.colors.textFaint : theme.colors.textMuted;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10 }}>
    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
    <Pressable accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={() => onOpen(origin)} style={({ pressed }) => ({ maxWidth: "78%", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.55 : 1 })}>
      <AppIcon name="git-fork" size={13} color={color} />
      <Text numberOfLines={1} style={[typography.caption, { flexShrink: 1, color }]}>{label}</Text>
      {unavailable ? null : <AppIcon name="chevron-right" size={13} color={theme.colors.textFaint} />}
    </Pressable>
    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
  </View>;
}
