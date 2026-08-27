import type { ConfigContext, ExpoConfig } from "expo/config";

function buildNumberFor(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) throw new Error(`Invalid app version: ${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const buildNumber = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new Error(`App version cannot produce a valid native build number: ${version}`);
  }
  return buildNumber;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const version = config.version?.trim() || "0.0.1";
  const buildNumber = buildNumberFor(version);
  return {
    ...config,
    name: config.name ?? "Cohub",
    slug: config.slug ?? "cohub-mobile",
    version,
    android: {
      ...config.android,
      versionCode: buildNumber,
    },
    ios: {
      ...config.ios,
      buildNumber: String(buildNumber),
    },
  };
};
