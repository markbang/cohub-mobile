const IOS_HOME_INDICATOR_OVERLAP = 14;
// The iOS 26 tab bar ends 22 pt above the screen edge, clear of the home indicator.
const SYSTEM_BAR_BOTTOM = 22;
const BAR_BOTTOM_MARGIN = 8;

/**
 * Distance from the screen's bottom edge to a floating bar. The tab bar and the composer share it, so the
 * page's bottom gap is the same wherever a floating bar sits. iOS's home-indicator inset is sized for
 * edge-to-edge content, so a floating bar can sit partly inside it.
 */
export function floatingBarBottomOffset(bottomInset: number, ios: boolean) {
  if (ios) return Math.max(bottomInset - IOS_HOME_INDICATOR_OVERLAP, BAR_BOTTOM_MARGIN * 2);
  // Gesture navigation's handle sits where the home indicator does; three-button navigation needs its own inset.
  return bottomInset <= 34 ? SYSTEM_BAR_BOTTOM : bottomInset + BAR_BOTTOM_MARGIN;
}
