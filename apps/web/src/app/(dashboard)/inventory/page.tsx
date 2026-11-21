import { redirect } from "next/navigation";
import { Building2, MessageSquareShare, Package, Search, Trash2 } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { InventoryShell } from "@/components/inventory-shell";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { deleteStockItemAction } from "@/lib/actions";
import { formatStockQty, loadInventoryPageContext } from "@/lib/inventory-data";

const INVENTORY_PAGE_SIZE = 60;

export default async function InventoryStockSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  if (
    sp.tab === "godowns" ||
    sp.tab === "reorder" ||
    sp.tab === "movements" ||
    sp.tab === "manage"
  ) {
    const qs = new URLSearchParams();
    if (sp.company && sp.company !== "all") qs.set("company", sp.company);
    if (sp.edit) qs.set("edit", sp.edit);
    if (sp.notice) qs.set("notice", sp.notice);
    if (sp.error) qs.set("error", sp.error);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/inventory/${sp.tab}${suffix}`);
  }
  if (sp.edit) {
    const qs = new URLSearchParams({ edit: sp.edit });
    if (sp.company && sp.company !== "all") qs.set("company", sp.company);
    redirect(`/inventory/manage?${qs.toString()}`);
  }

  const ctx = await loadInventoryPageContext(sp.company);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Inventory & Stock"
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
        pageTitle="Live Tally Inventory, Godowns & Reorder Intelligence"
        pageSubtitle="Sync Tally Prime Stock Items, Godowns, Batch Expiry balances, and Party Credit Limits automatically - every bill updates your live closing stock."
        plans={ctx.plans}
        returnPath="/inventory"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, canManageTally, inv, localPortProbe, selectedCompanyId } = ctx;
  const query = sp.q?.trim() || "";
  const selectedGroup = sp.group && inv.stockGroups.includes(sp.group) ? sp.group : "all";
  const healthFilter =
    sp.health === "healthy" ||
    sp.health === "low" ||
    sp.health === "out" ||
    sp.health === "negative" ||
    sp.health === "fast" ||
    sp.health === "inactive60"
      ? sp.health
      : "all";

  const filteredItems = inv.items.filter((item) => {
    if (selectedGroup !== "all" && item.stockGroup !== selectedGroup) return false;
    if (healthFilter === "healthy" && item.stockStatus !== "healthy") return false;
    if (healthFilter === "low" && item.stockStatus !== "low_stock") return false;
    if (healthFilter === "out" && item.stockStatus !== "out_of_stock") return false;
    if (healthFilter === "negative" && item.stockStatus !== "negative_stock") return false;
    if (healthFilter === "fast" && !item.isFastMoving) return false;
    if (healthFilter === "inactive60" && !item.isInactive60d) return false;
    if (query) {
      const qLower = query.toLowerCase();
      const hay = `${item.name} ${item.skuCode ?? ""} ${item.partNumber ?? ""} ${item.stockGroup} ${item.hsnCode ?? ""} ${item.primaryGodown} ${item.companyName}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / INVENTORY_PAGE_SIZE));
  const currentPage = Math.max(1, Math.min(totalPages, Number(sp.page || 1) || 1));
  const pagedItems = filteredItems.slice(
    (currentPage - 1) * INVENTORY_PAGE_SIZE,
    currentPage * INVENTORY_PAGE_SIZE
  );

  function buildPageHref(pageNum: number) {
    const qs = new URLSearchParams();
    if (selectedCompanyId !== "all") qs.set("company", selectedCompanyId);
    if (healthFilter !== "all") qs.set("health", healthFilter);
    if (selectedGroup !== "all") qs.set("group", selectedGroup);
    if (query) qs.set("q", query);
    if (pageNum > 1) qs.set("page", String(pageNum));
    const s = qs.toString();
    return s ? `/inventory?${s}` : "/inventory";
  }

  return (
    <InventoryShell
      activeSection="summary"
      canManageTally={canManageTally}
      selectedCompanyId={selectedCompanyId}
      inv={inv}
      localPortProbe={localPortProbe}
      notice={sp.notice}
      error={sp.error}
    >
      <SectionCard
        title={`Live Stock Summary & Price List (${filteredItems.length})`}
        subtitle="Instant availability, HSN/GST rates, valuation, and 1-click WhatsApp customer price quotes"
        action={
          canManageTally ? (
            <div className="flex flex-wrap items-center gap-2">
              <ActionLink href="/tally/import" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                + Create Bill with Items
              </ActionLink>
              <ActionLink href="/inventory/manage" spinnerSize="xs" className="rsl-btn-primary text-xs">
                + Add / Import Stock Items
              </ActionLink>
            </div>
          ) : undefined
        }
        noPadding
      >
        {inv.items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-inset)] px-6 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: "all", label: `All (${inv.items.length})` },
                  { key: "healthy", label: "Healthy" },
                  { key: "fast", label: `Fast Moving (${inv.kpis.fastMovingCount})` },
                  { key: "low", label: `Reorder (${inv.kpis.lowStockCount})` },
                  { key: "out", label: `Out of Stock (${inv.kpis.outOfStockCount})` },
                  { key: "negative", label: `Negative (${inv.kpis.negativeStockCount})` },
                  { key: "inactive60", label: `Idle 60d+ (${inv.kpis.inactive60dCount})` },
                ] as const
              ).map((pill) => {
                const active = healthFilter === pill.key;
                const qs = new URLSearchParams();
                if (pill.key !== "all") qs.set("health", pill.key);
                if (selectedCompanyId !== "all") qs.set("company", selectedCompanyId);
                if (selectedGroup !== "all") qs.set("group", selectedGroup);
                if (query) qs.set("q", query);
                const href = qs.toString() ? `/inventory?${qs.toString()}` : "/inventory";
                return (
                  <ActionLink
                    key={pill.key}
                    href={href}
                    spinnerSize="xs"
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? "bg-slate-900 text-white shadow-xs"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {pill.label}
                  </ActionLink>
                );
              })}
            </div>

            <form method="get" action="/inventory" className="flex flex-wrap items-center gap-2">
              {selectedCompanyId !== "all" && (
                <input type="hidden" name="company" value={selectedCompanyId} />
              )}
              {healthFilter !== "all" && <input type="hidden" name="health" value={healthFilter} />}
              {inv.stockGroups.length > 1 && (
                <select name="group" defaultValue={selectedGroup} className="rsl-input w-auto py-1.5 text-xs">
                  <option value="all">All Stock Groups ({inv.stockGroups.length})</option>
                  {inv.stockGroups.map((grp) => (
                    <option key={grp} value={grp}>
                      {grp}
                    </option>
                  ))}
                </select>
              )}
              <div className="relative min-w-[230px]">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search item, SKU, HSN, godown..."
                  className="rsl-input py-1.5 pl-8 text-xs"
                />
              </div>
              <SubmitButton
                spinnerSize="xs"
                pendingText="Filtering..."
                className="rsl-btn-secondary py-1.5 text-xs"
              >
                Filter
              </SubmitButton>
              {(query || healthFilter !== "all" || selectedGroup !== "all") && (
                <ActionLink href="/inventory" spinnerSize="xs" className="rsl-btn-secondary py-1.5 text-xs">
                  Reset
                </ActionLink>
              )}
            </form>
          </div>
        )}

        {inv.items.length === 0 ? (
          <div className="p-6">
            <EmptyWorkspaceState
              title="No Tally stock items synced yet"
              description={
                localPortProbe?.reachable && canManageTally
                  ? `Tally Prime is reachable on Port ${localPortProbe.port}. Click 'Sync Tally Port ${localPortProbe.port}' above or upload a Tally StockItem XML / CSV export to populate your live inventory register.`
                  : "Pair Windows Connector v2.4, upload a Tally Prime Masters XML / CSV file, or add your first SKU manually - every Sales or Purchase bill automatically updates stock."
              }
              actionLabel={canManageTally ? "Add / Import Stock Items" : "Go to Tally Bills"}
              actionHref={canManageTally ? "/inventory/manage" : "/tally"}
              icon={<Package className="h-5 w-5" />}
            />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--ink-muted)]">
            No stock items match your current filter.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-6 py-3">Stock Item &amp; SKU</th>
                    <th className="px-4 py-3">Group &amp; HSN/GST</th>
                    <th className="px-4 py-3">Godown</th>
                    <th className="px-4 py-3 text-right">Closing Stock</th>
                    <th className="px-4 py-3 text-right">Cost / Val Rate</th>
                    <th className="px-4 py-3 text-right">Selling Rate</th>
                    <th className="px-4 py-3 text-right">Stock Value</th>
                    <th className="px-4 py-3">Health</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {pagedItems.map((item) => {
                    const costRate =
                      item.costPricePaise > 0 ? item.costPricePaise : item.closingRatePaise;
                    const quoteRatePaise =
                      item.sellingPricePaise > 0 ? item.sellingPricePaise : costRate;
                    const quoteText = `Hello! Price & Stock Quote from *${session.workspace.name}*:\n• *Item:* ${item.name}${item.hsnCode ? ` (HSN ${item.hsnCode})` : ""}\n• *Rate:* ${formatInr(quoteRatePaise, { showDecimals: true })} / ${item.uom} (+ ${item.gstRatePct}% GST)\n• *Availability:* ${item.closingQty > 0 ? `In Stock (${formatStockQty(item.closingQty, item.uom)})` : "Available on Order"}`;
                    const waQuoteHref = `https://wa.me/?text=${encodeURIComponent(quoteText)}`;

                    return (
                      <tr key={item.id} className="hover:bg-[var(--surface-inset)]">
                        <td className="px-6 py-3.5">
                          <div className="font-semibold text-[var(--ink)]">{item.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                            {(item.skuCode || item.partNumber) && (
                              <span className="font-mono">SKU: {item.skuCode || item.partNumber}</span>
                            )}
                            {inv.companies.length > 1 && (
                              <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px]">
                                <Building2 className="h-2.5 w-2.5" />
                                {item.companyName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-[var(--ink)]">{item.stockGroup}</div>
                          <div className="text-[11px] text-[var(--ink-muted)]">
                            {item.hsnCode ? `HSN ${item.hsnCode} • ` : ""}GST {item.gstRatePct}%
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-[var(--ink-secondary)]">
                          <div>{item.primaryGodown}</div>
                          {item.godownCount > 1 && (
                            <div className="text-[10px] text-[var(--ink-muted)]">
                              +{item.godownCount - 1} more location(s)
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-[var(--ink)]">
                          <div>{formatStockQty(item.closingQty, item.uom)}</div>
                          {item.reorderLevelQty > 0 && (
                            <div className="text-[10px] font-normal text-[var(--ink-muted)]">
                              Reorder ≤ {item.reorderLevelQty} {item.uom}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-[var(--ink-secondary)]">
                          {costRate > 0 ? formatInr(costRate, { showDecimals: true }) : "-"}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">
                          <div className="font-semibold text-[var(--ink)]">
                            {item.sellingPricePaise > 0
                              ? formatInr(item.sellingPricePaise, { showDecimals: true })
                              : "-"}
                          </div>
                          {item.estimatedMarginBps > 0 && (
                            <div className="text-[10px] font-medium text-emerald-700">
                              {(item.estimatedMarginBps / 100).toFixed(1)}% margin
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold tabular-nums text-[var(--ink)]">
                          {formatInr(Math.max(0, item.closingValuePaise))}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusPill
                              label={
                                item.stockStatus === "negative_stock"
                                  ? "Negative"
                                  : item.stockStatus === "out_of_stock"
                                    ? "Out of Stock"
                                    : item.stockStatus === "low_stock"
                                      ? "Low Stock"
                                      : "In Stock"
                              }
                              tone={
                                item.stockStatus === "negative_stock"
                                  ? "ruby"
                                  : item.stockStatus === "out_of_stock"
                                    ? "stone"
                                    : item.stockStatus === "low_stock"
                                      ? "amber"
                                      : "emerald"
                              }
                            />
                            {item.isFastMoving && (
                              <StatusPill label="Fast Mover" tone="sky" showDot={false} />
                            )}
                            {item.isInactive60d && (
                              <StatusPill label="Idle 60d+" tone="amber" showDot={false} />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={waQuoteHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100"
                              title="Share instant WhatsApp price & stock quote"
                            >
                              <MessageSquareShare className="h-3 w-3" />
                              <span>Quote</span>
                            </a>
                            {canManageTally && (
                              <>
                                <ActionLink
                                  href={`/inventory/manage?edit=${encodeURIComponent(item.id)}`}
                                  spinnerSize="xs"
                                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-secondary)] hover:bg-[var(--surface-inset)]"
                                >
                                  Edit
                                </ActionLink>
                                <form action={deleteStockItemAction}>
                                  <input type="hidden" name="itemId" value={item.id} />
                                  <SubmitButton
                                    spinnerSize="xs"
                                    pendingText="..."
                                    className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </SubmitButton>
                                </form>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-inset)] px-6 py-3 text-xs">
                <span className="text-[var(--ink-secondary)]">
                  Showing {(currentPage - 1) * INVENTORY_PAGE_SIZE + 1}–
                  {Math.min(filteredItems.length, currentPage * INVENTORY_PAGE_SIZE)} of{" "}
                  {filteredItems.length} stock items (Page {currentPage} of {totalPages})
                </span>
                <div className="flex items-center gap-2">
                  {currentPage > 1 && (
                    <ActionLink
                      href={buildPageHref(currentPage - 1)}
                      spinnerSize="xs"
                      className="rsl-btn-secondary py-1 text-xs"
                    >
                      ← Previous
                    </ActionLink>
                  )}
                  {currentPage < totalPages && (
                    <ActionLink
                      href={buildPageHref(currentPage + 1)}
                      spinnerSize="xs"
                      className="rsl-btn-secondary py-1 text-xs"
                    >
                      Next →
                    </ActionLink>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </InventoryShell>
  );
}
