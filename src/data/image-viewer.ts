/**
 * Payload handoff for the image viewer route.
 *
 * Image URIs can be base64 data URIs, which must not travel through serializable
 * route params (they would bloat the navigation state and deep links). The gallery
 * writes the payload here and the route reads it once on mount.
 */
/** `zoom` marks a viewer opened through the iOS zoom transition, which then owns the dismiss swipe. */
export type ImageViewerPayload = { uris: string[]; index: number; zoom?: boolean };

let payload: ImageViewerPayload | null = null;

export function setImageViewerPayload(next: ImageViewerPayload) {
  payload = next;
}

export function getImageViewerPayload() {
  return payload;
}

export function clearImageViewerPayload() {
  payload = null;
}

/**
 * Nearest page for a paginated gallery. A native scroll handler must not turn an absent
 * page width into a NaN index, and a rubber-band offset must not point past the loaded
 * pages; an unusable offset leaves the current page alone.
 */
export function imageViewerPageIndex(offsetX: number, pageWidth: number, pageCount: number): number | null {
  "worklet";
  if (!Number.isFinite(offsetX) || !Number.isFinite(pageWidth) || pageWidth <= 0 || pageCount <= 0) return null;
  return Math.min(Math.max(Math.round(offsetX / pageWidth), 0), pageCount - 1);
}

// UIScrollView's fast deceleration projects a release to where it would coast.
const RELEASE_PROJECTION_S = 0.1;

/**
 * Page a horizontal drag lands on. `fromPage` is where the pager was when the drag began (fractional
 * mid-spring); a flick moves at most one page from the settled `current` page, as in Photos.
 */
export function imageViewerReleasePage(fromPage: number, current: number, translationX: number, velocityX: number, pageWidth: number, pageCount: number): number {
  "worklet";
  const projected = fromPage * pageWidth - (translationX + velocityX * RELEASE_PROJECTION_S);
  const page = imageViewerPageIndex(projected, pageWidth, pageCount);
  return page === null ? current : Math.min(Math.max(page, current - 1), current + 1);
}

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/** A vertical drag dismisses when it travels far enough or is thrown away from the center. */
export function imageViewerShouldDismiss(translationY: number, velocityY: number): boolean {
  "worklet";
  if (Math.abs(translationY) > DISMISS_DISTANCE) return Math.sign(velocityY) !== -Math.sign(translationY) || Math.abs(velocityY) < DISMISS_VELOCITY;
  return Math.abs(velocityY) > DISMISS_VELOCITY && Math.sign(velocityY) === Math.sign(translationY);
}

/** How far a zoomed image may pan from center before its edge leaves the screen edge. */
export function imageViewerPanBounds(fitWidth: number, fitHeight: number, scale: number, viewWidth: number, viewHeight: number): { x: number; y: number } {
  "worklet";
  return { x: Math.max(0, (fitWidth * scale - viewWidth) / 2), y: Math.max(0, (fitHeight * scale - viewHeight) / 2) };
}
