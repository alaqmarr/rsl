"use client";

import React, { useMemo, useState } from "react";
import { SectionCard, StatusPill } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";

export interface WhatsAppRatesClientView {
  utilityPaise: number;
  marketingPaise: number;
  authenticationPaise: number;
  tallyPdfBillPaise: number;
  serviceReplyPaise: number;
  metaUtilityCostPaise: number;
  metaMarketingCostPaise: number;
  metaAuthCostPaise: number;
  hasWorkspaceOverride?: boolean;
}

function formatInrPaiseClient(paise: number, showDecimals = true): string {
  const neg = paise < 0 ? "-" : "";
  return `${neg}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

interface RateRowProps {
  label: string;
  sublabel: string;
  chargeName: string;
  costName?: string;
  chargeRupees: number;
  onChargeChange: (v: number) => void;
  costRupees?: number;
  onCostChange?: (v: number) => void;
}

function MarginRow({
  label,
  sublabel,
  chargeName,
  costName,
  chargeRupees,
  onChargeChange,
  costRupees = 0,
  onCostChange,
}: RateRowProps) {
  const profitRupees = chargeRupees - costRupees;
  const marginPct = chargeRupees > 0 ? Math.round((profitRupees / chargeRupees) * 100) : 0;
  const isLoss = profitRupees < 0;

  return (
    <tr className="hover:bg-[var(--surface-inset)]/60">
      <td className="px-5 py-3.5 sm:px-6">
        <div className="font-semibold text-[var(--ink)]">{label}</div>
        <div className="text-xs text-[var(--ink-muted)]">{sublabel}</div>
      </td>
      <td className="px-4 py-3.5">
        {costName && onCostChange ? (
          <input
            name={costName}
            type="number"
            min="0"
            step="0.01"
            value={Number.isFinite(costRupees) ? costRupees : 0}
            onChange={(e) => onCostChange(Number.parseFloat(e.target.value) || 0)}
            className="adm-input w-28 tabular-nums"
            aria-label={`${label} Meta cost rupees`}
          />
        ) : (
          <span className="font-mono text-xs text-[var(--ink-muted)]">
            {formatInrPaiseClient(Math.round(costRupees * 100))}
          </span>
        )}
      </td>
      <td className="px-4 py-3.5">
        <input
          name={chargeName}
          type="number"
          min="0"
          step="0.01"
          value={Number.isFinite(chargeRupees) ? chargeRupees : 0}
          onChange={(e) => onChargeChange(Number.parseFloat(e.target.value) || 0)}
          className="adm-input w-28 font-semibold tabular-nums"
          aria-label={`${label} client charge rupees`}
        />
      </td>
      <td className="px-4 py-3.5 font-semibold tabular-nums">
        <span className={isLoss ? "text-[var(--danger)]" : "text-[var(--brand)]"}>
          {profitRupees >= 0 ? "+" : ""}
          {formatInrPaiseClient(Math.round(profitRupees * 100))} / msg
        </span>
      </td>
      <td className="px-5 py-3.5 text-right sm:px-6">
        <StatusPill
          label={chargeRupees === 0 && costRupees === 0 ? "Free Pass" : `${marginPct}% margin`}
          tone={isLoss ? "ruby" : profitRupees > 0 ? "emerald" : "stone"}
        />
      </td>
    </tr>
  );
}

export function WhatsAppRatesMarginCard({
  initialRates,
  saveAction,
  clearAction,
  workspaceId,
  returnTo,
  mode = "global",
}: {
  initialRates: WhatsAppRatesClientView;
  saveAction: (formData: FormData) => void;
  clearAction?: (formData: FormData) => void;
  workspaceId?: string;
  returnTo: string;
  mode?: "global" | "client";
}) {
  const [utility, setUtility] = useState(initialRates.utilityPaise / 100);
  const [marketing, setMarketing] = useState(initialRates.marketingPaise / 100);
  const [auth, setAuth] = useState(initialRates.authenticationPaise / 100);
  const [tallyBill, setTallyBill] = useState(initialRates.tallyPdfBillPaise / 100);
  const [serviceReply, setServiceReply] = useState(initialRates.serviceReplyPaise / 100);

  const [metaUtilityCost, setMetaUtilityCost] = useState(initialRates.metaUtilityCostPaise / 100);
  const [metaMarketingCost, setMetaMarketingCost] = useState(
    initialRates.metaMarketingCostPaise / 100
  );
  const [metaAuthCost, setMetaAuthCost] = useState(initialRates.metaAuthCostPaise / 100);

  const blendedProfitPer1k = useMemo(() => {
    const utilProfit = (utility - metaUtilityCost) * 600;
    const mktProfit = (marketing - metaMarketingCost) * 300;
    const authProfit = (auth - metaAuthCost) * 100;
    return Math.round((utilProfit + mktProfit + authProfit) * 100);
  }, [utility, marketing, auth, metaUtilityCost, metaMarketingCost, metaAuthCost]);

  const isClient = mode === "client";

  return (
    <SectionCard
      title={
        isClient
          ? "Custom Per-Client WhatsApp Messaging Rates & Profit"
          : "WhatsApp Per-Message Rates & Profit Margins"
      }
      subtitle={
        isClient
          ? "Override global per-message WhatsApp charges for this specific client (or reset to use catalog rates)"
          : "Configure exact per-message wallet charges across Meta categories (synced to whatsapp.messaging, whatsapp.broadcast & tally.invoicing)"
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          {isClient && initialRates.hasWorkspaceOverride ? (
            <StatusPill label="Custom Client Override Active" tone="amber" />
          ) : isClient ? (
            <StatusPill label="Using Global Catalog Rates" tone="emerald" />
          ) : (
            <StatusPill
              label={`Est. ${formatInrPaiseClient(blendedProfitPer1k, false)} profit / 1k msgs`}
              tone={blendedProfitPer1k >= 0 ? "emerald" : "ruby"}
            />
          )}
        </div>
      }
      noPadding
    >
      <form action={saveAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        {workspaceId && <input type="hidden" name="workspaceId" value={workspaceId} />}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wider text-[var(--ink-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 sm:px-6">Message Category / Trigger</th>
                <th className="px-4 py-3">Meta Cost Benchmark (₹)</th>
                <th className="px-4 py-3">Client Rate (₹)</th>
                <th className="px-4 py-3">Profit / Msg</th>
                <th className="px-5 py-3 text-right sm:px-6">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
              <MarginRow
                label="Utility Templates"
                sublabel="Order alerts, reminders & 1-to-1 utility templates (whatsapp.messaging)"
                chargeName="utilityRupees"
                costName={!isClient ? "metaUtilityCostRupees" : undefined}
                chargeRupees={utility}
                onChargeChange={setUtility}
                costRupees={metaUtilityCost}
                onCostChange={!isClient ? setMetaUtilityCost : undefined}
              />
              <MarginRow
                label="Marketing / Bulk Broadcasts"
                sublabel="Promotional offers & broadcast campaigns (whatsapp.broadcast)"
                chargeName="marketingRupees"
                costName={!isClient ? "metaMarketingCostRupees" : undefined}
                chargeRupees={marketing}
                onChargeChange={setMarketing}
                costRupees={metaMarketingCost}
                onCostChange={!isClient ? setMetaMarketingCost : undefined}
              />
              <MarginRow
                label="Authentication / OTP"
                sublabel="Customer login & verification OTP templates"
                chargeName="authenticationRupees"
                costName={!isClient ? "metaAuthCostRupees" : undefined}
                chargeRupees={auth}
                onChargeChange={setAuth}
                costRupees={metaAuthCost}
                onCostChange={!isClient ? setMetaAuthCost : undefined}
              />
              <MarginRow
                label="Tally PDF Bill Dispatches"
                sublabel="Auto-sent Tally Prime GST invoices & payment receipts (tally.invoicing)"
                chargeName="tallyPdfBillRupees"
                chargeRupees={tallyBill}
                onChargeChange={setTallyBill}
                costRupees={metaUtilityCost}
              />
              <MarginRow
                label="24h Service Care Replies"
                sublabel="Freeform Team Inbox replies within active customer service window"
                chargeName="serviceReplyRupees"
                chargeRupees={serviceReply}
                onChargeChange={setServiceReply}
                costRupees={0}
              />
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-5 py-3.5 text-xs sm:px-6">
          <span className="text-[var(--ink-secondary)]">
            Blended gross profit estimate (60% Utility, 30% Marketing, 10% Auth):{" "}
            <strong className="text-[var(--ink)] tabular-nums">
              {formatInrPaiseClient(blendedProfitPer1k, false)}
            </strong>{" "}
            per 1,000 messages delivered.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton
              className="adm-btn-primary py-1.5 text-xs"
              spinnerSize="xs"
              pendingText="Saving Rates..."
            >
              {isClient ? "Save Client WhatsApp Rates" : "Save Global WhatsApp Rates"}
            </SubmitButton>
          </div>
        </div>
      </form>
      {isClient && initialRates.hasWorkspaceOverride && clearAction && workspaceId && (
        <form
          action={clearAction}
          className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-3 text-xs sm:px-6"
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <span className="text-[var(--ink-muted)]">
            Want this workspace to inherit global Admin catalog rates again?
          </span>
          <SubmitButton
            className="adm-btn-secondary py-1 text-xs"
            spinnerSize="xs"
            pendingText="Resetting..."
          >
            Reset to Global Rates
          </SubmitButton>
        </form>
      )}
    </SectionCard>
  );
}
