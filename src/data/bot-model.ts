import { useCallback, useSyncExternalStore } from "react";
import type { ChatModelSelection } from "./types";

/**
 * The model a Bot's messages go to, chosen on its profile and read by its page. Kept for this launch only, as the
 * page's own choice was; `undefined` is no choice, so the page keeps the model its Chat last ran with.
 * Keyed by account and Bot, so one account's choice never reaches another's.
 */
const choices = new Map<string, ChatModelSelection | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBotModel(userKey: string, spaceId: string): [ChatModelSelection | null | undefined, (model: ChatModelSelection | null) => void] {
  const key = `${userKey}:${spaceId}`;
  const read = useCallback(() => choices.get(key), [key]);
  const choice = useSyncExternalStore(subscribe, read, read);
  const choose = useCallback((model: ChatModelSelection | null) => {
    choices.set(key, model);
    for (const listener of listeners) listener();
  }, [key]);
  return [choice, choose];
}
