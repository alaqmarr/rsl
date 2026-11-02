/**
 * All monetary amounts across RSL Marketing are stored as integer minor units
 * (paise for INR, cents for USD) to guarantee zero floating-point rounding drift.
 * Negative balances (overdraft down to -₹200.00) render cleanly as `-₹125.50`.
 */

export function formatInr(paise: number, options?: { compact?: boolean; showDecimals?: boolean }): string {
  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const absRupees = absPaise / 100;
  const sign = isNegative ? "-" : "";

  if (options?.compact) {
    if (absRupees >= 10000000) {
      return `${sign}₹${(absRupees / 10000000).toFixed(2)} Cr`;
    }
    if (absRupees >= 100000) {
      return `${sign}₹${(absRupees / 100000).toFixed(2)} L`;
    }
  }
  const hasSubRupee = absPaise % 100 !== 0;
  const fractionDigits =
    options?.showDecimals === false ? 0 : options?.showDecimals === true || hasSubRupee ? 2 : 0;

  const formattedPositive = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(absRupees);

  return isNegative && absPaise > 0 ? `-${formattedPositive}` : formattedPositive;
}

export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === "string" ? Number(rupees.replace(/[^0-9.-]/g, "")) : rupees;
  if (!Number.isFinite(num)) {
    throw new Error("Invalid rupee amount");
  }
  return Math.round(num * 100);
}
