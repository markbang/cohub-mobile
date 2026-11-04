import { clearSharedPayloads, getResolvedSharedPayloadsAsync, getSharedPayloads } from "expo-sharing";
import { Platform } from "react-native";
import { incomingShareFromItems, type IncomingShare } from "@/src/data/incoming-share";

/**
 * Takes what another app shared into Cohub and clears it, so it is used once. Only Android
 * receives shares for now: the iOS share extension needs an App Group and its own provisioning
 * profile before `expo-sharing`'s `ios.enabled` can be turned on.
 */
export async function takeIncomingShare(): Promise<IncomingShare | null> {
  if (Platform.OS !== "android" || getSharedPayloads().length === 0) return null;
  try {
    return incomingShareFromItems(await getResolvedSharedPayloadsAsync());
  } finally {
    clearSharedPayloads();
  }
}
