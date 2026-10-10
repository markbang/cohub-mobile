import { decode } from "js-base64";
import type { DeviceDisplayStatus, DeviceFolderListing, DeviceRuntimeError, DeviceRuntimeInstance, DeviceRuntimeRefusal } from "@/modules/cohub-device-runtime";
import type { TranslationKey } from "@/src/i18n/en";

export type { DeviceDisplayStatus, DeviceFolderListing, DeviceRuntimeInstance, DeviceRuntimeRefusal } from "@/modules/cohub-device-runtime";

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
