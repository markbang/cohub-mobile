import Constants from "expo-constants";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { config } from "@/src/config";
import { loadDebugEvents, loadDebugSessions, pruneDebugSessions, saveDebugEvent, upsertDebugSession, type DebugEventRow } from "@/src/data/local-db";
import { setDebugTraceSink } from "@/src/data/chat-scroll-trace";

const APP_SLUG = "cohub-mobile";
const NON_ACTIVITY_EVENTS = new Set(["diagnostics.session.started", "chat.scroll.recording.start"]);
const EVENT_CAPACITY = 4000;
/** Sessions kept on disk; older ones are pruned when a new one starts. */
const SESSION_RETENTION = 5;

type DebugFields = Record<string, unknown>;
type ActiveSession = { id: string; startedAt: string; sequence: number; dropped: number; events: DebugEventRow[]; writes: Promise<void> };
export type FeedbackAttachment = { uri: string; name: string; mimeType: string; size: number };
export type FeedbackInput = { description: string; includeLog: boolean; attachments?: readonly FeedbackAttachment[] };
export type FeedbackReceipt = { id: string };
export type DebugSnapshot = { sessionId: string; startedAt: string; dropped: number; events: DebugEventRow[] };

let activeSession: ActiveSession | null = null;

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 600)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(token|secret|password|cookie|authorization|body|content|data|base64|text|title|url)$/i.test(key) || /(?:access|refresh)[_-]?token|message[_-]?text|assistant[_-]?text|user[_-]?text/i.test(key)) continue;
      output[key] = sanitize(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

function updateMetadata() {
  try {
    return { runtimeVersion: Updates.runtimeVersion ?? null, updateId: Updates.updateId ?? null };
  } catch {
    return { runtimeVersion: null, updateId: null };
  }
}

function beginSession(): ActiveSession {
  if (activeSession) return activeSession;
  const session: ActiveSession = {
    id: newId("debug"),
    startedAt: new Date().toISOString(),
    sequence: 0,
    dropped: 0,
    events: [],
    writes: Promise.resolve(),
  };
  activeSession = session;
  session.writes = upsertDebugSession({
    sessionId: session.id,
    startedAt: session.startedAt,
    updatedAt: Date.now(),
    closedAt: null,
    uploadedAt: null,
  })
    // A freeze leaves its session open in SQLite; prune only after the new session exists so
    // later launches cannot push the crashed one out of the retention window.
    .then(() => pruneDebugSessions(SESSION_RETENTION))
    .catch(() => undefined);
  record("diagnostics.session.started", {
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version ?? null,
    ...updateMetadata(),
  });
  return session;
}

export function record(name: string, fields: DebugFields = {}) {
  const session = beginSession();
  const event: DebugEventRow = {
    sessionId: session.id,
    sequence: ++session.sequence,
    timestamp: new Date().toISOString(),
    name,
    payload: JSON.stringify(sanitize(fields)),
  };
  if (session.events.length === EVENT_CAPACITY) {
    session.events.shift();
    session.dropped += 1;
  }
  session.events.push(event);
  session.writes = session.writes.then(() => saveDebugEvent(event)).catch(() => undefined);
}

function hasCapturedActivity(snapshot: DebugSnapshot) {
  return snapshot.events.some((event) => !NON_ACTIVITY_EVENTS.has(event.name));
}

async function loadActiveSnapshot(): Promise<DebugSnapshot> {
  const session = beginSession();
  await session.writes;
  // Copy: the live session keeps appending after the snapshot is handed out.
  return { sessionId: session.id, startedAt: session.startedAt, dropped: session.dropped, events: [...session.events] };
}

async function loadStoredSnapshots(): Promise<DebugSnapshot[]> {
  const sessions = await loadDebugSessions();
  const snapshots: DebugSnapshot[] = [];
  for (const session of sessions) {
    if (activeSession?.id === session.sessionId) continue;
    const events = await loadDebugEvents(session.sessionId);
    if (events.length === 0) continue;
    if (session.closedAt === null) await upsertDebugSession({ ...session, closedAt: new Date().toISOString() });
    snapshots.push({ sessionId: session.sessionId, startedAt: session.startedAt, dropped: Math.max(0, events.at(-1)!.sequence - events.length), events });
  }
  return snapshots;
}

/** The live session when it captured activity, otherwise the most recent stored one. A relaunch
writes only startup markers, so without this the frozen session it replaced would be shadowed. */
async function snapshot(): Promise<DebugSnapshot> {
  const active = await loadActiveSnapshot();
  if (hasCapturedActivity(active)) return active;
  const stored = await loadStoredSnapshots();
  return stored.find(hasCapturedActivity) ?? active;
}

/** JSON Lines, one `cohub-diagnostics-v1` header followed by the session's events. */
function formatDiagnostics(snapshot: DebugSnapshot): string {
  return [
    JSON.stringify({ format: "cohub-diagnostics-v1", sessionId: snapshot.sessionId, startedAt: snapshot.startedAt, dropped: snapshot.dropped, events: snapshot.events.length, privacy: "Diagnostic events only. Fields whose names look like message text, titles, tokens or bodies are stripped before they are stored." }),
    ...snapshot.events.map((event) => JSON.stringify({ at: event.timestamp, seq: event.sequence, name: event.name, payload: event.payload })),
  ].join("\n");
}

/**
 * cfeed parses the request UA to report OS and device. Native clients otherwise send
 * `okhttp/4.x` (Android) or a client that looks like a desktop browser (iOS), which costs
 * both the OS version and phone/tablet detection — okhttp even matches cfeed's bot list.
 */
function userAgent() {
  const app = `CohubMobile/${Constants.expoConfig?.version ?? "0.0.0"}`;
  const osVersion = Device.osVersion ?? String(Platform.Version);
  if (Platform.OS === "ios") {
    const name = Device.modelName ?? (Device.deviceType === Device.DeviceType.TABLET ? "iPad" : "iPhone");
    return `${app} (${name}; iOS ${osVersion})`;
  }
  if (Platform.OS === "android") {
    const mobile = Device.deviceType === Device.DeviceType.TABLET ? "" : "; Mobile";
    return `${app} (Android ${osVersion}; ${Device.modelName ?? "Android"}${mobile})`;
  }
  return `${app} (${Platform.OS})`;
}

function endpoint() {
  return `${config.diagnosticsOrigin.replace(/\/+$/, "")}/api/v1/feedback`;
}

function parseReceipt(status: number, body: string): FeedbackReceipt {
  if (status < 200 || status >= 300) {
    let detail: unknown;
    try {
      detail = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    } catch {
      detail = undefined;
    }
    throw new Error(typeof detail === "string" && detail ? detail : `Feedback upload failed (${status}).`);
  }
  let payload: { id?: unknown };
  try {
    payload = JSON.parse(body) as { id?: unknown };
  } catch {
    throw new Error("Feedback upload returned an invalid response.");
  }
  if (typeof payload.id !== "string" || !payload.id) throw new Error("Feedback upload returned no id.");
  return { id: payload.id };
}

function buildExtra(current: DebugSnapshot | null, attachmentCount: number) {
  const updates = updateMetadata();
  return {
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS,
    os_version: String(Platform.Version),
    device_model: Device.modelName ?? null,
    runtime_version: updates.runtimeVersion,
    update_id: updates.updateId,
    include_log: current !== null,
    attachment_count: attachmentCount,
    ...(current
      ? {
          session: {
            id: current.sessionId,
            started_at: current.startedAt,
            events: current.events.length,
            dropped: current.dropped,
          },
        }
      : {}),
  };
}

async function upload(content: string, current: DebugSnapshot | null, attachments: readonly FeedbackAttachment[]): Promise<FeedbackReceipt> {
  if (!current && attachments.length === 0) {
    // cfeed only accepts multipart when there are files; a text-only report can use JSON.
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent() },
      body: JSON.stringify({ app: APP_SLUG, content, extra: buildExtra(null, 0) }),
    });
    return parseReceipt(response.status, await response.text());
  }

  const sessionFile = current ? new File(Paths.cache, `cohub-diagnostics-${newId("upload")}.jsonl`) : null;
  try {
    if (sessionFile && current) {
      sessionFile.create({ overwrite: true, intermediates: true });
      await sessionFile.write(formatDiagnostics(current));
    }
    const form = new FormData();
    form.append("app", APP_SLUG);
    form.append("content", content);
    form.append("extra", JSON.stringify(buildExtra(current, attachments.length + (sessionFile ? 1 : 0))));
    // expo-fetch serializes a FormData part only when it is a Blob-like with `bytes()`;
    // React Native's `{ uri, name, type }` parts throw "Unsupported FormDataPart implementation".
    if (sessionFile) form.append("files", filePart(sessionFile, "cohub-diagnostics.jsonl", "text/plain") as unknown as Blob);
    for (const attachment of attachments) {
      form.append("files", filePart(new File(attachment.uri), attachment.name, attachment.mimeType) as unknown as Blob);
    }
    const response = await fetch(endpoint(), { method: "POST", headers: { "user-agent": userAgent() }, body: form });
    return parseReceipt(response.status, await response.text());
  } finally {
    try {
      if (sessionFile?.exists) sessionFile.delete();
    } catch {
      // A failed cleanup must not hide the upload result.
    }
  }
}

/** expo-fetch reads `type` and `bytes()` from a Blob-like part; keep the MIME the picker reported. */
function filePart(file: File, name: string, type: string) {
  return { name, type, bytes: () => file.bytes() };
}

export async function submitFeedback(input: FeedbackInput): Promise<FeedbackReceipt> {
  const description = input.description.trim();
  if (!description) throw new Error("Feedback description is required.");
  const current = input.includeLog ? await snapshot() : null;
  const attachments = input.attachments ?? [];
  const receipt = await upload(description, current, attachments);
  record("diagnostics.feedback.submitted", {
    feedbackId: receipt.id,
    includeLog: current !== null,
    attachments: attachments.length,
  });
  return receipt;
}

export function useDebugDiagnosticsLifecycle() {
  useEffect(() => {
    beginSession();
    const subscription = AppState.addEventListener("change", (state) => record(`app.${state === "active" ? "foregrounded" : "backgrounded"}`));
    return () => subscription.remove();
  }, []);
}

setDebugTraceSink((name, fields) => record(name, fields));
