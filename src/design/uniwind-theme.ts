import { useEffect } from "react";
import { Uniwind } from "uniwind";
import { COLOR_CSS_NAMES, TEXT_RAMP, type ColorKey } from "@/src/design/tokens";
import { FONT_SCALE_VALUES, getAppThemeColors, scaleTextMetric, useCustomThemeState, useFontScalePreference, usePureBlackPreference, useThemePreference } from "@/src/theme";

/**
 * Keeps className styling in step with the same preferences `useAppTheme` reads: theme mode,
 * pure black, the Config theme, and font scale. Both modes are always written so a system
 * appearance change needs no round trip through JS.
 */
export function useUniwindThemeSync() {
  const preference = useThemePreference();
  const pureBlack = usePureBlackPreference();
  const custom = useCustomThemeState();
  const fontScale = FONT_SCALE_VALUES[useFontScalePreference()];

  useEffect(() => {
    Uniwind.setTheme(preference);
  }, [preference]);

  useEffect(() => {
    const text = Object.fromEntries(Object.entries(TEXT_RAMP).flatMap(([name, { size, lineHeight }]) => [
      [`--text-${name}`, scaleTextMetric(size, fontScale, "size")],
      [`--text-${name}--line-height`, scaleTextMetric(lineHeight, fontScale, "lineHeight")],
    ]));
    for (const mode of ["light", "dark"] as const) {
      const colors = getAppThemeColors(mode, pureBlack);
      const vars = Object.fromEntries((Object.keys(COLOR_CSS_NAMES) as ColorKey[]).map((key) => [`--color-${COLOR_CSS_NAMES[key]}`, colors[key]]));
      Uniwind.updateCSSVariables(mode, { ...vars, ...text });
    }
    // `custom` is read through getAppThemeColors; depending on it re-applies a new Config palette.
  }, [custom, fontScale, pureBlack]);
}
