import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { config } from "@/src/config";

const DISMISSED_PREFIX = "cohub:mobile-update-dismissed:v1";
const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

export type AppRelease = {
  version: string;
  url: string;
  notes: string | null;
  downloadUrl: string | null;
};

type CachedCheck = {
  checkedAt: number;
  release: AppRelease | null;
};

let cachedCheck: CachedCheck | null = null;
let request: Promise<AppRelease | null> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVersion(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function isAllowedReleaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "www.github.com");
  } catch {
    return false;
  }
}

export function isNewerAppVersion(current: string, latest: string) {
  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);
  if (!currentParts || !latestParts) return false;
  for (let index = 0; index < currentParts.length; index += 1) {
    if (latestParts[index] !== currentParts[index]) {
      return latestParts[index] > currentParts[index];
    }
  }
  return false;
}

export function getInstalledAppVersion() {
  return (
    Application.nativeApplicationVersion?.trim() ||
    Constants.expoConfig?.version?.trim() ||
    "0.0.0"
  );
}

function resolveDownloadUrl(payload: Record<string, unknown>) {
  const architectures = (Device.supportedCpuArchitectures ?? []).map((value) => value.toLowerCase());
  const abi = architectures.some((value) => value.includes("arm64") || value.includes("aarch64"))
    ? "arm64-v8a"
    : architectures.some((value) => value.includes("armeabi-v7a") || value.includes("armv7"))
      ? "armeabi-v7a"
      : architectures.some((value) => value.includes("x86_64") || value.includes("x86-64") || value.includes("amd64"))
        ? "x86_64"
        : architectures.some((value) => value.includes("x86"))
          ? "x86"
          : null;
  if (!abi || !Array.isArray(payload.assets)) return null;
  const asset = payload.assets.find((item) => {
    if (!isRecord(item)) return false;
    const name = typeof item.name === "string" ? item.name : "";
    const url = typeof item.browser_download_url === "string" ? item.browser_download_url.trim() : "";
    return name.endsWith(`android-${abi}.apk`) && isAllowedReleaseUrl(url);
  });
  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") return null;
  return asset.browser_download_url.trim() || null;
}

function releaseFromPayload(payload: unknown): AppRelease | null {
  if (!isRecord(payload)) return null;
  const tag = typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
  const url = typeof payload.html_url === "string" ? payload.html_url.trim() : "";
  const draft = payload.draft === true;
  const prerelease = payload.prerelease === true;
  if (!tag || !url || !isAllowedReleaseUrl(url) || draft || prerelease || !parseVersion(tag)) return null;

  return {
    version: tag.replace(/^v/, ""),
    url,
    notes: typeof payload.body === "string" && payload.body.trim() ? payload.body.trim() : null,
    downloadUrl: resolveDownloadUrl(payload),
  };
}

async function requestLatestRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(config.updateApiUrl, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Update check failed with HTTP ${response.status}`);
    const release = releaseFromPayload(await response.json());
    if (!release) throw new Error("Update response did not contain a stable release");
    return release;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForAppUpdate(options: { force?: boolean } = {}) {
  const currentVersion = getInstalledAppVersion();
  if (!options.force && cachedCheck && Date.now() - cachedCheck.checkedAt < CHECK_TTL_MS) {
    return cachedCheck.release && isNewerAppVersion(currentVersion, cachedCheck.release.version)
      ? cachedCheck.release
      : null;
  }
  if (request && !options.force) return request;

  request = requestLatestRelease()
    .then((latest) => {
      const release = isNewerAppVersion(currentVersion, latest.version) ? latest : null;
      cachedCheck = { checkedAt: Date.now(), release: latest };
      return release;
    })
    .finally(() => {
      request = null;
    });
  return request;
}

function dismissedKey(version: string) {
  return `${DISMISSED_PREFIX}:${version}`;
}

export async function isUpdateDismissed(version: string) {
  return (await AsyncStorage.getItem(dismissedKey(version))) === "true";
}

export async function dismissAppUpdate(version: string) {
  await AsyncStorage.setItem(dismissedKey(version), "true");
}
