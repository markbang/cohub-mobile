import type { BillingBalanceActivityList, BillingSubscriptionHistoryList, BillingSubscriptionHistoryStatus } from "@neta-art/cohub";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppActions } from "@/src/data/context";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";

type HistoryData = { kind: "history"; list: BillingBalanceActivityList } | { kind: "subscriptions"; list: BillingSubscriptionHistoryList };
export type SubscriptionCancellation = { subscription: BillingSubscriptionHistoryStatus; kind: "checkout" | "renewal" };

export function useBillingHistory(kind: HistoryData["kind"]) {
  const { client } = useAppActions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const queryKey = ["billing", kind, page];
  const query = useScreenQuery({
    queryKey,
    queryFn: async (): Promise<HistoryData> => kind === "history"
      ? { kind, list: (await client!.billing.getBalanceActivities({ page, limit: 20 })).activities }
      : { kind, list: (await client!.billing.getSubscriptions({ page, limit: 20 })).subscriptions },
    enabled: Boolean(client),
    placeholderData: keepPreviousData,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadError = !client ? t("settings.billing.connect") : query.error ? query.error.message || t("settings.billing.error") : null;

  const cancel = async ({ subscription, kind: action }: SubscriptionCancellation): Promise<boolean> => {
    if (!client || saving) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const result = action === "checkout"
        ? await client.billing.cancelSubscriptionCheckout(subscription.id)
        : await client.billing.cancelSubscriptionAutoRenew(subscription.id);
      queryClient.setQueryData<HistoryData>(queryKey, (previous) => previous?.kind === "subscriptions" ? { ...previous, list: { ...previous.list, items: previous.list.items.map((item) => item.id === subscription.id ? result.subscription : item) } } : previous);
      void queryClient.invalidateQueries({ queryKey: ["billing", "subscriptions"] });
      return true;
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : t("settings.billing.error"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const load = async () => { setSaveError(null); await query.refetch(); };
  return { data: query.data ?? null, page, setPage, loading: Boolean(client) && query.isFetching && (query.isPending || query.isPlaceholderData), saving, error: saveError ?? loadError, load, cancel };
}
