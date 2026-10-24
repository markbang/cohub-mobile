import type { BillingCatalogProduct, SpaceWalletActivity, SpaceWalletActivityPage } from "@neta-art/cohub";

/** Credits are stored at 1e-8 USD per unit. */
const CREDIT_UNIT_USD = 0.000_000_01;

export function walletProductBalanceUsd(product: BillingCatalogProduct): number {
  const benefits = product.display.creditBenefits;
  if (benefits.length > 0) return benefits.reduce((sum, benefit) => sum + benefit.cycleAmountUsd, 0);
  if (product.display.creditsAmount && product.display.creditsAmount > 0) return product.display.creditsAmount * CREDIT_UNIT_USD;
  return product.pricing.amountUsd;
}

/** Usage settles in fractions of a cent, so ledger rows keep up to eight places while the balance keeps four. */
export function formatWalletUsd(amount: number, locale: string, maximumFractionDigits = 2): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits }).format(value);
}

export function appendWalletActivity(current: readonly SpaceWalletActivity[], page: SpaceWalletActivityPage): SpaceWalletActivity[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.items.filter((item) => !seen.has(item.id))];
}
