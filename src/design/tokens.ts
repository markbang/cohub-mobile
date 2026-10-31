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

// From the app icon: warm paper and a pure white card, like its face on the orange. The icon's orange fails
// 4.5:1 as text on paper, so the light accent sits just past the dark end of its gradient.
export const lightPalette: Palette = {
  background: "#f6f3ee",
  surface: "#ffffff",
  surfaceRaised: "#efebe4",
  surfacePressed: "#e6e1d8",
  surfaceFloat: "#ffffff",
  pressOverlay: "rgba(8, 9, 11, 0.08)",
  border: "#e8e3da",
  borderStrong: "#cdc6ba",
  text: "#16130f",
  textSecondary: "#4a453e",
  textMuted: "#5c564e",
  textFaint: "#6b645a",
  accent: "#bf3f00",
  accentPressed: "#a03400",
  accentSoft: "#fff0e4",
  accentBorder: "#f2b78e",
  accentText: "#ffffff",
  userBubble: "#b43a00",
  userBubbleText: "#ffffff",
  userBubbleLink: "#ffe9db",
  userBubbleCodeBackground: "rgba(8, 9, 11, 0.18)",
  userBubbleMeta: "rgba(255, 255, 255, 0.92)",
  assistantBubble: "#ffffff",
  assistantBubbleText: "#16130f",
  success: "#1c7a4a",
  successSoft: "#e6f5ec",
  warning: "#8a6010",
  warningSoft: "#fdf3d8",
  danger: "#bf2b3c",
  dangerSoft: "#fdeaec",
  dangerText: "#ffffff",
  info: "#3a68a8",
  infoSoft: "#e9f0fb",
  shadow: "#08090b",
};

// The icon's ink, warmed to one grey family. Dark mode only lightens as surfaces nest: a darker step inside a
// lighter one reads as a hole. The accent takes the icon's own pairing, ink on orange.
export const darkPalette: Palette = {
  background: "#0c0a09",
  surface: "#1a1715",
  surfaceRaised: "#25221e",
  surfacePressed: "#302c27",
  // A shadow barely shows on a dark page, so floating chrome steps up a level instead of drawing a border.
  surfaceFloat: "#25221e",
  pressOverlay: "rgba(255, 255, 255, 0.12)",
  border: "#2b2825",
  borderStrong: "#443f39",
  text: "#faf7f2",
  textSecondary: "#d7d2ca",
  textMuted: "#a9a39a",
  // Faint 11–12px text must keep 4.5:1 on raised dark surfaces.
  textFaint: "#938c82",
  accent: "#ff8a3d",
  accentPressed: "#ec7428",
  accentSoft: "#38231a",
  accentBorder: "#8a4f2c",
  accentText: "#1c0d02",
  userBubble: "#b43a00",
  userBubbleText: "#fff7f1",
  userBubbleLink: "#ffe9db",
  userBubbleCodeBackground: "rgba(8, 9, 11, 0.24)",
  userBubbleMeta: "rgba(255, 247, 241, 0.92)",
  assistantBubble: "#1a1715",
  assistantBubbleText: "#faf7f2",
  success: "#62c994",
  successSoft: "#1b3127",
  warning: "#e6b85c",
  warningSoft: "#362d1b",
  danger: "#f2787f",
  dangerSoft: "#3a2024",
  dangerText: "#2a1014",
  info: "#83a9e8",
  infoSoft: "#1f2b3f",
  shadow: "#000000",
};

/** Applied over `darkPalette` when the pure black preference is on. */
export const pureBlackOverrides: Partial<Palette> = {
  background: "#000000",
  surface: "#131110",
  surfaceRaised: "#1e1b19",
  surfacePressed: "#2a2623",
  surfaceFloat: "#1e1b19",
  border: "#262320",
  borderStrong: "#3e3934",
  userBubbleCodeBackground: "rgba(0, 0, 0, 0.24)",
  assistantBubble: "#131110",
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
