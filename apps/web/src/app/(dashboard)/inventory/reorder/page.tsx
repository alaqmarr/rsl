import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard, StatusPill } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { InventoryShell } from "@/components/inventory-shell";
import { ActionLink } from "@/components/ios-feedback";
import { formatStockQty, loadInventoryPageContext } from "@/lib/inventory-data";

export default async function InventoryReorderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadInventoryPageContext(sp.company);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Reorder & Dead Stock"
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
        pageTitle="Purchase Reorder & Dead Stock Intelligence"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to spot reorder shortfalls, slow stock aging, and party credit limit utilization."
        plans={ctx.plans}
        returnPath="/inventory/reorder"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { canManageTally, inv, localPortProbe, selectedCompanyId } = ctx;

  return (
    <InventoryShell
      activeSection="reorder"
      canManageTally={canManageTally}
      selectedCompanyId={selectedCompanyId}
      inv={inv}
      localPortProbe={localPortProbe}
      notice={sp.notice}
      error={sp.error}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionCard
            title={`Purchase Reorder Action List (${inv.reorderActionItems.length})`}
            subtitle="Items below Tally Reorder Level, out of stock on active SKUs, or in negative stock"
            noPadding
          >
            {inv.reorderActionItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
                All stocked items are currently above their reorder threshold.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-3 py-3 text-right">Current</th>
                      <th className="px-3 py-3 text-right">Reorder At</th>
                      <th className="px-3 py-3 text-right">Order Qty</th>
                      <th className="px-5 py-3 text-right">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                    {inv.reorderActionItems.map((i) => (
                      <tr key={i.id} className="hover:bg-[var(--surface-inset)]">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-[var(--ink)]">{i.name}</div>
                          <div className="text-[11px] text-[var(--ink-muted)]">{i.primaryGodown}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-rose-700">
                          {formatStockQty(i.closingQty, i.uom)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[var(--ink-secondary)]">
                          {formatStockQty(i.reorderLevelQty, i.uom)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-emerald-800">
                          +{formatStockQty(i.recommendedOrderQty, i.uom)}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">
                          {formatInr(i.estimatedOrderCostPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`Slow & Dead Stock Aging (${inv.inactiveStockItems.length})`}
            subtitle="Positive stock with zero sales in 30 / 60 / 90+ days tying up working capital"
            noPadding
          >
            {inv.inactiveStockItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
                Zero 30+ day dead stock - all stocked SKUs are moving briskly.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                    <tr>
                      <th className="px-5 py-3">Item</th>
                      <th className="px-3 py-3">Idle Bucket</th>
                      <th className="px-3 py-3 text-right">Stock On Hand</th>
                      <th className="px-5 py-3 text-right">Locked Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                    {inv.inactiveStockItems.map((i) => (
                      <tr key={i.id} className="hover:bg-[var(--surface-inset)]">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-[var(--ink)]">{i.name}</div>
                          <div className="text-[11px] text-[var(--ink-muted)]">{i.stockGroup}</div>
                        </td>
                        <td className="px-3 py-3">
                          <StatusPill
                            label={
                              i.isInactive90d
                                ? `90d+ (${i.inactiveAgeDays}d)`
                                : i.isInactive60d
                                  ? `60d+ (${i.inactiveAgeDays}d)`
                                  : `30d+ (${i.inactiveAgeDays}d)`
                            }
                            tone={i.isInactive90d ? "ruby" : "amber"}
                          />
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-[var(--ink-secondary)]">
                          {formatStockQty(i.closingQty, i.uom)}
                        </td>
                        <td className="px-5 py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                          {formatInr(i.closingValuePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {inv.parties.length > 0 && (
          <SectionCard
            title={`Synced Party Masters & Credit Limit Monitor (${inv.parties.length})`}
            subtitle="Customer & supplier ledgers synced from Tally Prime with GSTIN, credit days, and credit limit utilization"
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-6 py-3">Party Ledger</th>
                    <th className="px-4 py-3">GSTIN &amp; State</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3 text-right">Credit Limit</th>
                    <th className="px-4 py-3 text-right">Closing Balance</th>
                    <th className="px-6 py-3">Credit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {inv.parties.slice(0, 40).map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--surface-inset)]">
                      <td className="px-6 py-3">
                        <ActionLink
                          href={`/tally/parties/${encodeURIComponent(p.id)}`}
                          spinnerSize="xs"
                          className="font-semibold text-[var(--ink)] hover:text-emerald-700 hover:underline"
                        >
                          {p.name}
                        </ActionLink>
                        {p.creditDays > 0 && (
                          <div className="text-[11px] text-[var(--ink-muted)]">
                            Credit Period: {p.creditDays} days
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[var(--ink)]">{p.gstin || "Unregistered"}</div>
                        {p.stateName && (
                          <div className="text-[11px] text-[var(--ink-muted)]">{p.stateName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--ink-secondary)]">
                        <div>{p.phoneE164 || "-"}</div>
                        {p.email && <div className="text-[11px] text-[var(--ink-muted)]">{p.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--ink-secondary)]">
                        {p.creditLimitPaise > 0 ? formatInr(p.creditLimitPaise) : "No cap"}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                        {formatInr(p.closingBalancePaise)}
                      </td>
                      <td className="px-6 py-3">
                        <StatusPill
                          label={p.creditExceeded ? "Credit Limit Exceeded" : "Within Limit"}
                          tone={p.creditExceeded ? "ruby" : "emerald"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </InventoryShell>
  );
}
