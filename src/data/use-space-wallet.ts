import type { BillingCatalogProduct, SpaceWalletActivity, SpaceWalletSummary } from "@neta-art/cohub";
import { randomUUID } from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { useAppActions } from "./context";
import { appendWalletActivity } from "./space-wallet";
import { usePagedQuery, useScreenQuery } from "./query";
import { useQueryClient } from "@tanstack/react-query";

type WalletCatalog = { supported: boolean; paymentAvailable: boolean; products: BillingCatalogProduct[] };
export type WalletPayment = "pending" | "settled" | "failed";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Checkout runs in the browser, so a pending payment is confirmed on refresh and polled meanwhile. */
export function useSpaceWallet(spaceId: string) {
  const { client } = useAppActions();
  const queryClient = useQueryClient();
  const scope = `space:${spaceId}:wallet`;
  const enabled = Boolean(client && spaceId);
  const [buying, setBuying] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [payment, setPayment] = useState<WalletPayment | null>(null);
  // An unsettled order per product is reused, so a retried checkout continues the same order.
  const orders = useRef(new Map<string, string>());
  const pendingOrder = useRef<string | null>(null);

  const confirm = useCallback(async () => {
    const orderId = pendingOrder.current;
    if (!client || !orderId) return;
    const result = await client.space(spaceId).wallet.confirmOrder(orderId);
    if (pendingOrder.current !== orderId) return;
    if (result.pending && !result.settled) { setPayment("pending"); return; }
    pendingOrder.current = null;
    for (const [product, id] of orders.current) if (id === orderId) orders.current.delete(product);
    setPayment(result.settled ? "settled" : "failed");
  }, [client, spaceId]);

  const summaryQuery = useScreenQuery({
    queryKey: [scope, "summary"],
    queryFn: async (): Promise<SpaceWalletSummary> => {
      // A pending checkout is confirmed before the balance is read, so a settled payment shows at once.
      if (pendingOrder.current) await confirm().catch(() => undefined);
      return client!.space(spaceId).wallet.get();
    },
    enabled,
    intervalMs: payment === "pending" ? 15_000 : 60_000,
  });
  const catalogQuery = useScreenQuery({
    queryKey: [scope, "catalog"],
    queryFn: (): Promise<WalletCatalog> => client!.space(spaceId).wallet.catalog(),
    enabled,
  });
  const activityList = usePagedQuery<SpaceWalletActivity>({
    queryKey: [scope, "activity"],
    enabled,
    intervalMs: 60_000,
    id: (item) => item.id,
    fetchPage: async (cursor) => {
      const page = cursor ? Number(cursor) : 1;
      const result = await client!.space(spaceId).wallet.activities(page);
      return { items: result.items, cursor: result.hasMore ? String(page + 1) : null };
    },
    // Later pages stay loaded under a refreshed first page.
    mergeHead: (loaded, head) => loaded.items.length > head.items.length
      ? { items: appendWalletActivity(head.items, { items: loaded.items, hasMore: loaded.cursor !== null }), cursor: loaded.cursor }
      : head,
  });
  const activity = activityList.items ? { items: activityList.items, hasMore: activityList.hasMore } : null;
  const errors = {
    summary: summaryQuery.error ? message(summaryQuery.error) : null,
    catalog: catalogQuery.error ? message(catalogQuery.error) : null,
    activity: activityList.loadMoreError ? message(activityList.loadMoreError) : activityList.query.error ? message(activityList.query.error) : null,
  };
  // Failures land in each section's error, so a pull-to-refresh only waits for the reads.
  const refresh = useCallback(() => queryClient.refetchQueries({ queryKey: [scope] }, { throwOnError: false }), [queryClient, scope]);
  const loadMore = () => activityList.loadMore().catch(() => undefined);

  const startCheckout = async (product: BillingCatalogProduct): Promise<string | null> => {
    if (!client || buying) return null;
    setBuying(product.key);
    setCheckoutError(null);
    const wallet = client.space(spaceId).wallet;
    try {
      let id = orders.current.get(product.key) ?? null;
      if (id) {
        const previous = await wallet.confirmOrder(id).catch(() => null);
        if (previous && (previous.settled || !previous.pending)) id = null;
      }
      id ??= randomUUID();
      orders.current.set(product.key, id);
      const { checkout, orderId } = await wallet.createOrder({ id, productKey: product.key });
      const url = checkout.checkoutUsable ? checkout.checkoutUrl : null;
      if (!url || !/^https?:\/\//i.test(url)) {
        orders.current.delete(product.key);
        setCheckoutError(checkout.message || null);
        return null;
      }
      pendingOrder.current = orderId;
      setPayment("pending");
      return url;
    } catch (error) {
      setCheckoutError(message(error));
      return null;
    } finally {
      setBuying(null);
    }
  };

  return {
    summary: summaryQuery.data ?? null,
    catalog: catalogQuery.data ?? null,
    activity,
    errors,
    loadingMore: activityList.loadingMore,
    buying,
    checkoutError,
    payment,
    reload: () => void queryClient.invalidateQueries({ queryKey: [scope] }),
    refresh,
    loadMore,
    startCheckout,
    dismissPayment: () => setPayment(null),
  };
}
