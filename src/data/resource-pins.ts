import type { CohubClient, LabelAssignmentRecord, LabelResourceType } from "@neta-art/cohub";

// Keep the same system label as Web; the user-label endpoint also supports Chat resources.
export const PINNED_LABEL_REF = "Pinned";
export const PINNED_LABEL_SYSTEM_KEY = "user:pinned";

const PIN_CACHE_TTL_MS = 60_000;
const PIN_LOOKUP_BATCH_SIZE = 8;

type PinCacheEntry = {
  pinned: boolean;
  checkedAt: number;
};

type ClientPinCache = {
  entries: Map<string, PinCacheEntry>;
  pending: Map<string, Promise<boolean>>;
};

const caches = new WeakMap<CohubClient, ClientPinCache>();

function getCache(client: CohubClient) {
  const existing = caches.get(client);
  if (existing) return existing;
  const created: ClientPinCache = { entries: new Map(), pending: new Map() };
  caches.set(client, created);
  return created;
}

function resourceKey(resourceType: LabelResourceType, resourceRef: string) {
  return `${resourceType}:${resourceRef}`;
}

export function isPinnedLabelAssignment(
  assignment: Pick<LabelAssignmentRecord, "labelSystemKey">,
) {
  return assignment.labelSystemKey === PINNED_LABEL_SYSTEM_KEY;
}

export function isResourcePinned(
  assignments: readonly Pick<LabelAssignmentRecord, "labelSystemKey">[],
) {
  return assignments.some(isPinnedLabelAssignment);
}

function cachePinState(
  client: CohubClient,
  resourceType: LabelResourceType,
  resourceRef: string,
  pinned: boolean,
) {
  getCache(client).entries.set(resourceKey(resourceType, resourceRef), {
    pinned,
    checkedAt: Date.now(),
  });
}

export async function getResourcePinState(
  client: CohubClient,
  resourceType: LabelResourceType,
  resourceRef: string,
  options: { force?: boolean } = {},
) {
  const key = resourceKey(resourceType, resourceRef);
  const cache = getCache(client);
  const current = cache.entries.get(key);
  if (!options.force && current && Date.now() - current.checkedAt < PIN_CACHE_TTL_MS) {
    return current.pinned;
  }
  const pending = cache.pending.get(key);
  if (pending) return pending;

  const request = client.user.labels
    .getResourceLabels(resourceType, resourceRef)
    .then((result) => {
      const pinned = isResourcePinned(result.assignments);
      cachePinState(client, resourceType, resourceRef, pinned);
      return pinned;
    })
    .finally(() => {
      if (cache.pending.get(key) === request) cache.pending.delete(key);
    });
  cache.pending.set(key, request);
  return request;
}

export async function loadResourcePinStates(
  client: CohubClient,
  resourceType: LabelResourceType,
  resourceRefs: readonly string[],
  options: { force?: boolean } = {},
) {
  const refs = [...new Set(resourceRefs.filter(Boolean))];
  const states: Record<string, boolean> = {};
  for (let start = 0; start < refs.length; start += PIN_LOOKUP_BATCH_SIZE) {
    const batch = refs.slice(start, start + PIN_LOOKUP_BATCH_SIZE);
    const entries = await Promise.all(
      batch.map(async (resourceRef) => [
        resourceRef,
        await getResourcePinState(client, resourceType, resourceRef, options),
      ] as const),
    );
    for (const [resourceRef, pinned] of entries) states[resourceRef] = pinned;
  }
  return states;
}

export async function toggleResourcePin(
  client: CohubClient,
  resourceType: LabelResourceType,
  resourceRef: string,
  currentPinned?: boolean,
) {
  const wasPinned = currentPinned ?? await getResourcePinState(client, resourceType, resourceRef);
  const result = await client.user.labels.patchResourceLabels(
    resourceType,
    resourceRef,
    wasPinned
      ? { removeLabelRefs: [PINNED_LABEL_REF] }
      : { addLabelRefs: [PINNED_LABEL_REF] },
  );
  const nextPinned = isResourcePinned(result.assignments);
  cachePinState(client, resourceType, resourceRef, nextPinned);
  return nextPinned;
}
