import { File as ExpoFile, UploadType } from "expo-file-system";

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
