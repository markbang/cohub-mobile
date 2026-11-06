import { record } from "@/src/data/debug-session";
import { chatScrollTrace } from "./chat-scroll-trace";

/**
 * Opt-in timeline for opening a Chat. Marks are recorded into the existing in-app scroll
 * diagnostics (and forwarded to the debug session when enabled), and into the diagnostics log
 * while the frame probe runs, so a JS stall it reports lines up with the open's phases. They carry
 * only phase names, elapsed milliseconds, and counts — never content or IDs. No-op while both are off.
 */
const MAX_TRACE_MS = 120_000;

let startedAt = 0;
let diagnostics = false;

/** Set by the frame probe, so a JS stall it reports lines up with the open's phases in one log. */
export function setChatEntryDiagnostics(on: boolean) {
  diagnostics = on;
}

export function startChatEntry() {
  startedAt = Date.now();
}

export function markChatEntry(phase: string, fields: Record<string, number | boolean> = {}) {
  if (startedAt === 0) return;
  const elapsed = Date.now() - startedAt;
  if (elapsed > MAX_TRACE_MS) {
    startedAt = 0;
    return;
  }
  chatScrollTrace.record(`entry.${phase}`, "chat.entry", { ms: elapsed, ...fields });
  // A recording scroll trace already forwards its entries to the same log.
  if (diagnostics && !chatScrollTrace.isRecording()) record(`chat.entry.${phase}`, { ms: elapsed, ...fields });
}
