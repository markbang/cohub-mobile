/** `success` confirms a finished action, `neutral` informs, `danger` reports a failure. */
export type ToastTone = "neutral" | "success" | "danger";

export type ToastEntry = {
  key: string;
  title: string;
  message?: string;
  tone: ToastTone;
  /** Bumped when the same toast is raised again, restarting its time without adding a layer. */
  revision: number;
  /** Its time is up; the card fades out and then dismisses itself. */
  expired?: boolean;
};

/**
 * Newest toast is at index 0 and is the only interactive one; older toasts stack behind it.
 * Kept small so the stack never covers the composer or a sheet footer.
 */
export const MAX_VISIBLE_TOASTS = 3;

/** A failure usually carries a detail line worth reading, so it stays longer. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = { neutral: 3200, success: 3200, danger: 5000 };

function isSameToast(a: ToastEntry, b: ToastEntry) {
  return a.tone === b.tone && a.title === b.title && (a.message ?? "") === (b.message ?? "");
}

export function pushToast(current: readonly ToastEntry[], next: ToastEntry): ToastEntry[] {
  const duplicate = current.find((entry) => !entry.expired && isSameToast(entry, next));
  const entry = duplicate ? { ...duplicate, revision: duplicate.revision + 1 } : next;
  return [entry, ...current.filter((existing) => existing.key !== entry.key)].slice(0, MAX_VISIBLE_TOASTS);
}

export function expireToast(current: readonly ToastEntry[], key: string): ToastEntry[] {
  return current.map((entry) => entry.key === key ? { ...entry, expired: true } : entry);
}

export function dismissToast(current: readonly ToastEntry[], key: string): ToastEntry[] {
  return current.filter((entry) => entry.key !== key);
}
