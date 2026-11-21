import Link from "next/link";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ApiTokensHub } from "@/components/api-tokens-hub";
import { CopyTextButton } from "@/components/client-utils";
import { FlashBanner } from "@/components/flash-banner";
import { ConnectToGoogleDriveButton } from "@/components/google-drive-connect-button";
import { SettingsNav } from "@/components/settings-nav";
import { TokensSuiteNav } from "@/components/suite-subnav";
import { requireWebSession } from "@/lib/session";
import { loadTokensWorkspaceContext } from "@/lib/tokens-data";

export default async function WebhooksAndSubdomainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/settings/tokens", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Webhooks, Channels & Client Subdomains"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View webhooks and integration endpoints"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = await loadTokensWorkspaceContext({
    workspaceId: session.workspace.id,
    workspaceSlug: session.workspace.slug,
    roleSlug: session.roleSlug,
  });

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Webhooks, SSL Subdomains & Channel Vault"
        subtitle="Manage dedicated SSL endpoints, Tally inbound webhook secrets, Meta verify tokens, and signed outbound webhooks"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.canAccessConnections && (
              <Link href="/connections" className="rsl-btn-secondary">
                Connected Channels
              </Link>
            )}
            <Link href="/settings/api-keys" className="rsl-btn-primary">
              REST API Keys →
            </Link>
          </div>
        }
      />

      <SettingsNav />
      <TokensSuiteNav active="webhooks" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <SectionCard
        title="Dedicated Workspace Subdomains & Edge SSL"
        subtitle={`Automatic HTTPS routing on ${ctx.endpoints.primaryDomain}`}
        action={
          ctx.googleOAuth.enableDriveOAuth && ctx.canManageConnections && !ctx.hasDriveConnected ? (
            <ConnectToGoogleDriveButton
              returnTo="/settings/tokens"
              label="Connect Google Drive"
              size="sm"
            />
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[var(--ink)]">Tally Sync Endpoint</span>
              <div className="flex items-center gap-1.5">
                <StatusPill
                  label={ctx.tallyCert?.status === "active" ? "SSL Active" : "SSL Ready"}
                  tone={ctx.tallyCert?.status === "active" ? "emerald" : "sky"}
                />
                <CopyTextButton text={ctx.endpoints.tallyWebhookUrl} label="Copy URL" copiedLabel="Copied" />
              </div>
            </div>
            <div className="mt-1 break-all font-mono font-semibold text-[var(--brand)]">
              {ctx.endpoints.tallyWebhookUrl}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[var(--ink)]">Client REST API Endpoint</span>
              <div className="flex items-center gap-1.5">
                <StatusPill
                  label={ctx.apiCert?.status === "active" ? "SSL Active" : "SSL Ready"}
                  tone={ctx.apiCert?.status === "active" ? "emerald" : "sky"}
                />
                <CopyTextButton
                  text={`${ctx.endpoints.apiCloudBaseUrl}/api/v1`}
                  label="Copy Base URL"
                  copiedLabel="Copied"
                />
              </div>
            </div>
            <div className="mt-1 break-all font-mono font-semibold text-[var(--brand)]">
              {ctx.endpoints.apiCloudBaseUrl}/api/v1
            </div>
          </div>
        </div>
      </SectionCard>

      <ApiTokensHub
        section="webhooks"
        workspaceSlug={session.workspace.slug}
        channels={ctx.connectionsData.connections.map((c) => ({
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
        canManageConnections={ctx.canManageConnections}
        allowManualCredentials={Boolean(ctx.connectionsData.allowManualCredentials)}
        tallyToken={ctx.canManageTally ? ctx.tallyEndpoint.webhookToken : "••••••••••••••••"}
        tallyWebhookUrl={ctx.endpoints.tallyWebhookUrl}
        tallyCleanEndpointUrl={ctx.endpoints.tallyWebhookUrl}
        tallyLiveStatusLabel={ctx.tallyLiveStatus.label}
        tallyLiveStatusDetail={ctx.tallyLiveStatus.detail}
        tallyLiveStatusTone={ctx.tallyLiveStatus.tone}
        tallyEventsCount={ctx.tallyEndpoint.eventsReceivedCount}
        tallyPingsCount={ctx.tallyEndpoint.pingsReceivedCount}
        canManageTally={ctx.canManageTally}
        metaVerifyToken={ctx.metaVerifyToken}
        whatsappWebhookUrl={ctx.endpoints.whatsappWebhookUrl}
        metaWebhookUrl={ctx.endpoints.metaWebhookUrl}
        hasApiEntitlement={ctx.hasApiEntitlement}
        canManageApiKeys={ctx.canManageApiKeys}
        apiKeys={ctx.apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          maskedKey: k.maskedKey,
          scopes: k.scopes,
          rateLimitPerMin: k.rateLimitPerMin,
          lastUsedAt: k.lastUsedAt,
          lastUsedIp: k.lastUsedIp,
          status: k.status,
        }))}
        outboundWebhooks={ctx.outboundWebhooks.map((w) => ({
          id: w.id,
          name: w.name,
          targetUrl: w.targetUrl,
          signingSecret: ctx.canManageApiKeys ? w.signingSecret : "••••••••••••••••",
          events: w.events,
          lastDeliveryStatus: w.lastDeliveryStatus,
        }))}
        webhookDeliveries={ctx.webhookDeliveries.map((d) => ({
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
        apiScopes={ctx.apiScopes.map((s) => ({ key: s.key, label: s.label }))}
        webhookEvents={ctx.webhookEvents.map((e) => ({ key: e.key, label: e.label }))}
        initialRevealedKey={ctx.canManageApiKeys ? sp.createdKey : undefined}
        lockedApiPlan={
          ctx.lockedPlan
            ? {
                key: ctx.lockedPlan.key,
                name: ctx.lockedPlan.name,
                tagline: ctx.lockedPlan.details.tagline,
                includedFeatures: ctx.lockedPlan.details.includedFeatures,
                monthlyAmountPaise: ctx.lockedPlan.monthlyAmountPaise,
                quarterlyAmountPaise: ctx.lockedPlan.quarterlyAmountPaise,
                yearlyAmountPaise: ctx.lockedPlan.yearlyAmountPaise,
                hasCustomPriceOverride: ctx.lockedPlan.hasCustomPriceOverride,
                isPending: Boolean(ctx.lockedPlan.pendingRequest),
                pendingCycle: ctx.lockedPlan.pendingRequest?.billingCycle,
              }
            : null
        }
        billingSettings={ctx.billingSettings}
      />
    </div>
  );
}
