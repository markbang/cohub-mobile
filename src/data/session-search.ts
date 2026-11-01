import type { CohubClient, GlobalSearchResult, GlobalSearchType } from "@neta-art/cohub";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

export type SessionNavigationTarget = {
  turn?: number;
  turnId?: string;
};

export type RemoteSessionSearchHit = {
  sessionId: string;
  spaceId: string;
  title: string;
  preview: string | null;
  spaceName: string | null;
  spaceAvatarUrl: string | null;
  turnSequence: number | null;
  turnId: string | null;
  updatedAt: string | null;
  score: number;
};

export type RemoteSpaceSearchHit = {
  spaceId: string;
  title: string;
  description: string | null;
  avatarUrl: string | null;
  updatedAt: string | null;
  score: number;
};

type RemoteSearchState = {
  query: string;
  sessions: RemoteSessionSearchHit[];
  spaces: RemoteSpaceSearchHit[];
  loading: boolean;
  error: string | null;
  degraded: boolean;
};

type RemoteSearchOptions = {
  enabled?: boolean;
  limit?: number;
  spaceId?: string;
  types?: readonly GlobalSearchType[];
};

const DEFAULT_SEARCH_TYPES: readonly GlobalSearchType[] = ["chat"];
const SEARCH_DEBOUNCE_MS = 180;
const EMPTY_STATE: RemoteSearchState = {
  query: "",
  sessions: [],
  spaces: [],
  loading: false,
  error: null,
  degraded: false,
};

export function normalizeSearchQuery(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function text(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function latestTimestamp(current: string | null, incoming: string | null) {
  if (!current) return incoming;
  if (!incoming) return current;
  const currentTime = Date.parse(current);
  const incomingTime = Date.parse(incoming);
  if (!Number.isFinite(currentTime)) return incoming;
  if (!Number.isFinite(incomingTime)) return current;
  return incomingTime > currentTime ? incoming : current;
}

export function mapRemoteSearchResults(items: GlobalSearchResult[]) {
  const sessions = new Map<string, RemoteSessionSearchHit>();
  const spaces = new Map<string, RemoteSpaceSearchHit>();

  for (const item of items) {
    if (item.type === "space") {
      const title = text(item.title) ?? "Untitled Space";
      const current = spaces.get(item.spaceId);
      spaces.set(item.spaceId, current ? {
        ...current,
        title,
        description: text(item.excerpt) ?? current.description,
        avatarUrl: item.spaceProfile?.avatarUrl ?? current.avatarUrl,
        updatedAt: latestTimestamp(current.updatedAt, item.updatedAt),
        score: Math.max(current.score, item.score),
      } : {
        spaceId: item.spaceId,
        title,
        description: text(item.excerpt),
        avatarUrl: item.spaceProfile?.avatarUrl ?? null,
        updatedAt: item.updatedAt,
        score: item.score,
      });
      continue;
    }
    if (item.type !== "chat") continue;

    // A chat result is one session; `hit` is its best-matching user message, if any.
    const sessionId = item.sessionId ?? item.id;
    const current = sessions.get(sessionId);
    if (current && current.score >= item.score) continue;
    sessions.set(sessionId, {
      sessionId,
      spaceId: item.spaceId,
      title: text(item.title) ?? "Untitled Chat",
      preview: text(item.hit?.excerpt) ?? text(item.excerpt),
      spaceName: text(item.spaceName),
      spaceAvatarUrl: item.spaceProfile?.avatarUrl ?? null,
      turnSequence: item.hit?.sequence ?? null,
      turnId: item.hit?.turnId ?? null,
      updatedAt: item.updatedAt,
      score: item.score,
    });
  }

  return {
    sessions: [...sessions.values()].sort((left, right) => right.score - left.score),
    spaces: [...spaces.values()].sort((left, right) => right.score - left.score),
  };
}

function isGlobalSearchType(value: string): value is GlobalSearchType {
  return value === "chat" || value === "space" || value === "label";
}

export function useRemoteSearch(
  client: CohubClient | null,
  query: string,
  options: RemoteSearchOptions = {},
) {
  const enabled = options.enabled ?? true;
  const limit = options.limit ?? 50;
  const spaceId = options.spaceId ?? null;
  const typesKey = (options.types ?? DEFAULT_SEARCH_TYPES).join(",");
  const normalizedQuery = normalizeSearchQuery(query);
  const shouldSearch = enabled && client !== null && normalizedQuery.length >= 2;
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(normalizedQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalizedQuery]);
  const settled = debouncedQuery === normalizedQuery;
  const search = useQuery({
    queryKey: ["search", debouncedQuery, limit, typesKey, spaceId],
    queryFn: async () => {
      const response = await client!.search.query({
        q: debouncedQuery,
        limit,
        types: typesKey.split(",").filter(isGlobalSearchType),
        ...(spaceId ? { spaceId } : {}),
      });
      return { ...mapRemoteSearchResults(response.items ?? []), degraded: response.degraded === true };
    },
    enabled: shouldSearch && settled,
    staleTime: 30_000,
    retry: 0,
  });
  const refetch = search.refetch;
  const retry = useCallback(() => { void refetch(); }, [refetch]);

  if (!shouldSearch) return { ...EMPTY_STATE, normalizedQuery, retry };
  // Typing ahead of the debounce shows a loading state, never the previous query's hits.
  const data = settled ? search.data : undefined;
  const error = settled && search.error ? search.error.message || "Search is unavailable" : null;
  return {
    query: normalizedQuery,
    sessions: data?.sessions ?? EMPTY_STATE.sessions,
    spaces: data?.spaces ?? EMPTY_STATE.spaces,
    loading: !data && !error,
    error,
    degraded: data?.degraded ?? false,
    normalizedQuery,
    retry,
  };
}
