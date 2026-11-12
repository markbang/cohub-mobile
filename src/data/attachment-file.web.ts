import type { AttachmentUpload } from "./attachment-file";

/** In the browser a picked file is a blob URL; XHR, unlike fetch, reports upload progress. */
export async function attachmentFile(uri: string) {
  const blob = await (await fetch(uri)).blob();
  return {
    size: blob.size,
    type: blob.type,
    upload: (url: string, { method, headers, signal, onProgress }: AttachmentUpload) => new Promise<number>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, url);
      for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
      request.upload.onprogress = (event) => onProgress(event.lengthComputable && event.total > 0 ? event.loaded / event.total : 0);
      request.onload = () => resolve(request.status);
      request.onerror = () => reject(new Error("File upload failed: network error"));
      signal.addEventListener("abort", () => {
        request.abort();
        reject(new DOMException("The upload was cancelled.", "AbortError"));
      }, { once: true });
      request.send(blob);
    }),
  };
}
