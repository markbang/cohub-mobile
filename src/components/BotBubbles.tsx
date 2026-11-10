import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { BubbleContentWidth } from "@/src/components/BubbleText";
import { BubbleContext, MessageContent } from "@/src/components/MessageContent";
import { botReplyBlocks, type BotPeer } from "@/src/data/bot-mode";
import { formatMessageClock } from "@/src/data/chat-format";
import { thinkingBlocks } from "@/src/data/chat-rendering";
import type { RelatedSessionRef } from "@/src/data/related-sessions";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar, MascotLoader } from "@/src/ui";
import { BUBBLE_PADDING_X, getBubbleMaxWidth } from "@/src/ui/message-bubble-layout";
import { usePaneWidth } from "@/src/ui/pane";
import { hasRenderableContent } from "@/src/utils";

const AVATAR_SIZE = 28;

/** The incoming side of a messaging thread; `nodes.ts` draws the same bubble for the native timeline. */
function BotBubble({ children, maxWidth, spaceId = null }: { children: ReactNode; maxWidth: number; spaceId?: string | null }) {
  const theme = useAppTheme();
  const environment = useMemo(() => ({ onUser: false, spaceId }), [spaceId]);
  return <BubbleContext.Provider value={environment}><BubbleContentWidth.Provider value={Math.max(0, maxWidth - BUBBLE_PADDING_X * 2)}>
    <View className="min-w-0 bg-assistant-bubble" style={{ maxWidth, borderRadius: theme.radius.md, borderCurve: "continuous", paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 }}>{children}</View>
  </BubbleContentWidth.Provider></BubbleContext.Provider>;
}

function BotRow({ children }: { children: ReactNode }) {
  return <View className="w-full items-start px-3 py-0.5">{children}</View>;
}

function Clock({ value }: { value?: string | null }) {
  const clock = formatMessageClock(value);
  return clock ? <Text className="mt-0.5 self-end text-micro text-fg-faint tabular-nums">{clock}</Text> : null;
}

function useBubbleWidth(availableWidth?: number) {
  const paneWidth = usePaneWidth();
  return getBubbleMaxWidth(availableWidth ?? paneWidth);
}

/** A Bot's reply is only what it wrote; its steps, model, and usage stay out of the thread. */
export function BotReplyBubble({ message, spaceId, availableWidth }: { message: MessageRecord; spaceId: string | null; availableWidth?: number }) {
  const theme = useAppTheme();
  const maxWidth = useBubbleWidth(availableWidth);
  const blocks = botReplyBlocks(message.content);
  const content: ContentBlock[] = blocks.length ? blocks : thinkingBlocks(message.content).length === 0 && message.text?.trim() ? [{ type: "text", text: message.text }] : [];
  if (content.length === 0 && !message.errorMessage) return null;
  return <BotRow><BotBubble maxWidth={maxWidth} spaceId={spaceId}>
    {content.length ? <MessageContent content={content} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} sandboxImages /> : null}
    {message.errorMessage ? <Text selectable className="text-caption text-danger">{message.errorMessage}</Text> : null}
    <Clock value={message.createdAt} />
  </BotBubble></BotRow>;
}

/** What a Bot said between its steps, each as its own bubble above the final one. */
export function BotTalkBubbles({ texts, availableWidth }: { texts: readonly string[]; availableWidth?: number }) {
  const theme = useAppTheme();
  const maxWidth = useBubbleWidth(availableWidth);
  return <>{texts.map((text, index) => <BotRow key={index}><BotBubble maxWidth={maxWidth}><MessageContent content={[{ type: "text", text }]} color={theme.colors.assistantBubbleText} /></BotBubble></BotRow>)}</>;
}

/** The reply as it is written, or a typing bubble until its first words arrive. */
export function BotStreamBubble({ content, status, availableWidth }: { content: ContentBlock[]; status: string; availableWidth?: number }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const maxWidth = useBubbleWidth(availableWidth);
  const blocks = botReplyBlocks(content);
  const live = status === "pending" || status === "streaming";
  const statusLabel = status === "failed" ? t("message.stream.failed") : status === "interrupted" ? t("message.stream.stopped") : null;
  return <BotRow>
    {blocks.length ? <BotBubble maxWidth={maxWidth}><MessageContent active={live} content={blocks} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} /></BotBubble>
      : live ? <BotBubble maxWidth={maxWidth}><MascotLoader size={22} accessibilityLabel={t("message.stream.starting")} /></BotBubble> : null}
    {statusLabel ? <Text className={`px-1 pt-0.5 text-caption ${status === "failed" ? "text-danger" : "text-fg-muted"}`}>{statusLabel}</Text> : null}
  </BotRow>;
}

/** A message another Bot sent here, with who sent it; the name opens where it came from. */
export function BotIncomingBubble({ message, sender, source, onOpen, availableWidth }: { message: MessageRecord; sender: BotPeer; source: RelatedSessionRef; onOpen: (ref: RelatedSessionRef) => void; availableWidth?: number }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const maxWidth = useBubbleWidth(availableWidth) - AVATAR_SIZE - 8;
  return <View className="w-full flex-row items-end gap-2 px-3 py-0.5">
    <Avatar name={sender.name} uri={sender.avatarUrl} size={AVATAR_SIZE} />
    <BotBubble maxWidth={maxWidth}>
      <Pressable accessibilityRole="link" accessibilityLabel={t("turn.related.open", { title: sender.name })} onPress={() => onOpen(source)} hitSlop={{ top: 8, bottom: 4 }} className="self-start active:opacity-55">
        <Text numberOfLines={1} className="text-caption font-semibold text-accent">{sender.name}</Text>
      </Pressable>
      {hasRenderableContent(message.content) ? <MessageContent content={message.content} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} /> : message.text?.trim() ? <MessageContent content={[{ type: "text", text: message.text }]} color={theme.colors.assistantBubbleText} /> : null}
      <Clock value={message.createdAt} />
    </BotBubble>
  </View>;
}

/** Where this Bot passed work on, as the other Bots it went to. */
export function BotHandoffList({ sessions, peerOf, onOpen }: { sessions: readonly RelatedSessionRef[]; peerOf: (ref: RelatedSessionRef) => BotPeer; onOpen: (ref: RelatedSessionRef) => void }) {
  const { t } = useTranslation();
  if (sessions.length === 0) return null;
  return <View className="w-full px-3">{sessions.map((session) => {
    const peer = peerOf(session);
    const label = t("turn.related.sentTo", { title: peer.name });
    return <Pressable key={`${session.spaceId}:${session.sessionId}`} accessibilityRole="link" accessibilityLabel={label} onPress={() => onOpen(session)} className="min-h-9 flex-row items-center gap-1.5 self-start px-1 active:opacity-55">
      <Avatar name={peer.name} uri={peer.avatarUrl} size={18} />
      <Text numberOfLines={1} className="shrink text-caption text-fg-muted">{label}</Text>
      <AppIcon name="chevron-right" size={12} tone="faint" />
    </Pressable>;
  })}</View>;
}
