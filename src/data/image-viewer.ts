/**
 * Payload handoff for the image viewer route.
 *
 * Image URIs can be base64 data URIs, which must not travel through serializable
 * route params (they would bloat the navigation state and deep links). The gallery
 * writes the payload here and the route reads it once on mount.
 */
export type ImageViewerRect = { x: number; y: number; width: number; height: number };

/**
 * The thumbnail the viewer grows out of and shrinks back into. `measure` reads its frame in window points,
 * when the viewer opens and again when it closes; it resolves null once the thumbnail is gone. `fit` is how
 * the thumbnail draws its image: cropped to its frame, or letterboxed inside it. `thumbnail` is the image it
 * draws (a smaller variant with the same proportions, usually cached), which stands in until the full
 * image loads.
 */
export type ImageViewerOrigin = { radius: number; fit: "cover" | "contain"; thumbnail: string; measure: () => Promise<ImageViewerRect | null> };

/**
 * `zoom` marks a viewer opened through the iOS zoom transition, which then owns the dismiss swipe.
 * `origin` lets the viewer draw its own transition from the thumbnail at `index`.
 */
export type ImageViewerPayload = { uris: string[]; index: number; zoom?: boolean; origin?: ImageViewerOrigin };

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

/** A thumbnail frame the viewer can fly to: measured, sized, and wholly inside the window. */
export function imageViewerOriginUsable(rect: ImageViewerRect | null | undefined, windowWidth: number, windowHeight: number): rect is ImageViewerRect {
  if (!rect) return false;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  return x >= -0.5 && y >= -0.5 && x + width <= windowWidth + 0.5 && y + height <= windowHeight + 0.5;
}

/**
 * Where the viewer's image starts when it grows out of a thumbnail: the clip around it (`clipWidth`,
 * `clipHeight`, `radius`), the clip's offset from the window's center, and the image's scale against
 * its fitted size. A cropped thumbnail shows the image scaled to cover its frame, so the clip starts as
 * that frame; a letterboxed one shows it whole, so the clip starts around the image.
 */
export function imageViewerFlightStart(origin: { rect: ImageViewerRect; radius: number; fit: "cover" | "contain" }, fitWidth: number, fitHeight: number, windowWidth: number, windowHeight: number) {
  "worklet";
  const { rect } = origin;
  const cover = origin.fit === "cover";
  const scale = cover ? Math.max(rect.width / fitWidth, rect.height / fitHeight) : Math.min(rect.width / fitWidth, rect.height / fitHeight);
  return {
    scale,
    clipWidth: cover ? rect.width : fitWidth * scale,
    clipHeight: cover ? rect.height : fitHeight * scale,
    radius: cover ? origin.radius : 0,
    dx: rect.x + rect.width / 2 - windowWidth / 2,
    dy: rect.y + rect.height / 2 - windowHeight / 2,
  };
}

/** How far a zoomed image may pan from center before its edge leaves the screen edge. */
export function imageViewerPanBounds(fitWidth: number, fitHeight: number, scale: number, viewWidth: number, viewHeight: number): { x: number; y: number } {
  "worklet";
  return { x: Math.max(0, (fitWidth * scale - viewWidth) / 2), y: Math.max(0, (fitHeight * scale - viewHeight) / 2) };
}
