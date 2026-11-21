import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { PartyDetailShell } from "@/components/party-detail-shell";
import { upsertWorkspacePartyLedgerAction } from "@/lib/actions";
import { loadPartyDetailContext } from "@/lib/party-detail-data";

export default async function TallyPartyEditPage({
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
        pageTitle="Edit Party Ledger"
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
        pageTitle="Edit Party Ledger Details"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to manage party GSTIN, credit terms, and contact details."
        plans={ctx.plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}/edit`}
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
        pageTitle="Edit Party Ledger"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Tally sync & rules"
        homeHref={selfPath}
        homeLabel="Back to Ledger Statement"
      />
    );
  }

  return (
    <PartyDetailShell
      activeSection="edit"
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
        title={`Edit Ledger Profile - ${party.name}`}
        subtitle="Update GSTIN, PAN, WhatsApp mobile, credit days, credit limit, or opening balance"
      >
        <form action={upsertWorkspacePartyLedgerAction} className="space-y-4 text-xs">
          <input type="hidden" name="partyId" value={party.id} />
          <input type="hidden" name="companyName" value={detail.companyName} />
          <input type="hidden" name="returnPath" value={`${selfPath}/edit`} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Ledger Name *</label>
              <input name="name" defaultValue={party.name} required className="rsl-input" />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Account Group</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">WhatsApp Mobile</label>
              <input
                name="phoneE164"
                defaultValue={party.phoneE164 ?? ""}
                placeholder="+9198200..."
                className="rsl-input"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Email</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">GSTIN</label>
              <input
                name="gstin"
                maxLength={15}
                defaultValue={party.gstin ?? ""}
                className="rsl-input font-mono uppercase"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">PAN</label>
              <input
                name="pan"
                maxLength={10}
                defaultValue={party.pan ?? ""}
                className="rsl-input font-mono uppercase"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Contact Person</label>
              <input
                name="contactPerson"
                defaultValue={party.contactPerson ?? ""}
                className="rsl-input"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">State</label>
              <input
                name="stateName"
                defaultValue={party.stateName ?? ""}
                className="rsl-input"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Pincode</label>
              <input
                name="pincode"
                defaultValue={party.pincode ?? ""}
                className="rsl-input font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Credit Days</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Credit Limit (₹)</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Opening Balance (₹)</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Opening Dr / Cr</label>
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
              <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">Address</label>
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
    </PartyDetailShell>
  );
}
