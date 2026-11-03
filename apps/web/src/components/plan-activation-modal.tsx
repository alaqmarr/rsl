"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { IosSpinner, sileo, useDialogFocusTrap } from "@rsl/ui";
import {
  instantActivateFromWalletAction,
  submitActivationModalAction,
} from "@/lib/actions";

export type ModalBillingCycle = "monthly" | "quarterly" | "yearly";

export interface PlanActivationModalProps {
  targetType: "service" | "bundle";
  targetKey: string;
  targetName: string;
  tagline?: string;
  includedItems?: string[];
  monthlyPaise: number;
  quarterlyPaise: number;
  yearlyPaise: number;
  defaultCycle?: ModalBillingCycle;
  walletBalancePaise?: number;
  hasCustomRate?: boolean;
  isUnlocked?: boolean;
  isPending?: boolean;
  pendingCycle?: string | null;
  workspaceSlug: string;
  buyerStateCode?: string;
  supplierStateCode?: string;
  billingSettings: {
    upiQrMode?: "bank_account" | "upi_id";
    upiId: string;
    payeeName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    gstin?: string;
  };
  triggerLabel?: string;
  triggerClassName?: string;
  fullWidthTrigger?: boolean;
  canManageBilling?: boolean;
}

const CYCLE_OPTIONS: Array<{
  key: ModalBillingCycle;
  label: string;
  shortLabel: string;
  periodSuffix: string;
  months: number;
}> = [
  { key: "monthly", label: "Monthly", shortLabel: "Monthly", periodSuffix: "/ mo", months: 1 },
  { key: "quarterly", label: "Quarterly", shortLabel: "Quarterly", periodSuffix: "/ 3 mo", months: 3 },
  { key: "yearly", label: "Yearly", shortLabel: "Yearly", periodSuffix: "/ yr", months: 12 },
];

function formatInrClient(paise: number, showDecimals = false): string {
  const val = Math.round(paise) / 100;
  return `₹${val.toLocaleString("en-IN", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

function sanitizeNote(raw: string, maxLen = 58): string {
  return raw
    .replace(/[^a-zA-Z0-9 .+\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizePayeeName(raw: string, maxLen = 50): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned || "RapidShift Labs";
}

function isValidClientVpa(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.includes("@")) return false;
  const domain = trimmed.split("@")[1] || "";
  if (domain.includes(".")) return false;
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/.test(trimmed);
}

function buildBankAccountUpiAddress(accountNumber: string, ifscCode: string): string {
  const cleanAccount = accountNumber.replace(/[^a-zA-Z0-9]/g, "");
  const cleanIfsc = ifscCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!cleanAccount || !cleanIfsc) return "";
  return `${cleanAccount}@${cleanIfsc}.ifsc.npci`;
}

export function PlanActivationModal({
  targetType,
  targetKey,
  targetName,
  tagline,
  includedItems = [],
  monthlyPaise,
  quarterlyPaise,
  yearlyPaise,
  defaultCycle = "monthly",
  walletBalancePaise,
  hasCustomRate = false,
  isUnlocked = false,
  isPending = false,
  pendingCycle,
  workspaceSlug,
  buyerStateCode,
  supplierStateCode,
  billingSettings,
  triggerLabel = "Request Activation",
  triggerClassName,
  fullWidthTrigger = false,
  canManageBilling = true,
}: PlanActivationModalProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [cycle, setCycle] = useState<ModalBillingCycle>(defaultCycle);
  const [utrRef, setUtrRef] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [qrSvg, setQrSvg] = useState<string>("");
  const [justRequested, setJustRequested] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [isSubmitting, startTransition] = useTransition();

  const effectivePending = isPending || justRequested;
  const effectiveUnlocked = isUnlocked || justUnlocked;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCycle(defaultCycle);
  }, [defaultCycle]);

  useDialogFocusTrap(dialogRef, open, () => {
    if (!isSubmitting) setOpen(false);
  });

  const subtotalPaise =
    cycle === "yearly"
      ? yearlyPaise
      : cycle === "quarterly"
        ? quarterlyPaise
        : monthlyPaise;

  const effectiveSupplierState =
    supplierStateCode?.trim() || billingSettings.gstin?.trim().slice(0, 2) || "27";
  const effectiveBuyerState = buyerStateCode?.trim() || effectiveSupplierState;
  const isIntraState = effectiveBuyerState === effectiveSupplierState;
  const cgstPaise = isIntraState ? Math.round(subtotalPaise * 0.09) : 0;
  const sgstPaise = isIntraState ? Math.round(subtotalPaise * 0.09) : 0;
  const igstPaise = isIntraState ? 0 : Math.round(subtotalPaise * 0.18);
  const gstPaise = cgstPaise + sgstPaise + igstPaise;
  const totalPayablePaise = subtotalPaise + gstPaise;
  const amountDecimalStr = (totalPayablePaise / 100).toFixed(2);

  const quarterlySavePct =
    monthlyPaise > 0
      ? Math.max(0, Math.round((1 - quarterlyPaise / (monthlyPaise * 3)) * 100))
      : 0;
  const yearlySavePct =
    monthlyPaise > 0
      ? Math.max(0, Math.round((1 - yearlyPaise / (monthlyPaise * 12)) * 100))
      : 0;

  const transactionNote = useMemo(() => {
    const cycleMeta = CYCLE_OPTIONS.find((c) => c.key === cycle) ?? CYCLE_OPTIONS[0]!;
    return sanitizeNote(
      ["RSL", workspaceSlug ? workspaceSlug.slice(0, 14) : "", targetName, cycleMeta.shortLabel]
        .filter(Boolean)
        .join(" ")
    );
  }, [cycle, targetName, workspaceSlug]);

  const cleanUpiId = billingSettings.upiId.trim();
  const hasValidVpa =
    isValidClientVpa(cleanUpiId) && cleanUpiId.toLowerCase() !== "billing@rslmarketing";
  const bankUpiAddress = useMemo(
    () => buildBankAccountUpiAddress(billingSettings.accountNumber, billingSettings.ifscCode),
    [billingSettings.accountNumber, billingSettings.ifscCode]
  );
  const isDemoBankDetails =
    billingSettings.accountNumber.trim() === "50200091827364" ||
    billingSettings.ifscCode.trim().toUpperCase() === "HDFC0001234";

  const initialQrMode: "upi_id" | "bank_account" = hasValidVpa
    ? billingSettings.upiQrMode === "bank_account" && !isDemoBankDetails
      ? "bank_account"
      : "upi_id"
    : bankUpiAddress
      ? "bank_account"
      : "upi_id";

  const [qrModeOverride, setQrModeOverride] = useState<"upi_id" | "bank_account" | null>(null);
  const effectiveQrMode = qrModeOverride ?? initialQrMode;

  const useBankAccountQr =
    effectiveQrMode === "bank_account"
      ? Boolean(bankUpiAddress)
      : !cleanUpiId && Boolean(bankUpiAddress);

  const payeeAddress = useBankAccountQr ? bankUpiAddress : cleanUpiId;

  const upiUri = useMemo(() => {
    const payeeName = sanitizePayeeName(billingSettings.payeeName || "RapidShift Labs");
    const encodedPa = encodeURIComponent(payeeAddress).replace(/%40/g, "@");
    const qs = [
      `pa=${encodedPa}`,
      `pn=${encodeURIComponent(payeeName)}`,
      `am=${amountDecimalStr}`,
      `cu=INR`,
      `tn=${encodeURIComponent(transactionNote)}`,
    ].join("&");
    return `upi://pay?${qs}`;
  }, [payeeAddress, billingSettings.payeeName, amountDecimalStr, transactionNote]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    QRCode.toString(upiUri, {
      type: "svg",
      margin: 1,
      width: 180,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0F172A",
        light: "#FFFFFF",
      },
    })
      .then((svg) => {
        if (active) setQrSvg(svg);
      })
      .catch(() => {
        if (active) setQrSvg("");
      });
    return () => {
      active = false;
    };
  }, [open, upiUri]);

  async function copyField(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      sileo.success({
        title: `Copied ${label}`,
        description: text,
        duration: 2400,
      });
    } catch {
      sileo.error({ title: `Could not copy ${label}` });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("targetType", targetType);
    fd.set("targetKey", targetKey);
    fd.set("billingCycle", cycle);
    if (utrRef.trim()) fd.set("customerPaymentRef", utrRef.trim());
    if (customerNote.trim()) fd.set("customerNote", customerNote.trim());

    startTransition(async () => {
      const res = await submitActivationModalAction(fd);
      if (res.ok) {
        setJustRequested(true);
        setOpen(false);
        sileo.success({
          title: "Activation Requested",
          description: res.message,
          duration: 4800,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could not submit request",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  function handleInstantWalletUnlock() {
    const fd = new FormData();
    fd.set("targetType", targetType);
    fd.set("targetKey", targetKey);
    fd.set("billingCycle", cycle);

    startTransition(async () => {
      const res = await instantActivateFromWalletAction(fd);
      if (res.ok) {
        setJustUnlocked(true);
        setOpen(false);
        sileo.success({
          title: "Plan Unlocked Instantly",
          description: res.message,
          duration: 5200,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could not unlock from wallet",
          description: res.message,
          duration: 5200,
        });
      }
    });
  }

  if (effectiveUnlocked) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={`rsl-btn-secondary cursor-default opacity-75 ${fullWidthTrigger ? "w-full" : ""}`}
      >
        Active on Account
      </button>
    );
  }

  if (effectivePending) {
    const cycleSuffix =
      pendingCycle === "yearly"
        ? " (Yearly)"
        : pendingCycle === "quarterly"
          ? " (Quarterly)"
          : "";
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Your activation request is awaiting payment verification by our billing desk."
        className={`rsl-btn-secondary cursor-not-allowed bg-amber-50/70 text-amber-900 border-amber-200 opacity-75 ${
          fullWidthTrigger ? "w-full" : ""
        }`}
      >
        Activation Requested{cycleSuffix}
      </button>
    );
  }

  if (!canManageBilling) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Owner, Admin, or Billing permission is required to request paid plan activation."
        className={`rsl-btn-secondary cursor-not-allowed opacity-75 ${
          fullWidthTrigger ? "w-full" : ""
        }`}
      >
        Ask Owner / Billing to Activate
      </button>
    );
  }

  const selectedCycleLabel =
    cycle === "yearly"
      ? "Yearly (12 Months)"
      : cycle === "quarterly"
        ? "Quarterly (3 Months)"
        : "Monthly";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          `rsl-btn-primary ${fullWidthTrigger ? "w-full" : ""}`
        }
      >
        {triggerLabel}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[3px] sm:p-5 animate-fadeIn"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmitting) {
                setOpen(false);
              }
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`modal-title-${targetKey}`}
              className="max-h-[92vh] w-full max-w-[920px] overflow-x-hidden overflow-y-auto rounded-2xl border border-zinc-200/90 bg-white shadow-[0_28px_72px_-12px_rgba(15,23,42,0.28)]"
            >
              {/* Clean Top Header */}
              <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 sm:px-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                      {targetType === "bundle" ? "Bundle Package" : "Feature Plan"}
                    </span>
                    {hasCustomRate && (
                      <span className="rounded-md border border-sky-200/80 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                        Custom Client Rate
                      </span>
                    )}
                  </div>
                  <h2
                    id={`modal-title-${targetKey}`}
                    className="mt-1 text-lg font-bold tracking-tight text-slate-900"
                  >
                    {targetName}
                  </h2>
                  {tagline && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                      {tagline}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                  className="rsl-btn-secondary shrink-0 px-3 py-1.5 text-xs"
                >
                  Close
                </button>
              </div>

              {/* Balanced Two-Pane Checkout Body */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                {/* LEFT PANE: Included Summary, Cycle Selector, GST Breakdown & Confirmation */}
                <div className="flex min-w-0 flex-col justify-between gap-5 p-5 sm:p-6">
                  <div className="space-y-4">
                    {/* Compact Included Items */}
                    {includedItems.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
                          {targetType === "bundle"
                            ? `Unlocks ${includedItems.length} Integrated Tools`
                            : "Included Capabilities"}
                        </p>
                        <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                          {includedItems.slice(0, 6).map((item) => (
                            <li
                              key={item}
                              className="flex min-w-0 items-start gap-2 text-xs leading-snug text-slate-700"
                            >
                              <span
                                aria-hidden="true"
                                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                              />
                              <span className="min-w-0 break-words">{item}</span>
                            </li>
                          ))}
                        </ul>
                        {includedItems.length > 6 && (
                          <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
                            +{includedItems.length - 6} additional tools included in this package
                          </p>
                        )}
                      </div>
                    )}

                    {/* Billing Cycle Selector */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800">
                          Select Billing Cycle
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          Prices exclude 18% GST
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {CYCLE_OPTIONS.map((opt) => {
                          const active = cycle === opt.key;
                          const optPaise =
                            opt.key === "yearly"
                              ? yearlyPaise
                              : opt.key === "quarterly"
                                ? quarterlyPaise
                                : monthlyPaise;
                          const badge =
                            opt.key === "yearly" && yearlySavePct > 0
                              ? `Save ${yearlySavePct}%`
                              : opt.key === "quarterly" && quarterlySavePct > 0
                                ? `Save ${quarterlySavePct}%`
                                : null;

                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => setCycle(opt.key)}
                              className={`flex min-w-0 flex-col items-start rounded-xl border px-3 py-2.5 text-left transition ${
                                active
                                  ? "border-emerald-600 bg-emerald-50/45 shadow-[0_0_0_1px_rgba(5,150,105,0.22)]"
                                  : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/60"
                              }`}
                            >
                              <div className="flex w-full min-w-0 items-center justify-between gap-1">
                                <span className="truncate text-xs font-semibold text-slate-900">
                                  {opt.label}
                                </span>
                                {badge && (
                                  <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                    {badge}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex items-baseline gap-1 tabular-nums">
                                <span className="text-[15px] font-bold text-slate-900">
                                  {formatInrClient(optPaise)}
                                </span>
                                <span className="text-[11px] text-zinc-500">
                                  {opt.periodSuffix}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Crisp Tax & Payable Summary */}
                    <div className="rounded-xl border border-zinc-200/80 bg-[#F8F9FB] px-4 py-3.5 text-xs">
                      <div className="flex items-center justify-between gap-3 text-zinc-600">
                        <span className="min-w-0 truncate">
                          Plan Subtotal ({selectedCycleLabel})
                        </span>
                        <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                          {formatInrClient(subtotalPaise, true)}
                        </span>
                      </div>
                      {isIntraState ? (
                        <>
                          <div className="mt-1.5 flex items-center justify-between gap-3 text-zinc-600">
                            <span className="min-w-0 truncate">
                              CGST (9% Intra-State • State {effectiveBuyerState})
                            </span>
                            <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                              {formatInrClient(cgstPaise, true)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-3 text-zinc-600">
                            <span className="min-w-0 truncate">
                              SGST (9% Intra-State • SAC 998314)
                            </span>
                            <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                              {formatInrClient(sgstPaise, true)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-zinc-600">
                          <span className="min-w-0 truncate">
                            IGST (18% Inter-State • POS {effectiveBuyerState} • SAC 998314)
                          </span>
                          <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                            {formatInrClient(igstPaise, true)}
                          </span>
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-zinc-200/75 pt-2.5">
                        <span className="font-bold text-slate-900">Total Payable Now</span>
                        <span className="shrink-0 text-[17px] font-extrabold text-emerald-700 tabular-nums">
                          {formatInrClient(totalPayablePaise, true)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[10.5px] text-zinc-500">
                        Exact paise-rounded tax split matches your statutory GST Tax Invoice to the single paisa.
                      </p>
                    </div>

                    {/* Instant 1-Click Prepaid Wallet Checkout (5.2 / UX-11) */}
                    {walletBalancePaise !== undefined && walletBalancePaise >= totalPayablePaise && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/75 p-3.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-emerald-950">
                              Instant Activation Ready from Prepaid Wallet
                            </div>
                            <div className="mt-0.5 text-[11px] text-emerald-900/90 tabular-nums">
                              Available balance: {formatInrClient(walletBalancePaise, true)} • Unlocks immediately + issues GST Invoice
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={handleInstantWalletUnlock}
                            className="rsl-btn-primary min-h-10 shrink-0 px-3.5 py-2 text-xs"
                          >
                            {isSubmitting ? "Activating..." : `Pay ${formatInrClient(totalPayablePaise, true)} from Wallet`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirmation Form */}
                  <form
                    onSubmit={handleSubmit}
                    className="space-y-3.5 border-t border-zinc-100 pt-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <label
                          htmlFor={`utr-ref-${targetKey}`}
                          className="mb-1 block text-[11px] font-semibold text-slate-700"
                        >
                          UTR / Bank Ref # (Optional)
                        </label>
                        <input
                          id={`utr-ref-${targetKey}`}
                          type="text"
                          value={utrRef}
                          onChange={(e) => setUtrRef(e.target.value)}
                          placeholder="12-digit UTR if already paid"
                          className="rsl-input min-h-10 text-xs"
                        />
                      </div>
                      <div className="min-w-0">
                        <label
                          htmlFor={`note-ref-${targetKey}`}
                          className="mb-1 block text-[11px] font-semibold text-slate-700"
                        >
                          Note for Billing Desk (Optional)
                        </label>
                        <input
                          id={`note-ref-${targetKey}`}
                          type="text"
                          value={customerNote}
                          onChange={(e) => setCustomerNote(e.target.value)}
                          placeholder="Any GST or setup note"
                          className="rsl-input min-h-10 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                      <p className="text-[11px] text-zinc-500">
                        18% GST tax invoice issued upon verification.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOpen(false)}
                          disabled={isSubmitting}
                          className="rsl-btn-secondary px-3.5 py-2 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="rsl-btn-primary px-4 py-2 text-xs"
                        >
                          {isSubmitting ? (
                            <span className="inline-flex items-center gap-2">
                              <IosSpinner size="xs" className="text-white" />
                              <span>Submitting...</span>
                            </span>
                          ) : (
                            "Submit Activation Request"
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>

                {/* RIGHT PANE: Scannable UPI QR & Bank Account Details */}
                <div className="flex min-w-0 flex-col justify-between gap-4 border-t border-zinc-200/80 bg-[#F8F9FB] p-5 sm:p-6 lg:border-t-0 lg:border-l">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        {useBankAccountQr
                          ? "Scan UPI QR • Bank + IFSC"
                          : "Scan Verified UPI QR Code"}
                      </span>
                      {cleanUpiId && bankUpiAddress ? (
                        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-[10.5px] font-semibold">
                          <button
                            type="button"
                            onClick={() => setQrModeOverride("upi_id")}
                            className={`rounded-md px-2 py-0.5 transition ${
                              !useBankAccountQr
                                ? "bg-slate-900 text-white"
                                : "text-zinc-600 hover:text-slate-900"
                            }`}
                          >
                            UPI ID QR
                          </button>
                          <button
                            type="button"
                            onClick={() => setQrModeOverride("bank_account")}
                            className={`rounded-md px-2 py-0.5 transition ${
                              useBankAccountQr
                                ? "bg-slate-900 text-white"
                                : "text-zinc-600 hover:text-slate-900"
                            }`}
                          >
                            Bank QR
                          </button>
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          Amount Pre-Set
                        </span>
                      )}
                    </div>

                    {/* Elevated QR Card */}
                    <div className="mt-2.5 flex flex-col items-center rounded-2xl border border-zinc-200/90 bg-white px-4 py-3.5 text-center shadow-2xs">
                      {qrSvg ? (
                        <div
                          data-testid="upi-qr-svg"
                          data-upi-uri={upiUri}
                          data-upi-mode={useBankAccountQr ? "bank_account" : "upi_id"}
                          className="h-[168px] w-[168px] [&>svg]:h-full [&>svg]:w-full"
                          dangerouslySetInnerHTML={{ __html: qrSvg }}
                        />
                      ) : (
                        <div className="flex h-[168px] w-[168px] items-center justify-center">
                          <IosSpinner size="md" />
                        </div>
                      )}

                      <div className="mt-2.5 flex w-full flex-col gap-2">
                        <a
                          href={upiUri}
                          className="rsl-btn-primary inline-flex min-h-11 w-full items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold"
                        >
                          <span>Pay {formatInrClient(totalPayablePaise, true)} in UPI App →</span>
                        </a>
                      </div>

                      <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                        {useBankAccountQr
                          ? "Direct Bank-over-UPI QR (@IFSC.ifsc.npci). If GPay/PhonePe camera asks for a UPI ID, use 'Pay Bank / IFSC' with the account details below."
                          : `Scan with GPay, PhonePe, Paytm, BHIM, or any UPI app (${cleanUpiId})`}
                      </p>

                      {useBankAccountQr && isDemoBankDetails && (
                        <div className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50/90 px-2.5 py-1.5 text-left text-[10.5px] leading-snug text-amber-950">
                          <strong>Setup Note:</strong> Demo account (<code className="font-mono">50200091827364</code>) is active. Save your live UPI ID or Bank Account in <strong>Staff Admin → Pricing</strong> so UPI scanners fetch your Banking Name.
                        </div>
                      )}

                      {useBankAccountQr && !isDemoBankDetails && !hasValidVpa && (
                        <div className="mt-2 w-full rounded-lg border border-amber-200/90 bg-amber-50/80 px-2.5 py-1.5 text-left text-[10.5px] leading-snug text-amber-950">
                          <strong>Scanner Tip:</strong> Most UPI cameras cannot resolve Banking Name on <code className="font-mono">@IFSC.ifsc.npci</code> QRs. Use <strong>Pay Bank / IFSC</strong> in your UPI app with the account below, or add your UPI ID (VPA) in <strong>Staff Admin → Pricing</strong>.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Unified Bank Account & Payment Reference Card */}
                  <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-200/90 bg-white divide-y divide-zinc-100 text-xs">
                    <div className="flex items-center justify-between gap-2.5 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                          Beneficiary • {billingSettings.bankName}
                        </span>
                        <span className="block truncate font-semibold text-slate-900">
                          {billingSettings.payeeName}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField("Beneficiary Name", billingSettings.payeeName)}
                        className="rsl-btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                      >
                        Copy
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2.5 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                          Bank Account Number
                        </span>
                        <code className="block truncate font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {billingSettings.accountNumber}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField("Account Number", billingSettings.accountNumber)}
                        className="rsl-btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                      >
                        Copy
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2.5 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                          IFSC Code (UPI &amp; IMPS / NEFT)
                        </span>
                        <code className="block truncate font-mono text-xs font-semibold text-slate-900">
                          {billingSettings.ifscCode}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField("IFSC Code", billingSettings.ifscCode)}
                        className="rsl-btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                      >
                        Copy
                      </button>
                    </div>

                    {cleanUpiId && (
                      <div className="flex items-center justify-between gap-2.5 px-3.5 py-2">
                        <div className="min-w-0 flex-1">
                          <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                            UPI ID (VPA)
                          </span>
                          <code className="block truncate font-mono text-xs font-semibold text-slate-900">
                            {cleanUpiId}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyField("UPI ID", cleanUpiId)}
                          className="rsl-btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                        >
                          Copy
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2.5 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold tracking-wider text-zinc-400 uppercase">
                          Transaction Note (Pre-Set in QR)
                        </span>
                        <code
                          title={transactionNote}
                          className="block truncate font-mono text-[11px] font-medium text-slate-700"
                        >
                          {transactionNote}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyField("Transaction Note", transactionNote)}
                        className="rsl-btn-secondary shrink-0 px-2.5 py-1 text-[11px]"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
