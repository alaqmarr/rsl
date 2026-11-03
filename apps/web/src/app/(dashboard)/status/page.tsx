import { getWorkspaceDatabaseManagementInfo } from "@rsl/backup";
import { listWorkspaceConnections } from "@rsl/connections";
import { verifyTenantHashChain } from "@rsl/logging";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getWorkspaceStorageStatus } from "@rsl/storage";
import { getTallyWorkspaceSummary } from "@rsl/tally";
import { listWorkspaceSslCertificates } from "@rsl/tenancy";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { optimizeDatabaseAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default async function SystemStatusPage() {
  const session = await requireWebSession();

  if (!canRoleAccessWebRoute(session.roleSlug, "/status", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Account Health & Status"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View activity history, connections, or billing status"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const canOptimize = canRolePerform(session.roleSlug, "backup:manage", session.workspace.id);
  const canAccessBackups = canRoleAccessWebRoute(
    session.roleSlug,
    "/backups",
    session.workspace.id
  );
  const canAccessConnections = canRoleAccessWebRoute(
    session.roleSlug,
    "/connections",
    session.workspace.id
  );

  const dbInfo = getWorkspaceDatabaseManagementInfo(session.workspace.id);
  const storage = getWorkspaceStorageStatus(session.workspace.id);
  const hashChain = verifyTenantHashChain(session.workspace.id);
  const tally = getTallyWorkspaceSummary(session.workspace.id);
  const { connections } = listWorkspaceConnections(session.workspace.id);
  const sslCerts = listWorkspaceSslCertificates(session.workspace.id);
  const activeSslCount = sslCerts.filter((c) => c.status === "active").length;

  const connectedChannelsCount = connections.filter((c) => c.status === "connected").length;
  const needsReauthCount = connections.filter((c) => c.status === "needs_reauth").length;

  const allSystemsOk =
    dbInfo.integrityStatus === "ok" && hashChain.valid && needsReauthCount === 0;

  const storageName =
    storage.config.mode === "client_r2"
      ? "Cloudflare R2"
      : storage.config.mode === "client_s3"
        ? "Amazon S3"
        : "Managed Cloud Vault";

  const servicesMatrix = [
    {
      name: "Business Dashboard & Customer Inbox",
      role: "Your web workspace, customer message threads, and team access controls",
      healthy: true,
      badge: "Online",
    },
    {
      name: "Connected Channels (WhatsApp, Meta & Google)",
      role:
        connectedChannelsCount > 0
          ? `${connectedChannelsCount} channel(s) connected${
              needsReauthCount > 0 ? ` • ${needsReauthCount} awaiting reconnection` : ""
            }`
          : "Ready to connect your WhatsApp Business, Meta, or Google Drive account",
      healthy: needsReauthCount === 0,
      badge:
        needsReauthCount > 0
          ? "Reconnect Needed"
          : connectedChannelsCount > 0
            ? "Connected"
            : "Ready",
    },
    {
      name: "Tally Prime Sync & Bill Automation",
      role: `${tally.webhookEndpoint.eventsReceivedCount.toLocaleString("en-IN")} voucher(s) synced • ${tally.connectionOverview.connectedPcCount}/${tally.devices.length} paired computer(s)`,
      healthy: tally.connectionOverview.overallState !== "attention_needed",
      badge: tally.connectionOverview.overallLabel,
    },
    {
      name: "Secure Dedicated Business Links (HTTPS)",
      role: "Encrypted connection endpoints for your Tally Prime desktop connector and API",
      healthy: sslCerts.length === 0 || activeSslCount === sslCerts.length,
      badge:
        activeSslCount >= 2
          ? "SSL Protected"
          : sslCerts.length > 0
            ? "Provisioning"
            : "Protected",
    },
    {
      name: "Help Center & Setup Guides",
      role: "Step-by-step instructions for Tally Prime, WhatsApp templates, and backups",
      healthy: true,
      badge: "Available",
    },
  ];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        badge={
          <StatusPill
            label={allSystemsOk ? "All Services Running Smoothly" : "Attention Recommended"}
            tone={allSystemsOk ? "emerald" : "amber"}
          />
        }
        title="Account Health & Status"
        subtitle="Live health of your isolated business records, Tally Prime connection, and backup storage."
        actions={
          canOptimize ? (
            <form action={optimizeDatabaseAction}>
              <SubmitButton className="rsl-btn-primary" pendingText="Refreshing...">
                Optimize Account Storage
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Business Records"
          value={dbInfo.integrityStatus === "ok" ? "Healthy" : "Check Required"}
          sublabel={`${formatBytes(dbInfo.files.totalBytes)} stored privately`}
          accent={dbInfo.integrityStatus === "ok" ? "emerald" : "ruby"}
        />
        <MetricCard
          label="Activity Audit Trail"
          value={hashChain.valid ? "Verified" : "Check Needed"}
          sublabel={`${hashChain.rowCount.toLocaleString("en-IN")} tamper-evident entries`}
          accent={hashChain.valid ? "emerald" : "ruby"}
        />
        <MetricCard
          label="Connected Channels"
          value={`${connectedChannelsCount} Active`}
          sublabel={
            needsReauthCount > 0
              ? `${needsReauthCount} channel needs sign-in refresh`
              : `${tally.vouchers.length.toLocaleString("en-IN")} Tally bills cached`
          }
          accent={needsReauthCount > 0 ? "amber" : "emerald"}
        />
        <MetricCard
          label="Backup Vault"
          value={storageName}
          sublabel={storage.config.displayLabel}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title="Live Workspace Services"
          subtitle="Status of the services powering your Tally billing, WhatsApp replies, and backups"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-semibold sm:px-6">Service</th>
                  <th className="px-4 py-3 font-semibold">What It Does</th>
                  <th className="px-5 py-3 text-right font-semibold sm:px-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {servicesMatrix.map((svc) => (
                  <tr key={svc.name}>
                    <td className="px-5 py-3.5 font-semibold text-slate-900 sm:px-6">
                      {svc.name}
                    </td>
                    <td className="px-4 py-3.5 text-zinc-600">{svc.role}</td>
                    <td className="px-5 py-3.5 text-right sm:px-6">
                      <StatusPill label={svc.badge} tone={svc.healthy ? "emerald" : "amber"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          title="Data Isolation & Safety"
          subtitle="Your company records are stored in a dedicated vault separated from every other business"
        >
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">
                  {session.workspace.name} Private Vault
                </div>
                <div className="text-xs text-zinc-600">{storage.config.displayLabel}</div>
              </div>
              <StatusPill
                label={dbInfo.integrityStatus === "ok" ? "Healthy" : "Issue"}
                tone={dbInfo.integrityStatus === "ok" ? "emerald" : "ruby"}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">Tamper-Evident Audit Protection</div>
                <div className="text-xs text-zinc-600">
                  Every login, payment, and setting change is cryptographically verified
                </div>
              </div>
              <StatusPill
                label={hashChain.valid ? "Verified" : "Check"}
                tone={hashChain.valid ? "emerald" : "ruby"}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">External Channel Authorization</div>
                <div className="text-xs text-zinc-600">
                  Encrypted credentials for WhatsApp, Meta, and Google Drive
                </div>
              </div>
              <StatusPill
                label={needsReauthCount === 0 ? "Healthy" : "Reconnect"}
                tone={needsReauthCount === 0 ? "emerald" : "amber"}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {canAccessBackups && (
                <ActionLink
                  href="/backups"
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                >
                  Backups &amp; Google Drive →
                </ActionLink>
              )}
              {canAccessConnections && needsReauthCount > 0 && (
                <ActionLink
                  href="/connections"
                  className="text-xs font-semibold text-amber-800 hover:underline"
                >
                  Reconnect Channel →
                </ActionLink>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
