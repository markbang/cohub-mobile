/** One local-first change to a server-backed value. */
export type OptimisticWrite<T> = {
  value: T;
  /** The server's value now; read only when no write for the key is in flight. */
  confirmed: T;
  /** Shows a value locally: the intent at once, or the confirmed value again after a failure. */
  apply: (value: T) => void;
  /** Resolves to the value the server holds afterwards. */
  send: (value: T) => Promise<T>;
  /** The server holds the latest intent; `from` is what it held before the first write of the run. */
  settled?: (value: T, from: T) => void;
};

type Waiter = { resolve: (value: never) => void; reject: (error: unknown) => void };
type Entry = { from: unknown; confirmed: unknown; wanted: unknown; write: OptimisticWrite<never>; waiters: Waiter[] };

export type OptimisticWrites = ReturnType<typeof createOptimisticWrites>;

/**
 * Local-first writes, keyed per value: `run` applies the intent synchronously and sends it in the background.
 * One request per key is in flight; intents made meanwhile coalesce into one follow-up for the latest, so the
 * last intent wins and answers to superseded intents never reach the screen. A failed latest intent puts back
 * the last confirmed value and rejects its own promise only, so repeated taps raise one error.
 */
export function createOptimisticWrites() {
  const entries = new Map<string, Entry>();
  const revisions = new Map<string, number>();

  const finish = (key: string, entry: Entry, value: unknown) => {
    entries.delete(key);
    entry.write.settled?.(value as never, entry.from as never);
    for (const waiter of entry.waiters) waiter.resolve(value as never);
  };

  const flush = async (key: string, entry: Entry) => {
    while (entries.get(key) === entry) {
      const target = entry.wanted;
      if (Object.is(target, entry.confirmed)) return finish(key, entry, target);
      let result: unknown;
      try {
        result = await entry.write.send(target as never);
      } catch (error) {
        if (entries.get(key) !== entry || !Object.is(entry.wanted, target)) continue;
        entries.delete(key);
        entry.write.apply(entry.confirmed as never);
        const latest = entry.waiters.pop();
        for (const waiter of entry.waiters) waiter.resolve(entry.confirmed as never);
        latest?.reject(error);
        return;
      }
      entry.confirmed = result;
      if (entries.get(key) !== entry || !Object.is(entry.wanted, target)) continue;
      // The server may hold something other than what was asked; its answer to the latest intent stands.
      if (!Object.is(result, target)) entry.write.apply(result as never);
      return finish(key, entry, result);
    }
  };

  return {
    run<T>(key: string, write: OptimisticWrite<T>): Promise<T> {
      revisions.set(key, (revisions.get(key) ?? 0) + 1);
      return new Promise<T>((resolve, reject) => {
        const current = entries.get(key);
        const entry: Entry = current ?? { from: write.confirmed, confirmed: write.confirmed, wanted: write.value, write: write as unknown as OptimisticWrite<never>, waiters: [] };
        entry.wanted = write.value;
        entry.write = write as unknown as OptimisticWrite<never>;
        entry.waiters.push({ resolve: resolve as (value: never) => void, reject });
        write.apply(write.value);
        if (current) return;
        entries.set(key, entry);
        void flush(key, entry);
      });
    },
    /** A write for the key is in flight; a refresh must not paint over its intent. */
    pending: (key: string) => entries.has(key),
    /** Bumped on every write, so a read that began before one can tell its answer is stale. */
    revision: (key: string) => revisions.get(key) ?? 0,
    /** Drops every write, as on sign out; answers still in flight are ignored. */
    clear() {
      entries.clear();
      revisions.clear();
    },
  };
}
