import { Platform, Switch, type SwitchProps } from "react-native";
import { useAppTheme } from "@/src/theme";

/** iOS keeps the system thumb and takes only the accent track; Android's control has no such defaults. */
export function AppSwitch(props: Omit<SwitchProps, "trackColor" | "thumbColor">) {
  const { colors } = useAppTheme();
  const palette = Platform.OS === "ios"
    ? { trackColor: { true: colors.accent } }
    : { trackColor: { false: colors.borderStrong, true: colors.accent }, thumbColor: colors.surface };
  return <Switch {...palette} {...props} />;
}
