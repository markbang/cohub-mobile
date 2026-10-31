import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { BRAND, MASCOT_PATHS as PATHS } from "@/src/design/brand";

export type MascotMood = "idle" | "worried";

const BLINK_MS = 130;
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

function Face({ mood, closed }: { mood: MascotMood; closed: boolean }) {
  return <>
    <Path d={PATHS.outline} fill={BRAND.ink} />
    <Path d={PATHS.face} fill={BRAND.face} />
    <Path d={PATHS.cheek} fill={BRAND.ink} />
    {closed
      ? <Path d={PATHS.closedEyes} {...STROKE} />
      : mood === "worried"
        ? <><Path d={PATHS.worriedEyes} fill={BRAND.ink} /><Path d={PATHS.worriedBrows} {...STROKE} strokeWidth={18} /></>
        : <><Path d={PATHS.leftEye} fill={BRAND.ink} /><Path d={PATHS.rightEye} fill={BRAND.ink} /></>}
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
