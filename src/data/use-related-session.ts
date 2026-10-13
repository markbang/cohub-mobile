import type { CohubClient, SessionRecord } from "@neta-art/cohub";
import { useEffect, useSyncExternalStore } from "react";
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
