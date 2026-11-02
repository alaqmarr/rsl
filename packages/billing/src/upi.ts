import QRCode from "qrcode";

export type BillingCycle = "monthly" | "quarterly" | "yearly";
export type UpiQrRoutingMode = "bank_account" | "upi_id";

export const BILLING_CYCLE_META: Record<
  BillingCycle,
  {
    label: string;
    shortLabel: string;
    suffix: string;
    months: number;
    durationDays: number;
    defaultDiscountPct: number;
  }
> = {
  monthly: {
    label: "Monthly",
    shortLabel: "Monthly",
    suffix: "/mo",
    months: 1,
    durationDays: 30,
    defaultDiscountPct: 0,
  },
  quarterly: {
    label: "Quarterly (3 Months)",
    shortLabel: "Quarterly",
    suffix: "/qtr",
    months: 3,
    durationDays: 90,
    defaultDiscountPct: 10,
  },
  yearly: {
    label: "Yearly (12 Months)",
    shortLabel: "Yearly",
    suffix: "/yr",
    months: 12,
    durationDays: 365,
    defaultDiscountPct: 20,
  },
};

export function normalizeBillingCycle(raw: unknown): BillingCycle {
  const s = String(raw || "monthly").trim().toLowerCase();
  if (s === "quarterly" || s === "yearly") return s;
  return "monthly";
}

export function computeDefaultCycleAmountsPaise(monthlyPaise: number): {
  monthlyPaise: number;
  quarterlyPaise: number;
  yearlyPaise: number;
} {
  const base = Math.max(0, Math.round(monthlyPaise));
  // Round to nearest whole rupee (100 paise) for clean Indian invoices
  const quarterlyRupees = Math.round((base / 100) * 3 * 0.9);
  const yearlyRupees = Math.round((base / 100) * 12 * 0.8);
  return {
    monthlyPaise: base,
    quarterlyPaise: quarterlyRupees * 100,
    yearlyPaise: yearlyRupees * 100,
  };
}

export function sanitizeUpiTransactionNote(raw: string, maxLen = 58): string {
  return raw
    .replace(/[^a-zA-Z0-9 .+\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitizes beneficiary / payee name (`pn=`) for NPCI `upi://pay` URIs.
 * Punctuation such as `&`, `=`, `/`, or `(` can break PSP `ReqValAdd` parsing on BHIM / PhonePe / GPay.
 */
export function sanitizeUpiPayeeName(raw: string, maxLen = 50): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned || "RapidShift Labs";
}

const RBI_IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/;
const DEMO_ACCOUNT_NUMBERS = new Set(["50200091827364", "000000000000", "123456789012"]);
const DEMO_IFSC_CODES = new Set(["HDFC0001234", "SBIN0000000", "ICIC0000000"]);
const DEMO_VPAS = new Set([
  "billing@rslmarketing",
  "demo@upi",
  "test@upi",
  "merchant@upi",
]);

export function isValidRbiIfsc(rawIfsc: string): boolean {
  const clean = rawIfsc.trim().toUpperCase();
  return RBI_IFSC_REGEX.test(clean);
}

export function isEmailLikeHandle(rawVpa: string): boolean {
  const trimmed = rawVpa.trim().toLowerCase();
  if (!trimmed.includes("@")) return false;
  if (trimmed.endsWith(".ifsc.npci")) return false;
  const domain = trimmed.split("@")[1] || "";
  return domain.includes(".");
}

export function isValidUpiVpa(rawVpa: string): boolean {
  const trimmed = rawVpa.trim();
  if (!trimmed || isEmailLikeHandle(trimmed)) return false;
  return UPI_VPA_REGEX.test(trimmed);
}

export interface UpiPayeeDiagnostics {
  hasValidVpa: boolean;
  hasValidBankAccount: boolean;
  ifscFormatValid: boolean;
  vpaLooksLikeEmail: boolean;
  isDemoBankPlaceholder: boolean;
  isDemoVpaPlaceholder: boolean;
  isDemoActiveTarget: boolean;
  recommendedMode: UpiQrRoutingMode;
  bankingNameWarning: string | null;
}

/**
 * Diagnoses why a UPI camera scan might display "Could not fetch banking name" (NPCI `ReqValAdd` failure).
 * - Registered VPA handles (`name@okhdfcbank`, `merchant@icici`, `98XXXXXXXX@ybl`) resolve verified Banking Name
 *   across 100% of UPI apps (GPay, PhonePe, Paytm, BHIM, CRED).
 * - Demo placeholders (`50200091827364` / `HDFC0001234` / `billing@rslmarketing`) or email addresses (`@domain.in`)
 *   do not exist in live NPCI CBS records, causing UPI apps to reject with "Could not fetch banking name".
 * - Several consumer camera scanners (GPay / PhonePe) also restrict `<Acc>@<IFSC>.ifsc.npci` inside QR scans
 *   unless a registered UPI ID (VPA) is used.
 */
export function diagnoseUpiPayeeConfig(config: {
  upiQrMode?: UpiQrRoutingMode;
  upiId?: string;
  accountNumber?: string;
  ifscCode?: string;
}): UpiPayeeDiagnostics {
  const rawVpa = (config.upiId || "").trim();
  const cleanVpaLower = rawVpa.toLowerCase();
  const cleanAcc = (config.accountNumber || "").replace(/[^a-zA-Z0-9]/g, "");
  const cleanIfsc = (config.ifscCode || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  const vpaLooksLikeEmail = isEmailLikeHandle(rawVpa);
  const isDemoVpaPlaceholder = Boolean(rawVpa) && DEMO_VPAS.has(cleanVpaLower);
  const hasValidVpa = isValidUpiVpa(rawVpa) && !isDemoVpaPlaceholder;

  const ifscFormatValid = isValidRbiIfsc(cleanIfsc);
  const isDemoBankPlaceholder =
    DEMO_ACCOUNT_NUMBERS.has(cleanAcc) || DEMO_IFSC_CODES.has(cleanIfsc);
  const hasValidBankAccount =
    cleanAcc.length >= 6 && cleanAcc.length <= 18 && ifscFormatValid && !isDemoBankPlaceholder;

  const recommendedMode: UpiQrRoutingMode = hasValidVpa ? "upi_id" : "bank_account";
  const effectiveMode = config.upiQrMode ?? recommendedMode;

  const isDemoActiveTarget =
    effectiveMode === "upi_id"
      ? !hasValidVpa && (isDemoVpaPlaceholder || (!rawVpa && isDemoBankPlaceholder))
      : isDemoBankPlaceholder;

  let bankingNameWarning: string | null = null;
  if (vpaLooksLikeEmail) {
    bankingNameWarning =
      `The UPI ID "${rawVpa}" looks like an email address (contains a domain dot). Enter an active bank UPI handle such as yourname@okhdfcbank, company@icici, or 98XXXXXXXX@ybl so UPI apps can fetch your verified Banking Name.`;
  } else if (isDemoActiveTarget) {
    bankingNameWarning =
      "Demo receiving credentials (50200091827364 / HDFC0001234) are currently active. UPI apps (GPay, PhonePe, Paytm, BHIM) show 'Could not fetch banking name' on demo numbers because NPCI verifies the live beneficiary bank record on every scan. Save your real active UPI ID (recommended) and Bank Account in Staff Admin → Pricing.";
  } else if (effectiveMode === "bank_account" && !ifscFormatValid && cleanIfsc) {
    bankingNameWarning =
      `IFSC "${cleanIfsc}" is not a valid 11-character RBI IFSC (the 5th character must be 0, e.g. HDFC0000123). Invalid IFSCs cause UPI scanners to fail banking name lookup.`;
  } else if (effectiveMode === "bank_account" && !hasValidVpa) {
    bankingNameWarning =
      "QR is currently using Bank-over-UPI (@IFSC.ifsc.npci). Note: Google Pay & PhonePe camera scanners often require a standard UPI ID (e.g. business@okhdfcbank or 98XXXXXXXX@ybl) to fetch your Banking Name via QR. Add your UPI ID in Staff Admin → Pricing for 100% app compatibility.";
  }

  return {
    hasValidVpa,
    hasValidBankAccount,
    ifscFormatValid,
    vpaLooksLikeEmail,
    isDemoBankPlaceholder,
    isDemoVpaPlaceholder,
    isDemoActiveTarget,
    recommendedMode,
    bankingNameWarning,
  };
}

/**
 * Formats a bank account number + 11-char IFSC code into the official NPCI
 * Bank-Account-over-UPI pseudo-VPA (`<AccountNumber>@<IFSC>.ifsc.npci`).
 */
export function formatBankAccountUpiAddress(
  accountNumber: string,
  ifscCode: string
): string {
  const cleanAccount = accountNumber.replace(/[^a-zA-Z0-9]/g, "");
  const cleanIfsc = ifscCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!cleanAccount || !cleanIfsc) {
    return "";
  }
  return `${cleanAccount}@${cleanIfsc}.ifsc.npci`;
}

export interface UpiPaymentPayload {
  routingMode: UpiQrRoutingMode;
  payeeAddress: string;
  upiId: string;
  payeeName: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  subtotalPaise: number;
  gstPaise: number;
  totalPayablePaise: number;
  amountRupeesFormatted: string;
  transactionNote: string;
  upiUri: string;
}

/**
 * Builds an NPCI-compliant `upi://pay` URI with exact 2-decimal INR amount (including 18% GST)
 * and a clean, traceable Transaction Note (`tn`).
 *
 * Supports direct Bank Account + IFSC over UPI (`<AccountNo>@<IFSC>.ifsc.npci`, default when
 * accountNumber + ifscCode are provided) as well as standard VPA handles (`name@bank`).
 */
export function buildUpiPaymentPayload(params: {
  routingMode?: UpiQrRoutingMode;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  upiId?: string;
  payeeName: string;
  subtotalPaise: number;
  includeGst?: boolean;
  workspaceSlug?: string;
  itemLabel: string;
  billingCycle?: BillingCycle;
  customNote?: string;
}): UpiPaymentPayload {
  const includeGst = params.includeGst !== false;
  const subtotalPaise = Math.max(0, Math.round(params.subtotalPaise));
  const gstPaise = includeGst ? Math.round(subtotalPaise * 0.18) : 0;
  const totalPayablePaise = subtotalPaise + gstPaise;
  const amountRupeesFormatted = (totalPayablePaise / 100).toFixed(2);

  const cycleTag = params.billingCycle
    ? BILLING_CYCLE_META[params.billingCycle].shortLabel
    : "";
  const defaultNote = [
    "RSL",
    params.workspaceSlug ? params.workspaceSlug.slice(0, 14) : "",
    params.itemLabel,
    cycleTag,
  ]
    .filter(Boolean)
    .join(" ");

  const transactionNote = sanitizeUpiTransactionNote(params.customNote || defaultNote);
  const payeeName = sanitizeUpiPayeeName(params.payeeName || "RapidShift Labs");

  const bankPayeeAddress =
    params.accountNumber && params.ifscCode
      ? formatBankAccountUpiAddress(params.accountNumber, params.ifscCode)
      : "";

  const cleanVpa = (params.upiId || "").trim();
  const preferVpaByDefault = isValidUpiVpa(cleanVpa) && !DEMO_VPAS.has(cleanVpa.toLowerCase());

  const useBankAccount =
    params.routingMode === "bank_account"
      ? Boolean(bankPayeeAddress)
      : params.routingMode === "upi_id"
        ? !cleanVpa && Boolean(bankPayeeAddress)
        : preferVpaByDefault
          ? false
          : Boolean(bankPayeeAddress);

  const resolvedMode: UpiQrRoutingMode = useBankAccount ? "bank_account" : "upi_id";
  const payeeAddress = useBankAccount ? bankPayeeAddress : cleanVpa;

  // Keep `@` literal in `pa=` per RFC 3986 pchar & Indian UPI QR scanner compatibility
  const encodedPa = encodeURIComponent(payeeAddress).replace(/%40/g, "@");

  const query = [
    `pa=${encodedPa}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${amountRupeesFormatted}`,
    `cu=INR`,
    `tn=${encodeURIComponent(transactionNote)}`,
  ].join("&");

  return {
    routingMode: resolvedMode,
    payeeAddress,
    upiId: payeeAddress,
    payeeName,
    bankName: params.bankName?.trim(),
    accountNumber: params.accountNumber?.trim(),
    ifscCode: params.ifscCode?.trim().toUpperCase(),
    subtotalPaise,
    gstPaise,
    totalPayablePaise,
    amountRupeesFormatted,
    transactionNote,
    upiUri: `upi://pay?${query}`,
  };
}

/**
 * Generates a crisp standalone SVG string for a `upi://pay` URI.
 */
export async function generateUpiQrSvg(upiUri: string): Promise<string> {
  return QRCode.toString(upiUri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
    color: {
      dark: "#0F172A",
      light: "#FFFFFF",
    },
  });
}
