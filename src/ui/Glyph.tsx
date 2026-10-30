import type { ColorValue } from "react-native";
import { icons, type IconName } from "@/src/icons";

export type GlyphProps = { name: IconName; size: number; color: ColorValue; strokeWidth: number; fill?: string; style?: object };

export function Glyph({ name, size, color, strokeWidth, fill, style }: GlyphProps) {
  const Icon = icons[name];
  return <Icon size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth style={style} {...(fill ? { fill } : {})} />;
}
