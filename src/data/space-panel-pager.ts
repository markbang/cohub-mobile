export type PanelName = "chat" | "files";

/** Only swipes within ~30° of horizontal open a panel; slanted scrolls stay scrolls. */
export const PANEL_SWIPE_ACTIVATION_PX = 16;
export const PANEL_SWIPE_VERTICAL_SLOP_PX = 10;
const PANEL_SWIPE_PROJECTION_S = 0.15;

/**
 * Nearest-page resolution for the push-style panel pager: `null` means the chat page is
 * the closest snap point (i.e. no panel open).
 */
export function panelForScrollOffset(offset: number, centerOffset: number, filesOffset: number): PanelName | null {
  const toChat = Math.abs(offset);
  const toCenter = Math.abs(offset - centerOffset);
  const toFiles = Math.abs(offset - filesOffset);
  if (toCenter <= toChat && toCenter <= toFiles) return null;
  return toChat < toFiles ? "chat" : "files";
}

/** At most one page per swipe, so a flick from an open panel closes it. */
export function panelSwipeTarget(startOffset: number, offset: number, velocityX: number, pageWidth: number): number {
  "worklet";
  const startPage = Math.round(startOffset / pageWidth);
  const projectedPage = Math.round((offset - velocityX * PANEL_SWIPE_PROJECTION_S) / pageWidth);
  const page = Math.min(2, Math.max(0, Math.min(startPage + 1, Math.max(startPage - 1, projectedPage))));
  return page * pageWidth;
}
