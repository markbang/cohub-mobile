import type { BillingCatalogProduct, SpaceWalletActivity, SpaceWalletActivityPage } from "@neta-art/cohub";

/** Credits are stored at 1e-8 USD per unit. */
const CREDIT_UNIT_USD = 0.000_000_01;

export function walletProductBalanceUsd(product: BillingCatalogProduct): number {
  const benefits = product.display.creditBenefits;
  if (benefits.length > 0) return benefits.reduce((sum, benefit) => sum + benefit.cycleAmountUsd, 0);
  if (product.display.creditsAmount && product.display.creditsAmount > 0) return product.display.creditsAmount * CREDIT_UNIT_USD;
  return product.pricing.amountUsd;
}

const USD_DIGITS = new Map<number, Intl.NumberFormat>();

/**
 * Every amount in the app reads `$1,234.50` / `-$3.20` in every language: the currency is always USD,
 * and a Chinese locale's `US$` would make the same balance look different from screen to screen.
 * Usage settles in fractions of a cent, so ledger rows keep up to eight places while the balance keeps four.
 */
export function formatUsd(amount: number, maximumFractionDigits = 2): string {
  const value = Number.isFinite(amount) ? amount : 0;
  let digits = USD_DIGITS.get(maximumFractionDigits);
  if (!digits) {
    digits = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits });
    USD_DIGITS.set(maximumFractionDigits, digits);
  }
  const text = digits.format(Math.abs(value));
  // A value that rounds to zero carries no sign.
  return value < 0 && /[1-9]/.test(text) ? `-$${text}` : `$${text}`;
}

export function appendWalletActivity(current: readonly SpaceWalletActivity[], page: SpaceWalletActivityPage): SpaceWalletActivity[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.items.filter((item) => !seen.has(item.id))];
}
