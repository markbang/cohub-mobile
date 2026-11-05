import type { FontFamilyDefinition } from "expo-font";

/** Font families a platform loads beyond the system's. iOS draws SF Pro, the system font. */
export const PLATFORM_FONT_FAMILIES: FontFamilyDefinition[] = [];

/** The family native renderers (timeline, Markdown) name; the system face on iOS. */
export const TEXT_FAMILY: string | undefined = undefined;
