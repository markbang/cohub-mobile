import type { TurnSpeech } from "@neta-art/cohub";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useCallback, useSyncExternalStore } from "react";
import { mergeTurnSpeech, turnSpeechStep, type TurnSpeechPhase } from "@/src/data/turn-speech";

/** Segments render as background tasks; until each settles the player asks again, as the web does without realtime. */
const RECHECK_MS = 4_000;

type State = { turnId: string | null; phase: TurnSpeechPhase };

let state: State = { turnId: null, phase: "idle" };
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;
let speak: (() => Promise<TurnSpeech>) | null = null;
let speech: TurnSpeech | null = null;
let index = 0;
let run = 0;
let recheck: ReturnType<typeof setTimeout> | undefined;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function audio(): AudioPlayer {
  if (player) return player;
  player = createAudioPlayer(null);
  player.addListener("playbackStatusUpdate", (status) => {
    if (!status.didJustFinish || state.phase !== "playing") return;
    index += 1;
    advance();
  });
  return player;
}

function fail() {
  clearTimeout(recheck);
  player?.pause();
  set({ phase: "error" });
}

function advance() {
  if (!speech) return;
  const step = turnSpeechStep(speech, index);
  if (step.kind === "done") return stopTurnSpeech();
  if (step.kind === "fail") return fail();
  if (step.kind === "wait") {
    set({ phase: "loading" });
    clearTimeout(recheck);
    const current = run;
    recheck = setTimeout(() => { if (current === run) void request(current); }, RECHECK_MS);
    return;
  }
  const target = audio();
  target.replace({ uri: step.url });
  target.play();
  set({ phase: "playing" });
}

async function request(current: number) {
  if (!speak) return;
  try {
    const next = await speak();
    if (current !== run) return;
    speech = mergeTurnSpeech(speech, next);
    if (state.phase === "loading") advance();
  } catch {
    if (current === run) fail();
  }
}

export function stopTurnSpeech() {
  run += 1;
  clearTimeout(recheck);
  player?.pause();
  speak = null;
  speech = null;
  index = 0;
  set({ turnId: null, phase: "idle" });
}

/**
 * Reads a reply aloud, or pauses, resumes, or cancels the one already reading. `render` renders the Turn's
 * missing segments with the viewer's voice and returns what is stored; asking again is safe.
 */
export function toggleTurnSpeech(turnId: string, render: () => Promise<TurnSpeech>) {
  if (state.turnId === turnId && state.phase !== "error") {
    if (state.phase === "playing") {
      player?.pause();
      set({ phase: "paused" });
    } else if (state.phase === "paused") {
      player?.play();
      set({ phase: "playing" });
    } else stopTurnSpeech();
    return;
  }
  stopTurnSpeech();
  speak = render;
  set({ turnId, phase: "loading" });
  void request(run);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTurnSpeechPhase(turnId: string | null | undefined): TurnSpeechPhase {
  const read = useCallback(() => (turnId && state.turnId === turnId ? state.phase : "idle"), [turnId]);
  return useSyncExternalStore(subscribe, read, read);
}

/** The Turn reading aloud now, for screens that draw every reply's control from one place. */
export function useTurnSpeechState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
