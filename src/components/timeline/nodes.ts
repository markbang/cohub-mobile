import type { ContentBlock, MessageRecord, SessionTurnRecord } from "@neta-art/cohub";
import { PixelRatio, Platform, processColor } from "react-native";
import { normalizeMarkdownStyle } from "react-native-enriched-markdown/src/normalizeMarkdownStyle";
import type { TimelineAnimation, TimelineNode, TimelineTextStyle } from "@/modules/cohub-chat-timeline";
import { DETAIL_SEPARATOR, enrichedMarkdownStyle, estimateTextWidth, fitReplyDetails, formatTokenCount, imageUri, replyDetailParts, toolIcon } from "@/src/components/MessageContent";
import { iconPaths, type TimelineIconName } from "@/src/components/timeline/icons";
import { TEXT_FAMILY } from "@/src/ui/platform-fonts";
import { GLYPH_PATHS } from "@/src/ui/glyph-paths";
import { answerBlocks, thinkingBlocks } from "@/src/data/chat-rendering";
import { formatMessageClock, formatThreadTime } from "@/src/data/chat-format";
import { compactionStats, type CompactionInfo } from "@/src/data/compaction";
import { imageThumbnailUrl } from "@/src/data/media";
import { messageMarkdownImages } from "@/src/data/message-links";
import type { RelatedSessionView } from "@/src/data/related-sessions";
import { isFailedSend } from "@/src/data/session-history";
import { toolCallPreview } from "@/src/data/tool-call";
import type { StreamView } from "@/src/data/types";
import { BRAND, MASCOT_PATHS } from "@/src/design/brand";
import type { Translate } from "@/src/i18n";
import { getActiveLocale } from "@/src/i18n/core";
import type { IconName } from "@/src/icons";
import { SF_SYMBOLS } from "@/src/sf-symbols";
import { curves, loops } from "@/src/motion";
import { colorWithOpacity, scaleFontSize, scaleLineHeight, typography, type AppTheme } from "@/src/theme";
import { BUBBLE_PADDING_X, REPLY_INSET_X, REPLY_META_HEIGHT, getBubbleMaxWidth, getReplyContentWidth, getReplyRowWidth } from "@/src/ui/message-bubble-layout";
import { contentText, hasRenderableContent, initials, messageText, previewText } from "@/src/utils";
import { BOT_BUBBLE_INSET, BOT_EXCHANGE_AVATAR_SIZE, botExchangeText, botReplyBlocks, type BotExchange, type BotPeer, type BotPlacement } from "@/src/data/bot-mode";

const MD4C_FLAGS = { underline: false, superscript: false, subscript: false, latexMath: true, highlight: false, hardSoftBreaks: false, preserveBlankLines: false, admonitions: true };
const TOOL_DETAILS_MAX_HEIGHT = 420;
const COMPACTION_SUMMARY_MAX_HEIGHT = 320;
const STEP_RULE = 1;

/** Everything a row's look depends on besides its own data; rebuilt when any of it changes. */
export type NodeContext = {
  theme: AppTheme;
  t: Translate;
  width: number;
  fontScale: number;
  reducedMotion: boolean;
  /** Ids of the expanded disclosures (tool calls, steps, details). */
  expanded: ReadonlySet<string>;
};

const color = (value: string) => processColor(value) as number;

type TextToken = "chatBody" | "caption" | "micro" | "code" | "body";

function textStyle(token: TextToken, colorValue: string, overrides?: Partial<TimelineTextStyle>): TimelineTextStyle {
  const base = typography[token];
  return { fontSize: base.fontSize, lineHeight: base.lineHeight, fontWeight: base.fontWeight, color: color(colorValue), ...(TEXT_FAMILY ? { fontFamily: TEXT_FAMILY } : null), ...overrides };
}

function text(value: string, style: TimelineTextStyle, options?: { numberOfLines?: number; selectable?: boolean; style?: TimelineNode["style"]; id?: string }): TimelineNode {
  return { type: "text", value, text: style, ...options };
}

const LUCIDE_INSET = 24 * (1 / 0.9 - 1) / 2;

/** SF Symbols on iOS; on Android the glyph set drawn after them, or Lucide where it lacks one, as `Glyph` draws them. */
export function icon(name: TimelineIconName, size: number, stroke: string, strokeWidth = 1.9): TimelineNode {
  const symbol = Platform.OS === "ios" ? { symbol: SF_SYMBOLS[name], weight: strokeWidth >= 2.05 ? "semibold" as const : "regular" as const } : null;
  const glyph = symbol ? null : GLYPH_PATHS[name]?.outline;
  // The native vector has no fill rule, so a shape that needs even-odd keeps Lucide.
  if (glyph && !glyph.paths.some((path) => path.evenOdd)) {
    return { type: "vector", viewBox: glyph.viewBox, paths: glyph.paths.map((path) => ({ d: path.d, fill: color(stroke) })), style: { width: size, height: size } };
  }
  // Android draws Lucide to SF Symbols' measure, as `Glyph` does: 0.9 of the extent (a wider viewBox) and 0.7 of the stroke.
  const viewBox: readonly [number, number, number, number] = symbol ? [0, 0, 24, 24] : [-LUCIDE_INSET, -LUCIDE_INSET, 24 + LUCIDE_INSET * 2, 24 + LUCIDE_INSET * 2];
  return { type: "vector", viewBox, paths: symbol ? [] : iconPaths(name).map((d) => ({ d })), stroke: color(stroke), strokeWidth: symbol ? strokeWidth : strokeWidth * 0.7, absoluteStrokeWidth: true, style: { width: size, height: size }, ...symbol };
}

const spin: TimelineAnimation = { property: "rotate", keyframes: [{ at: 0, value: 0 }, { at: 1, value: 360 }], duration: 900, iterations: 0 };
const pulse: TimelineAnimation = { property: "opacity", keyframes: [{ at: 0, value: 1 }, { at: 0.5, value: 0.4 }, { at: 1, value: 1 }], duration: 1200, iterations: 0, easing: [0.42, 0, 0.58, 1] };

/** The spinning "c" of `Loader`; Reduce Motion pulses it instead. */
export function loader(ctx: NodeContext, tint = ctx.theme.colors.accent): TimelineNode {
  return { type: "vector", viewBox: [626, 567, 117, 117], paths: [{ d: MASCOT_PATHS.cheek, fill: color(tint) }], style: { width: 18, height: 18 }, animations: [ctx.reducedMotion ? pulse : spin], accessibilityRole: "progressbar", accessibilityLabel: ctx.t("common.loading") };
}

/** `MascotLoader`: the face bobs and blinks while a reply has not started. */
function mascotLoader(ctx: NodeContext, size: number, label: string): TimelineNode {
  const lift = Math.max(2, Math.round(size * 0.07));
  const viewBox = [160, 147, 716, 716] as const;
  const layer = (paths: { d: string; fill?: number; stroke?: number; strokeWidth?: number }[], animations?: TimelineAnimation[]): TimelineNode => ({ type: "vector", viewBox, paths, style: { position: "absolute", top: 0, left: 0, width: size, height: size }, animations });
  const ink = color(BRAND.ink);
  const cycle = loops.blinkGaps.reduce((total, gap) => total + gap + loops.blink.duration, 0);
  const blink = (shut: boolean): TimelineAnimation => {
    const frames: { at: number; value: number }[] = [{ at: 0, value: shut ? 0 : 1 }];
    let at = 0;
    for (const gap of loops.blinkGaps) {
      at += gap;
      frames.push({ at: at / cycle, value: shut ? 0 : 1 }, { at: (at + 20) / cycle, value: shut ? 1 : 0 }, { at: (at + loops.blink.duration - 20) / cycle, value: shut ? 1 : 0 });
      at += loops.blink.duration;
      frames.push({ at: at / cycle, value: shut ? 0 : 1 });
    }
    return { property: "opacity", keyframes: frames, duration: cycle, iterations: 0 };
  };
  const rim = ctx.theme.mode === "dark" ? [{ d: MASCOT_PATHS.outline, stroke: color(BRAND.gradient[1]), strokeWidth: 18 }] : [];
  const bob: TimelineAnimation = { property: "translateY", keyframes: [{ at: 0, value: 0 }, { at: 0.5, value: -lift }, { at: 1, value: 0 }], duration: 900, iterations: 0, easing: [0.42, 0, 0.58, 1] };
  return {
    type: "view", accessibilityRole: "progressbar", accessibilityLabel: label, style: { width: size, height: size + lift },
    children: [{
      type: "view", style: { position: "absolute", top: lift, left: 0, width: size, height: size }, animations: ctx.reducedMotion ? undefined : [bob],
      children: [
        layer([...rim, { d: MASCOT_PATHS.outline, fill: ink }, { d: MASCOT_PATHS.face, fill: color(BRAND.face) }, { d: MASCOT_PATHS.cheek, fill: ink }]),
        layer([{ d: MASCOT_PATHS.leftEye, fill: ink }, { d: MASCOT_PATHS.rightEye, fill: ink }], [blink(false)]),
        { ...layer([{ d: MASCOT_PATHS.closedEyes, stroke: ink, strokeWidth: 24 }], [blink(true)]), style: { position: "absolute", top: 0, left: 0, width: size, height: size, opacity: 0 } },
      ],
    }],
  };
}

const markdownStyles = new WeakMap<AppTheme, Map<string, object>>();

function markdownStyle(theme: AppTheme, textColor: string, linkColor: string | undefined, onUser: boolean, onSurface = false) {
  let byTheme = markdownStyles.get(theme);
  if (!byTheme) {
    byTheme = new Map();
    markdownStyles.set(theme, byTheme);
  }
  // Text size is part of the key: typography changes in place with the app's text size.
  const key = `${textColor}|${linkColor}|${onUser}|${onSurface}|${typography.chatBody.fontSize}`;
  let style = byTheme.get(key);
  if (!style) {
    style = normalizeMarkdownStyle(enrichedMarkdownStyle(theme, textColor, linkColor, onUser, onSurface));
    byTheme.set(key, style);
  }
  return style;
}

function markdown(ctx: NodeContext, value: string, options: { color: string; linkColor?: string; onUser?: boolean; onSurface?: boolean; streaming?: boolean; id?: string }): TimelineNode {
  return {
    type: "markdown", id: options.id, markdown: value, markdownStyle: markdownStyle(ctx.theme, options.color, options.linkColor, options.onUser ?? false, options.onSurface), md4cFlags: MD4C_FLAGS,
    streaming: options.streaming ?? false, selectable: true, gfm: true, style: { minWidth: 0, flexShrink: 1 },
  };
}

function codeText(ctx: NodeContext, value: string, tint: string, background?: string): TimelineNode {
  return text(value || ctx.t("message.tool.emptyOutput"), textStyle("code", tint, { fontFamily: "SpaceMono" }), { selectable: true, style: background ? { backgroundColor: color(background) } : undefined });
}

/** A press target: `pressedOpacity` matches `active:opacity-55`. */
function pressable(node: Omit<Extract<TimelineNode, { type: "view" }>, "type">, pressedOpacity = 0.55): TimelineNode {
  return { type: "view", pressedOpacity, accessibilityRole: "button", ...node };
}

function toolCall(ctx: NodeContext, scope: string, block: Extract<ContentBlock, { type: "tool_use" }>, result: Extract<ContentBlock, { type: "tool_result" }> | undefined, active: boolean, width: number): TimelineNode {
  const { theme, t } = ctx;
  const id = `tool:${scope}:${block.id}`;
  const expanded = ctx.expanded.has(id);
  const status = result ? result.is_error ? t("message.tool.status.error") : t("message.tool.status.done") : active ? t("message.tool.status.running") : t("message.tool.status.noResult");
  const iconColor = result?.is_error ? theme.colors.danger : active && !result ? theme.colors.accent : theme.colors.textMuted;
  const preview = toolCallPreview(block.name, block.input);
  const caption = preview ? `${block.name}: "${preview}"` : block.name;
  const edits = Array.isArray(block.input.edits) ? block.input.edits.filter((edit): edit is { oldText: string; newText: string } => typeof edit === "object" && edit !== null && typeof edit.oldText === "string" && typeof edit.newText === "string") : [];
  const label = (value: string, tint: string) => text(value, textStyle("micro", tint, { fontWeight: "600" }));
  const lineStyle: TimelineTextStyle = { fontSize: scaleFontSize(13), lineHeight: scaleLineHeight(18), color: color(theme.colors.textMuted), ...(TEXT_FAMILY ? { fontFamily: TEXT_FAMILY } : null) };
  const children: TimelineNode[] = [
    pressable({
      id: `${id}:row`, action: "toggle", payload: { id }, accessibilityLabel: `${caption}: ${status}`, accessibilityState: { expanded }, pressedOpacity: 1,
      style: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8 },
      children: [
        icon(toolIcon(block.name) as TimelineIconName, 14, iconColor),
        { type: "text", text: lineStyle, numberOfLines: 1, style: { flex: 1 }, runs: [{ text: block.name, color: color(theme.colors.text), fontWeight: "500" }, ...(preview ? [{ text: `: "${preview}"` }] : [])] },
      ],
    }),
  ];
  if (expanded) {
    const inner = Math.max(0, width - 21);
    children.push({
      type: "scroll", id: `${id}:details`, style: { maxHeight: TOOL_DETAILS_MAX_HEIGHT, marginTop: 4 },
      contentStyle: { gap: 8, borderLeftWidth: STEP_RULE, borderLeftColor: color(theme.colors.border), paddingLeft: 12, paddingRight: 8 },
      children: [
        label(t("message.tool.input"), theme.colors.textMuted),
        codeText(ctx, JSON.stringify(block.input, null, 2), theme.colors.text),
        ...edits.flatMap((edit) => [
          codeText(ctx, edit.oldText.split("\n").map((line) => `- ${line}`).join("\n"), theme.colors.danger, theme.colors.dangerSoft),
          codeText(ctx, edit.newText.split("\n").map((line) => `+ ${line}`).join("\n"), theme.colors.success, theme.colors.successSoft),
        ]),
        ...(result ? [{
          type: "view" as const, style: { gap: 8 },
          children: [
            label(result.is_error ? t("message.tool.outputError") : t("message.tool.output"), result.is_error ? theme.colors.danger : theme.colors.textMuted),
            ...(typeof result.content === "string" ? [codeText(ctx, result.content, theme.colors.text)] : contentNodes(ctx, `${scope}:${block.id}`, result.content, { width: inner })),
          ],
        }] : []),
      ],
    });
  }
  // Android scroll views clip only inside a clipping parent.
  return { type: "view", id, style: { width, overflow: "hidden" }, children };
}

/** A gallery thumbnail's corner; the image viewer starts from it. */
export const GALLERY_THUMB_RADIUS = 12;

function gallery(ctx: NodeContext, uris: string[], maxWidth: number, idPrefix = "image"): TimelineNode {
  const size = Math.max(0, Math.min(164, ctx.width * 0.42, maxWidth));
  const scale = PixelRatio.get();
  // Android's image covers this glyph with its background until both sources have failed.
  const failed: TimelineNode[] = Platform.OS === "android" ? [{ type: "view", style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }, children: [icon("images", 22, ctx.theme.colors.textMuted)] }] : [];
  const thumb = (uri: string, index: number): TimelineNode => {
    const thumbnail = imageThumbnailUrl(uri, size, scale);
    return pressable({
      // `thumbnail` lets the image viewer stand the drawn image in while the full one loads.
      id: `${idPrefix}:${index}`, action: "openImage", payload: { uris, index, thumbnail }, accessibilityLabel: ctx.t("message.openImage", { index: index + 1, total: uris.length }), pressedOpacity: 0.78,
      style: { width: size, height: size, borderRadius: GALLERY_THUMB_RADIUS, overflow: "hidden", backgroundColor: color(ctx.theme.colors.surfaceRaised) },
      children: [...failed, { type: "image", uri: thumbnail, fallbackUri: uri, style: { width: size, height: size, borderRadius: GALLERY_THUMB_RADIUS, backgroundColor: color(ctx.theme.colors.surfaceRaised) } }],
    });
  };
  if (uris.length === 1) return thumb(uris[0]!, 0);
  // No fixed height: Yoga skips the measure function of a node sized on both axes, and Android lays
  // out a scroll view's content only there, so the thumbnails would be 0×0.
  const strip: TimelineNode = { type: "scroll", horizontal: true, style: { width: maxWidth }, contentStyle: { flexDirection: "row", gap: 8, paddingRight: 4 }, children: uris.map(thumb) };
  // Android scroll views clip only inside a clipping parent; a bubble does not clip, so scrolled thumbnails would spill out of it.
  return { type: "view", style: { width: maxWidth, overflow: "hidden" }, children: [strip] };
}

/** Resolved sandbox images by path. A reply's text draws the ones it references; the rest stay links. */
export type SandboxImages = ReadonlyMap<string, string>;

export const NO_SANDBOX_IMAGES: SandboxImages = new Map();

/** `TextBlock` with `sandboxImages`: the reply's Markdown, then the sandbox images it references. */
function replyMarkdown(ctx: NodeContext, value: string, images: SandboxImages, width: number, options: Parameters<typeof markdown>[2]): TimelineNode[] {
  const parsed = messageMarkdownImages(value);
  const uris = parsed.images.flatMap((path) => images.get(path) ?? []);
  const node = markdown(ctx, parsed.markdown, options);
  return uris.length ? [node, gallery(ctx, uris, width, `sandbox:${options.id ?? "text"}`)] : [node];
}

const replyImagePathsCache = new WeakMap<MessageRecord, string[]>();

/** Sandbox image paths a finished reply's answer references, in the order `assistantMessageNode` draws them. */
export function replyImagePaths(message: MessageRecord): string[] {
  const cached = replyImagePathsCache.get(message);
  if (cached) return cached;
  const answer = answerBlocks(message.content);
  const texts = hasRenderableContent(answer)
    ? answer.flatMap((block) => block.type === "text" ? [block.text] : [])
    : thinkingBlocks(message.content).length === 0 && message.text?.trim() ? [message.text] : [];
  const paths = [...new Set(texts.flatMap((value) => messageMarkdownImages(value).images))];
  replyImagePathsCache.set(message, paths);
  return paths;
}

/** `MessageContent`: the blocks of one message or step list, in order. */
export function contentNodes(ctx: NodeContext, scope: string, content: ContentBlock[] | null | undefined, options: { width: number; color?: string; linkColor?: string; onUser?: boolean; onSurface?: boolean; active?: boolean; streamingText?: string | null; sandboxImages?: SandboxImages }): TimelineNode[] {
  const blocks = content ?? [];
  const results = new Map<string, Extract<ContentBlock, { type: "tool_result" }>>();
  for (const block of blocks) if (block.type === "tool_result" && block.tool_use_id) results.set(block.tool_use_id, block);
  const uris = blocks.flatMap((block) => block.type === "image" ? [imageUri(block)].filter((uri): uri is string => Boolean(uri)) : []);
  const firstImage = blocks.findIndex((block) => block.type === "image" && imageUri(block) !== null);
  const lastText = blocks.findLastIndex((block) => block.type === "text");
  const tint = options.color ?? ctx.theme.colors.text;
  const nodes: TimelineNode[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "tool_result") return;
    if (block.type === "text") {
      if (!block.text.trim()) return;
      // Only the trailing text block is still being written; it gets the paced prefix.
      const value = options.active && index === lastText && options.streamingText != null ? options.streamingText : block.text;
      const textOptions = { id: `text:${index}`, color: tint, linkColor: options.linkColor, onUser: options.onUser, onSurface: options.onSurface, streaming: options.active && index === lastText };
      if (options.sandboxImages) nodes.push(...replyMarkdown(ctx, value, options.sandboxImages, options.width, textOptions));
      else nodes.push(markdown(ctx, value, textOptions));
    } else if (block.type === "thinking") {
      if (!block.thinking.trim()) return;
      nodes.push(markdown(ctx, block.thinking, { id: `thinking:${scope}:${index}`, color: ctx.theme.colors.textMuted, onUser: options.onUser, streaming: options.active }));
    } else if (block.type === "tool_use") {
      nodes.push(toolCall(ctx, scope, block, results.get(block.id), options.active ?? false, options.width));
    } else if (block.type === "image") {
      if (index === firstImage && uris.length > 0) nodes.push(gallery(ctx, uris, options.width));
    } else if (block.type === "system_note") {
      const body = block.text?.trim();
      nodes.push({
        type: "view", style: { borderLeftWidth: 2, borderLeftColor: color(ctx.theme.colors.border), paddingLeft: 9, gap: 3 },
        children: [
          text(block.note_type === "compacted" ? ctx.t("message.compaction.title") : ctx.t("chat.systemUpdate"), textStyle("caption", ctx.theme.colors.textSecondary, { fontWeight: "600" })),
          ...(body ? [text(body, textStyle("caption", ctx.theme.colors.textMuted), { selectable: true })] : []),
        ],
      });
    }
  });
  return nodes;
}

function bubbleMeta(ctx: NodeContext, clock: string | undefined, local: boolean, failed: boolean): TimelineNode | null {
  if (!clock && !local && !failed) return null;
  const tint = ctx.theme.colors.userBubbleMeta;
  const receipt: TimelineNode = failed
    ? { ...icon("alert", 11, tint, 2.4), accessibilityLabel: ctx.t("chat.sendFailed") }
    : local
      ? { type: "view", accessibilityLabel: ctx.t("chat.sending"), style: { width: 11, height: 11, alignItems: "center", justifyContent: "center" }, children: [{ type: "view", style: { width: 6, height: 6, borderRadius: 3, backgroundColor: color(tint) } }] }
      : icon("check-check", 11, tint, 2.4);
  return {
    type: "view", style: { flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, alignSelf: "flex-end", marginTop: 2 },
    children: [...(clock ? [text(clock, textStyle("micro", tint, { fontVariant: ["tabular-nums"] }))] : []), receipt],
  };
}

export function userMessageNode(ctx: NodeContext, message: MessageRecord, options: { local: boolean; retryDisabled: boolean; topPadding: number; inset?: number }): TimelineNode {
  const { theme, t } = ctx;
  const maxWidth = getBubbleMaxWidth(ctx.width);
  const inner = maxWidth - BUBBLE_PADDING_X * 2;
  const failed = isFailedSend(message);
  const clock = formatMessageClock(message.createdAt);
  const tint = theme.colors.userBubbleText;
  const body = hasRenderableContent(message.content)
    ? contentNodes(ctx, message.id, message.content, { width: inner, color: tint, linkColor: theme.colors.userBubbleLink, onUser: true })
    : message.text?.trim() ? [markdown(ctx, message.text, { color: tint, linkColor: theme.colors.userBubbleLink, onUser: true })] : [];
  const meta = bubbleMeta(ctx, clock, options.local, failed);
  const error = message.errorMessage ? text(message.errorMessage, textStyle("caption", tint), { selectable: true, style: { marginTop: 6 } }) : null;
  const action = (name: "retry" | "discard", label: string, glyph: TimelineIconName, tone: string, disabled = false): TimelineNode => pressable({
    action: name, disabled, accessibilityLabel: label, accessibilityState: { disabled },
    style: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, opacity: disabled ? 0.45 : 1 },
    children: [icon(glyph, 14, tone), text(label, textStyle("caption", tone, { fontWeight: "600" }))],
  });
  return {
    type: "view", style: { width: "100%", paddingHorizontal: 12, paddingTop: (options.inset ?? 5) + options.topPadding, paddingBottom: options.inset ?? 5, alignItems: "flex-end" },
    children: [
      {
        type: "view", id: "bubble",
        style: { maxWidth, minWidth: 0, borderRadius: theme.radius.md, backgroundColor: color(theme.colors.userBubble), paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 },
        children: [...body, ...(error ? [error] : []), ...(meta ? [meta] : [])],
      },
      ...(failed ? [{
        type: "view" as const, style: { flexDirection: "row", alignItems: "center", marginRight: -8 },
        children: [action("discard", t("chat.sendFailed.delete"), "trash", theme.colors.textMuted), action("retry", t("common.retry"), "refresh", theme.colors.accent, options.retryDisabled)],
      }] : []),
    ],
  };
}

function replyMeta(ctx: NodeContext, key: string, message: MessageRecord, options: { copyText: string; copied: boolean; canFork: boolean; forkDisabled: boolean; forking: boolean }): TimelineNode | null {
  const { theme, t } = ctx;
  const clock = formatMessageClock(message.createdAt);
  const { identity, parts } = replyDetailParts(message, t);
  const details = [identity, ...parts].filter(Boolean).join(DETAIL_SEPARATOR);
  const canCopy = Boolean(options.copyText);
  const actions = Number(canCopy) + Number(options.canFork);
  if (!actions && !details && !clock) return null;
  const fontSize = typography.micro.fontSize * ctx.fontScale;
  const detailsWidth = getReplyContentWidth(ctx.width) - (actions ? actions * 32 - 6 : 0) - (clock ? 8 + estimateTextWidth(clock, fontSize) : 0);
  const fitted = fitReplyDetails(identity, parts, detailsWidth, fontSize);
  const detailsId = `details:${key}`;
  const expanded = ctx.expanded.has(detailsId);
  const faint = theme.colors.textFaint;
  const button = (action: string, label: string, glyph: TimelineNode, disabled = false): TimelineNode => pressable({
    action, disabled, accessibilityLabel: label, style: { width: 32, height: 32, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : 1 }, children: [glyph],
  });
  const detailsStyle = { flex: 1, minWidth: 0, marginLeft: actions ? 3 : 0 };
  return {
    type: "view", style: { flexDirection: "row", alignItems: "center", minHeight: REPLY_META_HEIGHT, marginLeft: actions ? -9 : 0 },
    children: [
      ...(canCopy ? [button("copy", options.copied ? t("chat.copied") : t("chat.copy"), icon(options.copied ? "check" : "copy", 14, options.copied ? theme.colors.success : faint))] : []),
      ...(options.canFork ? [button("fork", t("chat.fork"), options.forking ? loader(ctx, faint) : icon("git-fork", 14, faint), options.forkDisabled)] : []),
      fitted === details
        ? text(details, textStyle("micro", faint), { numberOfLines: 1, style: detailsStyle })
        : pressable({ action: "toggle", payload: { id: detailsId }, accessibilityLabel: details, accessibilityState: { expanded }, pressedOpacity: 0.6, style: { ...detailsStyle, alignSelf: "stretch", justifyContent: "center" }, children: [text(expanded ? details : fitted, textStyle("micro", faint), { numberOfLines: expanded ? undefined : 1 })] }),
      ...(clock ? [text(clock, textStyle("micro", faint, { fontVariant: ["tabular-nums"] }), { style: { marginLeft: 8, flexShrink: 0 } })] : []),
    ],
  };
}

export function assistantMessageNode(ctx: NodeContext, key: string, message: MessageRecord, options: { copied: boolean; canFork: boolean; forkDisabled: boolean; forking: boolean; sandboxImages: SandboxImages }): TimelineNode {
  const { theme } = ctx;
  const contentWidth = getReplyContentWidth(ctx.width);
  const tint = theme.colors.assistantBubbleText;
  const answer = answerBlocks(message.content);
  const thought = thinkingBlocks(message.content).length > 0;
  const body = hasRenderableContent(answer)
    ? contentNodes(ctx, message.id, answer, { width: contentWidth, color: tint, sandboxImages: options.sandboxImages })
    : !thought && message.text?.trim() ? replyMarkdown(ctx, message.text, options.sandboxImages, contentWidth, { color: tint }) : [];
  const meta = replyMeta(ctx, key, message, { ...options, copyText: thought ? contentText(answer).trim() : messageText(message) });
  return {
    type: "view", style: { width: "100%", maxWidth: getReplyRowWidth(ctx.width), paddingHorizontal: REPLY_INSET_X, paddingTop: 6 },
    children: [
      { type: "view", style: { gap: 4, minWidth: 0 }, children: body },
      ...(message.errorMessage ? [{ type: "view" as const, style: { marginTop: body.length ? 8 : 0, borderRadius: theme.radius.md, backgroundColor: color(theme.colors.dangerSoft), paddingHorizontal: 12, paddingVertical: 8 }, children: [text(message.errorMessage, textStyle("caption", theme.colors.danger), { selectable: true })] }] : []),
      ...(meta ? [meta] : []),
    ],
  };
}

export function systemMessageNode(ctx: NodeContext, message: MessageRecord): TimelineNode {
  return { type: "view", style: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 8 }, children: [text(message.text || ctx.t("chat.systemUpdate"), textStyle("caption", ctx.theme.colors.textFaint, { textAlign: "center" }))] };
}

export function compactionNode(ctx: NodeContext, key: string, info: CompactionInfo): TimelineNode {
  const { theme, t } = ctx;
  const id = `compaction:${key}`;
  const expanded = ctx.expanded.has(id);
  const stats = compactionStats(info.meta);
  const details: string[] = [];
  if (stats.summarizedMessageCount !== null) details.push(t("message.compaction.messages", { count: stats.summarizedMessageCount }));
  if (stats.tokensBefore !== null && stats.tokensAfter !== null) details.push(t("message.compaction.context", { before: formatTokenCount(stats.tokensBefore), after: formatTokenCount(stats.tokensAfter) }));
  const hasSummary = info.summary.length > 0;
  return {
    type: "view", style: { width: "100%", paddingHorizontal: 12, paddingVertical: 5 },
    children: [{
      type: "view", style: { overflow: "hidden", borderRadius: theme.radius.md, borderWidth: 1, borderColor: color(theme.colors.border), backgroundColor: color(theme.colors.surface) },
      children: [
        {
          type: "view", action: hasSummary ? "toggle" : undefined, payload: { id }, pressedBackgroundColor: color(theme.colors.surfacePressed), accessibilityRole: "button",
          accessibilityLabel: hasSummary ? t(expanded ? "message.compaction.collapse" : "message.compaction.expand") : t("message.compaction.title"), accessibilityState: { expanded },
          style: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
          children: [
            icon("archive", 16, theme.colors.textMuted),
            text(t("message.compaction.title"), textStyle("caption", theme.colors.textSecondary, { fontWeight: "600" })),
            details.length ? text(details.join(" · "), textStyle("micro", theme.colors.textMuted, { textAlign: "right" }), { numberOfLines: 1, style: { flex: 1 } }) : { type: "view", style: { flex: 1 } },
            ...(hasSummary ? [icon(expanded ? "chevron-down" : "chevron-right", 14, theme.colors.textFaint)] : []),
          ],
        },
        ...(expanded && hasSummary ? [{
          type: "scroll" as const, style: { maxHeight: COMPACTION_SUMMARY_MAX_HEIGHT, borderTopWidth: 1, borderColor: color(theme.colors.border) },
          contentStyle: { paddingHorizontal: 12, paddingVertical: 10 },
          // design-system: native timeline nodes take resolved colors; there is no className outside React views.
          children: [markdown(ctx, info.summary, { color: theme.colors.textSecondary, onSurface: true })],
        }] : []),
      ],
    }],
  };
}

/** `ProcessDisclosure`: a capsule that opens the turn's steps under a rule. */
function disclosure(ctx: NodeContext, id: string, label: string, children: TimelineNode[]): TimelineNode {
  const { theme } = ctx;
  const expanded = ctx.expanded.has(id);
  return {
    type: "view", style: { paddingHorizontal: 16, paddingVertical: 6 },
    children: [
      {
        type: "view", action: "toggle", payload: { id }, accessibilityRole: "button", accessibilityState: { expanded }, accessibilityLabel: label, pressedBackgroundColor: color(theme.colors.surfacePressed),
        style: { height: 32, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: 16, backgroundColor: color(theme.colors.surfaceRaised), paddingLeft: 8, paddingRight: 12, marginVertical: 2 },
        children: [icon(expanded ? "chevron-down" : "chevron-right", 14, theme.colors.textMuted), text(label, textStyle("caption", theme.colors.textMuted), { numberOfLines: 1, style: { flexShrink: 1 } })],
      },
      ...(expanded ? [{ type: "view" as const, style: { marginTop: 8, gap: 8, borderLeftWidth: STEP_RULE, borderLeftColor: color(theme.colors.border), paddingLeft: 12 }, children }] : []),
    ],
  };
}

export type StepsState = { status: "idle" | "loading" | "error" | "ready"; content: ContentBlock[] | null; error: string | null };

/** `TurnProcess`: an archived turn's steps and thinking. Null when there is nothing to open. */
export function turnProcessNode(ctx: NodeContext, turn: SessionTurnRecord, steps: StepsState, hasClient: boolean): TimelineNode | null {
  const { theme, t } = ctx;
  const objectKey = turn.intermediateIndex?.messagesObjectKey;
  const thinking = thinkingBlocks(turn.assistantContent);
  const summary = turn.intermediateSummary;
  const hasSteps = Boolean(objectKey || summary?.messageCount || summary?.toolCallCount);
  if (!hasSteps && thinking.length === 0) return null;
  const id = `steps:${turn.id}`;
  const label = `${hasSteps ? summary ? t("turn.steps", { steps: summary.messageCount, tools: summary.toolCallCount }) : t("turn.executionDetails") : t("turn.thinking")}${turn.durationMs != null ? ` · ${Math.round(turn.durationMs / 1000)}s` : ""}`;
  const width = getReplyContentWidth(ctx.width) - 13;
  const muted = (value: string) => text(value, textStyle("caption", theme.colors.textMuted));
  const children: TimelineNode[] = [];
  if (hasSteps) {
    if (objectKey && !hasClient) children.push(muted(t("turn.connect")));
    else if (steps.status === "error") children.push(pressable({ action: "stepsRetry", payload: { turnId: turn.id }, children: [text(`${steps.error || t("turn.loadError")} ${t("common.retry")}`, textStyle("caption", theme.colors.danger))] }));
    else if (!objectKey) children.push(muted(t("turn.notArchived")));
    else if (steps.content === null) children.push(loader(ctx));
    else if (steps.content.length) children.push(...contentNodes(ctx, turn.id, steps.content, { width }));
    else if (!thinking.length) children.push(muted(t("turn.none")));
  }
  if (thinking.length) children.push(...contentNodes(ctx, `${turn.id}:thinking`, thinking, { width }));
  return disclosure(ctx, id, label, children);
}

/** `StreamingTurnProcess`: the live step list, keyed like the archived one so its open state carries over. */
export function streamingProcessNode(ctx: NodeContext, turnId: string, messages: StreamView["intermediateMessages"], thinking: ContentBlock[]): TimelineNode | null {
  if (messages.length === 0 && thinking.length === 0) return null;
  let tools = 0;
  const content: ContentBlock[] = [];
  for (const message of messages) {
    for (const block of message.content) if (block.type === "tool_use") tools += 1;
    if (message.content.length) content.push(...message.content);
    else if (message.text) content.push({ type: "text", text: message.text });
  }
  const width = getReplyContentWidth(ctx.width) - 13;
  const children: TimelineNode[] = [];
  if (messages.length) children.push(...(content.length ? contentNodes(ctx, turnId, content, { width }) : thinking.length ? [] : [text(ctx.t("turn.none"), textStyle("caption", ctx.theme.colors.textMuted))]));
  if (thinking.length) children.push(...contentNodes(ctx, `${turnId}:thinking`, thinking, { width, active: true }));
  return disclosure(ctx, `steps:${turnId}`, messages.length ? ctx.t("turn.steps", { steps: messages.length, tools }) : ctx.t("turn.thinking"), children);
}

/** `Avatar`'s shape, for the other Bot's face on a message between Bots. */
function botAvatar(ctx: NodeContext, peer: BotPeer): TimelineNode {
  const size = BOT_EXCHANGE_AVATAR_SIZE;
  const shape = { width: size, height: size, borderRadius: size * 0.3 };
  if (peer.avatarUrl) return { type: "image", uri: imageThumbnailUrl(peer.avatarUrl, size, PixelRatio.get()), fallbackUri: peer.avatarUrl, style: { ...shape, backgroundColor: color(ctx.theme.colors.surfaceRaised) } };
  return { type: "view", style: { ...shape, alignItems: "center", justifyContent: "center", backgroundColor: color(ctx.theme.colors.accentSoft) }, children: [text(initials(peer.name), textStyle("micro", ctx.theme.colors.accent, { fontSize: 12 / ctx.fontScale, lineHeight: 14 / ctx.fontScale, fontWeight: "600" }))] };
}

/** `BotNoteBubble`: what a Bot says to the user, its words and images on the left. */
export function botNoteNode(ctx: NodeContext, message: MessageRecord, sandboxImages: SandboxImages): TimelineNode | null {
  const { theme } = ctx;
  const maxWidth = getBubbleMaxWidth(ctx.width);
  const width = maxWidth - BUBBLE_PADDING_X * 2;
  const blocks = botReplyBlocks(message.content);
  const body = blocks.length
    ? contentNodes(ctx, message.id, blocks, { width, color: ctx.theme.colors.assistantBubbleText, onSurface: true, sandboxImages })
    : message.text?.trim() ? replyMarkdown(ctx, message.text, sandboxImages, width, { color: ctx.theme.colors.assistantBubbleText, onSurface: true }) : [];
  if (body.length === 0) return null;
  return {
    type: "view", style: { width: "100%", paddingHorizontal: 12, paddingVertical: BOT_BUBBLE_INSET, alignItems: "flex-start" },
    children: [{
      type: "view", style: { maxWidth, minWidth: 0, borderRadius: theme.radius.md, backgroundColor: color(theme.colors.assistantBubble), paddingHorizontal: BUBBLE_PADDING_X, paddingTop: 9, paddingBottom: 8, gap: 4 },
      children: body,
    }],
  };
}

const BOT_EXCHANGE_PREVIEW = 280;

/** `BotExchangeRow`: a message between two Bots, two lines until it is tapped; the face opens the Bot at the other end. */
export function botExchangeNode(ctx: NodeContext, id: string, exchange: BotExchange, bot: BotPeer, peer: BotPeer | null, sandboxImages: SandboxImages): TimelineNode | null {
  const { theme, t } = ctx;
  if (exchange.content.length === 0) return null;
  const toggle = `exchange:${id}`;
  const open = ctx.expanded.has(toggle);
  const maxWidth = getBubbleMaxWidth(ctx.width);
  const indent = BOT_EXCHANGE_AVATAR_SIZE + 6;
  const name = peer?.name ?? t("bots.otherBot");
  const direction = t("bots.exchange", exchange.outgoing ? { from: bot.name, to: name } : { from: name, to: bot.name });
  const preview = previewText(botExchangeText(exchange), BOT_EXCHANGE_PREVIEW);
  const face = botAvatar(ctx, { name, avatarUrl: peer?.avatarUrl ?? null });
  return {
    type: "view", style: { width: "100%", paddingHorizontal: 12, paddingVertical: BOT_BUBBLE_INSET, alignItems: "flex-start" },
    children: [{
      type: "view", action: "toggle", payload: { id: toggle }, pressedOpacity: 0.7, accessibilityRole: "button", accessibilityState: { expanded: open }, accessibilityLabel: preview ? `${direction}: ${preview}` : direction,
      style: { maxWidth, minWidth: 0 },
      children: [
        {
          type: "view", style: { flexDirection: "row", alignItems: "center", gap: 6 },
          children: [
            peer ? { type: "view", action: "openBot", payload: { spaceId: exchange.peer }, pressedOpacity: 0.7, accessibilityRole: "button", accessibilityLabel: t("ui.openNamed", { name }), children: [face] } : face,
            text(direction, textStyle("caption", theme.colors.textMuted), { numberOfLines: 1, style: { flexShrink: 1 } }),
            icon(open ? "chevron-down" : "chevron-right", 14, theme.colors.textFaint),
          ],
        },
        {
          type: "view", style: { marginTop: 4, marginLeft: BOT_EXCHANGE_AVATAR_SIZE / 2, borderLeftWidth: STEP_RULE, borderLeftColor: color(theme.colors.border), paddingLeft: indent - BOT_EXCHANGE_AVATAR_SIZE / 2 - STEP_RULE, gap: 4 },
          children: open
            ? contentNodes(ctx, id, exchange.content, { width: maxWidth - indent, color: ctx.theme.colors.textSecondary, sandboxImages })
            : [text(preview, textStyle("caption", theme.colors.textSecondary, { fontWeight: "400" }), { numberOfLines: 2 })],
        },
      ],
    }],
  };
}

/** A message on a Bot's page with what `botPlacements` puts above it: `BotTimeDivider`, or the space where the side changes. */
export function botPlacedNode(ctx: NodeContext, node: TimelineNode | null, placement: BotPlacement): TimelineNode | null {
  if (!placement.time) return node && placement.gap ? { type: "view", style: { paddingTop: placement.gap }, children: [node] } : node;
  const label = formatThreadTime(placement.time, ctx.t, getActiveLocale());
  // The padding sits on a view: Android's timeline text does not lay out its own padding.
  const row: TimelineNode = { type: "view", style: { alignItems: "center", paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 }, children: [text(label, textStyle("caption", ctx.theme.colors.textFaint, { fontVariant: ["tabular-nums"] }))] };
  return { type: "view", children: [row, ...(node ? [node] : [])] };
}

function liveDot(ctx: NodeContext): TimelineNode {
  return { type: "view", style: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: color(ctx.theme.colors.accent) } };
}

/** `StreamCard`: the reply being written, ending in a status line the finished reply's meta replaces in place. */
export function streamCardNode(ctx: NodeContext, input: { content: ContentBlock[]; status: string; runtimePhase: StreamView["runtimePhase"]; runtimeModel: string | null; startedAt: string; streamingText: string | null }): TimelineNode {
  const { theme, t } = ctx;
  const answer = answerBlocks(input.content);
  const live = input.status === "pending" || input.status === "streaming";
  const hasLivePreview = answer.some((block) => (block.type === "text" && block.text.trim().length > 0) || block.type === "tool_use");
  const hasContent = hasLivePreview || hasRenderableContent(answer);
  const runtimeLabel = !hasLivePreview && live
    ? thinkingBlocks(input.content).length > 0
      ? t("message.stream.thinking")
      : input.runtimePhase === "llm_call_started"
        ? input.runtimeModel?.trim() ? t("message.stream.waitingModel", { model: input.runtimeModel.trim() }) : t("message.stream.waitingGeneric")
        : input.status === "pending" && !hasRenderableContent(answer) ? t("message.stream.starting") : null
    : null;
  const statusLabel = input.status === "failed" ? t("message.stream.failed") : input.status === "interrupted" ? t("message.stream.stopped") : null;
  const statusRow: TimelineNode[] = statusLabel
    ? [text(statusLabel, textStyle("caption", input.status === "failed" ? theme.colors.danger : theme.colors.textMuted), { style: { flex: 1, minWidth: 0 } })]
    : runtimeLabel
      ? [liveDot(ctx), text(runtimeLabel, textStyle("caption", theme.colors.textMuted), { numberOfLines: 1, style: { flex: 1, minWidth: 0 } })]
      : hasContent
        ? [liveDot(ctx), { type: "view", style: { flex: 1 } }]
        : [{ type: "view", style: { flex: 1, flexDirection: "row", alignItems: "center" }, children: [mascotLoader(ctx, 22, t("message.stream.starting"))] }];
  return {
    type: "view", style: { width: "100%", maxWidth: getReplyRowWidth(ctx.width), paddingHorizontal: REPLY_INSET_X, paddingTop: 6 },
    children: [
      ...(hasContent ? [{ type: "view" as const, style: { gap: 4, minWidth: 0 }, children: contentNodes(ctx, "live", answer, { width: getReplyContentWidth(ctx.width), active: live, streamingText: input.streamingText, sandboxImages: NO_SANDBOX_IMAGES }) }] : []),
      {
        type: "view", style: { flexDirection: "row", alignItems: "center", gap: 8, height: REPLY_META_HEIGHT },
        children: [...statusRow, ...(live ? [text(formatMessageClock(input.startedAt) ?? "", textStyle("micro", theme.colors.textFaint, { fontVariant: ["tabular-nums"] }), { style: { flexShrink: 0 } })] : [])],
      },
    ],
  };
}

function relatedTitle(view: RelatedSessionView, title: (session: Extract<RelatedSessionView, { status: "ready" }>["session"]) => string) {
  return view.status === "ready" ? title(view.session) : null;
}

function dot(ctx: NodeContext): TimelineNode {
  return { type: "view", style: { width: 6, height: 6, borderRadius: 3, backgroundColor: color(colorWithOpacity(ctx.theme.colors.accent, 0.7)) } };
}

type SessionTitle = Parameters<typeof relatedTitle>[1];

export function sentFromNode(ctx: NodeContext, ref: { spaceId: string; sessionId: string; turnId: string }, view: RelatedSessionView, title: SessionTitle): TimelineNode {
  const { theme, t } = ctx;
  const name = relatedTitle(view, title);
  const unavailable = view.status === "unavailable";
  const label = name ? t("turn.related.from", { title: name }) : unavailable ? t("turn.related.fromUnavailable") : t("turn.related.fromChat");
  return {
    type: "view", style: { alignItems: "flex-end", paddingHorizontal: 16, marginTop: 4 },
    children: [pressable({
      action: "openSession", payload: ref, disabled: unavailable, accessibilityRole: "link", accessibilityLabel: label, accessibilityState: { disabled: unavailable },
      style: { maxWidth: "86%", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
      children: [dot(ctx), text(label, textStyle("caption", unavailable ? theme.colors.textFaint : theme.colors.textMuted), { numberOfLines: 1, style: { flexShrink: 1 } }), ...(unavailable ? [] : [icon("chevron-right", 14, theme.colors.textFaint)])],
    })],
  };
}

const VISIBLE_SENT_SESSIONS = 3;

export function sentToNode(ctx: NodeContext, turnId: string, sessions: readonly { spaceId: string; sessionId: string; turnId: string; count: number }[], viewOf: (sessionId: string) => RelatedSessionView, title: SessionTitle): TimelineNode | null {
  const { theme, t } = ctx;
  if (sessions.length === 0) return null;
  const single = sessions.length === 1;
  const id = `sentTo:${turnId}`;
  const collapsed = !ctx.expanded.has(id) && sessions.length > VISIBLE_SENT_SESSIONS + 1;
  const visible = collapsed ? sessions.slice(0, VISIBLE_SENT_SESSIONS) : sessions;
  const row = (session: (typeof sessions)[number]): TimelineNode => {
    const view = viewOf(session.sessionId);
    const name = relatedTitle(view, title);
    const unavailable = view.status === "unavailable";
    const shown = name ?? (unavailable ? t("turn.related.unavailable") : t("turn.related.otherChat"));
    const label = single ? name ? t("turn.related.sentTo", { title: name }) : unavailable ? t("turn.related.unavailable") : t("turn.related.sentToChat") : shown;
    return pressable({
      id: `${session.spaceId}:${session.sessionId}`, action: "openSession", payload: { spaceId: session.spaceId, sessionId: session.sessionId, turnId: session.turnId }, disabled: unavailable,
      accessibilityRole: "link", accessibilityLabel: unavailable ? label : t("turn.related.open", { title: shown }), accessibilityState: { disabled: unavailable },
      style: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
      children: [
        ...(single ? [dot(ctx)] : []),
        text(label, textStyle("caption", unavailable ? theme.colors.textFaint : theme.colors.textSecondary), { numberOfLines: 1, style: { flexShrink: 1 } }),
        ...(session.count > 1 ? [text(`×${session.count}`, textStyle("caption", theme.colors.textFaint, { fontVariant: ["tabular-nums"] }))] : []),
        { type: "view", style: { flex: 1 } },
        ...(unavailable ? [] : [icon("chevron-right", 14, theme.colors.textFaint)]),
      ],
    });
  };
  if (single) return { type: "view", style: { marginHorizontal: 16 }, children: [row(sessions[0]!)] };
  return {
    type: "view", style: { marginHorizontal: 16 },
    children: [
      { type: "view", style: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8 }, children: [dot(ctx), text(t("turn.related.sentCount", { count: sessions.length }), textStyle("caption", theme.colors.textMuted))] },
      {
        type: "view", style: { marginLeft: 2, borderLeftWidth: 1, borderLeftColor: color(theme.colors.border), paddingLeft: 12 },
        children: [
          ...visible.map(row),
          ...(collapsed ? [pressable({ action: "toggle", payload: { id }, style: { minHeight: 44, justifyContent: "center" }, children: [text(t("turn.related.showMore", { count: sessions.length - VISIBLE_SENT_SESSIONS }), textStyle("caption", theme.colors.accent))] })] : []),
        ],
      },
    ],
  };
}

export function forkDividerNode(ctx: NodeContext, origin: { spaceId: string; sessionId: string; turnId: string }, view: RelatedSessionView, title: SessionTitle): TimelineNode {
  const { theme, t } = ctx;
  const name = relatedTitle(view, title);
  const unavailable = view.status === "unavailable";
  const label = name ? t("session.forkedFrom", { title: name }) : unavailable ? t("session.forkedFromUnavailable") : t("session.forkedFromChat");
  const tint = unavailable ? theme.colors.textFaint : theme.colors.textMuted;
  const rule: TimelineNode = { type: "view", style: { height: 1, flex: 1, backgroundColor: color(theme.colors.border) } };
  return {
    type: "view", style: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 },
    children: [
      rule,
      pressable({
        action: "openSession", payload: origin, disabled: unavailable, accessibilityRole: "link", accessibilityLabel: label, accessibilityState: { disabled: unavailable },
        style: { maxWidth: "78%", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
        children: [icon("git-fork", 14, tint), text(label, textStyle("caption", tint), { numberOfLines: 1, style: { flexShrink: 1 } }), ...(unavailable ? [] : [icon("chevron-right", 14, theme.colors.textFaint)])],
      }),
      rule,
    ],
  };
}

/** `LoadMoreCapsule`: a short centered capsule at either end of the loaded turns. */
export function loadMoreNode(ctx: NodeContext, edge: "older" | "newer", loading: boolean): TimelineNode {
  const { theme, t } = ctx;
  const label = edge === "older" ? t("chat.loadOlder.short") : t("chat.loadNewer.short");
  return {
    type: "view", style: { alignItems: "center", paddingVertical: 8 },
    children: [{
      type: "view", action: edge === "older" ? "loadOlder" : "loadNewer", disabled: loading, accessibilityRole: "button", accessibilityLabel: edge === "older" ? t("chat.loadOlder") : t("chat.loadNewer"), accessibilityState: { busy: loading, disabled: loading },
      pressedBackgroundColor: color(theme.colors.surfacePressed),
      style: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, backgroundColor: color(theme.colors.surfaceRaised), paddingHorizontal: 16 },
      children: [loading ? loader(ctx) : icon(edge === "older" ? "chevrons-up" : "chevrons-down", 16, theme.colors.accent), text(label, textStyle("caption", theme.colors.accent, { fontWeight: "600" }))],
    }],
  };
}

export const EMPTY_NODE: TimelineNode = { type: "view" };

/** Catch-up rows settle in from just below; the strong ease-out lands them without a tail. */
export function arrivalAnimations(reducedMotion: boolean): TimelineAnimation[] {
  if (reducedMotion) return [{ property: "opacity", keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }], duration: 200 }];
  const easing = [0.23, 1, 0.32, 1] as const;
  return [
    { property: "opacity", keyframes: [{ at: 0, value: 0 }, { at: 1, value: 1 }], duration: 260, easing },
    { property: "translateY", keyframes: [{ at: 0, value: 8 }, { at: 1, value: 0 }], duration: 260, easing },
  ];
}

export const SEND_FLIGHT_EASING = curves.easeOut;

export type { IconName };
