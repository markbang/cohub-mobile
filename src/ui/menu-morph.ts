/**
 * iOS 27's pull-down menu morph, one row per 60 fps frame, as measured on the iOS 27 simulator by
 * liquidglass (github.com/onlymoein/liquidglass, MIT, `src/menu.tsx`).
 *
 * Width, height and centre run from the trigger (0) to the menu (1). Opening, the trigger squeezes into
 * a ball (width below 0) that falls past the menu's centre, then swells into the menu as the rows zoom
 * through 1.28; closing runs the other way, and what is left of the glass runs back into the trigger as
 * a drop while the trigger comes back narrow and raised.
 */
export type MorphRect = { x: number; y: number; width: number; height: number };
type Row = readonly [width: number, height: number, centre: number, zoom: number, round: number];

const OPENING: readonly Row[] = [
  [0, 0, 0, 0.7, 1],
  [-0.43, 0, 0.01, 0.7, 1],
  [-1.28, 0.04, 0.15, 0.7, 1],
  [-1.48, 0.435, 0.73, 0.75, 1],
  [-1.22, 0.53, 0.88, 0.85, 1],
  [-0.97, 0.6, 1, 0.95, 1],
  [-0.52, 0.73, 1.2, 1.08, 1],
  [-0.14, 0.81, 1.33, 1.19, 1],
  [0.21, 0.88, 1.4, 1.25, 0.92],
  [0.45, 0.91, 1.4, 1.27, 0.83],
  [0.66, 0.95, 1.365, 1.28, 0.75],
  [0.8, 0.97, 1.31, 1.25, 0.66],
  [0.93, 0.99, 1.25, 1.2, 0.58],
  [1.03, 1.01, 1.2, 1.16, 0.49],
  [1.07, 1.02, 1.14, 1.12, 0.41],
  [1.1, 1.02, 1.087, 1.09, 0.32],
  [1.1, 1.02, 1.052, 1.06, 0.24],
  [1.1, 1.02, 1.035, 1.04, 0.15],
  [1.07, 1.02, 1.017, 1.03, 0.1],
  [1.07, 1.02, 1, 1.02, 0.05],
  [1.07, 1.01, 0.99, 1.01, 0.02],
  [1.03, 1.01, 0.99, 1, 0],
  [1.02, 1.01, 0.99, 1, 0],
  [1.01, 1, 0.99, 1, 0],
  [1, 1, 1, 1, 0],
];
const CLOSING: readonly Row[] = [
  [1, 1, 1, 1, 0],
  [0.86, 0.98, 1.226, 1, 0.2],
  [0.64, 0.94, 1.41, 0.98, 0.5],
  [0.33, 0.9, 1.44, 0.95, 0.75],
  [-0.02, 0.86, 1.365, 0.92, 1],
  [-0.38, 0.81, 1.21, 0.9, 1],
  [-0.72, 0.74, 1.02, 0.88, 1],
  [-1.05, 0.66, 0.82, 0.86, 1],
  [-1.34, 0.57, 0.63, 0.84, 1],
  [-1.59, 0.49, 0.47, 0.82, 1],
];
// The drop's width as a share of the trigger's, and how far it hangs below the trigger as a share of the
// menu's growth in height; then the trigger's width and its lift in points as it comes back.
const DROPLET: readonly (readonly [size: number, reach: number, scaleX: number, lift: number])[] = [
  [0.41, 0.35, 0.61, -3],
  [0.35, 0.25, 0.69, -5],
  [0.31, 0.165, 0.76, -6],
  [0.28, 0.096, 0.81, -7],
  [0.23, 0.035, 0.865, -7],
  [0.18, 0, 0.9, -6],
  [0, 0, 0.93, -6],
  [0, 0, 0.96, -5],
  [0, 0, 0.98, -5],
  [0, 0, 0.99, -4],
  [0, 0, 1, -4],
  [0, 0, 1.01, -3],
  [0, 0, 1.016, -2],
  [0, 0, 1.02, -2],
  [0, 0, 1.02, -1],
  [0, 0, 1.016, -1],
  [0, 0, 1.016, -1],
  [0, 0, 1.01, 0],
  [0, 0, 1.008, 0],
  [0, 0, 1.004, 0],
  [0, 0, 1, 0],
];

export const MORPH_FRAME_MS = 1000 / 60;
/** Frames from the trigger to the settled menu. */
export const OPEN_FRAMES = OPENING.length - 1;
/** Frames the closing glass takes before the trigger is back and only the drop is left. */
export const CLOSE_FRAMES = CLOSING.length;
/** The trigger's return, in frames after `CLOSE_FRAMES`. */
export const DROP_FRAMES = DROPLET.length - 1;
/** Frames after `CLOSE_FRAMES` until the drop has run into the trigger and no glass is left. */
export const DROP_GLASS_FRAMES = DROPLET.findIndex(([size]) => size === 0);

function clamp01(value: number) {
  "worklet";
  return Math.min(1, Math.max(0, value));
}

function lerpRow<T extends readonly number[]>(table: readonly T[], at: number): T {
  "worklet";
  const index = Math.min(Math.max(0, Math.floor(at)), table.length - 1);
  const lower = table[index];
  const upper = table[Math.min(index + 1, table.length - 1)];
  const part = Math.min(1, Math.max(0, at - index));
  return lower.map((value, i) => value + (upper[i] - value) * part) as unknown as T;
}

/** Where to pick up a table so its height matches the shape on screen, when a morph reverses part-way. */
export function resumeFrame(opening: boolean, at: number, wasOpening: boolean) {
  "worklet";
  const height = (wasOpening ? lerpRow(OPENING, at) : lerpRow(CLOSING, Math.min(at, CLOSE_FRAMES - 1)))[1];
  const table = opening ? OPENING : CLOSING;
  let best = 0;
  for (let i = 1; i < table.length; i++) if (Math.abs(table[i][1] - height) < Math.abs(table[best][1] - height)) best = i;
  return best;
}

export type MorphShape = MorphRect & { corner: number; zoom: number; shift: number; rows: number };

/**
 * The glass at frame `at`, in the coordinates of the settled menu `to` (origin at its top left), grown out of
 * `from`. `rows` is the rows' opacity; `zoom` and `shift` place them about the menu's centre.
 */
export function morphShape(opening: boolean, at: number, from: MorphRect, to: { width: number; height: number }, radius: number): MorphShape {
  "worklet";
  const [w, h, c, zoom, round] = opening ? lerpRow(OPENING, at) : lerpRow(CLOSING, at);
  // Measured for a 192 x 52 trigger and a 250 x 167 menu; past either end the sizes stay a share of where they run from.
  const width = Math.max(from.height * 0.8, w < 0 ? from.width * (1 + 0.302 * w) : w > 1 ? to.width * (1 + 0.232 * (w - 1)) : from.width + (to.width - from.width) * w);
  const height = h > 1 ? to.height * (1 + 0.69 * (h - 1)) : from.height + (to.height - from.height) * h;
  const homeX = from.x + from.width / 2;
  const homeY = from.y + from.height / 2;
  const centreY = homeY + (to.height / 2 - homeY) * c;
  const roundest = Math.min(1, radius / (Math.min(to.width, to.height) / 2));
  return {
    x: homeX + (to.width / 2 - homeX) * clamp01(w) - width / 2,
    y: centreY - height / 2,
    width,
    height,
    corner: (roundest + (1 - roundest) * round) * Math.min(width, height) / 2,
    zoom,
    // The rows ride lower than the glass as it passes the menu's centre.
    shift: (centreY - to.height / 2) * 0.45,
    rows: opening ? clamp01((at - 1) / 6) : clamp01(1 - at / 4),
  };
}

/** The drop hanging under the trigger once it is back, `index` frames into its return. */
export function dropShape(index: number, from: MorphRect, to: { height: number }): MorphRect {
  "worklet";
  const [size, reach, , lift] = lerpRow(DROPLET, index);
  const width = size * from.width;
  return { x: from.x + from.width / 2 - width / 2, y: from.y + from.height + lift, width, height: Math.max(0, reach * (to.height - from.height)) };
}

/** The trigger's width and lift as it comes back, `index` frames into its return. */
export function triggerReturn(index: number) {
  "worklet";
  const [, , scaleX, lift] = lerpRow(DROPLET, index);
  return { scaleX, lift };
}
