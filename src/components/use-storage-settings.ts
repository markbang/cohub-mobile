import { useState } from "react";
import { setCacheRetention, useCacheRetention, type CacheRetention } from "@/src/data/cache-retention";
import { useApp } from "@/src/data/context";
import { useTranslation, type Translate } from "@/src/i18n";

export function useStorageSettings() {
  const { t } = useTranslation();
  const { state, clearCache, applyCacheRetention } = useApp();
  const retention = useCacheRetention();
  const [clearOpen, setClearOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmClearCache = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearCache();
      setClearOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("profile.clearCache.error"));
    } finally {
      setBusy(false);
    }
  };
  const selectRetention = async (next: CacheRetention) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setCacheRetention(next);
      await applyCacheRetention();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("profile.cacheRetention.error"));
    } finally {
      setBusy(false);
    }
  };
  const openClear = () => { setError(null); setClearOpen(true); };
  return { spaceCount: state.spaces.length, chatCount: state.sessions.length, retention, busy, error, clearOpen, openClear, closeClear: () => setClearOpen(false), confirmClearCache, selectRetention };
}

export function retentionLabel(option: CacheRetention, t: Translate): string {
  if (option === "1d") return t("profile.cacheRetention.option.oneDay");
  if (option === "forever") return t("profile.cacheRetention.option.forever");
  return t("profile.cacheRetention.option.days", { days: option === "7d" ? 7 : 30 });
}
