import type { ContentBlock, MessageRecord } from "@neta-art/cohub";
import type { Translate } from "../i18n/core";
import { formatElapsed } from "./chat-format";

export type MeasuredMessage = { id: string; revision: string };

/** A reply shows its answer; the thinking behind it folds into the Turn's steps. */
export function answerBlocks(content: readonly ContentBlock[] | null | undefined): ContentBlock[] {
  return (content ?? []).filter((block) => block.type !== "thinking");
}

export function thinkingBlocks(content: readonly ContentBlock[] | null | undefined): ContentBlock[] {
  return (content ?? []).filter((block) => block.type === "thinking" && block.thinking.trim().length > 0);
}

/** A Turn's process summary as `Meta` items (steps, tools, duration), with the sentence a screen reader speaks. */
export function turnProcessSummary(t: Translate, input: { hasSteps: boolean; steps: number | null; tools: number | null; durationMs: number | null }) {
  const duration = input.durationMs != null ? formatElapsed(input.durationMs) : null;
  const items: { icon: "list-tree" | "wrench" | "clock" | "brain"; value: string }[] = [];
  if (!input.hasSteps) {
    const value = duration ? t("turn.thoughtFor", { duration }) : t("turn.thinking");
    return { items: [{ icon: "brain" as const, value }], label: value };
  }
  if (input.steps === null) items.push({ icon: "list-tree", value: t("turn.executionDetails") });
  else {
    items.push({ icon: "list-tree", value: String(input.steps) });
    if (input.tools) items.push({ icon: "wrench", value: String(input.tools) });
  }
  if (duration) items.push({ icon: "clock", value: duration });
  const label = input.steps === null ? t("turn.executionDetails") : t("turn.steps", { steps: input.steps, tools: input.tools ?? 0 });
  return { items, label: duration ? `${label} · ${duration}` : label };
}

/** A live Turn's intermediate messages as one step list, and how many tools they called. */
export function streamingSteps(messages: readonly { content: readonly ContentBlock[]; text?: string | null }[]) {
  let tools = 0;
  const content: ContentBlock[] = [];
  for (const message of messages) {
    for (const block of message.content) if (block.type === "tool_use") tools += 1;
    if (message.content.length) content.push(...message.content);
    else if (message.text) content.push({ type: "text", text: message.text });
  }
  return { content, tools };
}

/** Keep a growing reply in its user's normal-flow row, not a separately positioned footer.
 * Before that turn's history arrives, the live reply remains after the loaded tail; a window paged
 * away from the tail does not hold the running turn, so there it has no row at all. */
export function liveReplyAnchor(messages: readonly MessageRecord[], turnId: string | null, detached: boolean): string | null {
  const owner = turnId === null
    ? messages.findLast((message) => message.role === "user" && message.meta?.optimistic === true)
    : messages.find((message) => message.role === "user" && message.meta?.turnId === turnId);
  if (owner) return owner.id;
  return detached ? null : messages.at(-1)?.id ?? null;
}

/**
 * Rows keep their renderItem closure across prepends and window jumps (messages is
 * deliberately outside extraData), so onLayout can arrive after the array changed.
 * The native event dispatch must never see a throw — an uncaught error in a native
 * event handler is fatal on the new architecture and freezes the screen — so stale
 * indexes, recycled rows, and unsized layouts are skipped instead of asserted.
 */
export function rowHeightMeasurement(entries: readonly MeasuredMessage[], index: number, id: string, height: number): { message: MeasuredMessage; height: number } | null {
  const entry = Number.isInteger(index) && index >= 0 ? entries[index] : undefined;
  if (!entry || entry.id !== id) return null;
  if (!Number.isFinite(height) || height <= 0) return null;
  return { message: entry, height };
}

// Estimates are only for scroll recovery, never FlatList's exact getItemLayout contract.
export class MessageMeasurements {
  private entries = new Map<string, { revision: string; height: number }>();
  private environment = "";

  configure(environment: string, messages: readonly MeasuredMessage[]): void {
    if (environment !== this.environment) {
      this.entries.clear();
      this.environment = environment;
    }
    const revisions = new Map(messages.map((message) => [message.id, message.revision]));
    for (const [id, entry] of this.entries) {
      if (revisions.get(id) !== entry.revision) this.entries.delete(id);
    }
  }

  measure(message: MeasuredMessage, height: number): void {
    if (!Number.isFinite(height) || height <= 0) throw new Error("Message height must be positive and finite.");
    this.entries.set(message.id, { revision: message.revision, height });
  }

  estimateOffset(messages: readonly MeasuredMessage[], index: number, averageHeight: number): number {
    let offset = 0;
    for (const message of messages.slice(0, index)) {
      const entry = this.entries.get(message.id);
      offset += entry?.revision === message.revision ? entry.height : Math.max(averageHeight, 1);
    }
    return offset;
  }
}

// Generation events contain complete snapshots, so intermediate snapshots can be coalesced.
export function createStreamBatch<T>(publish: (value: T) => void) {
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  const flush = () => {
    const next = pending;
    cancel();
    if (next) publish(next.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (timer === null) timer = setTimeout(flush, 32);
    },
    flush,
    cancel,
  };
}

export type ViewportReference = { kind: "media" | "file" | "board" | "app" | "port"; label: string };

const lastSegment = (value: string | undefined) => value?.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";

/**
 * What the sender was looking at when they wrote: images, files, Boards, Apps, and ports, which clients send
 * as one text block for the Agent. `null` for any other block, or one whose references cannot be read, so
 * it shows as text.
 */
export function viewportReferences(block: ContentBlock): ViewportReference[] | null {
  if (block.type !== "text" || block._meta?.attachmentKind !== "viewport" || !Array.isArray(block._meta.viewports)) return null;
  const references = block._meta.viewports.flatMap((value: unknown): ViewportReference[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const string = (key: string) => (typeof item[key] === "string" ? (item[key] as string).trim() : "");
    switch (item.kind) {
      case "media": return [{ kind: "media", label: string("title") || lastSegment(string("path") || string("url")) || "image" }];
      case "file":
      case "board": return string("path") ? [{ kind: item.kind, label: lastSegment(string("path")) }] : [];
      case "app": return string("label") ? [{ kind: "app", label: string("label") }] : [];
      case "port": return item.port !== undefined ? [{ kind: "port", label: `:${String(item.port)}` }] : [];
      default: return [];
    }
  });
  return references.length > 0 ? references : null;
}

export function viewportReferenceIcon(kind: ViewportReference["kind"]): "images" | "file-text" | "layers" | "box" | "globe" {
  return kind === "media" ? "images" : kind === "file" ? "file-text" : kind === "board" ? "layers" : kind === "app" ? "box" : "globe";
}
