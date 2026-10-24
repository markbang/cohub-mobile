import type { BillingCatalogProduct, SpaceWalletActivity, SpaceWalletSummary } from "@neta-art/cohub";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { appendWalletActivity } from "./space-wallet";
import { useSyncScope } from "./use-sync-scope";

type WalletCatalog = { supported: boolean; paymentAvailable: boolean; products: BillingCatalogProduct[] };
export type WalletPayment = "pending" | "settled" | "failed";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Checkout runs in the browser, so a pending payment is confirmed on refresh and polled meanwhile. */
export function useSpaceWallet(spaceId: string) {
  const { client, sync } = useApp();
  const key = `space:${spaceId}:wallet`;
  const [summary, setSummary] = useState<SpaceWalletSummary | null>(null);
  const [catalog, setCatalog] = useState<WalletCatalog | null>(null);
  const [activity, setActivity] = useState<{ items: SpaceWalletActivity[]; page: number; hasMore: boolean } | null>(null);
  const [errors, setErrors] = useState<{ summary: string | null; catalog: string | null; activity: string | null }>({ summary: null, catalog: null, activity: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [payment, setPayment] = useState<WalletPayment | null>(null);
  // An unsettled order per product is reused, so a retried checkout continues the same order.
  const orders = useRef(new Map<string, string>());
  const pendingOrder = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [client, spaceId]);

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

  const load = useCallback(async () => {
    if (!client) return;
    const request = generation.current;
    const wallet = client.space(spaceId).wallet;
    if (pendingOrder.current) await confirm().catch(() => undefined);
    const [nextSummary, firstPage, nextCatalog] = await Promise.allSettled([wallet.get(), wallet.activities(1), wallet.catalog()]);
    if (request !== generation.current) return;
    if (nextSummary.status === "fulfilled") setSummary(nextSummary.value);
    if (firstPage.status === "fulfilled") setActivity((current) => current && current.page > 1
      ? { ...current, items: appendWalletActivity(firstPage.value.items, { items: current.items, hasMore: current.hasMore }) }
      : { items: firstPage.value.items, page: 1, hasMore: firstPage.value.hasMore });
    if (nextCatalog.status === "fulfilled") setCatalog(nextCatalog.value);
    setErrors({
      summary: nextSummary.status === "rejected" ? message(nextSummary.reason) : null,
      catalog: nextCatalog.status === "rejected" ? message(nextCatalog.reason) : null,
      activity: firstPage.status === "rejected" ? message(firstPage.reason) : null,
    });
    if (nextSummary.status === "rejected") throw nextSummary.reason;
  }, [client, confirm, spaceId]);
  useSyncScope(key, load, payment === "pending" ? 15_000 : 60_000);

  const loadMore = async () => {
    if (!client || !activity?.hasMore || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    try {
      const next = await client.space(spaceId).wallet.activities(activity.page + 1);
      if (request !== generation.current) return;
      setActivity((current) => current ? { items: appendWalletActivity(current.items, next), page: current.page + 1, hasMore: next.hasMore } : current);
      setErrors((current) => ({ ...current, activity: null }));
    } catch (error) {
      if (request === generation.current) setErrors((current) => ({ ...current, activity: message(error) }));
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  };

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
    summary,
    catalog,
    activity,
    errors,
    loadingMore,
    buying,
    checkoutError,
    payment,
    reload: () => sync.invalidate(key),
    refresh: load,
    loadMore,
    startCheckout,
    dismissPayment: () => setPayment(null),
  };
}
