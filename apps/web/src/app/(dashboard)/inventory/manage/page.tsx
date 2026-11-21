import { Layers } from "lucide-react";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { InventoryShell } from "@/components/inventory-shell";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { importTallyInventoryFileAction, upsertStockItemAction } from "@/lib/actions";
import { loadInventoryPageContext } from "@/lib/inventory-data";

export default async function InventoryManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await loadInventoryPageContext(sp.company);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Add SKU & Import Masters"
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
        pageTitle="Manage Stock Items & Import Tally Masters"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to add SKUs or import StockItem/Godown XML masters."
        plans={ctx.plans}
        returnPath="/inventory/manage"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, canManageTally, inv, localPortProbe, selectedCompanyId, defaultCompanyName } =
    ctx;

  if (!canManageTally) {
    return (
      <AccessRestrictedState
        pageTitle="Add SKU & Import Masters"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Tally sync & rules"
        homeHref="/inventory"
        homeLabel="Back to Stock Summary"
      />
    );
  }

  const editingItem = sp.edit ? inv.items.find((i) => i.id === sp.edit) ?? null : null;
  const editingPrimaryBalance = editingItem
    ? inv.balances.find((b) => b.itemId === editingItem.id) ?? null
    : null;

  return (
    <InventoryShell
      activeSection="manage"
      canManageTally={canManageTally}
      selectedCompanyId={selectedCompanyId}
      inv={inv}
      localPortProbe={localPortProbe}
      notice={sp.notice}
      error={sp.error}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title={
            editingItem ? `Edit Stock Item - ${editingItem.name}` : "Add or Update a Stock Item (SKU)"
          }
          subtitle="Sets opening balance, godown/batch location, HSN/GST rate, selling price, and reorder level"
          action={
            editingItem ? (
              <ActionLink href="/inventory/manage" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                Clear Edit
              </ActionLink>
            ) : undefined
          }
        >
          <form action={upsertStockItemAction} className="space-y-3 text-xs">
            {editingItem && <input type="hidden" name="itemId" value={editingItem.id} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Stock Item Name *
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editingItem?.name ?? ""}
                  placeholder="e.g. Havells 4 Sqmm Copper Wire (90m)"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Tally Company
                </label>
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  SKU / Part No.
                </label>
                <input
                  name="skuCode"
                  defaultValue={editingItem?.skuCode ?? editingItem?.partNumber ?? ""}
                  placeholder="HVL-4MM-90"
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Stock Group
                </label>
                <input
                  name="stockGroup"
                  defaultValue={editingItem?.stockGroup ?? "Primary"}
                  placeholder="Cables & Wires"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Unit (UOM)
                </label>
                <input
                  name="uom"
                  defaultValue={editingItem?.uom ?? "PCS"}
                  placeholder="PCS / BOX / KG"
                  className="rsl-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  HSN / SAC
                </label>
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Selling Rate (₹)
                </label>
                <input
                  name="sellingPriceRupees"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editingItem ? (editingItem.sellingPricePaise / 100).toFixed(2) : "0"}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Cost / Std Rate (₹)
                </label>
                <input
                  name="costPriceRupees"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editingItem ? (editingItem.costPricePaise / 100).toFixed(2) : "0"}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  GST Rate (%)
                </label>
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Opening Qty
                </label>
                <input
                  name="openingQty"
                  type="number"
                  step="0.001"
                  defaultValue={editingItem?.openingQty ?? 0}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Reorder Level
                </label>
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Min Order Qty
                </label>
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Godown / Warehouse
                </label>
                <input
                  name="godownName"
                  defaultValue={editingItem?.primaryGodown ?? "Main Location"}
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Batch / Lot Name
                </label>
                <input
                  name="batchName"
                  defaultValue={editingPrimaryBalance?.batchName ?? "Primary Batch"}
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Batch Expiry (Optional)
                </label>
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
                  <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
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
                  <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                    Import Format
                  </label>
                  <select name="format" defaultValue="tally_xml" className="rsl-input">
                    <option value="tally_xml">
                      Tally Prime Masters XML (StockItem / Godown / Ledger)
                    </option>
                    <option value="csv">Inventory Spreadsheet CSV (.csv)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
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
                <label className="mb-1 block font-semibold text-[var(--ink-secondary)]">
                  Or Paste Tally XML / CSV Rows Directly
                </label>
                <textarea
                  name="rawContent"
                  rows={4}
                  placeholder="ItemName,SKU,StockGroup,UOM,HSN,GST,SellingPrice,CostPrice,OpeningQty,ReorderLevel,Godown"
                  className="rsl-input font-mono text-[11px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton pendingText="Importing Inventory..." className="rsl-btn-primary">
                  Import Stock Items &amp; Masters
                </SubmitButton>
                <ActionLink href="/connections/tally" spinnerSize="xs" className="rsl-btn-secondary text-xs">
                  <Layers className="mr-1.5 inline h-3.5 w-3.5" />
                  Configure Live Tally Connector
                </ActionLink>
              </div>
            </form>
          </SectionCard>
        </div>
      </div>
    </InventoryShell>
  );
}
