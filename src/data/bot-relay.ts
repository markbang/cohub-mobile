import type { CohubClient, ContentBlock } from "@neta-art/cohub";
import { BOT_MOD_SPACE_ID } from "@/src/config";
import { relayContent } from "./bot-mode";
import { steerQueuedFollowup } from "./followup-queue";
import type { ChatModelSelection } from "./types";

let reminder: Promise<string | null> | null = null;

/** The bot mod's per-turn reminder, read once per launch; without it the message goes as typed. */
export function loadBotReminder(client: CohubClient): Promise<string | null> {
  reminder ??= client.space(BOT_MOD_SPACE_ID).files.read("reminder.txt").then((file) => ("content" in file && file.content.trim()) || null, () => null);
  return reminder;
}

/**
 * Hands what the user wrote in the Bot's Chat to the Chat the Bot works in. While a Turn runs there the
 * message is steered into it, so the Bot hears it after its current tool call instead of after the run.
 * Resolves true when the steer was refused and the message waits for the run to end.
 */
export async function relayToBot(client: CohubClient, input: { spaceId: string; sessionId: string; content: readonly ContentBlock[]; reminder: string | null; model: ChatModelSelection | null; contextWindow: number }): Promise<boolean> {
  const { spaceId, sessionId, model } = input;
  const response = await client.space(spaceId).prompt({
    mode: "agent",
    sessionId,
    content: relayContent(input.content, input.reminder),
    source: "web",
    accessMode: "full_access",
    intent: "followup",
    schedule: { mode: "immediate" },
    harness: "cohub",
    contextWindow: input.contextWindow,
    ...(model ? { model: model.id, provider: model.provider, ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}) } : {}),
  });
  if (response.mode !== "immediate" || response.turn.status !== "queued") return false;
  try {
    await steerQueuedFollowup(client, spaceId, sessionId, response.turn.id);
    return false;
  } catch {
    return true;
  }
}
