import { imageVariantUrl, mediaVariantSize, videoFrameUrl } from "@neta-art/cohub/media";

export type ModelFormat = "glb" | "gltf" | "stl" | "obj";

const MODEL_MIME: Record<string, ModelFormat> = {
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  "model/stl": "stl",
  "model/obj": "obj",
};
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "ogg", "flac", "m4a", "opus"]);

function extension(pathOrUrl: string): string {
  const path = pathOrUrl.split(/[?#]/, 1)[0] ?? "";
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

/** Formats the mobile viewer renders; `.3mf` and `.usdz` are listed by the server but not previewed. */
export function modelFormat(pathOrUrl: string, mimeType?: string | null): ModelFormat | null {
  const byMime = mimeType ? MODEL_MIME[mimeType.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const ext = extension(pathOrUrl);
  return ext === "glb" || ext === "gltf" || ext === "stl" || ext === "obj" ? ext : null;
}

export function isVideoFile(pathOrUrl: string, mimeType?: string | null): boolean {
  return mimeType ? mimeType.toLowerCase().startsWith("video/") : VIDEO_EXTENSIONS.has(extension(pathOrUrl));
}

export function isAudioFile(pathOrUrl: string, mimeType?: string | null): boolean {
  return mimeType ? mimeType.toLowerCase().startsWith("audio/") : AUDIO_EXTENSIONS.has(extension(pathOrUrl));
}

export function imageThumbnailUrl(url: string, points: number, scale: number): string {
  if (!/^https?:/i.test(url)) return url;
  return imageVariantUrl(url, mediaVariantSize(points * scale), "cover") ?? url;
}

export function videoPosterUrl(url: string, points: number, scale: number): string | null {
  if (!/^https?:/i.test(url)) return null;
  return videoFrameUrl(url, mediaVariantSize(points * scale));
}
