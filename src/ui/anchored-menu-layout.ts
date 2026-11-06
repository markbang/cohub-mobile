type MenuRect = { x: number; y: number; width: number; height: number };

/** iOS 26 pull-down menus are one width on iPhone and wrap long titles. */
export const MENU_WIDTH = 250;

export function getAnchoredMenuLayout({ anchor, viewport, bottomInset }: {
  anchor: MenuRect;
  viewport: MenuRect;
  bottomInset: number;
}): { left: number; top: number; width: number; maxHeight: number } {
  const margin = 8;
  const width = Math.min(Math.max(0, viewport.width - margin * 2), MENU_WIDTH);
  const bottom = Math.max(margin, viewport.height - bottomInset - margin);
  // The menu replaces its trigger: it opens over the trigger's top edge, not below it.
  const top = Math.min(bottom, Math.max(margin, anchor.y - viewport.y));
  // As UIKit does, it lines up with the trigger's leading edge when the trigger sits in the leading half,
  // and with its trailing edge otherwise.
  const anchorX = anchor.x - viewport.x;
  const leading = anchorX + anchor.width / 2 < viewport.width / 2;
  const left = leading ? anchorX : anchorX + anchor.width - width;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - margin - width)),
    top,
    width,
    maxHeight: Math.max(0, bottom - top),
  };
}
