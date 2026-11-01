import type { CohubClient, ReferralDashboard } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";

const REFERRALS_KEY = ["referrals"];

export function useReferrals(client: CohubClient | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useScreenQuery({ queryKey: REFERRALS_KEY, queryFn: (): Promise<ReferralDashboard> => client!.referrals.getMine(), enabled: Boolean(client) });
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const loadError = !client ? t("settings.referrals.connect") : query.error ? query.error.message || t("settings.referrals.error") : null;
  const rotate = async (): Promise<boolean> => {
    if (!client || rotating) return false;
    setRotating(true);
    setRotateError(null);
    try {
      const { code } = await client.referrals.rotateCode();
      queryClient.setQueryData<ReferralDashboard>(REFERRALS_KEY, (previous) => previous ? { ...previous, code } : previous);
      return true;
    } catch (caught) {
      setRotateError(caught instanceof Error ? caught.message : t("settings.referrals.error"));
      return false;
    } finally {
      setRotating(false);
    }
  };
  return { data: query.data ?? null, loading: Boolean(client) && query.isPending, rotating, error: rotateError ?? loadError, load: async () => { setRotateError(null); await query.refetch(); }, rotate };
}
