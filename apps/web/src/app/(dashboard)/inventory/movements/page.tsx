import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { InventoryShell } from "@/components/inventory-shell";
import { ActionLink } from "@/components/ios-feedback";
import { formatStockQty, loadInventoryPageContext } from "@/lib/inventory-data";

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadInventoryPageContext(sp.company);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Item Sales & Movements"
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
        pageTitle="Voucher-by-Voucher Stock Movements"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect top-selling SKUs and inward/outward stock movements."
        plans={ctx.plans}
        returnPath="/inventory/movements"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { canManageTally, inv, localPortProbe, selectedCompanyId } = ctx;

  return (
    <InventoryShell
      activeSection="movements"
      canManageTally={canManageTally}
      selectedCompanyId={selectedCompanyId}
      inv={inv}
      localPortProbe={localPortProbe}
      notice={sp.notice}
      error={sp.error}
    >
      <div className="space-y-6">
        {inv.topSellingItems.length > 0 && (
          <SectionCard
            title={`Top-Selling Items by Revenue (${inv.topSellingItems.length})`}
            subtitle="Calculated automatically from synced Tally Sales & Credit Note line items"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-6 py-3">Item Name</th>
                    <th className="px-4 py-3">Stock Group</th>
                    <th className="px-4 py-3 text-right">Units Sold</th>
                    <th className="px-4 py-3 text-right">Units Purchased</th>
                    <th className="px-4 py-3 text-right">Closing Stock</th>
                    <th className="px-6 py-3 text-right">Total Sales Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {inv.topSellingItems.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--surface-inset)]">
                      <td className="px-6 py-3 font-semibold text-[var(--ink)]">{item.name}</td>
                      <td className="px-4 py-3 text-[var(--ink-secondary)]">{item.stockGroup}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--ink)]">
                        {formatStockQty(item.totalSoldQty, item.uom)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--ink-secondary)]">
                        {formatStockQty(item.totalPurchasedQty, item.uom)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--ink)]">
                        {formatStockQty(item.closingQty, item.uom)}
                      </td>
                      <td className="px-6 py-3 text-right font-bold tabular-nums text-emerald-700">
                        {formatInr(item.totalSoldPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <SectionCard
          title={`Voucher-by-Voucher Stock Movement Ledger (${inv.recentMovements.length})`}
          subtitle="Every inward Purchase/Credit Note and outward Sales invoice line item synced from Tally Prime"
          noPadding
        >
          {inv.recentMovements.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
              No voucher item movements recorded yet. Sync Tally Prime bills with inventory entries or create a bill with an item on the Tally Bills screen.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-6 py-3">Date &amp; Bill #</th>
                    <th className="px-4 py-3">Voucher Type</th>
                    <th className="px-4 py-3">Party</th>
                    <th className="px-4 py-3">Stock Item &amp; Godown</th>
                    <th className="px-4 py-3 text-right">Stock Movement</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-6 py-3 text-right">Line Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {inv.recentMovements.map((m) => {
                    const isInward = m.signedQty >= 0;
                    return (
                      <tr key={m.id} className="hover:bg-[var(--surface-inset)]">
                        <td className="px-6 py-3.5">
                          <ActionLink
                            href={`/tally/vouchers/${encodeURIComponent(m.voucherId)}`}
                            spinnerSize="xs"
                            className="font-mono font-bold text-[var(--ink)] hover:text-emerald-700 hover:underline"
                          >
                            #{m.voucherNumber}
                          </ActionLink>
                          <div className="text-[11px] text-[var(--ink-muted)]">
                            {new Date(m.voucherDate).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                              isInward ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800"
                            }`}
                          >
                            {isInward ? (
                              <ArrowDownLeft className="h-3 w-3" />
                            ) : (
                              <ArrowUpRight className="h-3 w-3" />
                            )}
                            {m.voucherType}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-[var(--ink)]">{m.partyName}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-[var(--ink)]">{m.itemName}</div>
                          <div className="text-[11px] text-[var(--ink-muted)]">
                            {m.godownName}
                            {m.batchName && m.batchName !== "Primary Batch"
                              ? ` • Batch: ${m.batchName}`
                              : ""}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3.5 text-right font-mono font-bold tabular-nums ${
                            isInward ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {isInward ? "+" : ""}
                          {formatStockQty(m.signedQty, m.uom)}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-[var(--ink-secondary)]">
                          {formatInr(m.ratePaise, { showDecimals: true })}
                        </td>
                        <td className="px-6 py-3.5 text-right font-bold tabular-nums text-[var(--ink)]">
                          {formatInr(m.amountPaise)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </InventoryShell>
  );
}
