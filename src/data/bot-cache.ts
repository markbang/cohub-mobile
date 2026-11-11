import type { QueryClient } from "@tanstack/react-query";
import type { BotNote } from "./bot-mode";
import { loadBotListCache } from "./local-db";
import type { BotFile } from "./primary-bot";

/** A cached `bot.json` names a Bot's Chats and paints its page before the network answers. */
export const BOT_FILE_STALE_MS = 5 * 60_000;
export const BOT_CACHE_STAMP = 1;

export type CachedBot = { file: BotFile; note: BotNote | null };

export const botFileKey = (spaceId: string) => [`bots:${spaceId}:file`] as const;
export const botNoteKey = (spaceId: string, chatId: string | undefined) => [`chats:bots:${spaceId}:said:${chatId}`] as const;

const hydrated = new Set<string>();

/** Seeds every cached Bot row once per account, so a Bot opened from a notification is known without a read. */
export async function hydrateBotCache(queryClient: QueryClient, userKey: string): Promise<void> {
  if (!userKey || hydrated.has(userKey)) return;
  hydrated.add(userKey);
  try {
    const cached = await loadBotListCache<CachedBot>(userKey);
    const at = Date.now();
    for (const [spaceId, row] of cached) {
      if (queryClient.getQueryData(botFileKey(spaceId)) === undefined) queryClient.setQueryData(botFileKey(spaceId), row.file, { updatedAt: at });
      const noteKey = botNoteKey(spaceId, row.file.chat?.id);
      if (queryClient.getQueryData(noteKey) === undefined) queryClient.setQueryData(noteKey, row.note, { updatedAt: BOT_CACHE_STAMP });
    }
  } catch (error) {
    hydrated.delete(userKey);
    throw error;
  }
}
