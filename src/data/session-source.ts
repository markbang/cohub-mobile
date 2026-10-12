import type { UserSessionSourceKey } from "@neta-art/cohub";

/**
 * Chats source filter. Mirrors the Space panel taxonomy: first-party app sessions
 * are submitted with source `web`, so every other server source key groups as `other`.
 */
export type SessionSourceFilter = "all" | "web" | "other";

/** Every `GET /api/me/sessions` source key except `web`. */
const OTHER_SESSION_SOURCE_KEYS = [
  "public_api",
  "scheduled_task",
  "space_hook",
  "websocket",
  "cli",
  "feishu",
  "wechat",
  "discord",
  "qq",
  "other",
] as const satisfies readonly UserSessionSourceKey[];

/** `null` selects the unfiltered Chats list (no `source` query). */
export function sessionSourceFilterKeys(filter: SessionSourceFilter): readonly UserSessionSourceKey[] | null {
  if (filter === "all") return null;
  return filter === "web" ? ["web"] : OTHER_SESSION_SOURCE_KEYS;
}

const WEB_SOURCE_KEYS: ReadonlySet<string> = new Set(["web", "web_app"]);

/** Mirrors the server's `resolveSessionSourceKey` (null is a legacy web Chat), collapsed to the Chats filters. */
export function sessionSourceFilterOf(source: string | null | undefined): Exclude<SessionSourceFilter, "all"> {
  const raw = source?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "web";
  const channel = raw.match(/^channel[:_](.+)$/)?.[1] ?? (raw.includes(":") ? raw.split(":")[0] : null);
  return WEB_SOURCE_KEYS.has(raw) || (channel !== null && channel !== undefined && WEB_SOURCE_KEYS.has(channel)) ? "web" : "other";
}
