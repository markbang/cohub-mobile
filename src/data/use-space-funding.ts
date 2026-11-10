import { HttpError, type SpaceWalletFunding, type SpaceWalletFundingTier, type SpaceWalletTransferStatus } from "@neta-art/cohub";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "@/src/i18n/core";
import { formatUsd } from "./space-wallet";
import { useAppActions } from "./context";
import { useScreenQuery } from "./query";

export type FundMethod = "balance" | "checkout";

/** Which way a tier is paid: balance first when it covers the amount, unless the funder asked to pay online. */
export function fundMethod(funding: SpaceWalletFunding, amountUsd: number, isTier: boolean, preferCheckout: boolean): FundMethod | null {
  const balance = Boolean(funding.transfer && amountUsd <= funding.transfer.allowanceUsd);
  if (!isTier) return balance ? "balance" : null;
  if (funding.checkout && (preferCheckout || !balance)) return "checkout";
  return balance ? "balance" : null;
}

/** Why a typed amount cannot be sent from balance, or null when it can. */
export function customAmountError(funding: SpaceWalletFunding, value: string): string | null {
  const transfer = funding.transfer;
  if (!transfer || !value.trim()) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < transfer.minUsd || amount > transfer.maxUsd) {
    return translate("wallet.fund.invalidAmount", { min: formatUsd(transfer.minUsd), max: formatUsd(transfer.maxUsd) });
  }
  if (amount > transfer.allowanceUsd) return translate("wallet.fund.insufficient", { amount: formatUsd(transfer.allowanceUsd, 2) });
  return null;
}

const TRANSFER_POLLS = 12;
const TRANSFER_POLL_MS = 5_000;

/**
 * Funds a Space wallet from purchased balance or online checkout. Each amount keeps its request id until
 * the server settles it, so a retry continues the same transfer and can never debit twice.
 */
export function useSpaceFunding(spaceId: string) {
  const { client } = useAppActions();
  const queryClient = useQueryClient();
  const key = [`space:${spaceId}:wallet`, "funding"];
  const fundingQuery = useScreenQuery({
    queryKey: key,
    queryFn: (): Promise<SpaceWalletFunding> => client!.space(spaceId).wallet.funding(),
    enabled: Boolean(client && spaceId),
  });
  const requestIds = useRef(new Map<string, string>());
  const pendingOrder = useRef<string | null>(null);
  const disposed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SpaceWalletTransferStatus | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; }; }, []);

  const takeId = (ref: string) => {
    const existing = requestIds.current.get(ref);
    if (existing) return existing;
    const id = randomUUID();
    requestIds.current.set(ref, id);
    return id;
  };
  const settled = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [`space:${spaceId}:wallet`] });
  }, [queryClient, spaceId]);

  const watch = useCallback(async (id: string, ref: string) => {
    if (!client) return;
    for (let attempt = 1; attempt <= TRANSFER_POLLS && !disposed.current; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, TRANSFER_POLL_MS));
      const status = await client.space(spaceId).wallet.getTransfer(id).catch(() => null);
      if (!status || status.state === "processing" || disposed.current) continue;
      if (status.state === "none" && attempt < TRANSFER_POLLS) continue;
      // Nothing was charged yet, so the same id stays safe to retry.
      if (status.state !== "none") requestIds.current.delete(ref);
      setResult(status);
      if (status.state === "none") setNotice(translate("wallet.fund.notCharged"));
      settled();
      return;
    }
  }, [client, settled, spaceId]);

  const payFromBalance = async (amountUsd: number) => {
    if (!client) return;
    const ref = String(amountUsd);
    const id = takeId(ref);
    try {
      const status = await client.space(spaceId).wallet.transfer({ id, amountUsd });
      if (status.state !== "processing") requestIds.current.delete(ref);
      setResult(status);
      if (status.state === "processing") void watch(id, ref);
      else settled();
    } catch (error) {
      const code = error instanceof HttpError ? error.code : null;
      if (code === "transfer_insufficient" || code === "transfer_amount_invalid") requestIds.current.delete(ref);
      const allowance = fundingQuery.data?.transfer?.allowanceUsd ?? 0;
      setNotice(code === "transfer_busy" ? translate("wallet.fund.busy")
        : code === "transfer_insufficient" ? translate("wallet.fund.insufficient", { amount: formatUsd(allowance, 2) })
        : code === "transfer_unavailable" ? translate("wallet.fund.unavailable")
        : translate("wallet.fund.failed"));
      settled();
    }
  };

  /** Returns the checkout URL to open; the order is confirmed when the funder comes back. */
  const startCheckout = async (tier: SpaceWalletFundingTier): Promise<string | null> => {
    if (!client) return null;
    const wallet = client.space(spaceId).wallet;
    let id = takeId(`checkout:${tier.productKey}`);
    const previous = await wallet.confirmOrder(id).catch(() => null);
    if (previous && (previous.settled || !previous.pending)) {
      requestIds.current.delete(`checkout:${tier.productKey}`);
      id = takeId(`checkout:${tier.productKey}`);
    }
    try {
      const { checkout, orderId } = await wallet.createOrder({ id, productKey: tier.productKey });
      const url = checkout.checkoutUsable ? checkout.checkoutUrl : null;
      if (!url || !/^https?:\/\//i.test(url)) {
        requestIds.current.delete(`checkout:${tier.productKey}`);
        setNotice(checkout.message || translate("space.wallet.checkoutFailed"));
        return null;
      }
      pendingOrder.current = orderId;
      setCheckoutPending(true);
      return url;
    } catch {
      setNotice(translate("space.wallet.checkoutFailed"));
      return null;
    }
  };

  const confirmCheckout = useCallback(async () => {
    const orderId = pendingOrder.current;
    if (!client || !orderId) return;
    const status = await client.space(spaceId).wallet.confirmOrder(orderId).catch(() => null);
    if (!status || (status.pending && !status.settled)) return;
    pendingOrder.current = null;
    setCheckoutPending(false);
    for (const [ref, id] of requestIds.current) if (id === orderId) requestIds.current.delete(ref);
    if (status.settled) settled();
    else setNotice(translate("space.wallet.paymentFailed"));
  }, [client, settled, spaceId]);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try { await work(); } finally { setBusy(false); }
  };

  return {
    funding: fundingQuery.data ?? null,
    loading: fundingQuery.isPending && fundingQuery.isFetching,
    error: fundingQuery.error ? fundingQuery.error.message || translate("wallet.fund.unavailable") : null,
    reload: () => void fundingQuery.refetch(),
    busy,
    notice,
    result,
    checkoutPending,
    payFromBalance: (amountUsd: number) => run(() => payFromBalance(amountUsd)),
    startCheckout,
    run,
    confirmCheckout,
    reset: () => { setResult(null); setNotice(null); },
  };
}
