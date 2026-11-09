import { Platform } from "react-native";
import { GlassMenuView, glassMenuSupported } from "@/modules/cohub-glass-menu";

export type { GlassMenuState } from "@/modules/cohub-glass-menu";
export { GlassMenuView };

/** Android 13+ binaries that ship the module draw menus as native Liquid Glass; other platforms and binaries draw them in JS. */
export const nativeGlassMenu = Platform.OS === "android" && GlassMenuView !== null && glassMenuSupported;
