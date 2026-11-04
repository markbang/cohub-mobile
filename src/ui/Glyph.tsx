import { View, type ColorValue } from "react-native";
import { icons, type IconName } from "@/src/icons";

export type GlyphProps = { name: IconName; size: number; color: ColorValue; strokeWidth: number; fill?: string; style?: object };

/**
 * iOS draws an SF Symbol scaled to fill its box, while a Lucide glyph sits inside a 24 unit canvas with
 * padding: most icons span about 20 units, chevrons 12, the up-down pair 16. Drawing Lucide larger by that
 * ratio, centred in the same box, gives the same visual size for the same `size` on both platforms.
 */
const FILL_SCALE: Partial<Record<IconName, number>> = {
  "chevron-left": 2,
  "chevron-right": 2,
  "chevron-down": 2,
  "chevrons-up-down": 1.5,
};
const DEFAULT_FILL_SCALE = 1.2;

export function Glyph({ name, size, color, strokeWidth, fill, style }: GlyphProps) {
  const Icon = icons[name];
  const drawn = Math.round(size * (FILL_SCALE[name] ?? DEFAULT_FILL_SCALE));
  return <View pointerEvents="none" style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
    <Icon size={drawn} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth {...(fill ? { fill } : {})} />
  </View>;
}
