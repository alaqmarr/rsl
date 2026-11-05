import { headers } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  type ConnectionChannelKind,
  getOrCreateWorkspaceWebhookVerifyToken,
  listWorkspaceConnections,
} from "@rsl/connections";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { syncGoogleBusinessReviewsForWorkspace } from "@rsl/google";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  controlDb,
  getPublicGoogleAdsStatus,
  getPublicGoogleOAuthStatus,
  getPublicMetaOAuthStatus,
} from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ConnectionsHub } from "@/components/connections-hub";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton, GoogleGLogo } from "@/components/google-drive-connect-button";
import { SettingsNav } from "@/components/settings-nav";
import { requireWebSession } from "@/lib/session";

const VALID_CHANNEL_KINDS = new Set<ConnectionChannelKind>([
  "whatsapp_cloud",
  "instagram_business",
  "facebook_page",
  "meta_ads_pixel",
  "google_ads",
  "google_business",
  "google_drive",
]);

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

  let data = listWorkspaceConnections(session.workspace.id);
  const unhydratedGbp = data.connections.find(
    (c) => c.channelKind === "google_business" && !c.metadata.lastGbpDiscoveredAt
  );
  if (unhydratedGbp) {
    await syncGoogleBusinessReviewsForWorkspace({
      workspaceId: session.workspace.id,
      connectionId: unhydratedGbp.id,
      forceDiscovery: true,
    }).catch(() => null);
    data = listWorkspaceConnections(session.workspace.id);
  }

  const wsDetails = controlDb()
    .select({
      name: controlSchema.workspaces.name,
      industry: controlSchema.workspaces.industry,
      businessPhone: controlSchema.workspaces.businessPhone,
      website: controlSchema.workspaces.website,
      addressLine: controlSchema.workspaces.addressLine,
      city: controlSchema.workspaces.city,
      pincode: controlSchema.workspaces.pincode,
      gstin: controlSchema.workspaces.gstin,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, session.workspace.id))
    .get();

  const googleOAuth = getPublicGoogleOAuthStatus();
  const metaOAuth = getPublicMetaOAuthStatus();
  const googleAdsStatus = getPublicGoogleAdsStatus();
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
  const activeDriveConn = data.connections.find((c) => c.channelKind === "google_drive");
  const requestedKind = (sp.tab || sp.kind || "").trim() as ConnectionChannelKind;
  const firstConnectedChannel = data.connections.find(
    (c) => c.channelKind !== "google_drive"
  )?.channelKind;
  const initialKind: ConnectionChannelKind | undefined = VALID_CHANNEL_KINDS.has(requestedKind)
    ? requestedKind
    : firstConnectedChannel;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Connected Channels & Whitelisting Studio"
        subtitle="Connect Google Drive for off-site backups, Google Business Profile, WhatsApp Business Cloud API, Instagram Business, Facebook Pages, and Meta Ads with live API verification."
        actions={
          canManage || canAccessTokens ? (
            <div className="flex flex-wrap items-center gap-2">
              {canManage && !activeDriveConn && (
                <ConnectToGoogleDriveButton
                  returnTo="/connections?tab=google_drive"
                  label="Connect to Google Drive"
                  size="sm"
                  configured={googleOAuth.enableDriveOAuth}
                />
              )}
              {activeDriveConn && (
                <Link
                  href="/backups"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100"
                >
                  <GoogleGLogo className="h-3.5 w-3.5" />
                  <span>Google Drive Connected ✓</span>
                </Link>
              )}
              {canAccessTokens && (
                <Link href="/settings/tokens" className="rsl-btn-secondary">
                  Manage All API Tokens
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <ConnectionsHub
        initialKind={initialKind}
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
        googleOAuth={googleOAuth}
        metaOAuth={metaOAuth}
        googleAdsStatus={googleAdsStatus}
        workspaceBusiness={{
          name: wsDetails?.name || session.workspace.name,
          industry: wsDetails?.industry || undefined,
          phone: wsDetails?.businessPhone || undefined,
          website: wsDetails?.website || undefined,
          address:
            [wsDetails?.addressLine, wsDetails?.city, wsDetails?.pincode]
              .map((s) => (s || "").trim())
              .filter(Boolean)
              .join(", ") || undefined,
          gstin: wsDetails?.gstin || undefined,
        }}
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
