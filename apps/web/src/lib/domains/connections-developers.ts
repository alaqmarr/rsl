import { revalidatePath } from "next/cache";
import {
  createOutboundWebhookEndpoint,
  deleteOutboundWebhookEndpoint,
  issueApiKey,
  revokeApiKey,
  rotateApiKey,
  testOutboundWebhookEndpoint,
} from "@rsl/api-keys";
import { hasActiveEntitlement } from "@rsl/billing";
import {
  assertManualCredentialsAllowedForWorkspace,
  disconnectExternalConnection,
  formatGoogleAdsCustomerId,
  linkExternalConnection,
  normalizeGoogleAdsCustomerId,
  refreshMetaChannelAssets,
  rotateWorkspaceWebhookVerifyToken,
  selectGoogleAdsCustomer,
  selectGoogleBusinessLocation,
  selectGoogleSearchConsoleSite,
  selectMetaChannelAsset,
  updateExternalConnection,
  verifyExternalConnectionHealth,
  type ConnectionChannelKind,
} from "@rsl/connections";
import { getEnv } from "@rsl/core";
import { syncGoogleReviews } from "@rsl/google";
import { appendActionLog } from "@rsl/logging";
import { enqueueWorkspaceSslProvisioning } from "@rsl/queue";
import { authorize, authorizeAny } from "@rsl/rbac";
import {
  connectWorkspaceCloudflareOneClick,
  disconnectWorkspaceCloudflare,
  probeWorkspaceCloudflareConnection,
  provisionWorkspaceCloudflareResource,
  updateWorkspaceCloudflareWorkloads,
  type WorkspaceCloudflareStatus,
} from "@rsl/tenancy";
import { requireWebSession } from "../session";
import {
  elapsedMs,
  enforceFeaturePaidEntitlement,
  friendlyMessage,
  goWithError,
  goWithNotice,
} from "./shared";

const CHANNEL_DEFAULTS: Record<
  ConnectionChannelKind,
  {
    provider:
      | "whatsapp"
      | "meta"
      | "google"
      | "gdrive"
      | "google_ads"
      | "google_sheets"
      | "google_search_console";
    assetType?:
      | "fb_page"
      | "ig_account"
      | "ad_account"
      | "pixel"
      | "waba_phone"
      | "gbp_location"
      | "google_ad_customer";
    scopes: string[];
  }
> = {
  whatsapp_cloud: {
    provider: "whatsapp",
    assetType: "waba_phone",
    scopes: [
      "whatsapp_business_messaging",
      "whatsapp_business_management",
      "business_management",
    ],
  },
  instagram_business: {
    provider: "meta",
    assetType: "ig_account",
    scopes: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "instagram_content_publish",
      "pages_show_list",
    ],
  },
  facebook_page: {
    provider: "meta",
    assetType: "fb_page",
    scopes: [
      "pages_show_list",
      "pages_messaging",
      "pages_manage_posts",
      "pages_read_engagement",
      "pages_manage_metadata",
    ],
  },
  meta_ads_pixel: {
    provider: "meta",
    assetType: "ad_account",
    scopes: ["ads_read", "ads_management", "business_management"],
  },
  google_ads: {
    provider: "google_ads",
    assetType: "google_ad_customer",
    scopes: ["https://www.googleapis.com/auth/adwords"],
  },
  google_business: {
    provider: "google",
    assetType: "gbp_location",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
  },
  google_drive: {
    provider: "gdrive",
    assetType: undefined,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
  google_sheets: {
    provider: "google_sheets",
    assetType: undefined,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  google_search_console: {
    provider: "google_search_console",
    assetType: undefined,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  },
};

export async function connectAccountActionImpl(formData: FormData) {
  const session = await requireWebSession();
  try {
    assertManualCredentialsAllowedForWorkspace(session.workspace.id);
  } catch (err) {
    return goWithError("/connections", friendlyMessage(err));
  }
  const providerRaw = String(formData.get("provider") || "whatsapp");
  const provider = (
    ["meta", "whatsapp", "google", "gdrive"].includes(providerRaw) ? providerRaw : "whatsapp"
  ) as "meta" | "whatsapp" | "google" | "gdrive";
  const assetTypeRaw = String(formData.get("assetType") || "");
  const res = await linkExternalConnection(session.ctx, {
    provider,
    displayName: String(formData.get("displayName") || ""),
    externalAccountId: String(formData.get("externalAccountId") || ""),
    accessToken: String(formData.get("accessToken") || ""),
    scopesGranted: ["messages", "insights"],
    assetType: assetTypeRaw
      ? (assetTypeRaw as
          | "fb_page"
          | "ig_account"
          | "ad_account"
          | "pixel"
          | "waba_phone"
          | "gbp_location")
      : undefined,
    assetName: String(formData.get("assetName") || "") || undefined,
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  return goWithNotice("/connections", "Account connected securely.");
}

export async function disconnectAccountActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const res = await disconnectExternalConnection(session.ctx, {
    connectionId: String(formData.get("connectionId") || ""),
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  return goWithNotice("/connections", "Account disconnected.");
}

export async function verifyConnectionHealthActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const res = await verifyExternalConnectionHealth(session.ctx, {
    connectionId: String(formData.get("connectionId") || ""),
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  const statusMsg =
    res.data.status === "healthy"
      ? `Connection "${res.data.displayName}" verified healthy.`
      : res.data.status === "expiring"
        ? `Connection "${res.data.displayName}" is expiring soon - please renew its token.`
        : `Connection "${res.data.displayName}" requires re-authentication.`;
  return goWithNotice("/connections", statusMsg);
}

export async function issueApiKeyActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const scopes = formData.getAll("scopes").map(String).filter(Boolean);
  const res = await issueApiKey(session.ctx, {
    name: String(formData.get("name") || ""),
    mode: String(formData.get("mode") || "live") === "test" ? "test" : "live",
    scopes:
      scopes.length > 0
        ? scopes
        : ["contacts:read", "vouchers:read", "vouchers:write", "whatsapp:write"],
    rateLimitPerMin: Number(formData.get("rateLimitPerMin") || 120),
    expiresInDays: Number(formData.get("expiresInDays") || 0),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    `/developers?createdKey=${encodeURIComponent(res.data.rawKey)}`,
    "Copy your new API key now - it is shown only once."
  );
}

export async function revokeApiKeyActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await revokeApiKey(session.ctx, {
    keyId: String(formData.get("keyId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "API key revoked immediately.");
}

export async function rotateApiKeyActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await rotateApiKey(session.ctx, {
    keyId: String(formData.get("keyId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    `/developers?createdKey=${encodeURIComponent(res.data.rawKey)}`,
    `API key "${res.data.name}" rotated - previous key revoked and new key shown below once.`
  );
}

export async function createOutboundWebhookActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const events = formData.getAll("events").map(String).filter(Boolean);
  const res = await createOutboundWebhookEndpoint(session.ctx, {
    name: String(formData.get("name") || ""),
    targetUrl: String(formData.get("targetUrl") || ""),
    events: events.length > 0 ? events : ["tally.bill.created", "whatsapp.message.received"],
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "Outbound webhook saved with signing secret.");
}

export async function deleteOutboundWebhookActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await deleteOutboundWebhookEndpoint(session.ctx, {
    endpointId: String(formData.get("endpointId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "Outbound webhook endpoint removed.");
}

export async function testOutboundWebhookActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await testOutboundWebhookEndpoint(session.ctx, {
    endpointId: String(formData.get("endpointId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    "/developers",
    `Test webhook dispatched (${res.data.deliveryStatus}). Signed with X-RSL-Signature.`
  );
}

export async function connectChannelJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  connectionId?: string;
  liveStatus?: "healthy" | "expiring" | "needs_reauth";
  liveMessage?: string;
}> {
  try {
    const session = await requireWebSession();
    assertManualCredentialsAllowedForWorkspace(session.workspace.id);
    const channelKindRaw = String(formData.get("channelKind") || "whatsapp_cloud").trim();
    const channelKind = (
      channelKindRaw in CHANNEL_DEFAULTS ? channelKindRaw : "whatsapp_cloud"
    ) as ConnectionChannelKind;
    const cfg = CHANNEL_DEFAULTS[channelKind];

    const displayName = String(formData.get("displayName") || "").trim();
    const accessToken = String(formData.get("accessToken") || "").trim();
    const refreshToken = String(formData.get("refreshToken") || "").trim() || undefined;

    const wabaId = String(formData.get("wabaId") || "").trim() || undefined;
    const phoneNumberId = String(formData.get("phoneNumberId") || "").trim() || undefined;
    const displayPhone = String(formData.get("displayPhone") || "").trim() || undefined;
    const metaAppId = String(formData.get("metaAppId") || "").trim() || undefined;
    const pageId = String(formData.get("pageId") || "").trim() || undefined;
    const pageName = String(formData.get("pageName") || "").trim() || undefined;
    const igUserId = String(formData.get("igUserId") || "").trim() || undefined;
    const linkedPageId = String(formData.get("linkedPageId") || "").trim() || undefined;
    const igHandle = String(formData.get("igHandle") || "").trim() || undefined;
    const adAccountId = String(formData.get("adAccountId") || "").trim() || undefined;
    const pixelId = String(formData.get("pixelId") || "").trim() || undefined;
    const rawCustomerId = String(formData.get("customerId") || "").trim();
    const customerId = rawCustomerId ? normalizeGoogleAdsCustomerId(rawCustomerId) : undefined;
    const formattedCustomerId = customerId ? formatGoogleAdsCustomerId(customerId) : undefined;
    const rawLoginCustomerId = String(formData.get("loginCustomerId") || "").trim();
    const loginCustomerId = rawLoginCustomerId
      ? normalizeGoogleAdsCustomerId(rawLoginCustomerId)
      : undefined;
    const locationId = String(formData.get("locationId") || "").trim() || undefined;
    const accountId = String(formData.get("accountId") || "").trim() || undefined;
    const storeName = String(formData.get("storeName") || "").trim() || undefined;
    const folderId = String(formData.get("folderId") || "").trim() || undefined;
    const driveEmail = String(formData.get("driveEmail") || "").trim() || undefined;

    const externalAccountId =
      String(formData.get("externalAccountId") || "").trim() ||
      phoneNumberId ||
      wabaId ||
      igUserId ||
      pageId ||
      adAccountId ||
      pixelId ||
      customerId ||
      locationId ||
      folderId ||
      "";

    const assetName =
      displayPhone ||
      igHandle ||
      pageName ||
      storeName ||
      formattedCustomerId ||
      driveEmail ||
      displayName;

    const linked = await linkExternalConnection(session.ctx, {
      provider: cfg.provider,
      displayName,
      externalAccountId,
      accessToken,
      refreshToken,
      scopesGranted: cfg.scopes,
      assetType: cfg.assetType,
      assetName,
      metadata: {
        channelKind,
        wabaId,
        phoneNumberId,
        displayPhone,
        metaAppId,
        pageId,
        pageName,
        igUserId,
        linkedPageId,
        igHandle,
        adAccountId,
        pixelId,
        customerId,
        formattedCustomerId,
        loginCustomerId,
        locationId,
        accountId,
        storeName,
        folderId,
        driveEmail,
      },
    });

    if (!linked.ok) {
      return { ok: false, message: linked.error.message };
    }

    let liveStatus: "healthy" | "expiring" | "needs_reauth" = "healthy";
    let liveMessage = "Encrypted in workspace vault.";

    if (String(formData.get("testLiveAfterSave") || "1") !== "0") {
      const check = await verifyExternalConnectionHealth(session.ctx, {
        connectionId: linked.data.connectionId,
        checkLiveProvider: true,
      });
      if (check.ok) {
        liveStatus = check.data.status;
        liveMessage = check.data.liveMessage;
      }
    }

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/", "layout");

    return {
      ok: true,
      connectionId: linked.data.connectionId,
      liveStatus,
      liveMessage,
      message:
        liveStatus === "needs_reauth"
          ? `Saved '${displayName}', but live provider check reported an issue: ${liveMessage}`
          : `Connected '${displayName}' (${liveMessage})`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function updateConnectionJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  maskedTokenHint?: string;
  liveStatus?: "healthy" | "expiring" | "needs_reauth";
}> {
  try {
    const session = await requireWebSession();
    assertManualCredentialsAllowedForWorkspace(session.workspace.id);
    const connectionId = String(formData.get("connectionId") || "").trim();
    const displayName = String(formData.get("displayName") || "").trim() || undefined;
    const externalAccountId = String(formData.get("externalAccountId") || "").trim() || undefined;
    const accessToken = String(formData.get("accessToken") || "").trim() || undefined;
    const refreshToken = String(formData.get("refreshToken") || "").trim() || undefined;

    const metadataPatch: Record<string, string> = {};
    for (const key of [
      "wabaId",
      "phoneNumberId",
      "displayPhone",
      "metaAppId",
      "pageId",
      "pageName",
      "igUserId",
      "linkedPageId",
      "igHandle",
      "adAccountId",
      "pixelId",
      "customerId",
      "loginCustomerId",
      "locationId",
      "accountId",
      "storeName",
      "folderId",
      "driveEmail",
    ]) {
      const val = formData.get(key);
      if (val !== null && String(val).trim().length > 0) {
        metadataPatch[key] = String(val).trim();
      }
    }

    const updated = await updateExternalConnection(session.ctx, {
      connectionId,
      displayName,
      externalAccountId,
      accessToken,
      refreshToken,
      metadata: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
    });

    if (!updated.ok) {
      return { ok: false, message: updated.error.message };
    }

    let liveStatus: "healthy" | "expiring" | "needs_reauth" | undefined;
    let extraNote = "";
    if (accessToken && String(formData.get("testLiveAfterSave") || "1") !== "0") {
      const check = await verifyExternalConnectionHealth(session.ctx, {
        connectionId,
        checkLiveProvider: true,
      });
      if (check.ok) {
        liveStatus = check.data.status;
        extraNote = ` ${check.data.liveMessage}`;
      }
    }

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      maskedTokenHint: updated.data.maskedTokenHint,
      liveStatus,
      message: updated.data.rotatedToken
        ? `Access token rotated for '${updated.data.displayName}'.${extraNote}`
        : `Updated settings for '${updated.data.displayName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function verifyConnectionLiveJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  status?: "healthy" | "expiring" | "needs_reauth";
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const res = await verifyExternalConnectionHealth(session.ctx, {
      connectionId,
      checkLiveProvider: true,
    });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    revalidatePath("/connections");
    revalidatePath("/reviews");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: res.data.status !== "needs_reauth",
      status: res.data.status,
      message: res.data.liveMessage,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function syncGoogleBusinessProfileJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  storeName?: string;
  syncedCount?: number;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim() || undefined;
    const res = await syncGoogleReviews(session.ctx, {
      connectionId,
      forceDiscovery: true,
    });
    revalidatePath("/connections");
    revalidatePath("/reviews");
    revalidatePath("/settings/tokens");
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    return {
      ok: res.data.ok,
      storeName: res.data.storeName,
      syncedCount: res.data.syncedCount,
      message: res.data.message,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function selectGoogleBusinessLocationJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const locationId = String(formData.get("locationId") || "").trim();
    const selected = await selectGoogleBusinessLocation(session.ctx, {
      connectionId,
      locationId,
    });
    if (!selected.ok) {
      return { ok: false, message: selected.error.message };
    }
    const synced = await syncGoogleReviews(session.ctx, {
      connectionId,
      forceDiscovery: false,
    });
    revalidatePath("/connections");
    revalidatePath("/reviews");
    revalidatePath("/settings/tokens");
    return {
      ok: true,
      message:
        synced.ok && synced.data.ok
          ? `Active location set to '${selected.data.storeName || selected.data.displayName}'. ${synced.data.message}`
          : `Active location set to '${selected.data.storeName || selected.data.displayName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function selectGoogleAdsCustomerJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const customerId = String(formData.get("customerId") || "").trim();
    const selected = await selectGoogleAdsCustomer(session.ctx, {
      connectionId,
      customerId,
    });
    if (!selected.ok) {
      return { ok: false, message: selected.error.message };
    }
    revalidatePath("/connections");
    revalidatePath("/campaigns");
    revalidatePath("/settings/tokens");
    return {
      ok: true,
      message: `Active Google Ads account set to '${selected.data.displayName}' (${selected.data.formattedCustomerId}).`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function selectGoogleSearchConsoleSiteJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "connections:manage");
    const connectionId = String(formData.get("connectionId") || "").trim();
    const siteUrl = String(formData.get("siteUrl") || "").trim();
    const selected = selectGoogleSearchConsoleSite({
      workspaceId: session.workspace.id,
      connectionId,
      siteUrl,
    });
    revalidatePath("/connections");
    revalidatePath("/campaigns");
    return {
      ok: true,
      message: `Active Search Console property set to '${selected.siteUrl}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function selectMetaChannelAssetJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "connections:manage");
    const connectionId = String(formData.get("connectionId") || "").trim();
    const assetId = String(formData.get("assetId") || "").trim();
    const secondaryPixelRaw = formData.get("secondaryPixelId");
    const secondaryPixelId =
      secondaryPixelRaw !== null ? String(secondaryPixelRaw).trim() : undefined;

    const selected = await selectMetaChannelAsset({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      connectionId,
      assetId,
      secondaryPixelId,
    });

    revalidatePath("/connections");
    revalidatePath("/whatsapp");
    revalidatePath("/inbox");
    revalidatePath("/campaigns");
    revalidatePath("/settings/tokens");

    return {
      ok: true,
      message: `Active account switched to '${selected.displayName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function refreshMetaChannelAssetsJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "connections:manage");
    const connectionId = String(formData.get("connectionId") || "").trim();
    const refreshed = await refreshMetaChannelAssets({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      connectionId,
    });
    revalidatePath("/connections");
    return {
      ok: true,
      message: refreshed.summaryMessage,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function disconnectConnectionJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const res = await disconnectExternalConnection(session.ctx, { connectionId });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/", "layout");
    return { ok: true, message: "Channel disconnected and encrypted tokens purged." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function rotateMetaVerifyTokenJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  verifyToken?: string;
}> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "connections:manage");
    assertManualCredentialsAllowedForWorkspace(session.workspace.id);
    const verifyToken = rotateWorkspaceWebhookVerifyToken(session.workspace.id);

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "connections.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: "Rotated Meta & WhatsApp inbound webhook verify token",
    });

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      verifyToken,
      message:
        "Webhook Verify Token rotated. Paste the new token in Meta App Dashboard → Webhooks when re-verifying.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function issueApiKeyJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  rawKey?: string;
  keyName?: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to issue platform API keys.",
      };
    }
    const scopes = formData.getAll("scopes").map(String).filter(Boolean);
    const res = await issueApiKey(session.ctx, {
      name: String(formData.get("name") || ""),
      mode: String(formData.get("mode") || "live") === "test" ? "test" : "live",
      scopes:
        scopes.length > 0
          ? scopes
          : ["contacts:read", "vouchers:read", "vouchers:write", "whatsapp:write"],
      rateLimitPerMin: Number(formData.get("rateLimitPerMin") || 120),
      expiresInDays: Number(formData.get("expiresInDays") || 0),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      rawKey: res.data.rawKey,
      keyName: String(formData.get("name") || "API Key"),
      message: "New API key created - copy it from the reveal box now (shown only once).",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function rotateApiKeyJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  rawKey?: string;
  keyName?: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to rotate API keys.",
      };
    }
    const res = await rotateApiKey(session.ctx, {
      keyId: String(formData.get("keyId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      rawKey: res.data.rawKey,
      keyName: res.data.name,
      message: `Rotated '${res.data.name}' - previous key revoked and replacement key revealed once.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeApiKeyJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to manage API keys.",
      };
    }
    const res = await revokeApiKey(session.ctx, {
      keyId: String(formData.get("keyId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "API key revoked immediately." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function createOutboundWebhookJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message:
          "Developer REST API & Webhooks plan is required to configure outbound webhooks.",
      };
    }
    const events = formData.getAll("events").map(String).filter(Boolean);
    const res = await createOutboundWebhookEndpoint(session.ctx, {
      name: String(formData.get("name") || ""),
      targetUrl: String(formData.get("targetUrl") || ""),
      events: events.length > 0 ? events : ["tally.bill.created", "whatsapp.message.received"],
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "Outbound webhook endpoint saved with HMAC signing secret." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function testOutboundWebhookJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return { ok: false, message: "Developer REST API & Webhooks plan is required." };
    }
    const res = await testOutboundWebhookEndpoint(session.ctx, {
      endpointId: String(formData.get("endpointId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      message: `Test event dispatched (${res.data.deliveryStatus}) with X-RSL-Signature.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function deleteOutboundWebhookJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return { ok: false, message: "Developer REST API & Webhooks plan is required." };
    }
    const res = await deleteOutboundWebhookEndpoint(session.ctx, {
      endpointId: String(formData.get("endpointId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "Outbound webhook endpoint removed." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function provisionWorkspaceSslJsonActionImpl(): Promise<{
  ok: boolean;
  queuedJobs?: number;
  activeCount?: number;
  message: string;
}> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, ["workspace:manage", "tally:sync.manage", "apikeys:manage"]);

    const out = await enqueueWorkspaceSslProvisioning({
      workspaceId: session.workspace.id,
      workspaceSlug: session.workspace.slug,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      forceRenew: true,
      processInlineIfLocal: true,
    });

    const activeCount = out.certificates.filter((c) => c.status === "active").length;
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "workspace.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Queued & verified client SSL certificates for ${session.workspace.slug}.tally.${getEnv().PRIMARY_DOMAIN} and ${session.workspace.slug}.api.${getEnv().PRIMARY_DOMAIN}`,
    });

    revalidatePath("/tally");
    revalidatePath("/settings/business");
    revalidatePath("/developers");
    revalidatePath("/settings/tokens");

    return {
      ok: true,
      queuedJobs: out.queuedJobs,
      activeCount,
      message:
        activeCount >= 2
          ? `SSL certificates verified & active for ${out.certificates.map((c) => c.hostname).join(" and ")}.`
          : `Queued SSL certificate provisioning (${out.queuedJobs} subdomain job(s)) on ssl.provision queue.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function connectWorkspaceCloudflareOneClickJsonActionImpl(
  formData: FormData
): Promise<{
  ok: boolean;
  message: string;
  status?: WorkspaceCloudflareStatus;
}> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, [
      "connections:manage",
      "backup:destination.manage",
      "workspace:manage",
    ]);

    const apiToken = String(formData.get("apiToken") || "").trim();
    const preferredAccountId = String(formData.get("preferredAccountId") || "").trim() || undefined;
    const preferredBucketName = String(formData.get("preferredBucketName") || "").trim() || undefined;
    const autoCreateR2Bucket = formData.get("autoCreateR2Bucket") !== "false";
    const useClientR2Storage = formData.get("useClientR2Storage") !== "false";
    const useClientWorkersAi = formData.get("useClientWorkersAi") !== "false";
    const useClientWorkersCompute = formData.get("useClientWorkersCompute") !== "false";
    const aiGatewaySlug = String(formData.get("aiGatewaySlug") || "").trim() || undefined;
    const textModel = String(formData.get("textModel") || "").trim() || undefined;

    const status = await connectWorkspaceCloudflareOneClick({
      workspaceId: session.workspace.id,
      apiToken,
      preferredAccountId,
      preferredBucketName,
      autoCreateR2Bucket,
      useClientR2Storage,
      useClientWorkersAi,
      useClientWorkersCompute,
      aiGatewaySlug,
      textModel,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "connection.linked",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Connected Client Cloudflare (${status.cloudflareAccountName}) for R2 bucket '${status.r2BucketName}', Workers AI & Compute`,
    });

    revalidatePath("/connections");
    revalidatePath("/backups");
    revalidatePath("/campaigns");
    revalidatePath("/reviews");
    revalidatePath("/whatsapp");

    return {
      ok: true,
      message: `Connected ${status.cloudflareAccountName} • R2 bucket '${status.r2BucketName}' & Workers AI active on your Cloudflare account.`,
      status,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function updateWorkspaceCloudflareWorkloadsJsonActionImpl(
  formData: FormData
): Promise<{
  ok: boolean;
  message: string;
  status?: WorkspaceCloudflareStatus;
}> {
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, [
      "connections:manage",
      "backup:destination.manage",
      "workspace:manage",
    ]);

    const status = await updateWorkspaceCloudflareWorkloads({
      workspaceId: session.workspace.id,
      useClientR2Storage: formData.get("useClientR2Storage") === "true",
      useClientWorkersAi: formData.get("useClientWorkersAi") === "true",
      useClientWorkersCompute: formData.get("useClientWorkersCompute") === "true",
      r2BucketName: String(formData.get("r2BucketName") || "").trim() || undefined,
      textModel: String(formData.get("textModel") || "").trim() || undefined,
      aiGatewaySlug: String(formData.get("aiGatewaySlug") || "").trim(),
    });

    revalidatePath("/connections");
    revalidatePath("/backups");

    return {
      ok: true,
      message: `Updated Cloudflare workload routing (${status.useClientR2Storage ? "Client R2" : "RSL Storage"} • ${status.useClientWorkersAi ? "Client Workers AI" : "Platform AI"}).`,
      status,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function provisionWorkspaceCloudflareResourceJsonActionImpl(
  formData: FormData
): Promise<{
  ok: boolean;
  message: string;
  status?: WorkspaceCloudflareStatus;
}> {
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, [
      "connections:manage",
      "backup:destination.manage",
      "workspace:manage",
    ]);

    const rawType = String(formData.get("resourceType") || "r2_bucket").trim();
    const resourceType = rawType === "kv_namespace" ? "kv_namespace" : "r2_bucket";
    const resourceName = String(formData.get("resourceName") || "").trim();

    const out = await provisionWorkspaceCloudflareResource({
      workspaceId: session.workspace.id,
      resourceType,
      resourceName,
    });

    revalidatePath("/connections");
    revalidatePath("/backups");

    return {
      ok: true,
      message:
        resourceType === "r2_bucket"
          ? `Provisioned & activated Cloudflare R2 bucket '${out.resourceName}'.`
          : `Provisioned Cloudflare Workers KV namespace '${out.resourceName}'.`,
      status: out.status,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function probeWorkspaceCloudflareConnectionJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  aiSampleReply?: string;
  status?: WorkspaceCloudflareStatus;
}> {
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, [
      "connections:manage",
      "backup:destination.manage",
      "workspace:manage",
    ]);

    const res = await probeWorkspaceCloudflareConnection(session.workspace.id);
    revalidatePath("/connections");
    revalidatePath("/backups");

    return {
      ok: res.ok,
      message: res.message,
      aiSampleReply: res.aiSampleReply,
      status: res.status,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function disconnectWorkspaceCloudflareJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  status?: WorkspaceCloudflareStatus;
}> {
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, [
      "connections:manage",
      "backup:destination.manage",
      "workspace:manage",
    ]);

    const status = disconnectWorkspaceCloudflare(session.workspace.id);
    revalidatePath("/connections");
    revalidatePath("/backups");

    return {
      ok: true,
      message:
        "Disconnected your Cloudflare account. Storage & AI have reverted cleanly to RapidShift Labs platform defaults.",
      status,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}
