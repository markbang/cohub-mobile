import type { ViewportMediaContext } from "@neta-art/cohub";
import { sandboxImagePath } from "./sandbox-images";

/** An image asked about, with the URI the device draws it from. */
export type MediaAsk = { context: ViewportMediaContext; thumbnail: string };

type Target = { id: number; receive: (ask: MediaAsk) => void };

const targets: Target[] = [];
let nextId = 0;

/**
 * A Chat composer that takes the images the viewer is asked about. The viewer opens over the Chat it came
 * from, so the most recently mounted composer is the one underneath.
 */
export function registerMediaAskTarget(receive: (ask: MediaAsk) => void): () => void {
  const target = { id: nextId += 1, receive };
  targets.push(target);
  return () => {
    const index = targets.findIndex((item) => item.id === target.id);
    if (index !== -1) targets.splice(index, 1);
  };
}

export function hasMediaAskTarget(): boolean {
  return targets.length > 0;
}

/**
 * The reference an Agent can open: a workspace image by its path, or a web image by URL. An image that
 * exists only on this device (an inline data URI with no known path) cannot be referenced.
 */
export function mediaAskContext(uri: string): ViewportMediaContext | null {
  const path = sandboxImagePath(uri);
  if (path) return { kind: "media", path };
  return /^https?:\/\//i.test(uri) ? { kind: "media", url: uri } : null;
}

export function askAboutMedia(ask: MediaAsk): boolean {
  const target = targets.at(-1);
  if (!target) return false;
  target.receive(ask);
  return true;
}

export function sameMediaContext(left: ViewportMediaContext, right: ViewportMediaContext): boolean {
  return (left.path ?? left.url) === (right.path ?? right.url);
}

export function mediaContextName(context: ViewportMediaContext): string {
  return context.title?.trim() || (context.path ?? context.url ?? "").split(/[?#]/)[0]?.split("/").filter(Boolean).pop() || "image";
}
