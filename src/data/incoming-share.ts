import type { AttachmentDraft } from "./types";

/** What another app shared into Cohub, as a draft the user reviews before sending. */
export type IncomingShare = { text: string; attachments: AttachmentDraft[] };

/** The resolved payload fields this app reads; see expo-sharing's `ResolvedSharePayload`. */
export type SharedItem = {
  value: string;
  shareType: string;
  mimeType?: string;
  contentUri: string | null;
  contentType?: string | null;
  contentMimeType: string | null;
  originalName: string | null;
  contentSize: number | null;
};

/** Java's `File.toURI()` writes `file:/path`; expo-file-system expects `file:///path`. */
function fileUri(uri: string) {
  return /^file:\/(?!\/)/.test(uri) ? `file://${uri.slice("file:".length)}` : uri;
}

/**
 * Text and links become composer text; files become attachments. Shared content is untrusted and
 * user-chosen, so it only prefills the composer and is never sent without the user.
 */
export function incomingShareFromItems(items: readonly SharedItem[]): IncomingShare | null {
  const text: string[] = [];
  const attachments: AttachmentDraft[] = [];
  items.forEach((item, index) => {
    const isFile = item.contentUri && item.contentType && item.contentType !== "text" && item.contentType !== "website";
    if (!isFile) {
      const value = item.value.trim();
      if (value) text.push(value);
      return;
    }
    const mimeType = item.contentMimeType || item.mimeType || "application/octet-stream";
    attachments.push({
      uri: fileUri(item.contentUri!),
      name: item.originalName?.trim() || `shared-${index + 1}`,
      mimeType,
      size: item.contentSize ?? 0,
    });
  });
  if (text.length === 0 && attachments.length === 0) return null;
  return { text: text.join("\n\n"), attachments };
}

/** The URL expo-sharing opens the app with, as the full URL or the path Expo Router passes. */
export function isShareIntentPath(path: string) {
  return /^(?:[a-z][\w+.-]*:\/\/)?\/?expo-sharing\/?(?:[?#]|$)/i.test(path);
}
