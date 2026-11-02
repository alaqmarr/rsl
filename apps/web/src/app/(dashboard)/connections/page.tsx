import { headers } from "next/headers";
import Link from "next/link";
import {
  getOrCreateWorkspaceWebhookVerifyToken,
  listWorkspaceConnections,
} from "@rsl/connections";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ConnectionsHub } from "@/components/connections-hub";
import { FlashBanner } from "@/components/flash-banner";
import { SettingsNav } from "@/components/settings-nav";
import { requireWebSession } from "@/lib/session";

export default async function ConnectedAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/connections", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Connected Channels & Whitelisting Studio"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View connected accounts"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });

  const data = listWorkspaceConnections(session.workspace.id);
  const canManage = canRolePerform(session.roleSlug, "connections:manage", session.workspace.id);
  const webhookVerifyToken = canManage
    ? getOrCreateWorkspaceWebhookVerifyToken(session.workspace.id)
    : "••••••••••••••••";
  const canAccessTokens = canRoleAccessWebRoute(
    session.roleSlug,
    "/settings/tokens",
    session.workspace.id
  );
  const canAccessTally = canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Connected Channels & Whitelisting Studio"
        subtitle="Connect WhatsApp Business Cloud API, Instagram Business, Facebook Pages, Meta Ads, and Google Business Profile with live API verification and step-by-step whitelisting checklists."
        actions={
          canAccessTokens ? (
            <Link href="/settings/tokens" className="rsl-btn-secondary">
              Manage All API Tokens
            </Link>
          ) : undefined
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ConnectionsHub
        connections={data.connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          channelKind: c.channelKind,
          displayName: c.displayName,
          externalAccountId: c.externalAccountId,
          scopesGranted: c.scopesGranted,
          metadata: c.metadata,
          maskedTokenHint: c.maskedTokenHint,
          status: c.status,
          lastHealthCheckAt: c.lastHealthCheckAt,
          expiresAt: c.expiresAt,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }))}
        whatsappWebhookUrl={endpoints.whatsappWebhookUrl}
        metaWebhookUrl={endpoints.metaWebhookUrl}
        webhookVerifyToken={webhookVerifyToken}
        canManage={canManage}
      />

      {data.tallyDevices.length > 0 && (
        <SectionCard
          title={`Paired Tally Prime Windows PC Connectors (${data.tallyDevices.length})`}
          subtitle="Desktop agents syncing Tally Prime vouchers directly into your workspace"
        >
          <div className="divide-y divide-zinc-200/80 text-[13px]">
            {data.tallyDevices.map((d) => {
              const statusLabel =
                d.status === "online"
                  ? "Connected • Port 9000 Ready"
                  : d.status === "tally_unreachable"
                    ? "PC Online • Tally Port Closed"
                    : "Offline";
              const statusTone =
                d.status === "online"
                  ? "emerald"
                  : d.status === "tally_unreachable"
                    ? "amber"
                    : "stone";
              return (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{d.deviceName}</span>
                      <StatusPill label={statusLabel} tone={statusTone} />
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {d.osVersion || "Windows"} • Agent v{d.agentVersion || "2.0"} •{" "}
                      {d.activeCompanyName ? `${d.activeCompanyName} • ` : ""}
                      {d.lastHeartbeatAt
                        ? `Last heartbeat ${new Date(d.lastHeartbeatAt).toLocaleString("en-IN")}`
                        : "Awaiting first heartbeat"}
                    </div>
                  </div>
                  {canAccessTally && (
                    <Link href="/tally?tab=connect" className="rsl-btn-secondary py-1.5 text-xs">
                      Open Tally Sync
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
