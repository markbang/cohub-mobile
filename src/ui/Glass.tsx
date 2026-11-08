import { BlurView } from "expo-blur";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable, type GlassStyle } from "expo-glass-effect";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { converter, formatHex8 } from "culori";
import { AccessibilityInfo, PixelRatio, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colorWithOpacity, useAppTheme } from "@/src/theme";

/**
 * iOS 26 Liquid Glass. Checked once: neither the OS nor the API changes while the app runs, and some
 * iOS 26 betas ship the component without the API, which crashes (expo/expo#40911).
 */
export const liquidGlass = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/** The system Reduce Transparency setting; glass and blur give way to solid surfaces under it. */
export function useReduceTransparency() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => { if (active) setReduce(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

export type GlassMaterial = "liquid" | "frosted" | "solid";

// Android blurs only a view it is pointed at, through RenderEffect from Android 12.
export const androidBlur = Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 31;

/**
 * Which glass a surface can draw here: Liquid Glass on iOS 26; a system blur on older iOS, or on
 * Android 12+ when the surface has a blur target (Android blurs only a view it is pointed at); else solid.
 */
export function useGlassMaterial(options?: { blurTarget?: RefObject<View | null> | null }): GlassMaterial {
  const reduce = useReduceTransparency();
  if (reduce) return "solid";
  if (liquidGlass) return "liquid";
  if (Platform.OS === "ios" || (androidBlur && options?.blurTarget)) return "frosted";
  return "solid";
}

/**
 * The content a screen's floating glass blurs on Android (`GlassBackdrop`), and whether the glass reading it
 * is drawn inside that content: a view cannot blur a target that contains it, so glass there stays solid.
 */
const GlassBackdropContext = createContext<{ target: RefObject<View | null> | null; inside: boolean }>({ target: null, inside: false });

/**
 * Gives the glass drawn over a screen's content (bars, menus, the composer, alerts) that content to blur; `null`
 * keeps glass solid, as over a surface of its own. `undefined` passes the outer backdrop through.
 */
export function GlassBackdrop({ target, children }: { target: RefObject<View | null> | null | undefined; children: ReactNode }) {
  const outer = useContext(GlassBackdropContext);
  const value = useMemo(() => target === undefined ? outer : { target, inside: false }, [outer, target]);
  return <GlassBackdropContext.Provider value={value}>{children}</GlassBackdropContext.Provider>;
}

/**
 * Keeps the outer backdrop and says where glass sits: `inside` the blur target's own content (part of what gets
 * blurred), or not, as in a native Modal, which is its own window and so may blur the screen again.
 */
export function GlassBackdropScope({ inside, children }: { inside: boolean; children: ReactNode }) {
  const { target } = useContext(GlassBackdropContext);
  const value = useMemo(() => ({ target, inside }), [inside, target]);
  return <GlassBackdropContext.Provider value={value}>{children}</GlassBackdropContext.Provider>;
}

/**
 * expo-blur hands Dimezis `intensity / blurReductionFactor`, which it multiplies by 4 into RenderEffect's
 * radius, and HWUI turns that radius into σ = 0.57735 r + 0.5 px. At intensity 1 expo-blur's own tint, which
 * scales with intensity, is near zero, so callers draw the tint themselves.
 */
export function blurReduction(sigma: number) {
  const radius = Math.max(0.01, (PixelRatio.getPixelSizeForLayoutSize(sigma) - 0.5) / 0.57735 / 4);
  return 1 / radius;
}

export type GlassSurface = "glassControl" | "glassMenu" | "glassComposer" | "glassBar" | "glassButton" | "dialogSurface";

// How much of the blurred backdrop a frosted surface covers. iOS 27's menus and composer let what passes under
// them show as soft streaks; near 0.8 the tint also keeps Dimezis's 15% grain, which iOS lacks, out of sight.
const FROST_OPACITY: Record<GlassSurface, number> = { glassControl: 0.8, glassMenu: 0.78, glassComposer: 0.78, glassBar: 0.8, glassButton: 0.8, dialogSurface: 0.86 };
const FROST_SIGMA = 6;

/**
 * The tint that, drawn at `opacity` over the page background, gives `color`: what iOS's glass measures over
 * an empty page. Over content the backdrop shows through by `1 - opacity`.
 */
function frostTint(color: string, background: string, opacity: number) {
  const target = converter("rgb")(color);
  const page = converter("rgb")(background);
  if (!target || !page) throw new Error(`Invalid glass color "${color}" or page "${background}". Fix the token in src/design/tokens.ts.`);
  const channel = (value: number, under: number) => Math.min(1, Math.max(0, (value - (1 - opacity) * under) / opacity));
  return formatHex8({ mode: "rgb", r: channel(target.r, page.r), g: channel(target.g, page.g), b: channel(target.b, page.b), alpha: opacity });
}

type GlassBackgroundProps = {
  /** Corner radius of the surface; the glass is clipped to it. */
  radius: number;
  glass?: Exclude<GlassStyle, "none">;
  /** Tints Liquid Glass; elsewhere the surface is drawn solid in this color. */
  tint?: string;
  /** The color the glass reads as over an empty page; solid surfaces fill with it. */
  surface?: GlassSurface;
  /** Overrides the screen's backdrop (`GlassBackdrop`), for chrome outside any screen such as the tab bar. */
  blurTarget?: RefObject<View | null> | null;
  style?: StyleProp<ViewStyle>;
};

/**
 * The material behind a floating control, drawn as an absolutely filled layer so the control keeps
 * its own view (refs, measurement, layout) and only its backdrop changes with the platform. Touches
 * belong to the control above it, so Liquid Glass's own touch response is not used. Android draws iOS 27's
 * glass as measured: in light mode a hairline rim, in dark mode none.
 */
export function GlassBackground({ radius, glass = "regular", tint, surface = "glassControl", blurTarget, style }: GlassBackgroundProps) {
  const theme = useAppTheme();
  const backdrop = useContext(GlassBackdropContext);
  const target = blurTarget !== undefined ? blurTarget : backdrop.inside ? null : backdrop.target;
  const material = useGlassMaterial({ blurTarget: tint ? null : target });
  const shape = { borderRadius: radius, borderCurve: "continuous" as const };
  if (material === "liquid") {
    return <GlassView pointerEvents="none" glassEffectStyle={glass} tintColor={tint} colorScheme={theme.mode} style={[StyleSheet.absoluteFill, shape, style]} />;
  }
  // design-system-begin: the rim and the frosted tint derive from theme tokens at runtime, so they follow Config themes.
  const rim = Platform.OS === "android" && theme.mode === "light" && !tint ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colorWithOpacity(theme.colors.shadow, 0.14) } : null;
  if (material === "frosted" && Platform.OS === "ios") {
    const dark = theme.mode === "dark";
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { overflow: "hidden" }, style]}>
      <BlurView intensity={80} tint={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, shape, {
        backgroundColor: colorWithOpacity(tint ?? theme.colors.surfaceFloat, tint ? 0.85 : dark ? 0.45 : 0.55),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colorWithOpacity(dark ? theme.colors.text : theme.colors.surfaceFloat, dark ? 0.14 : 0.8),
      }]} />
    </View>;
  }
  if (material === "frosted" && target) {
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { overflow: "hidden" }, style]}>
      <BlurView intensity={1} blurReductionFactor={blurReduction(FROST_SIGMA)} blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, shape, { backgroundColor: frostTint(theme.colors[surface], theme.colors.background, FROST_OPACITY[surface]) }, rim]} />
    </View>;
  }
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { backgroundColor: tint ?? theme.colors[surface] }, rim, style]} />;
  // design-system-end
}

/** Lets neighbouring Liquid Glass shapes merge as they near each other; a plain view elsewhere. */
export function GlassGroup({ spacing, style, pointerEvents, children }: { spacing: number; style?: StyleProp<ViewStyle>; pointerEvents?: "none" | "box-none"; children: ReactNode }) {
  return liquidGlass ? <GlassContainer spacing={spacing} style={style} pointerEvents={pointerEvents}>{children}</GlassContainer> : <View style={style} pointerEvents={pointerEvents}>{children}</View>;
}
