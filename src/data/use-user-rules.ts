import { HttpError, type SpaceRecord, type UserRulesResponse } from "@neta-art/cohub";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useApp } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";

export function useUserRules() {
  const { client, upsertSpace } = useApp();
  const { t } = useTranslation();
  const [data, setData] = useState<UserRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!client) { setError(t("settings.rules.connect")); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const rules = await client.user.getRules();
      if (current === generation.current) setData(rules);
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : t("settings.rules.error"));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [client, t]);
  useFocusEffect(useCallback(() => { void load(); return () => { generation.current += 1; }; }, [load]));
  const openHome = async (): Promise<SpaceRecord | null> => {
    if (!client || opening) return null;
    setOpening(true);
    setOpenError(null);
    const current = generation.current;
    try {
      const space = await client.spaces.ensureHome();
      upsertSpace(space);
      return current === generation.current ? space : null;
    } catch (caught) {
      if (current === generation.current) setOpenError(caught instanceof HttpError && caught.code === "home_space_name_taken" ? t("settings.rules.homeNameTaken") : t("settings.rules.openHomeFailed"));
      return null;
    } finally {
      if (current === generation.current) setOpening(false);
    }
  };
  return { data, loading, opening, error, openError, load, openHome };
}
