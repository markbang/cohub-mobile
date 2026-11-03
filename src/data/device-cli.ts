import type { DeviceCliManifest, DeviceCliState } from "@/modules/cohub-device-runtime";
import type { TranslationKey } from "@/src/i18n/en";

export type { DeviceCliManifest, DeviceCliState } from "@/modules/cohub-device-runtime";

const RELEASE = "https://github.com/markbang/cohub-mobile/releases/download/android-cli-v10.18.0";

/**
 * The CLI a device Runtime offers to what it runs, published by `.github/workflows/android-cli.yml`.
 * Bumping it here reaches installed apps over OTA; each device downloads it while it serves a Space.
 */
export const DEVICE_CLI: DeviceCliManifest = {
  version: "10.18.0",
  nodeUrl: `${RELEASE}/node-v26.13.0-android-arm64-2.gz`,
  nodeSha256: "5cfc1a69f8f82b3e451b6b15793d6d4161168c1a93b20286ecdb9436ee64f765",
  cliUrl: `${RELEASE}/cohub-cli-10.18.0-android-arm64.zip`,
  cliSha256: "2d2d95850ec14e101c11ecac7cee89aa28039bf2b78ced7f146c0b33ab74d465",
};

/** Whether this device should download `manifest` now: it serves a Space and has another version, or none. */
export function shouldInstallDeviceCli(state: DeviceCliState, serving: boolean, manifest: DeviceCliManifest = DEVICE_CLI): boolean {
  if (!serving || state.status === "unsupported" || state.status === "installing") return false;
  return state.status !== "ready" || state.version !== manifest.version;
}

export function deviceCliStateKey(state: DeviceCliState): TranslationKey | null {
  if (state.status === "installing") return "deviceRuntime.cli.installing";
  if (state.error) return "deviceRuntime.cli.failed";
  if (state.status === "ready") return "deviceRuntime.cli.ready";
  if (state.status === "absent") return "deviceRuntime.cli.absent";
  return null;
}
