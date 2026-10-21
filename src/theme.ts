import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { compileConfigTheme, type ConfigThemePalette } from "@/src/data/config-theme";
import type { ConfigThemeUpdate } from "@/src/data/config-theme-sync";
import { RADIUS, TEXT_RAMP, darkPalette, lightPalette, pureBlackOverrides, type Palette } from "@/src/design/tokens";
export { colorWithOpacity } from "@/src/data/config-theme";

export const edgeChrome = { headerMinHeight: 56, fade: 40 } as const;

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

export type CustomThemeState = ConfigThemeUpdate & { enabled: boolean; warnings: string[] };
const CUSTOM_THEME_ENABLED_KEY = "cohub:mobile:custom-theme-enabled:v1";
let customThemeState: CustomThemeState = { spaceId: null, css: null, enabled: true, loading: false, error: null, warnings: [] };
let customPalette: ConfigThemePalette = { light: {}, dark: {}, warnings: [] };
let customThemeOwner: symbol | null = null;
let customEnabledLoaded = false;
let customEnabledLoad: Promise<void> | null = null;
const customThemeListeners = new Set<() => void>();
const notifyCustomTheme = () => customThemeListeners.forEach((listener) => listener());

export function beginConfigTheme(): { update(value: ConfigThemeUpdate): void; dispose(): void } {
  const owner = Symbol("config-theme");
  customThemeOwner = owner;
  customPalette = { light: {}, dark: {}, warnings: [] };
  customThemeState = { ...customThemeState, spaceId: null, css: null, loading: true, error: null, warnings: [] };
  notifyCustomTheme();
  return {
    update(value) {
      if (customThemeOwner !== owner) return;
      if (value.css !== customThemeState.css) {
        customPalette = value.css === null ? { light: {}, dark: {}, warnings: [] }
          : compileConfigTheme(value.css, { light: lightTheme.colors, dark: darkTheme.colors });
      }
      customThemeState = { ...customThemeState, ...value, warnings: customPalette.warnings };
      notifyCustomTheme();
    },
    dispose() {
      if (customThemeOwner !== owner) return;
      customThemeOwner = null;
      customPalette = { light: {}, dark: {}, warnings: [] };
      customThemeState = { ...customThemeState, spaceId: null, css: null, loading: false, error: null, warnings: [] };
      notifyCustomTheme();
    },
  };
}

export async function setCustomThemeEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CUSTOM_THEME_ENABLED_KEY, String(enabled));
    customEnabledLoaded = true;
    customThemeState = { ...customThemeState, enabled };
    notifyCustomTheme();
  } catch (error) {
    customThemeState = { ...customThemeState, error: "Unable to save the custom theme preference. Retry in Appearance." };
    notifyCustomTheme();
    throw error;
  }
}

function subscribeCustomTheme(listener: () => void): () => void {
  customThemeListeners.add(listener);
  return () => { customThemeListeners.delete(listener); };
}

export function useCustomThemeState(): CustomThemeState {
  const snapshot = useSyncExternalStore(subscribeCustomTheme, () => customThemeState);
  useEffect(() => {
    if (customEnabledLoaded || customEnabledLoad) return;
    customEnabledLoad = AsyncStorage.getItem(CUSTOM_THEME_ENABLED_KEY).then((value) => {
      if (customEnabledLoaded) return;
      customEnabledLoaded = true;
      customThemeState = { ...customThemeState, enabled: value !== "false" };
      notifyCustomTheme();
    }).catch(() => {
      customEnabledLoaded = true;
      customThemeState = { ...customThemeState, error: "Unable to load the custom theme preference. Retry in Appearance." };
      notifyCustomTheme();
    }).finally(() => { customEnabledLoad = null; });
  }, []);
  return snapshot;
}

export function getAppThemeColors(mode: AppTheme["mode"], pureBlack: boolean): AppTheme["colors"] {
  const base = mode === "light" ? lightTheme : pureBlack ? pureBlackDarkTheme : darkTheme;
  return customThemeState.enabled ? { ...base.colors, ...customPalette[mode] } : base.colors;
}

export function useAppTheme(): AppTheme {
  const colorScheme = useColorScheme();
  const preference = useThemePreference();
  const pureBlack = usePureBlackPreference();
  const fontScale = useFontScalePreference();
  const custom = useCustomThemeState();
  const mode = preference === "system"
    ? colorScheme === "light" ? "light" : "dark"
    : preference;
  const base = mode === "light" ? lightTheme : pureBlack ? pureBlackDarkTheme : darkTheme;
  const overrides = custom.enabled ? customPalette[mode] : null;
  return useMemo(() => {
    if (overrides && Object.keys(overrides).length) return { ...base, colors: { ...base.colors, ...overrides } };
    return fontScale === "default" ? base : { ...base };
  }, [base, fontScale, overrides]);
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
