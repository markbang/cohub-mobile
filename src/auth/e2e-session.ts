import { uiSnapshots } from "@/src/config";

/**
 * `scripts/ui-snapshots.mjs --offline` renders the debug routes with no account, so a composer evidence round
 * needs no sign-in. The debug routes draw fixed fixtures and read no account data, so the app runs under a stub
 * user id with no access token (every request fails before it leaves the device). Debug bundles only.
 */
export const offlineSnapshot = __DEV__ && uiSnapshots && process.env.EXPO_PUBLIC_E2E_SESSION === "offline";
export const OFFLINE_SNAPSHOT_USER_UUID = "00000000-0000-4000-8000-000000000000";
export const offlineAccessToken = async (): Promise<string | null> => null;
