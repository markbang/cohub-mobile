export type ComposerMenuAnchor = { x: number; y: number; width: number; height: number };

export function getComposerMenuLayout(input: {
  anchor: ComposerMenuAnchor;
  windowWidth: number;
  windowHeight: number;
  topInset: number;
  bottomInset: number;
  keyboardTop: number | null;
  preferredWidth: number;
}): { left: number; bottom: number; width: number; maxHeight: number } {
  const margin = 12;
  const top = input.topInset + margin;
  // The menu replaces the composer button that opened it: it covers the button and grows up from its bottom edge.
  const anchorBottom = Math.min(input.anchor.y + input.anchor.height, input.keyboardTop ?? input.windowHeight);
  const bottom = Math.max(input.bottomInset + margin, input.windowHeight - anchorBottom);
  const width = Math.min(input.preferredWidth, Math.max(0, input.windowWidth - margin * 2));
  return {
    left: Math.max(margin, Math.min(input.anchor.x, input.windowWidth - margin - width)),
    bottom,
    width,
    maxHeight: Math.max(0, Math.min(480, input.windowHeight - bottom - top)),
  };
}
