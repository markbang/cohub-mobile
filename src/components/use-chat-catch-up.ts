import { useEffect, useState } from "react";
import type { MessageRecord } from "@neta-art/cohub";
import { messageRowKey } from "@/src/data/session-history";

/** Most catch-ups finish before this; showing the loader for them only adds a flicker at the tail. */
export const CATCH_UP_LOADER_DELAY_MS = 300;
/** Covers the arrival fade; after it the baseline is dropped so rows render plainly again. */
const ARRIVAL_WINDOW_MS = 800;

type CatchUp = { active: boolean; baseline: ReadonlySet<string> | null; loaderDue: boolean };

/**
 * Tracks one catch-up: earlier history is on screen while the request for what arrived since is in
 * flight. `baseline` holds the rows already shown when it began (rows, not ids: the server copy of a
 * cached message has another id), so rows the response adds can fade in instead of popping. It is
 * captured during render because the response replaces the messages and clears `catchingUp` in one
 * commit; an effect would run only after the new rows had painted.
 */
export function useChatCatchUp(catchingUp: boolean, messages: readonly MessageRecord[]) {
  const [state, setState] = useState<CatchUp>({ active: false, baseline: null, loaderDue: false });
  if (catchingUp !== state.active) {
    setState({ active: catchingUp, baseline: catchingUp ? new Set(messages.map(messageRowKey)) : state.baseline, loaderDue: false });
  }

  useEffect(() => {
    if (state.active) {
      if (state.loaderDue) return;
      const timer = setTimeout(() => setState((current) => (current.active ? { ...current, loaderDue: true } : current)), CATCH_UP_LOADER_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (!state.baseline) return;
    const timer = setTimeout(() => setState((current) => (current.active ? current : { active: false, baseline: null, loaderDue: false })), ARRIVAL_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Nothing was on screen (a cold open without cache), so there is nothing to arrive after.
  const arrivalBaseline = state.baseline && state.baseline.size > 0 ? state.baseline : null;
  return { showLoader: state.active && state.loaderDue, arrivalBaseline };
}

/** A row the catch-up response added. Local sends own their own entrance (the send bubble). */
export function isCatchUpArrival(baseline: ReadonlySet<string> | null, message: MessageRecord) {
  return baseline !== null && !baseline.has(messageRowKey(message)) && message.meta?.optimistic !== true;
}
