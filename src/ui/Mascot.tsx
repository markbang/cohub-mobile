import { useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, { useReducedMotion, type CSSAnimationKeyframes } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { BRAND, MASCOT_PATHS as PATHS } from "@/src/design/brand";
import { loops } from "@/src/motion";

export type MascotMood = "idle" | "worried";

const VIEW_BOX = "160 147 716 716";
const VIEW_BOX_SIZE = 716;
// Glances while it works: up and to each side, the way someone thinks, in the icon's 1024 grid.
const GLANCES = [{ x: -16, y: -12 }, { x: 16, y: -12 }, { x: 0, y: 0 }] as const;
const STROKE = { fill: "none", stroke: BRAND.ink, strokeLinecap: "round", strokeWidth: 24 } as const;
/** Lids close and open over this long at each end of a blink, so it reads as a blink rather than a cut. */
const LID_MS = 20;

function FaceBase() {
  return <>
    <Path d={PATHS.outline} fill={BRAND.ink} />
    <Path d={PATHS.face} fill={BRAND.face} />
    <Path d={PATHS.cheek} fill={BRAND.ink} />
  </>;
}

function OpenEyes({ mood }: { mood: MascotMood }) {
  return mood === "worried"
    ? <><Path d={PATHS.worriedEyes} fill={BRAND.ink} /><Path d={PATHS.worriedBrows} {...STROKE} strokeWidth={18} /></>
    : <><Path d={PATHS.leftEye} fill={BRAND.ink} /><Path d={PATHS.rightEye} fill={BRAND.ink} /></>;
}

const BLINK_CYCLE_MS = loops.blinkGaps.reduce((total, gap) => total + gap + loops.blink.duration, 0);
const percent = (ms: number, cycle: number) => `${(ms / cycle * 100).toFixed(3)}%` as const;

/** One loop of uneven blinks; `shut` is the closed-eyes layer's opacity, the open layer runs the inverse. */
function blinkKeyframes(shut: boolean): CSSAnimationKeyframes {
  const cycle = BLINK_CYCLE_MS;
  const open = { opacity: shut ? 0 : 1 };
  const closed = { opacity: shut ? 1 : 0 };
  const frames: CSSAnimationKeyframes = { "0%": open };
  let at = 0;
  for (const gap of loops.blinkGaps) {
    at += gap;
    frames[percent(at, cycle)] = open;
    frames[percent(at + LID_MS, cycle)] = closed;
    frames[percent(at + loops.blink.duration - LID_MS, cycle)] = closed;
    at += loops.blink.duration;
    frames[percent(at, cycle)] = open;
  }
  return frames;
}

const OPEN_EYES_BLINK = blinkKeyframes(false);
const CLOSED_EYES_BLINK = blinkKeyframes(true);
const blinkStyle = (keyframes: CSSAnimationKeyframes) => ({ animationName: keyframes, animationDuration: BLINK_CYCLE_MS, animationIterationCount: "infinite", animationTimingFunction: "linear" }) as const;

/** Holds each glance, then darts to the next; offsets scale from the icon grid to the drawn size. */
function glanceKeyframes(size: number): CSSAnimationKeyframes {
  const scale = size / VIEW_BOX_SIZE;
  const hold = loops.glanceHold.duration;
  const cycle = hold * GLANCES.length;
  const look = (index: number) => {
    const glance = GLANCES[index % GLANCES.length]!;
    return { transform: [{ translateX: glance.x * scale }, { translateY: glance.y * scale }] };
  };
  const frames: CSSAnimationKeyframes = { "0%": look(0) };
  GLANCES.forEach((_glance, index) => {
    frames[percent(hold * (index + 1) - loops.glanceMove.duration, cycle)] = look(index);
    frames[percent(hold * (index + 1), cycle)] = look(index + 1);
  });
  return frames;
}

/**
 * The face as stacked layers so blinking and glancing run as UI-thread CSS animations: they keep going
 * while JS is busy streaming a reply, and the SVG is never re-rendered for them.
 */
function LivingFace({ size, mood, blink, glance }: { size: number; mood: MascotMood; blink: boolean; glance: boolean }) {
  const glanceStyle = useMemo(() => glance ? { animationName: glanceKeyframes(size), animationDuration: loops.glanceHold.duration * GLANCES.length, animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" } as const : null, [glance, size]);
  const layer = (children: ReactNode) => <Svg width={size} height={size} viewBox={VIEW_BOX}>{children}</Svg>;
  return <View style={{ width: size, height: size }}>
    {layer(<FaceBase />)}
    <Reanimated.View style={[StyleSheet.absoluteFill, blink ? blinkStyle(OPEN_EYES_BLINK) : null]}>
      <Reanimated.View style={glanceStyle}>{layer(<OpenEyes mood={mood} />)}</Reanimated.View>
    </Reanimated.View>
    {blink ? <Reanimated.View style={[StyleSheet.absoluteFill, { opacity: 0 }, blinkStyle(CLOSED_EYES_BLINK)]}>{layer(<Path d={PATHS.closedEyes} {...STROKE} />)}</Reanimated.View> : null}
  </View>;
}

function Face({ mood }: { mood: MascotMood }) {
  return <><FaceBase /><OpenEyes mood={mood} /></>;
}

/** The icon's character without its tile, for brand moments and empty states. Decorative: the words around it carry the meaning. */
export function Mascot({ size, mood = "idle", blink = false }: { size: number; mood?: MascotMood; blink?: boolean }) {
  const reduced = useReducedMotion();
  if (blink && !reduced) return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><LivingFace size={size} mood={mood} blink glance={false} /></View>;
  return <Svg width={size} height={size} viewBox={VIEW_BOX} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Face mood={mood} />
  </Svg>;
}

/**
 * The busy state of a region whose content is the screen's point (a list, a document, a reply not yet
 * started): the mascot bobs and glances around. Small inline work (a button, a row, a list edge) keeps
 * `Loader`, the platform spinner. Reduce Motion keeps it still with a slow blink.
 */
export function MascotLoader({ size, accessibilityLabel }: { size: number; accessibilityLabel: string }) {
  const reduced = useReducedMotion();
  const lift = Math.max(2, Math.round(size * 0.07));
  const bob = { "0%": { transform: [{ translateY: 0 }] }, "50%": { transform: [{ translateY: -lift }] }, "100%": { transform: [{ translateY: 0 }] } };
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size + lift }}>
    <Reanimated.View style={{ paddingTop: lift, ...(reduced ? null : { animationName: bob, animationDuration: 900, animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }) }}>
      <LivingFace size={size} mood="idle" blink glance={!reduced} />
    </Reanimated.View>
  </View>;
}

/** The app icon itself, wherever Cohub is named as a product or a harness. */
export function CohubLogo({ size = 36 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 1024 1024">
    <Defs>
      <LinearGradient id="cohub-tile" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={BRAND.gradient[0]} />
        <Stop offset="0.5" stopColor={BRAND.gradient[1]} />
        <Stop offset="1" stopColor={BRAND.gradient[2]} />
      </LinearGradient>
    </Defs>
    <Rect width={1024} height={1024} rx={229} fill="url(#cohub-tile)" />
    <Face mood="idle" />
  </Svg>;
}
