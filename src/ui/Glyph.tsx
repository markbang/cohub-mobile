import Svg, { Path } from "react-native-svg";
import { View, type ColorValue } from "react-native";
import { icons, type IconName } from "@/src/icons";
import { GLYPH_PATHS } from "@/src/ui/glyph-paths";

/** `bold` thickens the drawn glyph by that many points, as a heavier SF weight would (iOS ignores it). */
export type GlyphProps = { name: IconName; size: number; color: ColorValue; strokeWidth: number; fill?: string; bold?: number; style?: object };

/**
 * Android draws Framework7 Icons, an open set drawn after SF Symbols, sized as SF draws them (see
 * scripts/generate-glyphs.mjs), so glyphs match iOS. `fill` picks the filled shape where the set has one.
 * Names it lacks keep Lucide, thinned and scaled to SF's measure.
 */
const LUCIDE_STROKE_SCALE = 0.7;
const LUCIDE_DRAW_SCALE = 0.9;

export function Glyph({ name, size, color, strokeWidth, fill, bold = 0, style }: GlyphProps) {
  const glyph = GLYPH_PATHS[name];
  if (glyph) {
    const shape = fill && glyph.fill ? glyph.fill : glyph.outline;
    const stroke = (shape.stroke ?? 0) + bold * shape.viewBox[2] / size;
    return <Svg pointerEvents="none" width={size} height={size} viewBox={shape.viewBox.join(" ")} style={style}>
      {shape.paths.map((path, index) => <Path key={index} d={path.d} fill={color} fillRule={path.evenOdd ? "evenodd" : "nonzero"} {...(stroke > 0 ? { stroke: color, strokeWidth: stroke, strokeLinejoin: "round" as const } : null)} />)}
    </Svg>;
  }
  const Icon = icons[name];
  return <View pointerEvents="none" style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
    <Icon size={Math.round(size * LUCIDE_DRAW_SCALE)} color={color} strokeWidth={strokeWidth * LUCIDE_STROKE_SCALE + bold} absoluteStrokeWidth {...(fill ? { fill } : {})} />
  </View>;
}
