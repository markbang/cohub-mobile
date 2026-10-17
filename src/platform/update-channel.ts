import Constants from "expo-constants";
import * as Updates from "expo-updates";

export type UpdateChannel = "production" | "staging";

export type ChannelSwitchResult = "reloading" | "no-update";

export function currentUpdateChannel(): UpdateChannel | null {
  const channel = Updates.channel;
  return channel === "production" || channel === "staging" ? channel : null;
}

/**
 * Points this install at another OTA channel and loads its latest bundle. The override
 * persists natively across launches, so a channel without an update for this runtime is
 * rolled back immediately: otherwise the install would silently stop receiving production.
 */
export async function switchUpdateChannel(channel: UpdateChannel): Promise<ChannelSwitchResult> {
  const embedded = Constants.expoConfig?.updates?.requestHeaders;
  if (!embedded?.["expo-channel-name"]) {
    throw new Error("This build has no OTA channel header. Install a release build with OTA enabled.");
  }
  // Override keys must match the embedded headers, so the full map is sent, not just the channel.
  Updates.setUpdateRequestHeadersOverride(channel === "production" ? null : { ...embedded, "expo-channel-name": channel });
  const result = await Updates.fetchUpdateAsync().catch((error: unknown) => {
    if (channel !== "production") Updates.setUpdateRequestHeadersOverride(null);
    throw error;
  });
  if (result.isNew) {
    await Updates.reloadAsync();
    return "reloading";
  }
  if (channel !== "production") Updates.setUpdateRequestHeadersOverride(null);
  return "no-update";
}
