import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import { useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { BubbleContentWidth } from "@/src/components/BubbleText";
import { BubbleContext, MessageContent } from "@/src/components/MessageContent";
import { BOT_BUBBLE_INSET, botReplyBlocks } from "@/src/data/bot-mode";
import { formatThreadTime } from "@/src/data/chat-format";
import { useTranslation } from "@/src/i18n";
import { getActiveLocale } from "@/src/i18n/core";
import { loops } from "@/src/motion";
import { useAppTheme } from "@/src/theme";
import { BUBBLE_PADDING_X, getBubbleMaxWidth } from "@/src/ui/message-bubble-layout";
import { usePaneWidth } from "@/src/ui/pane";

/** What the Bot said with `say`: its words and images, on the left like a messaging app. `nodes.ts` draws the same row for the native timeline. */
export function BotNoteBubble({ message, spaceId, availableWidth }: { message: MessageRecord; spaceId: string | null; availableWidth?: number }) {
  const theme = useAppTheme();
  const paneWidth = usePaneWidth();
  const maxWidth = getBubbleMaxWidth(availableWidth ?? paneWidth);
  const environment = useMemo(() => ({ onUser: false, spaceId }), [spaceId]);
  const blocks = botReplyBlocks(message.content);
  const content: ContentBlock[] = blocks.length ? blocks : message.text?.trim() ? [{ type: "text", text: message.text }] : [];
  if (content.length === 0) return null;
  return <View className="w-full flex-row px-3" style={{ paddingVertical: BOT_BUBBLE_INSET }}>
    <BubbleContext.Provider value={environment}><BubbleContentWidth.Provider value={Math.max(0, maxWidth - BUBBLE_PADDING_X * 2)}>
      <View className="min-w-0 bg-assistant-bubble" style={{ maxWidth, borderRadius: theme.radius.md, borderCurve: "continuous", paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 }}>
        <MessageContent content={content} color={theme.colors.assistantBubbleText} imageMaxWidth={maxWidth - BUBBLE_PADDING_X * 2} sandboxImages />
      </View>
    </BubbleContentWidth.Provider></BubbleContext.Provider>
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
