import type { FontFamilyDefinition } from "expo-font";
import { ANDROID_FONT_FAMILY } from "@/src/design/tokens";

/**
 * Android draws Inter (SIL OFL 1.1), the closest open match to SF Pro, which Apple licenses for its
 * platforms only. Its weights load as one family, so `fontWeight` picks the face as it does for the
 * system font; a family per weight is not found once a weight is also set, and falls back to the default.
 */
export const PLATFORM_FONT_FAMILIES: FontFamilyDefinition[] = [{
  fontFamily: ANDROID_FONT_FAMILY,
  fontDefinitions: [
    { path: require("../../assets/fonts/Inter-Regular.ttf"), weight: 400 },
    { path: require("../../assets/fonts/Inter-Medium.ttf"), weight: 500 },
    { path: require("../../assets/fonts/Inter-SemiBold.ttf"), weight: 600 },
    { path: require("../../assets/fonts/Inter-Bold.ttf"), weight: 700 },
  ],
}];

/** The family native renderers (timeline, Markdown) name; they set the weight themselves. */
export const TEXT_FAMILY: string | undefined = ANDROID_FONT_FAMILY;
