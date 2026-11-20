import type { SessionTurnRecord, TurnSpeech } from "@neta-art/cohub";

export type TurnSpeechPhase = "idle" | "loading" | "playing" | "paused" | "error";

/** What the player does at segment `index`: wait for it to render, play it, finish, or give up. */
export type TurnSpeechStep = { kind: "wait" } | { kind: "play"; url: string } | { kind: "done" } | { kind: "fail" };

export function turnSpeechStep(speech: TurnSpeech, index: number): TurnSpeechStep {
  const segment = speech.segments[index];
  if (!segment) return { kind: "done" };
  if (segment.status === "pending") return { kind: "wait" };
  return segment.status === "failed" || !segment.url ? { kind: "fail" } : { kind: "play", url: segment.url };
}

/** Responses race one another: a settled segment never returns to pending. */
export function mergeTurnSpeech(current: TurnSpeech | null, incoming: TurnSpeech): TurnSpeech {
  if (current?.voice !== incoming.voice) return incoming;
  return {
    ...incoming,
    segments: incoming.segments.map((segment, index) => {
      const known = current.segments[index];
      return segment.status === "pending" && known?.taskId === segment.taskId && known.status !== "pending" ? known : segment;
    }),
  };
}

/** Mirrors the web: only a finished Agent reply with text can be read aloud. */
export function isSpeakableTurn(turn: Pick<SessionTurnRecord, "status" | "executionKind" | "assistantText"> | null | undefined): boolean {
  return Boolean(turn && turn.status === "completed" && (turn.executionKind ?? "agent") === "agent" && turn.assistantText?.trim());
}

/** The read-aloud control's glyph and label by phase, shared by both timelines. */
export function speechIcon(phase: TurnSpeechPhase): "volume" | "pause" | "play" | "alert" {
  return phase === "playing" ? "pause" : phase === "paused" ? "play" : phase === "error" ? "alert" : "volume";
}

export function speechLabelKey(phase: TurnSpeechPhase) {
  return phase === "loading" ? "chat.readAloud.preparing" : phase === "playing" ? "chat.readAloud.pause" : phase === "paused" ? "chat.readAloud.resume" : phase === "error" ? "chat.readAloud.failed" : "chat.readAloud";
}
