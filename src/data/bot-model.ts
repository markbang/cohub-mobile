import type { CohubClient } from "@neta-art/cohub";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { botFileKey } from "./bot-cache";
import { useAppActions } from "./context";
import { saveBotFileCache } from "./local-db";
import type { BotFile } from "./primary-bot";
import type { ChatModelSelection } from "./types";
import { botFileQuery } from "./use-bots";

/**
 * The model a Bot's turns run with, saved in its `.agents/bot.json` so it survives a restart and the bot mod
 * reads the same value. `undefined` is no choice: the page shows the model its working Chat last ran with.
 */
export function useBotModel(client: CohubClient | null, spaceId: string, enabled = true): [ChatModelSelection | undefined, (model: ChatModelSelection | null) => Promise<void>] {
  const { userKey } = useAppActions();
  const queryClient = useQueryClient();
  const query = useQuery({ ...botFileQuery(client, spaceId), enabled: enabled && Boolean(client && spaceId) });
  const model = query.data?.model ?? undefined;
  const choose = useCallback(async (next: ChatModelSelection | null) => {
    if (!enabled || !client || !spaceId) return;
    // Read before writing so a newer session/chat pair or an unrelated field in bot.json is kept.
    const current = await queryClient.fetchQuery({ ...botFileQuery(client, spaceId), staleTime: 0 });
    const raw = { ...current.raw };
    if (next) raw.model = { provider: next.provider, id: next.id, ...(next.thinkingLevel ? { thinkingLevel: next.thinkingLevel } : {}) };
    else delete raw.model;
    const saved: BotFile = { ...current, raw, model: next };
    const previous = queryClient.getQueryData<BotFile>(botFileKey(spaceId));
    queryClient.setQueryData(botFileKey(spaceId), saved, { updatedAt: Date.now() });
    try {
      await client.space(spaceId).files.write({ path: ".agents/bot.json", content: `${JSON.stringify(raw)}\n`, encoding: "utf-8" });
      if (userKey) void saveBotFileCache(userKey, spaceId, saved).catch(() => undefined);
    } catch (error) {
      if (previous) queryClient.setQueryData(botFileKey(spaceId), previous);
      else void queryClient.invalidateQueries({ queryKey: botFileKey(spaceId) });
      throw error;
    }
  }, [client, enabled, queryClient, spaceId, userKey]);
  return [model, choose];
}
