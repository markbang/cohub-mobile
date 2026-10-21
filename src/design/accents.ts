import { darkPalette, lightPalette, type Palette } from "@/src/design/tokens";

type AccentTokens = Pick<Palette, "accent" | "accentPressed" | "accentSoft" | "accentBorder" | "accentText" | "userBubble" | "userBubbleText" | "userBubbleLink">;

export const ACCENT_IDS = ["ember", "blue", "violet", "rose", "teal", "green", "amber", "graphite"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];
export const DEFAULT_ACCENT: AccentId = "ember";

const pick = (palette: Palette): AccentTokens => ({
  accent: palette.accent,
  accentPressed: palette.accentPressed,
  accentSoft: palette.accentSoft,
  accentBorder: palette.accentBorder,
  accentText: palette.accentText,
  userBubble: palette.userBubble,
  userBubbleText: palette.userBubbleText,
  userBubbleLink: palette.userBubbleLink,
});

/**
 * Hand-tuned per mode rather than derived from one hue, so every preset keeps the contrast the
 * default does: accent text and fills ≥ 4.5:1 on surfaces, `accentText` on `accent`, and bubble
 * text and links on `userBubble`. Ember is the base palette, so the default stays unchanged.
 */
export const ACCENTS: Record<AccentId, { light: AccentTokens; dark: AccentTokens }> = {
  ember: { light: pick(lightPalette), dark: pick(darkPalette) },
  blue: {
    light: { accent: "#2160c4", accentPressed: "#1a4fa3", accentSoft: "#e9f0fd", accentBorder: "#a9c3ef", accentText: "#ffffff", userBubble: "#1f5ab8", userBubbleText: "#ffffff", userBubbleLink: "#dbe7ff" },
    dark: { accent: "#6ea4ff", accentPressed: "#4f8ef2", accentSoft: "#1c2a42", accentBorder: "#35558a", accentText: "#0a1a33", userBubble: "#1f5ab8", userBubbleText: "#f3f7ff", userBubbleLink: "#dbe7ff" },
  },
  violet: {
    light: { accent: "#7046c9", accentPressed: "#5c37ab", accentSoft: "#f2edfd", accentBorder: "#c7b4ef", accentText: "#ffffff", userBubble: "#6740bd", userBubbleText: "#ffffff", userBubbleLink: "#e9e0ff" },
    dark: { accent: "#ad8dff", accentPressed: "#9373f0", accentSoft: "#2a2240", accentBorder: "#5a478f", accentText: "#1c1236", userBubble: "#6740bd", userBubbleText: "#f8f5ff", userBubbleLink: "#e9e0ff" },
  },
  rose: {
    light: { accent: "#bc3466", accentPressed: "#9d2954", accentSoft: "#fdebf1", accentBorder: "#eeadc4", accentText: "#ffffff", userBubble: "#ab2e5c", userBubbleText: "#ffffff", userBubbleLink: "#ffdbe7" },
    dark: { accent: "#f57ea8", accentPressed: "#e0628f", accentSoft: "#3c1f2a", accentBorder: "#87405a", accentText: "#36101f", userBubble: "#ab2e5c", userBubbleText: "#fff4f7", userBubbleLink: "#ffdbe7" },
  },
  teal: {
    light: { accent: "#0b7470", accentPressed: "#085f5c", accentSoft: "#e2f4f2", accentBorder: "#9fd6d1", accentText: "#ffffff", userBubble: "#0a6c68", userBubbleText: "#ffffff", userBubbleLink: "#d2f5f1" },
    dark: { accent: "#45c5ba", accentPressed: "#2eaca2", accentSoft: "#16302e", accentBorder: "#2b6a65", accentText: "#052522", userBubble: "#0a6c68", userBubbleText: "#f1fbfa", userBubbleLink: "#d2f5f1" },
  },
  green: {
    light: { accent: "#2b7a3a", accentPressed: "#22662f", accentSoft: "#e7f4e9", accentBorder: "#a8d6b0", accentText: "#ffffff", userBubble: "#287035", userBubbleText: "#ffffff", userBubbleLink: "#daf5df" },
    dark: { accent: "#6cca7c", accentPressed: "#52b363", accentSoft: "#1b3120", accentBorder: "#36673f", accentText: "#0b2511", userBubble: "#287035", userBubbleText: "#f3fbf4", userBubbleLink: "#daf5df" },
  },
  amber: {
    light: { accent: "#8c6200", accentPressed: "#745100", accentSoft: "#fbf1d9", accentBorder: "#e2c780", accentText: "#ffffff", userBubble: "#865e00", userBubbleText: "#ffffff", userBubbleLink: "#fff0c9" },
    dark: { accent: "#eeb444", accentPressed: "#d69c2c", accentSoft: "#362b14", accentBorder: "#7a6129", accentText: "#2a1d00", userBubble: "#865e00", userBubbleText: "#fffaf0", userBubbleLink: "#fff0c9" },
  },
  graphite: {
    light: { accent: "#454c57", accentPressed: "#353b44", accentSoft: "#eceef1", accentBorder: "#c3c8cf", accentText: "#ffffff", userBubble: "#3d444e", userBubbleText: "#ffffff", userBubbleLink: "#e2e6ec" },
    dark: { accent: "#c9cfd8", accentPressed: "#aeb5bf", accentSoft: "#2a2e35", accentBorder: "#4f5661", accentText: "#16191d", userBubble: "#3d444e", userBubbleText: "#f5f7fa", userBubbleLink: "#e2e6ec" },
  },
};

export function isAccentId(value: string | null): value is AccentId {
  return value !== null && (ACCENT_IDS as readonly string[]).includes(value);
}
