import Link from "next/link";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { ApiTokensHub } from "@/components/api-tokens-hub";
import { FlashBanner } from "@/components/flash-banner";
import { SettingsNav } from "@/components/settings-nav";
import { TokensSuiteNav } from "@/components/suite-subnav";
import { requireWebSession } from "@/lib/session";
import { loadTokensWorkspaceContext } from "@/lib/tokens-data";

export default async function DeveloperApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/settings/api-keys", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Developer REST API Keys"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View or issue REST API keys"
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
        title="Platform REST API Keys & Live Sandbox"
        subtitle="Issue scoped Live (rsl_live_...) and Sandbox (rsl_test_...) Bearer keys for ERP, Shopify, and checkout integrations"
        actions={
          <Link href="/settings/tokens" className="rsl-btn-secondary">
            ← Webhooks &amp; Subdomains
          </Link>
        }
      />

      <SettingsNav />
      <TokensSuiteNav active="api-keys" />
      <FlashBanner notice={sp.notice} error={sp.error} />

      <ApiTokensHub
        section="api-keys"
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
