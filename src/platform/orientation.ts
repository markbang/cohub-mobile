import * as Device from "expo-device";
import { Platform } from "react-native";

/**
 * Phones stay in portrait; tablets turn freely. iOS declares this per idiom in Info.plist. Android's
 * manifest leaves orientation open, so the root screens request portrait at runtime on anything
 * that is not a tablet (smallest width under 600 dp).
 */
export const rootScreenOrientation = Platform.OS === "android" && Device.deviceType !== Device.DeviceType.TABLET ? "portrait" as const : undefined;
