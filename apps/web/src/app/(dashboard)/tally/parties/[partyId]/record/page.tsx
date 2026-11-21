import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { PartyDetailShell } from "@/components/party-detail-shell";
import { recordTallyVoucherAction } from "@/lib/actions";
import { loadPartyDetailContext } from "@/lib/party-detail-data";

export default async function TallyPartyRecordVoucherPage({
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
        pageTitle="Record Party Voucher"
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
        pageTitle="Record Party Receipt, Payment or Bill"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to record receipts and reconcile bills."
        plans={ctx.plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}/record`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, detail, tallyOverview, canManageTally } = ctx;
  const { party } = detail;
  const selfPath = `/tally/parties/${encodeURIComponent(party.id)}`;

  if (!canManageTally) {
    return (
      <AccessRestrictedState
        pageTitle="Record Party Voucher"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Tally sync & rules"
        homeHref={selfPath}
        homeLabel="Back to Ledger Statement"
      />
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <PartyDetailShell
      activeSection="record"
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
        title={`Record Receipt, Payment, or Voucher for ${party.name}`}
        subtitle="Automatically updates this party's running balance, settles matching open bills (Agst Ref or FIFO), and cancels pending overdue reminders"
      >
        <form action={recordTallyVoucherAction} className="space-y-4 text-xs">
          <input type="hidden" name="preventOverwrite" value="true" />
          <input type="hidden" name="returnPath" value={selfPath} />
          <input type="hidden" name="companyName" value={detail.companyName} />
          <input type="hidden" name="partyName" value={party.name} />
          {party.phoneE164 && <input type="hidden" name="partyPhoneE164" value={party.phoneE164} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Voucher Type</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Voucher # *</label>
              <input
                name="voucherNumber"
                required
                defaultValue={`RCPT-${String(Date.now()).slice(-4)}`}
                className="rsl-input font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Amount (₹) *</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Voucher Date</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                Settle Against Bill # (Optional - blank uses FIFO)
              </label>
              <select name="againstBillNumber" defaultValue="" className="rsl-input">
                <option value="">Auto-Match Oldest Unpaid Bill (FIFO)</option>
                {detail.openBills.map((ob) => (
                  <option key={ob.id} value={ob.voucherNumber}>
                    #{ob.voucherNumber} - Pending {formatInr(ob.pendingPaise)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                Cash / Bank Ledger Name
              </label>
              <input
                name="ledgerAccountName"
                defaultValue="HDFC Bank / UPI Receipt"
                className="rsl-input"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
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
    </PartyDetailShell>
  );
}
