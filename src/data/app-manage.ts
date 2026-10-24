import type { AppMeta, AppPromotionRecord, AppViewStatsResponse, Permission } from "@neta-art/cohub";

export const APP_HIDE_COHUB_BAR_FEATURE = "work.publish.hide_cohub_bar";

export const APP_SCOPES = [
  "space.view",
  "session.view",
  "file.view",
  "file.edit",
  "taskrun.view",
  "session.prompt.readonly",
  "session.prompt.fullaccess",
  "command.execute",
] as const satisfies readonly Permission[];

export function hidesCohubBar(meta: AppMeta | null | undefined): boolean {
  const presentation = meta?.presentation;
  return Boolean(presentation && typeof presentation === "object" && presentation.hideCohubBar === true);
}

export function withCohubBar(meta: AppMeta | null | undefined, hide: boolean): AppMeta | null {
  const next: AppMeta = { ...(meta ?? {}) };
  const presentation: Record<string, unknown> = { ...(next.presentation ?? {}) };
  if (hide) presentation.hideCohubBar = true;
  else delete presentation.hideCohubBar;
  if (Object.keys(presentation).length) next.presentation = presentation;
  else delete next.presentation;
  return Object.keys(next).length ? next : null;
}

export function promotionUrl(publicUrl: string, promotion: Pick<AppPromotionRecord, "id" | "parameters">): string {
  const url = new URL(publicUrl);
  url.searchParams.set("cohub_campaign", promotion.id);
  for (const [key, value] of Object.entries(promotion.parameters)) url.searchParams.set(key, value);
  return url.toString();
}

export function dailyViews(stats: Pick<AppViewStatsResponse, "daily">, days = 30, now = Date.now()): { date: string; views: number }[] {
  const byDate = new Map(stats.daily.map((entry) => [entry.date.slice(0, 10), entry.views]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - 1 - index) * 86_400_000).toISOString().slice(0, 10);
    return { date, views: byDate.get(date) ?? 0 };
  });
}
