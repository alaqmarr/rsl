import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  MessageSquareShare,
  Package,
  Pencil,
  Wallet,
} from "lucide-react";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getTallyWorkspaceSummary, getWorkspacePartyLedgerDetail } from "@rsl/tally";
import {
  AccessRestrictedState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ConfirmWhatsAppReminderButton } from "@/components/confirm-whatsapp-reminder";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import {
  markTallyBillPaidAction,
  recordTallyVoucherAction,
  sendBillWhatsAppAction,
  upsertWorkspacePartyLedgerAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function TallyPartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const { partyId } = await params;
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, `/tally/parties/${partyId}`, session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Party Ledger Statement"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Tally bills & aging"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return (
      <FeaturePlanGate
        pageTitle="Client & Supplier Ledger Statement"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect chronological party running balances, bill-wise settlements, and downloadable PDF statements."
        plans={plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  let detail;
  try {
    detail = getWorkspacePartyLedgerDetail(session.workspace.id, partyId);
  } catch {
    notFound();
  }

  const tallyOverview = getTallyWorkspaceSummary(session.workspace.id);
  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const canSendTallyWhatsApp = canRolePerform(
    session.roleSlug,
    "tally:invoice.send",
    session.workspace.id
  );
  const hasInvoicingEntitlement = hasActiveEntitlement(session.workspace.id, "tally.invoicing");

  const activeTab =
    sp.tab === "bills" || sp.tab === "items" || sp.tab === "record" || sp.tab === "edit"
      ? sp.tab
      : "statement";
  const safeTab =
    (activeTab === "record" || activeTab === "edit") && !canManageTally ? "statement" : activeTab;

  const { party, totals } = detail;
  const creditLimitBreached =
    party.creditLimitPaise > 0 && party.closingBalancePaise > party.creditLimitPaise;
  const nowMs = Date.now();
  const todayIso = new Date().toISOString().slice(0, 10);
  const selfPath = `/tally/parties/${encodeURIComponent(party.id)}`;

  const waStatementMessage = encodeURIComponent(
    `Namaste ${party.name},\n\nAccount Summary with ${session.workspace.name} (${detail.companyName}):\n• Closing Balance: ${formatInr(totals.closingAbsPaise)}${totals.closingDrCr !== "Nil" ? ` (${totals.closingDrCr})` : ""}\n• Open Bills: ${detail.openBills.length}\n\nThank you for your business.`
  );
  const waShareHref = party.phoneE164
    ? `https://wa.me/${party.phoneE164.replace(/\D/g, "")}?text=${waStatementMessage}`
    : null;

  const subTabs = [
    {
      key: "statement" as const,
      label: `Running Balance Statement (${detail.statementRows.length})`,
    },
    {
      key: "bills" as const,
      label: `Bill-Wise Paid & Pending (${detail.allBills.length})`,
    },
    {
      key: "items" as const,
      label: `Item Purchase History (${detail.itemHistory.length})`,
    },
    ...(canManageTally
      ? [
          {
            key: "record" as const,
            label: detail.isCreditor ? "+ Record Payment / Bill" : "+ Record Receipt / Bill",
          },
          {
            key: "edit" as const,
            label: "Edit Party Details",
          },
        ]
      : []),
  ];

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="parties"
        vouchersCount={tallyOverview.vouchers.length}
        partiesCount={tallyOverview.totals.partiesCount}
        stockItemsCount={tallyOverview.totals.stockItemsCount}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <ActionLink
          href="/tally/parties"
          spinnerSize="xs"
          className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Client &amp; Supplier Ledgers</span>
        </ActionLink>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-medium text-slate-700">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{detail.companyName}</span>
          </span>
          {party.gstin && (
            <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-mono font-semibold text-slate-800">
              GSTIN: {party.gstin}
            </span>
          )}
        </div>
      </div>

      <PageHeader
        eyebrow={`${party.parentGroup} • Tally Ledger Statement`}
        badge={
          <StatusPill
            label={
              totals.closingAbsPaise === 0
                ? "Account Settled"
                : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`
            }
            tone={
              creditLimitBreached
                ? "ruby"
                : totals.closingSignedPaise > 0
                  ? "amber"
                  : "emerald"
            }
          />
        }
        title={party.name}
        subtitle={[
          party.phoneE164 ? `WhatsApp: ${party.phoneE164}` : "No WhatsApp mobile saved",
          party.email ? `Email: ${party.email}` : null,
          party.stateName ? `State: ${party.stateName}` : null,
          `Credit Terms: ${party.creditDays} days${
            party.creditLimitPaise > 0 ? ` • Limit: ${formatInr(party.creditLimitPaise)}` : ""
          }`,
        ]
          .filter(Boolean)
          .join("  •  ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/pdf/party-ledger?partyId=${encodeURIComponent(party.id)}`}
              className="rsl-btn-primary"
            >
              <Download className="mr-1.5 inline h-3.5 w-3.5" />
              Download Statement PDF
            </a>
            <a
              href={`/api/pdf/party-ledger?partyId=${encodeURIComponent(party.id)}&inline=1`}
              target="_blank"
              rel="noreferrer"
              className="rsl-btn-secondary"
            >
              <FileText className="mr-1.5 inline h-3.5 w-3.5" />
              Preview PDF
            </a>
            {waShareHref && (
              <a
                href={waShareHref}
                target="_blank"
                rel="noreferrer"
                className="rsl-btn-secondary"
              >
                <MessageSquareShare className="mr-1.5 inline h-3.5 w-3.5 text-emerald-600" />
                Share Balance on WhatsApp
              </a>
            )}
            {canManageTally && (
              <ActionLink
                href={`${selfPath}?tab=edit`}
                spinnerSize="xs"
                className="rsl-btn-secondary"
              >
                <Pencil className="mr-1 inline h-3.5 w-3.5" />
                Edit Profile
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {creditLimitBreached && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/85 px-5 py-3.5 text-xs text-rose-950">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>
              <strong>Credit Limit Breach Alert:</strong> Closing receivable balance (
              <strong>{formatInr(totals.closingAbsPaise)} Dr</strong>) exceeds this party&rsquo;s
              configured Tally credit limit of <strong>{formatInr(party.creditLimitPaise)}</strong>{" "}
              by{" "}
              <strong>
                {formatInr(Math.max(0, party.closingBalancePaise - party.creditLimitPaise))}
              </strong>
              .
            </span>
          </div>
          {canManageTally && (
            <ActionLink
              href={`${selfPath}?tab=record`}
              spinnerSize="xs"
              className="rsl-btn-secondary text-xs"
            >
              Record Payment Receipt
            </ActionLink>
          )}
        </div>
      )}

      {/* 4-Card T-Account Balance Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Opening Balance"
          value={`${formatInr(Math.abs(party.openingBalancePaise))}${
            party.openingBalancePaise > 0
              ? " Dr"
              : party.openingBalancePaise < 0
                ? " Cr"
                : ""
          }`}
          sublabel={`FY starting ${detail.financialYearFrom}`}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Debits (Dr)"
          value={formatInr(totals.totalDebitsPaise)}
          sublabel="Sales bills, supplier payments & debit notes"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Credits (Cr)"
          value={formatInr(totals.totalCreditsPaise)}
          sublabel="Receipts, credit notes & purchase bills"
          accent="emerald"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Closing Running Balance"
          value={
            totals.closingAbsPaise === 0
              ? "₹0 (Settled)"
              : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`
          }
          sublabel={`${detail.openBills.length} open bill(s) • ${detail.settledBills.length} paid bill(s)`}
          accent={
            creditLimitBreached
              ? "ruby"
              : totals.closingSignedPaise > 0
                ? "amber"
                : "emerald"
          }
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {/* Segmented Party View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {subTabs.map((t) => {
            const active = safeTab === t.key;
            return (
              <ActionLink
                key={t.key}
                href={`${selfPath}?tab=${t.key}`}
                spinnerSize="xs"
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-zinc-600 hover:bg-zinc-100/80 hover:text-slate-900"
                }`}
              >
                {t.label}
              </ActionLink>
            );
          })}
        </div>
        {party.address && (
          <div className="px-3 text-[11px] text-zinc-500">Address: {party.address}</div>
        )}
      </div>

      {/* TAB 1: CHRONOLOGICAL T-ACCOUNT RUNNING BALANCE STATEMENT */}
      {safeTab === "statement" && (
        <SectionCard
          title="Chronological Party Ledger Statement (Tally T-Account Format)"
          subtitle="Every Sales, Receipt, Payment, Credit Note, Debit Note, and Purchase entry in chronological order with live Dr/Cr running balance"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-4 py-3">Particulars &amp; Settlement Ref</th>
                  <th className="px-4 py-3">Vch Type</th>
                  <th className="px-4 py-3">Vch No.</th>
                  <th className="px-4 py-3 text-right">Debit (Dr)</th>
                  <th className="px-4 py-3 text-right">Credit (Cr)</th>
                  <th className="px-6 py-3 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {detail.statementRows.map((row) => {
                  const isOpening = row.id === "opening_balance";
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-zinc-50/70 ${
                        row.isCancelled ? "opacity-60" : isOpening ? "bg-zinc-50/45" : ""
                      }`}
                    >
                      <td className="px-6 py-3.5 whitespace-nowrap text-zinc-600 tabular-nums">
                        {formatShortDate(row.date)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div
                          className={`font-semibold ${
                            row.isCancelled ? "text-zinc-500 line-through" : "text-slate-900"
                          }`}
                        >
                          {row.particulars}
                        </div>
                        {row.settlementSummary && (
                          <div className="mt-0.5 text-[11px] font-medium text-emerald-700">
                            {row.settlementSummary}
                          </div>
                        )}
                        {row.narration && (
                          <div className="mt-0.5 text-[11px] text-zinc-500">{row.narration}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-slate-700">
                          {row.voucherType}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono font-bold">
                        {row.voucherId ? (
                          <ActionLink
                            href={`/tally/vouchers/${encodeURIComponent(row.voucherId)}`}
                            spinnerSize="xs"
                            className="inline-flex items-center gap-1 text-emerald-800 hover:underline"
                          >
                            <span>#{row.voucherNumber}</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </ActionLink>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-slate-900 tabular-nums">
                        {row.debitPaise > 0 ? formatInr(row.debitPaise) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-emerald-700 tabular-nums">
                        {row.creditPaise > 0 ? formatInr(row.creditPaise) : "—"}
                      </td>
                      <td className="px-6 py-3.5 text-right font-extrabold text-slate-900 tabular-nums">
                        {row.runningBalancePaise > 0 ? (
                          <>
                            {formatInr(row.runningBalancePaise)}{" "}
                            <span
                              className={`text-[11px] font-bold ${
                                row.runningDrCr === "Dr" ? "text-amber-700" : "text-sky-700"
                              }`}
                            >
                              {row.runningDrCr}
                            </span>
                          </>
                        ) : (
                          <span className="text-emerald-700">Nil</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-zinc-200 bg-zinc-50/90 text-xs font-bold text-slate-900">
                <tr>
                  <td colSpan={4} className="px-6 py-3.5 text-right uppercase">
                    Closing Ledger Totals
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">
                    {formatInr(totals.totalDebitsPaise)}
                  </td>
                  <td className="px-4 py-3.5 text-right text-emerald-700 tabular-nums">
                    {formatInr(totals.totalCreditsPaise)}
                  </td>
                  <td className="px-6 py-3.5 text-right tabular-nums">
                    {totals.closingAbsPaise === 0
                      ? "₹0 (Settled)"
                      : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SectionCard>
      )}

      {/* TAB 2: BILL-WISE OPEN & SETTLED INVOICES */}
      {safeTab === "bills" && (
        <SectionCard
          title={`Bill-Wise Receivables & Settlements (${detail.allBills.length})`}
          subtitle="Tracks exact Paid-in-Tally status across Agst Ref receipts, cash counter sales, credit notes, and FIFO on-account settlements"
          noPadding
        >
          {detail.allBills.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No Sales or Purchase bills recorded for this party yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-6 py-3">Bill # &amp; Date</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Bill Amount</th>
                    <th className="px-4 py-3 text-right">Paid / Settled</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3">Settlement Trail</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {detail.allBills.map((b) => {
                    const isOverdue =
                      b.pendingPaise > 0 && b.dueDate !== null && b.dueDate < nowMs;
                    return (
                      <tr key={b.id} className="hover:bg-zinc-50/70">
                        <td className="px-6 py-3.5">
                          <ActionLink
                            href={`/tally/vouchers/${encodeURIComponent(b.id)}`}
                            spinnerSize="xs"
                            className="inline-flex items-center gap-1 font-mono font-bold text-slate-900 hover:text-emerald-700"
                          >
                            <span>#{b.voucherNumber}</span>
                            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
                          </ActionLink>
                          <div className="text-[11px] text-zinc-500">
                            {b.voucherType} • {formatShortDate(b.voucherDate)}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-zinc-600 tabular-nums">
                          {b.dueDate ? formatShortDate(b.dueDate) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-zinc-700 tabular-nums">
                          {formatInr(b.amountPaise)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-emerald-700 tabular-nums">
                          {formatInr(b.paidAmountPaise)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-extrabold text-slate-900 tabular-nums">
                          {formatInr(b.pendingPaise)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill
                              label={isOverdue ? "Overdue" : b.paymentStatus}
                              tone={
                                b.paymentStatus === "paid"
                                  ? "emerald"
                                  : isOverdue
                                    ? "ruby"
                                    : "amber"
                              }
                            />
                            {b.settlements.map((s) => (
                              <span
                                key={s.id}
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
                              >
                                {s.settlementVoucherNumber
                                  ? `${s.settlementVoucherType} #${s.settlementVoucherNumber}`
                                  : s.allocationType.replace(/_/g, " ")}{" "}
                                ({formatInr(s.amountPaise)})
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <a
                              href={`/api/pdf/tally-voucher?voucherId=${encodeURIComponent(b.id)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rsl-btn-secondary px-2.5 py-1 text-[11px]"
                            >
                              {b.hasNativePdf ? "Tally PDF" : "Bill PDF"}
                            </a>
                            {canManageTally && b.pendingPaise > 0 && (
                              <form action={markTallyBillPaidAction} className="inline-flex">
                                <input type="hidden" name="billVoucherId" value={b.id} />
                                <input
                                  type="hidden"
                                  name="returnPath"
                                  value={`${selfPath}?tab=bills`}
                                />
                                <SubmitButton
                                  spinnerSize="xs"
                                  pendingText="Marking..."
                                  className="rsl-btn-primary px-2.5 py-1 text-[11px]"
                                >
                                  Mark Paid
                                </SubmitButton>
                              </form>
                            )}
                            {b.voucherType === "Sales" &&
                              b.pendingPaise > 0 &&
                              canSendTallyWhatsApp &&
                              hasInvoicingEntitlement &&
                              (b.partyPhoneE164 || party.phoneE164) && (
                                <ConfirmWhatsAppReminderButton
                                  voucherId={b.id}
                                  voucherNumber={b.voucherNumber}
                                  partyName={party.name}
                                  partyPhoneE164={(b.partyPhoneE164 || party.phoneE164)!}
                                  balanceFormatted={formatInr(b.pendingPaise)}
                                  action={sendBillWhatsAppAction}
                                  returnPath={`${selfPath}?tab=bills`}
                                  buttonLabel="Remind"
                                  buttonClassName="rsl-btn-secondary px-2.5 py-1 text-[11px]"
                                />
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* TAB 3: ITEM-WISE PURCHASE / SUPPLY HISTORY */}
      {safeTab === "items" && (
        <SectionCard
          title={`Item-Wise Purchase & Supply History (${detail.itemHistory.length})`}
          subtitle="Aggregated SKU quantities, last billed rate, and total value traded with this party"
          noPadding
        >
          {detail.itemHistory.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No itemized inventory lines recorded on vouchers for this party yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-6 py-3">Stock Item</th>
                    <th className="px-4 py-3">HSN</th>
                    <th className="px-4 py-3 text-right">Total Qty</th>
                    <th className="px-4 py-3 text-right">Last Rate</th>
                    <th className="px-4 py-3 text-right">Total Value</th>
                    <th className="px-6 py-3 text-right">Last Billed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {detail.itemHistory.map((item) => (
                    <tr key={item.itemName} className="hover:bg-zinc-50/70">
                      <td className="px-6 py-3.5">
                        <div className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
                          <Package className="h-3.5 w-3.5 text-emerald-600" />
                          <span>{item.itemName}</span>
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Across {item.vouchersCount} voucher(s)
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-zinc-600">
                        {item.hsnCode || "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                        {item.totalQty.toLocaleString("en-IN")} {item.uom}
                      </td>
                      <td className="px-4 py-3.5 text-right text-zinc-700 tabular-nums">
                        {formatInr(item.lastRatePaise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-extrabold text-emerald-700 tabular-nums">
                        {formatInr(item.totalAmountPaise)}
                      </td>
                      <td className="px-6 py-3.5 text-right text-zinc-500 tabular-nums">
                        {formatShortDate(item.lastDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* TAB 4: RECORD RECEIPT / PAYMENT / BILL FOR THIS PARTY */}
      {safeTab === "record" && canManageTally && (
        <SectionCard
          title={`Record Receipt, Payment, or Voucher for ${party.name}`}
          subtitle="Automatically updates this party's running balance, settles matching open bills (Agst Ref or FIFO), and cancels pending overdue reminders"
        >
          <form action={recordTallyVoucherAction} className="space-y-4 text-xs">
            <input type="hidden" name="preventOverwrite" value="true" />
            <input type="hidden" name="returnPath" value={selfPath} />
            <input type="hidden" name="companyName" value={detail.companyName} />
            <input type="hidden" name="partyName" value={party.name} />
            {party.phoneE164 && (
              <input type="hidden" name="partyPhoneE164" value={party.phoneE164} />
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Voucher Type</label>
                <select
                  name="voucherType"
                  defaultValue={detail.isCreditor ? "Payment" : "Receipt"}
                  className="rsl-input"
                >
                  <option value="Receipt">Receipt (Customer Paid You)</option>
                  <option value="Payment">Payment (Paid Supplier)</option>
                  <option value="Sales">Sales Bill / Invoice</option>
                  <option value="CreditNote">Credit Note (Sales Return)</option>
                  <option value="Purchase">Purchase Bill</option>
                  <option value="DebitNote">Debit Note (Purchase Return)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Voucher # *</label>
                <input
                  name="voucherNumber"
                  required
                  defaultValue={`RCPT-${String(Date.now()).slice(-4)}`}
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Amount (₹) *</label>
                <input
                  name="amountRupees"
                  type="number"
                  step="0.01"
                  min="1"
                  defaultValue={
                    detail.openBills[0]
                      ? (detail.openBills[0].pendingPaise / 100).toFixed(2)
                      : undefined
                  }
                  required
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Voucher Date</label>
                <input
                  name="voucherDateIso"
                  type="date"
                  defaultValue={todayIso}
                  required
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Settle Against Bill # (Optional — blank uses FIFO)
                </label>
                <select name="againstBillNumber" defaultValue="" className="rsl-input">
                  <option value="">Auto-Match Oldest Unpaid Bill (FIFO)</option>
                  {detail.openBills.map((ob) => (
                    <option key={ob.id} value={ob.voucherNumber}>
                      #{ob.voucherNumber} — Pending {formatInr(ob.pendingPaise)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Cash / Bank Ledger Name
                </label>
                <input
                  name="ledgerAccountName"
                  defaultValue="HDFC Bank / UPI Receipt"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Narration / UTR Reference
                </label>
                <input
                  name="narration"
                  placeholder="e.g. UPI UTR 431298112004"
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <ActionLink href={selfPath} spinnerSize="xs" className="rsl-btn-secondary">
                Cancel
              </ActionLink>
              <SubmitButton pendingText="Saving Voucher..." className="rsl-btn-primary">
                Save Voucher &amp; Reconcile Ledger
              </SubmitButton>
            </div>
          </form>
        </SectionCard>
      )}

      {/* TAB 5: EDIT PARTY PROFILE */}
      {safeTab === "edit" && canManageTally && (
        <SectionCard
          title={`Edit Ledger Profile — ${party.name}`}
          subtitle="Update GSTIN, PAN, WhatsApp mobile, credit days, credit limit, or opening balance"
        >
          <form action={upsertWorkspacePartyLedgerAction} className="space-y-4 text-xs">
            <input type="hidden" name="partyId" value={party.id} />
            <input type="hidden" name="companyName" value={detail.companyName} />
            <input type="hidden" name="returnPath" value={`${selfPath}?tab=edit`} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Ledger Name *</label>
                <input name="name" defaultValue={party.name} required className="rsl-input" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Account Group</label>
                <select
                  name="parentGroup"
                  defaultValue={detail.isCreditor ? "Sundry Creditors" : "Sundry Debtors"}
                  className="rsl-input"
                >
                  <option value="Sundry Debtors">Sundry Debtors (Customer / Client)</option>
                  <option value="Sundry Creditors">Sundry Creditors (Supplier / Vendor)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">WhatsApp Mobile</label>
                <input
                  name="phoneE164"
                  defaultValue={party.phoneE164 ?? ""}
                  placeholder="+9198200..."
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Email</label>
                <input
                  name="email"
                  type="email"
                  defaultValue={party.email ?? ""}
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">GSTIN</label>
                <input
                  name="gstin"
                  maxLength={15}
                  defaultValue={party.gstin ?? ""}
                  className="rsl-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">PAN</label>
                <input
                  name="pan"
                  maxLength={10}
                  defaultValue={party.pan ?? ""}
                  className="rsl-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Contact Person</label>
                <input
                  name="contactPerson"
                  defaultValue={party.contactPerson ?? ""}
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">State</label>
                <input
                  name="stateName"
                  defaultValue={party.stateName ?? ""}
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Pincode</label>
                <input
                  name="pincode"
                  defaultValue={party.pincode ?? ""}
                  className="rsl-input font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Credit Days</label>
                <input
                  name="creditDays"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={party.creditDays}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Credit Limit (₹)</label>
                <input
                  name="creditLimitRupees"
                  type="number"
                  min={0}
                  step="100"
                  defaultValue={(party.creditLimitPaise / 100).toFixed(2)}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Opening Balance (₹)</label>
                <input
                  name="openingBalanceRupees"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(Math.abs(party.openingBalancePaise) / 100).toFixed(2)}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Opening Dr / Cr</label>
                <select
                  name="openingBalanceType"
                  defaultValue={party.openingBalancePaise < 0 ? "Cr" : "Dr"}
                  className="rsl-input"
                >
                  <option value="Dr">Debit (Dr)</option>
                  <option value="Cr">Credit (Cr)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Address</label>
                <input
                  name="address"
                  defaultValue={party.address ?? ""}
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <ActionLink href={selfPath} spinnerSize="xs" className="rsl-btn-secondary">
                Cancel
              </ActionLink>
              <SubmitButton pendingText="Updating..." className="rsl-btn-primary">
                Save Ledger Changes
              </SubmitButton>
            </div>
          </form>
        </SectionCard>
      )}
    </div>
  );
}
