import { useCallback, useSyncExternalStore } from "react";
import { msUntilRelativeTimeChange } from "@/src/data/relative-time";
import { formatRelativeTime } from "@/src/utils";

/**
 * A relative time that stays current while it is on screen: the row re-renders when its label would
 * change ("now" → "1m" → … → a date), not on a fixed tick.
 */
export function useRelativeTime(value: string | null | undefined): string {
  const subscribe = useCallback((onChange: () => void) => {
    const at = value ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(at)) return () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = msUntilRelativeTimeChange(at, Date.now());
      if (delay === null) return;
      // A timer can fire a little early; the margin keeps it past the boundary it waits for.
      timer = setTimeout(() => { onChange(); schedule(); }, delay + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [value]);
  const snapshot = () => formatRelativeTime(value);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
