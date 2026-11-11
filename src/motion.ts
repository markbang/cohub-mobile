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
  /** iOS 27's sheet presentation, fitted to a recording (liquidglass): a fast launch that settles without overshoot. */
  sheetPresent: { mass: 1, stiffness: 700, damping: 65 },
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
  /** The minimized tab bar growing back, fitted to UIKit's: it peaks 1.4% past full width at 240 ms. */
  tabBarExpand: { mass: 1, stiffness: 475, damping: 0.8 * 2 * Math.sqrt(475) },
} as const;

/**
 * UIKit's tab bar minimizing on scroll, fitted frame by frame (iOS 26): the bar squeezes in by about 13 pt
 * a side over 180 ms (`squeeze`), collapses into a 48 pt circle around the selected tab from 150 ms
 * (`collapse`), and lets the squeeze go once it has arrived (`release`).
 */
export const tabBarMinimize = {
  squeeze: { duration: 180, curve: [0.42, 0, 1, 1] },
  collapse: { delay: 150, duration: 260, curve: [0.3, 0, 0.2, 1] },
  release: { delay: 170, duration: 300, curve: [0.25, 0.1, 0.25, 1] },
} as const;

/**
 * iOS 27's glass button under a finger, fitted by liquidglass to recordings: it grows until its longer side is
 * 16 pt bigger, and on release bounces back about 29% past its resting size.
 */
export const glassPress = {
  grow: 16,
  press: { mass: 1, stiffness: 795, damping: 38 },
  release: { mass: 1, stiffness: 342, damping: 13.5 },
  /** A pressed glass label fades to this in light mode. */
  inkOpacity: 0.77,
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
 * A drawn menu morphs out of its trigger and back as iOS 27's does; the frame-by-frame shape is in
 * `src/ui/menu-morph.ts`. Its corner is iOS 27's menu radius, measured.
 */
export const menuMorph = {
  radius: 33,
  /** The trigger fades back in once the closing menu has run into it, at about 250 ms on iOS 27. */
  reveal: { delay: 250, duration: 100 },
} as const;

/**
 * A finger on a drawn menu, after expo-glass-custom-menu (MIT): the row capsule slides between rows and fades on
 * release, and the panel leans toward a drag, stretching along it and narrowing across it, then springs back.
 * `stretch`, `squash` and `shift` are the full amounts in points, reached as tanh(drag / `reach`) runs to 1.
 */
export const menuScrub = {
  plateSlide: { duration: 130, dampingRatio: 0.85 },
  plateFade: { duration: 140, dampingRatio: 1 },
  dragFollow: { duration: 180, dampingRatio: 0.65 },
  dragRelease: { duration: 450, dampingRatio: 0.5 },
  reach: 260,
  stretch: 16,
  squash: 21,
  shift: 21,
  /** A sliding finger this far outside the menu still lights the nearest row. */
  slack: 24,
  /** The capsule's inset from the menu's sides. */
  plateInset: 8,
} as const;

/**
 * Drawn Android alerts: iOS 27's alert, settling from 1.125 × over 240 ms while it fades in. `settle` is its
 * measured curve (liquidglass), as [time, progress] points.
 */
export const dialog = {
  enter: { duration: 240 },
  fromScale: 1.125,
  settle: [[0, 0], [0.07, 0.08], [0.14, 0.176], [0.21, 0.352], [0.28, 0.5], [0.35, 0.6], [0.42, 0.7], [0.49, 0.8], [0.56, 0.848], [0.63, 0.9], [0.77, 0.952], [1, 1]],
} as const;

/** iOS 27 dims the screen under a sheet by a fifth, and by 48% in dark mode; under an alert by 36%, and 74% in dark mode. */
export const scrim = { light: 0.2, dark: 0.48, alertLight: 0.36, alertDark: 0.74 } as const;

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
  /** One pass of a Bot's typing dots; each dot starts `stagger` after the last. */
  typingDots: { duration: 1200, stagger: 160 },
} as const;
