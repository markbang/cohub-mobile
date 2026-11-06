import type { MessageRecord } from "@neta-art/cohub";
import type { AttachmentDraft } from "@/src/data/types";

export type SendBubbleRect = { x: number; y: number; width: number; height: number };
export type SendBubbleSource = SendBubbleRect & { scrollY: number };
export type SendBubbleTransition = { message: MessageRecord; text: string; attachments: AttachmentDraft[]; source: SendBubbleSource; destination: "bubble" | "queue" };

type Measurable = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

/**
 * Measures the composer text (or attachment strip) the bubble flies from. The callback fires as soon
 * as both frames are known, synchronously where the renderer measures synchronously, so a send never
 * waits on it; `null` means there is nothing valid to fly from.
 */
export function measureSendBubbleSource(input: Measurable | null, root: Measurable | null, scrollY: number, onResult: (source: SendBubbleSource | null) => void) {
  if (!input || !root) {
    onResult(null);
    return;
  }
  let field: SendBubbleRect | null = null;
  let viewport: SendBubbleRect | null = null;
  const done = () => {
    if (!field || !viewport) return;
    if (field.width <= 0 || field.height <= 0 || viewport.width <= 0 || viewport.height <= 0) onResult(null);
    else onResult({ x: field.x - viewport.x, y: field.y - viewport.y, width: field.width, height: field.height, scrollY });
  };
  input.measureInWindow((x, y, width, height) => { field = { x, y, width, height }; done(); });
  root.measureInWindow((x, y, width, height) => { viewport = { x, y, width, height }; done(); });
}

/**
 * Pairs one send's measurement with its bubble. The flight starts only while the bubble has not been
 * on screen yet: a measurement that comes after the bubble's first frame, comes back invalid, or
 * belongs to a send that was superseded is dropped and the bubble just stays where it is.
 */
export function createSendFlight(start: (message: MessageRecord, source: SendBubbleSource) => void) {
  let message: MessageRecord | null = null;
  let source: SendBubbleSource | null = null;
  let open = true;
  const tryStart = () => {
    if (!open || !message || !source) return;
    open = false;
    start(message, source);
  };
  return {
    measured(value: SendBubbleSource | null) {
      if (value === null) open = false;
      source = value;
      tryStart();
    },
    inserted(value: MessageRecord) {
      message = value;
      tryStart();
    },
    expire() {
      open = false;
    },
  };
}

export function isSendBubbleMessage(message: MessageRecord, sent: MessageRecord): boolean {
  if (message.role !== "user") return false;
  // Before the session check: a new Chat's first bubble has no session id until the server's Turn takes its place.
  const clientId = sent.meta?.clientMessageId;
  if (typeof clientId === "string" && typeof message.meta?.clientMessageId === "string") return message.meta.clientMessageId === clientId;
  if (message.sessionId !== sent.sessionId) return false;
  // Turn projections replace optimistic records, but retain the turn/role slot.
  return message.id === sent.id || (typeof sent.meta?.turnSequence === "number" && message.meta?.turnSequence === sent.meta.turnSequence);
}

export function interpolateSendBubbleRect(source: SendBubbleRect, target: SendBubbleRect, progress: number): SendBubbleRect {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  return {
    x: source.x + (target.x - source.x) * p,
    y: source.y + (target.y - source.y) * p,
    width: source.width + (target.width - source.width) * p,
    height: source.height + (target.height - source.height) * p,
  };
}
