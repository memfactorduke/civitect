/**
 * Display formatting — strictly a UI concern (TDD §1: "sim never formats
 * for display"). Money arrives as integer cents (ADR-005) and stays integer
 * until the last possible moment.
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-US");

/** Integer cents → whole-currency display ("$1,235" from 123456). */
export function formatFundsCents(fundsCents: number): string {
  return usd.format(Math.trunc(fundsCents / 100));
}

export function formatCount(n: number): string {
  return count.format(n);
}

/** Signed whole-currency for report lines (income +, expense −). */
export function formatSignedCents(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${usd.format(Math.abs(Math.trunc(cents / 100)))}`;
}
