import { NativeModule, requireOptionalNativeModule } from "expo";

export type DeviceRuntimeState = "stopped" | "connecting" | "ready" | "error";
/** Why a Runtime stopped by itself: the server rejected it (`forbidden`) or another Runtime holds the Space (`conflict`). */
export type DeviceRuntimeError = "forbidden" | "conflict";
/** Why `start` refused to bind a folder; nothing changed. */
export type DeviceRuntimeRefusal = "space_in_use" | "folder_in_use" | "folder_unavailable";

export type DeviceRuntimeInstance = {
  spaceId: string;
  root: string;
  label: string;
  state: DeviceRuntimeState;
  error: DeviceRuntimeError | null;
};

export type DeviceFolder = { name: string; path: string };
export type DeviceVolume = { path: string; label: string };

export type DeviceFolderListing = {
  path: string;
  label: string;
  parent: string | null;
  /** The Space this folder is already bound to for the signed-in account. */
  spaceId: string | null;
  folders: DeviceFolder[];
  volumes: DeviceVolume[];
};

/** Phone control setup, in order: Developer options, the pairing dialog, its code, then the helper starting. */
export type PhoneControlStage = "off" | "developer" | "pairing" | "code" | "starting" | "ready" | "stopped";

/** Phone control: a shell helper started through Wireless debugging that gives agents a screen of their own. */
export type PhoneControlState = {
  stage: PhoneControlStage;
  /** Why setup or starting last stopped, e.g. `wifi_off`, `pairing_wrong`, `unsupported` below Android 14. */
  error: string | null;
  /** The pairing code can be typed in the app, which shares the screen with Settings. */
  codeInput: boolean;
  /** What last went wrong, in English, for diagnostics. */
  detail: string | null;
};

/** This screen: the Space it is shared with, whether Accessibility control is on, phone control, and the last sharing failure. */
export type DeviceDisplayStatus = {
  sharedWith: string | null;
  control: boolean;
  error: string | null;
  phoneControl: PhoneControlState;
};

type DeviceRuntimeEvents = {
  onChange(event: { instances: DeviceRuntimeInstance[] }): void;
  onDisplayChange(event: DeviceDisplayStatus): void;
  /** A person pressed Stop on the phone; the Turn acting there should stop. */
  onDisplayInterrupt(event: { spaceId: string; sessionId: string; turnId: string | null }): void;
  onTokenRequest(event: { forceRefresh: boolean }): void;
};

declare class CohubDeviceRuntimeModule extends NativeModule<DeviceRuntimeEvents> {
  /** Android 11+ with the bundled sandboxd for this ABI. */
  isAvailable(): boolean;
  hasStorageAccess(): boolean;
  isControlKeepAliveEnabled(): boolean;
  /** Persists and applies idle Accessibility foreground keep-alive; active Runtimes still require a notification. */
  setControlKeepAliveEnabled(enabled: boolean): void;
  /** Opens the All files access page and resolves with the result when the user returns. */
  requestStorageAccess(): Promise<boolean>;
  configure(account: string, gatewayOrigin: string): void;
  supplyAccessToken(token: string | null, expiresAt: number): void;
  signOut(): void;
  list(): DeviceRuntimeInstance[];
  /** Rejects with code `ERR_FOLDER_UNAVAILABLE` when the folder cannot be served. */
  browse(path: string | null): Promise<DeviceFolderListing>;
  start(spaceId: string, root: string): Promise<DeviceRuntimeRefusal | null>;
  stop(spaceId: string): void;
  displayStatus(): DeviceDisplayStatus;
  /** Shares through phone control when it is ready, otherwise after the system recording consent; rejects with `ERR_NOT_SERVING` unless this device serves the Space. */
  shareDisplay(spaceId: string): Promise<"declined" | "failed" | null>;
  stopDisplay(): void;
  /** Turns Accessibility on through phone control, or opens its settings (App info once Android blocked them as restricted settings). */
  openControlSettings(): Promise<void>;
  /** Starts phone control once paired; otherwise opens Developer options and guides pairing there and in a notification. */
  setupPhoneControl(): Promise<DeviceDisplayStatus>;
  /** Pairs with the code the Wireless debugging dialog shows; rejects with `ERR_PAIRING_CODE` unless it is six digits. */
  pairPhoneControl(code: string): Promise<DeviceDisplayStatus>;
}

/** Null on iOS: only the Android app can serve device folders. */
export default requireOptionalNativeModule<CohubDeviceRuntimeModule>("CohubDeviceRuntime");
