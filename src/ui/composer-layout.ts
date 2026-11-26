import { floatingBarBottomOffset } from "./floating-bar";

// The composer's sizes at the default text size. `src/ui.tsx` scales the text paddings with Dynamic Type.
/** Vertical padding above and below the text: 10 pt each side. */
export const COMPOSER_TEXT_PADDING = 20;
/** Padding above the capsule, inside `composerWrap`. */
export const COMPOSER_TOP_PADDING = 8;
/** One row: a 48 pt capsule with its 36 pt controls centred. */
export const COMPOSER_ONE_ROW_HEIGHT = 48;
/** Two rows: the text row, then a fixed 44 pt control row. */
export const COMPOSER_CONTROL_ROW_HEIGHT = 44;
/** The 36 pt controls inside the capsule. */
export const COMPOSER_CONTROL_SIZE = 36;
/** Gap between the text and the controls in one row (the 4 pt row gap plus the field's own padding). */
export const COMPOSER_TEXT_GAP = 12;
/** Text inset from the capsule's edge in two rows. It stays 14 pt at every text size so the wrapped text keeps full width. */
export const COMPOSER_TEXT_INSET = 14;
/** The capsule's horizontal padding: the controls sit this far in from the edge. */
export const COMPOSER_CAPSULE_INSET = 4;
/** The 4 pt gap between neighbouring controls (`gap-1`). */
export const COMPOSER_ROW_GAP = 4;
/** Empty collapsed chrome above the bottom gap: the top padding and the one-row capsule. */
export const COMPOSER_CHROME_HEIGHT = COMPOSER_TOP_PADDING + COMPOSER_ONE_ROW_HEIGHT;

/**
 * Columns that fit on one line of the inline row at the default text size, measured in Latin glyphs.
 * The controls keep their width at every text size, so the row holds fewer columns as the glyphs grow:
 * `composerColumnsPerLine`. The estimate is only a fallback: `composerTextMeasure` measures the text
 * itself, and the placeholder is the only text that is estimated.
 */
const COLUMNS_PER_LINE = 30;

/** The full two-row line (14 pt from each edge) holds about twice the inline row's columns on a phone. */
const FULL_ROW_COLUMN_RATIO = 2;

/** Columns per line at a Dynamic Type scale: the glyphs grow, the controls and the rows do not. */
export function composerColumnsPerLine(fontScale: number, fullRow = false) {
  return Math.max(1, Math.floor((fullRow ? COLUMNS_PER_LINE * FULL_ROW_COLUMN_RATIO : COLUMNS_PER_LINE) / fontScale));
}

/** CJK, Hangul, Kana, and fullwidth punctuation occupy roughly two Latin columns. */
function columnWidth(ch: string) {
  return ch.charCodeAt(0) >= 0x2e80 ? 2 : 1;
}

/** The composer's horizontal padding inside the field: one row keeps the text COMPOSER_TEXT_GAP from the controls (scaled), two rows COMPOSER_TEXT_INSET from the edge (fixed). */
export function composerFieldPaddingX(wrapped: boolean, scale: number) {
  return wrapped ? COMPOSER_TEXT_INSET - COMPOSER_CAPSULE_INSET : COMPOSER_TEXT_GAP * scale - COMPOSER_ROW_GAP;
}

export function collapsedComposerHeight(bottomInset: number, ios: boolean) {
  return COMPOSER_CHROME_HEIGHT + floatingBarBottomOffset(bottomInset, ios);
}

/** Content heights for the layout: `inline` is measured at the one-row width (it decides the wrap), `wide` at the full two-row width (it sizes the field). */
export type ComposerMeasure = { inline: number; wide: number };

export type ComposerLayoutInput = {
  text: string;
  /** The text's heights, or the placeholder's when the field is empty. */
  measure: ComposerMeasure;
  lineHeight: number;
  availableHeight: number;
  expanded: boolean;
  /** The field's vertical padding at the current text size. */
  textPadding: number;
  /** The composer drew two rows on the last layout. Wider rows make the measurement shorter, so a wrapped composer stays wrapped until its text is cleared. */
  wrapped: boolean;
};

export type ComposerLayout = {
  expanded: boolean;
  /** Two rows: the field on its own row, controls on a second row. */
  twoRows: boolean;
  /** The expand control is shown, which needs text: an empty field that wraps its placeholder has none. */
  showExpandButton: boolean;
  height: number;
  scrollEnabled: boolean;
};

/** The height of `text` estimated from its characters, before any layout has reported its height. */
export function estimateComposerContentHeight(text: string, lineHeight: number, textPadding: number, columnsPerLine = COLUMNS_PER_LINE) {
  if (!text) return 0;
  let lines = 0;
  for (const line of text.split("\n")) {
    let columns = 0;
    for (const ch of line) columns += columnWidth(ch);
    lines += Math.max(1, Math.ceil(columns / columnsPerLine));
  }
  return lines * lineHeight + textPadding;
}

/** iOS reports content size on frame changes, not on edits inside a fixed frame. Use the text layout there
 * and for JS-set drafts; Android typing has its own content-size watcher. */
export function composerTextMeasure(input: { typed: boolean; ios: boolean; nativeHeight: number; layoutHeight: number | null; estimate: ComposerMeasure }): ComposerMeasure {
  if (input.typed && !input.ios && input.nativeHeight > 0) return { inline: input.nativeHeight, wide: input.nativeHeight };
  if (input.layoutHeight !== null) return { inline: input.layoutHeight, wide: input.layoutHeight };
  return input.estimate;
}

export function shouldAutoExpandComposer(input: {
  value: string;
  expanded: boolean;
  scrollEnabled: boolean;
  lastUserText: string;
  autoExpandedFor: string | null;
}): boolean {
  if (!input.value || input.expanded || !input.scrollEnabled) return false;
  // Voice finals update `value` from JS without an onChangeText, and the overflowing final
  // regularly lands after the mic stopped, so the append itself (not active recording)
  // identifies dictation text.
  if (input.value === input.lastUserText) return false;
  return input.autoExpandedFor !== input.value;
}

/**
 * The capsule's corner: half the 48 pt one-row capsule, so one row is fully round. Two rows keep the same corner;
 * their bottom controls sit 4 pt in, about 2 pt inside a concentric arc. A capsule shorter than 48 pt keeps its ends round.
 */
export const COMPOSER_CAPSULE_RADIUS = 24;

export function composerCapsuleRadius(height: number) {
  return Math.min(height / 2, COMPOSER_CAPSULE_RADIUS);
}

export function getComposerLayout(input: ComposerLayoutInput): ComposerLayout {
  const hasText = input.text.length > 0;
  const expanded = hasText && input.expanded;
  const minHeight = input.lineHeight + input.textPadding;
  // The largest whole-line height within a limit: the field shows exact lines, so a line that does not fit is clipped between lines.
  const wholeLinesWithin = (limit: number) => Math.max(minHeight, Math.floor((limit - input.textPadding) / input.lineHeight + 1e-6) * input.lineHeight + input.textPadding);
  const limit = Math.min(320, input.availableHeight * 0.45);
  const expandedHeight = wholeLinesWithin(limit);
  // Collapsed: three lines plus padding, or 120 pt, within the cap.
  const collapsedCap = wholeLinesWithin(Math.min(limit, Math.max(120, 3 * input.lineHeight + input.textPadding)));
  const maxHeight = expanded ? expandedHeight : collapsedCap;
  // Collapsed, the field is the whole lines the measurement holds, within the cap: a line that does not fit is not drawn at all.
  const height = expanded ? maxHeight : Math.min(maxHeight, wholeLinesWithin(Math.ceil(input.measure.wide)));
  // Native measurements include soft wraps; the threshold tolerates platform rounding.
  const wrapsLine = input.measure.inline > input.lineHeight * 1.5 + input.textPadding;
  const wrapsText = hasText && (input.text.includes("\n") || input.wrapped || wrapsLine);
  const wrapsPlaceholder = !hasText && wrapsLine;

  return {
    expanded,
    twoRows: expanded || wrapsText || wrapsPlaceholder,
    showExpandButton: expanded || wrapsText,
    height,
    // While expanded, the estimate may undershoot the real content and clipping beats a
    // height fight, so keep the editor scrollable there regardless of the measurement. Collapsed, the
    // field scrolls as soon as its text runs past the whole lines it shows; a point of rounding is not overflow.
    scrollEnabled: expanded || input.measure.wide > height + 1,
  };
}
