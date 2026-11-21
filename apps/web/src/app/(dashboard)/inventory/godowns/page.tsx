import { Warehouse } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard, StatusPill } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { InventoryShell } from "@/components/inventory-shell";
import { formatStockQty, loadInventoryPageContext } from "@/lib/inventory-data";

export default async function InventoryGodownsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadInventoryPageContext(sp.company);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Godowns & Batch Expiry"
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
        pageTitle="Godowns & Batch Expiry Tracking"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect multi-warehouse balances and batch expiry alerts."
        plans={ctx.plans}
        returnPath="/inventory/godowns"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { canManageTally, inv, localPortProbe, selectedCompanyId } = ctx;

  return (
    <InventoryShell
      activeSection="godowns"
      canManageTally={canManageTally}
      selectedCompanyId={selectedCompanyId}
      inv={inv}
      localPortProbe={localPortProbe}
      notice={sp.notice}
      error={sp.error}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {inv.godownSummaries.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center text-xs text-[var(--ink-muted)]">
              No godown balances recorded yet. Import Tally StockItems or add an item with a Godown name.
            </div>
          ) : (
            inv.godownSummaries.map((g) => (
              <div
                key={g.godownName}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 text-xs font-bold text-[var(--ink)]">
                    <Warehouse className="h-4 w-4 text-emerald-600" />
                    <span>{g.godownName}</span>
                  </div>
                  <StatusPill label={`${g.skuCount} SKUs`} tone="emerald" showDot={false} />
                </div>
                <div className="mt-3 text-xl font-bold tabular-nums text-[var(--ink)]">
                  {formatInr(g.totalValuePaise)}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  Total Stock Units: <strong className="text-[var(--ink)]">{g.totalQty}</strong>
                </div>
              </div>
            ))
          )}
        </div>

        <SectionCard
          title={`Godown & Batch / Expiry Ledger (${inv.balances.length})`}
          subtitle="Track multi-warehouse quantities, batch/lot numbers, manufacturing dates, and upcoming expiry alerts"
          noPadding
        >
          {inv.balances.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
              No batch or godown allocations synced yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-6 py-3">Stock Item</th>
                    <th className="px-4 py-3">Godown / Warehouse</th>
                    <th className="px-4 py-3">Batch / Lot #</th>
                    <th className="px-4 py-3">Expiry Status</th>
                    <th className="px-4 py-3 text-right">Closing Qty</th>
                    <th className="px-6 py-3 text-right">Batch Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {inv.balances.map((b) => (
                    <tr key={b.id} className="hover:bg-[var(--surface-inset)]">
                      <td className="px-6 py-3.5 font-semibold text-[var(--ink)]">{b.itemName}</td>
                      <td className="px-4 py-3.5 text-[var(--ink-secondary)]">{b.godownName}</td>
                      <td className="px-4 py-3.5 font-mono text-[var(--ink-secondary)]">{b.batchName}</td>
                      <td className="px-4 py-3.5">
                        {b.expiryDate === null ? (
                          <span className="text-[11px] text-[var(--ink-muted)]">Non-perishable</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill
                              label={
                                b.expiryStatus === "expired"
                                  ? "Expired"
                                  : b.expiryStatus === "expiring_30d"
                                    ? `Expiring in ${b.daysToExpiry}d`
                                    : "Valid"
                              }
                              tone={
                                b.expiryStatus === "expired"
                                  ? "ruby"
                                  : b.expiryStatus === "expiring_30d"
                                    ? "amber"
                                    : "emerald"
                              }
                            />
                            <span className="text-[11px] text-[var(--ink-muted)]">
                              {new Date(b.expiryDate).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-[var(--ink)]">
                        {formatStockQty(b.closingQty, b.uom)}
                      </td>
                      <td className="px-6 py-3.5 text-right font-semibold tabular-nums text-[var(--ink)]">
                        {formatInr(Math.max(0, b.closingValuePaise))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </InventoryShell>
  );
}
