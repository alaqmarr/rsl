"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ExternalLink, FileSpreadsheet, Inbox, Check, X } from "lucide-react";
import { formatInr } from "@rsl/core/money";
import { IosSpinner, sileo, StatusPill } from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import {
  dismissSupplierBillDraftJsonAction,
  importSupplierBillDraftJsonAction,
  syncCaGoogleSheetJsonAction,
} from "@/lib/actions";

export interface SupplierBillDraftRow {
  id: string;
  senderEmail: string;
  subject: string;
  supplierName: string;
  supplierGstin: string | null;
  billNumber: string | null;
  billDateIso: string | null;
  totalAmountPaise: number;
  status: string;
  createdAt: number;
}

export function TallyFreePowerToolsBar({
  canManageTally,
  supplierInboxEmail,
  supplierInboxReady,
  drafts,
  defaultCompanyName,
}: {
  canManageTally: boolean;
  supplierInboxEmail: string;
  supplierInboxReady: boolean;
  drafts: SupplierBillDraftRow[];
  defaultCompanyName?: string;
}) {
  const router = useRouter();
  const [isSyncingSheet, startSheetTransition] = useTransition();
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [fxCurrency, setFxCurrency] = useState("USD");
  const [fxAmount, setFxAmount] = useState("1000");
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [fxDate, setFxDate] = useState<string | null>(null);
  const [fxBusy, setFxBusy] = useState(false);

  const pendingDrafts = drafts.filter((d) => d.status === "pending_review");

  function handleSyncCaSheet() {
    startSheetTransition(async () => {
      const res = await syncCaGoogleSheetJsonAction();
      if (res.ok) {
        if (res.spreadsheetUrl) setSheetUrl(res.spreadsheetUrl);
        sileo.success({
          title: "CA Google Sheet Synced!",
          description: res.message,
          duration: 5000,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Google Sheets Sync Needed",
          description: res.message,
          duration: 5400,
        });
      }
    });
  }

  async function handleImportDraft(draftId: string) {
    setBusyDraftId(draftId);
    try {
      const fd = new FormData();
      fd.set("draftId", draftId);
      if (defaultCompanyName) fd.set("companyName", defaultCompanyName);
      const res = await importSupplierBillDraftJsonAction(fd);
      if (res.ok) {
        sileo.success({ title: "Imported to Tally!", description: res.message });
        router.refresh();
      } else {
        sileo.error({ title: "Import Failed", description: res.message });
      }
    } finally {
      setBusyDraftId(null);
    }
  }

  async function handleDismissDraft(draftId: string) {
    setBusyDraftId(draftId);
    try {
      const fd = new FormData();
      fd.set("draftId", draftId);
      await dismissSupplierBillDraftJsonAction(fd);
      router.refresh();
    } finally {
      setBusyDraftId(null);
    }
  }

  async function handleCheckForex() {
    setFxBusy(true);
    try {
      const res = await fetch(
        `/api/tools/lookup?kind=forex&from=${encodeURIComponent(fxCurrency)}&to=INR`
      );
      const json = (await res.json()) as {
        ok: boolean;
        result?: { rate: number; date: string };
      };
      if (json.ok && json.result) {
        setFxRate(json.result.rate);
        setFxDate(json.result.date);
      }
    } finally {
      setFxBusy(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 1. CA Live Google Sheets 4-Tab Sync */}
        <div className="flex flex-wrap items-center gap-2">
          {canManageTally && (
            <button
              type="button"
              disabled={isSyncingSheet}
              onClick={handleSyncCaSheet}
              className="rsl-btn-secondary inline-flex items-center gap-1.5 py-1.5 text-xs font-semibold"
            >
              {isSyncingSheet ? (
                <IosSpinner size="xs" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
              )}
              <span>Sync Live CA Google Sheet (4 Tabs)</span>
            </button>
          )}
          {sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <span>Open CA Sheet</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <a
              href="/api/oauth/google/start?purpose=google_sheets&returnTo=/tally"
              className="text-[11.5px] font-medium text-emerald-700 hover:underline"
            >
              Connect Google Sheets
            </a>
          )}
        </div>

        {/* 2. Vendor Email-to-Tally Address */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-3 py-1.5">
          <Inbox className="h-3.5 w-3.5 text-indigo-600" />
          <span className="text-zinc-600">Vendor Bill Inbox:</span>
          <code className="font-mono font-semibold text-slate-900">{supplierInboxEmail}</code>
          <CopyTextButton text={supplierInboxEmail} label="Copy" copiedLabel="Copied" />
          <StatusPill
            label={supplierInboxReady ? "Live Email Routing" : "Ready When Configured"}
            tone={supplierInboxReady ? "emerald" : "stone"}
          />
        </div>

        {/* 3. Live ECB Forex Converter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            value={fxAmount}
            onChange={(e) => setFxAmount(e.target.value)}
            className="rsl-input w-20 py-1 font-mono text-xs"
          />
          <select
            value={fxCurrency}
            onChange={(e) => {
              setFxCurrency(e.target.value);
              setFxRate(null);
            }}
            className="rsl-input py-1 text-xs"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="AED">AED</option>
            <option value="SGD">SGD</option>
            <option value="AUD">AUD</option>
            <option value="CAD">CAD</option>
          </select>
          <button
            type="button"
            disabled={fxBusy}
            onClick={handleCheckForex}
            className="rsl-btn-secondary inline-flex items-center gap-1 py-1 text-xs"
          >
            {fxBusy ? <IosSpinner size="xs" /> : <ArrowRightLeft className="h-3 w-3" />}
            <span>→ INR</span>
          </button>
          {fxRate !== null && (
            <span className="rounded-lg bg-emerald-50 px-2 py-1 font-mono font-semibold text-emerald-900">
              ₹{((Number(fxAmount) || 0) * fxRate).toLocaleString("en-IN", { maximumFractionDigits: 2 })}{" "}
              <span className="text-[10px] font-normal text-emerald-700">
                (@ ₹{fxRate.toFixed(2)} • {fxDate})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Pending Inbound Vendor Email Bills Ready for 1-Click Tally Purchase Import */}
      {pendingDrafts.length > 0 && (
        <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-3 space-y-2">
          <div className="font-bold text-slate-900">
            Inbound Supplier Bills Pending Tally Import ({pendingDrafts.length})
          </div>
          <div className="divide-y divide-indigo-200/50">
            {pendingDrafts.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div>
                  <span className="font-semibold text-slate-900">{d.supplierName}</span>{" "}
                  <span className="font-mono text-zinc-600">#{d.billNumber || "Bill"}</span>
                  {d.supplierGstin && (
                    <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-700">
                      GSTIN: {d.supplierGstin}
                    </span>
                  )}
                  <span className="ml-2 font-bold text-emerald-800">
                    {formatInr(d.totalAmountPaise, { showDecimals: true })}
                  </span>
                  <span className="ml-2 text-[11px] text-zinc-500">({d.senderEmail})</span>
                </div>
                {canManageTally && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyDraftId === d.id}
                      onClick={() => handleImportDraft(d.id)}
                      className="rsl-btn-primary inline-flex items-center gap-1 py-1 text-[11px]"
                    >
                      {busyDraftId === d.id ? (
                        <IosSpinner size="xs" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      <span>Import Purchase to Tally</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyDraftId === d.id}
                      onClick={() => handleDismissDraft(d.id)}
                      className="rsl-btn-secondary inline-flex items-center gap-1 py-1 text-[11px]"
                    >
                      <X className="h-3 w-3" />
                      <span>Dismiss</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
