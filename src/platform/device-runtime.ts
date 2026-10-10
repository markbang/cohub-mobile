import { useEffect, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import nativeDeviceRuntime from "@/modules/cohub-device-runtime";
import { config } from "@/src/config";
import {
  accessTokenExpiresAt,
  DEVICE_RUNTIME_TOKEN_MARGIN_MS,
  runtimeGatewayOrigin,
  type DeviceDisplayStatus,
  type DeviceFolderListing,
  type DeviceRuntimeInstance,
  type DeviceRuntimeRefusal,
} from "@/src/data/device-runtime";

const native = Platform.OS === "android" && nativeDeviceRuntime?.isAvailable() ? nativeDeviceRuntime : null;

/** Whether this device can serve a folder as a Space's local Runtime (Android 11+, 64-bit). */
export const deviceRuntimeSupported = native !== null;

type GetAccessToken = (options?: { forceRefresh?: boolean }) => Promise<string | null>;

function requireNative() {
  if (!native) throw new Error("This device cannot serve a Space.");
  return native;
}

async function supplyAccessToken(getAccessToken: GetAccessToken, forceRefresh: boolean) {
  const runtime = requireNative();
  try {
    let token = await getAccessToken({ forceRefresh });
    let expiresAt = token ? accessTokenExpiresAt(token) : null;
    // The sign-in client hands back its cached token until it has expired; the Runtime needs one
    // that outlives the refresh margin, so a nearly expired token is refreshed here.
    if (token && !forceRefresh && expiresAt !== null && expiresAt - Date.now() <= DEVICE_RUNTIME_TOKEN_MARGIN_MS) {
      token = await getAccessToken({ forceRefresh: true });
      expiresAt = token ? accessTokenExpiresAt(token) : null;
    }
    if (token && expiresAt === null) console.warn("[device-runtime] the access token has no expiry; the Runtime cannot use it");
    runtime.supplyAccessToken(token && expiresAt !== null ? token : null, expiresAt ?? 0);
  } catch (error) {
    console.warn("[device-runtime] could not provide an access token", error);
    runtime.supplyAccessToken(null, 0);
  }
}

/**
 * Connects the device Runtime to the signed-in account: folders bound by this account resume,
 * other accounts' folders stop, and the Runtime asks this session for access tokens.
 */
export function useDeviceRuntimeSession(account: string, getAccessToken: GetAccessToken) {
  useEffect(() => {
    if (!native) return;
    native.configure(account, runtimeGatewayOrigin(config.gatewayOrigin));
    const subscription = native.addListener("onTokenRequest", ({ forceRefresh }) => {
      void supplyAccessToken(getAccessToken, forceRefresh);
    });
    return () => subscription.remove();
  }, [account, getAccessToken]);
}

/** Disconnects every folder; called when the account signs out. */
export function signOutDeviceRuntime() {
  native?.signOut();
}

let instances: DeviceRuntimeInstance[] | null = null;
let changes: { remove(): void } | null = null;
const listeners = new Set<() => void>();

function subscribeInstances(listener: () => void) {
  if (!native) return () => undefined;
  listeners.add(listener);
  if (!changes) {
    changes = native.addListener("onChange", (event) => {
      instances = event.instances;
      listeners.forEach((notify) => notify());
    });
    instances = native.list();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    changes?.remove();
    changes = null;
  };
}

/** Every folder this account binds on this device, live; null where the device cannot serve Spaces. */
export function useDeviceRuntimeInstances(): DeviceRuntimeInstance[] | null {
  return useSyncExternalStore(subscribeInstances, () => instances);
}

async function ensureStorageAccess(): Promise<boolean> {
  const runtime = requireNative();
  return runtime.hasStorageAccess() || runtime.requestStorageAccess();
}

/** Lists a folder; null when the user did not allow All files access. */
export async function browseDeviceFolder(path?: string): Promise<DeviceFolderListing | null> {
  if (!(await ensureStorageAccess())) return null;
  return requireNative().browse(path ?? null);
}

export async function startDeviceRuntime(spaceId: string, root: string): Promise<DeviceRuntimeRefusal | "declined" | null> {
  if (!(await ensureStorageAccess())) return "declined";
  return requireNative().start(spaceId, root);
}

export function stopDeviceRuntime(spaceId: string) {
  requireNative().stop(spaceId);
}

let displayStatus: DeviceDisplayStatus | null = null;
let displayChanges: { remove(): void } | null = null;
const displayListeners = new Set<() => void>();

function subscribeDisplay(listener: () => void) {
  if (!native) return () => undefined;
  displayListeners.add(listener);
  if (!displayChanges) {
    displayChanges = native.addListener("onDisplayChange", (event) => {
      displayStatus = event;
      displayListeners.forEach((notify) => notify());
    });
    displayStatus = native.displayStatus();
  }
  return () => {
    displayListeners.delete(listener);
    if (displayListeners.size > 0) return;
    displayChanges?.remove();
    displayChanges = null;
  };
}

/** This screen's sharing state, live; null where the device cannot serve Spaces. */
export function useDeviceDisplayStatus(): DeviceDisplayStatus | null {
  return useSyncExternalStore(subscribeDisplay, () => displayStatus);
}

/** Shares this screen with a Space this device serves, after the system capture consent. */
export function shareDeviceDisplay(spaceId: string): Promise<"declined" | "failed" | null> {
  return requireNative().shareDisplay(spaceId);
}

export function stopDeviceDisplay() {
  requireNative().stopDisplay();
}

export async function openDeviceControlSettings(): Promise<null> {
  await requireNative().openControlSettings();
  return null;
}
