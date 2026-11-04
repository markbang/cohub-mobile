/**
 * Markdown reduced to the words a one-line preview shows. Not a parser: list rows only need the
 * text to read cleanly, and stray markers from a cut-off message must not leak through either.
 */
export function markdownPlainText(markdown: string): string {
  const lines = markdown.split(/\r?\n/).flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) return [];
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return [];
    if (/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/.test(line)) return [];
    return [line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(>\s?)+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/\s*\|\s*/g, " ")];
  });
  return lines.join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/`+([^`\n]+?)`+/g, "$1")
    // Markers left open where the source was cut off.
    .replace(/\*\*|__|~~|`+/g, "");
}
