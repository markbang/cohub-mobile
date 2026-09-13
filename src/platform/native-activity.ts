import { Linking, Platform } from "react-native";

export function openNativeActivity(path: string, params: Record<string, string | number | undefined> = {}) {
  if (Platform.OS !== "android") return false;
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  void Linking.openURL(`cohub-detail://${path}${query ? `?${query}` : ""}`);
  return true;
}
