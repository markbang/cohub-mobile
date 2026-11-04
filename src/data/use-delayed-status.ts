import { useEffect, useState } from "react";
import { delayedStatusDeadline, shownDelayedStatus, stepDelayedStatus, type DelayedStatusOptions } from "@/src/data/delayed-status";

/** `value` as the user should see it: late enough not to flicker, long enough to read. See `stepDelayedStatus`. */
export function useDelayedStatus<T>(key: string, value: T | null, options?: DelayedStatusOptions): T | null {
  const [state, setState] = useState(() => stepDelayedStatus<T>(null, { key, value, deadlinePassed: false, ...options }, Date.now));
  const deadline = delayedStatusDeadline(state);
  const [reached, setReached] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const timer = setTimeout(() => setReached(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline]);
  const next = stepDelayedStatus(state, { key, value, deadlinePassed: deadline !== null && reached === deadline, ...options }, Date.now);
  if (next !== state) setState(next);
  return shownDelayedStatus(next, key);
}
