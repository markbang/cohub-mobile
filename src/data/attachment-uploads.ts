import type { AttachmentDraft } from "./types";

export type UploadTarget = { spaceId: string; sessionId?: string };

export type AttachmentUploadState =
  | { status: "uploading"; progress: number }
  | { status: "ready" }
  | { status: "failed"; message: string };

export type UploadedAttachment = { publicUrl: string; mimeType: string };

export type AttachmentUploader = (
  target: UploadTarget,
  attachment: AttachmentDraft,
  options: { signal: AbortSignal; onProgress: (ratio: number) => void },
) => Promise<UploadedAttachment>;

type Entry = {
  promise: Promise<UploadedAttachment>;
  controller: AbortController;
  state: AttachmentUploadState;
  /** A send is waiting on this upload, so removing the chip must not abort it. */
  claimed: boolean;
};

export function attachmentUploadKey(target: UploadTarget, attachment: Pick<AttachmentDraft, "uri">) {
  return `${target.spaceId}\n${target.sessionId ?? "new"}\n${attachment.uri}`;
}

/**
 * Uploads start when a file is attached, so sending does not wait for them and a failure shows on
 * the chip before the user sends. A send claims the upload; a failed one is retried at send.
 * An upload finished for a file that is then removed stays on the server: there is no delete API.
 */
export function createAttachmentUploads(upload: AttachmentUploader) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };

  const start = (target: UploadTarget, attachment: AttachmentDraft): Entry => {
    const key = attachmentUploadKey(target, attachment);
    const controller = new AbortController();
    const entry: Entry = { controller, claimed: false, state: { status: "uploading", progress: 0 }, promise: Promise.resolve(null as never) };
    const update = (state: AttachmentUploadState) => {
      if (entries.get(key) !== entry) return;
      // Progress redraws the chip; whole steps are enough and keep a fast upload from re-rendering per packet.
      if (state.status === "uploading" && entry.state.status === "uploading" && Math.abs(state.progress - entry.state.progress) < 0.05 && state.progress < 1) return;
      entry.state = state;
      notify();
    };
    entry.promise = upload(target, attachment, {
      signal: controller.signal,
      onProgress: (ratio) => update({ status: "uploading", progress: Math.max(0, Math.min(1, ratio)) }),
    }).then((uploaded) => {
      update({ status: "ready" });
      return uploaded;
    }, (error: unknown) => {
      update({ status: "failed", message: error instanceof Error ? error.message : String(error) });
      throw error;
    });
    // A pre-upload nobody awaits yet must not surface as an unhandled rejection.
    entry.promise.catch(() => undefined);
    entries.set(key, entry);
    notify();
    return entry;
  };

  return {
    prepare(target: UploadTarget, attachments: readonly AttachmentDraft[]) {
      for (const attachment of attachments) {
        if (!entries.has(attachmentUploadKey(target, attachment))) start(target, attachment);
      }
    },
    /** The upload a send uses: the prepared one unless it failed, which is retried once here. */
    claim(target: UploadTarget, attachment: AttachmentDraft): Promise<UploadedAttachment> {
      const existing = entries.get(attachmentUploadKey(target, attachment));
      const entry = existing && existing.state.status !== "failed" ? existing : start(target, attachment);
      entry.claimed = true;
      return entry.promise;
    },
    /** Stops an unsent upload that is no longer wanted. */
    release(target: UploadTarget, attachments: readonly AttachmentDraft[]) {
      let changed = false;
      for (const attachment of attachments) {
        const key = attachmentUploadKey(target, attachment);
        const entry = entries.get(key);
        if (!entry || entry.claimed) continue;
        entry.controller.abort();
        entries.delete(key);
        changed = true;
      }
      if (changed) notify();
    },
    /** Drops uploads a send has used, so a later attach of the same file uploads afresh. */
    forget(target: UploadTarget, attachments: readonly AttachmentDraft[]) {
      for (const attachment of attachments) entries.delete(attachmentUploadKey(target, attachment));
      notify();
    },
    /** Lets a failed send retry with the uploads it already finished. */
    unclaim(target: UploadTarget, attachments: readonly AttachmentDraft[]) {
      for (const attachment of attachments) {
        const entry = entries.get(attachmentUploadKey(target, attachment));
        if (entry) entry.claimed = false;
      }
    },
    state(target: UploadTarget, attachment: Pick<AttachmentDraft, "uri">): AttachmentUploadState | null {
      return entries.get(attachmentUploadKey(target, attachment))?.state ?? null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
      notify();
    },
  };
}

export type AttachmentUploads = ReturnType<typeof createAttachmentUploads>;
