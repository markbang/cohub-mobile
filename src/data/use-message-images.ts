import type { CohubClient } from "@neta-art/cohub";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { sandboxImageQuery } from "./sandbox-images";

const urlsOf = (results: { data?: string | null }[]) => results.map((result) => result.data ?? null);

/** Resolved sandbox images by path; paths that did not resolve are absent. */
export function useSandboxImageUrls(client: CohubClient | null, spaceId: string | null, paths: readonly string[]): ReadonlyMap<string, string> {
  const urls = useQueries({
    queries: paths.map((path) => sandboxImageQuery(client, spaceId, path)),
    combine: urlsOf,
  });
  const key = paths.join("\n");
  const signature = urls.join("\n");
  return useMemo(() => {
    const map = new Map<string, string>();
    paths.forEach((path, index) => {
      const url = urls[index];
      if (url) map.set(path, url);
    });
    return map;
    // The paths and URLs are summarized by `key` and `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, signature]);
}
