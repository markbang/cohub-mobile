import { View, type ColorValue } from "react-native";
import { icons, type IconName } from "@/src/icons";

export type GlyphProps = { name: IconName; size: number; color: ColorValue; strokeWidth: number; fill?: string; style?: object };

/**
 * SF Symbols render at a point size, so most glyphs match Lucide's at the same `size`. Lucide's chevrons
 * are the exception: they fill half of its 24 unit canvas, so they draw smaller than SF's. These ratios,
 * measured against iOS 26 screenshots, draw them at the iOS size, centred in the same box.
 */
const FILL_SCALE: Partial<Record<IconName, number>> = {
  "chevron-left": 1.25,
  "chevron-right": 1.25,
  "chevron-down": 1.25,
  "chevrons-up-down": 1.12,
};

export function Glyph({ name, size, color, strokeWidth, fill, style }: GlyphProps) {
  const Icon = icons[name];
  const scale = FILL_SCALE[name];
  if (!scale) return <Icon size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth style={style} {...(fill ? { fill } : {})} />;
  return <View pointerEvents="none" style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
    <Icon size={Math.round(size * scale)} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth {...(fill ? { fill } : {})} />
  </View>;
}
