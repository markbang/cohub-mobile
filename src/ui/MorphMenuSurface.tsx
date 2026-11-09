import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { findNodeHandle, Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { RADIUS } from "@/src/design/tokens";
import { menuMorph, menuScrub, motion } from "@/src/motion";
import { GlassMenuView, nativeGlassMenu, type GlassMenuState } from "@/src/platform/glass-menu";
import { useAppTheme } from "@/src/theme";
import { GlassBackground, useGlassBackdropTarget, useGlassMaterial, useReduceTransparency } from "@/src/ui/Glass";
import { useScreenVisible } from "@/src/ui/pane";
import { CLOSE_FRAMES, MORPH_FRAME_MS, OPEN_FRAMES, morphShape, resumeFrame, type MorphRect } from "@/src/ui/menu-morph";

export type { MorphRect } from "@/src/ui/menu-morph";

/** iOS 27's menu corner, measured; the composer's panel keeps the sheet radius. */
const GLASS_MENU_RADIUS = menuMorph.radius;
const LINEAR = Easing.linear;

type MorphMenuSurfaceProps = Omit<ViewProps, "style" | "children"> & {
  /** The control that opened the menu, in the coordinates of the surface's parent. */
  anchor: MorphRect;
  /** Turning false shrinks the menu back into `anchor`; `onClosed` fires once it is there. */
  open: boolean;
  onClosed: () => void;
  /** Places the settled panel in its parent; the surface is absolutely positioned. */
  style: StyleProp<ViewStyle>;
  /** `glass`: a floating menu; `panel`: the composer's larger sheet, solid and bordered on iOS, glass on Android. */
  material?: "glass" | "panel";
  /** The trigger's view; Android's glass draws it while it morphs. */
  anchorRef?: RefObject<View | null>;
  /** A trigger without glass of its own (a select's value): Android's glass fades in from it rather than budding. */
  plainTrigger?: boolean;
  children: ReactNode;
};

/**
 * A menu panel that takes the place of its trigger. On Android 13+ the native glass draws it as
 * expo-glass-custom-menu does (`GlassMenuSurface`); elsewhere, and under Reduce Motion or Reduce Transparency,
 * it is drawn here (`DrawnMorphMenuSurface`).
 */
export function MorphMenuSurface(props: MorphMenuSurfaceProps) {
  const reduced = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  return nativeGlassMenu && !reduced && !reduceTransparency ? <GlassMenuSurface {...props} /> : <DrawnMorphMenuSurface {...props} />;
}

/**
 * A menu panel that takes the place of its trigger, morphing as iOS 27's does (`menu-morph.ts`): the
 * trigger drops as a ball and swells into the menu, and on close the menu fades into a ball that runs back
 * into the trigger. The owner hides the trigger through `MenuAnchor`. The backdrop is a childless
 * absolute layer, so animating its frame re-lays out nothing else; the rows keep their final layout and are
 * only moved, zoomed and clipped by transforms, so hit-testing matches what is drawn once the menu settles.
 */
function DrawnMorphMenuSurface({ anchor, open, onClosed, style, material = "glass", anchorRef: _anchorRef, plainTrigger: _plainTrigger, children, ...viewProps }: MorphMenuSurfaceProps) {
  const glass = useGlassMaterial();
  const reduced = useReducedMotion();
  // Frames into the current morph (a 0–1 fade under Reduce Motion), and which way it runs.
  const frame = useSharedValue(0);
  const opening = useSharedValue(true);
  const started = useRef(false);
  const [box, setBox] = useState<MorphRect | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const surface = useMemo<MenuSurface>(() => ({ drag: { x: dragX, y: dragY }, plate: null }), [dragX, dragY]);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);

  const measured = box !== null;
  useEffect(() => {
    // Closed before it was ever laid out: there is nothing on screen to shrink.
    if (!measured) { if (!open) onClosedRef.current(); return; }
    const finishClose = () => onClosedRef.current();
    const done = (finished?: boolean) => {
      "worklet";
      if (finished && !open) scheduleOnRN(finishClose);
    };
    if (reduced) {
      opening.set(open);
      frame.set(withTiming(open ? 1 : 0, { duration: open ? motion.fade.duration : motion.fadeOut.duration, reduceMotion: ReduceMotion.Never }, done));
      return;
    }
    const at = frame.get();
    const wasOpening = opening.get();
    // Turned around part-way, it picks up the other way where the shape is as tall.
    const from = !started.current ? 0 : wasOpening === open ? at : resumeFrame(open, at, wasOpening);
    started.current = true;
    const end = open ? OPEN_FRAMES : CLOSE_FRAMES;
    opening.set(open);
    frame.set(from);
    frame.set(withTiming(end, { duration: Math.max(0, end - from) * MORPH_FRAME_MS, easing: LINEAR, reduceMotion: ReduceMotion.Never }, done));
  }, [frame, measured, open, opening, reduced]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setBox((current) => current && current.x === x && current.y === y && current.width === width && current.height === height ? current : { x, y, width, height });
  };

  const radius = material === "panel" ? RADIUS.lg : GLASS_MENU_RADIUS;
  const from = { x: anchor.x - (box?.x ?? 0), y: anchor.y - (box?.y ?? 0), width: anchor.width, height: anchor.height };

  const backdropStyle = useAnimatedStyle(() => {
    if (!box) return { opacity: 0 };
    const f = frame.get();
    // Reduce Motion keeps the panel in place and only crossfades it.
    if (reduced) return { opacity: f, left: 0, top: 0, width: box.width, height: box.height, borderRadius: radius };
    const shape = morphShape(opening.get(), f, from, box, radius);
    return { opacity: shape.glass, left: shape.x, top: shape.y, width: shape.width, height: shape.height, borderRadius: shape.corner };
  });

  // The clip follows the glass by transform alone; the rows inside are scaled back out of it and then zoomed
  // and shifted about the menu's centre, so their text never squashes.
  const clipStyle = useAnimatedStyle(() => {
    const f = frame.get();
    if (!box || reduced) return { opacity: box ? f : 0, borderRadius: radius, transform: IDENTITY };
    const shape = morphShape(opening.get(), f, from, box, radius);
    const sx = Math.max(0.01, shape.width / box.width);
    const sy = Math.max(0.01, shape.height / box.height);
    return {
      opacity: shape.rows,
      // Scaled unevenly, the corner turns elliptical; this keeps it inside the glass's corner.
      borderRadius: shape.corner / Math.max(sx, sy),
      transform: [{ translateX: shape.x }, { translateY: shape.y }, { scaleX: sx }, { scaleY: sy }],
    };
  });
  const rowsStyle = useAnimatedStyle(() => {
    const f = frame.get();
    if (!box || reduced) return { transform: IDENTITY };
    const shape = morphShape(opening.get(), f, from, box, radius);
    const sx = Math.max(0.01, shape.width / box.width);
    const sy = Math.max(0.01, shape.height / box.height);
    const cx = box.width / 2;
    const cy = box.height / 2;
    return { transform: [
      { translateX: (cx * (1 - shape.zoom) - shape.x) / sx },
      { translateY: (cy * (1 - shape.zoom) + shape.shift - shape.y) / sy },
      { scaleX: shape.zoom / sx },
      { scaleY: shape.zoom / sy },
    ] };
  });

  // A drag on the rows (`useMenuDrag`) pulls the panel: it leans toward the finger, stretching along the drag when
  // that leads away from the trigger and narrowing across it. Hit-testing keeps the settled layout.
  const stretchStyle = useAnimatedStyle(() => {
    if (!box || reduced) return { transform: IDENTITY };
    const { reach, stretch, squash, shift } = menuScrub;
    const awayX = anchor.x + anchor.width / 2 > box.x + box.width / 2 ? -1 : 1;
    const awayY = anchor.y + anchor.height / 2 > box.y + box.height / 2 ? -1 : 1;
    const dx = dragX.get();
    const dy = dragY.get();
    const pullX = Math.tanh((dx * awayX) / reach);
    const pullY = Math.tanh((dy * awayY) / reach);
    return { transform: [
      { translateX: shift * Math.tanh(dx / reach) },
      { translateY: shift * Math.tanh(dy / reach) },
      { scaleX: 1 + (stretch * pullX - squash * pullY) / box.width },
      { scaleY: 1 + (stretch * pullY - squash * pullX) / box.height },
    ] };
  });

  return <Animated.View {...viewProps} pointerEvents={open ? "auto" : "none"} onLayout={onLayout} style={[{ position: "absolute" }, style, stretchStyle]}>
    {material === "panel" && Platform.OS === "ios"
      ? <Animated.View pointerEvents="none" className="border-border bg-surface shadow-float" style={[styles.backdrop, { borderWidth: StyleSheet.hairlineWidth }, backdropStyle]} />
      : <Animated.View pointerEvents="none" className={glass === "liquid" ? undefined : "shadow-glass"} style={[styles.backdrop, backdropStyle]}>
        <GlassBackground radius={radius} surface="glassMenu" />
      </Animated.View>}
    <Animated.View style={[styles.content, CONTENT_ORIGIN, clipStyle]}>
      <Animated.View style={[styles.rows, CONTENT_ORIGIN, rowsStyle]}>
        <MenuSurfaceContext.Provider value={surface}>{children}</MenuSurfaceContext.Provider>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}

/**
 * The menu as upstream expo-glass-custom-menu's native overlay draws it (`modules/cohub-glass-menu`): the trigger
 * morphs into Liquid Glass that refracts the screen behind it, the panel's rows zoom and blur through the glass,
 * and the glass leans toward a finger on the rows. The native view fills the surface's parent, so the anchor and
 * the panel's `style` share its coordinates; the panel stays a plain view for touches and screen readers.
 */
function GlassMenuSurface({ anchor, open, onClosed, style, material = "glass", anchorRef, plainTrigger = false, children, ...viewProps }: MorphMenuSurfaceProps) {
  const theme = useAppTheme();
  const backdrop = useGlassBackdropTarget();
  const [tags, setTags] = useState<{ source: number | null; backdrop: number | null }>({ source: null, backdrop: null });
  const [plateTag, setPlateTag] = useState<number | null>(null);
  const surface = useMemo<MenuSurface>(() => ({ drag: null, plate: setPlateTag }), []);
  const onClosedRef = useRef(onClosed);
  useLayoutEffect(() => { onClosedRef.current = onClosed; }, [onClosed]);
  // Native resolves views by tag; the refs are filled once their views mount, after this surface's first render.
  useLayoutEffect(() => {
    const next = { source: anchorRef?.current ? findNodeHandle(anchorRef.current) : null, backdrop: backdrop?.current ? findNodeHandle(backdrop.current) : null };
    setTags((current) => current.source === next.source && current.backdrop === next.backdrop ? current : next);
  }, [anchor, anchorRef, backdrop]);
  const ended = useRef(false);
  useEffect(() => {
    beginGlassSession();
    return () => { if (!ended.current) endGlassSession(); };
  }, []);
  const finish = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    endGlassSession();
    onClosedRef.current();
  }, []);
  // Native holds its last frame, the glass run back into the trigger, until React removes the view. Hide that frame
  // first and reveal the trigger only after, or the glass's resting drop shows over the trigger for a few frames.
  const [collapsed, setCollapsed] = useState(false);
  const onStateChange = useCallback((event: { nativeEvent: { state: GlassMenuState } }) => {
    if (event.nativeEvent.state === "closed") setCollapsed(true);
  }, []);
  // Reopened as it arrived (a tap on its row): native starts over from the trigger.
  if (collapsed && open) setCollapsed(false);
  useEffect(() => {
    if (collapsed && !open) finish();
  }, [collapsed, finish, open]);
  // A screen that leaves view (a tab switch, a push) detaches the native glass, which then gets no frames and never
  // reports `closed`: the menu would stay mounted and its session would keep every trigger hidden. Off screen there
  // is no close to watch, so a closing menu ends there.
  const visible = useScreenVisible();
  useEffect(() => {
    if (!open && !visible) finish();
  }, [finish, open, visible]);
  if (!GlassMenuView) return null;
  const radius = material === "panel" ? RADIUS.lg : glassMenu.radius;
  return <GlassMenuView
    style={[StyleSheet.absoluteFill, collapsed ? HIDDEN : null]}
    open={open}
    sourceRect={anchor}
    sourceGlass={!plainTrigger}
    sourceTag={tags.source}
    backdropTag={tags.backdrop}
    backdropColor={theme.colors.background}
    dark={theme.mode === "dark"}
    cornerRadius={radius}
    plateTag={open ? plateTag : null}
    plate={{ inset: menuScrub.plateInset }}
    onStateChange={onStateChange}
  >
    <View {...viewProps} collapsable={false} pointerEvents={open ? "auto" : "none"} style={[{ position: "absolute" }, style]}>
      {/* The glass clips the rows while it morphs; once settled, the panel keeps scrolled rows inside its corners. */}
      <View style={[styles.rows, { borderRadius: radius, overflow: "hidden", borderCurve: "continuous" }]}>
        <MenuSurfaceContext.Provider value={surface}>{children}</MenuSurfaceContext.Provider>
      </View>
    </View>
  </GlassMenuView>;
}

const HIDDEN = { opacity: 0 } as const;

/** How long after the app's navigation mounts the glass warms up, clear of the launch's own work. */
const GLASS_WARMUP_DELAY_MS = 800;
const WARMUP_BOX = { position: "absolute", left: 0, top: 0, width: 96, height: 96 } as const;
const WARMUP_PANEL = { position: "absolute", left: 16, top: 40, width: 64, height: 48 } as const;

/**
 * Runs one small glass morph under the screen soon after launch. The first glass frame compiles the material,
 * lens and shadow shaders and every blur radius (upstream's `warmPipelines`) and runs the shape field before ART
 * has compiled it; upstream pays that when its resting glass triggers first draw, but our triggers are plain, so
 * the first menu opened stalled for over a second. Compiled shaders are cached for the process, Modals included.
 * Mount it first in the root, beneath opaque screens: Android still draws covered views, so nothing shows.
 */
export function GlassMenuWarmup() {
  const theme = useAppTheme();
  const [phase, setPhase] = useState<"waiting" | "open" | "closing" | "done">("waiting");
  useEffect(() => {
    if (!nativeGlassMenu) return;
    const timer = setTimeout(() => setPhase("open"), GLASS_WARMUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!GlassMenuView || phase === "waiting" || phase === "done") return null;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={WARMUP_BOX}>
    <GlassMenuView
      style={StyleSheet.absoluteFill}
      open={phase === "open"}
      sourceRect={{ x: 24, y: 8, width: 48, height: 24 }}
      sourceTag={null}
      backdropTag={null}
      backdropColor={theme.colors.background}
      dark={theme.mode === "dark"}
      cornerRadius={glassMenu.radius}
      plateTag={null}
      onStateChange={(event) => {
        const { state } = event.nativeEvent;
        if (state === "open") setPhase("closing");
        else if (state === "closed") setPhase("done");
      }}
    >
      <View collapsable={false} style={WARMUP_PANEL} />
    </GlassMenuView>
  </View>;
}

/** Upstream's menu corner, which the native glass is tuned to. */
const glassMenu = { radius: 34 } as const;

// A trigger hides while its menu is open; under native glass it shows again only once the glass has run back
// into it, since the glass draws it until then. Menus open one at a time, so one count serves all of them.
let glassSessions = 0;
const glassWaiters = new Set<() => void>();
function beginGlassSession() {
  glassSessions += 1;
}
function endGlassSession() {
  glassSessions = Math.max(0, glassSessions - 1);
  if (glassSessions > 0) return;
  const waiters = [...glassWaiters];
  glassWaiters.clear();
  waiters.forEach((reveal) => reveal());
}

type MenuDrag = { x: SharedValue<number>; y: SharedValue<number> };
/** `drag` pulls the drawn panel; `plate` names the lit row for the native glass, which draws the capsule itself. */
type MenuSurface = { drag: MenuDrag | null; plate: ((tag: number | null) => void) | null };
const MenuSurfaceContext = createContext<MenuSurface>({ drag: null, plate: null });

/** How far a finger has dragged across the menu's rows, which pulls the drawn panel; `null` where nothing does. */
export function useMenuDrag() {
  return useContext(MenuSurfaceContext).drag;
}

/**
 * Lights the menu row under the finger with a capsule. The native glass draws it from the row's view; elsewhere
 * `plate` draws it from the row's frame, and goes first among the rows.
 */
export function useMenuRowHighlight() {
  const { plate: nativePlate } = useContext(MenuSurfaceContext);
  const [frame, setFrame] = useState<MenuRowFrame | null>(null);
  const light = useCallback((row: { view: View | null; frame: MenuRowFrame } | null) => {
    if (nativePlate) nativePlate(row?.view ? findNodeHandle(row.view) : null);
    else setFrame(row?.frame ?? null);
  }, [nativePlate]);
  return { light, plate: nativePlate ? null : <MenuRowPlate row={frame} /> };
}

/** Drives `useMenuDrag` from a touch: following the finger while it moves, springing back once it lets go. */
export function dragMenu(drag: MenuDrag | null, dx: number, dy: number) {
  if (!drag) return;
  const spring = dx === 0 && dy === 0 ? menuScrub.dragRelease : menuScrub.dragFollow;
  drag.x.set(withSpring(dx, spring));
  drag.y.set(withSpring(dy, spring));
}

export type MenuRowFrame = { top: number; height: number };

/**
 * The capsule behind the menu row under the finger. It appears on the first row touched, slides to each row the
 * finger reaches, and fades once the finger lifts. Place it first among the rows, in their coordinates.
 */
export function MenuRowPlate({ row }: { row: MenuRowFrame | null }) {
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const opacity = useSharedValue(0);
  const shown = useRef(false);
  const rowTop = row?.top;
  const rowHeight = row?.height;
  useEffect(() => {
    if (rowTop === undefined || rowHeight === undefined) {
      shown.current = false;
      opacity.set(withSpring(0, menuScrub.plateFade));
      return;
    }
    if (shown.current) {
      top.set(withSpring(rowTop, menuScrub.plateSlide));
      height.set(withSpring(rowHeight, menuScrub.plateSlide));
    } else {
      top.set(rowTop);
      height.set(rowHeight);
      opacity.set(1);
    }
    shown.current = true;
  }, [height, opacity, rowHeight, rowTop, top]);
  const plateStyle = useAnimatedStyle(() => ({ top: top.get(), height: height.get(), borderRadius: height.get() / 2, opacity: opacity.get() }));
  return <Animated.View pointerEvents="none" className="bg-press-overlay" style={[styles.plate, plateStyle]} />;
}

const IDENTITY = [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }];
const CONTENT_ORIGIN = { transformOrigin: "left top" } as const;

const styles = StyleSheet.create({
  backdrop: { position: "absolute", overflow: "hidden", borderCurve: "continuous" },
  content: { flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden", borderCurve: "continuous" },
  rows: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
  plate: { position: "absolute", left: menuScrub.plateInset, right: menuScrub.plateInset, borderCurve: "continuous" },
});

type MenuAnchorProps = ViewProps & { open: boolean; ref?: Ref<View> };

/**
 * Wraps the control a menu grows out of: hidden while its menu is open and, as iOS 27's is, faded back in only
 * once the menu has run back into it.
 */
export function MenuAnchor({ open, style, ref, ...props }: MenuAnchorProps) {
  const reduced = useReducedMotion();
  const shown = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    if (open) { shown.set(0); return; }
    if (glassSessions > 0) {
      const reveal = () => shown.set(1);
      glassWaiters.add(reveal);
      return () => { glassWaiters.delete(reveal); };
    }
    shown.set(withDelay(reduced ? motion.fadeOut.duration : menuMorph.reveal.delay, withTiming(1, { duration: menuMorph.reveal.duration })));
  }, [open, reduced, shown]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return <Animated.View ref={ref} collapsable={false} {...props} style={[style, animatedStyle]} />;
}

type Presence = { open: boolean; onExited: () => void };
const PresenceContext = createContext<Presence>({ open: true, onExited: () => undefined });

/**
 * Keeps a menu mounted after its owner closes it, until the menu has shrunk back into its control.
 * The menu reads the state through `useMenuPresence`; outside a presence it is simply open.
 */
export function MenuPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const value = useMemo(() => ({ open, onExited: () => setMounted(false) }), [open]);
  return mounted ? <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider> : null;
}

export function useMenuPresence() {
  return useContext(PresenceContext);
}
