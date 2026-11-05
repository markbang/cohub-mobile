import { View, type ColorValue } from "react-native";
import { icons, type IconName } from "@/src/icons";

export type GlyphProps = { name: IconName; size: number; color: ColorValue; strokeWidth: number; fill?: string; style?: object };

/**
 * Lucide drawn to SF Symbols' measure. At the same `size`, SF glyphs span about 0.9 of what Lucide's do
 * and their regular weight strokes about 0.7 as thick (measured on iOS 26 screenshots), so Android draws
 * each glyph scaled and thinned, centred in the same box. Chevrons fill only half of Lucide's canvas and
 * are drawn larger instead.
 */
export const GLYPH_STROKE_SCALE = 0.7;
export const GLYPH_DRAW_SCALE = 0.9;
const FILL_SCALE: Partial<Record<IconName, number>> = {
  "chevron-left": 1.25,
  "chevron-right": 1.25,
  "chevron-down": 1.25,
  "chevrons-up-down": 1.12,
};

export function Glyph({ name, size, color, strokeWidth, fill, style }: GlyphProps) {
  const Icon = icons[name];
  const drawn = Math.round(size * (FILL_SCALE[name] ?? GLYPH_DRAW_SCALE));
  return <View pointerEvents="none" style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
    <Icon size={drawn} color={color} strokeWidth={strokeWidth * GLYPH_STROKE_SCALE} absoluteStrokeWidth {...(fill ? { fill } : {})} />
  </View>;
}
