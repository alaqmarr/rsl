import { ArrowUpRight } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard, StatusPill } from "@rsl/ui";
import { ConfirmWhatsAppReminderButton } from "@/components/confirm-whatsapp-reminder";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { PartyDetailShell } from "@/components/party-detail-shell";
import { markTallyBillPaidAction, sendBillWhatsAppAction } from "@/lib/actions";
import { formatPartyShortDate, loadPartyDetailContext } from "@/lib/party-detail-data";

export default async function TallyPartyBillsPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ partyId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await loadPartyDetailContext(partyId);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Party Bills & Settlements"
        roleLabel={formatRoleLabel(ctx.session.roleSlug)}
        requiredPermissionLabel="View Tally bills & aging"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (ctx.status === "locked") {
    return (
      <FeaturePlanGate
        pageTitle="Bill-Wise Receivables & Settlements"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect bill-wise paid/pending settlement trails."
        plans={ctx.plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}/bills`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, detail, tallyOverview, canManageTally, canSendTallyWhatsApp, hasInvoicingEntitlement } =
    ctx;
  const { party } = detail;
  const billsPath = `/tally/parties/${encodeURIComponent(party.id)}/bills`;
  const nowMs = Date.now();

  return (
    <PartyDetailShell
      activeSection="bills"
      workspaceName={session.workspace.name}
      canManageTally={canManageTally}
      tallyCounts={{
        vouchersCount: tallyOverview.vouchers.length,
        partiesCount: tallyOverview.totals.partiesCount,
        stockItemsCount: tallyOverview.totals.stockItemsCount,
      }}
      detail={detail}
      notice={sp.notice}
      error={sp.error}
    >
      <SectionCard
        title={`Bill-Wise Receivables & Settlements (${detail.allBills.length})`}
        subtitle="Tracks exact Paid-in-Tally status across Agst Ref receipts, cash counter sales, credit notes, and FIFO on-account settlements"
        noPadding
      >
        {detail.allBills.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
            No Sales or Purchase bills recorded for this party yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
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
              <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                {detail.allBills.map((b) => {
                  const isOverdue = b.pendingPaise > 0 && b.dueDate !== null && b.dueDate < nowMs;
                  return (
                    <tr key={b.id} className="hover:bg-[var(--surface-inset)]">
                      <td className="px-6 py-3.5">
                        <ActionLink
                          href={`/tally/vouchers/${encodeURIComponent(b.id)}`}
                          spinnerSize="xs"
                          className="inline-flex items-center gap-1 font-mono font-bold text-[var(--ink)] hover:text-emerald-700"
                        >
                          <span>#{b.voucherNumber}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                        </ActionLink>
                        <div className="text-[11px] text-[var(--ink-muted)]">
                          {b.voucherType} • {formatPartyShortDate(b.voucherDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-[var(--ink-secondary)] tabular-nums">
                        {b.dueDate ? formatPartyShortDate(b.dueDate) : "-"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-[var(--ink-secondary)] tabular-nums">
                        {formatInr(b.amountPaise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-emerald-700 tabular-nums">
                        {formatInr(b.paidAmountPaise)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-extrabold text-[var(--ink)] tabular-nums">
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
                              <input type="hidden" name="returnPath" value={billsPath} />
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
                                returnPath={billsPath}
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
    </PartyDetailShell>
  );
}
