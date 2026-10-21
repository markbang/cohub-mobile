import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ACCENTS, DEFAULT_ACCENT, isAccentId, type AccentId } from "@/src/design/accents";
import { RADIUS, TEXT_RAMP, darkPalette, lightPalette, pureBlackOverrides, type Palette } from "@/src/design/tokens";
export { colorWithOpacity } from "@/src/design/color";

export const edgeChrome = { headerMinHeight: 56, fade: 40, topFade: 24 } as const;

export type AppTheme = {
  mode: "light" | "dark";
  colors: Palette;
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    pill: number;
  };
};

const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const radius = { sm: RADIUS.sm, md: RADIUS.md, lg: RADIUS.lg, pill: 999 };
const darkTheme: AppTheme = { mode: "dark", colors: darkPalette, spacing, radius };
const pureBlackDarkTheme: AppTheme = { ...darkTheme, colors: { ...darkPalette, ...pureBlackOverrides } };
const lightTheme: AppTheme = { mode: "light", colors: lightPalette, spacing, radius };

export type ThemePreference = "system" | "light" | "dark";

const THEME_PREFERENCE_KEY = "cohub:mobile:theme-preference:v1";
const PURE_BLACK_PREFERENCE_KEY = "cohub:mobile:pure-black:v1";
let themePreference: ThemePreference = "system";
let themePreferenceLoaded = false;
let themePreferenceLoad: Promise<void> | null = null;
const themePreferenceListeners = new Set<() => void>();
let pureBlackPreference = false;
let pureBlackPreferenceLoaded = false;
let pureBlackPreferenceLoad: Promise<void> | null = null;
const pureBlackPreferenceListeners = new Set<() => void>();

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function notifyThemePreferenceListeners() {
  for (const listener of themePreferenceListeners) listener();
}

function loadThemePreference() {
  if (themePreferenceLoad) return themePreferenceLoad;
  themePreferenceLoad = AsyncStorage.getItem(THEME_PREFERENCE_KEY)
    .then((value) => {
      if (!themePreferenceLoaded && isThemePreference(value)) themePreference = value;
      themePreferenceLoaded = true;
      notifyThemePreferenceListeners();
    })
    .catch(() => {
      themePreferenceLoaded = true;
    })
    .finally(() => {
      themePreferenceLoad = null;
    });
  return themePreferenceLoad;
}

export function getThemePreference(): ThemePreference {
  return themePreference;
}

export function useThemePreference(): ThemePreference {
  const [preference, setPreference] = useState(themePreference);
  useEffect(() => {
    const listener = () => setPreference(themePreference);
    themePreferenceListeners.add(listener);
    if (!themePreferenceLoaded) void loadThemePreference();
    listener();
    return () => {
      themePreferenceListeners.delete(listener);
    };
  }, []);
  return preference;
}

export async function setThemePreference(next: ThemePreference) {
  themePreference = next;
  themePreferenceLoaded = true;
  notifyThemePreferenceListeners();
  await AsyncStorage.setItem(THEME_PREFERENCE_KEY, next);
}

function notifyPureBlackPreferenceListeners() {
  for (const listener of pureBlackPreferenceListeners) listener();
}

function loadPureBlackPreference() {
  if (pureBlackPreferenceLoad) return pureBlackPreferenceLoad;
  pureBlackPreferenceLoad = AsyncStorage.getItem(PURE_BLACK_PREFERENCE_KEY)
    .then((value) => {
      if (!pureBlackPreferenceLoaded) pureBlackPreference = value === "true";
      pureBlackPreferenceLoaded = true;
      notifyPureBlackPreferenceListeners();
    })
    .catch(() => {
      pureBlackPreferenceLoaded = true;
    })
    .finally(() => {
      pureBlackPreferenceLoad = null;
    });
  return pureBlackPreferenceLoad;
}

export function getPureBlackPreference() {
  return pureBlackPreference;
}

export function usePureBlackPreference() {
  const [enabled, setEnabled] = useState(pureBlackPreference);
  useEffect(() => {
    const listener = () => setEnabled(pureBlackPreference);
    pureBlackPreferenceListeners.add(listener);
    if (!pureBlackPreferenceLoaded) void loadPureBlackPreference();
    listener();
    return () => {
      pureBlackPreferenceListeners.delete(listener);
    };
  }, []);
  return enabled;
}

export async function setPureBlackPreference(next: boolean) {
  pureBlackPreference = next;
  pureBlackPreferenceLoaded = true;
  notifyPureBlackPreferenceListeners();
  await AsyncStorage.setItem(PURE_BLACK_PREFERENCE_KEY, String(next));
}

const ACCENT_PREFERENCE_KEY = "cohub:mobile:accent:v1";
let accentPreference: AccentId = DEFAULT_ACCENT;
let accentPreferenceLoaded = false;
let accentPreferenceLoad: Promise<void> | null = null;
const accentPreferenceListeners = new Set<() => void>();
const notifyAccentPreference = () => accentPreferenceListeners.forEach((listener) => listener());

function loadAccentPreference() {
  if (accentPreferenceLoad) return accentPreferenceLoad;
  accentPreferenceLoad = AsyncStorage.getItem(ACCENT_PREFERENCE_KEY)
    .then((value) => {
      if (!accentPreferenceLoaded && isAccentId(value)) accentPreference = value;
      accentPreferenceLoaded = true;
      notifyAccentPreference();
    })
    .catch(() => {
      accentPreferenceLoaded = true;
    })
    .finally(() => {
      accentPreferenceLoad = null;
    });
  return accentPreferenceLoad;
}

function subscribeAccentPreference(listener: () => void): () => void {
  accentPreferenceListeners.add(listener);
  if (!accentPreferenceLoaded) void loadAccentPreference();
  return () => { accentPreferenceListeners.delete(listener); };
}

export function useAccentPreference(): AccentId {
  return useSyncExternalStore(subscribeAccentPreference, () => accentPreference);
}

export async function setAccentPreference(next: AccentId) {
  accentPreference = next;
  accentPreferenceLoaded = true;
  notifyAccentPreference();
  await AsyncStorage.setItem(ACCENT_PREFERENCE_KEY, next);
}

function themeColors(mode: AppTheme["mode"], pureBlack: boolean, accent: AccentId): Palette {
  const base = mode === "light" ? lightTheme : pureBlack ? pureBlackDarkTheme : darkTheme;
  return accent === DEFAULT_ACCENT ? base.colors : { ...base.colors, ...ACCENTS[accent][mode] };
}

/** Colors for a mode other than the active one (previews, className variables), with the chosen accent. */
export function getAppThemeColors(mode: AppTheme["mode"], pureBlack: boolean): AppTheme["colors"] {
  return themeColors(mode, pureBlack, accentPreference);
}

export function useAppTheme(): AppTheme {
  const colorScheme = useColorScheme();
  const preference = useThemePreference();
  const pureBlack = usePureBlackPreference();
  const fontScale = useFontScalePreference();
  const accent = useAccentPreference();
  const mode = preference === "system"
    ? colorScheme === "light" ? "light" : "dark"
    : preference;
  return useMemo(() => {
    const base = mode === "light" ? lightTheme : pureBlack ? pureBlackDarkTheme : darkTheme;
    if (accent !== DEFAULT_ACCENT) return { ...base, colors: themeColors(mode, pureBlack, accent) };
    // A new object on a scale change re-renders consumers that read the mutable typography tokens.
    return fontScale === "default" ? base : { ...base };
  }, [accent, fontScale, mode, pureBlack]);
}

export type FontScalePreference = "small" | "default" | "large" | "xlarge";

export const FONT_SCALE_VALUES: Record<FontScalePreference, number> = {
  small: 0.9,
  default: 1,
  large: 1.12,
  xlarge: 1.25,
};

const FONT_SCALE_PREFERENCE_KEY = "cohub:mobile:font-scale:v1";
let fontScalePreference: FontScalePreference = "default";
let fontScalePreferenceLoaded = false;
let fontScalePreferenceLoad: Promise<void> | null = null;
const fontScalePreferenceListeners = new Set<() => void>();

function isFontScalePreference(value: string | null): value is FontScalePreference {
  return value === "small" || value === "default" || value === "large" || value === "xlarge";
}

function notifyFontScalePreferenceListeners() {
  for (const listener of fontScalePreferenceListeners) listener();
}

function loadFontScalePreference() {
  if (fontScalePreferenceLoad) return fontScalePreferenceLoad;
  fontScalePreferenceLoad = AsyncStorage.getItem(FONT_SCALE_PREFERENCE_KEY)
    .then((value) => {
      if (!fontScalePreferenceLoaded && isFontScalePreference(value)) {
        fontScalePreference = value;
        applyFontScale(FONT_SCALE_VALUES[value]);
      }
      fontScalePreferenceLoaded = true;
      notifyFontScalePreferenceListeners();
    })
    .catch(() => {
      fontScalePreferenceLoaded = true;
    })
    .finally(() => {
      fontScalePreferenceLoad = null;
    });
  return fontScalePreferenceLoad;
}

export function getFontScalePreference(): FontScalePreference {
  return fontScalePreference;
}

export function useFontScalePreference(): FontScalePreference {
  const [preference, setPreference] = useState(fontScalePreference);
  useEffect(() => {
    const listener = () => setPreference(fontScalePreference);
    fontScalePreferenceListeners.add(listener);
    if (!fontScalePreferenceLoaded) void loadFontScalePreference();
    listener();
    return () => {
      fontScalePreferenceListeners.delete(listener);
    };
  }, []);
  return preference;
}

export async function setFontScalePreference(next: FontScalePreference) {
  fontScalePreference = next;
  fontScalePreferenceLoaded = true;
  applyFontScale(FONT_SCALE_VALUES[next]);
  notifyFontScalePreferenceListeners();
  await AsyncStorage.setItem(FONT_SCALE_PREFERENCE_KEY, next);
}

export type TypographyToken =
  | "display"
  | "title"
  | "heading"
  | "body"
  | "bodyMedium"
  | "chatBody"
  | "caption"
  | "eyebrow"
  | "micro"
  | "code";

type TypographyStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
  letterSpacing?: number;
};

/** The ramp owns default weights (caption 500, micro 600); pass a weight only for deliberate emphasis. */
const ramp = (token: keyof typeof TEXT_RAMP, fontWeight?: TypographyStyle["fontWeight"]) => ({
  fontSize: TEXT_RAMP[token].size,
  lineHeight: TEXT_RAMP[token].lineHeight,
  fontWeight: fontWeight ?? (String(TEXT_RAMP[token].weight ?? 400) as TypographyStyle["fontWeight"]),
});

/** Legacy JS styles for screens not yet on className; same ramp as the `text-*` utilities. */
const BASE_TYPOGRAPHY: Record<TypographyToken, TypographyStyle> = {
  display: ramp("display", "700"),
  title: ramp("title", "700"),
  heading: ramp("headline", "600"),
  body: ramp("body"),
  bodyMedium: ramp("body", "600"),
  chatBody: ramp("chat"),
  caption: ramp("caption"),
  eyebrow: ramp("caption", "600"),
  micro: ramp("micro"),
  code: ramp("code"),
};

/** Mutable tokens: components read them at render time, so a scale change re-renders with new metrics. */
export const typography: Record<TypographyToken, TypographyStyle> = { ...BASE_TYPOGRAPHY };

function applyFontScale(scale: number) {
  for (const token of Object.keys(BASE_TYPOGRAPHY) as TypographyToken[]) {
    const base = BASE_TYPOGRAPHY[token];
    typography[token] = {
      ...base,
      fontSize: scaleTextMetric(base.fontSize, scale, "size"),
      lineHeight: scaleTextMetric(base.lineHeight, scale, "lineHeight"),
      ...(base.letterSpacing === undefined ? null : { letterSpacing: Math.round(base.letterSpacing * scale * 100) / 100 }),
    };
  }
}

export function getFontScale() {
  return FONT_SCALE_VALUES[fontScalePreference];
}

/** Rounds a ramp size for a given scale; shared by the JS ramp and the `--text-*` variables. */
export function scaleTextMetric(size: number, scale: number, kind: "size" | "lineHeight") {
  return kind === "size" ? Math.round(size * scale * 2) / 2 : Math.round(size * scale);
}

export function scaleFontSize(size: number) {
  return Math.round(size * getFontScale() * 2) / 2;
}

export function scaleLineHeight(size: number) {
  return Math.round(size * getFontScale());
}
