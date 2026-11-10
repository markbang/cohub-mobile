import type { CohubClient } from "@neta-art/cohub";
import { BOT_MOD_SPACE_ID } from "@/src/config";

const PRIMARY_BOT_SLUG = "cohubbot";
const BOT_PERSONA_PATH = ".agents/APPEND_SYSTEM.md";
export const PRIMARY_BOT_PERSONA = `# Cohub

Role: primary
Job: The user's main point of contact; takes new work and coordinates the other Bots.
`;

export type PrimaryBotResult =
  | { status: "created"; spaceId: string }
  | { status: "ready"; spaceId: string; modEnabled: boolean }
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

async function settleExisting(client: CohubClient, spaceId: string): Promise<PrimaryBotResult> {
  const { items } = await client.space(spaceId).mods.list();
  const mod = items.find((item) => item.modSpaceId === BOT_MOD_SPACE_ID);
  // A same-slug Space without the bot mod belongs to the user; leave it untouched.
  if (!mod) return { status: "conflict", spaceId };
  try {
    await client.space(spaceId).files.read(BOT_PERSONA_PATH);
  } catch (error) {
    if (httpStatus(error) !== 404) throw error;
    await writePersona(client, spaceId);
  }
  return { status: "ready", spaceId, modEnabled: mod.enabled };
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
    return { status: "created", spaceId };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message ? error.message : String(error) };
  }
}
