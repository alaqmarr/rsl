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
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  controlDb,
  getPublicGoogleAdsStatus,
  getPublicGoogleOAuthStatus,
  getPublicMetaOAuthStatus,
} from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader } from "@rsl/ui";
import { ConnectionsHub } from "@/components/connections-hub";
import { FlashBanner } from "@/components/flash-banner";
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
  "google_sheets",
  "google_search_console",
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
        pageTitle="Connected Accounts"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View connected accounts"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

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
  const canManage = canRolePerform(session.roleSlug, "connections:manage", session.workspace.id);
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

  const canAccessTokens = canRoleAccessWebRoute(
    session.roleSlug,
    "/settings/tokens",
    session.workspace.id
  );
  const canAccessTally = canRoleAccessWebRoute(session.roleSlug, "/tally", session.workspace.id);
  const requestedKind = (sp.tab || sp.kind || "").trim() as ConnectionChannelKind;
  const initialKind: ConnectionChannelKind | undefined = VALID_CHANNEL_KINDS.has(requestedKind)
    ? requestedKind
    : undefined;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Connected Accounts"
        subtitle="Connect WhatsApp Business, Instagram, Facebook, Meta Ads, and your Google Business & Workspace accounts in one click."
        actions={
          canAccessTokens ? (
            <Link href="/settings/tokens" className="rsl-btn-secondary text-xs">
              API Keys &amp; Tally Webhook
            </Link>
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
    </div>
  );
}
