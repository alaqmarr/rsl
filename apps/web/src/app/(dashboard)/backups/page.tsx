import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  ConfirmSubmitButton,
  GuideDrawerButton,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { CloudflareOneClickConnectCard } from "@/components/cloudflare-one-click-card";
import { InlineAddonPlanBanner } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { BackupsSuiteNav } from "@/components/suite-subnav";
import {
  createEncryptedBackupAction,
  disconnectGoogleDriveFromBackupsAction,
  optimizeDatabaseAction,
  restoreBackupAction,
  switchStorageModeAction,
  syncBackupToGoogleDriveNowAction,
} from "@/lib/actions";
import { formatStorageBytes, loadBackupsWorkspaceContext } from "@/lib/backups-data";
import { requireWebSession } from "@/lib/session";

export default async function BackupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/backups", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Encrypted Backups & Restore"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="Manage backups & storage"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = loadBackupsWorkspaceContext(session.workspace.id, session.roleSlug);
  const {
    canRunBackups,
    canManageStorage,
    canRestoreBackup,
    dbInfo,
    storage,
    googleOAuth,
    cloudflareStatus,
    activeDriveConn,
    backupPlan,
    managedStoragePlan,
    hasBackupEntitlement,
    hasManagedStorageEntitlement,
  } = ctx;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Encrypted Backups & Cloud Sync"
        subtitle="Protect your workspace with AES-256-GCM .rslbackup snapshots synced to Google Drive or Cloudflare R2"
        actions={
          <ActionLink href="/backups/exports" className="rsl-btn-secondary">
            Data Exports, Imports &amp; Files →
          </ActionLink>
        }
      />

      <BackupsSuiteNav active="backups" />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Active File Storage"
          value={
            storage.config.mode === "rsl_managed"
              ? "Managed Storage"
              : storage.config.mode === "client_r2"
                ? "Your Cloudflare R2"
                : "Your S3 Bucket"
          }
          sublabel={`${storage.config.objectCount} files (${formatStorageBytes(storage.config.usedBytes)})`}
          accent="emerald"
        />
        <MetricCard
          label="Records Integrity"
          value={dbInfo.integrityStatus === "ok" ? "Healthy" : "Check Needed"}
          sublabel="Private tenant database"
          accent={dbInfo.integrityStatus === "ok" ? "emerald" : "amber"}
        />
        <MetricCard
          label="Workspace Data Size"
          value={formatStorageBytes(dbInfo.files.totalBytes)}
          sublabel={`Records ${formatStorageBytes(dbInfo.files.dataSizeBytes)}`}
        />
        <MetricCard
          label="Saved Backups"
          value={String(dbInfo.backupRuns.length)}
          sublabel={
            dbInfo.lastBackupAt
              ? `Last backup ${new Date(dbInfo.lastBackupAt).toLocaleDateString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}`
              : "No backup created yet"
          }
        />
      </div>

      <CloudflareOneClickConnectCard
        initialStatus={cloudflareStatus}
        canManage={canManageStorage}
      />

      <SectionCard
        title="Google Drive Automatic Off-Site Backups"
        subtitle="Connect Google Drive in 1 click to upload encrypted .rslbackup snapshots into an isolated folder"
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
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand-surface)] p-4 text-[13px]">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)]">
                  <GoogleGLogo className="h-3.5 w-3.5" />
                </span>
                <span className="font-bold text-[var(--ink)]">
                  {activeDriveConn.metadata.driveEmail || activeDriveConn.displayName}
                </span>
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ink-secondary)]">
                  Folder: {activeDriveConn.metadata.folderName || googleOAuth.defaultDriveFolderName}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">
                Connected using <code className="font-mono">drive.file</code> privacy scope.
                Backups sync automatically to{" "}
                <strong>{activeDriveConn.metadata.folderName || googleOAuth.defaultDriveFolderName}</strong>.
              </p>
              <a
                href={
                  activeDriveConn.metadata.folderWebViewLink ||
                  "https://drive.google.com/drive/my-drive"
                }
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-[var(--brand)] hover:underline"
              >
                Open Backup Folder in Google Drive ↗
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasBackupEntitlement && canRunBackups && (
                <form action={syncBackupToGoogleDriveNowAction}>
                  <SubmitButton
                    className="rsl-btn-primary py-2 text-xs"
                    pendingText="Uploading to Drive..."
                  >
                    Backup &amp; Upload Now
                  </SubmitButton>
                </form>
              )}
              {canManageStorage && (
                <>
                  <ConnectToGoogleDriveButton
                    returnTo="/backups"
                    label="Switch Account"
                    variant="white"
                    size="sm"
                  />
                  <form action={disconnectGoogleDriveFromBackupsAction}>
                    <input type="hidden" name="connectionId" value={activeDriveConn.id} />
                    <ConfirmSubmitButton
                      confirmMessage="Disconnect Google Drive automatic off-site backups?"
                      className="rsl-btn-danger-soft py-1.5 text-xs"
                    >
                      Disconnect
                    </ConfirmSubmitButton>
                  </form>
                </>
              )}
            </div>
          </div>
        ) : !canManageStorage ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5 text-xs text-[var(--ink-secondary)]">
            Read-only view - ask an Admin or Business Owner to connect Google Drive.
          </div>
        ) : (
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-inset)] p-5 text-[13px] lg:flex-row lg:items-center">
            <div className="space-y-1">
              <div className="font-bold text-[var(--ink)]">
                Connect Google Drive for Automatic Encrypted Snapshots
              </div>
              <p className="text-xs text-[var(--ink-muted)]">
                Creates an isolated backup folder without accessing other files in your Drive.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <GuideDrawerButton
                label="Backup Guide"
                badgeText="3 steps"
                guide={{
                  eyebrow: "Encrypted Off-Site Backups",
                  title: "Google Drive & S3/R2 Backups",
                  summary:
                    "Protect your workspace with AES-256-GCM .rslbackup bundles stored automatically in Drive or Cloudflare R2.",
                  steps: [
                    {
                      title: "Connect Google Drive",
                      detail: "Sign in with Google to authorize an isolated drive.file backup folder.",
                    },
                    {
                      title: "Instant .rslbackup Download",
                      detail: "Download snapshots locally or let nightly jobs sync off-site automatically.",
                    },
                  ],
                  fullGuideHref: "/help?slug=storage-r2-and-backups",
                  fullGuideLabel: "Open Backup Guide",
                }}
              />
              <ConnectToGoogleDriveButton
                returnTo="/backups"
                label="Connect Google Drive"
                configured={googleOAuth.enableDriveOAuth}
              />
            </div>
          </div>
        )}
      </SectionCard>

      <details
        open={storage.config.mode !== "rsl_managed"}
        className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xs"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 select-none">
          <div>
            <div className="text-sm font-semibold text-[var(--ink)]">
              Cloudflare R2 &amp; S3 Storage Destination
            </div>
            <div className="mt-0.5 text-xs text-[var(--ink-muted)]">
              Switch between RSL Managed Cloud Storage and your own Cloudflare R2 or S3 bucket
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill
              label={storage.config.displayLabel}
              tone={storage.config.mode === "rsl_managed" ? "emerald" : "sky"}
            />
            <span className="text-xs font-semibold text-[var(--brand)]">Configure Bucket</span>
          </div>
        </summary>

        <div className="space-y-4 border-t border-[var(--border-subtle)] p-6">
          {!hasManagedStorageEntitlement && managedStoragePlan && (
            <InlineAddonPlanBanner plan={managedStoragePlan} returnPath="/backups" />
          )}

          {!canManageStorage ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Owner or Admin role required to update storage bucket credentials.
            </p>
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
                      RSL Managed Cloud Storage
                    </option>
                  </select>
                </div>
                <div>
                  <label className="rsl-label">Cloudflare Account ID (R2)</label>
                  <input
                    name="r2AccountId"
                    placeholder="e.g. 8f92a1b4c..."
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="rsl-label">Bucket Name</label>
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
                  <label className="rsl-label">Custom Endpoint URL</label>
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
                    placeholder="Access Key ID"
                    className="rsl-input font-mono"
                  />
                </div>
                <div>
                  <label className="rsl-label">Secret Access Key</label>
                  <input
                    name="secretAccessKey"
                    type="password"
                    placeholder="Stored privately"
                    className="rsl-input"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ink-secondary)]">
                  <input
                    type="checkbox"
                    name="migrateExistingFiles"
                    defaultChecked
                    className="h-4 w-4 rounded border-[var(--border)] text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  <span>Migrate existing files to destination</span>
                </label>
                <SubmitButton className="rsl-btn-primary" pendingText="Applying Settings...">
                  Save Storage Settings
                </SubmitButton>
              </div>
            </form>
          )}
        </div>
      </details>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Download Workspace Backup (.rslbackup)"
          subtitle="Encrypted snapshot of contacts, conversations, bills, and campaigns"
        >
          {!hasBackupEntitlement && backupPlan ? (
            <InlineAddonPlanBanner plan={backupPlan} returnPath="/backups" />
          ) : !canRunBackups ? (
            <p className="text-[13px] text-[var(--ink-muted)]">
              Admin or Business Owner permission is required to create or download backups.
            </p>
          ) : (
            <form action={createEncryptedBackupAction} className="space-y-3 text-[13px]">
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
          )}

          {dbInfo.backupRuns.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--border-subtle)] text-[13px]">
              {dbInfo.backupRuns.slice(0, 8).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-semibold text-[var(--ink)] tabular-nums">
                      {new Date(b.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)] tabular-nums">
                      {b.kind.toUpperCase()} • {formatStorageBytes(b.sizeBytes)}
                    </div>
                  </div>
                  {b.kind === "backup" && hasBackupEntitlement && canRunBackups && (
                    <a
                      href={`/api/export/backup-bundle?backupId=${encodeURIComponent(b.id)}`}
                      className="rsl-btn-secondary py-1 text-xs"
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
          subtitle="Saves a pre-restore safety snapshot while preserving Wallet, GST invoices & opt-outs"
        >
          {!hasBackupEntitlement && backupPlan ? (
            <InlineAddonPlanBanner plan={backupPlan} returnPath="/backups" />
          ) : !canRestoreBackup ? (
            <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-surface)] p-3.5 text-xs text-[var(--ink-secondary)]">
              Restricted to Business Owner - workspace restore can only be initiated by the Owner.
            </div>
          ) : (
            <form action={restoreBackupAction} className="space-y-3.5 text-[13px]">
              <div>
                <label className="rsl-label">Upload .rslbackup File</label>
                <input name="backupFile" type="file" accept=".rslbackup,.json" className="rsl-input" />
              </div>
              <div>
                <label className="rsl-label">Or Paste Backup Bundle Text</label>
                <textarea
                  name="bundleJsonText"
                  rows={2}
                  placeholder="Paste bundle text if restoring without file upload"
                  className="rsl-input font-mono text-xs"
                />
              </div>
              <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-surface)] p-3.5">
                <label className="rsl-label text-[var(--danger)]">
                  Confirmation Phrase (Type RESTORE) *
                </label>
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    name="confirmPhrase"
                    required
                    placeholder="RESTORE"
                    className="rsl-input max-w-[180px] font-mono"
                  />
                  <SubmitButton className="rsl-btn-danger" pendingText="Restoring...">
                    Restore Backup
                  </SubmitButton>
                </div>
              </div>
            </form>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Workspace Records & Optimization"
        subtitle="Live table counts and database maintenance"
        action={
          canRunBackups ? (
            <form action={optimizeDatabaseAction}>
              <SubmitButton className="rsl-btn-secondary" spinnerSize="xs" pendingText="Optimizing...">
                Optimize Workspace Speed
              </SubmitButton>
            </form>
          ) : undefined
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] tracking-wider text-[var(--ink-muted)] uppercase">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-6">Record Category</th>
                <th className="px-4 py-3 font-semibold">Total Count</th>
                <th className="px-5 py-3 font-semibold sm:px-6">Policy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {dbInfo.tableCounts.map((t) => (
                <tr key={t.table}>
                  <td className="px-5 py-3 font-medium text-[var(--ink)] sm:px-6">{t.label}</td>
                  <td className="px-4 py-3 font-semibold text-[var(--ink)] tabular-nums">
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
    </div>
  );
}
