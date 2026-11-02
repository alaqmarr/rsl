import { getWorkspaceDatabaseManagementInfo } from "@rsl/backup";
import { getEnv } from "@rsl/core";
import { verifyTenantHashChain } from "@rsl/logging";
import { getPlatformQueueOverview } from "@rsl/queue";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { getWorkspaceStorageStatus } from "@rsl/storage";
import { getTallyWorkspaceSummary } from "@rsl/tally";
import {
  controlDb,
  ingressDb,
  listWorkspaceSslCertificates,
  platformLogsDb,
} from "@rsl/tenancy";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { optimizeDatabaseAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function probeLocalHealth(url: string): Promise<{ online: boolean; statusText: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1400);
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) {
      return { online: false, statusText: "Unavailable" };
    }
    return {
      online: true,
      statusText: "Running Smoothly",
    };
  } catch {
    return { online: false, statusText: "Offline" };
  }
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
  const env = getEnv();

  const dbInfo = getWorkspaceDatabaseManagementInfo(session.workspace.id);
  const storage = getWorkspaceStorageStatus(session.workspace.id);
  const queues = getPlatformQueueOverview();
  const hashChain = verifyTenantHashChain(session.workspace.id);
  const tally = getTallyWorkspaceSummary(session.workspace.id);
  const sslCerts = listWorkspaceSslCertificates(session.workspace.id);
  const activeSslCount = sslCerts.filter((c) => c.status === "active").length;

  const cCheck = (
    controlDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string }
  ).quick_check;
  const iCheck = (
    ingressDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string }
  ).quick_check;
  const pCheck = (
    platformLogsDb().$client.prepare("PRAGMA quick_check").get() as { quick_check: string }
  ).quick_check;

  const [workerProbe, cleanupProbe] = await Promise.all([
    probeLocalHealth(`http://127.0.0.1:${env.WORKER_HEALTH_PORT}/health`),
    probeLocalHealth(`http://127.0.0.1:${env.CLEANUP_SERVICE_PORT}/health`),
  ]);

  const allSystemsOk =
    cCheck === "ok" && iCheck === "ok" && pCheck === "ok" && dbInfo.integrityStatus === "ok";

  const storageName =
    storage.config.mode === "client_r2"
      ? "Cloudflare R2"
      : storage.config.mode === "client_s3"
        ? "Amazon S3"
        : "Managed Storage";

  const servicesMatrix = [
    {
      name: "Business Dashboard",
      role: "Your web account, Tally bill link, and customer message inbox",
      healthy: true,
      badge: "Online",
    },
    {
      name: "Automated WhatsApp & Tally Delivery",
      role: "Sends automatic bill messages and scheduled payment reminders",
      healthy: workerProbe.online,
      badge: workerProbe.online ? "Online" : workerProbe.statusText,
    },
    {
      name: "Daily Maintenance & Backup Check",
      role: "Keeps your account fast, clean, and ready around the clock",
      healthy: cleanupProbe.online,
      badge: cleanupProbe.online ? "Online" : cleanupProbe.statusText,
    },
    {
      name: "Tally Prime Cloud Sync Ingress",
      role: `${tally.webhookEndpoint.eventsReceivedCount} voucher(s) received • ${tally.connectionOverview.connectedPcCount}/${tally.devices.length} paired PC(s) online`,
      healthy: tally.connectionOverview.overallState !== "attention_needed",
      badge: tally.connectionOverview.overallLabel,
    },
    {
      name: "Client SSL Subdomains (*.tally & *.api)",
      role: `${session.workspace.slug}.tally.${env.PRIMARY_DOMAIN} & ${session.workspace.slug}.api.${env.PRIMARY_DOMAIN}`,
      healthy: sslCerts.length === 0 || activeSslCount === sslCerts.length,
      badge:
        activeSslCount >= 2
          ? "SSL Active (2/2)"
          : sslCerts.length > 0
            ? `${activeSslCount}/${sslCerts.length} Active`
            : "Wildcard Ready",
    },
    {
      name: "Help Center & Setup Guides",
      role: "Step-by-step guides for Tally Prime, WhatsApp, and campaigns",
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
            label={allSystemsOk ? "All Services Running Smoothly" : "Attention Needed"}
            tone={allSystemsOk ? "emerald" : "amber"}
          />
        }
        title="Account Health & Status"
        subtitle="Live status of your business records, WhatsApp message delivery, and backup storage."
        actions={
          canOptimize ? (
            <form action={optimizeDatabaseAction}>
              <SubmitButton className="rsl-btn-primary" pendingText="Refreshing...">
                Refresh Account Speed
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Business Records"
          value={dbInfo.integrityStatus === "ok" ? "Healthy" : "Check Required"}
          sublabel={`${formatBytes(dbInfo.files.totalBytes)} saved`}
          accent={dbInfo.integrityStatus === "ok" ? "emerald" : "ruby"}
        />
        <MetricCard
          label="Activity History"
          value={hashChain.valid ? "Protected" : "Check Needed"}
          sublabel={`${hashChain.rowCount.toLocaleString("en-IN")} actions recorded`}
          accent={hashChain.valid ? "emerald" : "ruby"}
        />
        <MetricCard
          label="Messages in Queue"
          value={`${queues.pendingCount} Waiting`}
          sublabel={`${queues.completedCount} sent • ${queues.failedCount} failed`}
          accent={queues.failedCount > 0 ? "amber" : "emerald"}
        />
        <MetricCard
          label="Backup Storage"
          value={storageName}
          sublabel={storage.config.displayLabel}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title="Live Service Status"
          subtitle="Services running your Tally billing and WhatsApp messages"
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
          title="Data Safety & Backups"
          subtitle="Your business records are stored separately from every other company"
        >
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">Account &amp; Login Security</div>
                <div className="text-xs text-zinc-500">
                  Team access, connected accounts, and login protection
                </div>
              </div>
              <StatusPill
                label={cCheck === "ok" ? "Healthy" : "Issue"}
                tone={cCheck === "ok" ? "emerald" : "ruby"}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">
                  Incoming Tally &amp; WhatsApp Updates
                </div>
                <div className="text-xs text-zinc-500">
                  Receives instant bill notifications and customer replies
                </div>
              </div>
              <StatusPill
                label={iCheck === "ok" ? "Healthy" : "Issue"}
                tone={iCheck === "ok" ? "emerald" : "ruby"}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3">
              <div>
                <div className="font-semibold text-slate-900">
                  {session.workspace.name} Business Records
                </div>
                <div className="text-xs text-zinc-500">{storage.config.displayLabel}</div>
              </div>
              <StatusPill
                label={dbInfo.integrityStatus === "ok" ? "Healthy" : "Issue"}
                tone={dbInfo.integrityStatus === "ok" ? "emerald" : "ruby"}
              />
            </div>

            {canAccessBackups && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <span className="text-xs text-zinc-500">
                  Want to download a full backup of your business data?
                </span>
                <ActionLink
                  href="/backups"
                  className="font-semibold text-emerald-600 hover:underline"
                >
                  Backups &amp; Storage →
                </ActionLink>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
