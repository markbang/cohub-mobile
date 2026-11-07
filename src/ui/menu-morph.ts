/**
 * iOS 27's pull-down menu morph, one row per 60 fps frame. Width, height and centre run from the trigger (0)
 * to the menu (1); a width below 0 is a ball between the two, up to `BALL` of the menu's width at -1.48.
 *
 * Opening is liquidglass's measurement (github.com/onlymoein/liquidglass, MIT, `src/menu.tsx`): the trigger
 * squeezes into a ball that falls past the menu's centre and swells into the menu as the rows zoom through
 * 1.28. It was taken from a wide pill centred over its menu, so here the ball is sized by the menu and moves
 * across with the centre, as iOS's mid-open frames show for a corner trigger. Closing is read from the UI
 * Snapshots iOS 27 recording: the menu zooms a touch and fades, falls into a faint ball at its centre, and
 * is gone into the trigger in about 220 ms; the trigger fades back in at about 250 ms.
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
// Then the glass's opacity, and how far across from the trigger it is: closing, it is back over the trigger
// horizontally while still falling to the menu's middle.
const CLOSING: readonly (readonly [...Row, number, number])[] = [
  [1, 1, 1, 1, 0, 1, 1],
  [1, 1, 1, 1.02, 0.05, 0.85, 1],
  [0.99, 1, 1, 1.03, 0.1, 0.7, 1],
  [-0.2, 0.75, 1, 0.97, 0.6, 0.45, 0.6],
  [-0.9, 0.48, 0.97, 0.9, 1, 0.25, 0.25],
  [-0.7, 0.25, 0.5, 0.86, 1, 0.12, 0.25],
  [-0.4, 0.14, 0.33, 0.84, 1, 0.06, 0.2],
  [0, 0, 0, 0.82, 1, 0, 0],
];
// The frame each closing row lands on, at 60 fps.
const CLOSING_AT = [0, 2.5, 5, 6.3, 7.6, 10, 11.2, 13];
/** The ball at its widest (`width` -1.48), as a share of the menu's width: 106 pt of 250 on iOS 27. */
const BALL = 0.424;

export const MORPH_FRAME_MS = 1000 / 60;
/** Frames from the trigger to the settled menu. */
export const OPEN_FRAMES = OPENING.length - 1;
/** Frames from the menu to nothing left of it. */
export const CLOSE_FRAMES = CLOSING_AT[CLOSING_AT.length - 1];

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

/** The closing row at frame `at`, between the measured frames. */
function closingRow(at: number) {
  "worklet";
  let i = 1;
  while (i < CLOSING_AT.length - 1 && at > CLOSING_AT[i]) i++;
  const t = Math.min(1, Math.max(0, (at - CLOSING_AT[i - 1]) / (CLOSING_AT[i] - CLOSING_AT[i - 1])));
  return CLOSING[i - 1].map((value, k) => value + (CLOSING[i][k] - value) * t);
}

/** Where to pick up the other way so the shape is as tall, when a morph reverses part-way. */
export function resumeFrame(opening: boolean, at: number, wasOpening: boolean) {
  "worklet";
  const height = wasOpening ? lerpRow(OPENING, at)[1] : closingRow(at)[1];
  let best = 0;
  if (opening) {
    for (let i = 1; i < OPENING.length; i++) if (Math.abs(OPENING[i][1] - height) < Math.abs(OPENING[best][1] - height)) best = i;
    return best;
  }
  for (let i = 1; i < CLOSING.length; i++) if (Math.abs(CLOSING[i][1] - height) < Math.abs(CLOSING[best][1] - height)) best = i;
  return CLOSING_AT[best];
}

export type MorphShape = MorphRect & { corner: number; zoom: number; shift: number; glass: number; rows: number };

/**
 * The glass at frame `at`, in the coordinates of the settled menu `to` (origin at its top left), grown out of
 * `from`. `glass` and `rows` are their opacities; `zoom` and `shift` place the rows about the menu's centre.
 */
export function morphShape(opening: boolean, at: number, from: MorphRect, to: { width: number; height: number }, radius: number): MorphShape {
  "worklet";
  const row = opening ? lerpRow(OPENING, at) : closingRow(at);
  const [w, h, c, zoom, round] = row;
  const glass = opening ? 1 : row[5];
  const ball = BALL * to.width;
  const width = Math.max(from.height * 0.8, w < 0 ? from.width + (ball - from.width) * (-w / 1.48) : w > 1 ? to.width * (1 + 0.232 * (w - 1)) : from.width + (to.width - from.width) * w);
  const height = h > 1 ? to.height * (1 + 0.69 * (h - 1)) : from.height + (to.height - from.height) * h;
  const homeX = from.x + from.width / 2;
  const homeY = from.y + from.height / 2;
  const centreX = homeX + (to.width / 2 - homeX) * (opening ? Math.min(1, Math.max(0, c)) : row[6]);
  const centreY = homeY + (to.height / 2 - homeY) * c;
  const roundest = Math.min(1, radius / (Math.min(to.width, to.height) / 2));
  return {
    x: centreX - width / 2,
    y: centreY - height / 2,
    width,
    height,
    corner: (roundest + (1 - roundest) * round) * Math.min(width, height) / 2,
    zoom,
    // The rows ride lower than the glass as it passes the menu's centre.
    shift: (centreY - to.height / 2) * 0.45,
    glass,
    rows: opening ? clamp01((at - 1) / 6) : glass,
  };
}
