import { File as ExpoFile, Paths, UploadType } from "expo-file-system";
import { pastedTextFileName } from "./composer-paste";
import type { AttachmentDraft } from "./types";

export type AttachmentUpload = { method: "POST" | "PUT" | "PATCH"; headers: Record<string, string>; signal: AbortSignal; onProgress: (ratio: number) => void };

/**
 * A picked file, sized and ready to send. expo-file-system uploads natively: the SDK's fetch upload can fail
 * with "dynamic value has been recycled" on Android.
 */
export async function attachmentFile(uri: string) {
  const file = new ExpoFile(uri);
  return {
    size: file.size,
    type: file.type,
    upload: async (url: string, { method, headers, signal, onProgress }: AttachmentUpload) => (await file.upload(url, {
      // `File.upload` defaults to POST; the presigned URL is signed for the method the plan reports.
      httpMethod: method,
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      signal,
      onProgress: ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0),
    })).status,
  };
}

/** Writes a long paste to the cache so it attaches like a picked file; the attachment keeps the paste's name. */
export async function pastedTextAttachment(text: string): Promise<AttachmentDraft> {
  const { name, mimeType } = pastedTextFileName(text);
  const file = new ExpoFile(Paths.cache, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  file.create({ overwrite: true, intermediates: true });
  await file.write(text);
  return { uri: file.uri, name, mimeType, size: file.size };
}
