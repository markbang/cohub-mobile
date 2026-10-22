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
  pressOut: { duration: 360, dampingRatio: 0.62 },
  /** A small selection pop, such as a tab icon becoming active. */
  pop: { duration: 380, dampingRatio: 0.55 },
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

/**
 * Menus and popovers, after the ColorOS popup measured frame by frame: the panel unfolds from its anchor
 * without overshoot, mostly downward, and closes by shrinking back while it blurs and fades.
 */
export const popover = {
  open: { duration: 280 },
  close: { duration: 200 },
  /** It grows taller far more than wider, so it reads as unfolding rather than zooming. */
  from: { x: 0.8, y: 0.5 },
  /** Blur radius a closing panel reaches; Android only, where `filter: blur` is supported. */
  closeBlur: 10,
} as const;
