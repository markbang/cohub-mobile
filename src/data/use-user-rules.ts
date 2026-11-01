import { HttpError, type SpaceRecord, type UserRulesResponse } from "@neta-art/cohub";
import { useState } from "react";
import { useAppActions } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";

export function useUserRules() {
  const { client, upsertSpace } = useAppActions();
  const { t } = useTranslation();
  const query = useScreenQuery({ queryKey: ["user-rules"], queryFn: (): Promise<UserRulesResponse> => client!.user.getRules(), enabled: Boolean(client) });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const error = !client ? t("settings.rules.connect") : query.error ? query.error.message || t("settings.rules.error") : null;
  const openHome = async (): Promise<SpaceRecord | null> => {
    if (!client || opening) return null;
    setOpening(true);
    setOpenError(null);
    try {
      const space = await client.spaces.ensureHome();
      upsertSpace(space);
      return space;
    } catch (caught) {
      setOpenError(caught instanceof HttpError && caught.code === "home_space_name_taken" ? t("settings.rules.homeNameTaken") : t("settings.rules.openHomeFailed"));
      return null;
    } finally {
      setOpening(false);
    }
  };
  return { data: query.data ?? null, loading: Boolean(client) && query.isPending, opening, error, openError, load: async () => { await query.refetch(); }, openHome };
}
