import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import type { SessionSourceFilter } from "./session-source";

const SOURCE_STORAGE_KEY = "cohub:mobile:session-filter-source:v1";
let source: SessionSourceFilter = "all";
let sourceLoaded = false;
let sourceError: string | null = null;
let sourceRequest: Promise<SessionSourceFilter> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Anything other than a known source filter is treated as the unfiltered default. */
export function parseSessionSourceFilter(raw: string | null): SessionSourceFilter {
  return raw === "web" || raw === "other" ? raw : "all";
}

export function loadSessionSourcePreference(): Promise<SessionSourceFilter> {
  if (sourceLoaded) return Promise.resolve(source);
  if (sourceRequest) return sourceRequest;
  sourceRequest = AsyncStorage.getItem(SOURCE_STORAGE_KEY).then((raw) => {
    // A setting saved while hydration is pending takes precedence over the stored snapshot.
    if (!sourceLoaded) source = parseSessionSourceFilter(raw);
    sourceLoaded = true;
    sourceError = null;
    notify();
    return source;
  }).catch((cause: unknown) => {
    sourceError = cause instanceof Error ? cause.message : "Unable to load the Chat source filter. Retry on the Chats tab.";
    notify();
    throw new Error(sourceError, { cause });
  }).finally(() => { sourceRequest = null; });
  return sourceRequest;
}

export async function saveSessionSourcePreference(next: SessionSourceFilter): Promise<void> {
  await AsyncStorage.setItem(SOURCE_STORAGE_KEY, next);
  source = next;
  sourceLoaded = true;
  sourceError = null;
  notify();
}

export function useSessionSourcePreference(): { filter: SessionSourceFilter; loaded: boolean; error: string | null } {
  const [value, setValue] = useState({ filter: source, loaded: sourceLoaded, error: sourceError });
  useEffect(() => {
    const listener = () => setValue({ filter: source, loaded: sourceLoaded, error: sourceError });
    listeners.add(listener);
    void loadSessionSourcePreference().catch(() => undefined);
    listener();
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}
