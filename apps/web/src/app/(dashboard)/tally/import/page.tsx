import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import { importTallyFileAction, recordTallyVoucherAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";
import { loadTallyPageContext } from "@/lib/tally-data";

export default async function TallyImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Import XML / CSV & Manual Bill Entry"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage Tally vouchers & imports"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return (
      <FeaturePlanGate
        pageTitle="Import Tally XML / CSV & Record Bills"
        pageSubtitle="Upload exported Tally Day Books or Sales Registers and enter bills/receipts directly with stock deduction."
        plans={plans}
        returnPath="/tally/import"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const ctx = await loadTallyPageContext({
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    workspaceSlug: session.workspace.slug,
    userId: session.user.id,
    roleSlug: session.roleSlug,
    defaultTallyCompany: session.workspace.defaultTallyCompany,
    companyParam: sp.company,
  });

  const {
    tally,
    selectedCompanyId,
    companyScopedVouchers,
    activeRulesCount,
    canManageTally,
    todayIso,
  } = ctx;

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="import"
        vouchersCount={companyScopedVouchers.length}
        rulesCount={activeRulesCount}
        partiesCount={tally.totals.partiesCount}
        stockItemsCount={tally.totals.stockItemsCount}
        companies={tally.companies}
        selectedCompanyId={selectedCompanyId}
      />

      <PageHeader
        eyebrow="Meta -> WhatsApp -> Tally Integration"
        title="XML / CSV Import & Manual Voucher Entry"
        subtitle="Upload exported Tally Day Books or enter Sales, Receipt, and Purchase vouchers directly"
        actions={
          <ActionLink href="/tally" className="rsl-btn-secondary">
            View Bills Register →
          </ActionLink>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {!canManageTally ? (
        <SectionCard title="Read-Only Permission">
          <p className="text-[13px] text-[var(--ink-secondary)]">
            Owner, Admin, or Manager permission is required to upload Tally XML/CSV files or
            record manual bills and receipts.
          </p>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionCard
            title="Import Tally Prime XML or CSV"
            subtitle="Export your Day Book or Sales Register from Tally Prime - duplicate bills merge automatically"
          >
            <form action={importTallyFileAction} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="rsl-label">Tally Company Name</label>
                  <input
                    name="companyName"
                    defaultValue={
                      session.workspace.defaultTallyCompany ||
                      tally.companies[0]?.name ||
                      session.workspace.name
                    }
                    required
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="rsl-label">File Format</label>
                  <select name="format" defaultValue="tally_xml" className="rsl-input">
                    <option value="tally_xml">Tally Prime XML Export (.xml)</option>
                    <option value="csv">Spreadsheet CSV (.csv)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="rsl-label">Select File (.xml / .csv)</label>
                <input name="uploadFile" type="file" accept=".xml,.csv,.txt" className="rsl-input" />
              </div>

              <div>
                <label className="rsl-label">Or Paste XML / CSV Rows Directly</label>
                <textarea
                  name="rawContent"
                  rows={4}
                  placeholder="Paste exported Tally XML or CSV rows here..."
                  className="rsl-input font-mono text-[11px]"
                />
              </div>

              <SubmitButton pendingText="Importing..." className="rsl-btn-primary">
                Import Bills &amp; Receipts
              </SubmitButton>
            </form>
          </SectionCard>

          <SectionCard
            title="Record Manual Bill or Receipt"
            subtitle="Auto-suggests next Bill #, prevents overwrites, and updates godown stock if an item is entered"
          >
            <form action={recordTallyVoucherAction} className="space-y-3.5 text-xs">
              <input type="hidden" name="preventOverwrite" value="true" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="rsl-label">Voucher Type</label>
                  <select name="voucherType" defaultValue="Sales" className="rsl-input">
                    <option value="Sales">Sales Bill (Deducts Stock)</option>
                    <option value="Receipt">Customer Receipt (Settles Sales Bill)</option>
                    <option value="Purchase">Purchase Bill (Adds Stock)</option>
                    <option value="Payment">Supplier Payment (Settles Purchase Bill)</option>
                    <option value="CreditNote">Credit Note</option>
                    <option value="DebitNote">Debit Note</option>
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Bill / Receipt #</label>
                  <input
                    name="voucherNumber"
                    required
                    defaultValue={tally.nextSuggestedBillNumber}
                    placeholder="GST/26-27/001"
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="rsl-label">Company Name</label>
                  <input
                    name="companyName"
                    defaultValue={
                      session.workspace.defaultTallyCompany ||
                      tally.companies[0]?.name ||
                      session.workspace.name
                    }
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="rsl-label">Customer / Party Name *</label>
                  <input name="partyName" required className="rsl-input" />
                </div>
                <div>
                  <label className="rsl-label">Customer WhatsApp (+91...)</label>
                  <input name="partyPhoneE164" placeholder="+9198200..." className="rsl-input" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="rsl-label">Total Amount (₹) *</label>
                  <input
                    name="amountRupees"
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Already Paid (₹)</label>
                  <input
                    name="paidAmountRupees"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue="0"
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Bill Date *</label>
                  <input
                    name="voucherDateIso"
                    type="date"
                    defaultValue={todayIso}
                    required
                    className="rsl-input"
                  />
                </div>
                <div>
                  <label className="rsl-label">Due Date</label>
                  <input name="dueDateIso" type="date" className="rsl-input" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="rsl-label">Settle Against Bill # (Optional)</label>
                  <input
                    name="againstBillNumber"
                    placeholder="e.g. GST/26-27/001 (blank = FIFO)"
                    className="rsl-input font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="rsl-label">Narration / UTR Ref</label>
                  <input
                    name="narration"
                    placeholder="e.g. NEFT UTR 4012908..."
                    className="rsl-input text-xs"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--ink)]">
                    Optional Stock Item Line (Updates Live Inventory)
                  </span>
                  <ActionLink
                    href="/inventory"
                    spinnerSize="xs"
                    className="text-[11px] font-semibold text-[var(--brand)] underline"
                  >
                    Inventory Register →
                  </ActionLink>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-5">
                  <div className="sm:col-span-2">
                    <input
                      name="lineItemName"
                      placeholder="Stock Item Name"
                      className="rsl-input text-xs"
                    />
                  </div>
                  <div>
                    <input
                      name="lineItemQty"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="Qty"
                      className="rsl-input text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <input
                      name="lineItemUom"
                      defaultValue="PCS"
                      placeholder="UOM"
                      className="rsl-input font-mono text-xs uppercase"
                    />
                  </div>
                  <div>
                    <input
                      name="lineItemRate"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Rate (₹)"
                      className="rsl-input text-xs tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <SubmitButton pendingText="Saving Bill..." className="rsl-btn-primary">
                Save New Bill / Receipt
              </SubmitButton>
            </form>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
