/** The HIG minimum hit region; a control may draw smaller but must not be touched smaller. */
export const MIN_TOUCH_TARGET = 44;

/**
 * Slop that grows a smaller control to the minimum target without moving its pixels. Android only
 * registers slop inside the parent's bounds, so callers keep that much room around the control.
 */
export function touchSlop(width: number, height = width) {
  const x = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - width) / 2));
  const y = Math.max(0, Math.ceil((MIN_TOUCH_TARGET - height) / 2));
  return { top: y, bottom: y, left: x, right: x };
}
