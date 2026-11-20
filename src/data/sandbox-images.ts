import type { CohubClient } from "@neta-art/cohub";

const PATHS_KEPT = 500;
/** The workspace path behind each loaded image URL, so asking about one names the file rather than a signed URL. */
const pathsByUrl = new Map<string, string>();

export function sandboxImagePath(url: string): string | null {
  return pathsByUrl.get(url) ?? null;
}

function rememberPath(url: string, path: string) {
  pathsByUrl.delete(url);
  pathsByUrl.set(url, path);
  if (pathsByUrl.size > PATHS_KEPT) pathsByUrl.delete(pathsByUrl.keys().next().value as string);
}

/**
 * A URL the device can load for a sandbox image, from one read. Null when the file is missing,
 * unreadable, not typed as an image by the server, or still warming the CDN.
 */
export async function resolveSandboxImage(client: CohubClient, spaceId: string, path: string): Promise<string | null> {
  try {
    const file = await client.space(spaceId).files.read(path);
    if (!("content" in file) || !file.mimeType?.toLowerCase().startsWith("image/")) return null;
    if (file.delivery === "url" && file.url) {
      rememberPath(file.url, path);
      return file.url;
    }
    if (file.encoding !== "base64" || !file.content) return null;
    const url = `data:${file.mimeType};base64,${file.content}`;
    rememberPath(url, path);
    return url;
  } catch {
    return null;
  }
}

/**
 * Query options for one referenced image. Every outcome is final for the signed-in session:
 * `static` also keeps the app's blanket invalidations (foreground, reconnect, sends) from reading
 * again, and the result outlives the Chat; the per-user query client is dropped on sign-out.
 */
export function sandboxImageQuery(client: CohubClient | null, spaceId: string | null, path: string) {
  return {
    queryKey: [`space:${spaceId}:message-image:${path}`],
    queryFn: () => resolveSandboxImage(client!, spaceId!, path),
    enabled: Boolean(client && spaceId),
    staleTime: "static" as const,
    gcTime: Infinity,
    retry: false,
  };
}
