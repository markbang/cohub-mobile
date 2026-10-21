import type { ReactElement } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";
import { useAppTheme } from "@/src/theme";

/** The pull-to-refresh indicator everywhere; the platform default differs between lists and scroll views. */
export function AppRefreshControl({
  refreshing,
  onRefresh,
  progressViewOffset,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  progressViewOffset?: number;
}) {
  const theme = useAppTheme();
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      progressViewOffset={progressViewOffset}
      tintColor={theme.colors.accent}
      colors={[theme.colors.accent]}
    />
  );
}

/** LegendList's types omit `refreshControl` even though it hands the element to its ScrollView. */
export function listRefreshProps(options: { refreshing: boolean; onRefresh: () => void; progressViewOffset?: number }): { refreshControl: ReactElement<RefreshControlProps> } {
  return { refreshControl: <AppRefreshControl {...options} /> };
}
