export type TrendingBoard = "llm" | "generation";
export type TrendingDimension = "spaces" | "users" | "models";

export type TrendingEntry = {
  key: string;
  rank: number;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  /** Null on generation boards, which rank by requests instead of tokens. */
  tokens: number | null;
  cost: number;
  sessions: number;
  requests: number;
};

export function trendingPath(board: TrendingBoard, dimension: TrendingDimension): string {
  return `/api/trending/${board === "generation" ? "generations/" : ""}${dimension}`;
}

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Avatars come from a public endpoint; only HTTPS images are rendered. */
function avatar(profile: unknown): string | null {
  const url = text(record(profile)?.avatarUrl);
  return url?.startsWith("https://") ? url : null;
}

function handle(profile: unknown): string | null {
  const username = text(record(profile)?.username);
  return username ? `@${username}` : null;
}

function entry(dimension: TrendingDimension, board: TrendingBoard, value: unknown, index: number): TrendingEntry {
  const row = record(value);
  if (!row) throw new Error(`Trending ${dimension} row ${index + 1} is not an object.`);
  const metrics = {
    rank: count(row.rank) || index + 1,
    tokens: board === "llm" ? count(row.totalTokens) : null,
    cost: count(row.costTotal),
    sessions: count(row.sessionCount),
    requests: count(row.requestCount),
  };
  if (dimension === "spaces") {
    const id = text(row.spaceId);
    if (!id) throw new Error(`Trending space row ${index + 1} has no spaceId.`);
    return { ...metrics, key: id, title: text(row.spaceName) ?? id.slice(0, 8), subtitle: text(row.userDisplay), avatarUrl: avatar(row.spaceProfile) };
  }
  if (dimension === "users") {
    const id = text(row.userId);
    if (!id) throw new Error(`Trending user row ${index + 1} has no userId.`);
    return { ...metrics, key: id, title: text(row.userDisplay) ?? id.slice(0, 8), subtitle: handle(row.userProfile), avatarUrl: avatar(row.userProfile) };
  }
  const provider = text(row.provider) ?? "unknown";
  const model = text(row.model) ?? "unknown";
  const title = text(row.modelDisplay) ?? model;
  return { ...metrics, key: `${provider}:${model}`, title, subtitle: title.startsWith(`${provider}/`) ? null : provider, avatarUrl: null };
}

export function parseTrendingEntries(board: TrendingBoard, dimension: TrendingDimension, payload: unknown): TrendingEntry[] {
  if (!Array.isArray(payload)) throw new Error(`Trending ${dimension} response is not a list.`);
  return payload.map((value, index) => entry(dimension, board, value, index));
}

export async function fetchTrending(origin: string, board: TrendingBoard, dimension: TrendingDimension, signal?: AbortSignal): Promise<TrendingEntry[]> {
  const response = await fetch(`${origin}${trendingPath(board, dimension)}`, { headers: { Accept: "application/json" }, credentials: "omit", signal });
  if (!response.ok) throw new Error(`Trending is unavailable (HTTP ${response.status}). Pull to refresh to retry.`);
  return parseTrendingEntries(board, dimension, await response.json());
}
