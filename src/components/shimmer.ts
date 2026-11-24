import { loops } from "@/src/motion";

/**
 * The label as glyphs for a shimmer, one view each. A space leads the glyph after it, so no glyph
 * ends in whitespace that text measurement could drop.
 */
export function shimmerGlyphs(label: string): string[] {
  const glyphs: string[] = [];
  let lead = "";
  for (const char of Array.from(label)) {
    if (/\s/.test(char)) lead += char;
    else {
      glyphs.push(lead + char);
      lead = "";
    }
  }
  return glyphs;
}

export type ShimmerWave = {
  /** Opacity over one pass, from 0 to 1; every glyph shares it. */
  keyframes: { at: number; value: number }[];
  duration: number;
  /** How long after the glyph before it each one starts. */
  stagger: number;
};

/** The wave for a label of `count` glyphs: the light crosses at a steady pace, faster only for a label too long to cross in time. */
export function shimmerWave(count: number): ShimmerWave {
  const { duration, stagger, sweep, rise, dim } = loops.shimmer;
  const peak = rise / duration;
  return {
    keyframes: [{ at: 0, value: dim }, { at: peak, value: 1 }, { at: peak * 2, value: dim }, { at: 1, value: dim }],
    duration,
    stagger: Math.min(stagger, sweep / Math.max(1, count)),
  };
}
