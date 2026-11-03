import { headers } from "next/headers";
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  Layers,
  MessageSquareShare,
  Package,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { formatInr, resolveEndpointsFromHeaders } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getWorkspaceInventorySummary, probeLocalTallyPort9000 } from "@rsl/tally";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  deleteStockItemAction,
  importTallyInventoryFileAction,
  syncLocalTallyInventoryAction,
  upsertStockItemAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatQty(qty: number, uom: string): string {
  const formatted = Number.isInteger(qty)
    ? qty.toLocaleString("en-IN")
    : qty.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return `${formatted} ${uom}`;
}

export default async function InventoryStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/inventory", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Inventory & Stock"
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
        pageTitle="Live Tally Inventory, Godowns & Reorder Intelligence"
        pageSubtitle="Sync Tally Prime Stock Items, Godowns, Batch Expiry balances, and Party Credit Limits automatically — every bill updates your live closing stock."
        plans={plans}
        returnPath="/inventory"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });

  const [inv, localPortProbe] = await Promise.all([
    Promise.resolve(getWorkspaceInventorySummary(session.workspace.id)),
    endpoints.isLocalDev ? probeLocalTallyPort9000(9000) : Promise.resolve(null),
  ]);

  const requestedTab =
    sp.tab === "godowns" ||
    sp.tab === "reorder" ||
    sp.tab === "movements" ||
    sp.tab === "manage"
      ? sp.tab
      : sp.edit && canManageTally
        ? "manage"
        : "summary";
  const activeTab = requestedTab === "manage" && !canManageTally ? "summary" : requestedTab;

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

  const editingItem =
    sp.edit && canManageTally ? inv.items.find((i) => i.id === sp.edit) ?? null : null;
  const editingPrimaryBalance = editingItem
    ? inv.balances.find((b) => b.itemId === editingItem.id) ?? null
    : null;

  const navTabs = [
    {
      key: "summary" as const,
      label: `Stock Summary & Price List (${inv.items.length})`,
    },
    {
      key: "godowns" as const,
      label: `Godowns & Batches (${inv.kpis.godownCount})`,
    },
    {
      key: "reorder" as const,
      label: `Reorder & Dead Stock (${inv.reorderActionItems.length + inv.kpis.inactive60dCount})`,
    },
    {
      key: "movements" as const,
      label: `Item Sales & Ledger (${inv.recentMovements.length})`,
    },
    ...(canManageTally
      ? [
          {
            key: "manage" as const,
            label: editingItem ? `Edit SKU: ${editingItem.name}` : "Add SKU / Sync & Import",
          },
        ]
      : []),
  ];

  const defaultCompanyName =
    session.workspace.defaultTallyCompany ||
    inv.companies[0]?.name ||
    session.workspace.name;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Tally Prime Inventory & Stock Intelligence"
        badge={
          <StatusPill
            label={`${inv.kpis.totalSkusCount} SKUs • ${inv.kpis.godownCount} Godown(s)`}
            tone={inv.kpis.totalSkusCount > 0 ? "emerald" : "stone"}
          />
        }
        title="Inventory, Godowns & Reorder Register"
        subtitle="Real-time Tally Prime stock valuation, warehouse & batch expiry tracking, 30/60/90-day dead-stock alerts, and 1-click WhatsApp item quotes — automatically updated on every bill."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href="/tally" spinnerSize="xs" className="rsl-btn-secondary">
              Bills &amp; Receipts
            </ActionLink>
            {localPortProbe?.reachable && canManageTally && (
              <form action={syncLocalTallyInventoryAction}>
                <input type="hidden" name="port" value={String(localPortProbe.port)} />
                <SubmitButton pendingText="Syncing Tally..." className="rsl-btn-secondary">
                  Sync Tally Port {localPortProbe.port}
                </SubmitButton>
              </form>
            )}
            {inv.items.length > 0 && (
              <details className="relative">
                <summary className="rsl-btn-secondary cursor-pointer list-none select-none">
                  Export Stock ▾
                </summary>
                <div className="absolute right-0 z-20 mt-1.5 flex w-56 flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 text-xs shadow-lg">
                  <a
                    href="/api/export/inventory-csv"
                    className="rounded-lg px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                  >
                    Export Stock Register CSV
                  </a>
                  <a
                    href="/api/export/inventory-xml"
                    className="rounded-lg px-3 py-2 font-medium text-slate-800 hover:bg-zinc-50"
                  >
                    Export Tally Prime Stock XML
                  </a>
                </div>
              </details>
            )}
            {canManageTally && (
              <ActionLink href="/inventory?tab=manage" spinnerSize="xs" className="rsl-btn-primary">
                + Add SKU / Import Masters
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* 5 Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Total Stock Valuation"
          value={formatInr(inv.kpis.totalStockValuePaise)}
          sublabel={`${inv.kpis.inStockSkusCount} of ${inv.kpis.totalSkusCount} SKUs currently in stock`}
          accent="emerald"
          icon={<Boxes className="h-4 w-4" />}
        />
        <MetricCard
          label="Fast-Moving Items (30d)"
          value={`${inv.kpis.fastMovingCount} SKUs`}
          sublabel={`Item revenue: ${formatInr(inv.kpis.totalItemSalesPaise)}`}
          accent="sky"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Low & Negative Stock"
          value={String(
            inv.kpis.lowStockCount + inv.kpis.outOfStockCount + inv.kpis.negativeStockCount
          )}
          sublabel={`${inv.kpis.lowStockCount} below reorder • ${inv.kpis.negativeStockCount} negative`}
          accent={
            inv.kpis.negativeStockCount > 0
              ? "ruby"
              : inv.kpis.lowStockCount > 0
                ? "amber"
                : "default"
          }
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <MetricCard
          label="Dead Stock Locked (60d+)"
          value={formatInr(inv.kpis.inactive60dValuePaise)}
          sublabel={`${inv.kpis.inactive60dCount} idle 60d+ • ${inv.kpis.inactive90dCount} idle 90d+`}
          accent={inv.kpis.inactive60dCount > 0 ? "amber" : "default"}
          icon={<Archive className="h-4 w-4" />}
        />
        <MetricCard
          label="Godowns & Batch Expiry"
          value={`${inv.kpis.godownCount} Location(s)`}
          sublabel={`${inv.kpis.expiredBatchCount} expired • ${inv.kpis.expiringSoonBatchCount} expiring ≤30d`}
          accent={inv.kpis.expiredBatchCount > 0 ? "ruby" : "default"}
          icon={<Warehouse className="h-4 w-4" />}
        />
      </div>

      {/* Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {navTabs.map((t) => {
            const active = activeTab === t.key;
            return (
              <ActionLink
                key={t.key}
                href={`/inventory?tab=${t.key}`}
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
        <div className="inline-flex items-center gap-1.5 px-3 text-[11px] font-semibold text-zinc-600">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          <span>Every Tally Sales, Purchase, Credit Note, Cancel &amp; Delete updates stock live</span>
        </div>
      </div>

      {/* TAB 1: STOCK SUMMARY & PRICE LIST */}
      {activeTab === "summary" && (
        <SectionCard
          title={`Live Stock Summary & Price List (${filteredItems.length})`}
          subtitle="Instant availability, HSN/GST rates, valuation, and 1-click WhatsApp customer price quotes"
          action={
            canManageTally ? (
              <div className="flex flex-wrap items-center gap-2">
                <ActionLink href="/tally?tab=import" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                  + Create Bill with Items
                </ActionLink>
                <ActionLink href="/inventory?tab=manage" spinnerSize="xs" className="rsl-btn-primary text-xs">
                  + Add / Import Stock Items
                </ActionLink>
              </div>
            ) : undefined
          }
          noPadding
        >
          {inv.items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/60 px-6 py-3">
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
                  const href = `/inventory?tab=summary${
                    pill.key !== "all" ? `&health=${pill.key}` : ""
                  }${selectedGroup !== "all" ? `&group=${encodeURIComponent(selectedGroup)}` : ""}${
                    query ? `&q=${encodeURIComponent(query)}` : ""
                  }`;
                  return (
                    <ActionLink
                      key={pill.key}
                      href={href}
                      spinnerSize="xs"
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        active
                          ? "bg-slate-900 text-white shadow-xs"
                          : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                      }`}
                    >
                      {pill.label}
                    </ActionLink>
                  );
                })}
              </div>

              <form method="get" action="/inventory" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="tab" value="summary" />
                {healthFilter !== "all" && (
                  <input type="hidden" name="health" value={healthFilter} />
                )}
                {inv.stockGroups.length > 1 && (
                  <select
                    name="group"
                    defaultValue={selectedGroup}
                    className="rsl-input w-auto py-1.5 text-xs"
                  >
                    <option value="all">All Stock Groups ({inv.stockGroups.length})</option>
                    {inv.stockGroups.map((grp) => (
                      <option key={grp} value={grp}>
                        {grp}
                      </option>
                    ))}
                  </select>
                )}
                <div className="relative min-w-[230px]">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
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
                  <ActionLink
                    href="/inventory?tab=summary"
                    spinnerSize="xs"
                    className="rsl-btn-secondary py-1.5 text-xs"
                  >
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
                    : "Pair Windows Connector v2.4, upload a Tally Prime Masters XML / CSV file, or add your first SKU manually — every Sales or Purchase bill automatically updates stock."
                }
                actionLabel={canManageTally ? "Add / Import Stock Items" : "Go to Tally Bills"}
                actionHref={canManageTally ? "/inventory?tab=manage" : "/tally"}
                icon={<Package className="h-5 w-5" />}
              />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No stock items match your current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
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
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {filteredItems.map((item) => {
                    const costRate =
                      item.costPricePaise > 0 ? item.costPricePaise : item.closingRatePaise;
                    const quoteRatePaise =
                      item.sellingPricePaise > 0 ? item.sellingPricePaise : costRate;
                    const quoteText = `Hello! Price & Stock Quote from *${session.workspace.name}*:\n• *Item:* ${item.name}${item.hsnCode ? ` (HSN ${item.hsnCode})` : ""}\n• *Rate:* ${formatInr(quoteRatePaise, { showDecimals: true })} / ${item.uom} (+ ${item.gstRatePct}% GST)\n• *Availability:* ${item.closingQty > 0 ? `In Stock (${formatQty(item.closingQty, item.uom)})` : "Available on Order"}`;
                    const waQuoteHref = `https://wa.me/?text=${encodeURIComponent(quoteText)}`;

                    return (
                      <tr key={item.id} className="hover:bg-zinc-50/60">
                        <td className="px-6 py-3.5">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                            {(item.skuCode || item.partNumber) && (
                              <span className="font-mono">
                                SKU: {item.skuCode || item.partNumber}
                              </span>
                            )}
                            {inv.companies.length > 1 && (
                              <span className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px]">
                                <Building2 className="h-2.5 w-2.5" />
                                {item.companyName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-slate-800">{item.stockGroup}</div>
                          <div className="text-[11px] text-zinc-500">
                            {item.hsnCode ? `HSN ${item.hsnCode} • ` : ""}GST {item.gstRatePct}%
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-zinc-700">
                          <div>{item.primaryGodown}</div>
                          {item.godownCount > 1 && (
                            <div className="text-[10px] text-zinc-500">
                              +{item.godownCount - 1} more location(s)
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-slate-900">
                          <div>{formatQty(item.closingQty, item.uom)}</div>
                          {item.reorderLevelQty > 0 && (
                            <div className="text-[10px] font-normal text-zinc-500">
                              Reorder ≤ {item.reorderLevelQty} {item.uom}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-zinc-600">
                          {costRate > 0 ? formatInr(costRate, { showDecimals: true }) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {item.sellingPricePaise > 0
                              ? formatInr(item.sellingPricePaise, { showDecimals: true })
                              : "—"}
                          </div>
                          {item.estimatedMarginBps > 0 && (
                            <div className="text-[10px] font-medium text-emerald-700">
                              {(item.estimatedMarginBps / 100).toFixed(1)}% margin
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold tabular-nums text-slate-900">
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
                                  href={`/inventory?tab=manage&edit=${encodeURIComponent(item.id)}`}
                                  spinnerSize="xs"
                                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-zinc-50"
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
          )}
        </SectionCard>
      )}

      {/* TAB 2: GODOWNS & BATCH EXPIRY */}
      {activeTab === "godowns" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {inv.godownSummaries.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center text-xs text-zinc-500">
                No godown balances recorded yet. Import Tally StockItems or add an item with a Godown name.
              </div>
            ) : (
              inv.godownSummaries.map((g) => (
                <div
                  key={g.godownName}
                  className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-2xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-xs font-bold text-slate-900">
                      <Warehouse className="h-4 w-4 text-emerald-600" />
                      <span>{g.godownName}</span>
                    </div>
                    <StatusPill label={`${g.skuCount} SKUs`} tone="emerald" showDot={false} />
                  </div>
                  <div className="mt-3 text-xl font-bold tabular-nums text-slate-900">
                    {formatInr(g.totalValuePaise)}
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Total Stock Units: <strong className="text-slate-800">{g.totalQty}</strong>
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
              <div className="p-8 text-center text-xs text-zinc-500">
                No batch or godown allocations synced yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-6 py-3">Stock Item</th>
                      <th className="px-4 py-3">Godown / Warehouse</th>
                      <th className="px-4 py-3">Batch / Lot #</th>
                      <th className="px-4 py-3">Expiry Status</th>
                      <th className="px-4 py-3 text-right">Closing Qty</th>
                      <th className="px-6 py-3 text-right">Batch Valuation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {inv.balances.map((b) => (
                      <tr key={b.id} className="hover:bg-zinc-50/60">
                        <td className="px-6 py-3.5 font-semibold text-slate-900">{b.itemName}</td>
                        <td className="px-4 py-3.5 text-zinc-700">{b.godownName}</td>
                        <td className="px-4 py-3.5 font-mono text-zinc-700">{b.batchName}</td>
                        <td className="px-4 py-3.5">
                          {b.expiryDate === null ? (
                            <span className="text-[11px] text-zinc-400">Non-perishable</span>
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
                              <span className="text-[11px] text-zinc-500">
                                {new Date(b.expiryDate).toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-slate-900">
                          {formatQty(b.closingQty, b.uom)}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold tabular-nums text-slate-900">
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
      )}

      {/* TAB 3: REORDER SHORTFALLS, DEAD STOCK (30/60/90D) & PARTY CREDIT LIMITS */}
      {activeTab === "reorder" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard
              title={`Purchase Reorder Action List (${inv.reorderActionItems.length})`}
              subtitle="Items below Tally Reorder Level, out of stock on active SKUs, or in negative stock"
              noPadding
            >
              {inv.reorderActionItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">
                  All stocked items are currently above their reorder threshold.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                      <tr>
                        <th className="px-5 py-3">Item</th>
                        <th className="px-3 py-3 text-right">Current</th>
                        <th className="px-3 py-3 text-right">Reorder At</th>
                        <th className="px-3 py-3 text-right">Order Qty</th>
                        <th className="px-5 py-3 text-right">Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {inv.reorderActionItems.map((i) => (
                        <tr key={i.id} className="hover:bg-zinc-50/60">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-900">{i.name}</div>
                            <div className="text-[11px] text-zinc-500">{i.primaryGodown}</div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-bold text-rose-700">
                            {formatQty(i.closingQty, i.uom)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-zinc-600">
                            {formatQty(i.reorderLevelQty, i.uom)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono font-semibold text-emerald-800">
                            +{formatQty(i.recommendedOrderQty, i.uom)}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
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
                <div className="p-8 text-center text-xs text-zinc-500">
                  Zero 30+ day dead stock — all stocked SKUs are moving briskly.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                      <tr>
                        <th className="px-5 py-3">Item</th>
                        <th className="px-3 py-3">Idle Bucket</th>
                        <th className="px-3 py-3 text-right">Stock On Hand</th>
                        <th className="px-5 py-3 text-right">Locked Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {inv.inactiveStockItems.map((i) => (
                        <tr key={i.id} className="hover:bg-zinc-50/60">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-900">{i.name}</div>
                            <div className="text-[11px] text-zinc-500">{i.stockGroup}</div>
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
                          <td className="px-3 py-3 text-right font-mono text-zinc-700">
                            {formatQty(i.closingQty, i.uom)}
                          </td>
                          <td className="px-5 py-3 text-right font-bold tabular-nums text-slate-900">
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
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-6 py-3">Party Ledger</th>
                      <th className="px-4 py-3">GSTIN &amp; State</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3 text-right">Credit Limit</th>
                      <th className="px-4 py-3 text-right">Closing Balance</th>
                      <th className="px-6 py-3">Credit Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {inv.parties.slice(0, 40).map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-50/60">
                        <td className="px-6 py-3">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          {p.creditDays > 0 && (
                            <div className="text-[11px] text-zinc-500">
                              Credit Period: {p.creditDays} days
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-slate-800">{p.gstin || "Unregistered"}</div>
                          {p.stateName && (
                            <div className="text-[11px] text-zinc-500">{p.stateName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-600">
                          <div>{p.phoneE164 || "—"}</div>
                          {p.email && <div className="text-[11px] text-zinc-500">{p.email}</div>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                          {p.creditLimitPaise > 0 ? formatInr(p.creditLimitPaise) : "No cap"}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
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
      )}

      {/* TAB 4: ITEM SALES & STOCK MOVEMENTS LEDGER */}
      {activeTab === "movements" && (
        <div className="space-y-6">
          {inv.topSellingItems.length > 0 && (
            <SectionCard
              title={`Top-Selling Items by Revenue (${inv.topSellingItems.length})`}
              subtitle="Calculated automatically from synced Tally Sales & Credit Note line items"
              noPadding
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-6 py-3">Item Name</th>
                      <th className="px-4 py-3">Stock Group</th>
                      <th className="px-4 py-3 text-right">Units Sold</th>
                      <th className="px-4 py-3 text-right">Units Purchased</th>
                      <th className="px-4 py-3 text-right">Closing Stock</th>
                      <th className="px-6 py-3 text-right">Total Sales Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {inv.topSellingItems.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-50/60">
                        <td className="px-6 py-3 font-semibold text-slate-900">{item.name}</td>
                        <td className="px-4 py-3 text-zinc-600">{item.stockGroup}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {formatQty(item.totalSoldQty, item.uom)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-600">
                          {formatQty(item.totalPurchasedQty, item.uom)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-800">
                          {formatQty(item.closingQty, item.uom)}
                        </td>
                        <td className="px-6 py-3 text-right font-bold tabular-nums text-emerald-800">
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
              <div className="p-8 text-center text-xs text-zinc-500">
                No voucher item movements recorded yet. Sync Tally Prime bills with inventory entries or create a bill with an item on the Tally Bills screen.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
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
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {inv.recentMovements.map((m) => {
                      const isInward = m.signedQty >= 0;
                      return (
                        <tr key={m.id} className="hover:bg-zinc-50/60">
                          <td className="px-6 py-3.5">
                            <div className="font-mono font-bold text-slate-900">
                              #{m.voucherNumber}
                            </div>
                            <div className="text-[11px] text-zinc-500">
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
                                isInward
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-sky-50 text-sky-800"
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
                          <td className="px-4 py-3.5 font-medium text-slate-800">{m.partyName}</td>
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-slate-900">{m.itemName}</div>
                            <div className="text-[11px] text-zinc-500">
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
                            {formatQty(m.signedQty, m.uom)}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-zinc-600">
                            {formatInr(m.ratePaise, { showDecimals: true })}
                          </td>
                          <td className="px-6 py-3.5 text-right font-bold tabular-nums text-slate-900">
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
      )}

      {/* TAB 5: ADD / EDIT SKU OR IMPORT TALLY MASTERS XML & CSV */}
      {activeTab === "manage" && canManageTally && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionCard
            title={
              editingItem
                ? `Edit Stock Item — ${editingItem.name}`
                : "Add or Update a Stock Item (SKU)"
            }
            subtitle="Sets opening balance, godown/batch location, HSN/GST rate, selling price, and reorder level"
            action={
              editingItem ? (
                <ActionLink
                  href="/inventory?tab=manage"
                  spinnerSize="xs"
                  className="rsl-btn-secondary text-xs"
                >
                  Clear Edit
                </ActionLink>
              ) : undefined
            }
          >
            <form action={upsertStockItemAction} className="space-y-3 text-xs">
              {editingItem && <input type="hidden" name="itemId" value={editingItem.id} />}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Stock Item Name *</label>
                  <input
                    name="name"
                    required
                    defaultValue={editingItem?.name ?? ""}
                    placeholder="e.g. Havells 4 Sqmm Copper Wire (90m)"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Tally Company</label>
                  <input
                    name="companyName"
                    defaultValue={editingItem?.companyName ?? defaultCompanyName}
                    required
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">SKU / Part No.</label>
                  <input
                    name="skuCode"
                    defaultValue={editingItem?.skuCode ?? editingItem?.partNumber ?? ""}
                    placeholder="HVL-4MM-90"
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Stock Group</label>
                  <input
                    name="stockGroup"
                    defaultValue={editingItem?.stockGroup ?? "Primary"}
                    placeholder="Cables & Wires"
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Unit (UOM)</label>
                  <input
                    name="uom"
                    defaultValue={editingItem?.uom ?? "PCS"}
                    placeholder="PCS / BOX / KG"
                    className="rsl-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">HSN / SAC</label>
                  <input
                    name="hsnCode"
                    defaultValue={editingItem?.hsnCode ?? ""}
                    placeholder="8544"
                    className="rsl-input font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Selling Rate (₹)</label>
                  <input
                    name="sellingPriceRupees"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={
                      editingItem ? (editingItem.sellingPricePaise / 100).toFixed(2) : "0"
                    }
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Cost / Std Rate (₹)</label>
                  <input
                    name="costPriceRupees"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={
                      editingItem ? (editingItem.costPricePaise / 100).toFixed(2) : "0"
                    }
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">GST Rate (%)</label>
                  <input
                    name="gstRatePct"
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    defaultValue={editingItem?.gstRatePct ?? 18}
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Opening Qty</label>
                  <input
                    name="openingQty"
                    type="number"
                    step="0.001"
                    defaultValue={editingItem?.openingQty ?? 0}
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Reorder Level</label>
                  <input
                    name="reorderLevelQty"
                    type="number"
                    step="0.001"
                    min="0"
                    defaultValue={editingItem?.reorderLevelQty ?? 0}
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Min Order Qty</label>
                  <input
                    name="minOrderQty"
                    type="number"
                    step="0.001"
                    min="0"
                    defaultValue={editingItem?.minOrderQty ?? 0}
                    className="rsl-input tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Godown / Warehouse</label>
                  <input
                    name="godownName"
                    defaultValue={editingItem?.primaryGodown ?? "Main Location"}
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Batch / Lot Name</label>
                  <input
                    name="batchName"
                    defaultValue={editingPrimaryBalance?.batchName ?? "Primary Batch"}
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">Batch Expiry (Optional)</label>
                  <input
                    name="expiryDateIso"
                    type="date"
                    defaultValue={
                      editingPrimaryBalance?.expiryDate
                        ? new Date(editingPrimaryBalance.expiryDate).toISOString().slice(0, 10)
                        : ""
                    }
                    className="rsl-input"
                  />
                </div>
              </div>

              <SubmitButton pendingText="Saving Stock Item..." className="rsl-btn-primary">
                {editingItem ? "Update Stock Item" : "Save Stock Item"}
              </SubmitButton>
            </form>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard
              title="Import Tally Prime Inventory Masters (XML or CSV)"
              subtitle="Export Masters (Stock Items, Godowns & Ledgers) from Tally Prime (Alt+E -> Masters -> XML) or upload a Price/Stock CSV"
            >
              <form action={importTallyInventoryFileAction} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-zinc-700">
                      Tally Company Name
                    </label>
                    <input
                      name="companyName"
                      defaultValue={defaultCompanyName}
                      required
                      className="rsl-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-zinc-700">Import Format</label>
                    <select name="format" defaultValue="tally_xml" className="rsl-input">
                      <option value="tally_xml">
                        Tally Prime Masters XML (StockItem / Godown / Ledger)
                      </option>
                      <option value="csv">Inventory Spreadsheet CSV (.csv)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Upload Masters File (.xml / .csv)
                  </label>
                  <input
                    name="uploadFile"
                    type="file"
                    accept=".xml,.csv,.txt"
                    className="rsl-input"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-zinc-700">
                    Or Paste Tally XML / CSV Rows Directly
                  </label>
                  <textarea
                    name="rawContent"
                    rows={4}
                    placeholder="ItemName,SKU,StockGroup,UOM,HSN,GST,SellingPrice,CostPrice,OpeningQty,ReorderLevel,Godown"
                    className="rsl-input font-mono text-[11px]"
                  />
                </div>

                <SubmitButton pendingText="Importing Inventory..." className="rsl-btn-primary">
                  Import Stock Items &amp; Masters
                </SubmitButton>
              </form>
            </SectionCard>

            <SectionCard
              title="Automatic Live Sync with Tally Prime"
              subtitle="Zero manual entry once your Tally PC is paired"
            >
              <div className="space-y-3 text-xs leading-relaxed text-zinc-600">
                <div className="flex items-start gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div>
                    <div className="font-semibold text-slate-900">
                      Windows Connector v2.4 Syncs Both Masters &amp; Vouchers Every 30s
                    </div>
                    <p className="mt-1">
                      When <code className="font-mono text-slate-900">rsl-tally-connector.mjs</code>{" "}
                      runs on your Tally PC, it automatically pulls{" "}
                      <strong>Stock Items, Godowns, Batch Expiry dates, and Party Credit Limits</strong>{" "}
                      alongside every Sales, Purchase, Receipt, and Credit Note voucher — recalculating
                      closing stock without ever overwriting previous bills.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionLink
                    href="/tally?tab=connect"
                    spinnerSize="xs"
                    className="rsl-btn-secondary text-xs"
                  >
                    <Layers className="mr-1.5 inline h-3.5 w-3.5" />
                    Configure Tally Connector &amp; .tdl v2.6
                  </ActionLink>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
