export type ComposerActionStateInput = {
  text: string;
  hasAttachment: boolean;
  disabled: boolean;
  sending: boolean;
  running: boolean;
  hasStopHandler: boolean;
  sendFeedback?: "idle" | "success";
};

export type ComposerSendGlyph = "stop" | "sent" | "sending" | "send";

export type ComposerActionState = {
  blocked: boolean;
  hasDraft: boolean;
  canSend: boolean;
  canStop: boolean;
  /** Sending while a turn runs queues a follow-up rather than starting a turn. */
  queues: boolean;
  glyph: ComposerSendGlyph;
};

export function getComposerActionState(input: ComposerActionStateInput): ComposerActionState {
  const blocked = input.disabled || input.sending;
  const hasDraft = input.text.trim().length > 0 || input.hasAttachment;
  const canSend = hasDraft && !blocked;
  const canStop = input.running && !blocked && !hasDraft && input.hasStopHandler;
  return {
    blocked,
    hasDraft,
    canSend,
    canStop,
    queues: canSend && input.running,
    glyph: canStop ? "stop" : input.sendFeedback === "success" ? "sent" : input.sending ? "sending" : "send",
  };
}
