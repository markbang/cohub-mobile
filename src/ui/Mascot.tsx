import { useEffect, useState } from "react";
import { View } from "react-native";
import Reanimated, { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { BRAND, MASCOT_PATHS as PATHS } from "@/src/design/brand";

export type MascotMood = "idle" | "worried";

const BLINK_MS = 130;

type Look = { x: number; y: number };
const NO_LOOK: Look = { x: 0, y: 0 };
// Glances while it works: up and to each side, the way someone thinks, in the icon's 1024 grid.
const GLANCES: readonly Look[] = [{ x: -16, y: -12 }, { x: 16, y: -12 }, NO_LOOK];
const GLANCE_MS = 800;
const STROKE = { fill: "none", stroke: BRAND.ink, strokeLinecap: "round", strokeWidth: 24 } as const;

function useBlink(enabled: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setClosed(true);
        timer = setTimeout(() => { setClosed(false); schedule(); }, BLINK_MS);
      }, 2600 + Math.random() * 3000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled]);
  return closed;
}

function Face({ mood, closed, look = NO_LOOK }: { mood: MascotMood; closed: boolean; look?: Look }) {
  return <>
    <Path d={PATHS.outline} fill={BRAND.ink} />
    <Path d={PATHS.face} fill={BRAND.face} />
    <Path d={PATHS.cheek} fill={BRAND.ink} />
    {closed
      ? <Path d={PATHS.closedEyes} {...STROKE} />
      : mood === "worried"
        ? <><Path d={PATHS.worriedEyes} fill={BRAND.ink} /><Path d={PATHS.worriedBrows} {...STROKE} strokeWidth={18} /></>
        : <G transform={`translate(${look.x} ${look.y})`}><Path d={PATHS.leftEye} fill={BRAND.ink} /><Path d={PATHS.rightEye} fill={BRAND.ink} /></G>}
  </>;
}

/** The icon's character without its tile, for brand moments and empty states. Decorative: the words around it carry the meaning. */
export function Mascot({ size, mood = "idle", blink = false }: { size: number; mood?: MascotMood; blink?: boolean }) {
  const reduced = useReducedMotion();
  const closed = useBlink(blink && !reduced);
  return <Svg width={size} height={size} viewBox="160 147 716 716" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Face mood={mood} closed={closed} />
  </Svg>;
}

function useGlance(enabled: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % GLANCES.length), GLANCE_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return enabled ? GLANCES[index]! : NO_LOOK;
}

/**
 * The busy state of a region whose content is the screen's point (a list, a document, a reply not yet
 * started): the mascot bobs and glances around. Small inline work (a button, a row, a list edge) keeps
 * `Loader`, the platform spinner. Reduce Motion keeps it still with a slow blink.
 */
export function MascotLoader({ size, accessibilityLabel }: { size: number; accessibilityLabel: string }) {
  const reduced = useReducedMotion();
  const closed = useBlink(true);
  const look = useGlance(!reduced);
  const lift = Math.max(2, Math.round(size * 0.07));
  const bob = { "0%": { transform: [{ translateY: 0 }] }, "50%": { transform: [{ translateY: -lift }] }, "100%": { transform: [{ translateY: 0 }] } };
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size + lift }}>
    <Reanimated.View style={{ paddingTop: lift, ...(reduced ? null : { animationName: bob, animationDuration: 900, animationIterationCount: "infinite", animationTimingFunction: "ease-in-out" }) }}>
      <Svg width={size} height={size} viewBox="160 147 716 716"><Face mood="idle" closed={closed} look={look} /></Svg>
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
    <Face mood="idle" closed={false} />
  </Svg>;
}
