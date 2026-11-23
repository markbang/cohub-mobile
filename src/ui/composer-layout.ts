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
/** Gap between the text and the controls in one row (the 4 pt row gap plus the field's own padding). */
export const COMPOSER_TEXT_GAP = 12;
/** Text inset from the capsule's edge in two rows. */
export const COMPOSER_TEXT_INSET = 14;
/** The capsule's horizontal padding: the controls sit this far in from the edge. */
export const COMPOSER_CAPSULE_INSET = 4;
/** The 4 pt gap between neighbouring controls (`gap-1`). */
export const COMPOSER_ROW_GAP = 4;
/** Empty collapsed chrome above the bottom gap: the top padding and the one-row capsule. */
export const COMPOSER_CHROME_HEIGHT = COMPOSER_TOP_PADDING + COMPOSER_ONE_ROW_HEIGHT;

/**
 * Layout columns per rendered line at `typography.body` width, measured in Latin glyphs. The
 * estimate only needs to be close: typed text carries a real native measurement, and a
 * JS-appended dictation final is corrected by one on iOS and carried by the estimate on
 * Android until the user types.
 */
const COLUMNS_PER_LINE = 30;

/** CJK, Hangul, Kana, and fullwidth punctuation occupy roughly two Latin columns. */
function columnWidth(ch: string) {
  return ch.charCodeAt(0) >= 0x2e80 ? 2 : 1;
}

/** The composer's horizontal padding inside the field: one row keeps the text COMPOSER_TEXT_GAP from the controls, two rows COMPOSER_TEXT_INSET from the edge. */
export function composerFieldPaddingX(wrapped: boolean, scale: number) {
  return wrapped ? COMPOSER_TEXT_INSET * scale - COMPOSER_CAPSULE_INSET : COMPOSER_TEXT_GAP * scale - COMPOSER_ROW_GAP;
}

export function collapsedComposerHeight(bottomInset: number, ios: boolean) {
  return COMPOSER_CHROME_HEIGHT + floatingBarBottomOffset(bottomInset, ios);
}

export type ComposerLayoutInput = {
  text: string;
  contentHeight: number;
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
  showExpandButton: boolean;
  height: number;
  scrollEnabled: boolean;
};

/**
 * Android's content-size watcher reads a stale layout when JS replaces the text (a dictation
 * final) and never fires again, so native measurement alone cannot detect the growth. The
 * estimate is derived from the text itself and only raises the measurement; a later real
 * native measurement always wins.
 */
export function estimateComposerContentHeight(text: string, lineHeight: number, textPadding: number) {
  if (!text) return 0;
  let lines = 0;
  for (const line of text.split("\n")) {
    let columns = 0;
    for (const ch of line) columns += columnWidth(ch);
    lines += Math.max(1, Math.ceil(columns / COLUMNS_PER_LINE));
  }
  return lines * lineHeight + textPadding;
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
  const expandedHeight = Math.max(minHeight, Math.min(320, Math.floor(input.availableHeight * 0.45)));
  const maxHeight = expanded ? expandedHeight : Math.max(minHeight, Math.min(120, expandedHeight));
  const contentHeight = hasText ? input.contentHeight : 0;
  const height = expanded ? maxHeight : Math.min(maxHeight, Math.max(minHeight, Math.ceil(contentHeight)));
  // Native measurements include soft wraps; the threshold tolerates platform rounding.
  const multiline = hasText && (input.text.includes("\n") || input.wrapped || contentHeight > input.lineHeight * 1.5 + input.textPadding);

  return {
    expanded,
    showExpandButton: expanded || multiline,
    height,
    // While expanded, the estimate may undershoot the real content and clipping beats a
    // height fight, so keep the editor scrollable there regardless of the measurement.
    scrollEnabled: expanded || contentHeight > height,
  };
}
