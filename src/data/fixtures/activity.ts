import type { BillingCreditStatus, BillingSubscriptionHistoryList, SpaceUsageHourlyStat, UserActivityResponse } from "@neta-art/cohub";

const DAY_MS = 86_400_000;
/** The heatmap's span: thirteen weeks, as the Activity screen asks the server for. */
const HEATMAP_DAYS = 91;
const TOKENS_PER_REQUEST = 12_000;
const WEEKDAY_LOAD = [0.25, 0.9, 1, 0.8, 0.95, 0.7, 0.2];

export const FIXTURE_CREDITS: BillingCreditStatus = {
  netUsd: 42.5,
  globalAvailableUsd: null,
  groups: [{ key: "never", remainingAmountUsd: 42.5, grants: [] }],
};

export const FIXTURE_SUBSCRIPTIONS: BillingSubscriptionHistoryList = {
  userId: "fixture",
  billing: { provider: "talesofai", configured: true },
  page: 1,
  limit: 20,
  items: [],
  pagination: { hasMore: false, nextPage: null },
};

/** One bucket per day, noon local time, with a varied load: busy weekdays, quiet days and a few with errors. */
function hourlyUsage(now: number): SpaceUsageHourlyStat[] {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const buckets: SpaceUsageHourlyStat[] = [];
  for (let ago = HEATMAP_DAYS - 1; ago >= 0; ago -= 1) {
    const day = new Date(today.getTime() - ago * DAY_MS);
    const wave = (Math.sin(ago * 1.7) + 1) / 2;
    const quiet = (ago * 7) % 11 === 0;
    const totalTokens = quiet ? 0 : Math.round(WEEKDAY_LOAD[day.getDay()]! * (0.25 + wave) * 240_000);
    if (totalTokens === 0) continue;
    const requestCount = Math.max(1, Math.round(totalTokens / TOKENS_PER_REQUEST));
    const errorCount = ago % 13 === 0 ? 1 : 0;
    buckets.push({
      bucketStartAt: day.toISOString(),
      totalTokens,
      inputTokens: Math.round(totalTokens * 0.7),
      outputTokens: Math.round(totalTokens * 0.25),
      cacheReadTokens: Math.round(totalTokens * 0.05),
      cacheWriteTokens: 0,
      costInput: totalTokens * 0.000003,
      costOutput: totalTokens * 0.000015,
      costCacheRead: totalTokens * 0.0000003,
      costCacheWrite: 0,
      costTotal: totalTokens * 0.000018,
      requestCount,
      successCount: requestCount - errorCount,
      errorCount,
      models: ["claude-sonnet"],
    });
  }
  return buckets;
}

export function fixtureActivity(now: number): UserActivityResponse {
  const hourly = hourlyUsage(now);
  const sum = (pick: (bucket: SpaceUsageHourlyStat) => number) => hourly.reduce((total, bucket) => total + pick(bucket), 0);
  const requestCount = sum((bucket) => bucket.requestCount);
  const errorCount = sum((bucket) => bucket.errorCount);
  const totalTokens = sum((bucket) => bucket.totalTokens);
  const costTotal = sum((bucket) => bucket.costTotal);
  return {
    hourly,
    summary: {
      totalTokens,
      inputTokens: sum((bucket) => bucket.inputTokens),
      outputTokens: sum((bucket) => bucket.outputTokens),
      cacheReadTokens: sum((bucket) => bucket.cacheReadTokens),
      cacheWriteTokens: 0,
      costInput: sum((bucket) => bucket.costInput),
      costOutput: sum((bucket) => bucket.costOutput),
      costCacheRead: sum((bucket) => bucket.costCacheRead),
      costCacheWrite: 0,
      costTotal,
      requestCount,
      successCount: requestCount - errorCount,
      errorCount,
    },
    totals: { totalTokens, requestCount, successCount: requestCount - errorCount, errorCount, costTotal },
    days: HEATMAP_DAYS,
    range: { from: new Date(now - HEATMAP_DAYS * DAY_MS).toISOString(), to: new Date(now).toISOString() },
    rankings: {
      llmModels: [{ provider: "cohub", model: "claude-sonnet", totalTokens, requestCount, costTotal }],
      generationModels: [],
      apps: [],
    },
  };
}
