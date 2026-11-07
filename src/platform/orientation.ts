import * as Device from "expo-device";
import { Platform } from "react-native";

/**
 * Phones stay in portrait; tablets turn freely. iOS declares this per idiom in Info.plist. Android's
 * manifest keeps every device in portrait from launch (sign-in included), and the root screens
 * release a tablet (smallest width 600 dp and up) once the app's navigator mounts.
 */
export const rootScreenOrientation = Platform.OS === "android" && Device.deviceType === Device.DeviceType.TABLET ? "default" as const : undefined;
