import { Text, View } from "react-native";
import Reanimated, { useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { MASCOT_PATHS } from "@/src/design/brand";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { MascotLoader } from "@/src/ui/Mascot";

const SIZES = { sm: 20, md: 72 } as const;
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };
const PULSE = { "0%": { opacity: 0.35 }, "50%": { opacity: 1 }, "100%": { opacity: 0.35 } };

/**
 * The app's busy indicator, from the icon on both platforms. Small slots (buttons, rows, list edges) spin the
 * cheek's round "c", already an open arc and still legible at 16 pt; `md` is the mascot itself. `color`
 * follows the surface it sits on, such as the label of an accent button. Reduce Motion pulses instead.
 */
export function Loader({ size = "sm", color, accessibilityLabel }: { size?: keyof typeof SIZES; color?: string; accessibilityLabel?: string }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const label = accessibilityLabel ?? t("common.loading");
  if (size === "md") return <MascotLoader size={SIZES.md} accessibilityLabel={label} />;
  const box = SIZES.sm;
  return (
    <Reanimated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ width: box, height: box, animationName: reduced ? PULSE : SPIN, animationDuration: reduced ? 1200 : 900, animationIterationCount: "infinite", animationTimingFunction: reduced ? "ease-in-out" : "linear" }}
    >
      {/* The viewBox is a square centred on the "c", so the spin turns it in place. */}
      <Svg width={box} height={box} viewBox="626 567 117 117"><Path d={MASCOT_PATHS.cheek} fill={color ?? theme.colors.accent} /></Svg>
    </Reanimated.View>
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
