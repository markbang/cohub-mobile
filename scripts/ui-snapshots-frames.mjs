import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Cuts still frames out of a motion recording by real time. Maestro's `commands` JSON (written under `--debug-output`)
 * stamps each command with when it started and how long it took, so a frame is placed at a swipe's start plus an
 * offset in milliseconds, and its position in the video is that moment less the recording's own start.
 */

/** The command's name: the one key of the command object (Maestro writes each command as `{ <name>: {...} }`). */
function commandName(entry) {
  const command = entry.command && typeof entry.command === "object" ? entry.command : entry;
  return Object.keys(command).find((key) => key !== "metadata") ?? "";
}

function commandMetadata(entry) {
  return entry.metadata ?? {};
}

/**
 * The recording's start and the swipes after it, in milliseconds on the host clock. Throws when the JSON carries no
 * start or no timestamp, and names what it found, so a Maestro format change is one line to read.
 */
export function recordingClock(commands, recording) {
  const names = commands.map(commandName);
  const start = names.findIndex((name) => /^startrecording/i.test(name));
  if (start < 0) throw new Error(`No startRecording in the Maestro commands for ${recording}. Commands seen: ${names.join(", ")}.`);
  const startedAtMs = commandMetadata(commands[start]).timestamp;
  if (typeof startedAtMs !== "number") throw new Error(`The startRecording command for ${recording} has no timestamp. Metadata seen: ${JSON.stringify(commandMetadata(commands[start]))}.`);
  const swipes = commands.slice(start + 1).flatMap((entry) => {
    if (!/swipe/i.test(commandName(entry))) return [];
    const metadata = commandMetadata(entry);
    if (typeof metadata.timestamp !== "number") throw new Error(`A swipe in ${recording} has no timestamp.`);
    return [{ startMs: metadata.timestamp, durationMs: metadata.duration ?? null }];
  });
  return { startedAtMs, swipes };
}

/**
 * Where each frame sits in the video, in seconds: `swipe` counts the swipes after the recording started, and `ms` is
 * the offset from that swipe's start on the host clock.
 */
export function frameTimes(clock, frames) {
  return frames.map((frame) => {
    const swipe = clock.swipes[frame.swipe];
    if (!swipe) throw new Error(`Frame "${frame.label}" wants swipe ${frame.swipe}, but the recording has ${clock.swipes.length}.`);
    const wallMs = swipe.startMs + frame.ms;
    return { label: frame.label, wallMs, videoSeconds: (wallMs - clock.startedAtMs) / 1000 };
  });
}

/** Maestro's command JSON under a flow's debug output, as parsed objects. Maestro names it `commands-(<flow>).json`. */
export function readCommands(debugOutput) {
  const found = listJson(debugOutput).filter((path) => basename(path).startsWith("commands"));
  if (found.length === 0) throw new Error(`No Maestro commands JSON under ${debugOutput}.`);
  return JSON.parse(readFileSync(found[0], "utf8"));
}

function listJson(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return listJson(path);
    return entry.endsWith(".json") ? [path] : [];
  });
}

/** One PNG per frame, taken at its time in the video. Input seeking after `-i` decodes to the exact frame. */
export function exportFrames(video, timed, directory, prefix) {
  return timed.map((frame) => {
    const file = join(directory, `${prefix}-${frame.label}.png`);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-ss", frame.videoSeconds.toFixed(3), "-frames:v", "1", "-y", file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ffmpeg could not cut ${file} at ${frame.videoSeconds.toFixed(3)} s: ${(result.stderr || result.error?.message || "").trim()}`);
    return { ...frame, file };
  });
}

/**
 * The sidecar next to a recording: the host-clock start, and each frame with its file and time. Written as the
 * recording's `<name>.json`, so a reader can cut other frames from the same mp4 with the same clock.
 */
export function writeSidecar(path, { name, theme, clock, frames }) {
  const body = {
    name,
    theme,
    video: `${name}.mp4`,
    startedAt: new Date(clock.startedAtMs).toISOString(),
    startedAtMs: clock.startedAtMs,
    swipes: clock.swipes.map((swipe) => ({ startedAt: new Date(swipe.startMs).toISOString(), startedAtMs: swipe.startMs, durationMs: swipe.durationMs })),
    frames: frames.map((frame) => ({ label: frame.label, file: basename(frame.file), videoSeconds: Number(frame.videoSeconds.toFixed(3)), wallMs: frame.wallMs })),
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}
