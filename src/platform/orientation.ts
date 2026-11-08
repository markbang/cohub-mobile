import * as Device from "expo-device";
import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

// Smallest width of a tablet, as Android's `sw600dp`.
const TABLET_WIDTH = 600;
// A phone's portrait window is at least about twice as tall as it is wide; a tablet letterboxed into portrait is
// squarer (16:10 and 16:9 letterboxes, or HyperOS's, measured near 1.3).
const LETTERBOX_ASPECT = 1.9;
// How long a released window may take to grow before it counts as a phone's.
const PROBE_MS = 1500;

/**
 * Phones stay in portrait; tablets turn freely. iOS declares this per idiom in Info.plist. Android's
 * manifest keeps every device in portrait from launch (sign-in included), and the root screens release a
 * tablet once the app's navigator mounts.
 *
 * Launched in landscape, a tablet whose system honours the lock (HyperOS does; Pixel Tablet does not) is
 * letterboxed into a portrait window, and every size the app can read, `expo-device`'s type included,
 * then describes that window, not the screen. So a window too square to be a phone's is released first:
 * a tablet grows to the full screen and stays free; a phone's window stays put and is locked again.
 */
export function useRootScreenOrientation(): "default" | "portrait" | undefined {
  const { width, height } = useWindowDimensions();
  const short = Math.min(width, height);
  const [tablet, setTablet] = useState(() => Platform.OS === "android" && Device.deviceType === Device.DeviceType.TABLET);
  const [probing, setProbing] = useState(() => Platform.OS === "android" && !tablet && Math.max(width, height) / short < LETTERBOX_ASPECT);
  if (Platform.OS === "android" && !tablet && short >= TABLET_WIDTH) setTablet(true);
  useEffect(() => {
    if (!probing || tablet) return;
    const timer = setTimeout(() => setProbing(false), PROBE_MS);
    return () => clearTimeout(timer);
  }, [probing, tablet]);
  if (Platform.OS !== "android") return undefined;
  if (tablet || probing) return "default";
  // Only a probed window was released; any other phone still has the manifest's lock.
  return Math.max(width, height) / short < LETTERBOX_ASPECT ? "portrait" : undefined;
}
