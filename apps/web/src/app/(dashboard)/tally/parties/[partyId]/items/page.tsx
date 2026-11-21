import { Package } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { PartyDetailShell } from "@/components/party-detail-shell";
import { formatPartyShortDate, loadPartyDetailContext } from "@/lib/party-detail-data";

export default async function TallyPartyItemsPage({
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
        pageTitle="Party Item History"
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
        pageTitle="Item-Wise Purchase & Supply History"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect SKU quantities and pricing traded with this party."
        plans={ctx.plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}/items`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, detail, tallyOverview, canManageTally } = ctx;

  return (
    <PartyDetailShell
      activeSection="items"
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
        title={`Item-Wise Purchase & Supply History (${detail.itemHistory.length})`}
        subtitle="Aggregated SKU quantities, last billed rate, and total value traded with this party"
        noPadding
      >
        {detail.itemHistory.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
            No itemized inventory lines recorded on vouchers for this party yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                <tr>
                  <th className="px-6 py-3">Stock Item</th>
                  <th className="px-4 py-3">HSN</th>
                  <th className="px-4 py-3 text-right">Total Qty</th>
                  <th className="px-4 py-3 text-right">Last Rate</th>
                  <th className="px-4 py-3 text-right">Total Value</th>
                  <th className="px-6 py-3 text-right">Last Billed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                {detail.itemHistory.map((item) => (
                  <tr key={item.itemName} className="hover:bg-[var(--surface-inset)]">
                    <td className="px-6 py-3.5">
                      <div className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                        <Package className="h-3.5 w-3.5 text-emerald-600" />
                        <span>{item.itemName}</span>
                      </div>
                      <div className="text-[11px] text-[var(--ink-muted)]">
                        Across {item.vouchersCount} voucher(s)
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[var(--ink-secondary)]">
                      {item.hsnCode || "-"}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-[var(--ink)] tabular-nums">
                      {item.totalQty.toLocaleString("en-IN")} {item.uom}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[var(--ink-secondary)] tabular-nums">
                      {formatInr(item.lastRatePaise)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-extrabold text-emerald-700 tabular-nums">
                      {formatInr(item.totalAmountPaise)}
                    </td>
                    <td className="px-6 py-3.5 text-right text-[var(--ink-muted)] tabular-nums">
                      {formatPartyShortDate(item.lastDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PartyDetailShell>
  );
}
