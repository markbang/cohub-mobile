import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { botOnly } from "./bot-mode-preference";
import type { SessionInitiatorFilter } from "./session-initiator";

/** The Bots view sits in the filter menu while Bot mode is on; it is not a server filter. */
export type ChatsSource = SessionInitiatorFilter | "bots";

const SOURCE_STORAGE_KEY = "cohub:mobile:session-filter-source:v1";
let source: ChatsSource = botOnly ? "bots" : "all";
let sourceLoaded = botOnly;
let sourceError: string | null = null;
let sourceRequest: Promise<ChatsSource> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Anything other than a known filter is treated as the unfiltered default. The retired `web` source filter
 * reads as Human, as on the web; `other` mixed people on channels with automations, so it widens to every Chat.
 */
export function parseSessionSourceFilter(raw: string | null): ChatsSource {
  if (raw === "web") return "human";
  return raw === "human" || raw === "agent" || raw === "automation" || raw === "bots" ? raw : "all";
}

export function loadSessionSourcePreference(): Promise<ChatsSource> {
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

export async function saveSessionSourcePreference(next: ChatsSource): Promise<void> {
  await AsyncStorage.setItem(SOURCE_STORAGE_KEY, next);
  source = next;
  sourceLoaded = true;
  sourceError = null;
  notify();
}

export function useSessionSourcePreference(): { filter: ChatsSource; loaded: boolean; error: string | null } {
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
