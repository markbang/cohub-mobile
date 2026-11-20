import { estimateColdResend, type ColdResendEstimate, type ColdResendTurn, type ModelCatalogEntry } from "@neta-art/cohub";
import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeAppActive } from "@/src/platform/app-lifecycle";
import type { ChatModelSelection } from "./types";

/**
 * Mirrors the web notice: once a long Cohub Chat's prompt cache has gone cold, its next message resends the
 * whole context. The user may queue a compaction before that message, or dismiss the notice for the Turn it
 * was estimated from. `eligible` is false for Bots, local Harnesses, a new Chat, and while a Turn runs.
 */
export function useColdResend({ eligible, turns, model, models }: {
  eligible: boolean;
  turns: readonly ColdResendTurn[];
  model: ChatModelSelection | null;
  models: readonly ModelCatalogEntry[];
}): { notice: ColdResendEstimate | null; compactFirst: boolean; setCompactFirst: (value: boolean) => void; dismiss: () => void } {
  const [clock, setClock] = useState(() => Date.now());
  const [dismissedTurnId, setDismissedTurnId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const selected = eligible && model ? models.find((entry) => entry.provider === model.provider && entry.id === model.id) ?? null : null;
  const estimate = useMemo(() => (selected ? estimateColdResend(turns, selected) : null), [selected, turns]);
  const expiresAt = estimate?.expiresAt ?? null;

  useEffect(() => {
    if (expiresAt === null) return;
    // An estimate that has already expired (or a model switch, which expires at 0) re-reads the clock at once.
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, expiresAt - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  // Timers do not run in the background; returning to the app re-reads the clock.
  useEffect(() => subscribeAppActive((active) => { if (active) setClock(Date.now()); }), []);

  const dismiss = useCallback(() => { if (estimate) setDismissedTurnId(estimate.turnId); }, [estimate]);
  const notice = estimate && clock >= estimate.expiresAt && dismissedTurnId !== estimate.turnId ? estimate : null;
  return { notice, compactFirst: eligible && queued, setCompactFirst: setQueued, dismiss };
}
