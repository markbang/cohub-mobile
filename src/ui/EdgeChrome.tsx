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
 * iOS 27's navigation bar once content scrolls under it, as captured on its tab roots: a material a little
 * lighter than the page covers the status bar and the bar, letting only a heavy blur of the content through,
 * and fades out over `BAR_EDGE_TAIL` pt below the bar. Dimezis draws a 15% grain over its blur, which iOS
 * does not; the material over it hides that, so the blur stops where the material is still full.
 */
const BAR_EDGE_TAIL = 10;
const BAR_EDGE_SIGMA = 10;
const BAR_EDGE_OPACITY = 0.9;

function SoftEdge({ target }: { target: RefObject<View | null> }) {
  const { colors } = useAppTheme();
  const material = colorWithOpacity(colors.barMaterial, BAR_EDGE_OPACITY);
  return <>
    <BlurView
      blurTarget={target}
      blurMethod="dimezisBlurViewSdk31Plus"
      intensity={1}
      blurReductionFactor={blurReduction(BAR_EDGE_SIGMA)}
      style={[StyleSheet.absoluteFill, { bottom: BAR_EDGE_TAIL }]}
    />
    <View style={[StyleSheet.absoluteFill, { bottom: BAR_EDGE_TAIL, backgroundColor: material }]} />
    <LinearGradient
      pointerEvents="none"
      colors={[material, colorWithOpacity(colors.barMaterial, 0)]}
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: BAR_EDGE_TAIL }}
    />
  </>;
}

/**
 * With `scrollY`, the edge shows only once content has scrolled under the header (over `edgeRange`), so
 * nothing is veiled at rest; without it the edge is always on, for screens whose content starts beneath it.
 * With `blurTarget` (the content inside `EdgeBlurTarget`), Android draws iOS's blurred bar material; elsewhere,
 * and under Reduce Transparency, content stays solid-veiled under the whole bar and a strip below it fades.
 */
export function EdgeHeader({ children, onLayout, scrollY, blurTarget, edgeRange = DEFAULT_EDGE_RANGE }: {
  children: ReactNode;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollY?: SharedValue<number>;
  blurTarget?: RefObject<View | null>;
  edgeRange?: readonly [number, number];
}) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceTransparency();
  const soft = androidBlur && !reduce && blurTarget;
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrollY ? interpolate(scrollY.get(), edgeRange, [0, 1], "clamp") : 1 }));
  return <View pointerEvents="box-none" onLayout={onLayout} className="absolute left-0 right-0 top-0 z-1" style={{ paddingTop: insets.top }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: -(soft ? BAR_EDGE_TAIL : edgeChrome.topFade) }, scrimStyle]}>
      {soft
        ? <SoftEdge target={blurTarget} />
        : Platform.OS === "android"
          ? <><View className="flex-1 bg-background" /><View style={TOP_FADE_STRIP}><EdgeScrim edge="top" /></View></>
          : <EdgeScrim edge="top" solid={insets.top} />}
    </Animated.View>
    {children}
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
