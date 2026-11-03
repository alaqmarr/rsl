import { getWorkspaceDatabaseManagementInfo } from "@rsl/backup";
import { getWorkspacePlansByKeys } from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getWorkspaceStorageStatus } from "@rsl/storage";
import { getPublicGoogleOAuthStatus } from "@rsl/tenancy";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import { SubmitButton } from "@/components/ios-feedback";
import { SettingsNav } from "@/components/settings-nav";
import {
  createEncryptedBackupAction,
  disconnectGoogleDriveFromBackupsAction,
  importContactsCsvAction,
  optimizeDatabaseAction,
  requestCustomAdapterAction,
  restoreBackupAction,
  switchStorageModeAction,
  syncBackupToGoogleDriveNowAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default async function DatabaseStorageAndBackupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/backups", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Cloud Storage, Data Exports & Backups"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View backup history or manage backups"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const canRunBackups = canRolePerform(session.roleSlug, "backup:manage", session.workspace.id);
  const canManageStorage = canRolePerform(
    session.roleSlug,
    "backup:destination.manage",
    session.workspace.id
  );
  const canRestoreBackup = canRolePerform(
    session.roleSlug,
    "backup:restore",
    session.workspace.id
  );
  const canImportContacts = canRolePerform(session.roleSlug, "inbox:reply", session.workspace.id);

  const dbInfo = getWorkspaceDatabaseManagementInfo(session.workspace.id);
  const storage = getWorkspaceStorageStatus(session.workspace.id);
  const googleOAuth = getPublicGoogleOAuthStatus();
  const workspaceConnections = listWorkspaceConnections(session.workspace.id);
  const activeDriveConn = workspaceConnections.connections.find(
    (c) => c.channelKind === "google_drive"
  );
  const addonPlans = getWorkspacePlansByKeys(session.workspace.id, [
    "backup.export",
    "storage.managed",
    "backup.custom",
  ]);
  const backupPlan = addonPlans.find((p) => p.key === "backup.export");
  const managedStoragePlan = addonPlans.find((p) => p.key === "storage.managed");
  const customAdapterPlan = addonPlans.find((p) => p.key === "backup.custom");

  const hasBackupEntitlement = Boolean(backupPlan?.isUnlocked);
  const hasManagedStorageEntitlement = Boolean(managedStoragePlan?.isUnlocked);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Cloud Storage, Data Exports & Backups"
        subtitle="Manage where your business files are stored, export spreadsheets anytime, and download or restore full workspace backups."
        actions={
          canRunBackups || canManageStorage ? (
            <div className="flex flex-wrap items-center gap-2">
              {canManageStorage && !activeDriveConn && (
                <ConnectToGoogleDriveButton
                  returnTo="/backups"
                  label="Connect to Google Drive"
                  size="sm"
                />
              )}
              {activeDriveConn && (
                <a
                  href={activeDriveConn.metadata.folderWebViewLink || "https://drive.google.com/drive/my-drive"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100"
                >
                  <GoogleGLogo className="h-3.5 w-3.5" />
                  <span>Google Drive Connected ✓</span>
                </a>
              )}
              {canRunBackups && (
                <>
                  <a href="/api/export/portable-json" className="rsl-btn-secondary">
                    Export Portable JSON
                  </a>
                  <a href="/api/export/contacts-csv" className="rsl-btn-secondary">
                    Export Contacts CSV
                  </a>
                  <a href="/api/export/tally-xml" className="rsl-btn-secondary">
                    Export Tally Prime XML
                  </a>
                </>
              )}
            </div>
          ) : undefined
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active File Storage"
          value={
            storage.config.mode === "rsl_managed"
              ? "Managed Storage"
              : storage.config.mode === "client_r2"
                ? "Your Cloudflare R2"
                : "Your S3 Bucket"
          }
          sublabel={`${storage.config.objectCount} files (${formatBytes(storage.config.usedBytes)})`}
          accent="emerald"
        />
        <MetricCard
          label="Workspace Records Status"
          value={dbInfo.integrityStatus === "ok" ? "Healthy" : "Check Needed"}
          sublabel="Private dedicated business workspace"
          accent={dbInfo.integrityStatus === "ok" ? "emerald" : "amber"}
        />
        <MetricCard
          label="Workspace Data Size"
          value={formatBytes(dbInfo.files.totalBytes)}
          sublabel={`Records ${formatBytes(dbInfo.files.dataSizeBytes)}`}
        />
        <MetricCard
          label="Saved Backups"
          value={String(dbInfo.backupRuns.length)}
          sublabel={
            dbInfo.lastBackupAt
              ? `Last backup ${new Date(dbInfo.lastBackupAt).toLocaleDateString("en-IN")}`
              : "No backup created yet"
          }
        />
      </div>

      {/* 1. Primary Google Drive Backups Hero Card — Right Above the Fold */}
      <SectionCard
        title="Google Drive Automatic Off-Site Backups"
        subtitle="Connect your personal Gmail or Google Workspace Drive in 1 click — creates your backup folder automatically and syncs every encrypted .rslbackup snapshot."
        action={
          <StatusPill
            label={
              activeDriveConn
                ? activeDriveConn.status === "healthy"
                  ? "Connected to Google Drive"
                  : "Needs Reconnect"
                : "Not Connected Yet"
            }
            tone={
              activeDriveConn
                ? activeDriveConn.status === "healthy"
                  ? "emerald"
                  : "amber"
                : "sky"
            }
          />
        }
      >
        {activeDriveConn ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200/90 bg-emerald-50/70 p-4 text-[13px]">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-2xs ring-1 ring-emerald-200">
                  <GoogleGLogo className="h-3.5 w-3.5" />
                </span>
                <span className="font-bold text-slate-900">
                  {activeDriveConn.metadata.driveEmail || activeDriveConn.displayName}
                </span>
                <span className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-900">
                  Folder: {activeDriveConn.metadata.folderName || googleOAuth.defaultDriveFolderName}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-700">
                Connected via Google&apos;s official Consent Screen (<code className="font-mono">drive.file</code> scope — RapidShift Labs cannot see or read any other files in your Drive). Every backup you create is uploaded automatically to{" "}
                <strong>{activeDriveConn.metadata.folderName || googleOAuth.defaultDriveFolderName}</strong>.
              </p>
              <a
                href={activeDriveConn.metadata.folderWebViewLink || "https://drive.google.com/drive/my-drive"}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-emerald-800 hover:underline"
              >
                Open Backup Folder in Google Drive ↗
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasBackupEntitlement && canRunBackups && (
                <form action={syncBackupToGoogleDriveNowAction}>
                  <SubmitButton
                    className="rsl-btn-primary py-2 text-xs"
                    pendingText="Creating & Uploading to Drive..."
                  >
                    Backup &amp; Upload to Google Drive Now
                  </SubmitButton>
                </form>
              )}
              {canManageStorage && (
                <>
                  <ConnectToGoogleDriveButton
                    returnTo="/backups"
                    label="Switch Google Account"
                    variant="white"
                    size="sm"
                  />
                  <form action={disconnectGoogleDriveFromBackupsAction}>
                    <input type="hidden" name="connectionId" value={activeDriveConn.id} />
                    <SubmitButton
                      className="rsl-btn-danger-soft py-1.5 text-xs"
                      pendingText="Disconnecting..."
                    >
                      Disconnect
                    </SubmitButton>
                  </form>
                </>
              )}
            </div>
          </div>
        ) : !canManageStorage ? (
          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5 text-xs text-zinc-600">
            Read-only view — ask the Business Owner or an Admin to click &ldquo;Connect to Google Drive&rdquo; for automatic off-site backups.
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/65 p-5 text-[13px]">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div className="max-w-2xl space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                    <GoogleGLogo className="h-3.5 w-3.5" />
                    <span>1-Click Official Google Sign-In</span>
                  </span>
                  <span className="text-[11px] font-medium text-emerald-900/80">
                    Zero JSON files • Zero manual Folder IDs
                  </span>
                </div>
                <div className="text-sm font-bold text-slate-900">
                  Connect Your Google Drive for Automatic Off-Site Backups
                </div>
                <p className="text-xs leading-relaxed text-slate-700">
                  Click <strong>Connect to Google Drive</strong> to sign in on Google&apos;s official{" "}
                  <strong>{googleOAuth.consentAppName || "RapidShift Labs"}</strong> screen. RapidShift Labs automatically creates a{" "}
                  <strong>{googleOAuth.defaultDriveFolderName || "RapidShift Labs Backups"}</strong> folder in your Drive using Google&apos;s strict{" "}
                  <code className="font-mono">drive.file</code> privacy scope (never sees any other files in your Drive) and uploads every{" "}
                  <code className="font-mono">.rslbackup</code> snapshot automatically.
                </p>
                {!googleOAuth.enableDriveOAuth && (
                  <p className="text-[11px] font-medium text-amber-900">
                    Note: Platform Google OAuth credentials have not been saved yet under Staff Portal → OAuth &amp; API Credentials. Save them once in the Admin Portal to activate live Google Sign-In.
                  </p>
                )}
              </div>

              <div className="shrink-0">
                <ConnectToGoogleDriveButton
                  returnTo="/backups"
                  label="Connect to Google Drive"
                />
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Cloud Storage & Provider Switching */}
      <SectionCard
        title="Cloud File Storage & Provider Switching"
        subtitle={
          hasManagedStorageEntitlement
            ? "Switch seamlessly between RSL Managed Cloud Storage (unlocked on your account) and your own Cloudflare R2 / S3 bucket. Existing files copy across automatically."
            : "Connect your own Cloudflare R2 / S3 bucket, or activate RSL Managed Cloud Storage. Existing files copy across automatically when you switch."
        }
        action={
          <StatusPill
            label={storage.config.displayLabel}
            tone={storage.config.mode === "rsl_managed" ? "emerald" : "sky"}
          />
        }
      >
        <div className="space-y-4">
          {!hasManagedStorageEntitlement && managedStoragePlan && (
            <InlineAddonPlanBanner plan={managedStoragePlan} returnPath="/backups" />
          )}

          {!canManageStorage ? (
            <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3.5 text-xs text-zinc-600">
              Read-only storage view — ask the Business Owner or an Admin to switch cloud storage providers or update bucket credentials.
            </div>
          ) : (
          <form action={switchStorageModeAction} className="space-y-4 text-[13px]">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div>
                <label className="rsl-label">Storage Destination</label>
                <select
                  name="targetMode"
                  defaultValue={hasManagedStorageEntitlement ? storage.config.mode : "client_r2"}
                  className="rsl-input"
                >
                  <option value="client_r2">Bring Your Own Cloudflare R2 Bucket</option>
                  <option value="client_s3">Bring Your Own S3-Compatible Bucket</option>
                  <option value="rsl_managed" disabled={!hasManagedStorageEntitlement}>
                    RSL Managed Cloud Storage{" "}
                    {hasManagedStorageEntitlement ? "(Unlocked)" : "(Requires Plan Activation)"}
                  </option>
                </select>
              </div>
              <div>
                <label className="rsl-label">Cloudflare Account ID (for R2)</label>
                <input
                  name="r2AccountId"
                  placeholder="e.g. 8f92a1b4c..."
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="rsl-label">Bucket Name (for Personal R2 / S3)</label>
                <input
                  name="bucketName"
                  defaultValue={storage.config.bucketName || ""}
                  placeholder="my-business-files"
                  className="rsl-input font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div>
                <label className="rsl-label">Custom Endpoint URL (Optional)</label>
                <input
                  name="customEndpointUrl"
                  defaultValue={storage.config.endpointUrl || ""}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="rsl-label">Access Key ID</label>
                <input
                  name="accessKeyId"
                  placeholder="Cloud Storage Access Key ID"
                  className="rsl-input font-mono"
                />
              </div>
              <div>
                <label className="rsl-label">Secret Access Key</label>
                <input
                  name="secretAccessKey"
                  type="password"
                  placeholder="Stored privately for your workspace"
                  className="rsl-input"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-[12.5px] font-medium text-slate-700">
                <input
                  type="checkbox"
                  name="migrateExistingFiles"
                  defaultChecked
                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Copy and verify all existing stored files to the new storage destination</span>
              </label>
              <SubmitButton className="rsl-btn-primary" pendingText="Applying Storage Settings...">
                Save Storage Settings
              </SubmitButton>
            </div>
          </form>
          )}
        </div>

        {storage.migrations.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-4 text-[13px]">
            <div className="text-xs font-semibold text-slate-900">Recent File Storage Transfers</div>
            <ul className="mt-2 space-y-1.5 text-zinc-600">
              {storage.migrations.map((m) => (
                <li key={m.id} className="flex items-center justify-between">
                  <span>
                    {m.fromMode} → <strong className="text-slate-900">{m.toMode}</strong> (
                    {m.copiedObjects}/{m.totalObjects} files, {formatBytes(m.bytesTransferred)})
                  </span>
                  <StatusPill
                    label={m.status}
                    tone={m.status === "completed" ? "emerald" : "ruby"}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      {/* Protected Backups & Safe Restore */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Download Full Workspace Backup (.rslbackup)"
          subtitle="Creates a complete, password-protected snapshot of your contacts, conversations, bills, and campaigns"
        >
          {!hasBackupEntitlement && backupPlan ? (
            <InlineAddonPlanBanner plan={backupPlan} returnPath="/backups" />
          ) : !canRunBackups ? (
            <p className="text-[13px] text-zinc-500">
              Read-only backup view — ask an Admin or the Business Owner to create or download encrypted backup bundles.
            </p>
          ) : (
            <div className="space-y-3 text-[13px]">
              <form action={createEncryptedBackupAction} className="space-y-3">
                <label className="rsl-label">Backup Label / Destination</label>
                <div className="flex flex-wrap gap-2.5">
                  <input
                    name="destinationLabel"
                    defaultValue={
                      activeDriveConn
                        ? `Google Drive (${activeDriveConn.metadata.driveEmail || "Connected"})`
                        : storage.config.displayLabel
                    }
                    className="rsl-input min-w-[200px] flex-1"
                  />
                  <SubmitButton className="rsl-btn-primary" pendingText="Creating Backup...">
                    Create Backup Now
                  </SubmitButton>
                </div>
              </form>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200/90 bg-zinc-50/75 px-3.5 py-2.5 text-xs">
                {activeDriveConn ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
                    <GoogleGLogo className="h-3.5 w-3.5" />
                    <span>
                      Auto-syncing every backup to{" "}
                      <strong>{activeDriveConn.metadata.driveEmail || "Google Drive"}</strong>
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="text-zinc-600">
                      Want automatic off-site copies in your own Google Drive?
                    </span>
                    {canManageStorage && (
                      <ConnectToGoogleDriveButton
                        returnTo="/backups"
                        label="Connect to Google Drive"
                        variant="white"
                        size="sm"
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {dbInfo.backupRuns.length > 0 && (
            <ul className="mt-4 divide-y divide-zinc-100 text-[13px]">
              {dbInfo.backupRuns.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-semibold text-slate-900 tabular-nums">
                      Backup from {new Date(b.createdAt).toLocaleString("en-IN")}
                    </div>
                    <div className="text-xs text-zinc-500 tabular-nums">
                      {b.kind.toUpperCase()} • {formatBytes(b.sizeBytes)}
                    </div>
                  </div>
                  {b.kind === "backup" && hasBackupEntitlement && canRunBackups && (
                    <a
                      href={`/api/export/backup-bundle?backupId=${encodeURIComponent(b.id)}`}
                      className="rsl-btn-secondary"
                    >
                      Download .rslbackup
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Safe Workspace Restore"
          subtitle="Saves an automatic safety snapshot before restoring, and always preserves your Wallet passbook, GST invoices, and unsubscribed contacts"
        >
          {!hasBackupEntitlement && backupPlan ? (
            <InlineAddonPlanBanner plan={backupPlan} returnPath="/backups" />
          ) : !canRestoreBackup ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-950">
              Restricted to Business Owner — restoring a workspace snapshot replaces live operational records and can only be initiated by the Business Owner.
            </div>
          ) : (
            <form action={restoreBackupAction} className="space-y-3.5 text-[13px]">
              <div>
                <label className="rsl-label">Upload .rslbackup File</label>
                <input
                  name="backupFile"
                  type="file"
                  accept=".rslbackup,.json"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="rsl-label">Or Paste Backup Bundle Text</label>
                <textarea
                  name="bundleJsonText"
                  rows={3}
                  placeholder="Paste backup contents here if restoring without file upload"
                  className="rsl-input font-mono text-xs"
                />
              </div>
              <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 p-3.5">
                <label className="rsl-label text-rose-900">
                  Confirmation Phrase (Type RESTORE) *
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    name="confirmPhrase"
                    required
                    placeholder="RESTORE"
                    className="rsl-input max-w-[200px] font-mono"
                  />
                  <SubmitButton
                    className="rsl-btn-danger"
                    pendingText="Verifying & Restoring..."
                  >
                    Restore Backup
                  </SubmitButton>
                </div>
              </div>
            </form>
          )}
        </SectionCard>
      </div>

      {/* Business Record Counts + Contacts CSV Import + Custom Storage Request */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Stored Business Records Summary"
          subtitle="Live record counts across your workspace"
          action={
            canRunBackups ? (
              <form action={optimizeDatabaseAction}>
                <SubmitButton
                  className="rsl-btn-secondary"
                  spinnerSize="xs"
                  pendingText="Optimizing..."
                >
                  Optimize Workspace Speed
                </SubmitButton>
              </form>
            ) : undefined
          }
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Record Category</th>
                  <th className="px-4 py-3 font-semibold">Total Count</th>
                  <th className="px-5 py-3 font-semibold sm:px-6">Backup Policy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {dbInfo.tableCounts.map((t) => (
                  <tr key={t.table}>
                    <td className="px-5 py-3 font-medium text-slate-900 sm:px-6">{t.label}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 tabular-nums">
                      {t.rows.toLocaleString("en-IN")}
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <StatusPill
                        label={t.restorable ? "Included in Restore" : "Permanent Record"}
                        tone={t.restorable ? "emerald" : "amber"}
                        showDot={false}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard
            title="Bulk Import Customer Contacts (CSV)"
            subtitle="Columns supported: Name, Phone, Email, Company"
          >
            {!canImportContacts ? (
              <p className="text-[13px] text-zinc-500">
                Read-only role — ask a team member with Customer Messages access to import contact CSVs.
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
                <label className="inline-flex items-center gap-2 text-[12.5px] text-zinc-600">
                  <input
                    type="checkbox"
                    name="recordWhatsAppConsent"
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
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
            subtitle="Need Azure Blob, Backblaze B2, or an on-premise storage server?"
          >
            {customAdapterPlan && !customAdapterPlan.isUnlocked ? (
              <InlineAddonPlanBanner plan={customAdapterPlan} returnPath="/backups" />
            ) : !canManageStorage ? (
              <p className="text-[13px] text-zinc-500">
                Ask the Business Owner or an Admin to submit custom enterprise storage connector details.
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
                  Submit Details
                </SubmitButton>
              </form>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
