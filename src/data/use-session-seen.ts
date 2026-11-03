import { useCallback, useLayoutEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { EMPTY_SESSION_SEEN, type SessionSeenEntry, type SessionSeenState } from "./chat-read-state";
import { loadSessionSeen, saveSessionSeen } from "./local-db";

type SeenStore = StoreApi<{ sessionSeen: SessionSeenState }>;

/** Provider side: hydrates this user's device-local read marks and owns their writes. */
export function useSessionSeenOwner(userKey: string, store: SeenStore) {
  const generation = useRef(0);

  const hydrate = useCallback(() => {
    const token = ++generation.current;
    store.setState({ sessionSeen: EMPTY_SESSION_SEEN });
    return loadSessionSeen(userKey, Date.now()).then((stored) => {
      if (generation.current !== token) return;
      // Marks made while the read was pending are newer than the stored rows.
      store.setState((current) => ({ sessionSeen: { baseline: stored.baseline, entries: { ...stored.entries, ...current.sessionSeen.entries } } }));
    });
  }, [store, userKey]);

  useLayoutEffect(() => {
    // Without a baseline nothing shows as unread, which is the safe failure for a list marker.
    void hydrate().catch(() => undefined);
    return () => { generation.current += 1; };
  }, [hydrate]);

  const mark = useCallback((sessionId: string, entry: SessionSeenEntry): Promise<void> => {
    if (!sessionId.trim()) throw new Error("Cannot update read state without a Chat ID.");
    store.setState((current) => ({ sessionSeen: { ...current.sessionSeen, entries: { ...current.sessionSeen.entries, [sessionId]: entry } } }));
    return saveSessionSeen(userKey, sessionId, entry);
  }, [store, userKey]);

  const markSeen = useCallback((sessionId: string, messageId: string | null) => {
    const current = store.getState().sessionSeen.entries[sessionId];
    if (current && current.messageId === messageId && current.seenAt > 0) return Promise.resolve();
    return mark(sessionId, { messageId, seenAt: Date.now() });
  }, [mark, store]);

  const markUnread = useCallback((sessionId: string) => mark(sessionId, { messageId: null, seenAt: 0 }), [mark]);

  return { markSeen, markUnread, reload: hydrate };
}
