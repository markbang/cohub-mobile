import * as Device from "expo-device";
import { Platform } from "react-native";

/**
 * Phones stay in portrait; tablets turn freely. iOS declares this per idiom in Info.plist. On Android,
 * MainActivity locks a phone before the first frame (`plugins/android-orientation.js`), and the root
 * screens keep a tablet (smallest width 600 dp and up) free once the app's navigator mounts.
 */
export const rootScreenOrientation = Platform.OS === "android" && Device.deviceType === Device.DeviceType.TABLET ? "default" as const : undefined;
