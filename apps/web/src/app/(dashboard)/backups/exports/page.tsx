import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, ConfirmSubmitButton, PageHeader, SectionCard } from "@rsl/ui";
import { InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { BackupsSuiteNav } from "@/components/suite-subnav";
import {
  deleteWorkspaceStoredObjectAction,
  importContactsCsvAction,
  requestCustomAdapterAction,
} from "@/lib/actions";
import { formatStorageBytes, loadBackupsWorkspaceContext } from "@/lib/backups-data";
import { requireWebSession } from "@/lib/session";

export default async function BackupsExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/backups/exports", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Data Exports, Imports & Stored Files"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage exports & stored files"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = loadBackupsWorkspaceContext(session.workspace.id, session.roleSlug);
  const {
    canRunBackups,
    canManageStorage,
    canImportContacts,
    storage,
    customAdapterPlan,
  } = ctx;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Data Exports, CSV Imports & File Vault"
        subtitle="Download portable JSON/CSV/XML archives, bulk import contacts, and reclaim storage quota"
        actions={
          <ActionLink href="/backups" className="rsl-btn-secondary">
            ← Backups &amp; Restore
          </ActionLink>
        }
      />

      <BackupsSuiteNav active="exports" />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <SectionCard
        title="1-Click Portable Business Exports"
        subtitle="Standard open formats you can open in Excel, Google Sheets, or Tally Prime"
      >
        {!canRunBackups ? (
          <p className="text-[13px] text-[var(--ink-muted)]">
            Admin or Business Owner permission is required to export full workspace archives.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <a href="/api/export/portable-json" className="rsl-btn-primary">
              Export Portable JSON Bundle
            </a>
            <a href="/api/export/contacts-csv" className="rsl-btn-secondary">
              Export Contacts CSV
            </a>
            <a href="/api/export/tally-xml" className="rsl-btn-secondary">
              Export Tally Prime XML
            </a>
            <a href="/api/export/tally-csv" className="rsl-btn-secondary">
              Export Tally Bills CSV
            </a>
            <a href="/api/export/party-ledgers-csv" className="rsl-btn-secondary">
              Export Party Ledgers CSV
            </a>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Bulk Import Customer Contacts (CSV)"
          subtitle="Columns supported: Name, Phone, Email, Company"
        >
          {!canImportContacts ? (
            <p className="text-[13px] text-[var(--ink-muted)]">
              Customer Messages reply access is required to import contacts.
            </p>
          ) : (
            <form action={importContactsCsvAction} className="space-y-3.5 text-[13px]">
              <div>
                <label className="rsl-label">Upload CSV File</label>
                <input name="csvFile" type="file" accept=".csv,.txt" className="rsl-input" />
              </div>
              <div>
                <label className="rsl-label">Or Paste CSV Rows</label>
                <textarea
                  name="csvContent"
                  rows={3}
                  placeholder={
                    "Name,Phone,Email,Company\nShree Hardware,+919820012345,info@shree.in,Shree Hardware"
                  }
                  className="rsl-input font-mono text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-secondary)]">
                  <input
                    type="checkbox"
                    name="recordWhatsAppConsent"
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  <span>Contacts opted in to WhatsApp updates</span>
                </label>
                <SubmitButton className="rsl-btn-primary" pendingText="Importing Contacts...">
                  Import Contacts CSV
                </SubmitButton>
              </div>
            </form>
          )}
        </SectionCard>

        <SectionCard
          title="Custom Enterprise Storage Connector"
          subtitle="Request Azure Blob, Backblaze B2, or on-premise S3 storage mounting"
        >
          {customAdapterPlan && !customAdapterPlan.isUnlocked ? (
            <InlineAddonPlanBanner plan={customAdapterPlan} returnPath="/backups/exports" />
          ) : !canManageStorage ? (
            <p className="text-[13px] text-[var(--ink-muted)]">
              Business Owner or Admin permission is required to submit enterprise connector requests.
            </p>
          ) : (
            <form
              action={requestCustomAdapterAction}
              className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <div>
                <label className="rsl-label">Storage Provider *</label>
                <input
                  name="providerName"
                  required
                  placeholder="e.g. Azure Blob Storage"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Contact Email *</label>
                <input
                  name="contactEmail"
                  type="email"
                  defaultValue={session.user.email}
                  required
                  className="rsl-input"
                />
              </div>
              <SubmitButton className="rsl-btn-secondary" pendingText="Submitting...">
                Submit Request
              </SubmitButton>
            </form>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={`Stored Workspace Files (${storage.objects.length})`}
        subtitle={`Using ${formatStorageBytes(storage.config.usedBytes)} across ${storage.config.objectCount} stored files`}
        noPadding
      >
        {storage.objects.length === 0 ? (
          <div className="p-6 text-xs text-[var(--ink-muted)]">
            No individual cloud objects stored yet. Tally PDFs, GST tax invoices, and backup bundles
            appear here with 1-click quota cleanup.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-xs tracking-wider text-[var(--ink-muted)] uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">File Name</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Stored On (IST)</th>
                  <th className="px-5 py-3 text-right font-semibold sm:px-6">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                {storage.objects.map((obj) => (
                  <tr key={obj.id} className="hover:bg-[var(--surface-inset)]/60">
                    <td className="px-5 py-3 font-mono font-medium text-[var(--ink)] sm:px-6">
                      {obj.fileName}
                    </td>
                    <td className="px-4 py-3 text-[var(--ink-secondary)]">{obj.category}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--ink)] tabular-nums">
                      {formatStorageBytes(obj.sizeBytes)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ink-muted)] whitespace-nowrap tabular-nums">
                      {new Date(obj.createdAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      {canManageStorage ? (
                        <form action={deleteWorkspaceStoredObjectAction} className="inline-flex">
                          <input type="hidden" name="objectId" value={obj.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Delete stored file "${obj.fileName}" (${formatStorageBytes(obj.sizeBytes)}) and reclaim quota?`}
                            className="rsl-btn-danger-soft px-2.5 py-1 text-xs"
                          >
                            Delete File
                          </ConfirmSubmitButton>
                        </form>
                      ) : (
                        <span className="text-[var(--ink-muted)]">Read-only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
