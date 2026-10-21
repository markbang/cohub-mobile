import { Text, View } from "react-native";
import Reanimated, { useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";

const SIZES = {
  /** Fits a 16–20pt icon slot: buttons, rows, list edges. */
  sm: { dot: 5, gap: 3, height: 16 },
  /** A region's only content while it loads. */
  md: { dot: 7, gap: 4, height: 24 },
} as const;

const CYCLE_MS = 1050;
const STAGGER_MS = 150;
const REST = { opacity: 0.3, transform: [{ scale: 0.7 }] };
const PEAK = { opacity: 1, transform: [{ scale: 1 }] };
// Each dot swells in turn; the rest of the cycle is a pause so the wave reads as a beat, not a blur.
const WAVE = { "0%": REST, "28%": PEAK, "56%": REST, "100%": REST };
// Reduced motion keeps the opacity beat that says "still working" and drops the scaling.
const WAVE_REDUCED = { "0%": { opacity: 0.3 }, "28%": { opacity: 1 }, "56%": { opacity: 0.3 }, "100%": { opacity: 0.3 } };

/** The app's only busy indicator. Replaces the platform spinner everywhere outside pull-to-refresh. */
export function Loader({ size = "sm", color, accessibilityLabel }: { size?: keyof typeof SIZES; color?: string; accessibilityLabel?: string }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const { dot, gap, height } = SIZES[size];
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel ?? t("common.loading")} className="flex-row items-center" style={{ gap, height }}>
      {[0, 1, 2].map((index) => (
        <Reanimated.View
          key={index}
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: color ?? theme.colors.accent,
            ...(reduced ? { opacity: 0.3 } : REST),
            animationName: reduced ? WAVE_REDUCED : WAVE,
            animationDuration: CYCLE_MS,
            animationDelay: index * STAGGER_MS,
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
            animationFillMode: "backwards",
          }}
        />
      ))}
    </View>
  );
}

/** A region with nothing to show yet: the loader centered in the space the content will fill. */
export function LoadingState({ label, fill = true }: { label?: string; fill?: boolean }) {
  return (
    <View className={`items-center justify-center p-6 ${fill ? "flex-1 min-h-45" : ""}`}>
      <Loader size="md" accessibilityLabel={label} />
      {label ? <Text className="text-caption text-fg-muted mt-3">{label}</Text> : null}
    </View>
  );
}

/** Content is on screen and more is arriving at this edge of the list (next page, search results). */
export function ListEdgeLoader({ label }: { label?: string }) {
  return (
    <View className="h-8 items-center justify-center">
      <Loader accessibilityLabel={label} />
    </View>
  );
}
