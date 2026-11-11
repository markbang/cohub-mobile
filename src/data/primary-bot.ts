import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import { BOT_MOD_SPACE_ID } from "@/src/config";
import { botModelFrom, PRIMARY_BOT_SLUG } from "./bot-mode";
import type { ChatModelSelection } from "./types";

const BOT_PERSONA_PATH = ".agents/APPEND_SYSTEM.md";
/** Names the Bot's working Chat and the Chat the user reads; the bot mod's `say` and fallback hook read it too. */
const BOT_SESSION_PATH = ".agents/bot.json";
const BOT_HOOK_PATH = ".cohub/hooks/bot-fallback.yml";
const PRIMARY_BOT_NAME = "Cohub";
export const PRIMARY_BOT_PERSONA = `# Cohub

Role: primary
Job: The user's main point of contact; takes new work and coordinates the other Bots.
`;

export type PrimaryBotResult =
  | { status: "created"; spaceId: string; sessionId: string; chatId: string }
  | { status: "ready"; spaceId: string; sessionId: string; chatId: string; modEnabled: boolean }
  | { status: "conflict"; spaceId: string }
  | { status: "error"; message: string };

function httpStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : null;
}

async function findOwnedBot(client: CohubClient) {
  try {
    return await client.spaces.getOwnedBySlug(PRIMARY_BOT_SLUG);
  } catch (error) {
    if (httpStatus(error) === 404) return null;
    throw error;
  }
}

function writePersona(client: CohubClient, spaceId: string) {
  return client.space(spaceId).files.write({ path: BOT_PERSONA_PATH, content: PRIMARY_BOT_PERSONA, encoding: "utf-8" });
}

/** Best effort: the list stays in the bot mod, which the sub-Bot creation skill also reads. */
async function setRandomAvatar(client: CohubClient, spaceId: string) {
  try {
    const file = await client.space(BOT_MOD_SPACE_ID).files.read("avatars.json");
    const urls = JSON.parse("content" in file ? file.content : "") as string[];
    await client.space(spaceId).profile({ avatarUrl: urls[Math.floor(Math.random() * urls.length)] });
  } catch {
    return;
  }
}

/** The two Chats a Bot keeps: `session` it works in, `chat` the user reads (the Bot's `say` notes land there). */
export type BotChats = { session: SessionRecord; chat: SessionRecord };
export type BotFile = { raw: Record<string, unknown>; session: SessionRecord | null; chat: SessionRecord | null; model: ChatModelSelection | null };

function parseBotFile(text: string): Record<string, unknown> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Reported below with the same message as JSON that is not an object.
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("This Bot's .agents/bot.json is not valid. Fix the file in the Bot's files.");
  return parsed as Record<string, unknown>;
}

/** `bot.json` and the live Chats it names; a missing file or a deleted Chat reads as null. Other failures throw. */
export async function readBotFile(client: CohubClient, spaceId: string): Promise<BotFile> {
  let raw: Record<string, unknown> = {};
  try {
    const file = await client.space(spaceId).files.read(BOT_SESSION_PATH);
    raw = parseBotFile("content" in file ? file.content : "");
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
  }
  const ids = [raw.session, raw.chat].filter((id): id is string => typeof id === "string" && id.length > 0);
  const { sessions } = ids.length ? await client.space(spaceId).sessions.list({ ids, archived: "include" }) : { sessions: [] };
  const live = (id: unknown) => sessions.find((item) => item.id === id) ?? null;
  return { raw, session: live(raw.session), chat: live(raw.chat), model: botModelFrom(raw) };
}

/** The hook that turns a reply the Bot never `say`s into one, copied from the bot mod as is; skipped when the template cannot be read. */
async function ensureFallbackHook(client: CohubClient, spaceId: string) {
  try {
    await client.space(spaceId).files.read(BOT_HOOK_PATH);
    return;
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
  }
  let template;
  try {
    template = await client.space(BOT_MOD_SPACE_ID).files.read("templates/bot-fallback.yml");
  } catch {
    return;
  }
  if (!("content" in template)) return;
  await client.space(spaceId).files.write({ path: BOT_HOOK_PATH, content: template.content, encoding: "utf-8" });
}

/**
 * Fills in what a Bot is missing: its working Chat, the Chat the user reads (titled "<name> · Chat"), and the
 * fallback hook. Whatever already exists is kept; `bot.json` is rewritten only to add what was created.
 */
export async function ensureBotChats(client: CohubClient, spaceId: string, botName: string): Promise<BotChats> {
  const file = await readBotFile(client, spaceId);
  const session = file.session ?? (await client.space(spaceId).sessions.create()).session;
  const chat = file.chat ?? (await client.space(spaceId).sessions.create({ title: `${botName} · Chat` })).session;
  if (session !== file.session || chat !== file.chat) {
    await client.space(spaceId).files.write({ path: BOT_SESSION_PATH, content: `${JSON.stringify({ ...file.raw, session: session.id, chat: chat.id })}\n`, encoding: "utf-8" });
  }
  await ensureFallbackHook(client, spaceId);
  return { session, chat };
}

async function settleExisting(client: CohubClient, spaceId: string): Promise<PrimaryBotResult> {
  const { items } = await client.space(spaceId).mods.list();
  const mod = items.find((item) => item.modSpaceId === BOT_MOD_SPACE_ID);
  // A same-slug Space without the bot mod belongs to the user; leave it untouched.
  if (!mod) return { status: "conflict", spaceId };
  // The Chats come first, so a bot.json read failure leaves the Space exactly as it was.
  const { session, chat } = await ensureBotChats(client, spaceId, PRIMARY_BOT_NAME);
  try {
    await client.space(spaceId).files.read(BOT_PERSONA_PATH);
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
    await writePersona(client, spaceId);
  }
  return { status: "ready", spaceId, sessionId: session.id, chatId: chat.id, modEnabled: mod.enabled };
}

/** Makes sure the signed-in account owns the primary Bot Space without overwriting anything it already has. */
export async function ensurePrimaryBot(client: CohubClient): Promise<PrimaryBotResult> {
  try {
    const existing = await findOwnedBot(client);
    if (existing) return await settleExisting(client, existing.id);
    let spaceId: string;
    try {
      const created = await client.spaces.create({
        name: PRIMARY_BOT_NAME,
        slug: PRIMARY_BOT_SLUG,
        mods: [{ modSpaceId: BOT_MOD_SPACE_ID, mountSlug: PRIMARY_BOT_SLUG }],
      });
      spaceId = created.space.id;
    } catch (error) {
      // 409: another device created it first, so treat it like any existing Space.
      if (httpStatus(error) !== 409) throw error;
      const raced = await findOwnedBot(client);
      if (!raced) throw error;
      return await settleExisting(client, raced.id);
    }
    await setRandomAvatar(client, spaceId);
    await writePersona(client, spaceId);
    const { session, chat } = await ensureBotChats(client, spaceId, PRIMARY_BOT_NAME);
    return { status: "created", spaceId, sessionId: session.id, chatId: chat.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message ? error.message : String(error) };
  }
}
