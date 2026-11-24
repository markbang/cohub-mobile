import type { BillingBalanceActivityList, BillingSubscriptionHistoryList, BillingSubscriptionHistoryStatus } from "@neta-art/cohub";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppActions } from "@/src/data/context";
import { fixtureSeed, usesFixtures } from "@/src/data/fixtures";
import { useTranslation } from "@/src/i18n";
import { useScreenQuery } from "./query";

type HistoryData = ({ kind: "history"; list: BillingBalanceActivityList } | { kind: "subscriptions"; list: BillingSubscriptionHistoryList }) & { page: number };
export type SubscriptionCancellation = { subscription: BillingSubscriptionHistoryStatus; kind: "checkout" | "renewal" };

export function useBillingHistory(kind: HistoryData["kind"]) {
  const { client } = useAppActions();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Balance activity pages by cursor; entry `n` opens page `n + 1`, so going back reuses a known cursor.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[page - 1] ?? null;
  const queryKey = ["billing", kind, page, cursor];
  // The UI snapshots' account has no subscriptions; the balance history is not seeded.
  const seeded = usesFixtures() && kind === "subscriptions" ? fixtureSeed().subscriptions : null;
  const query = useScreenQuery({
    queryKey,
    queryFn: async (): Promise<HistoryData> => kind === "history"
      ? { kind, page, list: (await client!.billing.getBalanceActivities({ cursor, limit: 20 })).activities }
      : { kind, page, list: seeded ?? (await client!.billing.getSubscriptions({ page, limit: 20 })).subscriptions },
    enabled: Boolean(client) || seeded !== null,
    initialData: seeded ? { kind: "subscriptions", page, list: seeded } : undefined,
    placeholderData: keepPreviousData,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadError = !client && !seeded ? t("settings.billing.connect") : query.error ? query.error.message || t("settings.billing.error") : null;

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
  const data = query.data?.page === page ? query.data : null;
  const nextCursor = data?.kind === "history" ? data.list.nextCursor : null;
  const nextPage = data?.kind === "subscriptions" && data.list.pagination.hasMore ? data.list.pagination.nextPage : null;
  const hasNext = nextCursor !== null || nextPage !== null;
  const next = () => {
    if (nextCursor !== null) {
      setCursors((current) => [...current.slice(0, page), nextCursor]);
      setPage(page + 1);
    } else if (nextPage !== null) setPage(nextPage);
  };
  const previous = () => setPage((current) => Math.max(1, current - 1));
  return { data, page, hasNext, next, previous, loading: Boolean(client) && query.isFetching && (query.isPending || query.isPlaceholderData), saving, error: saveError ?? loadError, load, cancel };
}
