import { headers } from "next/headers";
import Link from "next/link";
import {
  API_SCOPES,
  listOutboundWebhookEndpoints,
  listWorkspaceApiKeys,
  listWorkspaceWebhookDeliveries,
  WEBHOOK_EVENTS,
} from "@rsl/api-keys";
import {
  getPlatformBillingSettings,
  getWorkspacePlansByKeys,
  hasActiveEntitlement,
} from "@rsl/billing";
import {
  getOrCreateWorkspaceWebhookVerifyToken,
  listWorkspaceConnections,
} from "@rsl/connections";
import { resolveEndpointsFromHeaders } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  computeTallyWebhookLiveStatus,
  getOrCreateTallyWebhookEndpoint,
} from "@rsl/tally";
import {
  getPublicGoogleOAuthStatus,
  listWorkspaceSslCertificates,
} from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ApiTokensHub } from "@/components/api-tokens-hub";
import { CopyTextButton } from "@/components/client-utils";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton } from "@/components/google-drive-connect-button";
import { SettingsNav } from "@/components/settings-nav";
import { requireWebSession } from "@/lib/session";

export default async function UnifiedApiTokensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/settings/tokens", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Unified API Tokens & Webhook Vault"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View API keys, connections, or Tally sync tokens"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: session.workspace.slug,
  });
  const sslCerts = listWorkspaceSslCertificates(session.workspace.id);
  const googleOAuth = getPublicGoogleOAuthStatus();

  const canManageConnections = canRolePerform(
    session.roleSlug,
    "connections:manage",
    session.workspace.id
  );
  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );
  const canManageApiKeys = canRolePerform(session.roleSlug, "apikeys:manage", session.workspace.id);
  const canAccessConnections = canRoleAccessWebRoute(
    session.roleSlug,
    "/connections",
    session.workspace.id
  );

  const connectionsData = listWorkspaceConnections(session.workspace.id);
  const tallyEndpoint = getOrCreateTallyWebhookEndpoint(session.workspace.id);
  const tallyLiveStatus = computeTallyWebhookLiveStatus(tallyEndpoint);
  const tallyWebhookUrl = endpoints.tallyWebhookUrl;
  const metaVerifyToken = canManageConnections
    ? getOrCreateWorkspaceWebhookVerifyToken(session.workspace.id)
    : "••••••••••••••••";

  const hasApiEntitlement = hasActiveEntitlement(session.workspace.id, "api.access");
  const apiKeys = hasApiEntitlement ? listWorkspaceApiKeys(session.workspace.id) : [];
  const outboundWebhooks = hasApiEntitlement
    ? listOutboundWebhookEndpoints(session.workspace.id)
    : [];
  const webhookDeliveries = hasApiEntitlement
    ? listWorkspaceWebhookDeliveries(session.workspace.id, 30)
    : [];

  const apiPlans = !hasApiEntitlement
    ? getWorkspacePlansByKeys(session.workspace.id, ["api.access"])
    : [];
  const lockedPlan = apiPlans[0] ?? null;
  const billingSettings = getPlatformBillingSettings();

  const tallyCert = sslCerts.find((c) => c.zone === "tally");
  const apiCert = sslCerts.find((c) => c.zone === "api");
  const hasDriveConnected = connectionsData.connections.some(
    (c) => c.channelKind === "google_drive"
  );

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Unified API Tokens, Client Subdomains & Webhook Vault"
        subtitle="Manage every token and dedicated SSL client endpoint across your business in a single screen - External Channel tokens, Tally Prime webhook token, Meta webhook verify token, and Platform REST API keys."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageConnections && !hasDriveConnected && (
              <ConnectToGoogleDriveButton
                returnTo="/settings/tokens"
                label="Connect to Google Drive"
                variant="white"
                size="sm"
                configured={googleOAuth.enableDriveOAuth}
              />
            )}
            {canAccessConnections && (
              <Link href="/connections" className="rsl-btn-secondary">
                Connected Accounts
              </Link>
            )}
            {canManageTally && (
              <a href="/api/export/tally-tdl" className="rsl-btn-primary">
                Download Tally Add-On (.tdl)
              </a>
            )}
          </div>
        }
      />

      <SettingsNav />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <SectionCard
        title="Dedicated Client SSL Ingress Endpoints"
        subtitle="Whitelisted client subdomains under *.tally.rapidshiftlabs.in and *.api.rapidshiftlabs.in with queued backend SSL provisioning"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">Tally Prime Client Endpoint</span>
              <div className="flex items-center gap-1.5">
                <StatusPill
                  label={tallyCert?.status === "active" ? "SSL Active" : "SSL Ready"}
                  tone={tallyCert?.status === "active" ? "emerald" : "sky"}
                />
                <CopyTextButton text={endpoints.tallyWebhookUrl} label="Copy URL" copiedLabel="Copied" />
              </div>
            </div>
            <div className="mt-1 break-all font-mono font-semibold text-emerald-800">
              {endpoints.tallyWebhookUrl}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">Client REST API Endpoint</span>
              <div className="flex items-center gap-1.5">
                <StatusPill
                  label={apiCert?.status === "active" ? "SSL Active" : "SSL Ready"}
                  tone={apiCert?.status === "active" ? "emerald" : "sky"}
                />
                <CopyTextButton text={`${endpoints.apiCloudBaseUrl}/api/v1`} label="Copy Base URL" copiedLabel="Copied" />
              </div>
            </div>
            <div className="mt-1 break-all font-mono font-semibold text-emerald-800">
              {endpoints.apiCloudBaseUrl}/api/v1
            </div>
          </div>
        </div>
      </SectionCard>

      <ApiTokensHub
        workspaceSlug={session.workspace.slug}
        channels={connectionsData.connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          channelKind: c.channelKind,
          displayName: c.displayName,
          externalAccountId: c.externalAccountId,
          maskedTokenHint: c.maskedTokenHint,
          status: c.status,
          lastHealthCheckAt: c.lastHealthCheckAt,
          lastLiveCheckMessage: c.metadata.lastLiveCheckMessage,
          tokenMode: c.metadata.tokenMode,
        }))}
        canManageConnections={canManageConnections}
        allowManualCredentials={Boolean(connectionsData.allowManualCredentials)}
        tallyToken={canManageTally ? tallyEndpoint.webhookToken : "••••••••••••••••"}
        tallyWebhookUrl={tallyWebhookUrl}
        tallyCleanEndpointUrl={endpoints.tallyWebhookUrl}
        tallyLiveStatusLabel={tallyLiveStatus.label}
        tallyLiveStatusDetail={tallyLiveStatus.detail}
        tallyLiveStatusTone={tallyLiveStatus.tone}
        tallyEventsCount={tallyEndpoint.eventsReceivedCount}
        tallyPingsCount={tallyEndpoint.pingsReceivedCount}
        canManageTally={canManageTally}
        metaVerifyToken={metaVerifyToken}
        whatsappWebhookUrl={endpoints.whatsappWebhookUrl}
        metaWebhookUrl={endpoints.metaWebhookUrl}
        hasApiEntitlement={hasApiEntitlement}
        canManageApiKeys={canManageApiKeys}
        apiKeys={apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          maskedKey: k.maskedKey,
          scopes: k.scopes,
          rateLimitPerMin: k.rateLimitPerMin,
          lastUsedAt: k.lastUsedAt,
          lastUsedIp: k.lastUsedIp,
          status: k.status,
        }))}
        outboundWebhooks={outboundWebhooks.map((w) => ({
          id: w.id,
          name: w.name,
          targetUrl: w.targetUrl,
          signingSecret: canManageApiKeys ? w.signingSecret : "••••••••••••••••",
          events: w.events,
          lastDeliveryStatus: w.lastDeliveryStatus,
        }))}
        webhookDeliveries={webhookDeliveries.map((d) => ({
          id: d.id,
          endpointId: d.endpointId,
          eventType: d.eventType,
          status: d.status,
          attemptCount: d.attemptCount,
          httpStatus: d.httpStatus,
          lastError: d.lastError,
          nextRetryAt: d.nextRetryAt,
          createdAt: d.createdAt,
          deliveredAt: d.deliveredAt,
        }))}
        apiScopes={API_SCOPES.map((s) => ({ key: s.key, label: s.label }))}
        webhookEvents={WEBHOOK_EVENTS.map((e) => ({ key: e.key, label: e.label }))}
        initialRevealedKey={canManageApiKeys ? sp.createdKey : undefined}
        lockedApiPlan={
          lockedPlan
            ? {
                key: lockedPlan.key,
                name: lockedPlan.name,
                tagline: lockedPlan.details.tagline,
                includedFeatures: lockedPlan.details.includedFeatures,
                monthlyAmountPaise: lockedPlan.monthlyAmountPaise,
                quarterlyAmountPaise: lockedPlan.quarterlyAmountPaise,
                yearlyAmountPaise: lockedPlan.yearlyAmountPaise,
                hasCustomPriceOverride: lockedPlan.hasCustomPriceOverride,
                isPending: Boolean(lockedPlan.pendingRequest),
                pendingCycle: lockedPlan.pendingRequest?.billingCycle,
              }
            : null
        }
        billingSettings={billingSettings}
      />
    </div>
  );
}
