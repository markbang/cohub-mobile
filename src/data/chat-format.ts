export function formatMessageClock(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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
