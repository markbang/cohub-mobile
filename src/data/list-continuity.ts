/**
 * How a list's rows change between two renders, for the continuity rules in `src/ui/list-continuity.tsx`:
 * rows that stay slide to their new places, rows that go fade where they stood while the rest close the gap,
 * and rows that arrive fade in.
 *
 * - `instant`: nothing animates. The same rows, the first rows, a page appended at the end, or another list altogether.
 * - `fade`: rows come and go but nothing slides.
 * - `move`: rows come, go, or change places, and the rows on screen slide.
 */
export type ListContinuityChange = "instant" | "fade" | "move";

export function listContinuityChange(previous: readonly string[], next: readonly string[], options: { sameList: boolean; quiet: boolean; fadeOnly: boolean }): ListContinuityChange {
  if (previous.length === next.length && previous.every((key, index) => key === next[index])) return "instant";
  if (!options.sameList || options.quiet) return "instant";
  // Remote results land under a query that held still, even into an empty list or after the local rows.
  if (options.fadeOnly) return "fade";
  if (previous.length === 0) return "instant";
  // A page loaded at the end leaves every shown row where it is.
  if (next.length > previous.length && previous.every((key, index) => key === next[index])) return "instant";
  return "move";
}

/**
 * `next` with the rows of `previous` it dropped put back where they stood, each after the nearest row above
 * it that is still listed, so they can fade out in place. `leaving` holds their keys.
 */
export function withLeavingRows<T>(previous: readonly T[], next: readonly T[], keyOf: (item: T) => string): { items: T[]; leaving: Set<string> } {
  const nextKeys = new Set(next.map(keyOf));
  const leaving = new Set<string>();
  for (const item of previous) {
    const key = keyOf(item);
    if (!nextKeys.has(key)) leaving.add(key);
  }
  if (leaving.size === 0) return { items: [...next], leaving };
  const items = [...next];
  const indexOf = new Map(items.map((item, index) => [keyOf(item), index]));
  let anchor = -1;
  for (const item of previous) {
    const key = keyOf(item);
    if (!leaving.has(key)) {
      anchor = indexOf.get(key) ?? anchor;
      continue;
    }
    const at = anchor + 1;
    items.splice(at, 0, item);
    anchor = at;
    indexOf.clear();
    items.forEach((entry, index) => indexOf.set(keyOf(entry), index));
  }
  return { items, leaving };
}

/** Keys of `next` that were not in `previous`. */
export function arrivedKeys(previous: readonly string[], next: readonly string[]): Set<string> {
  const before = new Set(previous);
  return new Set(next.filter((key) => !before.has(key)));
}
