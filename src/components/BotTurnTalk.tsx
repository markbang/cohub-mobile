import type { CohubClient, SessionTurnRecord } from "@neta-art/cohub";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { BotTalkBubbles } from "@/src/components/BotBubbles";
import { turnStepsQuery } from "@/src/components/TurnProcess";
import { intermediateBlocks, processTexts } from "@/src/data/bot-mode";
import { answerBlocks } from "@/src/data/chat-rendering";
import { useSessionStream } from "@/src/data/context";
import { contentText } from "@/src/utils";

/** The finished reply's text, which a process segment must not repeat. */
export function turnReplyText(turn: Pick<SessionTurnRecord, "assistantContent" | "assistantText">) {
  return contentText(answerBlocks(turn.assistantContent ?? [])) || turn.assistantText || "";
}

/** What a Bot said between tool calls in one Turn, each segment as its own bubble above the final one. */
export function BotTurnTalk({ sessionId, turn, client, spaceId, live, availableWidth }: { sessionId: string; turn: SessionTurnRecord | null; client: CohubClient | null; spaceId: string; live: boolean; availableWidth?: number }) {
  if (live) return <LiveTalk sessionId={sessionId} turn={turn} client={client} spaceId={spaceId} availableWidth={availableWidth} />;
  return turn ? <ArchivedTalk turn={turn} client={client} spaceId={spaceId} availableWidth={availableWidth} /> : null;
}

function LiveTalk({ sessionId, turn, client, spaceId, availableWidth }: { sessionId: string; turn: SessionTurnRecord | null; client: CohubClient | null; spaceId: string; availableWidth?: number }) {
  const stream = useSessionStream(sessionId);
  const current = stream !== null && (turn === null || stream.turnId === turn.id);
  const messages = current ? stream.intermediateMessages : null;
  const reply = current ? contentText(answerBlocks(stream.contentBlocks)) : "";
  const texts = useMemo(() => messages ? processTexts(intermediateBlocks(messages), reply) : [], [messages, reply]);
  if (!current) return turn ? <ArchivedTalk turn={turn} client={client} spaceId={spaceId} availableWidth={availableWidth} /> : null;
  return <BotTalkBubbles texts={texts} availableWidth={availableWidth} />;
}

/** Reads the archived steps only once the row mounts, i.e. once the list brings the Turn near view. */
function ArchivedTalk({ turn, client, spaceId, availableWidth }: { turn: SessionTurnRecord; client: CohubClient | null; spaceId: string; availableWidth?: number }) {
  const archived = Boolean(turn.intermediateSummary?.messageCount && turn.intermediateIndex?.messagesObjectKey);
  const steps = useQuery({ ...turnStepsQuery(client, spaceId, turn), enabled: archived && Boolean(client) });
  const texts = useMemo(() => steps.data ? processTexts(steps.data, turnReplyText(turn)) : [], [steps.data, turn]);
  return <BotTalkBubbles texts={texts} availableWidth={availableWidth} />;
}
