import { Platform } from "react-native";

// Echoes the icon's round letterform. Only for brand titles and the one display figure on a screen:
// `ui-rounded` is iOS's SF Pro Rounded, and the system navigation bar cannot take it.
export const ROUNDED_TITLE = Platform.OS === "ios" ? { fontFamily: "ui-rounded" } : undefined;
