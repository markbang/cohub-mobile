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
 * The recording's start and the swipes after it, in milliseconds on the host clock, from the command list that starts
 * the recording. Throws when no list starts it or a stamp is missing, and names what it found.
 */
export function recordingClock(commandLists, recording) {
  const lists = commandLists.filter((commands) => commands.some((entry) => /^startrecording/i.test(commandName(entry))));
  if (lists.length === 0) throw new Error(`No Maestro commands JSON starts a recording as ${recording}. Command names seen: ${[...new Set(commandLists.flat().map(commandName))].join(", ")}.`);
  const commands = lists[0];
  const names = commands.map(commandName);
  const start = names.findIndex((name) => /^startrecording/i.test(name));
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
 * Where each frame sits in the video, in seconds. A frame is `ms` after the start of its swipe on the host clock. The
 * video's zero is not the recording's start: Maestro's startRecording stamp comes earlier, by the time the recorder
 * takes to start. So `onset` anchors the clock to the video: the swipe `onset.swipe` begins at `onset.seconds` in it,
 * where the video first changes.
 */
export function frameTimes(clock, frames, onset) {
  const anchor = clock.swipes[onset.swipe];
  if (!anchor) throw new Error(`The onset swipe ${onset.swipe} is missing from the recording, which has ${clock.swipes.length} swipes.`);
  return frames.map((frame) => {
    const swipe = clock.swipes[frame.swipe];
    if (!swipe) throw new Error(`Frame "${frame.label}" wants swipe ${frame.swipe}, but the recording has ${clock.swipes.length}.`);
    const wallMs = swipe.startMs + frame.ms;
    return { label: frame.label, wallMs, videoSeconds: onset.seconds + (wallMs - anchor.startMs) / 1000 };
  });
}

/** The video's first change, in seconds: where the recording's content first moves. */
export function motionOnset(video) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-i", video, "-vf", "freezedetect=n=0.003:d=0.2", "-map", "0:v", "-f", "null", "-"], { encoding: "utf8" });
  const match = /freeze_start: 0(?:\.0+)?\b[\s\S]*?freeze_end: ([\d.]+)/.exec(result.stderr ?? "");
  if (!match) throw new Error(`No still start found in ${video}; the recording may already be moving at its first frame.`);
  return Number(match[1]);
}

/**
 * The command lists Maestro wrote under a flow's test output: one per (sub)flow, each named `commands*.json`. The
 * recording's list is the one that starts it, so a caller reads them all.
 */
export function commandLists(root) {
  const found = listJson(root).filter((path) => basename(path).startsWith("commands"));
  if (found.length === 0) throw new Error(`No Maestro commands JSON under ${root}.`);
  return found.map((path) => JSON.parse(readFileSync(path, "utf8")));
}

function listJson(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return listJson(path);
    return entry.endsWith(".json") ? [path] : [];
  });
}

/**
 * The time of the video's last frame. The recorder stores a frame only when the screen changes, so a still that follows
 * the last change has no frame of its own: the container runs on past this time, showing that last frame.
 */
export function lastFrameSeconds(video) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", video], { encoding: "utf8" });
  const last = lastTimeIn(result.stdout ?? "");
  if (last === null) throw new Error(`ffprobe found no video frames in ${video}: ${(result.stderr || result.error?.message || "").trim()}`);
  return last;
}

/** The last time in ffprobe's one-time-per-line output, or null when there is none. A trailing newline is no time. */
export function lastTimeIn(output) {
  const times = output.split("\n").map((line) => line.trim().replace(/,$/, "")).filter((line) => line !== "").map(Number).filter(Number.isFinite);
  return times.length === 0 ? null : times[times.length - 1];
}

/** A frame past the last stored frame shows that frame: the screen is still from there on. */
export function clampToLastFrame(timed, lastSeconds) {
  return timed.map((frame) => ({ ...frame, videoSeconds: Math.min(frame.videoSeconds, lastSeconds) }));
}

/** One PNG per frame, taken at its time in the video, or at the last frame when its time is past the end. */
export function exportFrames(video, timed, directory, prefix) {
  return clampToLastFrame(timed, lastFrameSeconds(video)).map((frame) => {
    const file = join(directory, `${prefix}-${frame.label}.png`);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-ss", frame.videoSeconds.toFixed(3), "-frames:v", "1", "-y", file], { encoding: "utf8" });
    if (result.status !== 0 || !existsSync(file)) throw new Error(`ffmpeg could not cut ${file} at ${frame.videoSeconds.toFixed(3)} s: ${(result.stderr || result.error?.message || "no frame at that time").trim()}`);
    return { ...frame, file };
  });
}

/**
 * The sidecar next to a recording: the host-clock start, and each frame with its file and time. Written as the
 * recording's `<name>.json`, so a reader can cut other frames from the same mp4 with the same clock.
 */
export function writeSidecar(path, { name, theme, clock, onset, frames }) {
  const body = {
    name,
    theme,
    video: `${name}.mp4`,
    startedAt: new Date(clock.startedAtMs).toISOString(),
    startedAtMs: clock.startedAtMs,
    onset: { swipe: onset.swipe, videoSeconds: onset.seconds },
    swipes: clock.swipes.map((swipe) => ({ startedAt: new Date(swipe.startMs).toISOString(), startedAtMs: swipe.startMs, durationMs: swipe.durationMs })),
    frames: frames.map((frame) => ({ label: frame.label, file: basename(frame.file), videoSeconds: Number(frame.videoSeconds.toFixed(3)), wallMs: frame.wallMs })),
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}
