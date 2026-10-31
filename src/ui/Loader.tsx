import { ActivityIndicator, Platform, Text, View } from "react-native";
import Reanimated, { steps, useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "@/src/i18n";
import { useAppTheme } from "@/src/theme";
import { MascotLoader } from "@/src/ui/Mascot";

/** UIActivityIndicatorView's two sizes: small for 16–20 pt slots (buttons, rows, list edges), large for a region's only content. */
const SIZES = { sm: 20, md: 37 } as const;
const SPOKES = 8;
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };

/** The busy indicator: the system spinner on iOS, and the same spoked spinner drawn on Android. */
export function Loader({ size = "sm", color, accessibilityLabel }: { size?: keyof typeof SIZES; color?: string; accessibilityLabel?: string }) {
  const theme = useAppTheme();
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const label = accessibilityLabel ?? t("common.loading");
  const box = SIZES[size];
  if (Platform.OS === "ios") return <ActivityIndicator size={size === "md" ? "large" : "small"} color={color} accessibilityLabel={label} style={{ width: box, height: box }} />;
  const spoke = { width: box * 0.09, height: box * 0.28 };
  return (
    <Reanimated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      // The spokes tick a step at a time, as UIKit's do; Reduce Motion holds them still.
      style={{ width: box, height: box, ...(reduced ? null : { animationName: SPIN, animationDuration: 800, animationIterationCount: "infinite", animationTimingFunction: steps(SPOKES) }) }}
    >
      {Array.from({ length: SPOKES }, (_, index) => <View key={index} className="absolute inset-0 items-center" style={{ transform: [{ rotate: `${index * (360 / SPOKES)}deg` }] }}>
        <View className="rounded-full" style={{ ...spoke, backgroundColor: color ?? theme.colors.textMuted, opacity: 1 - (index / SPOKES) * 0.8 }} />
      </View>)}
    </Reanimated.View>
  );
}

/** A region with nothing to show yet: the loader centered in the space the content will fill. */
export function LoadingState({ label, fill = true }: { label?: string; fill?: boolean }) {
  const { t } = useTranslation();
  return (
    <View className={`items-center justify-center p-6 ${fill ? "flex-1 min-h-45" : ""}`}>
      <MascotLoader size={72} accessibilityLabel={label ?? t("common.loading")} />
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
