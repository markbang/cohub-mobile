const LARGE_PASTE_MIN_CHARS = 20_000;
const LARGE_PASTE_MIN_LINES = 500;

/** Mirrors the web: a paste this long goes with the message as a file instead of filling the input. */
export function isLargeComposerPaste(text: string): boolean {
  if (text.length >= LARGE_PASTE_MIN_CHARS) return true;
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    if (++lines >= LARGE_PASTE_MIN_LINES) return true;
  }
  return false;
}

/**
 * The input only reports its new value, so a paste is the span one edit inserted: what `next` holds between the
 * prefix and suffix it shares with `previous`. `rest` is `previous` without the selection the paste replaced.
 * `null` when the edit inserted nothing.
 */
export function composerInsertion(previous: string, next: string): { inserted: string; rest: string } | null {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let end = 0;
  while (end < previous.length - start && end < next.length - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end += 1;
  const inserted = next.slice(start, next.length - end);
  return inserted ? { inserted, rest: previous.slice(0, start) + previous.slice(previous.length - end) } : null;
}

function isJsonText(text: string): boolean {
  const first = text.trimStart()[0];
  if (first !== "{" && first !== "[") return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function pastedTextFileName(text: string, now = new Date()): { name: string; mimeType: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const json = isJsonText(text);
  return { name: `pasted-${stamp}.${json ? "json" : "txt"}`, mimeType: json ? "application/json" : "text/plain" };
}
