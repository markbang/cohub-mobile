/** Shared motion timings (inspired by native settle curves; keep values in one place). */
export const motion = {
  pressIn: { duration: 90 },
  fade: { duration: 150 },
  /** Dismissals run shorter than their entrance: the user has already looked away. */
  fadeOut: { duration: 120 },
  settle: { duration: 240 },
  glide: { duration: 280 },
  sendBubble: { duration: 360, dampingRatio: 1 },
} as const;

/** Cubic-bezier control points; spread into Reanimated's `Easing.bezier`. Nothing on screen eases in. */
export const curves = {
  /** Entering and exiting. */
  easeOut: [0.23, 1, 0.32, 1],
  /** Moving between two on-screen positions. */
  easeInOut: [0.77, 0, 0.175, 1],
} as const;

// UIKit's sheet spring (mass 3, stiffness 1000), as measured from UISheetPresentationController:
// critically damped, settles in about 0.5 s. A release thrown toward its target lands with ~0.8 damping.
const SHEET_MASS = 3;
const SHEET_STIFFNESS = 1000;
const SHEET_CRITICAL_DAMPING = 2 * Math.sqrt(SHEET_MASS * SHEET_STIFFNESS);

/** Reanimated spring presets. Kept import-free for the Node checks; `withSpring` defaults to the system Reduce Motion setting. */
export const springs = {
  sheet: { mass: SHEET_MASS, stiffness: SHEET_STIFFNESS, damping: SHEET_CRITICAL_DAMPING },
  sheetThrown: { mass: SHEET_MASS, stiffness: SHEET_STIFFNESS, damping: SHEET_CRITICAL_DAMPING * 0.8 },
  /** A selection capsule sliding between tabs or segments. */
  indicator: { duration: 380, dampingRatio: 0.82 },
  pressIn: { duration: 140, dampingRatio: 1 },
  /** Cards are pressed tens of times a day, so the release settles with only a trace of overshoot. */
  pressOut: { duration: 320, dampingRatio: 0.86 },
  // The tab bar's lens, after UIKit's tab bar as measured frame by frame (see FloatingTabBar).
  dockLift: { duration: 250, dampingRatio: 1 },
  dockTravel: { duration: 400, dampingRatio: 0.85 },
  dockFollow: { mass: 1, stiffness: 1024, damping: 0.9 * 2 * Math.sqrt(1024) },
  dockPress: { mass: 1, stiffness: 311, damping: 0.593 * 2 * Math.sqrt(311) },
  dockJelly: { mass: 1, stiffness: 100, damping: 0.4 * 2 * Math.sqrt(100) },
  dockTrack: { duration: 120, dampingRatio: 1 },
} as const;

/** Pressed scale for card/row press feedback; 1 means resting. */
export const press = {
  scale: 0.985,
  /** Compact controls such as tabs travel further so the press reads at their size. */
  compactScale: 0.92,
} as const;

/** A control whose glyph swaps (send, stop, add, close) on every use: a short crossfade with a hint of scale, no bounce. */
export const glyphSwap = {
  fromScale: 0.9,
} as const;

/**
 * Menus and popovers open many times a day, so the panel only hints at its anchor: a short ease-out
 * from just under full size, taller growth than wider, and a quicker fade back on close.
 */
export const popover = {
  open: { duration: 200 },
  close: { duration: 150 },
  from: { x: 0.97, y: 0.95 },
  /** Suggestion menus reappear on each keystroke, so they grow uniformly from nearly full size and never pulse. */
  typingFromScale: 0.98,
} as const;

/**
 * A drawn menu grows out of the control that opened it and shrinks back into it, as iOS 26 menus do.
 * The open carries a trace of overshoot so the panel lands; the close settles straight into the control.
 */
export const menuMorph = {
  open: { duration: 360, dampingRatio: 0.84 },
  close: { duration: 280, dampingRatio: 1 },
} as const;

/** Drawn Android alerts: UIAlertController's entrance, shrinking from 1.2 × while it fades in. */
export const dialog = {
  enter: { duration: 220 },
  fromScale: 1.2,
} as const;

/** Ambient loops that signal ongoing work; each one stops under Reduce Motion unless noted. */
export const loops = {
  /** Eyes stay shut this long per blink. Blinking survives Reduce Motion: it is a crossfade, not movement. */
  blink: { duration: 130 },
  /** Uneven gaps between blinks so the loop does not read as a metronome. */
  blinkGaps: [2900, 4700, 3500],
  /** How long the mascot holds each glance, and how long its eyes take to move. */
  glanceHold: { duration: 800 },
  glanceMove: { duration: 120 },
  /** One slow breath of a running avatar ring. */
  runningRing: { duration: 2400 },
} as const;
