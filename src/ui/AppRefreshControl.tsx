import type { ReactElement } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";
import { useAppTheme } from "@/src/theme";

/**
 * The pull-to-refresh indicator everywhere; the platform default differs between lists and scroll views.
 * Android's ScrollView clones this element with the list as children, so they must reach RefreshControl.
 */
export function AppRefreshControl({ tintColor, colors, brand = false, progressViewOffset, ...props }: RefreshControlProps & { brand?: boolean }) {
  const theme = useAppTheme();
  // A branded refresh (`useBrandRefresh`) draws its own indicator: iOS's spinner goes clear, and Android's
  // circle is parked far above the view; the pull distance that triggers a refresh does not change.
  if (brand) return <RefreshControl {...props} tintColor="transparent" colors={["transparent"]} progressViewOffset={HIDDEN_OFFSET} />;
  return <RefreshControl {...props} progressViewOffset={progressViewOffset} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />;
}

const HIDDEN_OFFSET = -10000;

/** LegendList's types omit `refreshControl` even though it hands the element to its ScrollView. */
export function listRefreshProps(options: { refreshing: boolean; onRefresh: () => void; progressViewOffset?: number }): { refreshControl: ReactElement<RefreshControlProps> } {
  return { refreshControl: <AppRefreshControl {...options} /> };
}
