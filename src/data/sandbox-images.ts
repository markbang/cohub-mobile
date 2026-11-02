import type { CohubClient } from "@neta-art/cohub";

/**
 * A URL the device can load for a sandbox image, from one read. Null when the file is missing,
 * unreadable, not typed as an image by the server, or still warming the CDN.
 */
export async function resolveSandboxImage(client: CohubClient, spaceId: string, path: string): Promise<string | null> {
  try {
    const file = await client.space(spaceId).files.read(path);
    if (!("content" in file) || !file.mimeType?.toLowerCase().startsWith("image/")) return null;
    if (file.delivery === "url" && file.url) return file.url;
    if (file.encoding !== "base64" || !file.content) return null;
    return `data:${file.mimeType};base64,${file.content}`;
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
