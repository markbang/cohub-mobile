import type { DisplayInputEvent } from "@neta-art/cohub";

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };
/** Local zoom: `scale` around the frame's origin, then shifted by `x`/`y` (in surface points). */
export type DisplayCamera = { scale: number; x: number; y: number };

export const FIT_CAMERA: DisplayCamera = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;
// Matches the web client: a trackpad accelerates past a few points of travel, up to 2.5×.
const TRACKPAD_GAIN = { base: 1, max: 2.5, from: 4, per: 12 } as const;
// macOS scrolls in pixels, others in wheel notches; the web client sends the same fractions.
const SCROLL_STEP = { notch: 1 / 20, fine: 1 / 500 } as const;

export type DisplayQuality = "speed" | "balanced" | "sharp";
export const DISPLAY_QUALITIES: readonly DisplayQuality[] = ["speed", "balanced", "sharp"];
/** JPEG frames over HTTP: smaller frames arrive more often; `sharp` sends the display's own size. */
export const DISPLAY_QUALITY_PARAMS: Record<DisplayQuality, { quality: number; maxSize?: number }> = {
  speed: { quality: 45, maxSize: 1280 },
  balanced: { quality: 65, maxSize: 1920 },
  sharp: { quality: 80 },
};

export function containedRect(box: Rect, width: number, height: number): Rect {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return box;
  const scale = Math.min(box.width / width, box.height / height);
  return { left: box.left + (box.width - width * scale) / 2, top: box.top + (box.height - height * scale) / 2, width: width * scale, height: height * scale };
}

/** The surface point under the camera, as a 0–1 point on the display; `null` off the display unless clamped. */
export function toDisplayPoint(x: number, y: number, content: Rect, camera: DisplayCamera, clamp = false): Point | null {
  if (content.width <= 0 || content.height <= 0) return null;
  const px = ((x - camera.x) / camera.scale - content.left) / content.width;
  const py = ((y - camera.y) / camera.scale - content.top) / content.height;
  if (clamp) return { x: unit(px), y: unit(py) };
  return px < 0 || px > 1 || py < 0 || py > 1 ? null : { x: px, y: py };
}

/** Where a display point lands on the surface under the camera. */
export function toSurfacePoint(point: Point, content: Rect, camera: DisplayCamera): Point {
  return { x: (content.left + point.x * content.width) * camera.scale + camera.x, y: (content.top + point.y * content.height) * camera.scale + camera.y };
}

function clampAxis(offset: number, scale: number, start: number, extent: number, frame: number) {
  const size = extent * scale;
  const origin = start * scale;
  if (size <= frame) return (frame - size) / 2 - origin;
  return Math.min(-origin, Math.max(frame - size - origin, offset));
}

export function clampCamera(camera: DisplayCamera, content: Rect, frame: { width: number; height: number }): DisplayCamera {
  const scale = Math.min(MAX_SCALE, Math.max(1, camera.scale));
  return { scale, x: clampAxis(camera.x, scale, content.left, content.width, frame.width), y: clampAxis(camera.y, scale, content.top, content.height, frame.height) };
}

export function zoomCamera(camera: DisplayCamera, factor: number, x: number, y: number, content: Rect, frame: { width: number; height: number }): DisplayCamera {
  const scale = Math.min(MAX_SCALE, Math.max(1, camera.scale * factor));
  const ratio = scale / camera.scale;
  return clampCamera({ scale, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio }, content, frame);
}

/** Pans as far as the zoomed display allows and returns what is left, which scrolls the remote instead. */
export function panCamera(camera: DisplayCamera, dx: number, dy: number, content: Rect, frame: { width: number; height: number }) {
  const next = clampCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }, content, frame);
  return { camera: next, rest: { dx: dx - (next.x - camera.x), dy: dy - (next.y - camera.y) } };
}

/** Keeps a zoomed camera on the trackpad cursor, with a margin so it never sits on the edge. */
export function followCamera(camera: DisplayCamera, point: Point, content: Rect, frame: { width: number; height: number }, margin = 48): DisplayCamera {
  if (camera.scale <= 1.001) return camera;
  const at = toSurfacePoint(point, content, camera);
  const shift = (value: number, extent: number) => value < margin ? margin - value : value > extent - margin ? extent - margin - value : 0;
  return clampCamera({ ...camera, x: camera.x + shift(at.x, frame.width), y: camera.y + shift(at.y, frame.height) }, content, frame);
}

export function moveCursor(from: Point, dx: number, dy: number, content: Rect, camera: DisplayCamera): Point {
  const { base, max, from: start, per } = TRACKPAD_GAIN;
  const gain = Math.min(max, base + Math.max(0, (Math.hypot(dx, dy) - start) / per));
  const width = content.width * camera.scale;
  const height = content.height * camera.scale;
  if (width <= 0 || height <= 0) return from;
  return { x: unit(from.x + (dx * gain) / width), y: unit(from.y + (dy * gain) / height) };
}

/**
 * Collects two-finger scrolling in display fractions and releases whole steps, so slow drags still
 * scroll and fast ones never exceed the protocol's range.
 */
export function createScrollAccumulator(fine: () => boolean) {
  let pending = { dx: 0, dy: 0 };
  return {
    add(dx: number, dy: number, content: Rect, camera: DisplayCamera) {
      const width = content.width * camera.scale;
      const height = content.height * camera.scale;
      if (width <= 0 || height <= 0) return null;
      // Content follows the fingers, so the wheel turns the other way.
      pending = { dx: pending.dx - dx / width, dy: pending.dy - dy / height };
      const step = fine() ? SCROLL_STEP.fine : SCROLL_STEP.notch;
      const take = (value: number) => Math.trunc(value / step) * step;
      const out = { dx: take(pending.dx), dy: take(pending.dy) };
      pending = { dx: pending.dx - out.dx, dy: pending.dy - out.dy };
      if (!out.dx && !out.dy) return null;
      return { dx: Math.max(-1, Math.min(1, out.dx)), dy: Math.max(-1, Math.min(1, out.dy)) };
    },
    reset() {
      pending = { dx: 0, dy: 0 };
    },
  };
}

export const DISPLAY_MODIFIERS = ["Control", "Alt", "Shift", "Meta"] as const;
export type DisplayModifier = (typeof DISPLAY_MODIFIERS)[number];

/** Presses `keys` (or a click) with the modifiers held, then releases them in reverse. */
export function withModifiers(modifiers: readonly DisplayModifier[], events: DisplayInputEvent[]): DisplayInputEvent[] {
  const ordered = DISPLAY_MODIFIERS.filter((key) => modifiers.includes(key));
  return [
    ...ordered.map((key): DisplayInputEvent => ({ type: "key", action: "down", key })),
    ...events,
    ...[...ordered].reverse().map((key): DisplayInputEvent => ({ type: "key", action: "up", key })),
  ];
}

export function click(point: Point, button: "primary" | "secondary" = "primary"): DisplayInputEvent[] {
  return [
    { type: "pointer", action: "move", ...point },
    { type: "pointer", action: "down", ...point, button },
    { type: "pointer", action: "up", ...point, button },
  ];
}

const TEXT_PIECE = 512;

/** Text in protocol-sized pieces; a shortcut (a single character with modifiers) is a key press instead. */
export function typedEvents(text: string, modifiers: readonly DisplayModifier[]): DisplayInputEvent[] {
  const chars = [...text];
  if (modifiers.length > 0 && chars.length === 1) return withModifiers(modifiers, [{ type: "key", action: "press", key: chars[0].toLowerCase() }]);
  const events: DisplayInputEvent[] = [];
  for (let index = 0; index < chars.length; index += TEXT_PIECE) events.push({ type: "text", text: chars.slice(index, index + TEXT_PIECE).join("") });
  return events;
}

/**
 * Sends input in order, one request at a time. While one is in flight, pointer moves collapse to the
 * latest, so a drag over a slow link lands where the finger is instead of replaying its whole path.
 */
export function createInputQueue(send: (events: DisplayInputEvent[]) => Promise<unknown>, onError: (error: unknown) => void, onSent?: () => void) {
  let pending: DisplayInputEvent[] = [];
  let busy = false;
  let closed = false;

  const isMove = (event: DisplayInputEvent | undefined) => event?.type === "pointer" && event.action === "move";

  async function pump() {
    if (busy || closed) return;
    busy = true;
    try {
      while (pending.length > 0 && !closed) {
        const batch = pending.slice(0, 256);
        pending = pending.slice(batch.length);
        try {
          await send(batch);
          onSent?.();
        } catch (error) {
          // A failed batch may have left a button or key down; what follows would act on a stale state.
          pending = [];
          if (!closed) onError(error);
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    push(events: DisplayInputEvent[]) {
      if (closed || events.length === 0) return;
      for (const event of events) {
        if (isMove(event) && isMove(pending.at(-1))) pending[pending.length - 1] = event;
        else pending.push(event);
      }
      void pump();
    },
    close() {
      closed = true;
      pending = [];
    },
  };
}

export type InputQueue = ReturnType<typeof createInputQueue>;

function unit(value: number) {
  return Math.min(1, Math.max(0, value));
}
