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

export const formatInrFromPaise = formatInr;

export function paiseToRupees(paise: number): number {
  return Number((paise / 100).toFixed(2));
}

export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === "string" ? Number(rupees.replace(/[^0-9.-]/g, "")) : rupees;
  if (!Number.isFinite(num)) {
    throw new Error("Invalid rupee amount");
  }
  return Math.round(num * 100);
}

/**
 * Computes the Indian Financial Year ("YY-YY", e.g. "26-27") strictly in `Asia/Kolkata` (IST, UTC+05:30)
 * so transactions between 00:00 and 05:29 IST on April 1st are never mis-assigned to the prior FY.
 */
export function computeIndianFinancialYearIst(date: Date | number = new Date()): string {
  const ts = typeof date === "number" ? date : date.getTime();
  const ist = new Date(ts + 5.5 * 3600_000);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1; // 1-12
  if (month >= 4) {
    return `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
  }
  return `${String(year - 1).slice(2)}-${String(year).slice(2)}`;
}

/**
 * Formats a Unix epoch timestamp as `YYYY-MM-DD` in `Asia/Kolkata` (IST).
 */
export function formatIstDateIso(ts: number): string {
  return new Date(ts + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Formats a timestamp explicitly in `Asia/Kolkata` (IST) so SSR and browser renders match.
 */
export function formatIstDateTime(
  ts: number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (ts === null || ts === undefined) return "-";
  const dateObj = typeof ts === "number" ? new Date(ts) : ts;
  if (Number.isNaN(dateObj.getTime())) return "-";
  return dateObj.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    ...options,
  });
}

export function formatIstDate(
  ts: number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (ts === null || ts === undefined) return "-";
  const dateObj = typeof ts === "number" ? new Date(ts) : ts;
  if (Number.isNaN(dateObj.getTime())) return "-";
  return dateObj.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
    ...options,
  });
}

export interface GstInvoiceDisplayTotals {
  isAdvanceReceipt: boolean;
  isCreditNote: boolean;
  isInterState: boolean;
  sacCode: string;
  docHeading: string;
  totalRowLabel: string;
  taxRegimeLabel: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalGstPaise: number;
  totalPaise: number;
  subtotalFormatted: string;
  cgstFormatted: string;
  sgstFormatted: string;
  igstFormatted: string;
  totalGstFormatted: string;
  totalFormatted: string;
}

export function computeGstInvoiceDisplayModel(input: {
  docType?: string | null;
  sacCode?: string | null;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}): GstInvoiceDisplayTotals {
  const isAdvanceReceipt = input.docType === "advance_receipt";
  const isCreditNote = input.docType === "credit_note";
  const isInterState = input.igstPaise !== 0;
  const sacCode = (input.sacCode || "998314").trim() || "998314";
  const totalGstPaise = input.cgstPaise + input.sgstPaise + input.igstPaise;
  const docHeading = isAdvanceReceipt
    ? "Advance Receipt Voucher (0% GST Deposit)"
    : isCreditNote
      ? "GST Credit Note (Sec. 34 CGST Act)"
      : "Tax Invoice (Original for Recipient)";
  const totalRowLabel = isCreditNote
    ? "Total Credited (INR)"
    : isAdvanceReceipt
      ? "Deposit Received (INR)"
      : "Total Payable (INR)";
  const taxRegimeLabel = isAdvanceReceipt
    ? "Prepaid Deposit (0% GST - Tax Invoice issued on usage)"
    : isInterState
      ? "Inter-State Supply (18% IGST)"
      : "Intra-State Supply (9% CGST + 9% SGST)";

  return {
    isAdvanceReceipt,
    isCreditNote,
    isInterState,
    sacCode,
    docHeading,
    totalRowLabel,
    taxRegimeLabel,
    subtotalPaise: input.subtotalPaise,
    cgstPaise: input.cgstPaise,
    sgstPaise: input.sgstPaise,
    igstPaise: input.igstPaise,
    totalGstPaise,
    totalPaise: input.totalPaise,
    subtotalFormatted: formatInr(input.subtotalPaise, { showDecimals: true }),
    cgstFormatted: formatInr(input.cgstPaise, { showDecimals: true }),
    sgstFormatted: formatInr(input.sgstPaise, { showDecimals: true }),
    igstFormatted: formatInr(input.igstPaise, { showDecimals: true }),
    totalGstFormatted: formatInr(totalGstPaise, { showDecimals: true }),
    totalFormatted: formatInr(input.totalPaise, { showDecimals: true }),
  };
}

/**
 * Neutralizes OWASP CSV / Spreadsheet Formula Injection (`=`, `+`, `-`, `@`, `\t`, `\r`)
 * while preserving numeric values and optional E.164 phone numbers (`+91...`).
 */
export function sanitizeCsvFormulaCell(
  value: unknown,
  opts?: { allowPhonePlus?: boolean }
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  const str = String(value);
  if (!str) return "";
  if (opts?.allowPhonePlus && /^\+\d{8,15}$/.test(str.trim())) {
    return str.trim();
  }
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function escapeCsvCellSafe(
  value: unknown,
  opts?: { alwaysQuote?: boolean; allowPhonePlus?: boolean }
): string {
  const safe = sanitizeCsvFormulaCell(value, { allowPhonePlus: opts?.allowPhonePlus });
  if (opts?.alwaysQuote || /[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
