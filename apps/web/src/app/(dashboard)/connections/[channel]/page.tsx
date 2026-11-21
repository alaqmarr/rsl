import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import {
  getOrCreateWorkspaceWebhookVerifyToken,
  listWorkspaceConnections,
} from "@rsl/connections";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  detectOutdatedTdlVersion,
  getTallyWorkspaceSummary,
  probeLocalTallyPort9000,
} from "@rsl/tally";
import {
  controlDb,
  getPublicGoogleAdsStatus,
  getPublicGoogleOAuthStatus,
  getPublicMetaOAuthStatus,
  getWorkspaceCloudflareStatus,
  listWorkspaceSslCertificates,
} from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { CloudflareOneClickConnectCard } from "@/components/cloudflare-one-click-card";
import { ConnectionsHub } from "@/components/connections-hub";
import { FlashBanner } from "@/components/flash-banner";
import { SettingsNav } from "@/components/settings-nav";
import { TallyConnectStudio } from "@/components/tally-connect-studio";
import {
  INDIVIDUAL_CONNECTION_ROUTES,
  resolveConnectionRouteMeta,
} from "@/lib/connection-channels";
import { requireWebSession } from "@/lib/session";

export default async function IndividualConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ channel: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ channel }, sp, session] = await Promise.all([
    params,
    searchParams,
    requireWebSession(),
  ]);

  const routeMeta = resolveConnectionRouteMeta(channel);
  if (!routeMeta) {
    notFound();
  }

  const canAccess =
    canRoleAccessWebRoute(session.roleSlug, "/connections", session.workspace.id) ||
    (routeMeta.slug === "tally" &&
      canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id));

  if (!canAccess) {
    return (
      <AccessRestrictedState
        pageTitle={routeMeta.title}
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View connected accounts"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const canManage = canRolePerform(session.roleSlug, "connections:manage", session.workspace.id);
  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const canAccessTokens = canRoleAccessWebRoute(
    session.roleSlug,
    "/settings/tokens",
    session.workspace.id
  );
  const canAccessTally = canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id);

  const familyPeers = INDIVIDUAL_CONNECTION_ROUTES.filter((r) => r.family === routeMeta.family);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href="/connections"
            className="inline-flex items-center gap-1 font-semibold text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>All Connections</span>
          </Link>
          <span>/</span>
          <span>{routeMeta.familyLabel}</span>
          <span>/</span>
          <span className="font-semibold text-[var(--ink)]">{routeMeta.subcategoryLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {familyPeers.map((peer) => {
            const active = peer.slug === routeMeta.slug;
            return (
              <Link
                key={peer.slug}
                href={`/connections/${peer.slug}`}
                className={`rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  active
                    ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]"
                    : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-muted)]"
                }`}
              >
                {peer.title}
              </Link>
            );
          })}
        </div>
      </div>

      <PageHeader
        eyebrow={`${routeMeta.familyLabel} • ${routeMeta.subcategoryLabel} Connection`}
        title={routeMeta.title}
        subtitle={routeMeta.subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {routeMeta.relatedLinks.map((lnk, idx) => (
              <Link
                key={lnk.href}
                href={lnk.href}
                className={idx === 0 ? "rsl-btn-primary text-xs" : "rsl-btn-secondary text-xs"}
              >
                {lnk.label}
              </Link>
            ))}
            {canAccessTokens && routeMeta.slug !== "tally" && (
              <Link href="/settings/tokens" className="rsl-btn-secondary text-xs">
                API Keys
              </Link>
            )}
          </div>
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {routeMeta.slug === "cloudflare" ? (
        <CloudflareOneClickConnectCard
          initialStatus={getWorkspaceCloudflareStatus(session.workspace.id)}
          canManage={canManage}
        />
      ) : routeMeta.slug === "tally" ? (
        await (async () => {
          const hdrs = await headers();
          const endpoints = resolveEndpointsFromHeaders(hdrs, {
            workspaceSlug: session.workspace.slug,
          });
          const [tally, sslRecords, localPortProbe] = await Promise.all([
            Promise.resolve(
              getTallyWorkspaceSummary(session.workspace.id, { userId: session.user.id })
            ),
            Promise.resolve(listWorkspaceSslCertificates(session.workspace.id)),
            endpoints.isLocalDev ? probeLocalTallyPort9000(9000) : Promise.resolve(null),
          ]);
          const outdatedTdl = detectOutdatedTdlVersion(tally.webhookEndpoint.lastUserAgent);
          const deviceSplitCompanyNames = tally.devices.flatMap((d) =>
            (d.activeCompanyName ?? "")
              .replace(/\s*\(\+\d+\s+more\)$/i, "")
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
          );
          const knownCompanyNames = Array.from(
            new Set(
              [
                ...tally.companies.map((c) => c.name),
                ...(localPortProbe?.openCompanies ?? []),
                ...deviceSplitCompanyNames,
                ...(session.workspace.defaultTallyCompany
                  ? [session.workspace.defaultTallyCompany]
                  : []),
              ].filter(Boolean)
            )
          );

          return (
            <TallyConnectStudio
              workspaceName={session.workspace.name}
              workspaceSlug={session.workspace.slug}
              canManageTally={canManageTally}
              primaryDomain={endpoints.primaryDomain}
              cloudTallyBaseUrl={endpoints.tallyCloudBaseUrl}
              cloudApiBaseUrl={endpoints.apiCloudBaseUrl}
              cloudAppBaseUrl={endpoints.cloudBaseUrl}
              workspaceSubdomainUrl={endpoints.workspaceSubdomainUrl}
              localBaseUrl={endpoints.localBaseUrl}
              isLocalDev={endpoints.isLocalDev}
              outdatedTdl={outdatedTdl}
              sslCertificates={sslRecords.map((cert) => ({
                zone: cert.zone,
                hostname: cert.hostname,
                wildcardParent: cert.wildcardParent,
                status: cert.status,
                provider: cert.provider,
                coverageMode: cert.coverageMode,
                expiresAt: cert.expiresAt,
              }))}
              companyRouting={tally.companyRouting}
              knownCompanyNames={knownCompanyNames}
              nativePdfCount={tally.totals.nativePdfCount}
              localPortProbe={
                localPortProbe
                  ? {
                      reachable: localPortProbe.reachable,
                      port: localPortProbe.port,
                      activeCompanyName: localPortProbe.activeCompanyName,
                      openCompanies: localPortProbe.openCompanies,
                      voucherCount: localPortProbe.voucherCount,
                    }
                  : null
              }
              initialPairingCode={canManageTally ? sp.pairingCode : undefined}
              webhookEndpoint={{
                webhookToken: canManageTally ? tally.webhookEndpoint.webhookToken : null,
                enabled: tally.webhookEndpoint.enabled,
                eventsReceivedCount: tally.webhookEndpoint.eventsReceivedCount,
                pingsReceivedCount: tally.webhookEndpoint.pingsReceivedCount,
                lastEventAt: tally.webhookEndpoint.lastEventAt,
                lastPingAt: tally.webhookEndpoint.lastPingAt,
                lastSourceIp: tally.webhookEndpoint.lastSourceIp,
                lastUserAgent: tally.webhookEndpoint.lastUserAgent,
                lastErrorAt: tally.webhookEndpoint.lastErrorAt,
                lastErrorMessage: tally.webhookEndpoint.lastErrorMessage,
              }}
              webhookLiveStatus={tally.webhookLiveStatus}
              connectionOverview={{
                overallState: tally.connectionOverview.overallState,
                overallLabel: tally.connectionOverview.overallLabel,
                overallTone: tally.connectionOverview.overallTone,
                workflowSteps: tally.connectionOverview.workflowSteps,
              }}
              devices={tally.devices.map((d) => ({
                id: d.id,
                deviceName: d.deviceName,
                osVersion: d.osVersion,
                agentVersion: d.agentVersion,
                tallyReachable: d.tallyReachable,
                tallyHost: d.tallyHost,
                tallyPort: d.tallyPort,
                activeCompanyName: d.activeCompanyName,
                lastAlterId: d.lastAlterId,
                lastHeartbeatAt: d.lastHeartbeatAt,
                lastSyncAt: d.lastSyncAt,
                lastErrorMessage: d.lastErrorMessage,
                liveStatus: d.liveStatus,
              }))}
              syncRuns={tally.syncRuns.map((r) => ({
                id: r.id,
                source: r.source,
                vouchersUpserted: r.vouchersUpserted,
                durationMs: r.durationMs,
                status: r.status,
                errorMessage: null,
                createdAt: r.createdAt,
              }))}
            />
          );
        })()
      ) : (
        await (async () => {
          const data = listWorkspaceConnections(session.workspace.id);
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
          const allowManualCredentials = Boolean(data.allowManualCredentials);

          let whatsappWebhookUrl = "";
          let metaWebhookUrl = "";
          let webhookVerifyToken = "";
          if (allowManualCredentials && canManage) {
            const hdrs = await headers();
            const endpoints = resolveEndpointsFromHeaders(hdrs, {
              workspaceSlug: session.workspace.slug,
            });
            whatsappWebhookUrl = endpoints.whatsappWebhookUrl;
            metaWebhookUrl = endpoints.metaWebhookUrl;
            webhookVerifyToken = getOrCreateWorkspaceWebhookVerifyToken(session.workspace.id);
          }

          return (
            <ConnectionsHub
              initialKind={routeMeta.channelKind}
              focusedKind={routeMeta.channelKind}
              oauthReturnTo={`/connections/${routeMeta.slug}`}
              hideOverviewStrip
              hideTallyCard
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
              allowManualCredentials={allowManualCredentials}
              whatsappWebhookUrl={whatsappWebhookUrl}
              metaWebhookUrl={metaWebhookUrl}
              webhookVerifyToken={webhookVerifyToken}
              canManage={canManage}
              canAccessTally={canAccessTally}
              tallyDevices={data.tallyDevices}
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
          );
        })()
      )}
    </div>
  );
}
