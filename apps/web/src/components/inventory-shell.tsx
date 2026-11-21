import {
  AlertTriangle,
  Archive,
  Boxes,
  Sparkles,
  TrendingUp,
  Users,
  Warehouse,
} from "lucide-react";
import { formatInr } from "@rsl/core";
import { MetricCard, PageHeader, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { HsnSacLookupBar } from "@/components/hsn-sac-lookup-bar";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import { syncLocalTallyInventoryAction } from "@/lib/actions";

export type InventorySectionKey = "summary" | "godowns" | "reorder" | "movements" | "manage";

export function InventoryShell({
  activeSection,
  canManageTally,
  selectedCompanyId,
  inv,
  localPortProbe,
  notice,
  error,
  children,
}: {
  activeSection: InventorySectionKey;
  canManageTally: boolean;
  selectedCompanyId: string;
  inv: {
    companies: Array<{ id: string; name: string }>;
    items: Array<unknown>;
    parties: Array<unknown>;
    reorderActionItems: Array<unknown>;
    recentMovements: Array<unknown>;
    kpis: {
      totalSkusCount: number;
      godownCount: number;
      totalStockValuePaise: number;
      inStockSkusCount: number;
      fastMovingCount: number;
      totalItemSalesPaise: number;
      lowStockCount: number;
      outOfStockCount: number;
      negativeStockCount: number;
      inactive60dValuePaise: number;
      inactive60dCount: number;
      inactive90dCount: number;
      expiredBatchCount: number;
      expiringSoonBatchCount: number;
    };
  };
  localPortProbe: { reachable: boolean; port: number } | null;
  notice?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const companyQs =
    selectedCompanyId !== "all" ? `?company=${encodeURIComponent(selectedCompanyId)}` : "";

  const navSections: Array<{ key: InventorySectionKey; href: string; label: string }> = [
    {
      key: "summary",
      href: `/inventory${companyQs}`,
      label: `Stock Summary & Price List (${inv.items.length})`,
    },
    {
      key: "godowns",
      href: `/inventory/godowns${companyQs}`,
      label: `Godowns & Batches (${inv.kpis.godownCount})`,
    },
    {
      key: "reorder",
      href: `/inventory/reorder${companyQs}`,
      label: `Reorder & Dead Stock (${inv.reorderActionItems.length + inv.kpis.inactive60dCount})`,
    },
    {
      key: "movements",
      href: `/inventory/movements${companyQs}`,
      label: `Item Sales & Ledger (${inv.recentMovements.length})`,
    },
    ...(canManageTally
      ? [
          {
            key: "manage" as const,
            href: `/inventory/manage${companyQs}`,
            label: "Add SKU / Sync & Import",
          },
        ]
      : []),
  ];

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="inventory"
        partiesCount={inv.parties.length}
        stockItemsCount={inv.items.length}
        companies={inv.companies}
        selectedCompanyId={selectedCompanyId}
      />

      <PageHeader
        eyebrow="All-in-One Tally Prime Suite"
        badge={
          <StatusPill
            label={`${inv.kpis.totalSkusCount} SKUs • ${inv.kpis.godownCount} Godown(s)`}
            tone={inv.kpis.totalSkusCount > 0 ? "emerald" : "stone"}
          />
        }
        title="Inventory, Godowns & Reorder Register"
        subtitle="Real-time Tally Prime stock valuation, warehouse & batch expiry tracking, 30/60/90-day dead-stock alerts, and 1-click WhatsApp item quotes - automatically updated on every bill."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionLink href="/tally" spinnerSize="xs" className="rsl-btn-secondary">
              Bills &amp; Receipts
            </ActionLink>
            <ActionLink href="/tally/parties" spinnerSize="xs" className="rsl-btn-secondary">
              <Users className="mr-1.5 inline h-3.5 w-3.5" />
              Client Ledgers ({inv.parties.length})
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
                <div className="absolute right-0 z-20 mt-1.5 flex w-56 flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 text-xs shadow-lg">
                  <a
                    href="/api/export/inventory-csv"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Export Stock Register CSV
                  </a>
                  <a
                    href="/api/export/inventory-xml"
                    className="rounded-lg px-3 py-2 font-medium text-[var(--ink)] hover:bg-[var(--surface-inset)]"
                  >
                    Export Tally Prime Stock XML
                  </a>
                </div>
              </details>
            )}
            {canManageTally && activeSection !== "manage" && (
              <ActionLink href="/inventory/manage" spinnerSize="xs" className="rsl-btn-primary">
                + Add SKU / Import Masters
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={notice} error={error} />

      <HsnSacLookupBar />

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

      <nav
        aria-label="Inventory Pages"
        className="rsl-frost-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-2"
      >
        <div className="rsl-tab-bar">
          {navSections.map((s) => {
            const active = activeSection === s.key;
            return (
              <ActionLink
                key={s.key}
                href={s.href}
                spinnerSize="xs"
                className={`rsl-tab-pill ${active ? "rsl-tab-pill-active" : ""}`}
              >
                {s.label}
              </ActionLink>
            );
          })}
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 text-[11px] font-semibold text-[var(--ink-secondary)]">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          <span>Every Tally Sales, Purchase, Credit Note, Cancel &amp; Delete updates stock live</span>
        </div>
      </nav>

      {children}
    </div>
  );
}
