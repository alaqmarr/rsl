import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertSafeExternalUrl,
  decryptEnvelope,
  encryptEnvelope,
  fetchWithRetry,
  getEnv,
  newId,
  RslError,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { appendActionLog, defineAction } from "@rsl/logging";
import {
  controlDb,
  getPlatformGoogleAdsConfig,
  getPlatformGoogleOAuthConfig,
  getPlatformMetaAppConfig,
  isWorkspaceSandboxIntegrationMode,
} from "@rsl/tenancy";

export interface StoredTokenPayload {
  accessToken: string;
  refreshToken?: string;
  oauthUserToken?: string;
  issuedAt: number;
}

export interface MetaDiscoveredPageSummary {
  pageId: string;
  pageName: string;
  category?: string;
  igUserId?: string;
  igUsername?: string;
}

export interface MetaDiscoveredInstagramSummary {
  igUserId: string;
  igUsername?: string;
  name?: string;
  linkedPageId: string;
  linkedPageName?: string;
}

export interface MetaDiscoveredAdAccountSummary {
  adAccountId: string;
  name: string;
  currency?: string;
  pixelId?: string;
  availablePixels?: Array<{ pixelId: string; name: string }>;
}

export interface MetaDiscoveredWabaPhoneSummary {
  phoneNumberId: string;
  displayPhone: string;
  verifiedName: string;
  wabaId: string;
  wabaName?: string;
}

export type ConnectionChannelKind =
  | "whatsapp_cloud"
  | "facebook_page"
  | "instagram_business"
  | "meta_ads_pixel"
  | "google_ads"
  | "google_business"
  | "google_drive"
  | "google_sheets"
  | "google_search_console";

export type GoogleAdsDiscoveryStatus =
  | "verified_customers"
  | "no_customers_found"
  | "dev_token_missing"
  | "api_error"
  | "token_error";

export interface GoogleAdsCustomerSummary {
  customerId: string;
  formattedCustomerId: string;
  descriptiveName: string;
  currencyCode?: string;
  timeZone?: string;
  isManager?: boolean;
  loginCustomerId?: string;
}

export type GoogleBusinessDiscoveryStatus =
  | "verified_locations"
  | "account_only"
  | "no_locations_found"
  | "api_disabled"
  | "quota_pending"
  | "token_error";

export interface GoogleBusinessLocationSummary {
  locationId: string;
  accountId?: string;
  accountName?: string;
  accountType?: string;
  title: string;
  storeCode?: string;
  primaryCategory?: string;
  storeAddress?: string;
  storePhone?: string;
  websiteUri?: string;
  mapsUri?: string;
  newReviewUri?: string;
  placeId?: string;
  isVerified?: boolean;
}

export interface ConnectionMetadata {
  channelKind?: ConnectionChannelKind;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhone?: string;
  metaAppId?: string;
  pageId?: string;
  pageName?: string;
  igUserId?: string;
  linkedPageId?: string;
  igHandle?: string;
  adAccountId?: string;
  pixelId?: string;
  customerId?: string;
  formattedCustomerId?: string;
  loginCustomerId?: string;
  currencyCode?: string;
  timeZone?: string;
  availableAdCustomers?: GoogleAdsCustomerSummary[];
  adsDiscoveryStatus?: GoogleAdsDiscoveryStatus;
  adsDiscoveryDetail?: string;
  lastAdsDiscoveredAt?: number;
  locationId?: string;
  accountId?: string;
  accountName?: string;
  accountType?: string;
  storeName?: string;
  storeCode?: string;
  primaryCategory?: string;
  storeAddress?: string;
  storePhone?: string;
  websiteUri?: string;
  mapsUri?: string;
  newReviewUri?: string;
  placeId?: string;
  isVerifiedLocation?: boolean;
  availableLocations?: GoogleBusinessLocationSummary[];
  gbpDiscoveryStatus?: GoogleBusinessDiscoveryStatus;
  gbpDiscoveryDetail?: string;
  lastGbpDiscoveredAt?: number;
  lastReviewsSyncedAt?: number;
  totalReviewsCount?: number;
  averageRating?: number;
  googleSub?: string;
  folderId?: string;
  folderName?: string;
  folderWebViewLink?: string;
  caSpreadsheetId?: string;
  caSpreadsheetUrl?: string;
  lastCaSheetSyncedAt?: number;
  searchConsoleSiteUrl?: string;
  availableSearchConsoleSites?: string[];
  availableMetaPages?: MetaDiscoveredPageSummary[];
  availableInstagramAccounts?: MetaDiscoveredInstagramSummary[];
  availableMetaAdAccounts?: MetaDiscoveredAdAccountSummary[];
  availableWabaPhones?: MetaDiscoveredWabaPhoneSummary[];
  webhookAutoSubscribed?: boolean;
  driveEmail?: string;
  googleUserName?: string;
  oauthConnected?: boolean;
  maskedTokenHint?: string;
  tokenMode?: "live" | "sandbox";
  lastLiveCheckMessage?: string;
  lastLiveCheckedAccountName?: string;
}

export function maskSecretToken(raw: string | undefined | null): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "••••••••";
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 2)}••••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 6)}••••••••••••${trimmed.slice(-4)}`;
}

export function getOrCreateWorkspaceWebhookVerifyToken(workspaceId: string): string {
  const db = controlDb();
  const ws = db
    .select({
      id: controlSchema.workspaces.id,
      slug: controlSchema.workspaces.slug,
      webhookVerifyToken: controlSchema.workspaces.webhookVerifyToken,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();

  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Workspace not found.");
  }
  if (ws.webhookVerifyToken && ws.webhookVerifyToken.trim().length >= 8) {
    return ws.webhookVerifyToken.trim();
  }

  const slugPrefix = (ws.slug || "biz")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 10);
  const generated = `rsl_verify_${slugPrefix}_${crypto.randomBytes(10).toString("hex")}`;

  db.update(controlSchema.workspaces)
    .set({
      webhookVerifyToken: generated,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .run();

  return generated;
}

export function rotateWorkspaceWebhookVerifyToken(workspaceId: string): string {
  const db = controlDb();
  const ws = db
    .select({
      id: controlSchema.workspaces.id,
      slug: controlSchema.workspaces.slug,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();

  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Workspace not found.");
  }

  const slugPrefix = (ws.slug || "biz")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 10);
  const nextToken = `rsl_verify_${slugPrefix}_${crypto.randomBytes(12).toString("hex")}`;

  db.update(controlSchema.workspaces)
    .set({
      webhookVerifyToken: nextToken,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .run();

  return nextToken;
}

export function isValidMetaWebhookVerifyToken(candidate: string | null | undefined): boolean {
  const clean = (candidate || "").trim();
  if (!clean) return false;
  const dbMetaToken = getPlatformMetaAppConfig().webhookVerifyToken;
  if (dbMetaToken && clean === dbMetaToken) {
    return true;
  }
  const envExpected = getEnv().META_WEBHOOK_VERIFY_TOKEN;
  if (envExpected && clean === envExpected) {
    return true;
  }
  const wsMatch = controlDb()
    .select({ id: controlSchema.workspaces.id })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.webhookVerifyToken, clean))
    .get();
  return Boolean(wsMatch);
}

function inferChannelKind(
  provider: string,
  meta: ConnectionMetadata,
  assetTypes: string[]
): ConnectionChannelKind {
  if (meta.channelKind) return meta.channelKind;
  if (provider === "whatsapp" || assetTypes.includes("waba_phone")) return "whatsapp_cloud";
  if (provider === "gdrive") return "google_drive";
  if (provider === "google_sheets") return "google_sheets";
  if (provider === "google_search_console") return "google_search_console";
  if (provider === "google_ads" || assetTypes.includes("google_ad_customer")) return "google_ads";
  if (provider === "google" || assetTypes.includes("gbp_location")) return "google_business";
  if (assetTypes.includes("ig_account")) return "instagram_business";
  if (assetTypes.includes("ad_account") || assetTypes.includes("pixel")) return "meta_ads_pixel";
  return "facebook_page";
}

function parseMetadataSafe(rawJson: string | null | undefined): ConnectionMetadata {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === "object") {
      return parsed as ConnectionMetadata;
    }
  } catch {
    // ignore malformed metadata
  }
  return {};
}

export function isManualCredentialsEnabledForWorkspace(workspaceId: string): boolean {
  const row = controlDb()
    .select({ allowManualCredentials: controlSchema.workspaces.allowManualCredentials })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  return Boolean(row?.allowManualCredentials);
}

export function assertManualCredentialsAllowedForWorkspace(workspaceId: string): void {
  if (!isManualCredentialsEnabledForWorkspace(workspaceId)) {
    throw new RslError(
      "RSL-AUTH-1003",
      "Manual credential entry is disabled for this workspace. Please use 1-Click Sign-In, or contact RapidShift Support if manual token access is required."
    );
  }
}

export function staffSetWorkspaceManualCredentialsPolicy(params: {
  workspaceId: string;
  enabled: boolean;
}): { enabled: boolean } {
  const db = controlDb();
  const ws = db
    .select({ id: controlSchema.workspaces.id })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Workspace not found.");
  }

  db.update(controlSchema.workspaces)
    .set({
      allowManualCredentials: params.enabled,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();

  return { enabled: params.enabled };
}

export function listWorkspaceConnections(workspaceId: string) {
  const db = controlDb();
  const allowManualCredentials = isManualCredentialsEnabledForWorkspace(workspaceId);
  const conns = db
    .select({
      id: controlSchema.connections.id,
      provider: controlSchema.connections.provider,
      displayName: controlSchema.connections.displayName,
      externalAccountId: controlSchema.connections.externalAccountId,
      encryptedTokens: controlSchema.connections.encryptedTokens,
      scopesGrantedJson: controlSchema.connections.scopesGrantedJson,
      metadataJson: controlSchema.connections.metadataJson,
      status: controlSchema.connections.status,
      lastHealthCheckAt: controlSchema.connections.lastHealthCheckAt,
      expiresAt: controlSchema.connections.expiresAt,
      createdAt: controlSchema.connections.createdAt,
      updatedAt: controlSchema.connections.updatedAt,
    })
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.connections.createdAt))
    .all()
    .filter((c) => c.provider !== "cloudflare");

  const attachedAssets = db
    .select()
    .from(controlSchema.assets)
    .where(eq(controlSchema.assets.workspaceId, workspaceId))
    .all();

  const tallyDevices = db
    .select({
      id: controlSchema.agentDevices.id,
      deviceName: controlSchema.agentDevices.deviceName,
      osVersion: controlSchema.agentDevices.osVersion,
      agentVersion: controlSchema.agentDevices.agentVersion,
      status: controlSchema.agentDevices.status,
      tallyReachable: controlSchema.agentDevices.tallyReachable,
      tallyHost: controlSchema.agentDevices.tallyHost,
      tallyPort: controlSchema.agentDevices.tallyPort,
      activeCompanyName: controlSchema.agentDevices.activeCompanyName,
      lastHeartbeatAt: controlSchema.agentDevices.lastHeartbeatAt,
      lastSyncAt: controlSchema.agentDevices.lastSyncAt,
      lastErrorMessage: controlSchema.agentDevices.lastErrorMessage,
      revokedAt: controlSchema.agentDevices.revokedAt,
      createdAt: controlSchema.agentDevices.createdAt,
    })
    .from(controlSchema.agentDevices)
    .where(eq(controlSchema.agentDevices.workspaceId, workspaceId))
    .all()
    .filter((d) => d.revokedAt === null && d.status !== "revoked")
    .map((d) => {
      const hbAge = d.lastHeartbeatAt ? Date.now() - d.lastHeartbeatAt : Number.POSITIVE_INFINITY;
      const fresh = hbAge >= 0 && hbAge <= 120_000 && d.status !== "offline";
      return {
        ...d,
        status: !fresh ? "offline" : d.tallyReachable ? "online" : "tally_unreachable",
      };
    });

  return {
    connections: conns.map((c) => {
      const assets = attachedAssets.filter((a) => a.connectionId === c.id);
      const meta = parseMetadataSafe(c.metadataJson);
      let maskedTokenHint = meta.maskedTokenHint || "";
      if (!maskedTokenHint) {
        try {
          const decrypted = JSON.parse(decryptEnvelope(c.encryptedTokens)) as StoredTokenPayload;
          maskedTokenHint = maskSecretToken(decrypted.accessToken);
        } catch {
          maskedTokenHint = "••••••••";
        }
      }
      const channelKind = inferChannelKind(
        c.provider,
        meta,
        assets.map((a) => a.assetType)
      );

      return {
        id: c.id,
        provider: c.provider,
        channelKind,
        displayName: c.displayName,
        externalAccountId: c.externalAccountId,
        scopesGrantedJson: c.scopesGrantedJson,
        scopesGranted: JSON.parse(c.scopesGrantedJson) as string[],
        metadata: {
          ...meta,
          channelKind,
          maskedTokenHint,
        },
        maskedTokenHint,
        status: c.status,
        lastHealthCheckAt: c.lastHealthCheckAt,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        assets,
      };
    }),
    tallyDevices,
    allowManualCredentials,
  };
}

/**
 * Decrypts tokens strictly inside @rsl/connections.
 * Other packages never inspect raw encrypted blobs.
 */
export function getDecryptedConnectionTokens(workspaceId: string, connectionId: string): StoredTokenPayload | null {
  const conn = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, connectionId),
        eq(controlSchema.connections.workspaceId, workspaceId)
      )
    )
    .get();
  if (!conn) return null;
  return JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
}

function upsertRoutingEntry(provider: string, externalId: string | undefined, workspaceId: string, now: number) {
  const cleanId = (externalId || "").trim();
  if (!cleanId) return;
  controlDb()
    .insert(controlSchema.assetRouting)
    .values({
      id: newId(),
      provider,
      externalId: cleanId,
      tenantId: workspaceId,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [controlSchema.assetRouting.provider, controlSchema.assetRouting.externalId],
      set: { tenantId: workspaceId },
    })
    .run();
}

const connectionMetadataInputSchema = z
  .object({
    channelKind: z
      .enum([
        "whatsapp_cloud",
        "facebook_page",
        "instagram_business",
        "meta_ads_pixel",
        "google_ads",
        "google_business",
        "google_drive",
        "google_sheets",
        "google_search_console",
      ])
      .optional(),
    wabaId: z.string().optional(),
    phoneNumberId: z.string().optional(),
    displayPhone: z.string().optional(),
    metaAppId: z.string().optional(),
    pageId: z.string().optional(),
    pageName: z.string().optional(),
    igUserId: z.string().optional(),
    linkedPageId: z.string().optional(),
    igHandle: z.string().optional(),
    adAccountId: z.string().optional(),
    pixelId: z.string().optional(),
    customerId: z.string().optional(),
    formattedCustomerId: z.string().optional(),
    loginCustomerId: z.string().optional(),
    currencyCode: z.string().optional(),
    locationId: z.string().optional(),
    accountId: z.string().optional(),
    accountName: z.string().optional(),
    storeName: z.string().optional(),
    storeAddress: z.string().optional(),
    storePhone: z.string().optional(),
    primaryCategory: z.string().optional(),
    websiteUri: z.string().optional(),
    mapsUri: z.string().optional(),
    newReviewUri: z.string().optional(),
    placeId: z.string().optional(),
    folderId: z.string().optional(),
    driveEmail: z.string().optional(),
    caSpreadsheetId: z.string().optional(),
    caSpreadsheetUrl: z.string().optional(),
    searchConsoleSiteUrl: z.string().optional(),
  })
  .optional();

export const linkExternalConnection = defineAction({
  key: "connections.linked",
  permission: "connections:manage",
  input: z.object({
    provider: z.enum([
      "meta",
      "whatsapp",
      "google",
      "gdrive",
      "google_ads",
      "google_sheets",
      "google_search_console",
    ]),
    displayName: z.string().trim().min(2, "Enter a descriptive account label").max(120),
    externalAccountId: z.string().trim().min(2, "Enter the external Account / Phone / Page ID").max(120),
    accessToken: z.string().trim().min(6, "Paste a valid access token (at least 6 characters)"),
    refreshToken: z.string().optional(),
    scopesGranted: z.array(z.string()).default([]),
    assetType: z
      .enum([
        "fb_page",
        "ig_account",
        "ad_account",
        "pixel",
        "waba_phone",
        "gbp_location",
        "google_ad_customer",
      ])
      .optional(),
    assetName: z.string().optional(),
    metadata: connectionMetadataInputSchema,
  }),
  summarize: (input) => `Connected ${input.provider.toUpperCase()} account '${input.displayName}'`,
  handler: (ctx, input) => {
    const db = controlDb();
    const now = Date.now();
    const connectionId = newId();
    const cleanToken = input.accessToken.trim();
    const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, cleanToken);

    const encryptedTokens = encryptEnvelope(
      JSON.stringify({
        accessToken: cleanToken,
        refreshToken: input.refreshToken?.trim() || undefined,
        issuedAt: now,
      } satisfies StoredTokenPayload)
    );

    const metaObj: ConnectionMetadata = {
      ...(input.metadata ?? {}),
      maskedTokenHint: maskSecretToken(cleanToken),
      tokenMode: isSandbox ? "sandbox" : "live",
    };

    db.insert(controlSchema.connections)
      .values({
        id: connectionId,
        workspaceId: ctx.workspaceId,
        provider: input.provider,
        displayName: input.displayName.trim(),
        externalAccountId: input.externalAccountId.trim(),
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(input.scopesGranted),
        metadataJson: JSON.stringify(metaObj),
        status: "healthy",
        lastHealthCheckAt: now,
        expiresAt: now + 60 * 24 * 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Always route primary externalAccountId plus secondary channel IDs (e.g. both WABA ID & Phone Number ID)
    upsertRoutingEntry(input.provider, input.externalAccountId, ctx.workspaceId, now);
    if (metaObj.wabaId) upsertRoutingEntry("whatsapp", metaObj.wabaId, ctx.workspaceId, now);
    if (metaObj.phoneNumberId) upsertRoutingEntry("whatsapp", metaObj.phoneNumberId, ctx.workspaceId, now);
    if (metaObj.pageId) upsertRoutingEntry("meta", metaObj.pageId, ctx.workspaceId, now);
    if (metaObj.igUserId) upsertRoutingEntry("meta", metaObj.igUserId, ctx.workspaceId, now);
    if (metaObj.linkedPageId) upsertRoutingEntry("meta", metaObj.linkedPageId, ctx.workspaceId, now);

    if (input.assetType) {
      const assetLabel = (input.assetName || input.displayName).trim();
      db.insert(controlSchema.assets)
        .values({
          id: newId(),
          workspaceId: ctx.workspaceId,
          connectionId,
          provider: input.provider,
          assetType: input.assetType,
          externalId: input.externalAccountId.trim(),
          name: assetLabel,
          metadataJson: JSON.stringify(metaObj),
          active: true,
          createdAt: now,
        })
        .run();
    }

    return {
      connectionId,
      maskedTokenHint: metaObj.maskedTokenHint!,
    };
  },
});

export const updateExternalConnection = defineAction({
  key: "connections.updated",
  permission: "connections:manage",
  input: z.object({
    connectionId: z.string().min(10),
    displayName: z.string().trim().min(2).max(120).optional(),
    externalAccountId: z.string().trim().min(2).max(120).optional(),
    accessToken: z.string().trim().optional(),
    refreshToken: z.string().trim().optional(),
    scopesGranted: z.array(z.string()).optional(),
    metadata: connectionMetadataInputSchema,
  }),
  summarize: (_in, out?: { displayName: string; rotatedToken: boolean }) =>
    out?.rotatedToken
      ? `Rotated access token for '${out.displayName}'`
      : `Updated settings for '${out?.displayName ?? "connected account"}'`,
  handler: (ctx, input) => {
    const db = controlDb();
    const conn = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.id, input.connectionId),
          eq(controlSchema.connections.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!conn) {
      throw new RslError("RSL-VAL-1001", "Connected account not found.");
    }

    const now = Date.now();
    const existingMeta = parseMetadataSafe(conn.metadataJson);
    const nextMeta: ConnectionMetadata = {
      ...existingMeta,
      ...(input.metadata ?? {}),
    };

    let nextEncryptedTokens = conn.encryptedTokens;
    let rotatedToken = false;
    let nextStatus = conn.status;
    let nextExpiresAt = conn.expiresAt;

    if (input.accessToken && input.accessToken.trim().length > 0) {
      const cleanToken = input.accessToken.trim();
      if (cleanToken.length < 6) {
        throw new RslError("RSL-VAL-1001", "New access token must be at least 6 characters.");
      }
      let existingRefresh: string | undefined;
      try {
        existingRefresh = (JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload)
          .refreshToken;
      } catch {
        existingRefresh = undefined;
      }

      nextEncryptedTokens = encryptEnvelope(
        JSON.stringify({
          accessToken: cleanToken,
          refreshToken: input.refreshToken?.trim() || existingRefresh,
          issuedAt: now,
        } satisfies StoredTokenPayload)
      );
      nextMeta.maskedTokenHint = maskSecretToken(cleanToken);
      nextMeta.tokenMode = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, cleanToken)
        ? "sandbox"
        : "live";
      nextMeta.lastLiveCheckMessage = "Access token rotated and encrypted in vault.";
      rotatedToken = true;
      nextStatus = "healthy";
      nextExpiresAt = now + 60 * 24 * 60 * 60 * 1000;
    }

    const nextDisplayName = input.displayName?.trim() || conn.displayName;
    const nextExternalId = input.externalAccountId?.trim() || conn.externalAccountId;

    db.update(controlSchema.connections)
      .set({
        displayName: nextDisplayName,
        externalAccountId: nextExternalId,
        encryptedTokens: nextEncryptedTokens,
        scopesGrantedJson: input.scopesGranted
          ? JSON.stringify(input.scopesGranted)
          : conn.scopesGrantedJson,
        metadataJson: JSON.stringify(nextMeta),
        status: nextStatus,
        expiresAt: nextExpiresAt,
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, conn.id))
      .run();

    upsertRoutingEntry(conn.provider, nextExternalId, ctx.workspaceId, now);
    if (nextMeta.wabaId) upsertRoutingEntry("whatsapp", nextMeta.wabaId, ctx.workspaceId, now);
    if (nextMeta.phoneNumberId) upsertRoutingEntry("whatsapp", nextMeta.phoneNumberId, ctx.workspaceId, now);
    if (nextMeta.pageId) upsertRoutingEntry("meta", nextMeta.pageId, ctx.workspaceId, now);
    if (nextMeta.igUserId) upsertRoutingEntry("meta", nextMeta.igUserId, ctx.workspaceId, now);

    return {
      connectionId: conn.id,
      displayName: nextDisplayName,
      rotatedToken,
      maskedTokenHint: nextMeta.maskedTokenHint || "••••••••",
    };
  },
});

export const disconnectExternalConnection = defineAction({
  key: "connections.disconnected",
  permission: "connections:manage",
  input: z.object({
    connectionId: z.string().min(10),
  }),
  summarize: () => "Disconnected external account and purged stored tokens",
  handler: (ctx, input) => {
    const db = controlDb();
    const conn = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.id, input.connectionId),
          eq(controlSchema.connections.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (conn) {
      const meta = parseMetadataSafe(conn.metadataJson);
      const routingIds = [
        conn.externalAccountId,
        meta.wabaId,
        meta.phoneNumberId,
        meta.pageId,
        meta.igUserId,
        meta.linkedPageId,
      ].filter((x): x is string => Boolean(x));

      for (const extId of routingIds) {
        db.delete(controlSchema.assetRouting)
          .where(
            and(
              eq(controlSchema.assetRouting.tenantId, ctx.workspaceId),
              eq(controlSchema.assetRouting.externalId, extId)
            )
          )
          .run();
      }
      db.delete(controlSchema.connections).where(eq(controlSchema.connections.id, conn.id)).run();
    }
    return { removed: true };
  },
});

export const verifyExternalConnectionHealth = defineAction({
  key: "connections.verified",
  permission: "connections:manage",
  input: z.object({
    connectionId: z.string().min(10),
    checkLiveProvider: z.boolean().optional().default(false),
  }),
  summarize: (_in, out?: { displayName: string; status: string }) =>
    `Verified connection '${out?.displayName ?? "account"}' (${out?.status ?? "healthy"})`,
  handler: async (ctx, input) => {
    const db = controlDb();
    const conn = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.id, input.connectionId),
          eq(controlSchema.connections.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!conn) {
      throw new RslError("RSL-VAL-1001", "Connected account not found.");
    }

    const now = Date.now();
    const meta = parseMetadataSafe(conn.metadataJson);
    let nextStatus: "healthy" | "expiring" | "needs_reauth" = "healthy";
    let liveMessage = "Encrypted token verified in workspace vault.";
    let accessToken = "";

    try {
      const parsed = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
      accessToken = (parsed.accessToken || "").trim();
      if (!accessToken || accessToken.length < 6) {
        nextStatus = "needs_reauth";
        liveMessage = "Stored access token is empty or malformed - please paste a fresh token.";
      } else if (conn.expiresAt && conn.expiresAt < now) {
        nextStatus = "needs_reauth";
        liveMessage = "Access token validity window has expired - rotate with a fresh token.";
      } else if (conn.expiresAt && conn.expiresAt - now < 7 * 86_400_000) {
        nextStatus = "expiring";
        liveMessage = "Token expires within 7 days - rotate with a Permanent System User token.";
      }
    } catch {
      nextStatus = "needs_reauth";
      liveMessage = "Token envelope could not be decrypted - please re-authenticate this channel.";
    }

    if (input.checkLiveProvider && nextStatus !== "needs_reauth" && accessToken) {
      const isSandbox = isWorkspaceSandboxIntegrationMode(ctx.workspaceId, accessToken);
      if (isSandbox) {
        meta.tokenMode = "sandbox";
        liveMessage =
          "Sandbox test token verified - ready for local webhook & sandbox workflow testing.";
      } else if (conn.provider === "whatsapp" || conn.provider === "meta") {
        const graphTarget =
          meta.phoneNumberId ||
          meta.wabaId ||
          meta.igUserId ||
          meta.pageId ||
          (/^(\d+|act_\d+)$/.test(conn.externalAccountId) ? conn.externalAccountId : "me");
        try {
          const resp = await fetch(
            `https://graph.facebook.com/v21.0/${encodeURIComponent(graphTarget)}?fields=id,name`,
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              signal: AbortSignal.timeout(4500),
            }
          );
          const body = (await resp.json().catch(() => ({}))) as {
            id?: string;
            name?: string;
            error?: { message?: string; code?: number };
          };
          if (resp.ok && body.id) {
            nextStatus = "healthy";
            meta.lastLiveCheckedAccountName = body.name || body.id;
            liveMessage = `Verified live with Meta Graph API (${body.name ? `${body.name} • ID ${body.id}` : `ID ${body.id}`}).`;
          } else {
            const errCode = body.error?.code;
            const errMsg = body.error?.message || `HTTP ${resp.status}`;
            nextStatus = "needs_reauth";
            if (errCode === 190) {
              liveMessage = `Meta session expired (${errMsg}). Click 'Reconnect with Facebook' to refresh access in one click.`;
            } else if (errCode === 10 || errCode === 200 || errCode === 100) {
              liveMessage = `Meta permission or asset check failed (Code ${errCode}: ${errMsg}). Click 'Reconnect with Facebook' and ensure all business permissions are approved.`;
            } else {
              liveMessage = `Meta Graph API check failed: ${errMsg}`;
            }
          }
        } catch {
          liveMessage =
            "Vault token intact (Meta Graph API unreachable from current network; check outbound internet or firewall).";
        }
      } else if (
        conn.provider === "google" ||
        conn.provider === "gdrive" ||
        conn.provider === "google_ads"
      ) {
        try {
          const refreshed = await refreshGoogleConnectionIfNeeded(ctx.workspaceId, conn.id);
          if (refreshed) {
            accessToken = refreshed;
          }
          const resp = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
            {
              method: "GET",
              signal: AbortSignal.timeout(4500),
            }
          );
          if (resp.ok) {
            nextStatus = "healthy";
            if (conn.provider === "google") {
              const gbp = await discoverAndHydrateGoogleBusinessProfile({
                workspaceId: ctx.workspaceId,
                connectionId: conn.id,
                accessToken,
              });
              const upgradedRow = db
                .select()
                .from(controlSchema.connections)
                .where(eq(controlSchema.connections.id, conn.id))
                .get();
              if (upgradedRow) {
                Object.assign(meta, parseMetadataSafe(upgradedRow.metadataJson));
              }
              if (gbp.gbpDiscoveryStatus === "verified_locations" && gbp.storeName) {
                liveMessage = `Verified live with Google Business Profile API - ${gbp.storeName}${gbp.storeAddress ? ` (${gbp.storeAddress})` : ""}.`;
              } else if (gbp.gbpDiscoveryDetail) {
                liveMessage = gbp.gbpDiscoveryDetail;
              } else {
                liveMessage =
                  "Verified live with Google OAuth2 API (automatic refresh token active).";
              }
            } else if (conn.provider === "google_ads") {
              const gads = await discoverAndHydrateGoogleAdsAccounts({
                workspaceId: ctx.workspaceId,
                connectionId: conn.id,
                accessToken,
              });
              const upgradedRow = db
                .select()
                .from(controlSchema.connections)
                .where(eq(controlSchema.connections.id, conn.id))
                .get();
              if (upgradedRow) {
                Object.assign(meta, parseMetadataSafe(upgradedRow.metadataJson));
              }
              liveMessage =
                gads.adsDiscoveryDetail ||
                `Verified live with Google Ads OAuth2 (${gads.displayName}).`;
            } else {
              liveMessage =
                "Verified live with Google OAuth2 API (automatic refresh token active).";
            }
          } else {
            nextStatus = "needs_reauth";
            liveMessage =
              conn.provider === "google"
                ? "Google OAuth2 rejected this token. Click 'Reconnect Google' to re-authorize your Google Business Profile in one click."
                : conn.provider === "google_ads"
                  ? "Google OAuth2 rejected this token. Click 'Connect Google Ads' to re-authorize your Google Ads account in one click."
                  : "Google OAuth2 rejected this token. Click 'Reconnect Google Drive' to re-authorize your account in one click.";
          }
        } catch {
          liveMessage = "Vault token intact (Google OAuth API unreachable from current network).";
        }
      }
    }

    meta.lastLiveCheckMessage = liveMessage;
    if (!meta.maskedTokenHint && accessToken) {
      meta.maskedTokenHint = maskSecretToken(accessToken);
    }

    const freshConnRow = db
      .select({
        displayName: controlSchema.connections.displayName,
        encryptedTokens: controlSchema.connections.encryptedTokens,
        expiresAt: controlSchema.connections.expiresAt,
      })
      .from(controlSchema.connections)
      .where(eq(controlSchema.connections.id, conn.id))
      .get();

    db.update(controlSchema.connections)
      .set({
        status: nextStatus,
        encryptedTokens: freshConnRow?.encryptedTokens ?? conn.encryptedTokens,
        expiresAt: freshConnRow?.expiresAt ?? conn.expiresAt,
        metadataJson: JSON.stringify(meta),
        lastHealthCheckAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, conn.id))
      .run();

    return {
      connectionId: conn.id,
      displayName: freshConnRow?.displayName ?? conn.displayName,
      status: nextStatus,
      checkedAt: now,
      liveMessage,
    };
  },
});

/* ============================================================================
 * Automatic 1-Click Google OAuth 2.0 Consent Screen Flow (`drive.file` & GBP)
 * ============================================================================ */

export type GoogleOAuthPurpose =
  | "google_all"
  | "google_drive"
  | "google_business"
  | "google_ads"
  | "google_sheets"
  | "google_search_console";

export function generateGoogleOAuthPkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function isGoogleOAuthPurposeConfigured(purpose: GoogleOAuthPurpose = "google_drive"): boolean {
  const oauthStarted = Date.now();
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) return false;
  if (purpose === "google_all") {
    return Boolean(cfg.enableDriveOAuth || cfg.enableGbpOAuth || cfg.enableGoogleAdsOAuth);
  }
  if (purpose === "google_drive" || purpose === "google_sheets" || purpose === "google_search_console") {
    return cfg.enableDriveOAuth;
  }
  if (purpose === "google_ads") return cfg.enableGoogleAdsOAuth;
  return cfg.enableGbpOAuth;
}

export function buildGoogleOAuthAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  purpose: GoogleOAuthPurpose;
  codeChallenge?: string;
}): string {
  const oauthStarted = Date.now();
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Google 1-click sign-in is pending platform setup. Please contact your workspace administrator or try again shortly."
    );
  }
  if (params.purpose === "google_drive" && !cfg.enableDriveOAuth) {
    throw new RslError("RSL-VAL-1001", "Google Drive 1-click sign-in is currently turned off for this platform.");
  }
  if (params.purpose === "google_business" && !cfg.enableGbpOAuth) {
    throw new RslError("RSL-VAL-1001", "Google Business Profile 1-click sign-in is currently turned off for this platform.");
  }
  if (params.purpose === "google_ads" && !cfg.enableGoogleAdsOAuth) {
    throw new RslError("RSL-VAL-1001", "Google Ads 1-click sign-in is currently turned off for this platform.");
  }

  const scopes =
    params.purpose === "google_all"
      ? [
          "openid",
          "email",
          "profile",
          ...(cfg.enableDriveOAuth
            ? [
                "https://www.googleapis.com/auth/drive.file",
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/webmasters.readonly",
              ]
            : []),
          ...(cfg.enableGbpOAuth ? ["https://www.googleapis.com/auth/business.manage"] : []),
          ...(cfg.enableGoogleAdsOAuth ? ["https://www.googleapis.com/auth/adwords"] : []),
        ]
      : params.purpose === "google_drive"
      ? [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/drive.file",
        ]
      : params.purpose === "google_sheets"
        ? [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
          ]
        : params.purpose === "google_search_console"
          ? [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/webmasters.readonly",
            ]
          : params.purpose === "google_ads"
            ? [
                "openid",
                "email",
                "profile",
                "https://www.googleapis.com/auth/adwords",
              ]
            : [
                "openid",
                "email",
                "profile",
                "https://www.googleapis.com/auth/business.manage",
              ];

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  if (params.codeChallenge) {
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function refreshGoogleConnectionIfNeeded(
  workspaceId: string,
  connectionId: string
): Promise<string | null> {
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, connectionId),
        eq(controlSchema.connections.workspaceId, workspaceId)
      )
    )
    .get();
  if (!conn) return null;

  const now = Date.now();
  const reconnectCta =
    conn.provider === "google" ? "Reconnect Google" : "Connect to Google Drive";

  const markNeedsReauth = (reason: string): null => {
    const meta = parseMetadataSafe(conn.metadataJson);
    meta.lastLiveCheckMessage = reason;
    db.update(controlSchema.connections)
      .set({
        status: "needs_reauth",
        metadataJson: JSON.stringify(meta),
        lastHealthCheckAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, conn.id))
      .run();
    return null;
  };

  let stored: StoredTokenPayload;
  try {
    stored = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
  } catch {
    return markNeedsReauth(
      `Stored Google OAuth token could not be decrypted. Click '${reconnectCta}' to reconnect.`
    );
  }

  if (stored.accessToken && isWorkspaceSandboxIntegrationMode(workspaceId, stored.accessToken)) {
    return stored.accessToken;
  }

  const stillFresh = Boolean(conn.expiresAt && conn.expiresAt > now + 90_000 && stored.accessToken);
  if (stillFresh) {
    return stored.accessToken;
  }

  const alreadyExpired = Boolean(conn.expiresAt && conn.expiresAt <= now);

  if (!stored.refreshToken) {
    if (alreadyExpired || !stored.accessToken) {
      return markNeedsReauth(
        `Google access token expired and no refresh token is stored. Click '${reconnectCta}' to re-authorize.`
      );
    }
    return stored.accessToken;
  }

  const oauthStarted = Date.now();
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    if (alreadyExpired || !stored.accessToken) {
      return markNeedsReauth(
        `Google access token expired while Google OAuth credentials are unconfigured. Click '${reconnectCta}' once OAuth is active.`
      );
    }
    return stored.accessToken;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });

  let resp: Response;
  try {
    resp = await fetchWithRetry("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs: 8000,
      maxRetries: 2,
    });
  } catch (err) {
    if (alreadyExpired || !stored.accessToken) {
      return markNeedsReauth(
        `Google OAuth refresh unreachable (${err instanceof Error ? err.message : "network error"}). Click '${reconnectCta}' to reconnect.`
      );
    }
    return stored.accessToken;
  }

  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    return markNeedsReauth(
      `Google session expired or was revoked (${errBody.error_description || errBody.error || `HTTP ${resp.status}`}). Click '${reconnectCta}' to reconnect in one click.`
    );
  }

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) {
    return markNeedsReauth(
      `Google refresh did not return a fresh access token. Click '${reconnectCta}' to reconnect.`
    );
  }

  const nextRefresh = data.refresh_token || stored.refreshToken;
  const nextExpiresAt = now + Math.max(300, Number(data.expires_in || 3599)) * 1000;
  const nextEncrypted = encryptEnvelope(
    JSON.stringify({
      accessToken: data.access_token,
      refreshToken: nextRefresh,
      issuedAt: now,
    } satisfies StoredTokenPayload)
  );

  const meta = parseMetadataSafe(conn.metadataJson);
  meta.maskedTokenHint = maskSecretToken(data.access_token);

  db.update(controlSchema.connections)
    .set({
      encryptedTokens: nextEncrypted,
      expiresAt: nextExpiresAt,
      status: "healthy",
      metadataJson: JSON.stringify(meta),
      updatedAt: now,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  return data.access_token;
}

async function ensureGoogleDriveBackupFolder(
  accessToken: string,
  desiredFolderName: string
): Promise<{ folderId: string; folderName: string; webViewLink?: string }> {
  const safeName = desiredFolderName.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${safeName}'`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=5`;

  const searchResp = await fetch(searchUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });

  if (searchResp.ok) {
    const found = (await searchResp.json()) as {
      files?: Array<{ id: string; name: string; webViewLink?: string }>;
    };
    const first = found.files?.[0];
    if (first?.id) {
      return {
        folderId: first.id,
        folderName: first.name || desiredFolderName,
        webViewLink: first.webViewLink,
      };
    }
  }

  const createResp = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: desiredFolderName,
        mimeType: "application/vnd.google-apps.folder",
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!createResp.ok) {
    const errTxt = await createResp.text().catch(() => "");
    throw new RslError(
      "RSL-SYS-1001",
      `Google Drive signed in, but creating backup folder failed (${createResp.status}). Verify 'Google Drive API' is enabled in your Google Cloud project. ${errTxt.slice(0, 180)}`
    );
  }

  const created = (await createResp.json()) as {
    id: string;
    name?: string;
    webViewLink?: string;
  };
  return {
    folderId: created.id,
    folderName: created.name || desiredFolderName,
    webViewLink: created.webViewLink,
  };
}

export async function completeGoogleOAuthConnection(params: {
  workspaceId: string;
  actorId: string;
  code: string;
  redirectUri: string;
  purpose: GoogleOAuthPurpose;
  codeVerifier?: string;
}): Promise<{
  connectionId: string;
  email: string;
  displayName: string;
  folderName?: string;
  locationId?: string;
  storeName?: string;
  gbpDiscoveryStatus?: GoogleBusinessDiscoveryStatus;
  gbpDiscoveryDetail?: string;
  customerId?: string;
  formattedCustomerId?: string;
  adsDiscoveryStatus?: GoogleAdsDiscoveryStatus;
  adsDiscoveryDetail?: string;
  connectedLabels?: string[];
  summaryMessage?: string;
}> {
  const oauthStarted = Date.now();
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Google 1-click sign-in is pending platform setup. Please try again shortly."
    );
  }

  const tokenParams = new URLSearchParams({
    code: params.code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
  });

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
    signal: AbortSignal.timeout(10000),
  });

  const tokenData = (await tokenResp.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResp.ok || !tokenData.access_token) {
    throw new RslError(
      "RSL-VAL-1001",
      `Google OAuth token exchange failed: ${tokenData.error_description || tokenData.error || `HTTP ${tokenResp.status}`}. Check that Authorized Redirect URI '${params.redirectUri}' is added in Google Cloud Console.`
    );
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;
  const expiresInSec = Math.max(300, Number(tokenData.expires_in || 3599));
  const scopesGranted = (tokenData.scope || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Fetch Google user email & name
  let email = "connected-account@gmail.com";
  let googleUserName = "Google Account";
  let googleSub = "";
  try {
    const userResp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (userResp.ok) {
      const u = (await userResp.json()) as { email?: string; name?: string; sub?: string };
      if (u.email) email = u.email;
      if (u.name) googleUserName = u.name;
      if (u.sub) googleSub = u.sub;
    }
  } catch {
    // non-fatal
  }

  const db = controlDb();
  const now = Date.now();
  const metaOAuthStarted = now;
  const expiresAt = now + expiresInSec * 1000;

  const persistSinglePurpose = async (
    targetPurpose: Exclude<GoogleOAuthPurpose, "google_all">
  ): Promise<{
    connectionId: string;
    email: string;
    displayName: string;
    folderName?: string;
    locationId?: string;
    storeName?: string;
    gbpDiscoveryStatus?: GoogleBusinessDiscoveryStatus;
    gbpDiscoveryDetail?: string;
    customerId?: string;
    formattedCustomerId?: string;
    adsDiscoveryStatus?: GoogleAdsDiscoveryStatus;
    adsDiscoveryDetail?: string;
  }> => {
  if (targetPurpose === "google_drive") {
    const folder = await ensureGoogleDriveBackupFolder(accessToken, cfg.defaultDriveFolderName);

    const existing = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, params.workspaceId),
          eq(controlSchema.connections.provider, "gdrive")
        )
      )
      .get();

    let preservedRefresh = refreshToken;
    if (!preservedRefresh && existing) {
      try {
        preservedRefresh = (
          JSON.parse(decryptEnvelope(existing.encryptedTokens)) as StoredTokenPayload
        ).refreshToken;
      } catch {
        preservedRefresh = undefined;
      }
    }

    const encryptedTokens = encryptEnvelope(
      JSON.stringify({
        accessToken,
        refreshToken: preservedRefresh,
        issuedAt: now,
      } satisfies StoredTokenPayload)
    );

    const displayName = `Google Drive (${email})`;
    const meta: ConnectionMetadata = {
      channelKind: "google_drive",
      driveEmail: email,
      googleUserName,
      folderId: folder.folderId,
      folderName: folder.folderName,
      folderWebViewLink: folder.webViewLink,
      oauthConnected: true,
      maskedTokenHint: maskSecretToken(accessToken),
      tokenMode: "live",
      lastLiveCheckMessage: `Connected via Google Consent Screen (${email}) • Folder '${folder.folderName}' ready.`,
      lastLiveCheckedAccountName: email,
    };

    const connectionId = existing?.id ?? newId();
    if (existing) {
      db.update(controlSchema.connections)
        .set({
          displayName,
          externalAccountId: folder.folderId,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(meta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(controlSchema.connections.id, existing.id))
        .run();
    } else {
      db.insert(controlSchema.connections)
        .values({
          id: connectionId,
          workspaceId: params.workspaceId,
          provider: "gdrive",
          displayName,
          externalAccountId: folder.folderId,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(meta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // Also register/update backup_destinations so /backups reflects automatic Drive sync
    const existingDest = db
      .select()
      .from(controlSchema.backupDestinations)
      .where(
        and(
          eq(controlSchema.backupDestinations.workspaceId, params.workspaceId),
          eq(controlSchema.backupDestinations.provider, "gdrive")
        )
      )
      .get();

    const destConfigEnc = encryptEnvelope(
      JSON.stringify({
        connectionId,
        folderId: folder.folderId,
        folderName: folder.folderName,
        driveEmail: email,
      })
    );

    if (existingDest) {
      db.update(controlSchema.backupDestinations)
        .set({
          name: `Google Drive - ${email}`,
          encryptedConfig: destConfigEnc,
          status: "healthy",
          consecutiveFailures: 0,
          lastValidatedAt: now,
        })
        .where(eq(controlSchema.backupDestinations.id, existingDest.id))
        .run();
    } else {
      db.insert(controlSchema.backupDestinations)
        .values({
          id: newId(),
          workspaceId: params.workspaceId,
          name: `Google Drive - ${email}`,
          provider: "gdrive",
          encryptedConfig: destConfigEnc,
          schedule: "daily",
          retentionCount: 14,
          encryptionMode: "platform",
          status: "healthy",
          consecutiveFailures: 0,
          lastValidatedAt: now,
          createdAt: now,
        })
        .run();
    }

    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: "user",
      actorId: params.actorId,
      source: "web",
      action: "connections.linked",
      outcome: "success",
      requestId: newId(),
      correlationId: newId(),
      durationMs: Date.now() - oauthStarted,
      summary: `Connected Google Drive (${email}) via OAuth Consent Screen - folder '${folder.folderName}' ready`,
    });

    return {
      connectionId,
      email,
      displayName,
      folderName: folder.folderName,
    };
  }

  if (targetPurpose === "google_sheets" || targetPurpose === "google_search_console") {
    const providerKey = targetPurpose;
    const existingTool = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, params.workspaceId),
          eq(controlSchema.connections.provider, providerKey)
        )
      )
      .get();

    const existingMeta = parseMetadataSafe(existingTool?.metadataJson);
    let preservedRefresh = refreshToken;
    if (!preservedRefresh && existingTool) {
      try {
        preservedRefresh = (
          JSON.parse(decryptEnvelope(existingTool.encryptedTokens)) as StoredTokenPayload
        ).refreshToken;
      } catch {
        preservedRefresh = undefined;
      }
    }

    const encryptedTokens = encryptEnvelope(
      JSON.stringify({
        accessToken,
        refreshToken: preservedRefresh,
        issuedAt: now,
      } satisfies StoredTokenPayload)
    );

    let searchConsoleSiteUrl = existingMeta.searchConsoleSiteUrl;
    let availableSearchConsoleSites = existingMeta.availableSearchConsoleSites;
    if (targetPurpose === "google_search_console") {
      try {
        const sitesResp = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(7000),
        });
        if (sitesResp.ok) {
          const sitesJson = (await sitesResp.json()) as {
            siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
          };
          const sites = (sitesJson.siteEntry ?? [])
            .map((s) => (s.siteUrl || "").trim())
            .filter(Boolean);
          availableSearchConsoleSites = sites;
          if (!searchConsoleSiteUrl && sites.length > 0) {
            searchConsoleSiteUrl = sites[0];
          }
        }
      } catch {
        // non-fatal
      }
    }

    const displayName =
      targetPurpose === "google_sheets"
        ? `Google Sheets CA Sync (${email})`
        : searchConsoleSiteUrl
          ? `Google Search Console (${searchConsoleSiteUrl})`
          : `Google Search Console (${email})`;

    const meta: ConnectionMetadata = {
      ...existingMeta,
      channelKind: targetPurpose,
      driveEmail: email,
      googleUserName,
      googleSub: googleSub || existingMeta.googleSub || undefined,
      searchConsoleSiteUrl,
      availableSearchConsoleSites,
      oauthConnected: true,
      maskedTokenHint: maskSecretToken(accessToken),
      tokenMode: "live",
      lastLiveCheckMessage:
        targetPurpose === "google_sheets"
          ? `Connected Google Sheets CA Export (${email})`
          : `Connected Google Search Console (${searchConsoleSiteUrl || email})`,
      lastLiveCheckedAccountName: email,
    };

    const connectionId = existingTool?.id ?? newId();
    if (existingTool) {
      db.update(controlSchema.connections)
        .set({
          displayName,
          externalAccountId: searchConsoleSiteUrl || email,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(meta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(controlSchema.connections.id, existingTool.id))
        .run();
    } else {
      db.insert(controlSchema.connections)
        .values({
          id: connectionId,
          workspaceId: params.workspaceId,
          provider: providerKey,
          displayName,
          externalAccountId: searchConsoleSiteUrl || email,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(meta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: "user",
      actorId: params.actorId,
      source: "web",
      action: "connections.linked",
      outcome: "success",
      requestId: newId(),
      correlationId: newId(),
      durationMs: Date.now() - oauthStarted,
      summary: `Connected ${displayName} via OAuth Consent Screen`,
    });

    return {
      connectionId,
      email,
      displayName,
    };
  }

  if (targetPurpose === "google_ads") {
    const existingAds = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, params.workspaceId),
          eq(controlSchema.connections.provider, "google_ads")
        )
      )
      .get();

    const existingMeta = parseMetadataSafe(existingAds?.metadataJson);
    let preservedRefresh = refreshToken;
    if (!preservedRefresh && existingAds) {
      try {
        preservedRefresh = (
          JSON.parse(decryptEnvelope(existingAds.encryptedTokens)) as StoredTokenPayload
        ).refreshToken;
      } catch {
        preservedRefresh = undefined;
      }
    }

    const encryptedTokens = encryptEnvelope(
      JSON.stringify({
        accessToken,
        refreshToken: preservedRefresh,
        issuedAt: now,
      } satisfies StoredTokenPayload)
    );

    const wsRow = db
      .select({ name: controlSchema.workspaces.name })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();

    const initialExtId = existingMeta.customerId || email || googleSub;
    const initialDisplayName =
      existingMeta.accountName || wsRow?.name || `Google Ads (${email})`;

    const initialMeta: ConnectionMetadata = {
      ...existingMeta,
      channelKind: "google_ads",
      driveEmail: email,
      googleUserName,
      googleSub: googleSub || existingMeta.googleSub || undefined,
      oauthConnected: true,
      maskedTokenHint: maskSecretToken(accessToken),
      tokenMode: "live",
    };

    const connectionId = existingAds?.id ?? newId();
    if (existingAds) {
      db.update(controlSchema.connections)
        .set({
          displayName: initialDisplayName,
          externalAccountId: initialExtId,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(initialMeta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(controlSchema.connections.id, existingAds.id))
        .run();
    } else {
      db.insert(controlSchema.connections)
        .values({
          id: connectionId,
          workspaceId: params.workspaceId,
          provider: "google_ads",
          displayName: initialDisplayName,
          externalAccountId: initialExtId,
          encryptedTokens,
          scopesGrantedJson: JSON.stringify(scopesGranted),
          metadataJson: JSON.stringify(initialMeta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const hydratedAds = await discoverAndHydrateGoogleAdsAccounts({
      workspaceId: params.workspaceId,
      connectionId,
      accessToken,
      preferredCustomerId: existingMeta.customerId,
    });

    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: "user",
      actorId: params.actorId,
      source: "web",
      action: "connections.linked",
      outcome: "success",
      requestId: newId(),
      correlationId: newId(),
      durationMs: Date.now() - oauthStarted,
      summary: hydratedAds.formattedCustomerId
        ? `Connected Google Ads Account '${hydratedAds.displayName}' (${hydratedAds.formattedCustomerId})`
        : `Connected Google Ads (${email}) via OAuth Consent Screen`,
    });

    return {
      connectionId,
      email,
      displayName: hydratedAds.displayName,
      customerId: hydratedAds.customerId,
      formattedCustomerId: hydratedAds.formattedCustomerId,
      adsDiscoveryStatus: hydratedAds.adsDiscoveryStatus,
      adsDiscoveryDetail: hydratedAds.adsDiscoveryDetail,
    };
  }

  // Google Business Profile (`google_business`) OAuth persistence + full multi-account discovery
  const existingGbp = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "google")
      )
    )
    .get();

  const existingMeta = parseMetadataSafe(existingGbp?.metadataJson);

  let preservedRefresh = refreshToken;
  if (!preservedRefresh && existingGbp) {
    try {
      preservedRefresh = (
        JSON.parse(decryptEnvelope(existingGbp.encryptedTokens)) as StoredTokenPayload
      ).refreshToken;
    } catch {
      preservedRefresh = undefined;
    }
  }

  const encryptedTokens = encryptEnvelope(
    JSON.stringify({
      accessToken,
      refreshToken: preservedRefresh,
      issuedAt: now,
    } satisfies StoredTokenPayload)
  );

  const wsRow = db
    .select({ name: controlSchema.workspaces.name })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const initialExtId = existingMeta.locationId || existingMeta.accountId || email || googleSub;
  const initialDisplayName =
    existingMeta.storeName || wsRow?.name || `Google Business (${email})`;

  const initialMeta: ConnectionMetadata = {
    ...existingMeta,
    channelKind: "google_business",
    driveEmail: email,
    googleUserName,
    googleSub: googleSub || existingMeta.googleSub || undefined,
    oauthConnected: true,
    maskedTokenHint: maskSecretToken(accessToken),
    tokenMode: "live",
  };

  const connectionId = existingGbp?.id ?? newId();
  if (existingGbp) {
    db.update(controlSchema.connections)
      .set({
        displayName: initialDisplayName,
        externalAccountId: initialExtId,
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(scopesGranted),
        metadataJson: JSON.stringify(initialMeta),
        status: "healthy",
        lastHealthCheckAt: now,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, existingGbp.id))
      .run();
  } else {
    db.insert(controlSchema.connections)
      .values({
        id: connectionId,
        workspaceId: params.workspaceId,
        provider: "google",
        displayName: initialDisplayName,
        externalAccountId: initialExtId,
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(scopesGranted),
        metadataJson: JSON.stringify(initialMeta),
        status: "healthy",
        lastHealthCheckAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const hydrated = await discoverAndHydrateGoogleBusinessProfile({
    workspaceId: params.workspaceId,
    connectionId,
    accessToken,
    preferredLocationId: existingMeta.locationId,
  });

  appendActionLog({
    workspaceId: params.workspaceId,
    actorType: "user",
    actorId: params.actorId,
    source: "web",
    action: "connections.linked",
    outcome: "success",
    requestId: newId(),
    correlationId: newId(),
    durationMs: Date.now() - oauthStarted,
    summary: hydrated.storeName
      ? `Connected Google Business Profile '${hydrated.storeName}' (${email})`
      : `Connected Google Business Profile (${email}) via OAuth Consent Screen`,
  });

  return {
    connectionId,
    email,
    displayName: hydrated.displayName,
    locationId: hydrated.locationId,
    storeName: hydrated.storeName,
    gbpDiscoveryStatus: hydrated.gbpDiscoveryStatus,
    gbpDiscoveryDetail: hydrated.gbpDiscoveryDetail,
  };
  };

  if (params.purpose === "google_all") {
    const suiteTargets: Array<Exclude<GoogleOAuthPurpose, "google_all">> = [];
    if (cfg.enableGbpOAuth) suiteTargets.push("google_business");
    if (cfg.enableGoogleAdsOAuth) suiteTargets.push("google_ads");
    if (cfg.enableDriveOAuth) {
      suiteTargets.push("google_drive", "google_sheets", "google_search_console");
    }

    const connectedLabels: string[] = [];
    let primaryConnId = "";
    let primaryDisplay = `Google Suite (${email})`;
    for (const tgt of suiteTargets) {
      try {
        const out = await persistSinglePurpose(tgt);
        if (!primaryConnId) {
          primaryConnId = out.connectionId;
          primaryDisplay = out.displayName;
        }
        connectedLabels.push(out.displayName);
      } catch {
        // Isolate individual Google API failures so remaining channels still connect cleanly
      }
    }

    const summaryMessage =
      connectedLabels.length > 0
        ? `Connected ${connectedLabels.length} Google channel(s) (${email}): ${connectedLabels.join(" • ")}`
        : `Signed in with Google (${email}), but no Google channels could be activated yet.`;

    return {
      connectionId: primaryConnId || newId(),
      email,
      displayName: primaryDisplay,
      connectedLabels,
      summaryMessage,
    };
  }

  return persistSinglePurpose(params.purpose);
}

export function selectGoogleSearchConsoleSite(params: {
  workspaceId: string;
  connectionId: string;
  siteUrl: string;
}): { displayName: string; siteUrl: string } {
  const switchStarted = Date.now();
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, params.connectionId),
        eq(controlSchema.connections.workspaceId, params.workspaceId)
      )
    )
    .get();
  if (!conn) {
    throw new RslError("RSL-VAL-1001", "Google Search Console connection not found.");
  }

  const nextSite = params.siteUrl.trim();
  if (!nextSite) {
    throw new RslError("RSL-VAL-1001", "Select a valid Search Console website property.");
  }
  if (!/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(nextSite)) {
    let parsedSite: URL;
    try {
      parsedSite = new URL(nextSite);
    } catch {
      throw new RslError("RSL-VAL-1001", "Search Console property must be a valid https:// URL or sc-domain:example.com.");
    }
    if (parsedSite.protocol !== "https:" && parsedSite.protocol !== "http:") {
      throw new RslError("RSL-VAL-1001", "Search Console property must use https:// or sc-domain:.");
    }
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  const displayName = `Google Search Console (${nextSite})`;
  const nextMeta: ConnectionMetadata = {
    ...meta,
    searchConsoleSiteUrl: nextSite,
    lastLiveCheckMessage: `Active Search Console property: ${nextSite}`,
  };

  db.update(controlSchema.connections)
    .set({
      displayName,
      externalAccountId: nextSite,
      metadataJson: JSON.stringify(nextMeta),
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  return { displayName, siteUrl: nextSite };
}

interface RawGbpPostalAddress {
  addressLines?: string[];
  sublocality?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  regionCode?: string;
}

interface RawGbpLocationPayload {
  name?: string;
  title?: string;
  locationName?: string;
  storeCode?: string;
  websiteUri?: string;
  websiteUrl?: string;
  primaryPhone?: string;
  phoneNumbers?: {
    primaryPhone?: string;
    additionalPhones?: string[];
  };
  categories?: {
    primaryCategory?: { displayName?: string; name?: string };
  };
  primaryCategory?: { displayName?: string; name?: string };
  storefrontAddress?: RawGbpPostalAddress;
  address?: RawGbpPostalAddress;
  metadata?: {
    mapsUri?: string;
    mapsUrl?: string;
    newReviewUri?: string;
    newReviewUrl?: string;
    placeId?: string;
    hasVoiceOfMerchant?: boolean;
  };
  locationState?: {
    isVerified?: boolean;
  };
}

function formatGoogleStorefrontAddress(addr?: RawGbpPostalAddress): string | undefined {
  if (!addr) return undefined;
  const parts: string[] = [];
  if (Array.isArray(addr.addressLines)) {
    for (const line of addr.addressLines) {
      const clean = (line || "").trim();
      if (clean) parts.push(clean);
    }
  }
  for (const field of [addr.sublocality, addr.locality, addr.administrativeArea, addr.postalCode]) {
    const clean = (field || "").trim();
    if (clean && !parts.includes(clean)) {
      parts.push(clean);
    }
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function normalizeGbpLocationResource(rawName: string | undefined): {
  locationId: string;
  embeddedAccountId?: string;
} {
  const clean = (rawName || "").trim();
  if (!clean) return { locationId: "" };
  const fullMatch = clean.match(/^(accounts\/[^/]+)\/(locations\/[^/]+)$/i);
  if (fullMatch) {
    return {
      embeddedAccountId: fullMatch[1]!,
      locationId: fullMatch[2]!,
    };
  }
  if (clean.startsWith("locations/")) {
    return { locationId: clean };
  }
  return { locationId: `locations/${clean}` };
}

function parseGbpLocationObject(
  raw: RawGbpLocationPayload,
  parentAccount?: { accountId?: string; accountName?: string; accountType?: string }
): GoogleBusinessLocationSummary | null {
  const { locationId, embeddedAccountId } = normalizeGbpLocationResource(raw.name);
  if (!locationId) return null;
  const title = (raw.title || raw.locationName || "").trim();
  if (!title) return null;

  const primaryCategory =
    raw.categories?.primaryCategory?.displayName?.trim() ||
    raw.primaryCategory?.displayName?.trim() ||
    undefined;
  const storePhone =
    raw.phoneNumbers?.primaryPhone?.trim() || raw.primaryPhone?.trim() || undefined;
  const storeAddress = formatGoogleStorefrontAddress(raw.storefrontAddress || raw.address);
  const websiteUri = (raw.websiteUri || raw.websiteUrl || "").trim() || undefined;
  const mapsUri = (raw.metadata?.mapsUri || raw.metadata?.mapsUrl || "").trim() || undefined;
  const newReviewUri =
    (raw.metadata?.newReviewUri || raw.metadata?.newReviewUrl || "").trim() || undefined;
  const placeId = (raw.metadata?.placeId || "").trim() || undefined;
  const isVerified =
    typeof raw.metadata?.hasVoiceOfMerchant === "boolean"
      ? raw.metadata.hasVoiceOfMerchant
      : typeof raw.locationState?.isVerified === "boolean"
        ? raw.locationState.isVerified
        : undefined;

  return {
    locationId,
    accountId: parentAccount?.accountId || embeddedAccountId,
    accountName: parentAccount?.accountName,
    accountType: parentAccount?.accountType,
    title,
    storeCode: raw.storeCode?.trim() || undefined,
    primaryCategory,
    storeAddress,
    storePhone,
    websiteUri,
    mapsUri,
    newReviewUri:
      newReviewUri ||
      (placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : undefined),
    placeId,
    isVerified,
  };
}

function classifyGoogleGbpErrorResponse(
  httpStatus: number,
  bodyText: string,
  apiLabel: string,
  emailHint: string
): {
  status: GoogleBusinessDiscoveryStatus;
  detail: string;
} {
  let errMessage = "";
  let errStatus = "";
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; status?: string; code?: number };
    };
    errMessage = parsed.error?.message || "";
    errStatus = parsed.error?.status || "";
  } catch {
    errMessage = bodyText.slice(0, 200);
  }

  const combined = `${errStatus} ${errMessage}`.toLowerCase();
  if (httpStatus === 401 || combined.includes("unauthenticated") || combined.includes("invalid credentials")) {
    return {
      status: "token_error",
      detail: `Google rejected the OAuth access token for ${emailHint || "this account"}. Click 'Reconnect Google' to re-authorize your Google Business Profile.`,
    };
  }

  if (
    httpStatus === 429 ||
    combined.includes("resource_exhausted") ||
    combined.includes("rate_limit_exceeded") ||
    combined.includes("quota exceeded") ||
    combined.includes("requests per minute")
  ) {
    return {
      status: "quota_pending",
      detail: `Google Sign-In (${emailHint || "connected"}) is active, but Google Cloud returned 0 QPM quota on ${apiLabel}. Request free GBP API quota activation at developers.google.com/my-business/content/prereqs, then click 'Sync Business Profile'.`,
    };
  }

  if (
    httpStatus === 403 &&
    (combined.includes("has not been used in project") ||
      combined.includes("is disabled") ||
      combined.includes("accessnotconfigured") ||
      combined.includes("service_disabled"))
  ) {
    return {
      status: "api_disabled",
      detail: `Google Sign-In (${emailHint || "connected"}) succeeded, but '${apiLabel}' is not enabled yet in Google Cloud Console. Enable 'My Business Account Management API', 'My Business Business Information API', and 'Google My Business API', then click 'Sync Business Profile'.`,
    };
  }

  return {
    status: httpStatus === 403 ? "api_disabled" : "token_error",
    detail: `Google Business API (${apiLabel}) returned HTTP ${httpStatus}${errMessage ? `: ${errMessage.slice(0, 180)}` : ""}.`,
  };
}

const GBP_LOCATIONS_READ_MASK_FULL =
  "name,title,storeCode,categories,phoneNumbers,storefrontAddress,websiteUri,metadata";
const GBP_LOCATIONS_READ_MASK_MINIMAL =
  "name,title,storefrontAddress,phoneNumbers,websiteUri,metadata";

async function fetchGbpV1LocationsForParent(
  accessToken: string,
  parentResource: string
): Promise<{
  ok: boolean;
  httpStatus: number;
  bodyText: string;
  locations: RawGbpLocationPayload[];
}> {
  const tryMask = async (mask: string) => {
    const resp = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${parentResource}/locations?readMask=${encodeURIComponent(mask)}&pageSize=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(6500),
      }
    );
    const txt = await resp.text().catch(() => "");
    return { resp, txt };
  };

  let { resp, txt } = await tryMask(GBP_LOCATIONS_READ_MASK_FULL);
  if (resp.status === 400) {
    ({ resp, txt } = await tryMask(GBP_LOCATIONS_READ_MASK_MINIMAL));
  }

  if (!resp.ok) {
    return { ok: false, httpStatus: resp.status, bodyText: txt, locations: [] };
  }

  try {
    const parsed = JSON.parse(txt) as { locations?: RawGbpLocationPayload[] };
    return {
      ok: true,
      httpStatus: resp.status,
      bodyText: txt,
      locations: Array.isArray(parsed.locations) ? parsed.locations : [],
    };
  } catch {
    return { ok: true, httpStatus: resp.status, bodyText: txt, locations: [] };
  }
}

export async function discoverAndHydrateGoogleBusinessProfile(params: {
  workspaceId: string;
  connectionId?: string;
  accessToken?: string;
  preferredLocationId?: string;
}): Promise<{
  connected: boolean;
  connectionId?: string;
  displayName: string;
  storeName?: string;
  accountId?: string;
  accountName?: string;
  locationId?: string;
  storeAddress?: string;
  storePhone?: string;
  primaryCategory?: string;
  websiteUri?: string;
  mapsUri?: string;
  newReviewUri?: string;
  availableLocations: GoogleBusinessLocationSummary[];
  gbpDiscoveryStatus: GoogleBusinessDiscoveryStatus;
  gbpDiscoveryDetail?: string;
}> {
  const db = controlDb();
  const ws = db
    .select({
      id: controlSchema.workspaces.id,
      name: controlSchema.workspaces.name,
      addressLine: controlSchema.workspaces.addressLine,
      city: controlSchema.workspaces.city,
      pincode: controlSchema.workspaces.pincode,
      businessPhone: controlSchema.workspaces.businessPhone,
      website: controlSchema.workspaces.website,
      industry: controlSchema.workspaces.industry,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const conn = params.connectionId
    ? db
        .select()
        .from(controlSchema.connections)
        .where(
          and(
            eq(controlSchema.connections.id, params.connectionId),
            eq(controlSchema.connections.workspaceId, params.workspaceId)
          )
        )
        .get()
    : db
        .select()
        .from(controlSchema.connections)
        .where(
          and(
            eq(controlSchema.connections.workspaceId, params.workspaceId),
            eq(controlSchema.connections.provider, "google")
          )
        )
        .get();

  if (!conn) {
    return {
      connected: false,
      displayName: ws?.name || "Google Business",
      availableLocations: [],
      gbpDiscoveryStatus: "no_locations_found",
      gbpDiscoveryDetail: "Google Business Profile is not connected yet.",
    };
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  const emailHint = meta.driveEmail || "";

  let token = params.accessToken || "";
  if (!token) {
    token = (await refreshGoogleConnectionIfNeeded(params.workspaceId, conn.id)) || "";
  }

  if (!token) {
    return {
      connected: true,
      connectionId: conn.id,
      displayName: conn.displayName,
      availableLocations: meta.availableLocations ?? [],
      gbpDiscoveryStatus: "token_error",
      gbpDiscoveryDetail:
        "Google OAuth session expired or could not be refreshed. Click 'Reconnect Google' to sign in again.",
    };
  }

  // Sandbox tokens bypass external HTTP calls cleanly
  if (isWorkspaceSandboxIntegrationMode(params.workspaceId, token)) {
    const sandboxTitle = meta.storeName || ws?.name || conn.displayName;
    const sandboxLocId =
      meta.locationId ||
      (conn.externalAccountId.startsWith("locations/")
        ? conn.externalAccountId
        : "locations/sandbox_primary");
    const now = Date.now();
    meta.storeName = sandboxTitle;
    meta.locationId = sandboxLocId;
    meta.gbpDiscoveryStatus = "verified_locations";
    meta.lastGbpDiscoveredAt = now;
    db.update(controlSchema.connections)
      .set({
        displayName: sandboxTitle,
        externalAccountId: sandboxLocId,
        metadataJson: JSON.stringify(meta),
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, conn.id))
      .run();
    return {
      connected: true,
      connectionId: conn.id,
      displayName: sandboxTitle,
      storeName: sandboxTitle,
      locationId: sandboxLocId,
      availableLocations: [
        {
          locationId: sandboxLocId,
          accountId: meta.accountId,
          title: sandboxTitle,
        },
      ],
      gbpDiscoveryStatus: "verified_locations",
    };
  }

  const locationMap = new Map<string, GoogleBusinessLocationSummary>();
  const mergeLocation = (loc: GoogleBusinessLocationSummary | null) => {
    if (!loc) return;
    const prev = locationMap.get(loc.locationId);
    if (!prev) {
      locationMap.set(loc.locationId, loc);
      return;
    }
    locationMap.set(loc.locationId, {
      ...prev,
      ...Object.fromEntries(
        Object.entries(loc).filter(([, v]) => v !== undefined && v !== "")
      ),
    } as GoogleBusinessLocationSummary);
  };

  interface DiscoveredGbpAccount {
    name: string;
    accountName?: string;
    type?: string;
  }
  const discoveredAccounts: DiscoveredGbpAccount[] = [];
  let diagnosticFailure: { status: GoogleBusinessDiscoveryStatus; detail: string } | null = null;
  let anyGbpApiSucceeded = false;

  // 1. Account Management API v1 - iterate ALL accounts (PERSONAL, LOCATION_GROUP, ORGANIZATION)
  try {
    const accResp = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6500),
      }
    );
    const accTxt = await accResp.text().catch(() => "");
    if (accResp.ok) {
      anyGbpApiSucceeded = true;
      const accBody = JSON.parse(accTxt || "{}") as {
        accounts?: Array<{ name?: string; accountName?: string; type?: string }>;
      };
      for (const acc of accBody.accounts ?? []) {
        if (acc.name) {
          discoveredAccounts.push({
            name: acc.name,
            accountName: acc.accountName?.trim() || undefined,
            type: acc.type?.trim() || undefined,
          });
        }
      }
    } else {
      diagnosticFailure = classifyGoogleGbpErrorResponse(
        accResp.status,
        accTxt,
        "My Business Account Management API",
        emailHint
      );
    }
  } catch {
    // Network timeout on v1 accounts; continue to wildcard locations & v4 fallback
  }

  // 2. Wildcard Business Information API v1 (`accounts/-/locations`) - finds locations across ALL account groups
  try {
    const wildcardRes = await fetchGbpV1LocationsForParent(token, "accounts/-");
    if (wildcardRes.ok) {
      anyGbpApiSucceeded = true;
      for (const rawLoc of wildcardRes.locations) {
        mergeLocation(parseGbpLocationObject(rawLoc));
      }
    } else if (!diagnosticFailure) {
      diagnosticFailure = classifyGoogleGbpErrorResponse(
        wildcardRes.httpStatus,
        wildcardRes.bodyText,
        "My Business Business Information API",
        emailHint
      );
    }
  } catch {
    // Continue to per-account discovery
  }

  // 3. Per-Account Business Information API v1 - binds exact `accounts/{id}` + `accountName` & discovers Location Groups
  // Prioritize non-PERSONAL business/location-group accounts first, then PERSONAL
  const orderedAccounts = [...discoveredAccounts].sort((a, b) => {
    const aIsBiz = a.type && a.type !== "PERSONAL" ? 0 : 1;
    const bIsBiz = b.type && b.type !== "PERSONAL" ? 0 : 1;
    return aIsBiz - bIsBiz;
  });

  for (const acc of orderedAccounts.slice(0, 8)) {
    try {
      const perAcc = await fetchGbpV1LocationsForParent(token, acc.name);
      if (perAcc.ok) {
        anyGbpApiSucceeded = true;
        for (const rawLoc of perAcc.locations) {
          mergeLocation(
            parseGbpLocationObject(rawLoc, {
              accountId: acc.name,
              accountName: acc.accountName,
              accountType: acc.type,
            })
          );
        }
      } else if (!diagnosticFailure) {
        diagnosticFailure = classifyGoogleGbpErrorResponse(
          perAcc.httpStatus,
          perAcc.bodyText,
          "My Business Business Information API",
          emailHint
        );
      }
    } catch {
      // Continue checking remaining accounts
    }
  }

  // 4. Unified v4 Fallback (`mybusiness.googleapis.com/v4/accounts`) if v1 returned 0 locations
  if (locationMap.size === 0) {
    try {
      const v4AccResp = await fetch("https://mybusiness.googleapis.com/v4/accounts", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6500),
      });
      const v4AccTxt = await v4AccResp.text().catch(() => "");
      if (v4AccResp.ok) {
        anyGbpApiSucceeded = true;
        const v4AccBody = JSON.parse(v4AccTxt || "{}") as {
          accounts?: Array<{ name?: string; accountName?: string; type?: string }>;
        };
        for (const acc of (v4AccBody.accounts ?? []).slice(0, 6)) {
          if (!acc.name) continue;
          if (!discoveredAccounts.some((d) => d.name === acc.name)) {
            discoveredAccounts.push({
              name: acc.name,
              accountName: acc.accountName?.trim() || undefined,
              type: acc.type?.trim() || undefined,
            });
          }
          const v4LocResp = await fetch(
            `https://mybusiness.googleapis.com/v4/${acc.name}/locations?pageSize=50`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(6500),
            }
          );
          if (v4LocResp.ok) {
            const v4LocBody = (await v4LocResp.json().catch(() => ({}))) as {
              locations?: RawGbpLocationPayload[];
            };
            for (const rawLoc of v4LocBody.locations ?? []) {
              mergeLocation(
                parseGbpLocationObject(rawLoc, {
                  accountId: acc.name,
                  accountName: acc.accountName?.trim() || undefined,
                  accountType: acc.type?.trim() || undefined,
                })
              );
            }
          }
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  const availableLocations = Array.from(locationMap.values());
  const preferredId = (
    params.preferredLocationId ||
    (meta.locationId?.startsWith("locations/") ? meta.locationId : "")
  ).trim();
  const wsNameLower = (ws?.name || "").trim().toLowerCase();

  let selectedLoc: GoogleBusinessLocationSummary | undefined;
  if (preferredId) {
    selectedLoc = availableLocations.find((l) => l.locationId === preferredId);
  }
  if (!selectedLoc && wsNameLower) {
    selectedLoc =
      availableLocations.find((l) => l.title.toLowerCase() === wsNameLower) ||
      availableLocations.find(
        (l) =>
          l.title.toLowerCase().includes(wsNameLower) ||
          wsNameLower.includes(l.title.toLowerCase())
      );
  }
  if (!selectedLoc) {
    selectedLoc =
      availableLocations.find((l) => l.isVerified === true) || availableLocations[0];
  }

  // If location was discovered via wildcard without accountId and exactly 1 business account exists, bind it
  const primaryAccount =
    orderedAccounts.find((a) => a.type && a.type !== "PERSONAL") || orderedAccounts[0];
  if (selectedLoc && !selectedLoc.accountId && primaryAccount?.name) {
    selectedLoc.accountId = primaryAccount.name;
    selectedLoc.accountName = selectedLoc.accountName || primaryAccount.accountName;
    selectedLoc.accountType = selectedLoc.accountType || primaryAccount.type;
  }

  const nonPersonalAccount = orderedAccounts.find(
    (a) => a.accountName && a.type && a.type !== "PERSONAL"
  );

  let gbpDiscoveryStatus: GoogleBusinessDiscoveryStatus;
  let gbpDiscoveryDetail: string | undefined;

  if (selectedLoc) {
    gbpDiscoveryStatus = "verified_locations";
    gbpDiscoveryDetail =
      availableLocations.length > 1
        ? `Discovered ${availableLocations.length} Google Business locations under ${emailHint || "your Google account"} - active location: ${selectedLoc.title}.`
        : `Verified Google Business Profile connected: ${selectedLoc.title}${selectedLoc.storeAddress ? ` (${selectedLoc.storeAddress})` : ""}.`;
  } else if (diagnosticFailure && !anyGbpApiSucceeded) {
    gbpDiscoveryStatus = diagnosticFailure.status;
    gbpDiscoveryDetail = diagnosticFailure.detail;
  } else if (diagnosticFailure && (diagnosticFailure.status === "api_disabled" || diagnosticFailure.status === "quota_pending")) {
    gbpDiscoveryStatus = diagnosticFailure.status;
    gbpDiscoveryDetail = diagnosticFailure.detail;
  } else if (nonPersonalAccount?.accountName) {
    gbpDiscoveryStatus = "account_only";
    gbpDiscoveryDetail = `Connected GBP Account '${nonPersonalAccount.accountName}' (${emailHint}), but Google returned 0 published storefront locations inside this account.`;
  } else {
    gbpDiscoveryStatus = "no_locations_found";
    gbpDiscoveryDetail = `Google account ${emailHint || "signed in"} is connected, but Google returned 0 Google Business Profile listings managed by this email. Ensure ${emailHint || "this Google email"} is added as an Owner or Manager at business.google.com, or click 'Reconnect Google' to pick the Google account that owns your listing.`;
  }

  const now = Date.now();
  const resolvedStoreName =
    selectedLoc?.title || nonPersonalAccount?.accountName || meta.storeName || undefined;
  const resolvedAccountId =
    selectedLoc?.accountId || primaryAccount?.name || meta.accountId || undefined;
  const resolvedAccountName =
    selectedLoc?.accountName ||
    nonPersonalAccount?.accountName ||
    primaryAccount?.accountName ||
    meta.accountName ||
    undefined;
  const resolvedLocationId = selectedLoc?.locationId || meta.locationId || undefined;

  // Upgrade legacy `Google Business (email)` labels to the actual Business Name (`RADIANT INDUSTRIAL COMPANY`)
  const isGenericLegacyLabel =
    !conn.displayName || /^google business\s*\(/i.test(conn.displayName.trim());
  const nextDisplayName =
    resolvedStoreName ||
    (isGenericLegacyLabel && ws?.name ? ws.name : conn.displayName);

  // Never keep a raw numeric 21-digit Google OAuth `sub` ID (`116265574937662666329`) as Primary External ID
  const isNumericOAuthSub = /^\d{15,25}$/.test((conn.externalAccountId || "").trim());
  const nextExternalId =
    resolvedLocationId ||
    resolvedAccountId ||
    (!isNumericOAuthSub && conn.externalAccountId ? conn.externalAccountId : "") ||
    emailHint ||
    conn.externalAccountId;

  const nextMeta: ConnectionMetadata = {
    ...meta,
    channelKind: "google_business",
    accountId: resolvedAccountId,
    accountName: resolvedAccountName,
    accountType: selectedLoc?.accountType || primaryAccount?.type || meta.accountType,
    locationId: resolvedLocationId,
    storeName: resolvedStoreName,
    storeCode: selectedLoc?.storeCode ?? meta.storeCode,
    primaryCategory: selectedLoc?.primaryCategory ?? meta.primaryCategory,
    storeAddress: selectedLoc?.storeAddress ?? meta.storeAddress,
    storePhone: selectedLoc?.storePhone ?? meta.storePhone,
    websiteUri: selectedLoc?.websiteUri ?? meta.websiteUri,
    mapsUri: selectedLoc?.mapsUri ?? meta.mapsUri,
    newReviewUri: selectedLoc?.newReviewUri ?? meta.newReviewUri,
    placeId: selectedLoc?.placeId ?? meta.placeId,
    isVerifiedLocation: selectedLoc?.isVerified ?? meta.isVerifiedLocation,
    availableLocations:
      availableLocations.length > 0 ? availableLocations : meta.availableLocations,
    gbpDiscoveryStatus,
    gbpDiscoveryDetail,
    lastGbpDiscoveredAt: now,
    lastLiveCheckMessage:
      gbpDiscoveryDetail ||
      `Connected via Google Consent Screen (${resolvedStoreName || emailHint}).`,
    lastLiveCheckedAccountName: resolvedStoreName || ws?.name || emailHint,
  };

  db.update(controlSchema.connections)
    .set({
      displayName: nextDisplayName,
      externalAccountId: nextExternalId,
      metadataJson: JSON.stringify(nextMeta),
      lastHealthCheckAt: now,
      updatedAt: now,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  upsertRoutingEntry("google", nextExternalId, params.workspaceId, now);

  // Sync `gbp_location` rows in `controlSchema.assets` for discovered locations
  if (availableLocations.length > 0) {
    const existingAssets = db
      .select()
      .from(controlSchema.assets)
      .where(
        and(
          eq(controlSchema.assets.workspaceId, params.workspaceId),
          eq(controlSchema.assets.connectionId, conn.id)
        )
      )
      .all();

    for (const loc of availableLocations) {
      const match = existingAssets.find((a) => a.externalId === loc.locationId);
      const assetMeta = JSON.stringify({
        accountId: loc.accountId,
        address: loc.storeAddress,
        phone: loc.storePhone,
        category: loc.primaryCategory,
        mapsUri: loc.mapsUri,
      });
      if (match) {
        db.update(controlSchema.assets)
          .set({
            name: loc.title,
            metadataJson: assetMeta,
            active: loc.locationId === resolvedLocationId,
          })
          .where(eq(controlSchema.assets.id, match.id))
          .run();
      } else {
        db.insert(controlSchema.assets)
          .values({
            id: newId(),
            workspaceId: params.workspaceId,
            connectionId: conn.id,
            provider: "google",
            assetType: "gbp_location",
            externalId: loc.locationId,
            name: loc.title,
            metadataJson: assetMeta,
            active: loc.locationId === resolvedLocationId,
            createdAt: now,
          })
          .run();
      }
    }
  }

  return {
    connected: true,
    connectionId: conn.id,
    displayName: nextDisplayName,
    storeName: resolvedStoreName,
    accountId: resolvedAccountId,
    accountName: resolvedAccountName,
    locationId: resolvedLocationId,
    storeAddress: nextMeta.storeAddress,
    storePhone: nextMeta.storePhone,
    primaryCategory: nextMeta.primaryCategory,
    websiteUri: nextMeta.websiteUri,
    mapsUri: nextMeta.mapsUri,
    newReviewUri: nextMeta.newReviewUri,
    availableLocations: nextMeta.availableLocations ?? [],
    gbpDiscoveryStatus,
    gbpDiscoveryDetail,
  };
}

export function updateGoogleBusinessReviewSyncMetadata(params: {
  workspaceId: string;
  connectionId: string;
  totalReviewsCount: number;
  averageRating?: number;
  syncedAt?: number;
  syncDiagnosticNote?: string;
}): void {
  const switchStarted = Date.now();
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, params.connectionId),
        eq(controlSchema.connections.workspaceId, params.workspaceId)
      )
    )
    .get();
  if (!conn) return;

  const meta = parseMetadataSafe(conn.metadataJson);
  const ts = params.syncedAt ?? Date.now();
  meta.lastReviewsSyncedAt = ts;
  meta.totalReviewsCount = params.totalReviewsCount;
  if (typeof params.averageRating === "number" && Number.isFinite(params.averageRating)) {
    meta.averageRating = Math.round(params.averageRating * 10) / 10;
  }
  if (params.syncDiagnosticNote) {
    meta.gbpDiscoveryDetail = params.syncDiagnosticNote;
  }

  db.update(controlSchema.connections)
    .set({
      metadataJson: JSON.stringify(meta),
      updatedAt: ts,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();
}

export const selectGoogleBusinessLocation = defineAction({
  key: "connections.gbp_location.selected",
  permission: "connections:manage",
  input: z.object({
    connectionId: z.string().min(4),
    locationId: z.string().trim().min(3),
  }),
  summarize: (input) => `Switched active Google Business location to '${input.locationId}'`,
  handler: async (ctx, input) => {
    const normalizedLocId = input.locationId.startsWith("locations/")
      ? input.locationId
      : `locations/${input.locationId}`;
    const hydrated = await discoverAndHydrateGoogleBusinessProfile({
      workspaceId: ctx.workspaceId,
      connectionId: input.connectionId,
      preferredLocationId: normalizedLocId,
    });
    if (!hydrated.connected) {
      throw new RslError("RSL-VAL-1001", "Google Business connection not found.");
    }
    return {
      connectionId: input.connectionId,
      displayName: hydrated.displayName,
      storeName: hydrated.storeName,
      locationId: hydrated.locationId,
    };
  },
});

/**
 * Uploads an encrypted .rslbackup archive directly to the customer's connected Google Drive folder (`drive.file`).
 */
export async function uploadFileToWorkspaceGoogleDrive(params: {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{
  uploaded: boolean;
  driveFileId?: string;
  driveEmail?: string;
  folderName?: string;
  error?: string;
}> {
  const conn = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "gdrive")
      )
    )
    .get();

  if (!conn) {
    return { uploaded: false };
  }

  const accessToken = await refreshGoogleConnectionIfNeeded(params.workspaceId, conn.id);
  if (!accessToken || isWorkspaceSandboxIntegrationMode(params.workspaceId, accessToken)) {
    return { uploaded: false };
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  let folderId = meta.folderId;
  let folderName = meta.folderName || getPlatformGoogleOAuthConfig().defaultDriveFolderName;

  try {
    if (!folderId) {
      const ensured = await ensureGoogleDriveBackupFolder(accessToken, folderName);
      folderId = ensured.folderId;
      folderName = ensured.folderName;
    }

    const boundary = `rsl_gdrive_${crypto.randomBytes(12).toString("hex")}`;
    const metadataPart = JSON.stringify({
      name: params.fileName,
      parents: folderId ? [folderId] : undefined,
      mimeType: params.mimeType,
    });

    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
      "utf8"
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--`, "utf8");
    const multipartBody = Buffer.concat([preamble, params.bytes, epilogue]);

    const uploadResp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!uploadResp.ok) {
      const errTxt = await uploadResp.text().catch(() => "");
      return {
        uploaded: false,
        driveEmail: meta.driveEmail,
        folderName,
        error: `Google Drive upload HTTP ${uploadResp.status}: ${errTxt.slice(0, 140)}`,
      };
    }

    const uploadedFile = (await uploadResp.json()) as { id?: string };
    return {
      uploaded: true,
      driveFileId: uploadedFile.id,
      driveEmail: meta.driveEmail,
      folderName,
    };
  } catch (err) {
    return {
      uploaded: false,
      driveEmail: meta.driveEmail,
      folderName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ============================================================================
 * Google Ads Customer Discovery, Switcher & Credential Resolution (`v18`)
 * ============================================================================ */

export function normalizeGoogleAdsCustomerId(raw: string | undefined | null): string {
  return (raw || "")
    .replace(/^customers\//i, "")
    .replace(/[^0-9]/g, "")
    .trim();
}

export function formatGoogleAdsCustomerId(raw: string | undefined | null): string {
  const digits = normalizeGoogleAdsCustomerId(raw);
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export async function discoverAndHydrateGoogleAdsAccounts(params: {
  workspaceId: string;
  connectionId?: string;
  accessToken?: string;
  preferredCustomerId?: string;
}): Promise<{
  connected: boolean;
  connectionId?: string;
  displayName: string;
  customerId?: string;
  formattedCustomerId?: string;
  loginCustomerId?: string;
  currencyCode?: string;
  availableAdCustomers: GoogleAdsCustomerSummary[];
  adsDiscoveryStatus: GoogleAdsDiscoveryStatus;
  adsDiscoveryDetail?: string;
}> {
  const db = controlDb();
  const ws = db
    .select({ id: controlSchema.workspaces.id, name: controlSchema.workspaces.name })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const conn = params.connectionId
    ? db
        .select()
        .from(controlSchema.connections)
        .where(
          and(
            eq(controlSchema.connections.id, params.connectionId),
            eq(controlSchema.connections.workspaceId, params.workspaceId)
          )
        )
        .get()
    : db
        .select()
        .from(controlSchema.connections)
        .where(
          and(
            eq(controlSchema.connections.workspaceId, params.workspaceId),
            eq(controlSchema.connections.provider, "google_ads")
          )
        )
        .get();

  if (!conn) {
    return {
      connected: false,
      displayName: ws?.name || "Google Ads",
      availableAdCustomers: [],
      adsDiscoveryStatus: "no_customers_found",
      adsDiscoveryDetail: "Google Ads account is not connected yet.",
    };
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  const emailHint = meta.driveEmail || "";

  let token = params.accessToken || "";
  if (!token) {
    token = (await refreshGoogleConnectionIfNeeded(params.workspaceId, conn.id)) || "";
  }
  if (!token) {
    return {
      connected: true,
      connectionId: conn.id,
      displayName: conn.displayName,
      availableAdCustomers: meta.availableAdCustomers ?? [],
      adsDiscoveryStatus: "token_error",
      adsDiscoveryDetail:
        "Google Ads OAuth session expired. Click 'Connect Google Ads' to re-authorize in one click.",
    };
  }

  const now = Date.now();
  if (isWorkspaceSandboxIntegrationMode(params.workspaceId, token)) {
    const sbCid = normalizeGoogleAdsCustomerId(meta.customerId || conn.externalAccountId) || "1234567890";
    const sbFmt = formatGoogleAdsCustomerId(sbCid);
    const sbName = meta.accountName || `${ws?.name || "Sandbox"} Google Ads`;
    const sbCustomer: GoogleAdsCustomerSummary = {
      customerId: sbCid,
      formattedCustomerId: sbFmt,
      descriptiveName: sbName,
      currencyCode: "INR",
      timeZone: "Asia/Kolkata",
      isManager: false,
    };
    const nextMeta: ConnectionMetadata = {
      ...meta,
      channelKind: "google_ads",
      customerId: sbCid,
      formattedCustomerId: sbFmt,
      accountName: sbName,
      currencyCode: "INR",
      timeZone: "Asia/Kolkata",
      availableAdCustomers: [sbCustomer],
      adsDiscoveryStatus: "verified_customers",
      adsDiscoveryDetail: `Sandbox Google Ads Customer ${sbFmt} (${sbName}) ready.`,
      lastAdsDiscoveredAt: now,
      tokenMode: "sandbox",
    };
    db.update(controlSchema.connections)
      .set({
        displayName: `${sbName} (${sbFmt})`,
        externalAccountId: sbCid,
        metadataJson: JSON.stringify(nextMeta),
        updatedAt: now,
      })
      .where(eq(controlSchema.connections.id, conn.id))
      .run();
    return {
      connected: true,
      connectionId: conn.id,
      displayName: `${sbName} (${sbFmt})`,
      customerId: sbCid,
      formattedCustomerId: sbFmt,
      currencyCode: "INR",
      availableAdCustomers: [sbCustomer],
      adsDiscoveryStatus: "verified_customers",
      adsDiscoveryDetail: nextMeta.adsDiscoveryDetail,
    };
  }

  const adsCfg = getPlatformGoogleAdsConfig();
  const optDevTokenHeader: Record<string, string> = adsCfg.developerToken
    ? { "developer-token": adsCfg.developerToken }
    : {};

  const discovered = new Map<string, GoogleAdsCustomerSummary>();
  let apiFailureDetail = "";

  try {
    const listResp = await fetch(
      "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...optDevTokenHeader,
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    const listTxt = await listResp.text().catch(() => "");
    if (!listResp.ok) {
      const hint =
        listResp.status === 403 && /SERVICE_DISABLED|has not been used|disabled/i.test(listTxt)
          ? " (Enable 'Google Ads API' in Google Cloud Console → APIs & Services, and check Google Ads API Overview access level)."
          : listResp.status === 403 && /TEST_ACCOUNT|EXPLORER|PERMISSION_DENIED/i.test(listTxt)
            ? " (In Google Cloud Console → Google Ads API → Overview, upgrade access level from Test to Explorer/Basic for live ad accounts)."
            : "";
      apiFailureDetail = `Google Ads API listAccessibleCustomers returned HTTP ${listResp.status}: ${listTxt.slice(0, 180)}${hint}`;
    } else {
      const parsed = JSON.parse(listTxt || "{}") as { resourceNames?: string[] };
      const cids = (parsed.resourceNames ?? [])
        .map((r) => normalizeGoogleAdsCustomerId(r))
        .filter((id) => id.length > 0)
        .slice(0, 10);

      for (const cid of cids) {
        try {
          const searchResp = await fetch(
            `https://googleads.googleapis.com/v18/customers/${cid}/googleAds:searchStream`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                ...optDevTokenHeader,
                "Content-Type": "application/json",
                ...(adsCfg.loginCustomerId
                  ? { "login-customer-id": normalizeGoogleAdsCustomerId(adsCfg.loginCustomerId) }
                  : {}),
              },
              body: JSON.stringify({
                query:
                  "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1",
              }),
              signal: AbortSignal.timeout(6500),
            }
          );
          if (searchResp.ok) {
            const batches = (await searchResp.json().catch(() => [])) as Array<{
              results?: Array<{
                customer?: {
                  id?: string | number;
                  descriptiveName?: string;
                  currencyCode?: string;
                  timeZone?: string;
                  manager?: boolean;
                };
              }>;
            }>;
            const cObj = batches[0]?.results?.[0]?.customer;
            const resolvedCid = normalizeGoogleAdsCustomerId(String(cObj?.id ?? cid)) || cid;
            const isMgr = Boolean(cObj?.manager);
            discovered.set(resolvedCid, {
              customerId: resolvedCid,
              formattedCustomerId: formatGoogleAdsCustomerId(resolvedCid),
              descriptiveName:
                cObj?.descriptiveName?.trim() || `Google Ads ${formatGoogleAdsCustomerId(resolvedCid)}`,
              currencyCode: cObj?.currencyCode || "INR",
              timeZone: cObj?.timeZone || "Asia/Kolkata",
              isManager: isMgr,
            });

            if (isMgr) {
              // Discover child client ad accounts under this MCC
              const childResp = await fetch(
                `https://googleads.googleapis.com/v18/customers/${resolvedCid}/googleAds:searchStream`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    ...optDevTokenHeader,
                    "login-customer-id": resolvedCid,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    query:
                      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.status = 'ENABLED' AND customer_client.manager = false LIMIT 20",
                  }),
                  signal: AbortSignal.timeout(6500),
                }
              );
              if (childResp.ok) {
                const childBatches = (await childResp.json().catch(() => [])) as Array<{
                  results?: Array<{
                    customerClient?: {
                      id?: string | number;
                      descriptiveName?: string;
                      currencyCode?: string;
                      timeZone?: string;
                      manager?: boolean;
                    };
                  }>;
                }>;
                for (const batch of childBatches) {
                  for (const row of batch.results ?? []) {
                    const cc = row.customerClient;
                    const childCid = normalizeGoogleAdsCustomerId(String(cc?.id ?? ""));
                    if (!childCid) continue;
                    discovered.set(childCid, {
                      customerId: childCid,
                      formattedCustomerId: formatGoogleAdsCustomerId(childCid),
                      descriptiveName:
                        cc?.descriptiveName?.trim() ||
                        `Google Ads ${formatGoogleAdsCustomerId(childCid)}`,
                      currencyCode: cc?.currencyCode || "INR",
                      timeZone: cc?.timeZone || "Asia/Kolkata",
                      isManager: false,
                      loginCustomerId: resolvedCid,
                    });
                  }
                }
              }
            }
          } else {
            discovered.set(cid, {
              customerId: cid,
              formattedCustomerId: formatGoogleAdsCustomerId(cid),
              descriptiveName: `Google Ads ${formatGoogleAdsCustomerId(cid)}`,
              currencyCode: "INR",
            });
          }
        } catch {
          discovered.set(cid, {
            customerId: cid,
            formattedCustomerId: formatGoogleAdsCustomerId(cid),
            descriptiveName: `Google Ads ${formatGoogleAdsCustomerId(cid)}`,
            currencyCode: "INR",
          });
        }
      }
    }
  } catch (err) {
    apiFailureDetail = err instanceof Error ? err.message : String(err);
  }

  const availableAdCustomers = Array.from(discovered.values());
  const preferredCid = normalizeGoogleAdsCustomerId(params.preferredCustomerId || meta.customerId);
  const wsLower = (ws?.name || "").trim().toLowerCase();

  let selected: GoogleAdsCustomerSummary | undefined;
  if (preferredCid) {
    selected = availableAdCustomers.find((c) => c.customerId === preferredCid);
  }
  if (!selected && wsLower) {
    selected = availableAdCustomers.find(
      (c) => !c.isManager && c.descriptiveName.toLowerCase().includes(wsLower)
    );
  }
  if (!selected) {
    selected =
      availableAdCustomers.find((c) => !c.isManager && c.currencyCode === "INR") ||
      availableAdCustomers.find((c) => !c.isManager) ||
      availableAdCustomers[0];
  }

  let adsDiscoveryStatus: GoogleAdsDiscoveryStatus;
  let adsDiscoveryDetail: string;

  if (selected) {
    adsDiscoveryStatus = "verified_customers";
    adsDiscoveryDetail =
      availableAdCustomers.length > 1
        ? `Discovered ${availableAdCustomers.length} Google Ads accounts - active: ${selected.descriptiveName} (${selected.formattedCustomerId}, ${selected.currencyCode || "INR"}).`
        : `Connected Google Ads account ${selected.descriptiveName} (${selected.formattedCustomerId}, ${selected.currencyCode || "INR"}).`;
  } else if (apiFailureDetail) {
    adsDiscoveryStatus = "api_error";
    adsDiscoveryDetail = apiFailureDetail;
  } else {
    adsDiscoveryStatus = "no_customers_found";
    adsDiscoveryDetail = `Google account ${emailHint || "signed in"} returned 0 Google Ads Customer IDs. Create a Google Ads account at ads.google.com or use RapidShift Managed Vault mode on the Ads Studio page.`;
  }

  const nextDisplayName = selected
    ? `${selected.descriptiveName} (${selected.formattedCustomerId})`
    : conn.displayName;
  const nextExternalId = selected?.customerId || conn.externalAccountId;
  const resolvedLoginCid =
    selected?.loginCustomerId ||
    (adsCfg.loginCustomerId ? normalizeGoogleAdsCustomerId(adsCfg.loginCustomerId) : undefined) ||
    meta.loginCustomerId;

  const nextMeta: ConnectionMetadata = {
    ...meta,
    channelKind: "google_ads",
    customerId: selected?.customerId ?? meta.customerId,
    formattedCustomerId: selected?.formattedCustomerId ?? meta.formattedCustomerId,
    loginCustomerId: resolvedLoginCid,
    accountName: selected?.descriptiveName ?? meta.accountName,
    currencyCode: selected?.currencyCode ?? meta.currencyCode ?? "INR",
    timeZone: selected?.timeZone ?? meta.timeZone ?? "Asia/Kolkata",
    availableAdCustomers:
      availableAdCustomers.length > 0 ? availableAdCustomers : meta.availableAdCustomers,
    adsDiscoveryStatus,
    adsDiscoveryDetail,
    lastAdsDiscoveredAt: now,
    lastLiveCheckMessage: adsDiscoveryDetail,
    lastLiveCheckedAccountName: selected?.descriptiveName || emailHint,
  };

  db.update(controlSchema.connections)
    .set({
      displayName: nextDisplayName,
      externalAccountId: nextExternalId,
      metadataJson: JSON.stringify(nextMeta),
      lastHealthCheckAt: now,
      updatedAt: now,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  if (selected?.customerId) {
    upsertRoutingEntry("google_ads", selected.customerId, params.workspaceId, now);
  }

  return {
    connected: true,
    connectionId: conn.id,
    displayName: nextDisplayName,
    customerId: nextMeta.customerId,
    formattedCustomerId: nextMeta.formattedCustomerId,
    loginCustomerId: resolvedLoginCid,
    currencyCode: nextMeta.currencyCode,
    availableAdCustomers: nextMeta.availableAdCustomers ?? [],
    adsDiscoveryStatus,
    adsDiscoveryDetail,
  };
}

export const selectGoogleAdsCustomer = defineAction({
  key: "connections.google_ads_customer.selected",
  permission: "connections:manage",
  input: z.object({
    connectionId: z.string().min(4),
    customerId: z.string().trim().min(6),
  }),
  summarize: (input) =>
    `Switched active Google Ads Customer ID to '${formatGoogleAdsCustomerId(input.customerId)}'`,
  handler: async (ctx, input) => {
    const cleanCid = normalizeGoogleAdsCustomerId(input.customerId);
    if (cleanCid.length !== 10) {
      throw new RslError("RSL-VAL-1001", "Enter a valid 10-digit Google Ads Customer ID (e.g. 123-456-7890).");
    }
    const hydrated = await discoverAndHydrateGoogleAdsAccounts({
      workspaceId: ctx.workspaceId,
      connectionId: input.connectionId,
      preferredCustomerId: cleanCid,
    });
    if (!hydrated.connected) {
      throw new RslError("RSL-VAL-1001", "Google Ads connection not found.");
    }
    return {
      connectionId: input.connectionId,
      displayName: hydrated.displayName,
      customerId: hydrated.customerId || cleanCid,
      formattedCustomerId: hydrated.formattedCustomerId || formatGoogleAdsCustomerId(cleanCid),
    };
  },
});

export async function resolveWorkspaceGoogleAdsCredentials(params: {
  workspaceId: string;
  billingMode: "direct_client" | "rsl_managed_vault";
}): Promise<{
  ok: boolean;
  mode: "live" | "sandbox";
  accessToken?: string;
  customerId?: string;
  loginCustomerId?: string;
  developerToken?: string;
  error?: string;
}> {
  const adsCfg = getPlatformGoogleAdsConfig();
  const oauthCfg = getPlatformGoogleOAuthConfig();

  if (params.billingMode === "rsl_managed_vault") {
    const managedCid = normalizeGoogleAdsCustomerId(adsCfg.managedCustomerId);
    if (managedCid && adsCfg.managedRefreshToken && oauthCfg.isReady) {
      if (isWorkspaceSandboxIntegrationMode(params.workspaceId, adsCfg.managedRefreshToken)) {
        return {
          ok: true,
          mode: "sandbox",
          accessToken: adsCfg.managedRefreshToken,
          customerId: managedCid,
          loginCustomerId: normalizeGoogleAdsCustomerId(adsCfg.loginCustomerId) || undefined,
          developerToken: adsCfg.developerToken || undefined,
        };
      }
      try {
        const body = new URLSearchParams({
          client_id: oauthCfg.clientId,
          client_secret: oauthCfg.clientSecret,
          refresh_token: adsCfg.managedRefreshToken,
          grant_type: "refresh_token",
        });
        const resp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(8000),
        });
        const tokenData = (await resp.json().catch(() => ({}))) as { access_token?: string };
        if (resp.ok && tokenData.access_token) {
          return {
            ok: true,
            mode: "live",
            accessToken: tokenData.access_token,
            customerId: managedCid,
            loginCustomerId: normalizeGoogleAdsCustomerId(adsCfg.loginCustomerId) || undefined,
            developerToken: adsCfg.developerToken || undefined,
          };
        }
      } catch {
        // Fall through to workspace's own Google Ads connection if available
      }
    }
  }

  const conn = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "google_ads")
      )
    )
    .get();

  if (!conn) {
    return {
      ok: false,
      mode: "live",
      error:
        params.billingMode === "rsl_managed_vault"
          ? "RapidShift Managed Google Ads MCC is not configured yet in Platform Credentials, and no client Google Ads account is connected on Connected Channels."
          : "Connect your Google Ads account on Connected Channels first (or switch Billing Mode to RSL Managed Vault).",
    };
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  const accessToken = await refreshGoogleConnectionIfNeeded(params.workspaceId, conn.id);
  if (!accessToken) {
    return {
      ok: false,
      mode: "live",
      error: "Google Ads OAuth token expired or was revoked. Reconnect Google Ads on Connected Channels.",
    };
  }

  const customerId = normalizeGoogleAdsCustomerId(meta.customerId || conn.externalAccountId);
  if (isWorkspaceSandboxIntegrationMode(params.workspaceId, accessToken)) {
    return {
      ok: true,
      mode: "sandbox",
      accessToken,
      customerId: customerId || "1234567890",
      loginCustomerId: meta.loginCustomerId,
      developerToken: adsCfg.developerToken || undefined,
    };
  }

  if (!customerId || customerId.length !== 10) {
    return {
      ok: false,
      mode: "live",
      error: "No 10-digit Google Ads Customer ID is selected yet. Open Connected Channels → Google Ads to select or enter your Customer ID.",
    };
  }

  return {
    ok: true,
    mode: "live",
    accessToken,
    customerId,
    loginCustomerId:
      meta.loginCustomerId || normalizeGoogleAdsCustomerId(adsCfg.loginCustomerId) || undefined,
    developerToken: adsCfg.developerToken || undefined,
  };
}

export function resolveWorkspaceMetaAdsCredentials(params: {
  workspaceId: string;
  billingMode: "direct_client" | "rsl_managed_vault";
}): {
  ok: boolean;
  mode: "live" | "sandbox";
  accessToken?: string;
  adAccountId?: string;
  pageId?: string;
  igUserId?: string;
  pixelId?: string;
  graphVersion: string;
  error?: string;
} {
  const metaCfg = getPlatformMetaAppConfig();
  const graphVersion = metaCfg.graphVersion || "v21.0";

  if (params.billingMode === "rsl_managed_vault" && metaCfg.isManagedAdsReady) {
    const rawAct = metaCfg.managedAdAccountId.replace(/^act_/i, "").trim();
    const isSb = isWorkspaceSandboxIntegrationMode(params.workspaceId, metaCfg.managedSystemToken);
    return {
      ok: true,
      mode: isSb ? "sandbox" : "live",
      accessToken: metaCfg.managedSystemToken,
      adAccountId: `act_${rawAct}`,
      pageId: metaCfg.managedPageId || undefined,
      graphVersion,
    };
  }

  const allMetaConns = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "meta")
      )
    )
    .orderBy(desc(controlSchema.connections.updatedAt))
    .all();

  let adsConn: (typeof allMetaConns)[number] | undefined;
  let pageIdFromWorkspace: string | undefined;
  let igUserIdFromWorkspace: string | undefined;
  let pixelIdFromWorkspace: string | undefined;

  for (const c of allMetaConns) {
    const m = parseMetadataSafe(c.metadataJson);
    if (!pageIdFromWorkspace && m.pageId) pageIdFromWorkspace = m.pageId;
    if (!igUserIdFromWorkspace && m.igUserId) igUserIdFromWorkspace = m.igUserId;
    if (!pixelIdFromWorkspace && m.pixelId) pixelIdFromWorkspace = m.pixelId;
    if (
      !adsConn &&
      (m.channelKind === "meta_ads_pixel" ||
        Boolean(m.adAccountId) ||
        /^act_\d+$/i.test(c.externalAccountId))
    ) {
      adsConn = c;
    }
  }

  if (!adsConn) {
    return {
      ok: false,
      mode: "live",
      graphVersion,
      error:
        params.billingMode === "rsl_managed_vault"
          ? "RapidShift Managed Meta Ad Account is not configured yet in Platform Credentials, and no client Meta Ad Account is connected on Connected Channels."
          : "Connect your Meta Ad Account (act_...) on Connected Channels first, or switch Billing Mode to RSL Managed Vault.",
    };
  }

  const meta = parseMetadataSafe(adsConn.metadataJson);
  let token = "";
  try {
    token = (JSON.parse(decryptEnvelope(adsConn.encryptedTokens)) as StoredTokenPayload).accessToken;
  } catch {
    token = "";
  }
  if (!token) {
    return {
      ok: false,
      mode: "live",
      graphVersion,
      error: "Meta Ad Account access token could not be decrypted. Reconnect Meta Ads on Connected Channels.",
    };
  }

  const rawAct = (meta.adAccountId || adsConn.externalAccountId || "")
    .replace(/^act_/i, "")
    .trim();
  const isSb = isWorkspaceSandboxIntegrationMode(params.workspaceId, token);

  if (!rawAct && !isSb) {
    return {
      ok: false,
      mode: "live",
      graphVersion,
      error: "Meta connection does not have an Ad Account ID (act_...). Edit or reconnect Meta Ads & Pixel on Connected Channels.",
    };
  }

  return {
    ok: true,
    mode: isSb ? "sandbox" : "live",
    accessToken: token,
    adAccountId: rawAct ? `act_${rawAct}` : "act_1000000001",
    pageId: meta.pageId || pageIdFromWorkspace || metaCfg.managedPageId || undefined,
    igUserId: meta.igUserId || igUserIdFromWorkspace || undefined,
    pixelId: meta.pixelId || pixelIdFromWorkspace || undefined,
    graphVersion,
  };
}

export function resolveWorkspaceChannelCredentials(params: {
  workspaceId: string;
  channelKind: "whatsapp_cloud" | "instagram_business" | "facebook_page" | "meta_ads_pixel";
}): {
  ok: boolean;
  mode: "live" | "sandbox";
  connectionId?: string;
  accessToken?: string;
  externalAccountId?: string;
  metadata?: ConnectionMetadata;
  graphVersion: string;
  error?: string;
} {
  const metaCfg = getPlatformMetaAppConfig();
  const graphVersion = metaCfg.graphVersion || "v21.0";
  const targetProvider = params.channelKind === "whatsapp_cloud" ? "whatsapp" : "meta";

  const rows = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, targetProvider)
      )
    )
    .orderBy(desc(controlSchema.connections.updatedAt))
    .all();

  const match =
    rows.find((r) => parseMetadataSafe(r.metadataJson).channelKind === params.channelKind) ||
    (params.channelKind === "whatsapp_cloud"
      ? rows[0]
      : params.channelKind === "facebook_page"
        ? rows.find((r) => Boolean(parseMetadataSafe(r.metadataJson).pageId))
        : params.channelKind === "instagram_business"
          ? rows.find((r) => Boolean(parseMetadataSafe(r.metadataJson).igUserId))
          : rows.find((r) => Boolean(parseMetadataSafe(r.metadataJson).pixelId)));

  if (!match) {
    return {
      ok: false,
      mode: "live",
      graphVersion,
      error: `No active ${params.channelKind} connection found in Connected Channels.`,
    };
  }

  let token = "";
  try {
    const parsed = JSON.parse(decryptEnvelope(match.encryptedTokens)) as StoredTokenPayload;
    token = parsed.accessToken || "";
  } catch {
    try {
      token = decryptEnvelope(match.encryptedTokens).trim();
    } catch {
      token = "";
    }
  }

  if (!token) {
    return {
      ok: false,
      mode: "live",
      graphVersion,
      error: `Stored ${params.channelKind} access token could not be decrypted. Reconnect on Connected Channels.`,
    };
  }

  const metadata = parseMetadataSafe(match.metadataJson);
  const isSb = isWorkspaceSandboxIntegrationMode(params.workspaceId, token);

  return {
    ok: true,
    mode: isSb ? "sandbox" : "live",
    connectionId: match.id,
    accessToken: token,
    externalAccountId: match.externalAccountId,
    metadata,
    graphVersion,
  };
}

/* ============================================================================
 * Automatic 1-Click Meta (Facebook / Instagram / Ads / WABA) OAuth 2.0 Flow
 * ============================================================================ */

export type MetaOAuthPurpose =
  | "meta_all"
  | "facebook_page"
  | "instagram_business"
  | "meta_ads_pixel"
  | "whatsapp_cloud";

export function isMetaOAuthConfigured(): boolean {
  const cfg = getPlatformMetaAppConfig();
  return cfg.isReady && cfg.enableMetaOAuth;
}

export function buildMetaOAuthAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  purpose: MetaOAuthPurpose;
}): string {
  const cfg = getPlatformMetaAppConfig();
  if (!cfg.isReady || !cfg.enableMetaOAuth) {
    throw new RslError(
      "RSL-VAL-1001",
      "Facebook / Meta 1-click sign-in is pending platform setup. Please contact your workspace administrator or try again shortly."
    );
  }

  const scopeSet = new Set<string>(["public_profile", "business_management"]);
  if (params.purpose === "facebook_page" || params.purpose === "meta_all") {
    scopeSet.add("pages_show_list");
    scopeSet.add("pages_read_engagement");
    scopeSet.add("pages_manage_posts");
    scopeSet.add("pages_messaging");
    scopeSet.add("leads_retrieval");
    scopeSet.add("pages_manage_ads");
  }
  if (params.purpose === "instagram_business" || params.purpose === "meta_all") {
    scopeSet.add("pages_show_list");
    scopeSet.add("instagram_basic");
    scopeSet.add("instagram_content_publish");
    scopeSet.add("instagram_manage_messages");
  }
  if (params.purpose === "meta_ads_pixel" || params.purpose === "meta_all") {
    scopeSet.add("ads_management");
    scopeSet.add("ads_read");
    scopeSet.add("pages_show_list");
    scopeSet.add("leads_retrieval");
  }
  if (params.purpose === "whatsapp_cloud" || params.purpose === "meta_all") {
    scopeSet.add("whatsapp_business_management");
    scopeSet.add("whatsapp_business_messaging");
  }

  const url = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  if (cfg.configId && cfg.configId.trim().length > 0) {
    url.searchParams.set("config_id", cfg.configId.trim());
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", Array.from(scopeSet).join(","));
  }
  return url.toString();
}

async function autoSubscribeMetaWebhookAsset(params: {
  graphVersion: string;
  assetType: "page" | "waba";
  assetId: string;
  accessToken: string;
}): Promise<boolean> {
  if (!params.assetId || !params.accessToken) return false;
  try {
    const url = `https://graph.facebook.com/${params.graphVersion}/${encodeURIComponent(params.assetId)}/subscribed_apps`;
    const init: RequestInit =
      params.assetType === "page"
        ? {
            method: "POST",
            headers: {
              Authorization: `Bearer ${params.accessToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              subscribed_fields: "messages,messaging_postbacks,feed,leadgen",
            }).toString(),
            signal: AbortSignal.timeout(6000),
          }
        : {
            method: "POST",
            headers: {
              Authorization: `Bearer ${params.accessToken}`,
            },
            signal: AbortSignal.timeout(6000),
          };
    const resp = await fetch(url, init);
    return resp.ok;
  } catch {
    return false;
  }
}

async function discoverMetaGraphAssets(params: {
  userToken: string;
  graphVersion: string;
  appId?: string;
  appSecret?: string;
  purpose: MetaOAuthPurpose;
}): Promise<{
  pages: Array<MetaDiscoveredPageSummary & { pageAccessToken: string }>;
  instagramAccounts: Array<MetaDiscoveredInstagramSummary & { pageAccessToken: string }>;
  adAccounts: MetaDiscoveredAdAccountSummary[];
  wabaPhones: MetaDiscoveredWabaPhoneSummary[];
}> {
  const { userToken, graphVersion: v, purpose } = params;
  const debugWabaIds = new Set<string>();
  const debugPageIds = new Set<string>();

  // 0. Inspect granular_scopes via /debug_token (captures Embedded Signup WABA & granular Page selections)
  if (params.appId && params.appSecret) {
    try {
      const dbgUrl = new URL(`https://graph.facebook.com/${v}/debug_token`);
      dbgUrl.searchParams.set("input_token", userToken);
      dbgUrl.searchParams.set("access_token", `${params.appId}|${params.appSecret}`);
      const dbgResp = await fetch(dbgUrl.toString(), {
        signal: AbortSignal.timeout(6000),
      });
      if (dbgResp.ok) {
        const dbgBody = (await dbgResp.json()) as {
          data?: {
            granular_scopes?: Array<{
              scope?: string;
              target_ids?: string[];
            }>;
          };
        };
        for (const gs of dbgBody.data?.granular_scopes ?? []) {
          const scope = (gs.scope || "").toLowerCase();
          for (const tid of gs.target_ids ?? []) {
            if (!tid) continue;
            if (
              scope === "whatsapp_business_management" ||
              scope === "whatsapp_business_messaging"
            ) {
              debugWabaIds.add(String(tid));
            } else if (
              scope === "pages_show_list" ||
              scope === "pages_manage_posts" ||
              scope === "pages_messaging"
            ) {
              debugPageIds.add(String(tid));
            }
          }
        }
      }
    } catch {
      // Optional granular scope enrichment
    }
  }

  const pages: Array<MetaDiscoveredPageSummary & { pageAccessToken: string }> = [];
  const instagramAccounts: Array<MetaDiscoveredInstagramSummary & { pageAccessToken: string }> = [];
  const adAccounts: MetaDiscoveredAdAccountSummary[] = [];
  const wabaPhones: MetaDiscoveredWabaPhoneSummary[] = [];

  // 1. Discover Facebook Pages & Linked Instagram Business Accounts
  if (
    purpose === "facebook_page" ||
    purpose === "instagram_business" ||
    purpose === "meta_ads_pixel" ||
    purpose === "meta_all"
  ) {
    const seenPageIds = new Set<string>();
    const collectPageNode = (node: {
      id?: string;
      name?: string;
      category?: string;
      access_token?: string;
      instagram_business_account?: { id?: string; username?: string; name?: string };
    }) => {
      if (!node.id || seenPageIds.has(node.id)) return;
      seenPageIds.add(node.id);
      const pagePermToken = node.access_token || userToken;
      const pageName = node.name || `Facebook Page (${node.id})`;
      const ig = node.instagram_business_account;
      pages.push({
        pageId: node.id,
        pageName,
        category: node.category,
        igUserId: ig?.id,
        igUsername: ig?.username,
        pageAccessToken: pagePermToken,
      });
      if (ig?.id) {
        instagramAccounts.push({
          igUserId: ig.id,
          igUsername: ig.username,
          name: ig.name,
          linkedPageId: node.id,
          linkedPageName: pageName,
          pageAccessToken: pagePermToken,
        });
      }
    };

    try {
      const pagesResp = await fetch(
        `https://graph.facebook.com/${v}/me/accounts?fields=id,name,category,access_token,instagram_business_account{id,username,name}&limit=50`,
        {
          headers: { Authorization: `Bearer ${userToken}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (pagesResp.ok) {
        const pagesBody = (await pagesResp.json()) as {
          data?: Array<{
            id?: string;
            name?: string;
            category?: string;
            access_token?: string;
            instagram_business_account?: { id?: string; username?: string; name?: string };
          }>;
        };
        for (const p of pagesBody.data ?? []) {
          collectPageNode(p);
        }
      }
    } catch {
      // Continue
    }

    for (const pid of debugPageIds) {
      if (seenPageIds.has(pid)) continue;
      try {
        const pResp = await fetch(
          `https://graph.facebook.com/${v}/${encodeURIComponent(pid)}?fields=id,name,category,access_token,instagram_business_account{id,username,name}`,
          {
            headers: { Authorization: `Bearer ${userToken}` },
            signal: AbortSignal.timeout(5000),
          }
        );
        if (pResp.ok) {
          const pNode = (await pResp.json()) as {
            id?: string;
            name?: string;
            category?: string;
            access_token?: string;
            instagram_business_account?: { id?: string; username?: string; name?: string };
          };
          collectPageNode(pNode);
        }
      } catch {
        // Ignore individual page lookup error
      }
    }
  }

  // 2. Discover Meta Ad Accounts & Pixels
  if (purpose === "meta_ads_pixel" || purpose === "meta_all") {
    try {
      const adResp = await fetch(
        `https://graph.facebook.com/${v}/me/adaccounts?fields=id,account_id,name,currency,account_status&limit=50`,
        {
          headers: { Authorization: `Bearer ${userToken}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (adResp.ok) {
        const adBody = (await adResp.json()) as {
          data?: Array<{
            id?: string;
            account_id?: string;
            name?: string;
            currency?: string;
            account_status?: number;
          }>;
        };
        const rawList = [...(adBody.data ?? [])].filter((a) => Boolean(a.id || a.account_id));
        rawList.sort((a, b) => {
          const score = (x: typeof a) =>
            (x.account_status === 1 ? 10 : 0) + (x.currency === "INR" ? 5 : 0);
          return score(b) - score(a);
        });

        for (let idx = 0; idx < rawList.length; idx += 1) {
          const acc = rawList[idx]!;
          const rawId = acc.id || acc.account_id || "";
          const actId = rawId.startsWith("act_")
            ? rawId
            : `act_${acc.account_id || rawId}`;
          let availablePixels: Array<{ pixelId: string; name: string }> = [];
          if (idx < 6) {
            try {
              const pxResp = await fetch(
                `https://graph.facebook.com/${v}/${encodeURIComponent(actId)}/adspixels?fields=id,name&limit=10`,
                {
                  headers: { Authorization: `Bearer ${userToken}` },
                  signal: AbortSignal.timeout(5000),
                }
              );
              if (pxResp.ok) {
                const pxBody = (await pxResp.json()) as {
                  data?: Array<{ id?: string; name?: string }>;
                };
                availablePixels = (pxBody.data ?? [])
                  .filter((px): px is { id: string; name?: string } => Boolean(px.id))
                  .map((px) => ({
                    pixelId: px.id,
                    name: px.name || `Pixel ${px.id}`,
                  }));
              }
            } catch {
              // Optional pixel lookup
            }
          }

          adAccounts.push({
            adAccountId: actId,
            name: acc.name || `Ad Account ${actId}`,
            currency: acc.currency || "INR",
            pixelId: availablePixels[0]?.pixelId,
            availablePixels,
          });
        }
      }
    } catch {
      // Continue
    }
  }

  // 3. Discover WhatsApp Business Accounts (Owned + Client/Partner + Embedded Signup granular_scopes)
  if (purpose === "whatsapp_cloud" || purpose === "meta_all") {
    const wabaMap = new Map<string, { id: string; name?: string }>();
    for (const wid of debugWabaIds) {
      wabaMap.set(wid, { id: wid });
    }

    try {
      const bizResp = await fetch(
        `https://graph.facebook.com/${v}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name},client_whatsapp_business_accounts{id,name}&limit=25`,
        {
          headers: { Authorization: `Bearer ${userToken}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (bizResp.ok) {
        const bizBody = (await bizResp.json()) as {
          data?: Array<{
            id?: string;
            name?: string;
            owned_whatsapp_business_accounts?: { data?: Array<{ id?: string; name?: string }> };
            client_whatsapp_business_accounts?: { data?: Array<{ id?: string; name?: string }> };
          }>;
        };
        for (const biz of bizBody.data ?? []) {
          for (const w of biz.owned_whatsapp_business_accounts?.data ?? []) {
            if (w.id) wabaMap.set(w.id, { id: w.id, name: w.name });
          }
          for (const w of biz.client_whatsapp_business_accounts?.data ?? []) {
            if (w.id && !wabaMap.has(w.id)) {
              wabaMap.set(w.id, { id: w.id, name: w.name });
            }
          }
        }
      }
    } catch {
      // Continue with any debug_token WABAs
    }

    const seenPhones = new Set<string>();
    for (const waba of Array.from(wabaMap.values()).slice(0, 15)) {
      try {
        const phoneResp = await fetch(
          `https://graph.facebook.com/${v}/${encodeURIComponent(waba.id)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=20`,
          {
            headers: { Authorization: `Bearer ${userToken}` },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (phoneResp.ok) {
          const phoneBody = (await phoneResp.json()) as {
            data?: Array<{
              id?: string;
              display_phone_number?: string;
              verified_name?: string;
            }>;
          };
          for (const ph of phoneBody.data ?? []) {
            if (!ph.id || seenPhones.has(ph.id)) continue;
            seenPhones.add(ph.id);
            wabaPhones.push({
              phoneNumberId: ph.id,
              displayPhone: ph.display_phone_number || ph.id,
              verifiedName:
                ph.verified_name ||
                waba.name ||
                `WhatsApp (${ph.display_phone_number || ph.id})`,
              wabaId: waba.id,
              wabaName: waba.name,
            });
          }
        }
      } catch {
        // Ignore individual WABA lookup error
      }
    }
  }

  return {
    pages,
    instagramAccounts,
    adAccounts,
    wabaPhones,
  };
}

export async function completeMetaOAuthConnection(params: {
  workspaceId: string;
  actorId: string;
  code: string;
  redirectUri: string;
  purpose: MetaOAuthPurpose;
}): Promise<{
  connectedLabels: string[];
  summaryMessage: string;
}> {
  const cfg = getPlatformMetaAppConfig();
  if (!cfg.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Facebook / Meta 1-click sign-in is pending platform setup. Please try again shortly."
    );
  }

  const v = cfg.graphVersion || "v21.0";
  const tokenUrl = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", cfg.appId);
  tokenUrl.searchParams.set("redirect_uri", params.redirectUri);
  tokenUrl.searchParams.set("client_secret", cfg.appSecret);
  tokenUrl.searchParams.set("code", params.code);

  const tokenResp = await fetch(tokenUrl.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(10000),
  });
  const tokenData = (await tokenResp.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };

  if (!tokenResp.ok || !tokenData.access_token) {
    throw new RslError(
      "RSL-VAL-1001",
      `Facebook sign-in could not be completed: ${tokenData.error?.message || `HTTP ${tokenResp.status}`}. Please try signing in again.`
    );
  }

  // Upgrade short-lived user token to 60-day long-lived user token
  let userToken = tokenData.access_token;
  let expiresInSec = Number(tokenData.expires_in || 5_184_000);
  try {
    const exchangeUrl = new URL(`https://graph.facebook.com/${v}/oauth/access_token`);
    exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchangeUrl.searchParams.set("client_id", cfg.appId);
    exchangeUrl.searchParams.set("client_secret", cfg.appSecret);
    exchangeUrl.searchParams.set("fb_exchange_token", userToken);
    const exResp = await fetch(exchangeUrl.toString(), { signal: AbortSignal.timeout(8000) });
    if (exResp.ok) {
      const exData = (await exResp.json()) as { access_token?: string; expires_in?: number };
      if (exData.access_token) {
        userToken = exData.access_token;
        expiresInSec = Number(exData.expires_in || 5_184_000);
      }
    }
  } catch {
    // Keep initial userToken if exchange fails
  }

  const db = controlDb();
  const now = Date.now();
  const metaOAuthStarted = now;
  const userExpiresAt = now + Math.max(86_400, expiresInSec) * 1000;
  const connectedLabels: string[] = [];

  const findExistingChannel = (provider: "meta" | "whatsapp", channelKind: ConnectionChannelKind) => {
    const existingRows = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, params.workspaceId),
          eq(controlSchema.connections.provider, provider)
        )
      )
      .all();
    return existingRows.find((r) => parseMetadataSafe(r.metadataJson).channelKind === channelKind);
  };

  const upsertDiscoveredChannel = (item: {
    provider: "meta" | "whatsapp";
    channelKind: ConnectionChannelKind;
    displayName: string;
    externalAccountId: string;
    accessToken: string;
    expiresAt: number | null;
    scopes: string[];
    meta: ConnectionMetadata;
  }) => {
    const existingRows = db
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, params.workspaceId),
          eq(controlSchema.connections.provider, item.provider)
        )
      )
      .all();

    const existing =
      existingRows.find((r) => parseMetadataSafe(r.metadataJson).channelKind === item.channelKind) ??
      existingRows.find((r) => r.externalAccountId === item.externalAccountId);

    const enc = encryptEnvelope(
      JSON.stringify({
        accessToken: item.accessToken,
        oauthUserToken: userToken,
        issuedAt: now,
      } satisfies StoredTokenPayload)
    );
    const fullMeta: ConnectionMetadata = {
      ...item.meta,
      channelKind: item.channelKind,
      oauthConnected: true,
      maskedTokenHint: maskSecretToken(item.accessToken),
      tokenMode: "live",
      lastLiveCheckMessage: `Connected via 1-Click Facebook Login (${item.displayName}).`,
      lastLiveCheckedAccountName: item.displayName,
    };

    const connId = existing?.id ?? newId();
    if (existing) {
      db.update(controlSchema.connections)
        .set({
          displayName: item.displayName,
          externalAccountId: item.externalAccountId,
          encryptedTokens: enc,
          scopesGrantedJson: JSON.stringify(item.scopes),
          metadataJson: JSON.stringify(fullMeta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt: item.expiresAt,
          updatedAt: now,
        })
        .where(eq(controlSchema.connections.id, existing.id))
        .run();
    } else {
      db.insert(controlSchema.connections)
        .values({
          id: connId,
          workspaceId: params.workspaceId,
          provider: item.provider,
          displayName: item.displayName,
          externalAccountId: item.externalAccountId,
          encryptedTokens: enc,
          scopesGrantedJson: JSON.stringify(item.scopes),
          metadataJson: JSON.stringify(fullMeta),
          status: "healthy",
          lastHealthCheckAt: now,
          expiresAt: item.expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    upsertRoutingEntry(item.provider, item.externalAccountId, params.workspaceId, now);
    if (fullMeta.pageId) upsertRoutingEntry("meta", fullMeta.pageId, params.workspaceId, now);
    if (fullMeta.igUserId) upsertRoutingEntry("meta", fullMeta.igUserId, params.workspaceId, now);
    if (fullMeta.wabaId) upsertRoutingEntry("whatsapp", fullMeta.wabaId, params.workspaceId, now);
    if (fullMeta.phoneNumberId) {
      upsertRoutingEntry("whatsapp", fullMeta.phoneNumberId, params.workspaceId, now);
    }

    connectedLabels.push(item.displayName);
  };

  const discovered = await discoverMetaGraphAssets({
    userToken,
    graphVersion: v,
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    purpose: params.purpose,
  });

  const cleanPages: MetaDiscoveredPageSummary[] = discovered.pages.map(
    ({ pageAccessToken: _pt, ...rest }) => rest
  );
  const cleanIgAccounts: MetaDiscoveredInstagramSummary[] = discovered.instagramAccounts.map(
    ({ pageAccessToken: _pt, ...rest }) => rest
  );

  let primaryPageId: string | undefined = discovered.pages[0]?.pageId;

  // 1. Facebook Page
  if (
    discovered.pages.length > 0 &&
    (params.purpose === "facebook_page" || params.purpose === "meta_all")
  ) {
    const existingFb = findExistingChannel("meta", "facebook_page");
    const prevPageId = existingFb ? parseMetadataSafe(existingFb.metadataJson).pageId : undefined;
    const chosenPage =
      discovered.pages.find((p) => p.pageId === prevPageId) ?? discovered.pages[0]!;
    primaryPageId = chosenPage.pageId;

    const pageSubscribed = await autoSubscribeMetaWebhookAsset({
      graphVersion: v,
      assetType: "page",
      assetId: chosenPage.pageId,
      accessToken: chosenPage.pageAccessToken,
    });

    upsertDiscoveredChannel({
      provider: "meta",
      channelKind: "facebook_page",
      displayName: chosenPage.pageName,
      externalAccountId: chosenPage.pageId,
      accessToken: chosenPage.pageAccessToken,
      expiresAt: null,
      scopes: ["pages_show_list", "pages_manage_posts", "pages_messaging", "leads_retrieval"],
      meta: {
        pageId: chosenPage.pageId,
        pageName: chosenPage.pageName,
        primaryCategory: chosenPage.category,
        availableMetaPages: cleanPages,
        webhookAutoSubscribed: pageSubscribed,
      },
    });
  }

  // 2. Instagram Business Account
  if (
    discovered.instagramAccounts.length > 0 &&
    (params.purpose === "instagram_business" || params.purpose === "meta_all")
  ) {
    const existingIg = findExistingChannel("meta", "instagram_business");
    const prevIgId = existingIg ? parseMetadataSafe(existingIg.metadataJson).igUserId : undefined;
    const chosenIg =
      discovered.instagramAccounts.find((ig) => ig.igUserId === prevIgId) ??
      discovered.instagramAccounts[0]!;
    const igDisplay = chosenIg.igUsername
      ? `@${chosenIg.igUsername}`
      : chosenIg.name || `Instagram (${chosenIg.igUserId})`;

    const igPageSubscribed = await autoSubscribeMetaWebhookAsset({
      graphVersion: v,
      assetType: "page",
      assetId: chosenIg.linkedPageId,
      accessToken: chosenIg.pageAccessToken,
    });

    upsertDiscoveredChannel({
      provider: "meta",
      channelKind: "instagram_business",
      displayName: igDisplay,
      externalAccountId: chosenIg.igUserId,
      accessToken: chosenIg.pageAccessToken,
      expiresAt: null,
      scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages"],
      meta: {
        igUserId: chosenIg.igUserId,
        igHandle: chosenIg.igUsername ? `@${chosenIg.igUsername}` : undefined,
        linkedPageId: chosenIg.linkedPageId,
        pageId: chosenIg.linkedPageId,
        pageName: chosenIg.linkedPageName,
        availableInstagramAccounts: cleanIgAccounts,
        webhookAutoSubscribed: igPageSubscribed,
      },
    });
  }

  // 3. Meta Ad Accounts & Pixels
  if (
    discovered.adAccounts.length > 0 &&
    (params.purpose === "meta_ads_pixel" || params.purpose === "meta_all")
  ) {
    const existingAds = findExistingChannel("meta", "meta_ads_pixel");
    const prevAdsMeta = existingAds ? parseMetadataSafe(existingAds.metadataJson) : undefined;
    const chosenAdAcc =
      discovered.adAccounts.find((a) => a.adAccountId === prevAdsMeta?.adAccountId) ??
      discovered.adAccounts[0]!;
    const chosenPixelId =
      (prevAdsMeta?.pixelId &&
      chosenAdAcc.availablePixels?.some((px) => px.pixelId === prevAdsMeta.pixelId)
        ? prevAdsMeta.pixelId
        : chosenAdAcc.pixelId) || undefined;
    const adLabel = `${chosenAdAcc.name} (${chosenAdAcc.adAccountId})`;

    upsertDiscoveredChannel({
      provider: "meta",
      channelKind: "meta_ads_pixel",
      displayName: adLabel,
      externalAccountId: chosenAdAcc.adAccountId,
      accessToken: userToken,
      expiresAt: userExpiresAt,
      scopes: ["ads_management", "ads_read", "business_management", "leads_retrieval"],
      meta: {
        adAccountId: chosenAdAcc.adAccountId,
        pixelId: chosenPixelId,
        pageId: primaryPageId,
        currencyCode: chosenAdAcc.currency || "INR",
        availableMetaAdAccounts: discovered.adAccounts,
      },
    });
  }

  // 4. WhatsApp Business Accounts (WABA) & Phone Numbers
  if (
    discovered.wabaPhones.length > 0 &&
    (params.purpose === "whatsapp_cloud" || params.purpose === "meta_all")
  ) {
    const existingWa = findExistingChannel("whatsapp", "whatsapp_cloud");
    const prevPhoneId = existingWa
      ? parseMetadataSafe(existingWa.metadataJson).phoneNumberId
      : undefined;
    const chosenPhone =
      discovered.wabaPhones.find((ph) => ph.phoneNumberId === prevPhoneId) ??
      discovered.wabaPhones[0]!;

    const wabaSubscribed = await autoSubscribeMetaWebhookAsset({
      graphVersion: v,
      assetType: "waba",
      assetId: chosenPhone.wabaId,
      accessToken: userToken,
    });

    upsertDiscoveredChannel({
      provider: "whatsapp",
      channelKind: "whatsapp_cloud",
      displayName: chosenPhone.verifiedName,
      externalAccountId: chosenPhone.phoneNumberId,
      accessToken: userToken,
      expiresAt: userExpiresAt,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      meta: {
        wabaId: chosenPhone.wabaId,
        phoneNumberId: chosenPhone.phoneNumberId,
        displayPhone: chosenPhone.displayPhone,
        metaAppId: cfg.appId,
        availableWabaPhones: discovered.wabaPhones,
        webhookAutoSubscribed: wabaSubscribed,
      },
    });
  }

  const summaryMessage =
    connectedLabels.length > 0
      ? `Connected via 1-Click Facebook Login: ${connectedLabels.join(" • ")}`
      : "Signed in with Facebook, but no Facebook Pages, Instagram Business profiles, Ad Accounts, or WhatsApp Business numbers were found on this account. Make sure you sign in with the Facebook profile that manages your business assets.";

  appendActionLog({
    workspaceId: params.workspaceId,
    actorType: "user",
    actorId: params.actorId,
    source: "web",
    action: "connections.linked",
    outcome: "success",
    requestId: newId(),
    correlationId: newId(),
    durationMs: Date.now() - metaOAuthStarted,
    summary: summaryMessage,
  });

  return {
    connectedLabels,
    summaryMessage,
  };
}

export async function selectMetaChannelAsset(params: {
  workspaceId: string;
  actorId: string;
  connectionId: string;
  assetId: string;
  secondaryPixelId?: string;
}): Promise<{
  connectionId: string;
  channelKind: ConnectionChannelKind;
  displayName: string;
  externalAccountId: string;
  webhookAutoSubscribed: boolean;
}> {
  const switchStarted = Date.now();
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, params.connectionId),
        eq(controlSchema.connections.workspaceId, params.workspaceId)
      )
    )
    .get();

  if (!conn) {
    throw new RslError("RSL-VAL-1001", "Connected channel not found in this workspace.");
  }

  const meta = parseMetadataSafe(conn.metadataJson);
  const channelKind =
    meta.channelKind ||
    (conn.provider === "whatsapp" ? "whatsapp_cloud" : "facebook_page");

  let stored: StoredTokenPayload = { accessToken: "", issuedAt: Date.now() };
  try {
    stored = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
  } catch {
    throw new RslError(
      "RSL-VAL-1001",
      "Stored connection credentials could not be read. Please reconnect with 1-Click Facebook Login."
    );
  }

  const cfg = getPlatformMetaAppConfig();
  const v = cfg.graphVersion || "v21.0";
  const userToken = stored.oauthUserToken || stored.accessToken;
  const now = Date.now();

  let nextDisplayName = conn.displayName;
  let nextExternalId = conn.externalAccountId;
  let nextAccessToken = stored.accessToken;
  let webhookAutoSubscribed = Boolean(meta.webhookAutoSubscribed);

  if (channelKind === "facebook_page") {
    const targetPage = (meta.availableMetaPages ?? []).find(
      (p) => p.pageId === params.assetId
    );
    if (!targetPage) {
      throw new RslError("RSL-VAL-1001", "Selected Facebook Page was not found in your discovered pages.");
    }
    nextDisplayName = targetPage.pageName;
    nextExternalId = targetPage.pageId;

    if (userToken && !isWorkspaceSandboxIntegrationMode(params.workspaceId, userToken)) {
      try {
        const pResp = await fetchWithRetry(
          `https://graph.facebook.com/${v}/${encodeURIComponent(targetPage.pageId)}?fields=access_token,name`,
          {
            headers: { Authorization: `Bearer ${userToken}` },
            timeoutMs: 6000,
            maxRetries: 2,
          }
        );
        if (pResp.ok) {
          const pData = (await pResp.json()) as { access_token?: string; name?: string };
          if (pData.access_token) nextAccessToken = pData.access_token;
          if (pData.name) nextDisplayName = pData.name;
        }
      } catch {
        // Keep current token on offline/network error
      }
      webhookAutoSubscribed = await autoSubscribeMetaWebhookAsset({
        graphVersion: v,
        assetType: "page",
        assetId: targetPage.pageId,
        accessToken: nextAccessToken,
      });
    }

    meta.pageId = targetPage.pageId;
    meta.pageName = nextDisplayName;
    meta.primaryCategory = targetPage.category;
    meta.webhookAutoSubscribed = webhookAutoSubscribed;
    upsertRoutingEntry("meta", targetPage.pageId, params.workspaceId, now);
  } else if (channelKind === "instagram_business") {
    const targetIg = (meta.availableInstagramAccounts ?? []).find(
      (ig) => ig.igUserId === params.assetId
    );
    if (!targetIg) {
      throw new RslError(
        "RSL-VAL-1001",
        "Selected Instagram Business account was not found in your discovered accounts."
      );
    }
    nextDisplayName = targetIg.igUsername
      ? `@${targetIg.igUsername}`
      : targetIg.name || `Instagram (${targetIg.igUserId})`;
    nextExternalId = targetIg.igUserId;

    if (userToken && !isWorkspaceSandboxIntegrationMode(params.workspaceId, userToken)) {
      try {
        const pResp = await fetchWithRetry(
          `https://graph.facebook.com/${v}/${encodeURIComponent(targetIg.linkedPageId)}?fields=access_token`,
          {
            headers: { Authorization: `Bearer ${userToken}` },
            timeoutMs: 6000,
            maxRetries: 2,
          }
        );
        if (pResp.ok) {
          const pData = (await pResp.json()) as { access_token?: string };
          if (pData.access_token) nextAccessToken = pData.access_token;
        }
      } catch {
        // Keep current token
      }
      webhookAutoSubscribed = await autoSubscribeMetaWebhookAsset({
        graphVersion: v,
        assetType: "page",
        assetId: targetIg.linkedPageId,
        accessToken: nextAccessToken,
      });
    }

    meta.igUserId = targetIg.igUserId;
    meta.igHandle = targetIg.igUsername ? `@${targetIg.igUsername}` : undefined;
    meta.linkedPageId = targetIg.linkedPageId;
    meta.pageId = targetIg.linkedPageId;
    meta.pageName = targetIg.linkedPageName;
    meta.webhookAutoSubscribed = webhookAutoSubscribed;
    upsertRoutingEntry("meta", targetIg.igUserId, params.workspaceId, now);
    upsertRoutingEntry("meta", targetIg.linkedPageId, params.workspaceId, now);
  } else if (channelKind === "meta_ads_pixel") {
    const targetAd = (meta.availableMetaAdAccounts ?? []).find(
      (a) => a.adAccountId === params.assetId
    );
    if (!targetAd) {
      throw new RslError(
        "RSL-VAL-1001",
        "Selected Meta Ad Account was not found in your discovered ad accounts."
      );
    }
    const chosenPixel =
      params.secondaryPixelId !== undefined
        ? params.secondaryPixelId.trim() || undefined
        : targetAd.pixelId;
    nextDisplayName = `${targetAd.name} (${targetAd.adAccountId})`;
    nextExternalId = targetAd.adAccountId;
    meta.adAccountId = targetAd.adAccountId;
    meta.currencyCode = targetAd.currency || meta.currencyCode || "INR";
    meta.pixelId = chosenPixel;
    upsertRoutingEntry("meta", targetAd.adAccountId, params.workspaceId, now);
  } else if (channelKind === "whatsapp_cloud") {
    const targetPhone = (meta.availableWabaPhones ?? []).find(
      (ph) => ph.phoneNumberId === params.assetId
    );
    if (!targetPhone) {
      throw new RslError(
        "RSL-VAL-1001",
        "Selected WhatsApp Business number was not found in your discovered numbers."
      );
    }
    nextDisplayName = targetPhone.verifiedName;
    nextExternalId = targetPhone.phoneNumberId;

    if (userToken && !isWorkspaceSandboxIntegrationMode(params.workspaceId, userToken)) {
      webhookAutoSubscribed = await autoSubscribeMetaWebhookAsset({
        graphVersion: v,
        assetType: "waba",
        assetId: targetPhone.wabaId,
        accessToken: userToken,
      });
    }

    meta.wabaId = targetPhone.wabaId;
    meta.phoneNumberId = targetPhone.phoneNumberId;
    meta.displayPhone = targetPhone.displayPhone;
    meta.webhookAutoSubscribed = webhookAutoSubscribed;
    upsertRoutingEntry("whatsapp", targetPhone.phoneNumberId, params.workspaceId, now);
    upsertRoutingEntry("whatsapp", targetPhone.wabaId, params.workspaceId, now);
  } else {
    throw new RslError("RSL-VAL-1001", `Channel kind '${channelKind}' does not use Meta asset switching.`);
  }

  meta.maskedTokenHint = maskSecretToken(nextAccessToken);
  meta.lastLiveCheckedAccountName = nextDisplayName;
  meta.lastLiveCheckMessage = `Active asset switched to ${nextDisplayName}.`;

  const nextEnc = encryptEnvelope(
    JSON.stringify({
      accessToken: nextAccessToken,
      oauthUserToken: stored.oauthUserToken,
      refreshToken: stored.refreshToken,
      issuedAt: now,
    } satisfies StoredTokenPayload)
  );

  db.update(controlSchema.connections)
    .set({
      displayName: nextDisplayName,
      externalAccountId: nextExternalId,
      encryptedTokens: nextEnc,
      metadataJson: JSON.stringify(meta),
      status: "healthy",
      updatedAt: now,
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  appendActionLog({
    workspaceId: params.workspaceId,
    actorType: "user",
    actorId: params.actorId,
    source: "web",
    action: "connections.updated",
    outcome: "success",
    requestId: newId(),
    correlationId: newId(),
    durationMs: Date.now() - switchStarted,
    summary: `Switched active ${channelKind} asset to ${nextDisplayName} (${nextExternalId})`,
  });

  return {
    connectionId: conn.id,
    channelKind,
    displayName: nextDisplayName,
    externalAccountId: nextExternalId,
    webhookAutoSubscribed,
  };
}

export async function refreshMetaChannelAssets(params: {
  workspaceId: string;
  actorId: string;
  connectionId: string;
}): Promise<{
  connectionId: string;
  discoveredCount: number;
  summaryMessage: string;
}> {
  const switchStarted = Date.now();
  const db = controlDb();
  const conn = db
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.id, params.connectionId),
        eq(controlSchema.connections.workspaceId, params.workspaceId)
      )
    )
    .get();

  if (!conn) {
    throw new RslError("RSL-VAL-1001", "Connected channel not found in this workspace.");
  }

  let stored: StoredTokenPayload;
  try {
    stored = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
  } catch {
    throw new RslError(
      "RSL-VAL-1001",
      "Stored connection credentials could not be read. Click 'Reconnect with Facebook' to refresh."
    );
  }

  const userToken = stored.oauthUserToken || stored.accessToken;
  if (!userToken) {
    throw new RslError("RSL-VAL-1001", "No OAuth token available. Click 'Reconnect with Facebook'.");
  }

  const cfg = getPlatformMetaAppConfig();
  const meta = parseMetadataSafe(conn.metadataJson);
  const channelKind =
    meta.channelKind ||
    (conn.provider === "whatsapp" ? "whatsapp_cloud" : "facebook_page");

  const purposeMap: Record<string, MetaOAuthPurpose> = {
    facebook_page: "facebook_page",
    instagram_business: "instagram_business",
    meta_ads_pixel: "meta_ads_pixel",
    whatsapp_cloud: "whatsapp_cloud",
  };
  const purpose = purposeMap[channelKind] || "meta_all";

  const discovered = await discoverMetaGraphAssets({
    userToken,
    graphVersion: cfg.graphVersion || "v21.0",
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    purpose,
  });

  let discoveredCount = 0;
  if (channelKind === "facebook_page") {
    meta.availableMetaPages = discovered.pages.map(({ pageAccessToken: _pt, ...rest }) => rest);
    discoveredCount = meta.availableMetaPages.length;
  } else if (channelKind === "instagram_business") {
    meta.availableInstagramAccounts = discovered.instagramAccounts.map(
      ({ pageAccessToken: _pt, ...rest }) => rest
    );
    discoveredCount = meta.availableInstagramAccounts.length;
  } else if (channelKind === "meta_ads_pixel") {
    meta.availableMetaAdAccounts = discovered.adAccounts;
    discoveredCount = meta.availableMetaAdAccounts.length;
  } else if (channelKind === "whatsapp_cloud") {
    meta.availableWabaPhones = discovered.wabaPhones;
    discoveredCount = meta.availableWabaPhones.length;
  }

  const summaryMessage =
    discoveredCount > 0
      ? `Synced ${discoveredCount} business asset${discoveredCount === 1 ? "" : "s"} from Facebook.`
      : "No additional assets returned by Facebook for this channel.";
  meta.lastLiveCheckMessage = summaryMessage;

  db.update(controlSchema.connections)
    .set({
      metadataJson: JSON.stringify(meta),
      lastHealthCheckAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.connections.id, conn.id))
    .run();

  return {
    connectionId: conn.id,
    discoveredCount,
    summaryMessage,
  };
}
