import type { ContentBlock, SessionRecord, SpaceRecord } from "@neta-art/cohub";

export const PRIMARY_BOT_SLUG = "cohubbot";
export const NEEDS_YOU_LABEL = "needs-you";

export type BotSpace = Pick<SpaceRecord, "id" | "slug"> & Partial<Pick<SpaceRecord, "name" | "title" | "publicProfile" | "lastActivityAt" | "updatedAt">>;
export type BotSession = Pick<SessionRecord, "id" | "spaceId" | "title" | "latestMessageText" | "lastMessageAt" | "updatedAt">;

/** A Bot is a Space with the bot mod; its slug is how the app recognizes it without reading mods. */
export function isBotSpace(space: { slug?: string | null } | null | undefined) {
  const slug = space?.slug;
  return slug === PRIMARY_BOT_SLUG || Boolean(slug?.startsWith(`${PRIMARY_BOT_SLUG}-`));
}

/** A rename or a new message both count, so the Chat a Bot opens is the one updated last. */
function sessionAt(session: Pick<BotSession, "lastMessageAt" | "updatedAt">) {
  return Math.max(Date.parse(session.updatedAt) || 0, Date.parse(session.lastMessageAt ?? "") || 0);
}

const byRecent = <T extends Pick<BotSession, "lastMessageAt" | "updatedAt">>(left: T, right: T) => sessionAt(right) - sessionAt(left);

/**
 * Each Bot's Chats, newest first. The Bot's own list decides which Chats it has once it loaded (the
 * cached home rows stand in until then), and a home row updated later replaces that Chat's older copy.
 */
export function botSessionsBySpace<S extends BotSession>(spaceIds: readonly string[], cached: readonly S[], loaded: ReadonlyMap<string, readonly S[]>): Map<string, S[]> {
  const known = new Map(cached.map((session) => [session.id, session]));
  const result = new Map<string, S[]>();
  for (const spaceId of spaceIds) {
    const listed = loaded.get(spaceId);
    const sessions = listed
      ? listed.map((session) => { const home = known.get(session.id); return home && Date.parse(home.updatedAt) > Date.parse(session.updatedAt) ? home : session; })
      : cached.filter((session) => session.spaceId === spaceId);
    result.set(spaceId, [...sessions].sort(byRecent));
  }
  return result;
}

export type BotEntry<P extends BotSpace, S extends BotSession> = { space: P; latest: S | null; running: boolean; needsYou: boolean };

/** The primary Bot first, the rest by their latest Chat (or the Space's own activity before any). */
export function botEntries<P extends BotSpace, S extends BotSession>(spaces: readonly P[], sessionsBySpace: ReadonlyMap<string, readonly S[]>, needsYouBySpace: ReadonlyMap<string, readonly S[]>, runningSpaceIds: ReadonlySet<string>): BotEntry<P, S>[] {
  const activity = (entry: BotEntry<P, S>) => entry.latest ? sessionAt(entry.latest) : Date.parse(entry.space.lastActivityAt ?? entry.space.updatedAt ?? "") || 0;
  return spaces.map((space) => {
    const sessions = sessionsBySpace.get(space.id) ?? [];
    return { space, latest: sessions[0] ?? null, running: runningSpaceIds.has(space.id), needsYou: (needsYouBySpace.get(space.id)?.length ?? 0) > 0 };
  }).sort((left, right) => {
    const primary = Number(right.space.slug === PRIMARY_BOT_SLUG) - Number(left.space.slug === PRIMARY_BOT_SLUG);
    return primary || activity(right) - activity(left);
  });
}

/** Chats labelled `needs-you` across every Bot, newest first, each with the Bot it belongs to. */
export function needsYouItems<P extends BotSpace, S extends BotSession>(spaces: readonly P[], needsYouBySpace: ReadonlyMap<string, readonly S[]>): { space: P; session: S }[] {
  return spaces.flatMap((space) => (needsYouBySpace.get(space.id) ?? []).map((session) => ({ space, session })))
    .sort((left, right) => byRecent(left.session, right.session));
}

/** The blocks of a live Turn's intermediate messages, in order; a message without blocks stands in with its text. */
export function intermediateBlocks(messages: readonly { content: ContentBlock[]; text?: string | null }[]): ContentBlock[] {
  return messages.flatMap((message): ContentBlock[] => message.content.length ? message.content : message.text ? [{ type: "text", text: message.text }] : []);
}

/** What the Bot said between tool calls, one entry per text block; a segment repeating the final reply shows only as the reply. */
export function processTexts(blocks: readonly ContentBlock[], finalText: string): string[] {
  const reply = finalText.trim();
  return blocks.flatMap((block) => block.type === "text" && block.text.trim() && block.text.trim() !== reply ? [block.text.trim()] : []);
}
