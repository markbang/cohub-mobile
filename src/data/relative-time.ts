const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export type RelativeTime =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; count: number }
  | { unit: "date" };

/** Compact age for list metadata; past a week it is a calendar date. Future times read as now. */
export function relativeTime(at: number, now: number): RelativeTime {
  const delta = now - at;
  if (delta < MINUTE) return { unit: "now" };
  if (delta < HOUR) return { unit: "minutes", count: Math.floor(delta / MINUTE) };
  if (delta < DAY) return { unit: "hours", count: Math.floor(delta / HOUR) };
  if (delta < WEEK) return { unit: "days", count: Math.floor(delta / DAY) };
  return { unit: "date" };
}

/** Milliseconds until `relativeTime` returns a different label, or `null` once it is a fixed date. */
export function msUntilRelativeTimeChange(at: number, now: number): number | null {
  const delta = Math.max(0, now - at);
  if (delta >= WEEK) return null;
  const step = delta < HOUR ? MINUTE : delta < DAY ? HOUR : DAY;
  return (Math.floor(delta / step) + 1) * step - delta;
}
