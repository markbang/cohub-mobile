import { APP_SESSION_SOURCES, readSessionInitiator, resolveSessionSourceKey, type SessionInitiator, type SessionSourceKey } from "@neta-art/cohub";

/** Chats filter by who started a Chat, matching the web Chats picker; `all` lists every Chat. */
export type SessionInitiatorFilter = "all" | SessionInitiator;

/** `null` selects the unfiltered Chats list (no `initiator` query). */
export function sessionInitiatorFilterKeys(filter: SessionInitiatorFilter): readonly SessionInitiator[] | null {
  return filter === "all" ? null : [filter];
}

/** Mirrors the server's Initiator label; a record that carries neither `initiator` nor `meta` reads as a person's. */
export function sessionInitiatorOf(session: { source?: string | null; meta?: unknown; initiator?: unknown }): SessionInitiator {
  return readSessionInitiator(session) ?? "human";
}

/**
 * What a Chats row names besides its title, as the web does: `agent` for a Chat another Agent started,
 * otherwise an entry point other than the Cohub apps (a channel, a schedule, the API); `null` for the rest.
 */
export function sessionAttribution(session: { source?: string | null; meta?: unknown; initiator?: unknown }): "agent" | SessionSourceKey | null {
  if (readSessionInitiator(session) === "agent") return "agent";
  const source = resolveSessionSourceKey(session.source);
  return APP_SESSION_SOURCES.has(source) ? null : source;
}
