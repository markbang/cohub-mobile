import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

type Snapshot = { enabled: boolean; loaded: boolean; error: string | null };

const OFF: Snapshot = { enabled: false, loaded: false, error: null };
// Keyed by account, so one person's Bot mode never carries over to the next sign-in on this device.
const storageKey = (userKey: string) => `cohub:mobile:bot-mode:v1:${userKey}`;
const snapshots = new Map<string, Snapshot>();
const requests = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function load(userKey: string) {
  if (snapshots.get(userKey)?.loaded || requests.has(userKey)) return;
  requests.set(userKey, AsyncStorage.getItem(storageKey(userKey)).then((value) => {
    // A choice saved while hydration is pending wins over the stored snapshot.
    if (!snapshots.get(userKey)?.loaded) snapshots.set(userKey, { enabled: value === "1", loaded: true, error: null });
  }, (cause: unknown) => {
    snapshots.set(userKey, { ...OFF, error: cause instanceof Error ? cause.message : "Unable to load the Bot mode setting." });
  }).finally(() => {
    requests.delete(userKey);
    notify();
  }));
}

export async function saveBotMode(userKey: string, enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(storageKey(userKey), enabled ? "1" : "0");
  snapshots.set(userKey, { enabled, loaded: true, error: null });
  notify();
}

export function useBotMode(userKey: string): Snapshot {
  const [snapshot, setSnapshot] = useState(() => snapshots.get(userKey) ?? OFF);
  useEffect(() => {
    const listener = () => setSnapshot(snapshots.get(userKey) ?? OFF);
    listeners.add(listener);
    load(userKey);
    listener();
    return () => { listeners.delete(listener); };
  }, [userKey]);
  return snapshot;
}
