import type { CohubClient, SessionTurnRecord } from "@neta-art/cohub";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { View } from "react-native";
import { MessageContent } from "@/src/components/MessageContent";
import { turnStepsQuery } from "@/src/components/TurnProcess";
import { intermediateBlocks, processTexts } from "@/src/data/bot-mode";
import { answerBlocks } from "@/src/data/chat-rendering";
import { useSessionStream } from "@/src/data/context";
import { useAppTheme } from "@/src/theme";
import { REPLY_INSET_X, getReplyRowWidth } from "@/src/ui/message-bubble-layout";
import { usePaneWidth } from "@/src/ui/pane";
import { contentText } from "@/src/utils";

/** The finished reply's text, which a process segment must not repeat. */
export function turnReplyText(turn: Pick<SessionTurnRecord, "assistantContent" | "assistantText">) {
  return contentText(answerBlocks(turn.assistantContent ?? [])) || turn.assistantText || "";
}

/**
 * What a Bot said between tool calls in one Turn, each segment as its own reply above the final one.
 * Tools, results, and thinking stay in the Turn's steps.
 */
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
  return <TalkBubbles texts={texts} availableWidth={availableWidth} />;
}

/** Reads the archived steps only once the row mounts, i.e. once the list brings the Turn near view. */
function ArchivedTalk({ turn, client, spaceId, availableWidth }: { turn: SessionTurnRecord; client: CohubClient | null; spaceId: string; availableWidth?: number }) {
  const archived = Boolean(turn.intermediateSummary?.messageCount && turn.intermediateIndex?.messagesObjectKey);
  const steps = useQuery({ ...turnStepsQuery(client, spaceId, turn), enabled: archived && Boolean(client) });
  const texts = useMemo(() => steps.data ? processTexts(steps.data, turnReplyText(turn)) : [], [steps.data, turn]);
  return <TalkBubbles texts={texts} availableWidth={availableWidth} />;
}

function TalkBubbles({ texts, availableWidth }: { texts: string[]; availableWidth?: number }) {
  const theme = useAppTheme();
  const paneWidth = usePaneWidth();
  if (texts.length === 0) return null;
  const maxWidth = getReplyRowWidth(availableWidth ?? paneWidth);
  return <>{texts.map((text, index) => <View key={index} style={{ width: "100%", maxWidth, paddingHorizontal: REPLY_INSET_X, paddingVertical: 6 }}>
    <MessageContent content={[{ type: "text", text }]} color={theme.colors.assistantBubbleText} />
  </View>)}</>;
}
