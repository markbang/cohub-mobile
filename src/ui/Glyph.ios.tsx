import { SymbolView } from "expo-symbols";
import { SF_SYMBOLS } from "@/src/sf-symbols";
import type { GlyphProps } from "./Glyph";

export type { GlyphProps } from "./Glyph";

export function Glyph({ name, size, color, strokeWidth, style }: GlyphProps) {
  return <SymbolView name={SF_SYMBOLS[name]} size={size} tintColor={color} weight={strokeWidth >= 2.05 ? "semibold" : "regular"} style={style} />;
}
