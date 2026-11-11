import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { BubbleContentWidth } from "@/src/components/BubbleText";
import { BubbleContext, MessageContent } from "@/src/components/MessageContent";
import { botReplyBlocks, type BotPeer } from "@/src/data/bot-mode";
import { formatMessageClock } from "@/src/data/chat-format";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { Avatar, MascotLoader } from "@/src/ui";
import { BUBBLE_PADDING_X, getBubbleMaxWidth } from "@/src/ui/message-bubble-layout";
import { usePaneWidth } from "@/src/ui/pane";

const AVATAR_SIZE = 28;

/** The Bot's side of the thread: its face, then its bubble. `nodes.ts` draws the same row for the native timeline. */
function BotLine({ bot, availableWidth, spaceId = null, children }: { bot: BotPeer; availableWidth?: number; spaceId?: string | null; children: (maxWidth: number) => ReactNode }) {
  const theme = useAppTheme();
  const paneWidth = usePaneWidth();
  const maxWidth = getBubbleMaxWidth(availableWidth ?? paneWidth) - AVATAR_SIZE - 8;
  const environment = useMemo(() => ({ onUser: false, spaceId }), [spaceId]);
  return <View className="w-full flex-row items-end gap-2 px-3 py-0.5">
    <Avatar name={bot.name} uri={bot.avatarUrl} size={AVATAR_SIZE} />
    <BubbleContext.Provider value={environment}><BubbleContentWidth.Provider value={Math.max(0, maxWidth - BUBBLE_PADDING_X * 2)}>
      <View className="min-w-0 bg-assistant-bubble" style={{ maxWidth, borderRadius: theme.radius.md, borderCurve: "continuous", paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 }}>{children(maxWidth)}</View>
    </BubbleContentWidth.Provider></BubbleContext.Provider>
  </View>;
}

/** What the Bot said with `say`: its words and images. */
export function BotNoteBubble({ message, bot, spaceId, availableWidth }: { message: MessageRecord; bot: BotPeer; spaceId: string | null; availableWidth?: number }) {
  const theme = useAppTheme();
  const blocks = botReplyBlocks(message.content);
  const content: ContentBlock[] = blocks.length ? blocks : message.text?.trim() ? [{ type: "text", text: message.text }] : [];
  if (content.length === 0) return null;
  const clock = formatMessageClock(message.createdAt);
  return <BotLine bot={bot} availableWidth={availableWidth} spaceId={spaceId}>{(maxWidth) => <>
    <MessageContent content={content} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} sandboxImages />
    {clock ? <Text className="mt-0.5 self-end text-micro text-fg-faint tabular-nums">{clock}</Text> : null}
  </>}</BotLine>;
}

/** The Bot is working on what it was asked: a typing bubble until it says something. */
export function BotTyping({ bot }: { bot: BotPeer }) {
  const { t } = useTranslation();
  return <BotLine bot={bot}>{() => <MascotLoader size={22} accessibilityLabel={t("bots.typing")} />}</BotLine>;
}
