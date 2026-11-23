export const COMPOSER_TEXT_PADDING = 8;
/** Empty collapsed composer chrome in `src/ui.tsx` (`composerWrap` padding around the 44 pt capsule), excluding the home-indicator inset. */
export const COMPOSER_CHROME_HEIGHT = 60;

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

export function collapsedComposerHeight(bottomInset: number) {
  return COMPOSER_CHROME_HEIGHT + Math.max(0, bottomInset);
}

export type ComposerLayoutInput = {
  text: string;
  contentHeight: number;
  lineHeight: number;
  availableHeight: number;
  expanded: boolean;
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
export function estimateComposerContentHeight(text: string, lineHeight: number) {
  if (!text) return 0;
  let lines = 0;
  for (const line of text.split("\n")) {
    let columns = 0;
    for (const ch of line) columns += columnWidth(ch);
    lines += Math.max(1, Math.ceil(columns / COLUMNS_PER_LINE));
  }
  return lines * lineHeight + COMPOSER_TEXT_PADDING;
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
 * The capsule's corner: half the 44 pt one-row capsule, which is concentric with the 36 pt controls inset 4 pt.
 * A capsule shorter than 44 pt keeps its ends fully round.
 */
export const COMPOSER_CAPSULE_RADIUS = 22;

export function composerCapsuleRadius(height: number) {
  return Math.min(height / 2, COMPOSER_CAPSULE_RADIUS);
}

export function getComposerLayout(input: ComposerLayoutInput): ComposerLayout {
  const hasText = input.text.length > 0;
  const expanded = hasText && input.expanded;
  const minHeight = Math.max(44, input.lineHeight + COMPOSER_TEXT_PADDING);
  const expandedHeight = Math.max(minHeight, Math.min(320, Math.floor(input.availableHeight * 0.45)));
  const maxHeight = expanded ? expandedHeight : Math.max(minHeight, Math.min(120, expandedHeight));
  const contentHeight = hasText ? input.contentHeight : 0;
  const height = expanded ? maxHeight : Math.min(maxHeight, Math.max(minHeight, Math.ceil(contentHeight)));
  // Native measurements include soft wraps; the threshold tolerates platform rounding.
  const multiline = hasText && (input.text.includes("\n") || input.wrapped || contentHeight > input.lineHeight * 1.5 + COMPOSER_TEXT_PADDING);

  return {
    expanded,
    showExpandButton: expanded || multiline,
    height,
    // While expanded, the estimate may undershoot the real content and clipping beats a
    // height fight, so keep the editor scrollable there regardless of the measurement.
    scrollEnabled: expanded || contentHeight > height,
  };
}
