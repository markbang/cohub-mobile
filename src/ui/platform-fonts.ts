import type { FontSource } from "expo-font";

/** Fonts a platform loads beyond the system's. iOS draws SF Pro, the system font. */
export const PLATFORM_FONTS: Record<string, FontSource> = {};

/** The face to name for a weight in native renderers (timeline, Markdown); the system face on iOS. */
export function textFace(_weight?: string | number): string | undefined {
  return undefined;
}
