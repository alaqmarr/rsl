import { headers } from "next/headers";
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
import { canRoleAccessWebRoute, canRolePerform } from "@rsl/rbac";
import {
  computeTallyWebhookLiveStatus,
  getOrCreateTallyWebhookEndpoint,
} from "@rsl/tally";
import {
  getPublicGoogleOAuthStatus,
  listWorkspaceSslCertificates,
} from "@rsl/tenancy";

export async function loadTokensWorkspaceContext(args: {
  workspaceId: string;
  workspaceSlug: string;
  roleSlug: string;
}) {
  const hdrs = await headers();
  const endpoints = resolveEndpointsFromHeaders(hdrs, {
    workspaceSlug: args.workspaceSlug,
  });
  const sslCerts = listWorkspaceSslCertificates(args.workspaceId);
  const googleOAuth = getPublicGoogleOAuthStatus();

  const canManageConnections = canRolePerform(
    args.roleSlug,
    "connections:manage",
    args.workspaceId
  );
  const canManageTally = canRolePerform(
    args.roleSlug,
    "tally:sync.manage",
    args.workspaceId
  );
  const canManageApiKeys = canRolePerform(args.roleSlug, "apikeys:manage", args.workspaceId);
  const canAccessConnections = canRoleAccessWebRoute(
    args.roleSlug,
    "/connections",
    args.workspaceId
  );

  const connectionsData = listWorkspaceConnections(args.workspaceId);
  const tallyEndpoint = getOrCreateTallyWebhookEndpoint(args.workspaceId);
  const tallyLiveStatus = computeTallyWebhookLiveStatus(tallyEndpoint);
  const metaVerifyToken = canManageConnections
    ? getOrCreateWorkspaceWebhookVerifyToken(args.workspaceId)
    : "••••••••••••••••";

  const hasApiEntitlement = hasActiveEntitlement(args.workspaceId, "api.access");
  const apiKeys = hasApiEntitlement ? listWorkspaceApiKeys(args.workspaceId) : [];
  const outboundWebhooks = hasApiEntitlement
    ? listOutboundWebhookEndpoints(args.workspaceId)
    : [];
  const webhookDeliveries = hasApiEntitlement
    ? listWorkspaceWebhookDeliveries(args.workspaceId, 30)
    : [];

  const apiPlans = !hasApiEntitlement
    ? getWorkspacePlansByKeys(args.workspaceId, ["api.access"])
    : [];
  const lockedPlan = apiPlans[0] ?? null;
  const billingSettings = getPlatformBillingSettings();

  return {
    endpoints,
    sslCerts,
    tallyCert: sslCerts.find((c) => c.zone === "tally"),
    apiCert: sslCerts.find((c) => c.zone === "api"),
    googleOAuth,
    canManageConnections,
    canManageTally,
    canManageApiKeys,
    canAccessConnections,
    connectionsData,
    tallyEndpoint,
    tallyLiveStatus,
    metaVerifyToken,
    hasApiEntitlement,
    apiKeys,
    outboundWebhooks,
    webhookDeliveries,
    lockedPlan,
    billingSettings,
    apiScopes: API_SCOPES,
    webhookEvents: WEBHOOK_EVENTS,
    hasDriveConnected: connectionsData.connections.some((c) => c.channelKind === "google_drive"),
  };
}
