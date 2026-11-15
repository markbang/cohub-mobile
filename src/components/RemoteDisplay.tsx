import type { DisplayInputEvent } from "@neta-art/cohub";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { clampCamera, click, containedRect, createScrollAccumulator, FIT_CAMERA, followCamera, moveCursor, panCamera, toDisplayPoint, toSurfacePoint, withModifiers, zoomCamera, type DisplayCamera, type DisplayModifier, type Point, type Rect } from "@/src/data/display-control";
import { createDisplayTouch, type DisplayTouch, type DisplayTouchIntent, type DisplayTouchMode } from "@/src/data/display-touch";
import type { DisplayFrame } from "@/src/data/use-display-frames";
import { haptics } from "@/src/platform/haptics";

type Props = {
  frame: DisplayFrame | null;
  /** The display's own size, for the frame's place before the first frame arrives. */
  width: number;
  height: number;
  mode: DisplayTouchMode;
  controllable: boolean;
  /** macOS scrolls in pixels; the others in wheel notches. */
  fineScroll: boolean;
  modifiers: readonly DisplayModifier[];
  onModifiersUsed: () => void;
  send: (events: DisplayInputEvent[]) => void;
  accessibilityLabel: string;
};

const keysDown = (keys: readonly DisplayModifier[]) => keys.map((key): DisplayInputEvent => ({ type: "key", action: "down", key }));
const keysUp = (keys: readonly DisplayModifier[]) => [...keys].reverse().map((key): DisplayInputEvent => ({ type: "key", action: "up", key }));

const CURSOR_PATH = "M1 1 L1 17 L5.5 12.8 L8.6 19.6 L11.4 18.4 L8.4 11.7 L14.4 11.7 Z";

/**
 * Draws polled frames of a remote display and turns touches on it into its input. Frames are
 * double-buffered: the next one decodes underneath and replaces the shown one only once loaded.
 */
export function RemoteDisplay({ frame, width, height, mode, controllable, fineScroll, modifiers, onModifiersUsed, send, accessibilityLabel }: Props) {
  const surfaceRef = useRef<View>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const [camera, setCameraState] = useState<DisplayCamera>(FIT_CAMERA);
  const [cursor, setCursorState] = useState<Point>({ x: 0.5, y: 0.5 });
  const [slots, setSlots] = useState<[DisplayFrame | null, DisplayFrame | null]>([null, null]);
  const [front, setFrontState] = useState(0);
  const frontRef = useRef(0);
  const setFront = (index: number) => { frontRef.current = index; setFrontState(index); };

  const sourceWidth = frame?.width ?? width;
  const sourceHeight = frame?.height ?? height;
  const content = useMemo<Rect>(() => containedRect({ left: 0, top: 0, width: box.width, height: box.height }, sourceWidth, sourceHeight), [box.height, box.width, sourceHeight, sourceWidth]);

  // Touch callbacks read the latest values without rebuilding the touch machine each render.
  const live = useRef({ camera, cursor, content, box, mode, modifiers, controllable, fineScroll, send, onModifiersUsed });
  useLayoutEffect(() => {
    Object.assign(live.current, { content, box, mode, modifiers, controllable, fineScroll, send, onModifiersUsed });
  }, [box, content, controllable, fineScroll, mode, modifiers, onModifiersUsed, send]);
  const setCamera = (next: DisplayCamera) => { live.current.camera = next; setCameraState(next); };
  const setCursor = (next: Point) => { live.current.cursor = next; setCursorState(next); };

  useEffect(() => {
    if (!frame) return;
    setSlots((current) => {
      const next: [DisplayFrame | null, DisplayFrame | null] = [...current];
      next[1 - frontRef.current] = frame;
      return next;
    });
  }, [frame]);

  // A resize (rotation, the keyboard) keeps the zoom but pulls the frame back into view.
  useEffect(() => {
    setCamera(clampCamera(live.current.camera, content, box));
  }, [box, content]);

  const touch = useRef<DisplayTouch | null>(null);
  useEffect(() => {
    let pressed = false;
    let heldModifiers: DisplayModifier[] = [];
    const scroll = createScrollAccumulator(() => live.current.fineScroll);
    const at = (x: number, y: number, clamp = false) => toDisplayPoint(x, y, live.current.content, live.current.camera, clamp);
    const takeModifiers = () => {
      const held = [...live.current.modifiers];
      if (held.length) live.current.onModifiersUsed();
      return held;
    };
    // A view-only display still zooms and pans here; only its input is dropped.
    const emit = (events: DisplayInputEvent[]) => { if (live.current.controllable) live.current.send(events); };
    const handle = (intent: DisplayTouchIntent) => {
      const { content: rect, box: frameBox } = live.current;
      switch (intent.type) {
        case "press": {
          const point = at(intent.x, intent.y);
          pressed = point !== null;
          if (!point) return;
          heldModifiers = takeModifiers();
          emit([
            ...keysDown(heldModifiers),
            { type: "pointer", action: "move", ...point },
            { type: "pointer", action: "down", ...point, button: "primary" },
          ]);
          return;
        }
        case "drag": {
          const point = pressed ? at(intent.x, intent.y, true) : null;
          if (point) emit([{ type: "pointer", action: "move", ...point }]);
          return;
        }
        case "release": {
          if (!pressed) return;
          pressed = false;
          const point = at(intent.x, intent.y, true);
          emit([
            point ? { type: "pointer", action: "up", ...point, button: "primary" } : { type: "pointer", action: "cancel", x: 0, y: 0 },
            ...keysUp(heldModifiers),
          ]);
          heldModifiers = [];
          return;
        }
        case "cancel":
          if (!pressed) return;
          pressed = false;
          emit([{ type: "pointer", action: "cancel", x: 0, y: 0 }, ...keysUp(heldModifiers)]);
          heldModifiers = [];
          return;
        case "move": {
          const next = moveCursor(live.current.cursor, intent.dx, intent.dy, rect, live.current.camera);
          setCursor(next);
          setCamera(followCamera(live.current.camera, next, rect, frameBox));
          emit([{ type: "pointer", action: "move", ...next }]);
          return;
        }
        case "tap":
          emit(withModifiers(takeModifiers(), click(live.current.cursor)));
          return;
        case "hold":
          haptics.longPress();
          heldModifiers = takeModifiers();
          emit([...keysDown(heldModifiers), { type: "pointer", action: "down", ...live.current.cursor, button: "primary" }]);
          return;
        case "drop":
          emit([{ type: "pointer", action: "up", ...live.current.cursor, button: "primary" }, ...keysUp(heldModifiers)]);
          heldModifiers = [];
          return;
        case "secondary": {
          const point = live.current.mode === "trackpad" ? live.current.cursor : at(intent.x, intent.y);
          if (!point) return;
          haptics.longPress();
          emit(withModifiers(takeModifiers(), click(point, "secondary")));
          return;
        }
        case "pinch": {
          if (intent.zoom) {
            setCamera(zoomCamera(live.current.camera, intent.scale, intent.x, intent.y, rect, frameBox));
            return;
          }
          // Two fingers pan a zoomed frame first, as a photo does; what is left scrolls the computer.
          const trackpad = live.current.mode === "trackpad";
          let rest = { dx: intent.dx, dy: intent.dy };
          if (!trackpad) {
            const panned = panCamera(live.current.camera, intent.dx, intent.dy, rect, frameBox);
            setCamera(panned.camera);
            rest = panned.rest;
          }
          const point = trackpad ? live.current.cursor : at(intent.x, intent.y, true);
          const step = point && scroll.add(rest.dx, rest.dy, rect, live.current.camera);
          if (point && step) emit([{ type: "scroll", ...point, ...(step.dx ? { dx: step.dx } : {}), ...(step.dy ? { dy: step.dy } : {}) }]);
          return;
        }
        case "settle":
          scroll.reset();
          return;
      }
    };
    const created = createDisplayTouch({ mode: () => live.current.mode, emit: handle });
    touch.current = created;
    return () => {
      created.dispose();
      touch.current = null;
    };
  }, []);

  const local = (event: GestureResponderEvent) => event.nativeEvent.changedTouches.map((item) => ({ id: Number(item.identifier), x: item.pageX - origin.current.x, y: item.pageY - origin.current.y, at: item.timestamp }));
  const onLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    setBox({ width: w, height: h });
    surfaceRef.current?.measureInWindow((x, y) => { origin.current = { x, y }; });
  };

  const placed = { left: content.left * camera.scale + camera.x, top: content.top * camera.scale + camera.y, width: content.width * camera.scale, height: content.height * camera.scale };
  const pointer = mode === "trackpad" && controllable && frame ? toSurfacePoint(cursor, content, camera) : null;

  return <View
    ref={surfaceRef}
    onLayout={onLayout}
    accessible
    accessibilityLabel={accessibilityLabel}
    // design-system: the remote screen sits on black in every theme, as video does.
    style={{ flex: 1, overflow: "hidden", backgroundColor: "#000000" }}
    onStartShouldSetResponder={() => true}
    onMoveShouldSetResponder={() => true}
    onResponderTerminationRequest={() => false}
    onTouchStart={(event) => { for (const item of local(event)) touch.current?.down(item.id, item.x, item.y, item.at); }}
    onTouchMove={(event) => { for (const item of local(event)) touch.current?.move(item.id, item.x, item.y); }}
    onTouchEnd={(event) => { for (const item of local(event)) touch.current?.up(item.id, item.x, item.y, item.at); }}
    onTouchCancel={(event) => { for (const item of local(event)) touch.current?.cancel(item.id); }}
  >
    <View pointerEvents="none" style={{ position: "absolute", ...placed }}>
      {slots.map((slot, index) => slot ? <Image
        key={index}
        source={{ uri: slot.uri }}
        fadeDuration={0}
        resizeMode="stretch"
        onLoad={() => { if (index !== frontRef.current && slot.seq > (slots[frontRef.current]?.seq ?? -1)) setFront(index); }}
        style={{ position: "absolute", left: 0, top: 0, width: placed.width, height: placed.height, opacity: index === front ? 1 : 0, zIndex: index === front ? 1 : 0 }}
      /> : null)}
    </View>
    {pointer ? <View pointerEvents="none" style={{ position: "absolute", left: pointer.x - 1, top: pointer.y - 1 }}>
      {/* design-system: a cursor is white with a black edge on any screen, as the system's is. */}
      <Svg width={16} height={21} viewBox="0 0 16 21"><Path d={CURSOR_PATH} fill="#FFFFFF" stroke="#000000" strokeWidth={1.2} strokeLinejoin="round" /></Svg>
    </View> : null}
  </View>;
}
