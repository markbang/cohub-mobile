import type { CohubClient } from "@neta-art/cohub";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { beginConfigTheme } from "@/src/theme";
import { createConfigThemeSync } from "./config-theme-sync";
import { clearConfigThemeCache, loadConfigThemeCache, saveConfigThemeCache } from "./local-db";
import type { SyncScheduler } from "./sync-scheduler";
import type { SpaceRealtime } from "./space-realtime";

export function useConfigTheme(client: CohubClient | null, userKey: string, sync: SyncScheduler, realtime: SpaceRealtime | null): () => Promise<void> {
  const owner = useRef<ReturnType<typeof beginConfigTheme> | null>(null);
  const current = useRef<ReturnType<typeof createConfigThemeSync> | null>(null);
  useLayoutEffect(() => {
    const session = beginConfigTheme();
    owner.current = session;
    return () => {
      session.dispose();
      current.current?.dispose();
      void current.current?.clearStored().catch((error: unknown) => console.warn("[config-theme] failed to clear signed-out theme cache", error));
    };
  }, [userKey]);
  useEffect(() => {
    const session = owner.current;
    if (!client || !session || !realtime) return;
    let watched: string | null = null;
    let stopWatching: (() => void) | null = null;
    const theme = createConfigThemeSync({
      client,
      cache: {
        read: () => loadConfigThemeCache(userKey),
        write: (value) => saveConfigThemeCache(userKey, value),
        clear: () => clearConfigThemeCache(userKey),
      },
      publish: session.update,
      watchSpace(spaceId) {
        if (watched === spaceId) return;
        stopWatching?.();
        watched = spaceId;
        stopWatching = spaceId ? realtime.watch([spaceId]) : null;
      },
    });
    current.current = theme;
    void theme.hydrate();
    const stopSync = sync.watch("config-theme", { run: theme.refresh, intervalMs: () => 60_000, minRefreshMs: 1000 });
    const stopEvents = client.onUserEvent((event) => {
      if (event.type === "space.fs.changed" && event.spaceId === watched) sync.invalidate("config-theme");
    });
    return () => { stopEvents(); stopSync(); theme.dispose(); };
  }, [client, realtime, sync, userKey]);
  return useCallback(async () => {
    await current.current?.clear();
    sync.invalidate("config-theme");
  }, [sync]);
}
