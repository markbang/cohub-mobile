import { readSessionTurnOrigin, type ContentBlock, type MessageRecord, type SessionRecord, type SessionTurnRecord, type SpaceRecord } from "@neta-art/cohub";

export const PRIMARY_BOT_SLUG = "cohubbot";

/**
 * A folder a Bot has not written yet is empty, not an error. `known` is false while loading or after
 * a failure, so nothing is called empty that could not be checked.
 */
export function botDirectory<E>(directory: { entries: E[]; loading: boolean; error: Error | null }): { entries: E[]; known: boolean; error: string | null } {
  if ((directory.error as { status?: unknown } | null)?.status === 404) return { entries: [], known: true, error: null };
  return { entries: directory.entries, known: !directory.loading && !directory.error, error: directory.error?.message ?? null };
}

export type BotSpace = Pick<SpaceRecord, "id" | "slug"> & Partial<Pick<SpaceRecord, "name" | "title" | "publicProfile" | "lastActivityAt" | "updatedAt">>;
export type BotSession = Pick<SessionRecord, "id" | "spaceId" | "title" | "latestMessageText" | "lastMessageAt" | "updatedAt">;

/** Who a Bot is, as its messages show it. */
export type BotPeer = { name: string; avatarUrl: string | null };

/** What a Bot shows the user: its words and images, nothing else. */
export function botReplyBlocks(content: readonly ContentBlock[] | null | undefined): ContentBlock[] {
  return (content ?? []).filter((block) => (block.type === "text" && block.text.trim().length > 0) || block.type === "image");
}

/** A Bot is a Space with the bot mod; its slug is how the app recognizes it without reading mods. */
export function isBotSpace(space: { slug?: string | null } | null | undefined) {
  const slug = space?.slug;
  return slug === PRIMARY_BOT_SLUG || Boolean(slug?.startsWith(`${PRIMARY_BOT_SLUG}-`));
}

/**
 * The Bot's `say`: a note written into the user's Chat from one of its working Turns, which the server
 * records as the note's `meta.origin`. The user's own notes have none. `sourceTurnId` cannot tell them
 * apart: the timeline fills it with each Turn's own id.
 */
export function isBotSaid(turn: Pick<SessionTurnRecord, "executionKind" | "meta"> | null | undefined) {
  return turn?.executionKind === "note" && readSessionTurnOrigin(turn.meta) !== null;
}

/** The newest thing the Bot said in a page of the user's Chat, as a Bots row shows it. */
export type BotNote = { text: string; at: string; messageId: string };

export function latestBotNote(turns: readonly SessionTurnRecord[]): BotNote | null {
  const turn = turns.filter(isBotSaid).reduce<SessionTurnRecord | null>((latest, item) => !latest || item.sequence > latest.sequence ? item : latest, null);
  if (!turn) return null;
  const text = turn.userText ?? botReplyBlocks(turn.userContent).flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
  // The id the Chat's messages carry, so read state compares like any Chat's.
  return { text, at: turn.createdAt, messageId: `${turn.id}:user` };
}

/** What reaches the Bot's working Chat: the user's message with the bot mod's reminder after a blank line. */
export function relayContent(content: readonly ContentBlock[], reminder: string | null): ContentBlock[] {
  if (!reminder) return [...content];
  const index = content.reduce((last, block, position) => block.type === "text" ? position : last, -1);
  if (index < 0) return [...content, { type: "text", text: reminder }];
  return content.map((block, position) => position === index && block.type === "text" ? { ...block, text: `${block.text}\n\n${reminder}` } : block);
}

/**
 * A message already in the user's Chat whose delivery to the Bot failed: shown failed, its retry delivers it again.
 * It cannot be deleted like an unsent message, because it is already written.
 */
export function relayFailedMessage(message: MessageRecord, error: string): MessageRecord {
  return { ...message, errorMessage: error, meta: { ...(message.meta ?? {}), sendFailed: true, relayFailed: true } };
}

/** Two reads of one Chat: the copy updated later wins, so a slower list read never undoes a newer event. */
export function newerSession<S extends Pick<BotSession, "updatedAt">>(left: S | null | undefined, right: S | null | undefined): S | null {
  if (!left || !right) return left ?? right ?? null;
  return Date.parse(right.updatedAt) > Date.parse(left.updatedAt) ? right : left;
}

export type BotEntry<P extends BotSpace> = { space: P; note: BotNote | null; chatId: string | null; running: boolean; needsYou: boolean };

/** One row per Bot: the primary Bot first, the rest by the last thing they said (or the Space's own activity before that). */
export function botEntries<P extends BotSpace>(spaces: readonly P[], bots: ReadonlyMap<string, { note: BotNote | null; chatId: string | null }>, running: ReadonlySet<string>, needsYou: ReadonlySet<string>): BotEntry<P>[] {
  const activityAt = (entry: BotEntry<P>) => Date.parse(entry.note?.at ?? entry.space.lastActivityAt ?? entry.space.updatedAt ?? "") || 0;
  return spaces.map((space) => ({ space, note: bots.get(space.id)?.note ?? null, chatId: bots.get(space.id)?.chatId ?? null, running: running.has(space.id), needsYou: needsYou.has(space.id) }))
    .sort((left, right) => {
      const primary = Number(right.space.slug === PRIMARY_BOT_SLUG) - Number(left.space.slug === PRIMARY_BOT_SLUG);
      return primary || activityAt(right) - activityAt(left);
    });
}
