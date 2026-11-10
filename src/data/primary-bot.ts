import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import { BOT_MOD_SPACE_ID } from "@/src/config";
import { PRIMARY_BOT_SLUG } from "./bot-mode";

const BOT_PERSONA_PATH = ".agents/APPEND_SYSTEM.md";
/** Names the Bot's one Chat; the bot mod sends delegated work, reminders, and schedules there too. */
const BOT_SESSION_PATH = ".agents/bot.json";
export const PRIMARY_BOT_PERSONA = `# Cohub

Role: primary
Job: The user's main point of contact; takes new work and coordinates the other Bots.
`;

export type PrimaryBotResult =
  | { status: "created"; spaceId: string; sessionId: string }
  | { status: "ready"; spaceId: string; sessionId: string; modEnabled: boolean }
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

function parseBotSessionFile(text: string): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Reported below with the same message as valid JSON without an id.
  }
  const session = parsed && typeof parsed === "object" ? (parsed as { session?: unknown }).session : null;
  if (typeof session !== "string" || !session) throw new Error("This Bot's .agents/bot.json does not name a Chat. Fix the file in the Bot's files.");
  return session;
}

/** The Chat `bot.json` names, or null when the file is missing or the Chat is gone. Other failures throw. */
export async function readBotSession(client: CohubClient, spaceId: string): Promise<SessionRecord | null> {
  let file;
  try {
    file = await client.space(spaceId).files.read(BOT_SESSION_PATH);
  } catch (error) {
    if (httpStatus(error) === 404) return null;
    throw error;
  }
  const sessionId = parseBotSessionFile("content" in file ? file.content : "");
  const { sessions } = await client.space(spaceId).sessions.list({ ids: [sessionId], archived: "include" });
  return sessions.find((item) => item.id === sessionId) ?? null;
}

async function createBotSession(client: CohubClient, spaceId: string): Promise<SessionRecord> {
  const { session } = await client.space(spaceId).sessions.create();
  await client.space(spaceId).files.write({ path: BOT_SESSION_PATH, content: `${JSON.stringify({ session: session.id })}\n`, encoding: "utf-8" });
  return session;
}

/** The Bot's one Chat, creating it and recording it in `bot.json` when the file is missing or names a deleted Chat. */
export async function ensureBotSession(client: CohubClient, spaceId: string): Promise<SessionRecord> {
  return (await readBotSession(client, spaceId)) ?? createBotSession(client, spaceId);
}

async function settleExisting(client: CohubClient, spaceId: string): Promise<PrimaryBotResult> {
  const { items } = await client.space(spaceId).mods.list();
  const mod = items.find((item) => item.modSpaceId === BOT_MOD_SPACE_ID);
  // A same-slug Space without the bot mod belongs to the user; leave it untouched.
  if (!mod) return { status: "conflict", spaceId };
  // The Chat comes first, so a bot.json read failure leaves the Space exactly as it was.
  const session = await ensureBotSession(client, spaceId);
  try {
    await client.space(spaceId).files.read(BOT_PERSONA_PATH);
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
    await writePersona(client, spaceId);
  }
  return { status: "ready", spaceId, sessionId: session.id, modEnabled: mod.enabled };
}

/** Makes sure the signed-in account owns the primary Bot Space without overwriting anything it already has. */
export async function ensurePrimaryBot(client: CohubClient): Promise<PrimaryBotResult> {
  try {
    const existing = await findOwnedBot(client);
    if (existing) return await settleExisting(client, existing.id);
    let spaceId: string;
    try {
      const created = await client.spaces.create({
        name: "Cohub",
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
    const session = await createBotSession(client, spaceId);
    return { status: "created", spaceId, sessionId: session.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message ? error.message : String(error) };
  }
}
