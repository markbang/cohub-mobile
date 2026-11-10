import type { ContentBlock, SessionRecord, SpaceRecord } from "@neta-art/cohub";

export const PRIMARY_BOT_SLUG = "cohubbot";

export type BotSpace = Pick<SpaceRecord, "id" | "slug"> & Partial<Pick<SpaceRecord, "name" | "title" | "publicProfile" | "lastActivityAt" | "updatedAt">>;
export type BotSession = Pick<SessionRecord, "id" | "spaceId" | "title" | "latestMessageText" | "lastMessageAt" | "updatedAt">;

/** Who another Bot is, as a message from it shows them. */
export type BotPeer = { name: string; avatarUrl: string | null };

/** A Bot's Chat reads like messaging: only what the Bot wrote and showed, never its tools or notes. */
export function botReplyBlocks(content: readonly ContentBlock[] | null | undefined): ContentBlock[] {
  return (content ?? []).filter((block) => (block.type === "text" && block.text.trim().length > 0) || block.type === "image");
}

/** A Bot is a Space with the bot mod; its slug is how the app recognizes it without reading mods. */
export function isBotSpace(space: { slug?: string | null } | null | undefined) {
  const slug = space?.slug;
  return slug === PRIMARY_BOT_SLUG || Boolean(slug?.startsWith(`${PRIMARY_BOT_SLUG}-`));
}

/** Two reads of one Chat: the copy updated later wins, so a slower list read never undoes a newer event. */
export function newerSession<S extends Pick<BotSession, "updatedAt">>(left: S | null | undefined, right: S | null | undefined): S | null {
  if (!left || !right) return left ?? right ?? null;
  return Date.parse(right.updatedAt) > Date.parse(left.updatedAt) ? right : left;
}

function activityAt(space: BotSpace, session: Pick<BotSession, "lastMessageAt" | "updatedAt"> | null) {
  if (session) return Math.max(Date.parse(session.updatedAt) || 0, Date.parse(session.lastMessageAt ?? "") || 0);
  return Date.parse(space.lastActivityAt ?? space.updatedAt ?? "") || 0;
}

export type BotEntry<P extends BotSpace, S extends BotSession> = { space: P; session: S | null; running: boolean };

/** One row per Bot, its Chat the only one it has: the primary Bot first, the rest by latest activity. */
export function botEntries<P extends BotSpace, S extends BotSession>(spaces: readonly P[], sessions: ReadonlyMap<string, S | null>, running: ReadonlySet<string>): BotEntry<P, S>[] {
  return spaces.map((space) => ({ space, session: sessions.get(space.id) ?? null, running: running.has(space.id) }))
    .sort((left, right) => {
      const primary = Number(right.space.slug === PRIMARY_BOT_SLUG) - Number(left.space.slug === PRIMARY_BOT_SLUG);
      return primary || activityAt(right.space, right.session) - activityAt(left.space, left.session);
    });
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
