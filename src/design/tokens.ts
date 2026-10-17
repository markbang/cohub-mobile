/**
 * Design tokens: the only place visual values are defined. `theme.ts` reads them for JS
 * consumers (icons, Reanimated, native props) and `scripts/design-tokens.mjs` writes
 * `global.css` from them for `className` styling. Keep this file free of imports so the
 * generator can load it in Node.
 */

export type ColorKey =
  | "background" | "surface" | "surfaceRaised" | "surfacePressed" | "pressOverlay"
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

export const lightPalette: Palette = {
  background: "#f7f7f5",
  surface: "#ffffff",
  surfaceRaised: "#f0f1ef",
  surfacePressed: "#e6e8e5",
  pressOverlay: "rgba(29, 32, 36, 0.10)",
  border: "#e1e3df",
  borderStrong: "#c9cdc8",
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
  assistantBubble: "#eceee9",
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

export const darkPalette: Palette = {
  background: "#0f1114",
  surface: "#171a1f",
  surfaceRaised: "#22262e",
  surfacePressed: "#2b3039",
  pressOverlay: "rgba(255, 255, 255, 0.12)",
  border: "#2d333c",
  borderStrong: "#424a56",
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
  assistantBubble: "#22262e",
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
  surface: "#070809",
  surfaceRaised: "#15171a",
  surfacePressed: "#23262b",
  border: "#25292f",
  borderStrong: "#3b424d",
  userBubbleCodeBackground: "rgba(0, 0, 0, 0.24)",
  assistantBubble: "#15171a",
};

export type TextToken = "display" | "title" | "headline" | "body" | "chat" | "subhead" | "caption" | "micro" | "code";

/**
 * Size, line height, and the default weight. A `font-*` class overrides the weight, so emphasis
 * never forks the ramp. Small text defaults heavier to stay legible. Minimum 11.
 */
export const TEXT_RAMP: Record<TextToken, { size: number; lineHeight: number; weight?: 500 | 600 }> = {
  display: { size: 28, lineHeight: 34 },
  title: { size: 20, lineHeight: 26 },
  headline: { size: 17, lineHeight: 22 },
  body: { size: 15, lineHeight: 22 },
  chat: { size: 15, lineHeight: 23 },
  subhead: { size: 13, lineHeight: 18 },
  caption: { size: 12, lineHeight: 16, weight: 500 },
  micro: { size: 11, lineHeight: 14, weight: 600 },
  code: { size: 12, lineHeight: 19 },
};

/** One stated rule: tags 6, controls 10, cards and menus 14, sheets and the composer 20, capsules full. */
export const RADIUS = { xs: 6, sm: 10, md: 14, lg: 20 } as const;

/** Leading avatar or icon tile in content lists; row height, separator inset, and skeleton follow it. */
export const LIST_AVATAR_SIZE = 46;

/**
 * Only floating chrome (tab bar, menus, toasts, banners) casts a shadow; content stays flat.
 * The color is fixed black on purpose: a shadow is darkness, not a themed hue, so Config themes do not tint it.
 */
export const SHADOW_FLOAT = "0 6px 20px rgba(0, 0, 0, 0.14)";
