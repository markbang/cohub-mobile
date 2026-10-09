export type KeyboardFrame = {
  screenY: number;
  height: number;
};

/**
 * iOS re-posts the keyboard notification when the app returns to the foreground with the
 * keyboard up, and that resume frame can arrive with a zero origin (likely because RN
 * converts it through `RCTKeyWindow()`, which has no key window while the scene is still
 * activating, yielding CGRectZero). A docked keyboard never starts at the top of the window,
 * so such a frame is not a keyboard.
 */
export function isUsableKeyboardFrame(frame: KeyboardFrame | null | undefined): boolean {
  return frame != null && frame.screenY > 0 && frame.height > 0;
}

/** Height of the window covered by the keyboard; unusable frames cover nothing. */
export function keyboardOverlap(frame: KeyboardFrame | null | undefined, windowHeight: number): number {
  if (!frame || !isUsableKeyboardFrame(frame)) return 0;
  return Math.max(0, Math.min(frame.height, windowHeight - frame.screenY));
}
