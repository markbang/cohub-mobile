import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";

export type CohubEnvironment = "prod" | "dev";

type ExpoExtra = {
  apiOrigin?: string;
  gatewayOrigin?: string;
  authEndpoint?: string;
  logtoAppId?: string;
  apiResource?: string;
  diagnosticsOrigin?: string;
  apkOrigin?: string;
  environment?: "prod" | "dev";
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;

const readPublic = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

function readEnvironment(value: string | undefined, fallback: CohubEnvironment): CohubEnvironment {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed === "prod" || trimmed === "dev") return trimmed;
  throw new Error(`Unknown Cohub environment "${trimmed}". Use "prod" or "dev".`);
}

const buildEnvironment = readEnvironment(
  process.env.EXPO_PUBLIC_COHUB_ENV ?? extra.environment,
  "prod",
);

/** Environment resolved at build time; the sign-in screen can override it and remembers the choice. */
export const defaultEnvironment = buildEnvironment;

/** The Space whose mod turns a Space into a Bot. */
export const BOT_MOD_SPACE_ID = "20b54a5b-dc39-44a1-93e1-1b5225ed4795";

/**
 * A Bot's Chat is one conversation that compacts itself: its sends ask for this window, which the
 * server keeps for the Chat from then on (delegated and scheduled messages included) and caps at the platform limit.
 */
export const BOT_CONTEXT_WINDOW = 400_000;

/** A debug build captured by `scripts/ui-snapshots.mjs`, which sets this when it starts Metro. */
export const uiSnapshots = process.env.EXPO_PUBLIC_UI_SNAPSHOTS === "1";

const environmentDefaults: Record<
  CohubEnvironment,
  { apiOrigin: string; gatewayOrigin: string; authEndpoint: string; logtoAppId: string }
> = {
  dev: {
    apiOrigin: "https://capi-dev.neta.art",
    gatewayOrigin: "wss://cgateway-dev.neta.art/ws",
    authEndpoint: "https://dev-auth.neta.art/",
    logtoAppId: "vpikk7sl9zwvefiptowtn",
  },
  prod: {
    apiOrigin: "https://capi.neta.art",
    gatewayOrigin: "wss://cgateway.neta.art/ws",
    authEndpoint: "https://auth.neta.art/",
    logtoAppId: "16ai0wao2mud3xqkbzqo0",
  },
};

export function resolveConfig(environment: CohubEnvironment) {
  const defaults = environmentDefaults[environment];
  // app.json mirrors the production endpoints. Only prod may inherit them; every
  // other environment resolves from its own defaults, so a selection alone points
  // the app at the right deployment. EXPO_PUBLIC_* still overrides any value.
  const readEnvironmentDefault = (extraValue: string | undefined, fallback: string) =>
    readPublic(environment === "prod" ? extraValue : undefined, fallback);
  return {
    environment,
    apkOrigin: readPublic(process.env.EXPO_PUBLIC_APK_ORIGIN, extra.apkOrigin ?? "https://mobile.talesofai.com"),
    diagnosticsOrigin: readPublic(process.env.EXPO_PUBLIC_DIAGNOSTICS_ORIGIN, extra.diagnosticsOrigin ?? "https://cfeed.neta.art"),
    apiOrigin: readPublic(process.env.EXPO_PUBLIC_API_ORIGIN, readEnvironmentDefault(extra.apiOrigin, defaults.apiOrigin)),
    gatewayOrigin: readPublic(
      process.env.EXPO_PUBLIC_GATEWAY_ORIGIN,
      readEnvironmentDefault(extra.gatewayOrigin, defaults.gatewayOrigin),
    ),
    authEndpoint: readPublic(
      process.env.EXPO_PUBLIC_AUTH_ENDPOINT,
      readEnvironmentDefault(extra.authEndpoint, defaults.authEndpoint),
    ),
    logtoAppId: readPublic(
      process.env.EXPO_PUBLIC_LOGTO_APP_ID,
      readEnvironmentDefault(extra.logtoAppId, defaults.logtoAppId),
    ),
    apiResource: readPublic(
      process.env.EXPO_PUBLIC_API_RESOURCE,
      extra.apiResource ?? "https://api.talesofai",
    ),
    redirectUri: ExpoLinking.createURL("callback"),
    appScheme: "cohub",
  };
}

export type CohubConfig = ReturnType<typeof resolveConfig>;

const activeConfig = resolveConfig(buildEnvironment);

/**
 * Configuration for the environment currently selected in the app. Updated in
 * place so modules that read `config` at call time see the current environment.
 */
export const config = activeConfig;

export function setActiveEnvironment(environment: CohubEnvironment) {
  if (activeConfig.environment === environment) return;
  Object.assign(activeConfig, resolveConfig(environment));
}

export const buildSessionDeepLink = (sessionId: string, turn?: number | null) => {
  const query = turn ? `?turn=${encodeURIComponent(String(turn))}` : "";
  return `cohub://chat/${encodeURIComponent(sessionId)}${query}`;
};

export const buildSpaceDeepLink = (spaceId: string) =>
  `cohub://space/${encodeURIComponent(spaceId)}`;
