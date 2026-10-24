type CronField = { values: Set<number>; any: boolean };
export type CronSpec = { minute: CronField; hour: CronField; day: CronField; month: CronField; weekday: CronField };

export const CRON_PRESETS = [
  { id: "hourly", expression: "0 * * * *" },
  { id: "daily", expression: "0 9 * * *" },
  { id: "weekdays", expression: "0 9 * * 1-5" },
  { id: "weekly", expression: "0 9 * * 1" },
] as const;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function parseValue(token: string, min: number, names?: string[]): number {
  const named = names?.indexOf(token.toUpperCase()) ?? -1;
  if (named >= 0) return named + min;
  if (!/^\d+$/.test(token)) throw new Error(token);
  return Number(token);
}

function parseField(source: string, min: number, max: number, names?: string[]): CronField {
  const values = new Set<number>();
  for (const part of source.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!range || !Number.isInteger(step) || step < 1 || part.split("/").length > 2) throw new Error(part);
    let start = min;
    let end = max;
    if (range !== "*") {
      const [from, to] = range.split("-");
      if (!from || range.split("-").length > 2) throw new Error(part);
      start = parseValue(from, min, names);
      end = to === undefined ? (stepText === undefined ? start : max) : parseValue(to, min, names);
    }
    if (start < min || end > max || start > end) throw new Error(part);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, any: source === "*" };
}

export function parseCron(expression: string): CronSpec | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  try {
    const weekday = parseField(fields[4]!, 0, 7, DAYS);
    // 7 is Sunday too.
    if (weekday.values.delete(7)) weekday.values.add(0);
    return {
      minute: parseField(fields[0]!, 0, 59),
      hour: parseField(fields[1]!, 0, 23),
      day: parseField(fields[2]!, 1, 31),
      month: parseField(fields[3]!, 1, 12, MONTHS),
      weekday,
    };
  } catch {
    return null;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(formatter: Intl.DateTimeFormat, time: number) {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(time))) parts[part.type] = part.value;
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour) % 24,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAY_INDEX[parts.weekday ?? ""] ?? 0,
  };
}

/** Walks real instants, so DST is handled; day and weekday restrictions match either, as in cron. */
export function nextCronRuns(expression: string, timeZone: string, count = 3, from = Date.now()): Date[] {
  const spec = parseCron(expression);
  if (!spec || !isValidTimeZone(timeZone)) return [];
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  const runs: Date[] = [];
  let time = Math.floor(from / 60_000) * 60_000 + 60_000;
  // Two years of hours bounds the walk for impossible dates such as "0 0 31 2 *".
  for (let guard = 0; guard < 20_000 && runs.length < count; guard++) {
    const local = localParts(formatter, time);
    const dayMatches = spec.day.any && spec.weekday.any ? true
      : spec.day.any ? spec.weekday.values.has(local.weekday)
      : spec.weekday.any ? spec.day.values.has(local.day)
      : spec.day.values.has(local.day) || spec.weekday.values.has(local.weekday);
    if (!spec.month.values.has(local.month) || !dayMatches || !spec.hour.values.has(local.hour)) {
      time += (60 - local.minute) * 60_000;
      continue;
    }
    if (spec.minute.values.has(local.minute)) runs.push(new Date(time));
    time += 60_000;
  }
  return runs;
}

export type CronSummary =
  | { kind: "preset"; id: (typeof CRON_PRESETS)[number]["id"]; time: string }
  | { kind: "hourly"; minute: number }
  | { kind: "minutes"; every: number }
  | { kind: "weekday"; weekday: number; time: string }
  | { kind: "custom" };

export function summarizeCron(expression: string): CronSummary {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || !parseCron(expression)) return { kind: "custom" };
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const clock = /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` : null;
  if (day !== "*" || month !== "*") return { kind: "custom" };
  if (/^\*\/\d+$/.test(minute) && hour === "*" && weekday === "*") return { kind: "minutes", every: Number(minute.slice(2)) };
  if (/^\d+$/.test(minute) && hour === "*" && weekday === "*") return { kind: "hourly", minute: Number(minute) };
  if (!clock) return { kind: "custom" };
  if (weekday === "*") return { kind: "preset", id: "daily", time: clock };
  if (weekday === "1-5") return { kind: "preset", id: "weekdays", time: clock };
  if (/^[0-7]$/.test(weekday)) return { kind: "weekday", weekday: Number(weekday) % 7, time: clock };
  return { kind: "custom" };
}
