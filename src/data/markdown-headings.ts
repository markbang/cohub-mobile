/**
 * Splits Markdown at top-level headings so each can be drawn on its own surface. Besides ATX headings,
 * a paragraph that is only a bold line (`**Billing**`) counts: Agents title sections that way far more
 * often than with `#`, and readers see it as a heading. Fenced code is opaque; only lines at column 0
 * split, so a heading nested in a list item or quote stays with its block and an ordered list never
 * restarts its numbering.
 */
export type MarkdownSegment = { kind: "text"; text: string } | { kind: "heading"; level: number; text: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const BOLD_TITLE = /^(\*\*|__)(?=\S)([^*_\n]+?)\1[ \t]*[:：]?[ \t]*$/;
/** A bold-line title reads at the size of a fourth-level heading. */
const BOLD_TITLE_LEVEL = 4;

export function splitMarkdownHeadings(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const text = buffer.join("\n");
    if (text.trim()) segments.push({ kind: "text", text });
    buffer = [];
  };
  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) fence = null;
      buffer.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!;
      buffer.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    // A bold line continuing a paragraph is emphasis, not a title.
    const previous = buffer.at(-1);
    const bold = !heading && (previous === undefined || !previous.trim()) ? BOLD_TITLE.exec(line) : null;
    if (!heading && !bold) {
      buffer.push(line);
      continue;
    }
    flush();
    segments.push(heading
      ? { kind: "heading", level: heading[1]!.length, text: plainInline(heading[2]!) }
      // The capsule already sets the title apart, so a lead-in colon is dropped.
      : { kind: "heading", level: BOLD_TITLE_LEVEL, text: plainInline(bold![2]!).replace(/[:：]$/, "") });
  }
  flush();
  return segments;
}

/** Heading text without inline Markdown: emphasis, code ticks, links, and escapes. */
export function plainInline(text: string) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
    .trim();
}
