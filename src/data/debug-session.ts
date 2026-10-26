import { randomUUID } from "expo-crypto";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Dimensions, Platform } from "react-native";
import { config } from "@/src/config";
import { DEBUG_EVENT_LIMIT, loadDebugEvents, loadDebugSessions, pruneDebugSessions, saveDebugEvent, upsertDebugSession, type DebugEventRow, type DebugSessionRow } from "@/src/data/local-db";
import { setDebugTraceSink } from "@/src/data/chat-scroll-trace";

const APP_SLUG = "cohub-mobile";
const NON_ACTIVITY_EVENTS = new Set(["diagnostics.session.started", "chat.scroll.recording.start"]);
/** App opens kept on disk; a feedback submission attaches all of them when present. */
const SESSION_RETENTION = 3;
const STORAGE_WRITE_INTERVAL_MS = 500;
/** Keep feedback uploads practical on a phone network; oldest events are trimmed first. */
const MAX_DIAGNOSTIC_BYTES = 8 * 1024 * 1024;
const launchEpochMs = Date.now();

type DebugFields = Record<string, unknown>;
type ActiveSession = {
  id: string;
  startedAt: string;
  epochMs: number;
  sequence: number;
  dropped: number;
  events: DebugEventRow[];
  writes: Promise<void>;
};
/** One collected launch. `staged` marks the live launch, which was never closed by a shutdown. */
type StoredSnapshot = { id: string; startedAt: string; endedAt: string | null; events: DebugEventRow[]; dropped: number; staged?: boolean };
export type FeedbackAttachment = { uri: string; name: string; mimeType: string; size: number };
export type FeedbackInput = { description: string; includeLog: boolean; attachments?: readonly FeedbackAttachment[] };
export type FeedbackReceipt = { id: string };
export type DebugSnapshot = { sessionId: string; startedAt: string; dropped: number; events: DebugEventRow[] };

/** Correlation context attached to every stored event so a screenshot can be tied to a tap. */
const context: Record<string, string | null> = { session: null, surface: null, focus: null };
const aliasCounters = new Map<string, number>();
const aliasIds = new Map<string, string>();
export type DebugAliasKind = "session" | "space" | "message" | "turn" | "user" | "id";

/** Recording-local pseudonym: raw Cohub IDs stay out of the log while events still correlate. */
export function debugAlias(kind: DebugAliasKind, id: string): string {
  const key = `${kind}:${id}`;
  const existing = aliasIds.get(key);
  if (existing) return existing;
  const next = (aliasCounters.get(kind) ?? 0) + 1;
  aliasCounters.set(kind, next);
  const alias = `${kind[0]}${next}`;
  aliasIds.set(key, alias);
  return alias;
}

export function setDebugContext(field: "session" | "surface" | "focus", value: string | null) {
  if (context[field] === value) return;
  context[field] = value;
  record("debug.context", { [field]: value });
}

let activeSession: ActiveSession | null = null;

function newId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 18)}`;
}

const REDACTED_KEYS = /^(token|secret|password|cookie|authorization|body|content|data|base64|text|title|\w*url)$/i;
const REDACTED_FRAGMENTS = /(?:access|refresh|id|auth)[_-]?token|token[_-]?(?:id)?$|message[_-]?text|assistant[_-]?text|user[_-]?text|password|secret|authorization|api[_-]?key/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]+=*/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** Strips credentials and raw identifiers from anything free-form (errors, URLs, names). */
export function redactText(value: string, limit = 400): string {
  const clean = value
    .replace(BEARER, "[auth]")
    .replace(JWT, "[jwt]")
    .replace(UUID, "[id]")
    .replace(EMAIL, "[email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[id]");
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (typeof value === "string") return redactText(value, 400);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (REDACTED_KEYS.test(key) || REDACTED_FRAGMENTS.test(key)) continue;
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

function readLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return null;
  }
}

function deviceSnapshot() {
  const window = Dimensions.get("window");
  const screen = Dimensions.get("screen");
  return {
    kind: Device.deviceType === Device.DeviceType.TABLET ? "tablet" : Device.deviceType === Device.DeviceType.PHONE ? "phone" : "unknown",
    model: Device.modelName ?? null,
    brand: Device.brand ?? null,
    os: `${Platform.OS} ${Device.osVersion ?? String(Platform.Version)}`,
    arch: Device.supportedCpuArchitectures?.join(",") ?? null,
    memoryMb: Device.totalMemory ? Math.round(Device.totalMemory / 1024 / 1024) : null,
    window: `${Math.round(window.width)}x${Math.round(window.height)}`,
    screen: `${Math.round(screen.width)}x${Math.round(screen.height)}`,
    scale: Math.round(window.scale * 100) / 100,
    fontScale: Math.round(window.fontScale * 100) / 100,
    timezoneOffset: new Date().getTimezoneOffset(),
  };
}

function beginSession(): ActiveSession {
  if (activeSession) return activeSession;
  const session: ActiveSession = {
    id: newId("debug"),
    startedAt: new Date().toISOString(),
    epochMs: Date.now(),
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
    appBuild: Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? null,
    sdkVersion: Constants.expoConfig?.sdkVersion ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    isDevice: Device.isDevice,
    ...updateMetadata(),
    device: deviceSnapshot(),
    locale: readLocale(),
  });
  return session;
}

const pendingWrites: DebugEventRow[] = [];
let flushScheduled = false;
let lastFlushAt = 0;

/** Batches into one transaction. Every event is still persisted, just with fewer round trips. */
function scheduleFlush(session: ActiveSession) {
  if (pendingWrites.length === 0) return;
  const wait = Math.max(0, lastFlushAt + STORAGE_WRITE_INTERVAL_MS - Date.now());
  if (!flushScheduled) {
    flushScheduled = true;
    session.writes = session.writes
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, wait)))
      .then(async () => {
        const batch = pendingWrites.splice(0);
        flushScheduled = false;
        lastFlushAt = Date.now();
        for (const event of batch) await saveDebugEvent(event);
        if (pendingWrites.length > 0) scheduleFlush(session);
      })
      .catch(() => {
        flushScheduled = false;
        pendingWrites.splice(0);
      });
  }
}

/**
 * A fatal error tears the JS runtime down before the next batched write, so it never reached the
 * log. Writes what is pending now, past the batch interval; settles within `timeoutMs`.
 */
export function flushDebugEventsNow(timeoutMs: number): Promise<void> {
  if (pendingWrites.length === 0) return Promise.resolve();
  const batch = pendingWrites.splice(0);
  const written = (async () => {
    for (const event of batch) await saveDebugEvent(event);
  })().catch(() => undefined);
  return Promise.race([written, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function record(name: string, fields: DebugFields = {}) {
  const session = beginSession();
  const now = new Date();
  // Coordinates are measured from launch so events from every source interleave on one clock.
  const event: DebugEventRow = {
    sessionId: session.id,
    sequence: ++session.sequence,
    timestamp: now.toISOString(),
    name,
    payload: JSON.stringify(sanitize({
      t: now.getTime() - session.epochMs,
      ...Object.fromEntries(Object.entries(context).filter(([, value]) => value !== null)),
      ...fields,
    })),
  };
  if (session.events.length === DEBUG_EVENT_LIMIT) {
    session.events.shift();
    session.dropped += 1;
  }
  session.events.push(event);
  pendingWrites.push(event);
  scheduleFlush(session);
}

function hasCapturedActivity(events: readonly DebugEventRow[]) {
  return events.some((event) => !NON_ACTIVITY_EVENTS.has(event.name));
}

function snapshotFromRow(row: DebugSessionRow, events: DebugEventRow[]): StoredSnapshot {
  return {
    id: row.sessionId,
    startedAt: row.startedAt,
    endedAt: row.closedAt,
    staged: false,
    events,
    dropped: Math.max(0, (events.at(-1)?.sequence ?? 0) - events.length),
  };
}

/** Previous launches first, then the live one; launches without activity are skipped. */
async function collectSnapshots(): Promise<StoredSnapshot[]> {
  const session = beginSession();
  await session.writes;
  const rows = await loadDebugSessions();
  const snapshots: StoredSnapshot[] = [];
  for (const row of rows) {
    if (row.sessionId === session.id) continue;
    const events = await loadDebugEvents(row.sessionId);
    if (row.closedAt === null && hasCapturedActivity(events)) {
      // A launch that died before its deferred close still ends when the next launch began.
      const nextLaunch = rows
        .map((item) => item.startedAt)
        .filter((startedAt) => Date.parse(startedAt) > Date.parse(row.startedAt))
        .sort()[0];
      row.closedAt = nextLaunch ?? new Date().toISOString();
      await upsertDebugSession(row);
    }
    if (!hasCapturedActivity(events)) continue;
    snapshots.push(snapshotFromRow(row, events));
  }
  snapshots.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  if (hasCapturedActivity(session.events)) {
    // Copy: the live session keeps appending after the snapshot is handed out.
    snapshots.unshift({ id: session.id, startedAt: session.startedAt, endedAt: null, staged: true, events: [...session.events], dropped: session.dropped });
  }
  return snapshots.slice(0, SESSION_RETENTION);
}

function sessionHeader(snapshot: StoredSnapshot, index: number, total: number) {
  return {
    format: "cohub-diagnostics-v1",
    launch: index + 1,
    launches: total,
    sessionId: snapshot.id,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    staged: snapshot.staged === true,
    dropped: snapshot.dropped,
    events: snapshot.events.length,
    privacy: "Diagnostic events only. Credentials, message text, titles and raw identifiers are redacted before storage; IDs appear as per-launch aliases.",
  };
}

function eventLine(event: DebugEventRow) {
  const payload = JSON.parse(event.payload) as Record<string, unknown>;
  const { t, ...fields } = payload;
  return JSON.stringify({ at: event.timestamp, t, name: event.name, ...fields });
}

function formatDiagnostics(snapshots: readonly StoredSnapshot[]): { content: string; snapshots: StoredSnapshot[] } {
  const kept = snapshots.map((snapshot) => ({ ...snapshot, events: [...snapshot.events] }));
  const lineBytes = (event: DebugEventRow) => event.payload.length + event.name.length + 80;
  let total = kept.reduce((sum, snapshot) => sum + snapshot.events.reduce((bytes, event) => bytes + lineBytes(event), 0), 0);
  let truncated = false;
  // Newest launch first: spend the budget on the round that contains the report.
  for (let index = kept.length - 1; index >= 0 && total > MAX_DIAGNOSTIC_BYTES; index -= 1) {
    const snapshot = kept[index];
    while (snapshot.events.length > 0 && total > MAX_DIAGNOSTIC_BYTES) {
      total -= lineBytes(snapshot.events.shift()!);
      snapshot.dropped += 1;
      truncated = true;
    }
  }
  const lines = [
    JSON.stringify({
      format: "cohub-diagnostics-v2",
      startedAt: kept[0]?.startedAt ?? null,
      launches: kept.length,
      events: kept.reduce((sum, snapshot) => sum + snapshot.events.length, 0),
      truncated,
    }),
  ];
  kept.forEach((snapshot, index) => {
    lines.push(JSON.stringify(sessionHeader(snapshot, index, kept.length)));
    for (const event of snapshot.events) lines.push(eventLine(event));
  });
  return { content: lines.join("\n"), snapshots: kept };
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

function buildExtra(snapshots: readonly StoredSnapshot[], attachmentCount: number) {
  const updates = updateMetadata();
  return {
    app_version: Constants.expoConfig?.version ?? null,
    platform: Platform.OS,
    os_version: String(Platform.Version),
    device_model: Device.modelName ?? null,
    runtime_version: updates.runtimeVersion,
    update_id: updates.updateId,
    include_log: snapshots.length > 0,
    attachment_count: attachmentCount,
    ...(snapshots.length > 0
      ? {
          session: {
            id: snapshots[0].id,
            started_at: snapshots[0].startedAt,
            events: snapshots.reduce((sum, snapshot) => sum + snapshot.events.length, 0),
            dropped: snapshots.reduce((sum, snapshot) => sum + snapshot.dropped, 0),
          },
          launches: snapshots.map((snapshot) => ({
            id: snapshot.id,
            started_at: snapshot.startedAt,
            ended_at: snapshot.endedAt,
            events: snapshot.events.length,
            live: snapshot.staged === true,
          })),
        }
      : {}),
  };
}

async function upload(content: string, snapshots: readonly StoredSnapshot[], attachments: readonly FeedbackAttachment[]): Promise<FeedbackReceipt> {
  if (snapshots.length === 0 && attachments.length === 0) {
    // cfeed only accepts multipart when there are files; a text-only report can use JSON.
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent() },
      body: JSON.stringify({ app: APP_SLUG, content, extra: buildExtra(snapshots, 0) }),
    });
    return parseReceipt(response.status, await response.text());
  }

  const sessionFile = snapshots.length > 0 ? new File(Paths.cache, `cohub-diagnostics-${newId("upload")}.jsonl`) : null;
  let uploadedSnapshots = snapshots;
  try {
    if (sessionFile) {
      const formatted = formatDiagnostics(snapshots);
      sessionFile.create({ overwrite: true, intermediates: true });
      await sessionFile.write(formatted.content);
      uploadedSnapshots = formatted.snapshots;
    }
    const form = new FormData();
    form.append("app", APP_SLUG);
    form.append("content", content);
    form.append("extra", JSON.stringify(buildExtra(uploadedSnapshots, attachments.length + (sessionFile ? 1 : 0))));
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
  // The submission itself must not appear in the log it uploads.
  const snapshots = input.includeLog ? await collectSnapshots() : [];
  const attachments = input.attachments ?? [];
  const receipt = await upload(description, snapshots, attachments);
  record("diagnostics.feedback.submitted", {
    feedbackId: receipt.id,
    includeLog: snapshots.length > 0,
    launches: snapshots.length,
    attachments: attachments.length,
  });
  return receipt;
}

/** Launches rotate on a process restart; foregrounding never starts a new round. */
export function useDebugDiagnosticsLifecycle() {
  useEffect(() => {
    beginSession();
    record("app.ready", { startupMs: Date.now() - launchEpochMs, state: AppState.currentState });
    let previous = AppState.currentState;
    let changedAt = Date.now();
    record("app.lifecycle", { state: previous, foregroundMs: 0 });
    const subscription = AppState.addEventListener("change", (state) => {
      const now = Date.now();
      record("app.lifecycle", { state, previous, sinceMs: now - changedAt, foregroundMs: previous === "active" ? now - changedAt : null });
      previous = state;
      changedAt = now;
    });
    return () => subscription.remove();
  }, []);
}

setDebugTraceSink((name, fields) => record(name, fields));
