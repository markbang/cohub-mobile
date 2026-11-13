import { BlurTargetView, BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { interpolate, useAnimatedRef, useAnimatedStyle, useScrollOffset, useSharedValue, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collapsedComposerHeight } from "@/src/ui/composer-layout";
import { colorWithOpacity, edgeChrome, useAppTheme } from "@/src/theme";
import { androidBlur, blurReduction, GlassBackdropScope, useReduceTransparency } from "@/src/ui/Glass";

/**
 * With `trackScroll`, the scroll view given `scrollRef` drives `scrollY` on the UI thread, so the header's
 * veil and collapsing title follow the finger frame by frame, as UIKit's bar does, even while JS is busy.
 */
export function useEdgeChrome(options?: { reserveComposer?: boolean; trackScroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const [headerHeight, setHeaderHeight] = useState(insets.top + edgeChrome.headerMinHeight);
  const [footerHeight, setFooterHeight] = useState(() => options?.reserveComposer ? collapsedComposerHeight(insets.bottom) : 0);
  const scrollY = useSharedValue(0);
  const scrollRef = useAnimatedRef<ScrollView>();
  const { blurTarget, attachBlurTarget } = useBlurTarget();
  useScrollOffset(options?.trackScroll ? scrollRef : null, scrollY);
  return {
    headerHeight,
    footerHeight,
    scrollY,
    scrollRef,
    blurTarget,
    attachBlurTarget,
    onHeaderLayout: (event: LayoutChangeEvent) => setHeaderHeight(event.nativeEvent.layout.height),
    onFooterLayout: (event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height),
  };
}

/** The ref for an `EdgeBlurTarget`; expo-blur resolves its target when it mounts, so glass gets it only once attached. */
export function useBlurTarget() {
  const blurTarget = useRef<View | null>(null);
  const [attached, setAttached] = useState(false);
  const attachBlurTarget = useCallback((node: View | null) => {
    blurTarget.current = node;
    setAttached(node !== null);
  }, []);
  return { blurTarget: attached ? blurTarget : undefined, attachBlurTarget };
}

// Opacity eases out with a flat start and end, so neither end of the fade reads as a line across
// the content. The top fades right below the opaque status bar, leaving content faintly visible
// behind the header's glass like iOS 26's soft scroll edge; the bottom holds briefly behind
// floating controls first.
const SCRIM_STEPS = 10;
function scrimCurve(hold: number) {
  return [...(hold > 0 ? [{ at: 0, alpha: 1 }] : []), ...Array.from({ length: SCRIM_STEPS + 1 }, (_, step) => {
    const t = step / SCRIM_STEPS;
    return { at: hold + (1 - hold) * t, alpha: 1 - t * t * (3 - 2 * t) };
  })];
}
const SCRIM_CURVES = { top: scrimCurve(0), bottom: scrimCurve(0.2) };

/** `solid` keeps the first points fully opaque, e.g. the status bar, before the fade begins. */
export function EdgeScrim({ edge, solid = 0, style }: { edge: "top" | "bottom"; solid?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  const curve = SCRIM_CURVES[edge];
  return <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, style]}>
    {solid > 0 ? <View style={{ height: solid, backgroundColor: colors.background }} /> : null}
    <LinearGradient
      pointerEvents="none"
      colors={curve.map(({ alpha }) => colorWithOpacity(colors.background, alpha)) as unknown as readonly [string, string, ...string[]]}
      locations={curve.map(({ at }) => at) as unknown as readonly [number, number, ...number[]]}
      start={{ x: 0, y: edge === "top" ? 0 : 1 }}
      end={{ x: 0, y: edge === "top" ? 1 : 0 }}
      style={{ flex: 1 }}
    />
  </View>;
}

/**
 * The content an `EdgeHeader` given `blurTarget`, and the screen's floating glass (`Screen`'s `blurTarget`), blur:
 * on Android 12+, a blur target of its own, opaque.
 */
export function EdgeBlurTarget({ attach, children }: { attach: (node: View | null) => void; children: ReactNode }) {
  if (!androidBlur) return children;
  return <BlurTargetView ref={attach} style={BLUR_TARGET_STYLE}><View className="flex-1 bg-background"><GlassBackdropScope inside>{children}</GlassBackdropScope></View></BlurTargetView>;
}

/**
 * The whole screen, chrome included, for glass in a Modal over that chrome (`GlassBackdrop`): a composer menu then
 * blurs the composer under it, as iOS's does. Chrome inside keeps blurring its `EdgeBlurTarget`.
 */
export function ScreenBlurTarget({ attach, children }: { attach: (node: View | null) => void; children: ReactNode }) {
  if (!androidBlur) return children;
  return <BlurTargetView ref={attach} style={BLUR_TARGET_STYLE}><View className="flex-1 bg-background">{children}</View></BlurTargetView>;
}

/**
 * iOS 26's soft scroll edge, fitted on its tab roots in both themes: content under the status bar and the
 * bar fades about 80% into the background behind a light blur, and comes back into focus from the bar's
 * lower edge to 36 pt below it. Each blur layer reaches from the top to `bottom` (pt from the bar's bottom
 * edge); later layers blur more and cover less, so the radius steps down the edge. Dimezis blurs the whole
 * target before cropping it to a layer, so the layers meet without seams.
 *
 * Dimezis draws a 15% grain over each layer, which iOS does not; the blur therefore ends 8 pt below the bar,
 * where the veil still mutes it, and the veil alone finishes the tail.
 */
const SOFT_EDGE_TAIL = 36;
const SOFT_EDGE_LAYERS = [
  { bottom: 8, sigma: 0.6 },
  { bottom: -4, sigma: 1 },
  { bottom: -14, sigma: 1.5 },
  { bottom: -26, sigma: 2 },
] as const;
// Veil opacity down the edge, from 21 pt above the bar's bottom edge to the end of the tail.
const SOFT_EDGE_VEIL_TOP = 21;
const SOFT_EDGE_VEIL = [
  { at: -21, alpha: 0.8 },
  { at: -9, alpha: 0.5 },
  { at: 0, alpha: 0.45 },
  { at: 21, alpha: 0.12 },
  { at: SOFT_EDGE_TAIL, alpha: 0 },
] as const;

function SoftEdge({ target }: { target: RefObject<View | null> }) {
  const { colors } = useAppTheme();
  const span = SOFT_EDGE_VEIL_TOP + SOFT_EDGE_TAIL;
  return <>
    {SOFT_EDGE_LAYERS.map(({ bottom, sigma }) => <BlurView
      key={bottom}
      blurTarget={target}
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={1}
      blurReductionFactor={blurReduction(sigma)}
      style={[StyleSheet.absoluteFill, { bottom: SOFT_EDGE_TAIL - bottom }]}
    />)}
    <View style={[StyleSheet.absoluteFill, { bottom: span, backgroundColor: colorWithOpacity(colors.background, SOFT_EDGE_VEIL[0].alpha) }]} />
    <LinearGradient
      pointerEvents="none"
      colors={SOFT_EDGE_VEIL.map(({ alpha }) => colorWithOpacity(colors.background, alpha)) as unknown as readonly [string, string, ...string[]]}
      locations={SOFT_EDGE_VEIL.map(({ at }) => (at + SOFT_EDGE_VEIL_TOP) / span) as unknown as readonly [number, number, ...number[]]}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: span }}
    />
  </>;
}

/**
 * With `scrollY`, the edge shows only once content has scrolled under the header (over `edgeRange`), so
 * nothing is veiled at rest; without it the edge is always on, for screens whose content starts beneath it.
 * With `blurTarget` (the content inside `EdgeBlurTarget`), Android draws iOS's soft blurred edge; elsewhere,
 * and under Reduce Transparency, content stays solid-veiled under the whole bar and a strip below it fades.
 */
export function EdgeHeader({ children, onLayout, scrollY, blurTarget, edgeRange = DEFAULT_EDGE_RANGE, hidden }: {
  children: ReactNode;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollY?: SharedValue<number>;
  blurTarget?: RefObject<View | null>;
  edgeRange?: readonly [number, number];
  /** Fades the header out by `progress` and stops its touches while `active`, as an active search takes the bar. */
  hidden?: { progress: SharedValue<number>; active: boolean };
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceTransparency();
  const soft = androidBlur && !reduce && blurTarget;
  const hiding = hidden?.progress;
  const scrimStyle = useAnimatedStyle(() => ({ opacity: (scrollY ? interpolate(scrollY.get(), edgeRange, [0, 1], "clamp") : 1) * (1 - (hiding ? hiding.get() : 0)) }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: 1 - (hiding ? hiding.get() : 0) }));
  return <View pointerEvents={hidden?.active ? "none" : "box-none"} onLayout={onLayout} className="absolute left-0 right-0 top-0 z-1" style={{ paddingTop: insets.top }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: -(soft ? SOFT_EDGE_TAIL : edgeChrome.topFade) }, scrimStyle]}>
      {soft
        ? <SoftEdge target={blurTarget} />
        // The browser has no status bar to hold opaque and no blur behind the bar, so rows passing under it must be hidden as on Android.
        : Platform.OS !== "ios"
          ? <><View className="flex-1 bg-background" /><View style={TOP_FADE_STRIP}><EdgeScrim edge="top" /></View></>
          : <EdgeScrim edge="top" solid={insets.top} />}
    </Animated.View>
    {hidden ? <Animated.View pointerEvents="box-none" accessibilityElementsHidden={hidden.active} importantForAccessibility={hidden.active ? "no-hide-descendants" : "auto"} style={contentStyle}>{children}</Animated.View> : children}
  </View>;
}

const DEFAULT_EDGE_RANGE = [0, edgeChrome.topFade] as const;

/** Android's keyboard height includes the navigation bar, which edge-to-edge chrome already pads for. */
export function useKeyboardCoveredInset() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? insets.bottom : 0;
}

/**
 * With `keyboard`, the footer rides the keyboard instead of the screen resizing: a shrinking viewport
 * slides the tail under the composer until it settles. Pair it with `KeyboardAwareLegendList`.
 */
export function EdgeFooter({ children, onLayout, keyboard = false }: { children: ReactNode; onLayout: (event: LayoutChangeEvent) => void; keyboard?: boolean }) {
  const covered = useKeyboardCoveredInset();
  const content = <>
    <EdgeScrim edge="bottom" style={{ top: -edgeChrome.fade }} />
    {children}
  </>;
  if (keyboard) return <KeyboardStickyView pointerEvents="box-none" onLayout={onLayout} offset={{ opened: covered }} style={FOOTER_STYLE}>{content}</KeyboardStickyView>;
  return <View pointerEvents="box-none" onLayout={onLayout} style={FOOTER_STYLE}>{content}</View>;
}

/**
 * A layer that sits just above a keyboard `EdgeFooter` and rides the keyboard with it. Anything that has to
 * scroll goes here rather than hanging past the footer's top edge: native touches never reach a child drawn
 * outside its parent's bounds, so a list there would let the drag fall through to the timeline beneath.
 */
export function EdgeFooterOverlay({ footerHeight, children }: { footerHeight: number; children: ReactNode }) {
  const covered = useKeyboardCoveredInset();
  return <KeyboardStickyView pointerEvents="box-none" offset={{ opened: covered }} style={[OVERLAY_STYLE, { bottom: footerHeight }]}>{children}</KeyboardStickyView>;
}

/** Pads by the same lift as a keyboard `EdgeFooter`. */
export function KeyboardLiftPadding({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const covered = useKeyboardCoveredInset();
  const { height, progress } = useReanimatedKeyboardAnimation();
  const liftStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -height.get() - progress.get() * covered) }), [covered]);
  return <Animated.View pointerEvents="none" style={[style, liftStyle]}>{children}</Animated.View>;
}

const FOOTER_STYLE: ViewStyle = { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 1 };
const TOP_FADE_STRIP: ViewStyle = { height: edgeChrome.topFade };
const BLUR_TARGET_STYLE: ViewStyle = { flex: 1 };
const OVERLAY_STYLE: ViewStyle = { position: "absolute", left: 0, right: 0, zIndex: 2 };
