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

type DeviceRuntimeEvents = {
  onChange(event: { instances: DeviceRuntimeInstance[] }): void;
  onTokenRequest(event: { forceRefresh: boolean }): void;
};

declare class CohubDeviceRuntimeModule extends NativeModule<DeviceRuntimeEvents> {
  /** Android 11+ with the bundled sandboxd for this ABI. */
  isAvailable(): boolean;
  hasStorageAccess(): boolean;
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
}

/** Null on iOS: only the Android app can serve device folders. */
export default requireOptionalNativeModule<CohubDeviceRuntimeModule>("CohubDeviceRuntime");
