import { createHash, randomBytes } from "node:crypto";

/**
 * Signs the E2E account in with its password through Logto's experience API and prints a refresh
 * token for the mobile app, so a UI snapshot run never opens the hosted sign-in page. That page asks
 * for the identifier first, and the dev tenant mails a sign-in code as soon as one is submitted.
 *
 * stdout carries the refresh token alone; progress goes to stderr. Nothing secret is ever printed
 * elsewhere: not the token, the password, the authorization code or the id token.
 */

const REDIRECT_URI = "cohub://callback";
// The scopes the app's Logto client asks for (`logtoConfig` in app/_layout.tsx).
const SCOPES = "openid offline_access profile email";
const MAX_REDIRECTS = 5;

const required = (key) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
};

const endpoint = new URL(process.env.E2E_AUTH_ENDPOINT?.trim() || "https://dev-auth.neta.art");
const appId = process.env.E2E_LOGTO_APP_ID?.trim() || "vpikk7sl9zwvefiptowtn";
const resource = process.env.E2E_LOGTO_RESOURCE?.trim() || "https://api.talesofai";

const log = (message) => process.stderr.write(`logto-token: ${message}\n`);
const base64url = (buffer) => buffer.toString("base64url");
// Logged locations keep only the path: query strings carry interaction ids and codes.
const pathOf = (url) => new URL(url).pathname;

const cookies = new Map();

async function request(path, init = {}) {
  const url = new URL(path, endpoint);
  if (url.origin !== endpoint.origin) throw new Error(`Refusing to send the sign-in cookies to ${url.origin}.`);
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return response;
}

async function readJson(response, step) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${step} answered ${response.status} with a body that is not JSON.`);
  }
}

async function expectOk(response, step) {
  if (response.ok) return readJson(response, step);
  const body = await readJson(response, step).catch(() => null);
  const detail = body?.message ? `${body.code ? `${body.code}: ` : ""}${body.message}` : `HTTP ${response.status}`;
  throw new Error(`${step} failed (${response.status}): ${detail}`);
}

const jsonInit = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function decodeJwtPayload(token) {
  const payload = token?.split(".")[1];
  if (!payload) throw new Error("The refresh grant returned no JWT access token.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function tokenGrant(params, step) {
  const response = await request("/oidc/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await readJson(response, step);
  if (!response.ok) throw new Error(`${step} failed (${response.status}): ${body?.error ?? "unknown error"}${body?.error_description ? ` (${body.error_description})` : ""}`);
  return body ?? {};
}

async function main() {
  const email = required("E2E_ACCOUNT_EMAIL");
  const password = required("E2E_ACCOUNT_PASSWORD");
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  log(`starting an interaction at ${endpoint.origin} for app ${appId}`);
  const authorize = await request(`/oidc/auth?${new URLSearchParams({
    client_id: appId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    // Logto only issues a refresh token for offline_access with consent, as the SDK requests it.
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource,
  })}`);
  if (authorize.status < 300 || authorize.status >= 400) throw new Error(`/oidc/auth answered ${authorize.status} instead of redirecting to the sign-in experience.`);
  if (!cookies.has("_interaction")) throw new Error("/oidc/auth set no _interaction cookie.");

  await expectOk(await request("/api/experience", jsonInit("PUT", { interactionEvent: "SignIn" })), "Starting the sign-in interaction");

  const verification = await expectOk(
    await request("/api/experience/verification/password", jsonInit("POST", { identifier: { type: "email", value: email }, password })),
    "Verifying the password",
  );
  if (!verification?.verificationId) throw new Error("The password step returned no verificationId.");
  await expectOk(await request("/api/experience/identification", jsonInit("POST", { verificationId: verification.verificationId })), "Identifying the user");
  log("password accepted");

  const submitted = await expectOk(await request("/api/experience/submit", { method: "POST" }), "Submitting the interaction");
  if (typeof submitted?.redirectTo !== "string") throw new Error(`Submitting the interaction returned no redirectTo: ${JSON.stringify(submitted)}`);

  // Submit hands back the OIDC resume URL; following it ends at the app's redirect URI.
  let location = submitted.redirectTo;
  for (let hop = 0; !location.startsWith(`${REDIRECT_URI}?`); hop += 1) {
    if (hop === MAX_REDIRECTS) throw new Error(`No redirect to ${REDIRECT_URI} after ${MAX_REDIRECTS} hops; last stop ${pathOf(location)}.`);
    const response = await request(location);
    const next = response.headers.get("location");
    if (!next) throw new Error(`${pathOf(location)} answered ${response.status} without a redirect; the sign-in needs a step this script does not take.`);
    location = new URL(next, location).toString();
  }
  const callback = new URL(location).searchParams;
  if (callback.get("error")) throw new Error(`Logto returned ${callback.get("error")}: ${callback.get("error_description") ?? "no description"}`);
  if (callback.get("state") !== state) throw new Error("The callback's state does not match the request.");
  const code = callback.get("code");
  if (!code) throw new Error("The callback carries no authorization code.");
  log("authorization code received");

  const tokens = await tokenGrant({ grant_type: "authorization_code", client_id: appId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier }, "The code exchange");
  if (!tokens.refresh_token) throw new Error("The code exchange returned no refresh_token; is offline_access granted to the app?");
  // The same grant the app runs first (src/auth/e2e-session.ts): it must return the id token the SDK
  // counts as signed in and an API token with the claim the app requires (NativeRoot in app/_layout.tsx).
  const refreshed = await tokenGrant({ grant_type: "refresh_token", client_id: appId, refresh_token: tokens.refresh_token, resource }, "The refresh grant");
  if (!refreshed.id_token) throw new Error("The refresh grant returned no id_token; the app would stay signed out.");
  const claims = decodeJwtPayload(refreshed.access_token);
  if (typeof claims.talesofai_uuid !== "string" || !claims.talesofai_uuid.trim()) throw new Error(`The access token for ${resource} has no talesofai_uuid claim; the app would refuse this session.`);
  const refreshToken = refreshed.refresh_token ?? tokens.refresh_token;
  log("refresh token issued");
  process.stdout.write(`${refreshToken}\n`);
}

try {
  await main();
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
