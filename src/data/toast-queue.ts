/** `success` confirms a finished action, `neutral` informs, `danger` reports a failure. */
export type ToastTone = "neutral" | "success" | "danger";

/** One follow-up for what the toast reports, such as Undo. */
export type ToastAction = { label: string; onPress: () => void };

export type ToastEntry = {
  key: string;
  title: string;
  message?: string;
  tone: ToastTone;
  action?: ToastAction;
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
/** A toast with an action stays long enough to reach for it. */
export const TOAST_ACTION_DURATION_MS = 5000;

export function toastDuration(entry: Pick<ToastEntry, "tone" | "action">) {
  return entry.action ? Math.max(TOAST_DURATION_MS[entry.tone], TOAST_ACTION_DURATION_MS) : TOAST_DURATION_MS[entry.tone];
}

function isSameToast(a: ToastEntry, b: ToastEntry) {
  // An action belongs to the operation that raised it, so its toast is never merged into another.
  if (a.action || b.action) return false;
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

/** A toast released after being held stays at least this long, so it does not vanish as the finger lifts. */
export const RELEASE_GRACE_MS = 1500;

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number };

/**
 * Every toast runs its own time; while any holder presses the stack, all of them pause. A holder is a card
 * while it is mounted at the front: a hold reported after it unmounted is dropped, since gesture callbacks
 * arrive asynchronously and can land after the unmount that already released it.
 */
export class ToastClock {
  private readonly timers = new Map<string, Timer>();
  private readonly mounted = new Set<string>();
  private readonly holders = new Set<string>();
  private readonly onExpire: (key: string) => void;

  constructor(onExpire: (key: string) => void) {
    this.onExpire = onExpire;
  }

  start(key: string, duration: number) {
    this.stop(key);
    const timer: Timer = { handle: null, remaining: duration, startedAt: 0 };
    this.timers.set(key, timer);
    if (!this.paused) this.run(key, timer);
  }

  mount(holder: string) {
    this.mounted.add(holder);
  }

  unmount(holder: string) {
    this.mounted.delete(holder);
    this.hold(holder, false);
  }

  hold(holder: string, holding: boolean) {
    if (holding && !this.mounted.has(holder)) return;
    const wasPaused = this.paused;
    if (holding) this.holders.add(holder);
    else this.holders.delete(holder);
    if (wasPaused === this.paused) return;
    for (const [key, timer] of this.timers) {
      if (this.paused) {
        if (!timer.handle) continue;
        clearTimeout(timer.handle);
        timer.handle = null;
        timer.remaining -= Date.now() - timer.startedAt;
      } else {
        timer.remaining = Math.max(timer.remaining, RELEASE_GRACE_MS);
        this.run(key, timer);
      }
    }
  }

  get paused() {
    return this.holders.size > 0;
  }

  /** Drops the time of every toast no longer queued. */
  retain(entries: readonly ToastEntry[]) {
    for (const key of [...this.timers.keys()]) if (!entries.some((entry) => entry.key === key)) this.stop(key);
  }

  stopAll() {
    for (const key of [...this.timers.keys()]) this.stop(key);
  }

  private stop(key: string) {
    const timer = this.timers.get(key);
    if (timer?.handle) clearTimeout(timer.handle);
    this.timers.delete(key);
  }

  private run(key: string, timer: Timer) {
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => {
      this.timers.delete(key);
      this.onExpire(key);
    }, timer.remaining);
  }
}
