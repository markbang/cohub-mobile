import { converter, formatHex8 } from "culori";

/** Palette values are hex or rgba(); a value that does not parse is a token bug, not user input. */
export function colorWithOpacity(value: string, opacity: number): string {
  const rgb = converter("rgb")(value);
  if (!rgb) throw new Error(`Invalid palette color "${value}". Fix the token in src/design/tokens.ts or accents.ts.`);
  return formatHex8({ ...rgb, alpha: (rgb.alpha ?? 1) * opacity });
}
