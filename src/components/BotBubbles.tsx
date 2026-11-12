import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { BubbleContentWidth } from "@/src/components/BubbleText";
import { BubbleContext, MessageContent } from "@/src/components/MessageContent";
import { BOT_BUBBLE_INSET, BOT_EXCHANGE_AVATAR_SIZE, botExchangeText, botReplyBlocks, type BotExchange, type BotPeer } from "@/src/data/bot-mode";
import { formatThreadTime } from "@/src/data/chat-format";
import { useTranslation } from "@/src/i18n";
import { getActiveLocale } from "@/src/i18n/core";
import { loops } from "@/src/motion";
import { useAppTheme } from "@/src/theme";
import { AppIcon, Avatar } from "@/src/ui";
import { BUBBLE_PADDING_X, getBubbleMaxWidth } from "@/src/ui/message-bubble-layout";
import { usePaneWidth } from "@/src/ui/pane";
import { previewText } from "@/src/utils";

/** What a Bot says to the user: its words and images, on the left like a messaging app. `nodes.ts` draws the same row for the native timeline. */
export function BotNoteBubble({ message, spaceId, availableWidth }: { message: MessageRecord; spaceId: string | null; availableWidth?: number }) {
  const theme = useAppTheme();
  const paneWidth = usePaneWidth();
  const maxWidth = getBubbleMaxWidth(availableWidth ?? paneWidth);
  const environment = useMemo(() => ({ onUser: false, spaceId }), [spaceId]);
  const blocks = botReplyBlocks(message.content);
  const content: ContentBlock[] = blocks.length ? blocks : message.text?.trim() ? [{ type: "text", text: message.text }] : [];
  if (content.length === 0) return null;
  return <View className="w-full items-start px-3" style={{ paddingVertical: BOT_BUBBLE_INSET }}>
    <BubbleContext.Provider value={environment}><BubbleContentWidth.Provider value={Math.max(0, maxWidth - BUBBLE_PADDING_X * 2)}>
      <View className="min-w-0 bg-assistant-bubble" style={{ maxWidth, borderRadius: theme.radius.md, borderCurve: "continuous", paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 }}>
        <MessageContent content={content} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} sandboxImages />
      </View>
    </BubbleContentWidth.Provider></BubbleContext.Provider>
  </View>;
}

/** How many characters of a message between Bots its two closed lines can show, on the widest pane. */
const BOT_EXCHANGE_PREVIEW = 280;

/**
 * A message between two Bots, apart from what a Bot says to the user: no bubble, small type, two lines until it is
 * tapped. The line above says who told whom, so a request and its report read as there and back; the face is the
 * Bot at the other end and opens it. `nodes.ts` draws the same row for the native timeline.
 */
export function BotExchangeRow({ exchange, bot, peer, spaceId, availableWidth, onOpenBot }: { exchange: BotExchange; bot: BotPeer; peer: BotPeer | null; spaceId: string | null; availableWidth?: number; onOpenBot: (spaceId: string) => void }) {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const paneWidth = usePaneWidth();
  const [open, setOpen] = useState(false);
  const maxWidth = getBubbleMaxWidth(availableWidth ?? paneWidth);
  const environment = useMemo(() => ({ onUser: false, spaceId }), [spaceId]);
  if (exchange.content.length === 0) return null;
  const name = peer?.name ?? t("bots.otherBot");
  const direction = t("bots.exchange", exchange.outgoing ? { from: bot.name, to: name } : { from: name, to: bot.name });
  const preview = previewText(botExchangeText(exchange), BOT_EXCHANGE_PREVIEW);
  // The rule drops from the middle of the face; the words line up with the names beside it.
  const indent = BOT_EXCHANGE_AVATAR_SIZE + 6;
  const face = <Avatar name={name} uri={peer?.avatarUrl} size={BOT_EXCHANGE_AVATAR_SIZE} />;
  return <View className="w-full items-start px-3" style={{ paddingVertical: BOT_BUBBLE_INSET }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={preview ? `${direction}: ${preview}` : direction} onPress={() => setOpen((value) => !value)} className="min-w-0 active:opacity-70" style={{ maxWidth }}>
      <View className="flex-row items-center gap-1.5">
        {peer ? <Pressable accessibilityRole="button" accessibilityLabel={t("ui.openNamed", { name })} hitSlop={10} onPress={() => onOpenBot(exchange.peer)} className="active:opacity-70">{face}</Pressable> : face}
        <Text numberOfLines={1} className="shrink text-caption text-fg-muted">{direction}</Text>
        <AppIcon name={open ? "chevron-down" : "chevron-right"} size={14} tone="faint" />
      </View>
      <View className="mt-1 border-l border-border" style={{ marginLeft: BOT_EXCHANGE_AVATAR_SIZE / 2, paddingLeft: indent - BOT_EXCHANGE_AVATAR_SIZE / 2 - 1, gap: 4 }}>
        {open
          ? <BubbleContext.Provider value={environment}><BubbleContentWidth.Provider value={Math.max(0, maxWidth - indent)}>
            <MessageContent content={exchange.content} color={theme.colors.textSecondary} imageMaxWidth={maxWidth - indent} sandboxImages />
          </BubbleContentWidth.Provider></BubbleContext.Provider>
          : <Text numberOfLines={2} className="text-caption font-normal text-fg-secondary">{preview}</Text>}
      </View>
    </Pressable>
  </View>;
}

/** The centered time above a message on a Bot's page. */
export function BotTimeDivider({ at }: { at: string }) {
  const { t } = useTranslation();
  return <Text className="self-center px-3 pb-2 pt-3 text-caption text-fg-faint tabular-nums">{formatThreadTime(at, t, getActiveLocale())}</Text>;
}

const DOT_BREATH = { "0%": { opacity: 0.35 }, "30%": { opacity: 1 }, "60%": { opacity: 0.35 }, "100%": { opacity: 0.35 } };

/** The Bot is working on what it was asked: three dots on its side until it says something. */
export function BotTyping() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  return <View className="w-full flex-row px-3 pb-1">
    <View accessible accessibilityLabel={t("bots.typing")} className="flex-row items-center gap-1 px-1" style={{ height: 28 }}>
      {[0, 1, 2].map((index) => <Animated.View key={index} className="size-2 rounded-full bg-fg-muted" style={reduced ? { opacity: 0.6 } : { animationName: DOT_BREATH, animationDuration: loops.typingDots.duration, animationDelay: index * loops.typingDots.stagger, animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }} />)}
    </View>
  </View>;
}
