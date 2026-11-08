import type { IconName } from "@/src/icons";

/** `stroke` thickens a glyph Framework7 draws thinner than SF, in view box units. */
export type GlyphShape = { viewBox: readonly [number, number, number, number]; paths: readonly { d: string; evenOdd?: boolean }[]; stroke?: number };
/** A glyph's regular shape and, where the set has one, its filled shape (for selected tab icons). */
export type GlyphPaths = Partial<Record<IconName, { outline: GlyphShape; fill?: GlyphShape }>>;

/** iOS draws SF Symbols; only Android carries the drawn set (`glyph-paths.android.ts`). */
export const GLYPH_PATHS: GlyphPaths = {};
