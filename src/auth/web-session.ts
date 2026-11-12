import { createCohubClient, type CohubClient, type Permission } from "@neta-art/cohub";
import { config } from "@/src/config";
import { isBotSpace } from "@/src/data/bot-mode";
import { listAllSpaces } from "@/src/data/space-list";

/**
 * The browser build runs as a Cohub App inside the Cohub page, which owns sign-in. The App never sees the
 * viewer's own token: the host hands it an App session token, and the API answers only for Spaces the viewer
 * granted to this App. A grant covers one Space, so every Bot Space is granted on connect; for the App's
 * owner the host grants without a dialog, other viewers confirm once per Space (grants last 14 days).
 */
const ACCOUNT_SCOPES: Permission[] = ["user.space.list", "user.session.list", "user.taskrun.list", "user.usage.read"];
const BOT_SCOPES: Permission[] = [
  "space.view", "space.label.view", "space.label.assign", "member.view",
  "session.view", "session.edit", "session.prompt.readonly", "session.prompt.fullaccess",
  "file.view", "file.edit", "checkpoint.view", "taskrun.view",
];

export type WebViewer = { uuid: string; name: string | null; username: string | null; avatarUrl: string | null };
let viewer: WebViewer | null = null;
let host: CohubClient | null = null;

export function webViewer() {
  return viewer;
}

function hostClient() {
  host ??= createCohubClient({ baseUrl: config.apiOrigin });
  return host;
}

export function getWebAccessToken(options?: { forceRefresh?: boolean }) {
  return hostClient().auth.getAccessToken(options);
}

/** Grants this App every Bot Space of the viewer, then reads who the viewer is. */
export async function connectWebSession(): Promise<WebViewer> {
  const runtime = hostClient();
  const context = await runtime.context();
  if (!context) throw new Error("Open this App from Cohub.");
  const homeSpaceId = context.app.homeSpace?.id ?? context.space.id;
  const granted = new Map((context.permissions?.viewerGrants ?? []).map((grant) => [grant.spaceId, new Set<Permission>(grant.scopes)]));

  // A grant request replaces that Space's scopes, so each one carries what the Space already holds.
  const grant = async (spaceId: string, scopes: Permission[]) => {
    const held = granted.get(spaceId) ?? new Set<Permission>();
    if (scopes.every((scope) => held.has(scope))) return;
    const next = [...new Set([...held, ...scopes])];
    const ok = await runtime.auth.request({ scopes: next, spaceId });
    if (!ok) throw new Error("Cohub did not grant access to your Bots.");
    granted.set(spaceId, new Set(next));
  };

  await grant(homeSpaceId, ACCOUNT_SCOPES);
  if (!await runtime.auth.getAccessToken()) throw new Error("Sign in to Cohub to continue.");
  const client = createCohubClient({ baseUrl: config.apiOrigin, getAccessToken: (options) => runtime.auth.getAccessToken(options) });
  const [me, spaces] = await Promise.all([client.user.getMe(), listAllSpaces(client)]);
  // The host serves one grant request at a time.
  for (const space of spaces.filter(isBotSpace)) await grant(space.id, BOT_SCOPES);
  viewer = { uuid: me.uuid, name: me.profile.displayName || null, username: me.profile.username, avatarUrl: me.profile.avatarUrl };
  return viewer;
}
