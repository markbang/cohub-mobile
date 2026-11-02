import { decode } from "js-base64";
import type { DeviceDisplayStatus, DeviceFolderListing, DeviceRuntimeError, DeviceRuntimeInstance, DeviceRuntimeRefusal, PhoneControlState } from "@/modules/cohub-device-runtime";
import type { TranslationKey } from "@/src/i18n/en";

export type { DeviceDisplayStatus, DeviceFolderListing, DeviceRuntimeInstance, DeviceRuntimeRefusal, PhoneControlState } from "@/modules/cohub-device-runtime";

/** Native caches a token until this long before it expires; must match AccessTokens.kt. */
export const DEVICE_RUNTIME_TOKEN_MARGIN_MS = 120_000;

/** Runtime relays live at the gateway root, beside the realtime `/ws` endpoint. */
export function runtimeGatewayOrigin(gatewayOrigin: string): string {
  const match = /^(wss:\/\/[^/?#\s]+)\/ws\/?$/.exec(gatewayOrigin.trim());
  if (!match) throw new Error(`The gateway origin must be wss://<host>/ws to connect this device, received: ${gatewayOrigin}`);
  return match[1];
}

/** Expiry of a JWT access token in epoch milliseconds, or null when it carries none. */
export function accessTokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const exp = (JSON.parse(decode(payload)) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isDeviceRuntimeRunning(instance: DeviceRuntimeInstance | null | undefined): boolean {
  return instance?.state === "connecting" || instance?.state === "ready";
}

/**
 * Spaces the device stopped serving because another Runtime held the lease, which is usually this
 * device's own connection lost while the app was suspended. Forbidden and user-disconnected Spaces stay stopped.
 */
export function conflictedDeviceRuntimes(instances: readonly DeviceRuntimeInstance[]): DeviceRuntimeInstance[] {
  return instances.filter((instance) => instance.state === "error" && instance.error === "conflict");
}

export function deviceFolderName(listing: Pick<DeviceFolderListing, "label">): string {
  return listing.label.split("/").filter(Boolean).at(-1) ?? listing.label;
}

export function deviceRuntimeStateKey(instance: DeviceRuntimeInstance | null): TranslationKey {
  if (!instance) return "deviceRuntime.notConnected";
  if (instance.state === "ready") return "deviceRuntime.connected";
  if (instance.state === "connecting") return "deviceRuntime.connecting";
  if (instance.state === "error") return deviceRuntimeErrorKey(instance.error);
  return "deviceRuntime.notConnected";
}

function deviceRuntimeErrorKey(error: DeviceRuntimeError | null): TranslationKey {
  if (error === "forbidden") return "deviceRuntime.error.forbidden";
  if (error === "conflict") return "deviceRuntime.error.conflict";
  return "deviceRuntime.error.failed";
}

export function deviceRuntimeRefusalKey(refusal: DeviceRuntimeRefusal | "declined"): TranslationKey {
  if (refusal === "declined") return "deviceRuntime.accessRequired";
  if (refusal === "folder_in_use") return "deviceRuntime.folderInUse";
  if (refusal === "space_in_use") return "deviceRuntime.spaceInUse";
  return "deviceRuntime.folderUnavailable";
}

export function deviceDisplayStateKey(status: DeviceDisplayStatus, spaceId: string): TranslationKey {
  if (status.sharedWith !== spaceId) return "deviceRuntime.display.notShared";
  return status.control ? "deviceRuntime.display.sharingControl" : "deviceRuntime.display.sharing";
}

export function phoneControlStageKey(state: PhoneControlState): TranslationKey {
  switch (state.stage) {
    case "ready": return "deviceRuntime.phoneControl.ready";
    case "developer": return "deviceRuntime.phoneControl.developer";
    case "pairing": return "deviceRuntime.phoneControl.pairing";
    case "code": return "deviceRuntime.phoneControl.code";
    case "starting": return "deviceRuntime.phoneControl.starting";
    case "stopped": return "deviceRuntime.phoneControl.stopped";
    default: return "deviceRuntime.phoneControl.off";
  }
}

const PHONE_CONTROL_ERRORS: Record<string, TranslationKey> = {
  pairing_wrong: "deviceRuntime.phoneControl.error.pairingWrong",
  pairing_closed: "deviceRuntime.phoneControl.error.pairingClosed",
  local_network_off: "deviceRuntime.phoneControl.error.localNetworkOff",
  wifi_off: "deviceRuntime.phoneControl.error.wifiOff",
  notifications_off: "deviceRuntime.phoneControl.error.notificationsOff",
  pairing_timed_out: "deviceRuntime.phoneControl.error.pairingTimedOut",
  wireless_debugging_unreachable: "deviceRuntime.phoneControl.error.unreachable",
  helper_did_not_start: "deviceRuntime.phoneControl.error.helperDidNotStart",
  helper_stopped: "deviceRuntime.phoneControl.error.helperStopped",
  unpaired: "deviceRuntime.phoneControl.error.unpaired",
  unsupported: "deviceRuntime.phoneControl.error.unsupported",
};

/** Null for codes this app does not know; `detail` still explains them under diagnostics. */
export function phoneControlErrorKey(state: PhoneControlState): TranslationKey | null {
  return state.error ? PHONE_CONTROL_ERRORS[state.error] ?? null : null;
}

const PHONE_CONTROL_STEPS = ["developer", "pairing", "code"] as const;

/** The pairing guide while setup waits on the person, each step done, current or ahead. */
export function phoneControlSteps(state: PhoneControlState): { key: TranslationKey; done: boolean; current: boolean }[] | null {
  const index = PHONE_CONTROL_STEPS.indexOf(state.stage as (typeof PHONE_CONTROL_STEPS)[number]);
  if (index < 0) return null;
  const keys: Record<(typeof PHONE_CONTROL_STEPS)[number], TranslationKey> = {
    developer: "deviceRuntime.phoneControl.stepDeveloper",
    pairing: "deviceRuntime.phoneControl.stepPairing",
    code: state.codeInput ? "deviceRuntime.phoneControl.stepCodeHere" : "deviceRuntime.phoneControl.stepCode",
  };
  return PHONE_CONTROL_STEPS.map((step, position) => ({ key: keys[step], done: position < index, current: position === index }));
}
