/**
 * Design tokens: the only place visual values are defined. `theme.ts` reads them for JS
 * consumers (icons, Reanimated, native props) and `scripts/design-tokens.mjs` writes
 * `global.css` from them for `className` styling. Keep this file free of imports so the
 * generator can load it in Node.
 */

export type ColorKey =
  | "background" | "surface" | "surfaceRaised" | "surfacePressed" | "surfaceFloat" | "pressOverlay"
  | "border" | "borderStrong"
  | "text" | "textSecondary" | "textMuted" | "textFaint"
  | "accent" | "accentPressed" | "accentSoft" | "accentBorder" | "accentText"
  | "userBubble" | "userBubbleText" | "userBubbleLink" | "userBubbleCodeBackground" | "userBubbleMeta"
  | "assistantBubble" | "assistantBubbleText"
  | "success" | "successSoft" | "warning" | "warningSoft"
  | "danger" | "dangerSoft" | "dangerText" | "info" | "infoSoft"
  | "shadow";

export type Palette = Record<ColorKey, string>;

/** CSS names read as utilities: `text-fg-muted`, `bg-surface-raised`, `text-on-accent`. */
export const COLOR_CSS_NAMES: Record<ColorKey, string> = {
  background: "background",
  surface: "surface",
  surfaceRaised: "surface-raised",
  surfacePressed: "surface-pressed",
  surfaceFloat: "surface-float",
  pressOverlay: "press-overlay",
  border: "border",
  borderStrong: "border-strong",
  text: "fg",
  textSecondary: "fg-secondary",
  textMuted: "fg-muted",
  textFaint: "fg-faint",
  accent: "accent",
  accentPressed: "accent-pressed",
  accentSoft: "accent-soft",
  accentBorder: "accent-border",
  accentText: "on-accent",
  userBubble: "user-bubble",
  userBubbleText: "on-user-bubble",
  userBubbleLink: "user-bubble-link",
  userBubbleCodeBackground: "user-bubble-code",
  userBubbleMeta: "user-bubble-meta",
  assistantBubble: "assistant-bubble",
  assistantBubbleText: "on-assistant-bubble",
  success: "success",
  successSoft: "success-soft",
  warning: "warning",
  warningSoft: "warning-soft",
  danger: "danger",
  dangerSoft: "danger-soft",
  dangerText: "on-danger",
  info: "info",
  infoSoft: "info-soft",
  shadow: "shadow",
};

// Light mode alternates gray and paper: a near-white card on a gray page, a gray well in the card.
// Cards stop short of pure white so they do not glare beside the tinted page.
export const lightPalette: Palette = {
  background: "#f0f0ec",
  surface: "#fcfcfa",
  surfaceRaised: "#e8e8e3",
  surfacePressed: "#dedfd9",
  surfaceFloat: "#fcfcfa",
  pressOverlay: "rgba(29, 32, 36, 0.10)",
  border: "#e0e0da",
  borderStrong: "#c9cac3",
  text: "#1d2024",
  textSecondary: "#4d535c",
  textMuted: "#59616b",
  textFaint: "#666f78",
  accent: "#b85427",
  accentPressed: "#98421c",
  accentSoft: "#fff0e8",
  accentBorder: "#e9b49a",
  accentText: "#ffffff",
  userBubble: "#a34820",
  userBubbleText: "#ffffff",
  userBubbleLink: "#ffe0cf",
  userBubbleCodeBackground: "rgba(29, 32, 36, 0.18)",
  userBubbleMeta: "rgba(255, 255, 255, 0.88)",
  assistantBubble: "#fcfcfa",
  assistantBubbleText: "#1d2024",
  success: "#238552",
  successSoft: "#e7f5ed",
  warning: "#986b12",
  warningSoft: "#fff5d9",
  danger: "#b34242",
  dangerSoft: "#fdeaea",
  dangerText: "#ffffff",
  info: "#416fae",
  infoSoft: "#eaf1fc",
  shadow: "#15202b",
};

// Dark mode only lightens as surfaces nest: a darker step inside a lighter one reads as a hole.
export const darkPalette: Palette = {
  background: "#0c0d10",
  surface: "#1a1c21",
  surfaceRaised: "#25282f",
  surfacePressed: "#30343c",
  // A shadow barely shows on a dark page, so floating chrome steps up a level instead of drawing a border.
  surfaceFloat: "#25282f",
  pressOverlay: "rgba(255, 255, 255, 0.12)",
  border: "#2c3039",
  borderStrong: "#434954",
  text: "#f7f8fa",
  textSecondary: "#d0d5dd",
  textMuted: "#a2aab6",
  // Lightened from #747e8c: faint 11–12px text must keep 4.5:1 on raised dark surfaces.
  textFaint: "#8a939f",
  accent: "#f08349",
  accentPressed: "#d96835",
  accentSoft: "#36251e",
  accentBorder: "#865038",
  accentText: "#2a150c",
  userBubble: "#a34820",
  userBubbleText: "#fff6f0",
  userBubbleLink: "#ffe0cf",
  userBubbleCodeBackground: "rgba(15, 17, 20, 0.24)",
  userBubbleMeta: "rgba(255, 246, 240, 0.88)",
  assistantBubble: "#1a1c21",
  assistantBubbleText: "#f7f8fa",
  success: "#62c994",
  successSoft: "#1d3329",
  warning: "#e6b85c",
  warningSoft: "#382f1d",
  danger: "#e47d7d",
  dangerSoft: "#392123",
  dangerText: "#2a1515",
  info: "#83a9e8",
  infoSoft: "#202d42",
  shadow: "#000000",
};

/** Applied over `darkPalette` when the pure black preference is on. */
export const pureBlackOverrides: Partial<Palette> = {
  background: "#000000",
  surface: "#121316",
  surfaceRaised: "#1d1f23",
  surfacePressed: "#292c31",
  surfaceFloat: "#1d1f23",
  border: "#24272c",
  borderStrong: "#3b424d",
  userBubbleCodeBackground: "rgba(0, 0, 0, 0.24)",
  assistantBubble: "#121316",
};

export type TextToken = "display" | "title" | "headline" | "body" | "chat" | "subhead" | "caption" | "micro" | "code";

/**
 * Size, line height, and the default weight, on Apple's Dynamic Type scale: display is the Large
 * Title, title Title 2, body and headline 17, subhead the Subheadline, caption the Footnote. A
 * `font-*` class overrides the weight, so emphasis never forks the ramp. Small text defaults heavier
 * to stay legible. Minimum 11.
 */
export const TEXT_RAMP: Record<TextToken, { size: number; lineHeight: number; weight?: 500 | 600 }> = {
  display: { size: 34, lineHeight: 41 },
  title: { size: 22, lineHeight: 28 },
  headline: { size: 17, lineHeight: 22 },
  body: { size: 17, lineHeight: 22 },
  chat: { size: 17, lineHeight: 24 },
  subhead: { size: 15, lineHeight: 20 },
  caption: { size: 13, lineHeight: 18, weight: 500 },
  micro: { size: 11, lineHeight: 14, weight: 600 },
  code: { size: 13, lineHeight: 20 },
};

/**
 * Picked by a shape's shortest side: tags and wells 8, controls 14, cards, menus, and bubbles 20,
 * sheets 28, capsules full. Nested shapes derive theirs (outer = inner + inset) instead of adding a token.
 */
export const RADIUS = { xs: 8, sm: 14, md: 20, lg: 28 } as const;

/**
 * File-type hues: a recognizable legend across themes (code, config, sheets, images, audio,
 * video, archives, data), shown only as icon tint on a 12% wash, never as an accent.
 */
export const FILE_TYPE_COLORS = {
  code: "#6366f1",
  config: "#f59e0b",
  sheet: "#16a34a",
  image: "#ec4899",
  audio: "#a855f7",
  video: "#ef4444",
  archive: "#0891b2",
  data: "#0284c7",
  other: "#8b8b8b",
} as const;

/** Leading avatar or icon tile in content lists; row height, separator inset, and skeleton follow it. */
export const LIST_AVATAR_SIZE = 46;

/**
 * Only floating chrome (tab bar, menus, toasts, banners) casts a shadow; content stays flat.
 * The color is fixed black on purpose: a shadow is darkness, not a themed hue, so Config themes do not tint it.
 */
export const SHADOW_FLOAT = "0 6px 20px rgba(0, 0, 0, 0.14)";
