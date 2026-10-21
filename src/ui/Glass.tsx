import { BlurView } from "expo-blur";
import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable, type GlassStyle } from "expo-glass-effect";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
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

/**
 * Which glass a surface can draw here: Liquid Glass on iOS 26; a system blur on older iOS, or on
 * Android when the surface has a blur target (Android blurs only a view it is pointed at); else solid.
 */
export function useGlassMaterial(options?: { blurTarget?: RefObject<View | null> | null }): GlassMaterial {
  const reduce = useReduceTransparency();
  if (reduce) return "solid";
  if (liquidGlass) return "liquid";
  if (Platform.OS === "ios" || options?.blurTarget) return "frosted";
  return "solid";
}

type GlassBackgroundProps = {
  /** Corner radius of the surface; the glass is clipped to it. */
  radius: number;
  glass?: Exclude<GlassStyle, "none">;
  /** Tints Liquid Glass; the solid fallback takes `solidClassName` instead. */
  tint?: string;
  /** Background class used when glass is unavailable, so solid surfaces keep their level. */
  solidClassName?: string;
  blurTarget?: RefObject<View | null> | null;
  style?: StyleProp<ViewStyle>;
};

/**
 * The material behind a floating control, drawn as an absolutely filled layer so the control keeps
 * its own view (refs, measurement, layout) and only its backdrop changes with the platform. Touches
 * belong to the control above it, so Liquid Glass's own touch response is not used.
 */
export function GlassBackground({ radius, glass = "regular", tint, solidClassName = "bg-surface-float", blurTarget = null, style }: GlassBackgroundProps) {
  const theme = useAppTheme();
  const material = useGlassMaterial({ blurTarget });
  const shape = { borderRadius: radius, borderCurve: "continuous" as const };
  if (material === "liquid") {
    return <GlassView pointerEvents="none" glassEffectStyle={glass} tintColor={tint} colorScheme={theme.mode} style={[StyleSheet.absoluteFill, shape, style]} />;
  }
  if (material === "frosted") {
    const dark = theme.mode === "dark";
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, shape, { overflow: "hidden" }, style]}>
      <BlurView
        intensity={Platform.OS === "ios" ? 80 : 60}
        tint={Platform.OS === "ios" ? dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight" : dark ? "dark" : "light"}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
      />
      {/* design-system-begin: glass tint and rim derive from the theme at runtime, so they follow Config themes. */}
      <View style={[StyleSheet.absoluteFill, shape, {
        backgroundColor: colorWithOpacity(tint ?? theme.colors.surfaceFloat, tint ? 0.85 : dark ? 0.45 : 0.55),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colorWithOpacity(dark ? theme.colors.text : theme.colors.surfaceFloat, dark ? 0.14 : 0.8),
      }]} />
      {/* design-system-end */}
    </View>;
  }
  return <View pointerEvents="none" className={tint ? undefined : solidClassName} style={[StyleSheet.absoluteFill, shape, tint ? { backgroundColor: tint } : null, style]} />;
}

/** Lets neighbouring Liquid Glass shapes merge as they near each other; a plain view elsewhere. */
export function GlassGroup({ spacing, style, pointerEvents, children }: { spacing: number; style?: StyleProp<ViewStyle>; pointerEvents?: "none" | "box-none"; children: ReactNode }) {
  return liquidGlass ? <GlassContainer spacing={spacing} style={style} pointerEvents={pointerEvents}>{children}</GlassContainer> : <View style={style} pointerEvents={pointerEvents}>{children}</View>;
}
