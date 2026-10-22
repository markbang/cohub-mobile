import type { ConnectionState } from "@/src/data/types";

export type ConnectionStateSnapshot = {
  state: ConnectionState;
  willReconnect?: boolean;
  recoverable?: boolean;
};

/**
 * Maps an SDK connection snapshot to the state the app should display.
 *
 * Recoverable `error` events (a dropped compact patch, an unreadable frame)
 * leave the socket open, so they must not be surfaced as an outage. `closed`
 * with a pending reconnect is immediately followed by `reconnecting`, so it
 * reports as reconnecting rather than unavailable. Returns null when the
 * snapshot should not change the displayed state.
 */
export function connectionDisplayState(snapshot: ConnectionStateSnapshot): ConnectionState | null {
  if (snapshot.state === "error" && snapshot.recoverable === true) return null;
  if (snapshot.state === "closed" && snapshot.willReconnect === true) return "reconnecting";
  return snapshot.state;
}

/**
 * A transport handoff happened when the socket reaches `open` after any
 * state that could have dropped realtime events. The very first `open`
 * after `idle`/`connecting` is a fresh connect, not a recovery.
 */
export function isTransportRecovery(previous: ConnectionState, next: ConnectionState) {
  if (next !== "open") return false;
  return previous === "reconnecting" || previous === "closed" || previous === "error";
}

/**
 * OkHttp waits up to 60 s for the peer's close frame, so a pong-timeout close on a
 * dead link would delay the SDK's reconnect that long. Report overdue closes locally.
 */
export function withSettledClose(Base: typeof WebSocket, settleMs: number): typeof WebSocket {
  return class SettledCloseWebSocket extends Base {
    override close(code?: number, reason?: string) {
      const live = this.readyState === Base.CONNECTING || this.readyState === Base.OPEN;
      super.close(code, reason);
      if (!live) return;
      setTimeout(() => {
        if (this.readyState === Base.CLOSED) return;
        this.onclose?.call(this, { code: code ?? 1000, reason: reason ?? "", wasClean: false } as CloseEvent);
      }, settleMs);
    }
  };
}

type RealtimeRecoveryOptions = {
  reconnect: () => void;
  onUnavailableChange: (unavailable: boolean) => void;
  isActive: () => boolean;
  graceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

/**
 * The SDK stops reconnecting after two failed token reads during socket auth,
 * which a slow mobile network causes as readily as a revoked session. Retry a
 * stopped socket with backoff, and report it only after a grace period.
 */
export function createRealtimeRecovery(options: RealtimeRecoveryOptions) {
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;
  let unavailable = false;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const clearGrace = () => {
    if (graceTimer !== null) clearTimeout(graceTimer);
    graceTimer = null;
  };
  const setUnavailable = (next: boolean) => {
    if (unavailable === next) return;
    unavailable = next;
    options.onUnavailableChange(next);
  };

  return {
    update(snapshot: ConnectionStateSnapshot) {
      if (snapshot.state === "open") {
        attempt = 0;
        stopped = false;
        clearRetry();
        clearGrace();
        setUnavailable(false);
        return;
      }
      if (snapshot.state !== "closed" || snapshot.willReconnect === true) return;
      stopped = true;
      if (!unavailable && graceTimer === null) {
        graceTimer = setTimeout(() => {
          graceTimer = null;
          setUnavailable(true);
        }, options.graceMs);
      }
      clearRetry();
      const delay = Math.min(options.retryBaseMs * 2 ** attempt, options.retryMaxMs);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (options.isActive()) options.reconnect();
      }, delay);
    },
    foreground() {
      if (!stopped) return;
      clearRetry();
      options.reconnect();
    },
    dispose() {
      clearRetry();
      clearGrace();
    },
  };
}

export type SessionResyncReason = "transport-open" | "foreground" | "out-of-sync";

type ResyncCoordinatorOptions = {
  /** Merge triggers that arrive within this window (e.g. `open` + `active` firing together). */
  debounceMs: number;
  /**
   * Per-reason floor between runs for a session. Used for `out-of-sync`, where a
   * server that keeps sending un-appliable patches must not turn into a snapshot
   * request loop. Reconnect/foreground triggers are never throttled.
   */
  cooldowns?: Partial<Record<SessionResyncReason, number>>;
  run: (sessionId: string, reason: SessionResyncReason) => Promise<void>;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

/**
 * Per-session single-flight resync scheduler. Repeated triggers while a
 * resync is running queue exactly one follow-up so a reconnect that lands
 * mid-resync is not lost, and short bursts collapse into one run.
 */
export function createSessionResyncCoordinator(options: ResyncCoordinatorOptions) {
  const schedule = options.setTimeout ?? globalThis.setTimeout;
  const cancel = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? Date.now;
  const timers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  const inFlight = new Map<string, Promise<void>>();
  const queued = new Map<string, SessionResyncReason>();
  const lastRunAt = new Map<string, number>();
  let disposed = false;

  const cooldownFor = (reason: SessionResyncReason) => options.cooldowns?.[reason] ?? 0;

  const start = (sessionId: string, reason: SessionResyncReason) => {
    if (disposed) return;
    if (inFlight.has(sessionId)) {
      queued.set(sessionId, reason);
      return;
    }
    lastRunAt.set(`${sessionId}:${reason}`, now());
    const run = options
      .run(sessionId, reason)
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(sessionId);
        const next = queued.get(sessionId);
        queued.delete(sessionId);
        if (next !== undefined && !disposed) start(sessionId, next);
      });
    inFlight.set(sessionId, run);
  };

  return {
    /** Returns false when a cooldown suppressed the trigger, so callers can fall back to a cheap reconcile. */
    request(sessionId: string, reason: SessionResyncReason) {
      if (disposed) return false;
      const cooldown = cooldownFor(reason);
      if (cooldown > 0) {
        const last = lastRunAt.get(`${sessionId}:${reason}`);
        if (last !== undefined && now() - last < cooldown) return false;
      }
      const existing = timers.get(sessionId);
      if (existing !== undefined) cancel(existing);
      timers.set(sessionId, schedule(() => {
        timers.delete(sessionId);
        start(sessionId, reason);
      }, options.debounceMs));
      return true;
    },
    cancel(sessionId: string) {
      const existing = timers.get(sessionId);
      if (existing !== undefined) cancel(existing);
      timers.delete(sessionId);
      queued.delete(sessionId);
      lastRunAt.delete(`${sessionId}:out-of-sync`);
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) cancel(timer);
      timers.clear();
      queued.clear();
      lastRunAt.clear();
    },
  };
}
