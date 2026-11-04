import type { FontSource } from "expo-font";
import { ANDROID_FONT_FAMILIES } from "@/src/design/tokens";

/**
 * Android draws Inter (SIL OFL 1.1), the closest open match to SF Pro, which Apple licenses for its
 * platforms only. Each weight is its own family; `global.css` maps the text and weight classes to them.
 */
export const PLATFORM_FONTS: Record<string, FontSource> = {
  "Inter-Regular": require("../../assets/fonts/Inter-Regular.ttf"),
  "Inter-Medium": require("../../assets/fonts/Inter-Medium.ttf"),
  "Inter-SemiBold": require("../../assets/fonts/Inter-SemiBold.ttf"),
  "Inter-Bold": require("../../assets/fonts/Inter-Bold.ttf"),
};

/** The face to name for a weight in native renderers (timeline, Markdown), which do not read `global.css`. */
export function textFace(weight?: string | number): string {
  const value = weight === "bold" ? 700 : Number(weight ?? 400);
  return value >= 700 ? ANDROID_FONT_FAMILIES[700] : value >= 600 ? ANDROID_FONT_FAMILIES[600] : value >= 500 ? ANDROID_FONT_FAMILIES[500] : ANDROID_FONT_FAMILIES[400];
}
