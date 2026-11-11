import type { CohubClient } from "@neta-art/cohub";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { BOT_CONTEXT_WINDOW } from "@/src/config";
import { botFileKey } from "./bot-cache";
import { botContextWindowFrom, botModelFrom } from "./bot-mode";
import { useAppActions } from "./context";
import { saveBotFileCache } from "./local-db";
import type { BotFile } from "./primary-bot";
import type { ChatModelSelection } from "./types";
import { botFileQuery } from "./use-bots";

/**
 * How a Bot's turns run, saved in its `.agents/bot.json` so a choice survives a restart and the bot mod's
 * `tell` reads the same value. One edit changes one field; every other field of the file is kept.
 */
// One save at a time per Bot: each reads the file it is about to rewrite.
const saving = new Map<string, Promise<void>>();

function useBotFile(client: CohubClient | null, spaceId: string, enabled: boolean): [BotFile | undefined, (edit: (raw: Record<string, unknown>) => void) => Promise<void>] {
  const { userKey } = useAppActions();
  const queryClient = useQueryClient();
  const query = useQuery({ ...botFileQuery(client, spaceId), enabled: enabled && Boolean(client && spaceId) });
  const save = useCallback((edit: (raw: Record<string, unknown>) => void) => {
    if (!enabled || !client || !spaceId) return Promise.resolve();
    const run = (saving.get(spaceId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      // Read before writing so a newer session/chat pair or an unrelated field in bot.json is kept.
      const current = await queryClient.fetchQuery({ ...botFileQuery(client, spaceId), staleTime: 0 });
      const raw = { ...current.raw };
      edit(raw);
      const saved: BotFile = { ...current, raw, model: botModelFrom(raw), contextWindow: botContextWindowFrom(raw) };
      queryClient.setQueryData(botFileKey(spaceId), saved, { updatedAt: Date.now() });
      try {
        await client.space(spaceId).files.write({ path: ".agents/bot.json", content: `${JSON.stringify(raw)}\n`, encoding: "utf-8" });
        if (userKey) void saveBotFileCache(userKey, spaceId, saved).catch(() => undefined);
      } catch (error) {
        queryClient.setQueryData(botFileKey(spaceId), current);
        throw error;
      }
    });
    saving.set(spaceId, run);
    return run;
  }, [client, enabled, queryClient, spaceId, userKey]);
  return [query.data, save];
}

/** `undefined` is no choice: the page shows the model the Bot's working Chat last ran with. */
export function useBotModel(client: CohubClient | null, spaceId: string, enabled = true): [ChatModelSelection | undefined, (model: ChatModelSelection | null) => Promise<void>] {
  const [file, save] = useBotFile(client, spaceId, enabled);
  const choose = useCallback((next: ChatModelSelection | null) => save((raw) => {
    if (next) raw.model = { provider: next.provider, id: next.id, ...(next.thinkingLevel ? { thinkingLevel: next.thinkingLevel } : {}) };
    else delete raw.model;
  }), [save]);
  return [file?.model ?? undefined, choose];
}

/** The window the Bot's working Chat compacts at; a Bot without a choice runs at the default. */
export function useBotContextWindow(client: CohubClient | null, spaceId: string): [number, (contextWindow: number) => Promise<void>] {
  const [file, save] = useBotFile(client, spaceId, true);
  const choose = useCallback((next: number) => save((raw) => { raw.contextWindow = next; }), [save]);
  return [file?.contextWindow ?? BOT_CONTEXT_WINDOW, choose];
}
