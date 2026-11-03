import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  MessageSquareShare,
  Package,
  User,
  Wallet,
} from "lucide-react";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getTallyWorkspaceSummary, getWorkspaceVoucherDetail } from "@rsl/tally";
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
import { markTallyBillPaidAction, sendBillWhatsAppAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMethodLabel(method: string): string {
  if (method === "agst_ref") return "Agst Ref (Tally Bill Allocation)";
  if (method === "cash_counter") return "Cash / Counter Immediate Settlement";
  if (method === "upfront_direct") return "Direct Tally Bill Clearance";
  if (method === "fifo_auto") return "Chronological FIFO Auto-Match";
  return method.replace(/_/g, " ");
}

export default async function TallyVoucherDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ voucherId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const { voucherId } = await params;
  const sp = await searchParams;

  if (
    !canRoleAccessWebRoute(session.roleSlug, `/tally/vouchers/${voucherId}`, session.workspace.id)
  ) {
    return (
      <AccessRestrictedState
        pageTitle="Tally Voucher Detail"
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
        pageTitle="Tally Voucher & Bill-Wise Settlement View"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect itemized vouchers, exact payment settlements, and native Tally PDFs."
        plans={plans}
        returnPath={`/tally/vouchers/${encodeURIComponent(voucherId)}`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  let detail;
  try {
    detail = getWorkspaceVoucherDetail(session.workspace.id, voucherId);
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

  const { voucher, party } = detail;
  const isCancelled = voucher.paymentStatus === "cancelled";
  const isBillType = voucher.voucherType === "Sales" || voucher.voucherType === "Purchase";
  const nowMs = Date.now();
  const isOverdue =
    !isCancelled && isBillType && detail.pendingPaise > 0 && voucher.dueDate !== null && voucher.dueDate < nowMs;
  const todayIso = new Date().toISOString().slice(0, 10);
  const selfPath = `/tally/vouchers/${encodeURIComponent(voucher.id)}`;
  const effectivePhone = voucher.partyPhoneE164 || party?.phoneE164 || null;

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="vouchers"
        vouchersCount={tallyOverview.vouchers.length}
        partiesCount={tallyOverview.totals.partiesCount}
        stockItemsCount={tallyOverview.totals.stockItemsCount}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <div className="flex flex-wrap items-center gap-3">
          <ActionLink
            href="/tally"
            spinnerSize="xs"
            className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Bills &amp; Receipts</span>
          </ActionLink>
          {party && (
            <>
              <span className="text-zinc-300">•</span>
              <ActionLink
                href={`/tally/parties/${encodeURIComponent(party.id)}`}
                spinnerSize="xs"
                className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
              >
                <User className="h-3.5 w-3.5" />
                <span>Open {party.name} Ledger Statement</span>
                <ArrowUpRight className="h-3 w-3" />
              </ActionLink>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-medium text-slate-700">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{detail.companyName}</span>
          </span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] text-zinc-600">
            AlterID: {voucher.alterId}
          </span>
        </div>
      </div>

      <PageHeader
        eyebrow={`${voucher.voucherType} Voucher • ${detail.companyName}`}
        badge={
          <StatusPill
            label={
              isCancelled
                ? "Cancelled in Tally"
                : isOverdue
                  ? "Overdue"
                  : voucher.paymentStatus.toUpperCase()
            }
            tone={
              isCancelled
                ? "stone"
                : voucher.paymentStatus === "paid"
                  ? "emerald"
                  : isOverdue
                    ? "ruby"
                    : "amber"
            }
          />
        }
        title={`${voucher.voucherType} #${voucher.voucherNumber}`}
        subtitle={[
          `Party: ${voucher.partyName}`,
          `Date: ${formatFullDate(voucher.voucherDate)}`,
          voucher.dueDate ? `Due: ${formatFullDate(voucher.dueDate)}` : null,
          effectivePhone ? `WhatsApp: ${effectivePhone}` : null,
        ]
          .filter(Boolean)
          .join("  •  ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {detail.nativePdf ? (
              <a
                href={`/api/pdf/tally-voucher-native?voucherId=${encodeURIComponent(voucher.id)}`}
                target="_blank"
                rel="noreferrer"
                className="rsl-btn-primary"
              >
                <FileText className="mr-1.5 inline h-3.5 w-3.5" />
                Open Exact Tally PDF
              </a>
            ) : (
              <a
                href={`/api/pdf/tally-voucher?voucherId=${encodeURIComponent(voucher.id)}&download=1`}
                className="rsl-btn-primary"
              >
                <Download className="mr-1.5 inline h-3.5 w-3.5" />
                Download Voucher PDF
              </a>
            )}
            <a
              href={`/api/pdf/tally-voucher?voucherId=${encodeURIComponent(voucher.id)}&format=generated`}
              target="_blank"
              rel="noreferrer"
              className="rsl-btn-secondary"
            >
              Preview Summary PDF
            </a>
            {!isCancelled &&
              voucher.voucherType === "Sales" &&
              canSendTallyWhatsApp &&
              hasInvoicingEntitlement &&
              effectivePhone && (
                <>
                  <form action={sendBillWhatsAppAction} className="inline-flex">
                    <input type="hidden" name="voucherId" value={voucher.id} />
                    <input type="hidden" name="sendKind" value="invoice" />
                    <input type="hidden" name="returnPath" value={selfPath} />
                    <SubmitButton pendingText="Sending..." className="rsl-btn-secondary">
                      <MessageSquareShare className="mr-1.5 inline h-3.5 w-3.5 text-emerald-600" />
                      {detail.nativePdf ? "Send Tally PDF on WhatsApp" : "Send on WhatsApp"}
                    </SubmitButton>
                  </form>
                  {detail.pendingPaise > 0 && (
                    <ConfirmWhatsAppReminderButton
                      voucherId={voucher.id}
                      voucherNumber={voucher.voucherNumber}
                      partyName={voucher.partyName}
                      partyPhoneE164={effectivePhone}
                      balanceFormatted={formatInr(detail.pendingPaise)}
                      action={sendBillWhatsAppAction}
                      returnPath={selfPath}
                      buttonLabel={`Send Reminder (${voucher.remindersSentCount})`}
                      buttonClassName="rsl-btn-secondary"
                    />
                  )}
                </>
              )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* 4-Card Voucher Financial Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Voucher Total Amount"
          value={formatInr(voucher.amountPaise, { showDecimals: true })}
          sublabel={`${voucher.voucherType} #${voucher.voucherNumber}`}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Settled / Paid Amount"
          value={formatInr(voucher.paidAmountPaise, { showDecimals: true })}
          sublabel={
            detail.settlementsAgainstBill.length > 0
              ? `Across ${detail.settlementsAgainstBill.length} settlement entry(s)`
              : voucher.paymentStatus === "paid"
                ? "Fully settled"
                : "Awaiting receipt / settlement"
          }
          accent="emerald"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Balance Due"
          value={formatInr(detail.pendingPaise, { showDecimals: true })}
          sublabel={
            detail.pendingPaise === 0
              ? "₹0 pending — cleared"
              : voucher.dueDate
                ? `Due ${formatFullDate(voucher.dueDate)}`
                : "Open receivable / payable"
          }
          accent={detail.pendingPaise > 0 ? (isOverdue ? "ruby" : "amber") : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Party Closing Balance"
          value={
            party
              ? party.closingBalancePaise === 0
                ? "₹0 (Settled)"
                : `${formatInr(Math.abs(party.closingBalancePaise))} ${
                    party.closingBalancePaise > 0 ? "Dr" : "Cr"
                  }`
              : "—"
          }
          sublabel={party ? `${party.parentGroup} • ${party.name}` : voucher.partyName}
          icon={<IndianRupee className="h-4 w-4" />}
        />
      </div>

      {/* Party & Narration Metadata Bar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard
          title="Party Account & Statutory Details"
          subtitle="Linked directly to your Tally Prime Party Ledger"
          action={
            party ? (
              <ActionLink
                href={`/tally/parties/${encodeURIComponent(party.id)}`}
                spinnerSize="xs"
                className="rsl-btn-secondary py-1 text-xs"
              >
                Open Full Ledger →
              </ActionLink>
            ) : undefined
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-zinc-500">Party Name</dt>
              <dd className="mt-0.5 font-bold text-slate-900">{voucher.partyName}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Account Group</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">
                {party?.parentGroup || "Sundry Debtors"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">GSTIN</dt>
              <dd className="mt-0.5 font-mono font-semibold text-slate-800">
                {party?.gstin || "Unregistered / Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">WhatsApp Mobile</dt>
              <dd className="mt-0.5 font-mono text-slate-800">{effectivePhone || "Not set"}</dd>
            </div>
            {voucher.ledgerAccountName && (
              <div className="col-span-2">
                <dt className="text-zinc-500">Contra / Bank / Sales Ledger</dt>
                <dd className="mt-0.5 font-semibold text-slate-800">{voucher.ledgerAccountName}</dd>
              </div>
            )}
            {voucher.narration && (
              <div className="col-span-2">
                <dt className="text-zinc-500">Tally Narration / Bank Ref</dt>
                <dd className="mt-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-slate-800">
                  {voucher.narration}
                </dd>
              </div>
            )}
          </dl>
        </SectionCard>

        {/* Bill-Wise Payment & Settlement Trail */}
        <div className="lg:col-span-2">
          <SectionCard
            title={
              isBillType
                ? `Payment & Settlement Trail (${detail.settlementsAgainstBill.length})`
                : `Bills Settled by This ${voucher.voucherType} (${detail.billsSettledByVoucher.length})`
            }
            subtitle={
              isBillType
                ? "Automatically populated when Receipts, Payments, or Credit/Debit Notes are saved in Tally Prime"
                : "Exact Sales / Purchase invoices cleared by this voucher"
            }
          >
            {isBillType ? (
              <div className="space-y-4 text-xs">
                {detail.settlementsAgainstBill.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4 text-zinc-600">
                    No payments or credit notes have been allocated against{" "}
                    <strong>#{voucher.voucherNumber}</strong> yet. When your client pays and you
                    record a Receipt in Tally Prime (or click{" "}
                    <strong>Record Payment / Mark Paid</strong> below), this bill automatically
                    updates to <strong>Paid</strong>!
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-zinc-200/85">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-200/80 bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase">
                        <tr>
                          <th className="px-4 py-2.5">Settlement Voucher</th>
                          <th className="px-4 py-2.5">Matching Method</th>
                          <th className="px-4 py-2.5">Date</th>
                          <th className="px-4 py-2.5 text-right">Amount Applied</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 bg-white">
                        {detail.settlementsAgainstBill.map((s) => (
                          <tr key={s.id}>
                            <td className="px-4 py-2.5 font-mono font-bold text-slate-900">
                              {s.settlementVoucherId ? (
                                <ActionLink
                                  href={`/tally/vouchers/${encodeURIComponent(s.settlementVoucherId)}`}
                                  spinnerSize="xs"
                                  className="inline-flex items-center gap-1 text-emerald-800 hover:underline"
                                >
                                  <span>
                                    {s.settlementVoucherType} #{s.settlementVoucherNumber}
                                  </span>
                                  <ArrowUpRight className="h-3 w-3" />
                                </ActionLink>
                              ) : (
                                <span>{s.settlementVoucherNumber || "Direct Counter Paid"}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-zinc-600">
                              {formatMethodLabel(s.allocationType)}
                            </td>
                            <td className="px-4 py-2.5 text-zinc-600 tabular-nums">
                              {formatFullDate(s.settledAt)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">
                              {formatInr(s.amountPaise, { showDecimals: true })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!isCancelled && detail.pendingPaise > 0 && canManageTally && (
                  <form
                    action={markTallyBillPaidAction}
                    className="rounded-2xl border border-emerald-200/90 bg-emerald-50/55 p-4"
                  >
                    <input type="hidden" name="billVoucherId" value={voucher.id} />
                    <input type="hidden" name="returnPath" value={selfPath} />
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <span className="font-bold text-emerald-950">
                        Record Payment Against #{voucher.voucherNumber} (Marks Bill Paid &amp; Updates Party Ledger)
                      </span>
                      <span className="font-mono text-[11px] font-bold text-emerald-800">
                        Pending: {formatInr(detail.pendingPaise, { showDecimals: true })}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                          Amount Received (₹)
                        </label>
                        <input
                          name="amountRupees"
                          type="number"
                          step="0.01"
                          min="0.01"
                          max={(detail.pendingPaise / 100).toFixed(2)}
                          defaultValue={(detail.pendingPaise / 100).toFixed(2)}
                          required
                          className="rsl-input bg-white tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                          Bank / Cash Mode
                        </label>
                        <input
                          name="paymentModeLedger"
                          defaultValue="Bank / UPI Receipt"
                          className="rsl-input bg-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                          Payment Date
                        </label>
                        <input
                          name="settlementDateIso"
                          type="date"
                          defaultValue={todayIso}
                          className="rsl-input bg-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-700">
                          UTR / Cheque Narration
                        </label>
                        <input
                          name="narration"
                          placeholder="UPI UTR / NEFT Ref"
                          className="rsl-input bg-white"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <SubmitButton pendingText="Recording Payment..." className="rsl-btn-primary text-xs">
                        <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                        Record Receipt &amp; Mark Paid
                      </SubmitButton>
                    </div>
                  </form>
                )}
              </div>
            ) : detail.billsSettledByVoucher.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4 text-xs text-zinc-600">
                This {voucher.voucherType} is credited on-account to{" "}
                <strong>{voucher.partyName}</strong>&rsquo;s running ledger balance.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200/85">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Settled Bill #</th>
                      <th className="px-4 py-2.5">Matching Method</th>
                      <th className="px-4 py-2.5 text-right">Amount Cleared</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {detail.billsSettledByVoucher.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2.5 font-mono font-bold">
                          <ActionLink
                            href={`/tally/vouchers/${encodeURIComponent(s.billVoucherId)}`}
                            spinnerSize="xs"
                            className="inline-flex items-center gap-1 text-emerald-800 hover:underline"
                          >
                            <span>Bill #{s.billNumber}</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </ActionLink>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600">
                          {formatMethodLabel(s.allocationType)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-700 tabular-nums">
                          {formatInr(s.amountPaise, { showDecimals: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Itemized Inventory Line Items */}
      {detail.lineItems.length > 0 && (
        <SectionCard
          title={`Itemized Inventory Particulars (${detail.lineItems.length})`}
          subtitle="Synced from Tally Prime ALLINVENTORYENTRIES / INVENTORYENTRIES — automatically reflected in your Stock & Godown Register"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3">Stock Item</th>
                  <th className="px-4 py-3">Godown / Batch</th>
                  <th className="px-4 py-3">HSN</th>
                  <th className="px-4 py-3 text-right">Billed Qty</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3 text-right">GST %</th>
                  <th className="px-6 py-3 text-right">Line Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {detail.lineItems.map((li) => (
                  <tr key={li.id} className="hover:bg-zinc-50/70">
                    <td className="px-6 py-3.5 font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-emerald-600" />
                        <span>{li.itemName}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-zinc-600">
                      {li.godownName}
                      {li.batchName && li.batchName !== "Primary Batch" ? ` • ${li.batchName}` : ""}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-zinc-600">{li.hsnCode || "—"}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                      {li.billedQty.toLocaleString("en-IN")} {li.uom}
                    </td>
                    <td className="px-4 py-3.5 text-right text-zinc-700 tabular-nums">
                      {formatInr(li.ratePaise, { showDecimals: true })}
                    </td>
                    <td className="px-4 py-3.5 text-right text-zinc-600 tabular-nums">
                      {li.gstRateBps > 0 ? `${li.gstRateBps / 100}%` : "—"}
                    </td>
                    <td className="px-6 py-3.5 text-right font-extrabold text-slate-900 tabular-nums">
                      {formatInr(li.amountPaise, { showDecimals: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* WhatsApp Delivery Audit Trail */}
      {detail.whatsappHistory.length > 0 && (
        <SectionCard
          title={`WhatsApp Dispatch History (${detail.whatsappHistory.length})`}
          subtitle="Messages & PDF invoices delivered for this voucher"
        >
          <ul className="divide-y divide-zinc-100 text-xs">
            {detail.whatsappHistory.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                <div className="max-w-3xl text-slate-800">{m.body}</div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <StatusPill
                    label={m.deliveryStatus}
                    tone={m.deliveryStatus === "failed" ? "ruby" : "emerald"}
                  />
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    {formatFullDate(m.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
