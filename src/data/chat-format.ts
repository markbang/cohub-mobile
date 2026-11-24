import { getActiveLocale, type AppLocale } from "../i18n/core";

const CLOCK_LOCALE: Record<AppLocale, string> = { en: "en-US", zh: "zh-CN" };
const clockFormats = new Map<AppLocale, Intl.DateTimeFormat>();

/** The clock as the active locale writes it: "9:41 AM" in English, "09:41" where the locale uses 24 hours. */
export function formatMessageClock(value: string | null | undefined, locale: AppLocale = getActiveLocale()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  let format = clockFormats.get(locale);
  if (!format) {
    const hour12 = new Intl.DateTimeFormat(CLOCK_LOCALE[locale], { hour: "numeric" }).resolvedOptions().hour12;
    format = new Intl.DateTimeFormat(CLOCK_LOCALE[locale], { hour: hour12 ? "numeric" : "2-digit", minute: "2-digit" });
    clockFormats.set(locale, format);
  }
  // ICU separates the day period with a narrow no-break space; the timeline wants plain spacing.
  return format.format(date).replace(/\s+/g, " ");
}

/** A Bot page's time row: "Today 08:00", "Yesterday 08:00", or the date and clock. */
export function formatThreadTime(value: string, t: (key: "bots.time.today" | "bots.time.yesterday", params: { time: string }) => string, locale: string, now = Date.now()) {
  const date = new Date(value);
  const time = formatMessageClock(value);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t("bots.time.today", { time });
  if (date.toDateString() === yesterday.toDateString()) return t("bots.time.yesterday", { time });
  const day = date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
  return `${day} ${time}`;
}

/** A running or finished Turn's length: "8s", "1m 05s", "1h 02m". */
export function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
