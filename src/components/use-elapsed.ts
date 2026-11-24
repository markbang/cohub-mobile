import { useEffect, useState } from "react";

/**
 * Whole seconds a live reply has run, ticking while `running`; null otherwise. Counts from
 * `startedAt` when known, else from when `running` began.
 */
export function useElapsedSeconds(startedAt: string | null | undefined, running: boolean): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  const known = Number.isFinite(parsed) ? parsed : null;
  useEffect(() => {
    if (!running) return;
    const began = Date.now();
    // A device clock behind the server's start holds at zero rather than counting negative.
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - (known ?? began)) / 1000)));
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running, known]);
  return running ? elapsed : null;
}
