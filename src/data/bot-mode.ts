import { isModelThinkingLevel, readSessionTurnOrigin, type ContentBlock, type MessageRecord, type SessionRecord, type SessionTurnRecord, type SpaceRecord } from "@neta-art/cohub";
import type { ChatModelCatalogItem, ChatModelSelection } from "./types";

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
 * The Space of the Bot that wrote a note into a Bot's Chat, which the server records as the note's `meta.origin`:
 * the Bot's own for its `say`, another Bot's for its `tell`. The user's own notes have none. `sourceTurnId`
 * cannot tell them apart: the timeline fills it with each Turn's own id.
 */
export function botNoteSpace(turn: Pick<SessionTurnRecord, "executionKind" | "meta"> | null | undefined): string | null {
  return turn?.executionKind === "note" ? readSessionTurnOrigin(turn.meta)?.spaceId ?? null : null;
}

/**
 * The writer of a row on a Bot's page: its Turn decides once loaded. Before that, a cached row still carries the Turn's
 * meta (`messagesFromTurns` copies it), origin included; a Bot's page holds only notes, so the origin names the writer.
 */
export function botMessageSpace(message: Pick<MessageRecord, "meta">, turn: Pick<SessionTurnRecord, "executionKind" | "meta"> | null | undefined): string | null {
  return turn ? botNoteSpace(turn) : readSessionTurnOrigin(message.meta)?.spaceId ?? null;
}

/** Another Bot that wrote on this Bot's page; `known` is false when its Space is not loaded, so only a generic name shows. */
export type BotSender = { name: string; avatarUrl: string | null; known: boolean };
/** The face beside another Bot's name above its bubble. */
export const BOT_SENDER_AVATAR_SIZE = 20;

/** Null when the page's own Bot wrote it. */
export function botSender(peers: ReadonlyMap<string, BotPeer>, writer: string, pageSpaceId: string, unknownName: string): BotSender | null {
  if (writer === pageSpaceId) return null;
  const peer = peers.get(writer);
  return peer ? { ...peer, known: true } : { name: unknownName, avatarUrl: null, known: false };
}

/** The newest thing a Bot said in a page of the user's Chat, as a Bots row shows it; `from` is another Bot's Space. */
export type BotNote = { text: string; at: string; messageId: string; from: string | null };

export function latestBotNote(turns: readonly SessionTurnRecord[], spaceId: string): BotNote | null {
  const turn = turns.filter((turn) => botNoteSpace(turn) !== null).reduce<SessionTurnRecord | null>((latest, item) => !latest || item.sequence > latest.sequence ? item : latest, null);
  if (!turn) return null;
  const text = turn.userText ?? botReplyBlocks(turn.userContent).flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
  const from = botNoteSpace(turn);
  // The id the Chat's messages carry, so read state compares like any Chat's.
  return { text, at: turn.createdAt, messageId: `${turn.id}:user`, from: from === spaceId ? null : from };
}

/** The model saved in a Bot's `bot.json`; it travels with the Bot, so the app and the bot mod read one value. */
export function botModelFrom(raw: Record<string, unknown> | null | undefined): ChatModelSelection | null {
  const value = raw?.model;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { provider, id, thinkingLevel } = value as Record<string, unknown>;
  if (typeof provider !== "string" || !provider.trim() || typeof id !== "string" || !id.trim()) return null;
  return {
    provider: provider.trim(),
    id: id.trim(),
    ...(typeof thinkingLevel === "string" && isModelThinkingLevel(thinkingLevel) ? { thinkingLevel } : {}),
  };
}

/** The context window saved in a Bot's `bot.json`; null is no choice, so the default applies. */
export function botContextWindowFrom(raw: Record<string, unknown> | null | undefined): number | null {
  const value = raw?.contextWindow;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The window a Bot's turns get: its saved choice capped at its model's window, as the platform caps a prompt's.
 * A model the catalog does not have, or one whose window is only the platform's assumption, caps nothing.
 */
export function botContextWindow(saved: number, model: ChatModelSelection | null | undefined, models: readonly ChatModelCatalogItem[]): number {
  const entry = model ? models.find((item) => item.provider === model.provider && item.id === model.id)?.model : null;
  // The platform's cap comes first: the user's own catalog may set `contextWindow` below it.
  const limit = entry?.contextWindowSource === "default" ? null : entry?.contextWindowLimit ?? entry?.contextWindow;
  return typeof limit === "number" && limit > 0 ? Math.min(saved, limit) : saved;
}

/** The model a Turn ran with, for a Bot page with no saved choice: its working Chat is the truth. */
export function turnModelSelection(turn: { provider?: string | null; model?: string | null; meta?: unknown } | null | undefined): ChatModelSelection | null {
  if (!turn?.model) return null;
  const level = turn.meta && typeof turn.meta === "object" && !Array.isArray(turn.meta)
    ? (turn.meta as Record<string, unknown>).requestedThinkingLevel
    : null;
  return {
    provider: turn.provider || "cohub",
    id: turn.model,
    ...(typeof level === "string" && isModelThinkingLevel(level) ? { thinkingLevel: level } : {}),
  };
}

/** What reaches the Bot's working Chat: the user's message with the bot mod's reminder after a blank line. */
export function relayContent(content: readonly ContentBlock[], reminder: string | null): ContentBlock[] {
  if (!reminder) return [...content];
  const index = content.reduce((last, block, position) => block.type === "text" ? position : last, -1);
  if (index < 0) return [...content, { type: "text", text: reminder }];
  return content.map((block, position) => position === index && block.type === "text" ? { ...block, text: `${block.text}\n\n${reminder}` } : block);
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

/** A Bot's page shows the time again on a new day or after this long without a message. */
export const BOT_TIME_GAP_MS = 15 * 60_000;
/** Each bubble row's own top and bottom padding on a Bot's page, so two bubbles from one side sit 4 apart. */
export const BOT_BUBBLE_INSET = 2;
/** Added above a bubble whose writer differs from the one before it: 4 + 8 = 12 between them. */
export const BOT_TURN_GAP = 8;

/** Where a message sits on a Bot's page: the time row above it, if any, and the space added above it otherwise. */
export type BotPlacement = { time: string | null; gap: number };

/** `writer` is the Space of the Bot that wrote a message, or null for the user. */
export function botPlacements<M extends { createdAt?: string | null }>(messages: readonly M[], writer: (message: M) => string | null): BotPlacement[] {
  let previous: { at: number; writer: string | null } | null = null;
  return messages.map((message) => {
    const at = Date.parse(message.createdAt ?? "");
    const by = writer(message);
    const time = Number.isFinite(at) && (!previous || !Number.isFinite(previous.at) || at - previous.at >= BOT_TIME_GAP_MS || new Date(at).toDateString() !== new Date(previous.at).toDateString()) ? message.createdAt! : null;
    const gap = time || !previous || previous.writer === by ? 0 : BOT_TURN_GAP;
    previous = { at, writer: by };
    return { time, gap };
  });
}
