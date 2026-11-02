import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createRelatedSessionStore, type RelatedSessionRef, type RelatedSessionStore, type RelatedSessionView } from "./related-sessions";

const stores = new WeakMap<CohubClient, RelatedSessionStore>();
const noop = () => () => undefined;
const UNKNOWN: RelatedSessionView = { status: "unknown" };

function storeFor(client: CohubClient) {
  let store = stores.get(client);
  if (!store) {
    store = createRelatedSessionStore(client);
    stores.set(client, store);
  }
  return store;
}

export function useRelatedSession(client: CohubClient | null, ref: RelatedSessionRef, live: SessionRecord | null): RelatedSessionView {
  const store = client ? storeFor(client) : null;
  const fetched = useSyncExternalStore(store ? store.subscribe : noop, () => store ? store.get(ref) : UNKNOWN);
  const { spaceId, sessionId } = ref;
  useEffect(() => {
    if (store && !live) store.request({ spaceId, sessionId });
  }, [live, sessionId, spaceId, store]);
  return live ? { status: "ready", session: live } : fetched;
}

/** Several related Chats at once, for rows that are not React components. Keyed by session id. */
export function useRelatedSessions(client: CohubClient | null, refs: readonly Pick<RelatedSessionRef, "spaceId" | "sessionId">[], lookup: (sessionId: string) => SessionRecord | null): (sessionId: string) => RelatedSessionView {
  const store = client ? storeFor(client) : null;
  const version = useSyncExternalStore(store ? store.subscribe : noop, () => (store ? store.version() : 0));
  useEffect(() => {
    if (!store) return;
    for (const ref of refs) if (!lookup(ref.sessionId)) store.request(ref);
  }, [lookup, refs, store]);
  // `version` changes with every settled request, so the returned reader does too.
  return useMemo(() => {
    void version;
    return (sessionId: string) => {
      const live = lookup(sessionId);
      return live ? { status: "ready", session: live } : store ? store.get({ sessionId }) : UNKNOWN;
    };
  }, [lookup, store, version]);
}
