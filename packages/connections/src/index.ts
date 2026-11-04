import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { decryptEnvelope, encryptEnvelope, getEnv, newId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { appendActionLog, defineAction } from "@rsl/logging";
import {
  controlDb,
  getPlatformGoogleOAuthConfig,
  getPlatformMetaAppConfig,
} from "@rsl/tenancy";

export interface StoredTokenPayload {
  accessToken: string;
  refreshToken?: string;
  issuedAt: number;
}

export type ConnectionChannelKind =
  | "whatsapp_cloud"
  | "facebook_page"
  | "instagram_business"
  | "meta_ads_pixel"
  | "google_business"
  | "google_drive";

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

export function listWorkspaceConnections(workspaceId: string) {
  const db = controlDb();
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
    .all();

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
  };
}

/**
 * Decrypts tokens strictly inside @rsl/connections (Section 13).
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
        "google_business",
        "google_drive",
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
  })
  .optional();

export const linkExternalConnection = defineAction({
  key: "connections.linked",
  permission: "connections:manage",
  input: z.object({
    provider: z.enum(["meta", "whatsapp", "google", "gdrive"]),
    displayName: z.string().trim().min(2, "Enter a descriptive account label").max(120),
    externalAccountId: z.string().trim().min(2, "Enter the external Account / Phone / Page ID").max(120),
    accessToken: z.string().trim().min(6, "Paste a valid access token (at least 6 characters)"),
    refreshToken: z.string().optional(),
    scopesGranted: z.array(z.string()).default([]),
    assetType: z
      .enum(["fb_page", "ig_account", "ad_account", "pixel", "waba_phone", "gbp_location"])
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
    const isSandbox = /^(rsl_sandbox_|sandbox_|test_)/i.test(cleanToken);

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
      nextMeta.tokenMode = /^(rsl_sandbox_|sandbox_|test_)/i.test(cleanToken) ? "sandbox" : "live";
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
        liveMessage = "Stored access token is empty or malformed — please paste a fresh token.";
      } else if (conn.expiresAt && conn.expiresAt < now) {
        nextStatus = "needs_reauth";
        liveMessage = "Access token validity window has expired — rotate with a fresh token.";
      } else if (conn.expiresAt && conn.expiresAt - now < 7 * 86_400_000) {
        nextStatus = "expiring";
        liveMessage = "Token expires within 7 days — rotate with a Permanent System User token.";
      }
    } catch {
      nextStatus = "needs_reauth";
      liveMessage = "Token envelope could not be decrypted — please re-authenticate this channel.";
    }

    if (input.checkLiveProvider && nextStatus !== "needs_reauth" && accessToken) {
      const isSandbox = /^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken);
      if (isSandbox) {
        meta.tokenMode = "sandbox";
        liveMessage =
          "Sandbox test token verified — ready for local webhook & sandbox workflow testing.";
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
              liveMessage = `Meta Graph API rejected token (Error 190: ${errMsg}). Generate a Permanent System User Token in Meta Business Settings with whitelisted scopes.`;
            } else if (errCode === 10 || errCode === 200 || errCode === 100) {
              liveMessage = `Meta Graph API permission/asset error (Code ${errCode}: ${errMsg}). Complete the Whitelisting Steps (assign asset to System User & enable scopes).`;
            } else {
              liveMessage = `Meta Graph API check failed: ${errMsg}`;
            }
          }
        } catch {
          liveMessage =
            "Vault token intact (Meta Graph API unreachable from current network; check outbound internet or firewall).";
        }
      } else if (conn.provider === "google" || conn.provider === "gdrive") {
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
              // Re-load upgraded metadata & displayName after GBP discovery
              const upgradedRow = db
                .select()
                .from(controlSchema.connections)
                .where(eq(controlSchema.connections.id, conn.id))
                .get();
              if (upgradedRow) {
                Object.assign(meta, parseMetadataSafe(upgradedRow.metadataJson));
              }
              if (gbp.gbpDiscoveryStatus === "verified_locations" && gbp.storeName) {
                liveMessage = `Verified live with Google Business Profile API — ${gbp.storeName}${gbp.storeAddress ? ` (${gbp.storeAddress})` : ""}.`;
              } else if (gbp.gbpDiscoveryDetail) {
                liveMessage = gbp.gbpDiscoveryDetail;
              } else {
                liveMessage =
                  "Verified live with Google OAuth2 API (automatic refresh token active).";
              }
            } else {
              liveMessage =
                "Verified live with Google OAuth2 API (automatic refresh token active).";
            }
          } else {
            nextStatus = "needs_reauth";
            liveMessage =
              conn.provider === "google"
                ? "Google OAuth2 rejected this token. Click 'Reconnect Google' to re-authorize your Google Business Profile in one click."
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

export type GoogleOAuthPurpose = "google_drive" | "google_business";

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
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) return false;
  return purpose === "google_drive" ? cfg.enableDriveOAuth : cfg.enableGbpOAuth;
}

export function buildGoogleOAuthAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  purpose: GoogleOAuthPurpose;
  codeChallenge?: string;
}): string {
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

  const scopes =
    params.purpose === "google_drive"
      ? [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/drive.file",
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

  let stored: StoredTokenPayload;
  try {
    stored = JSON.parse(decryptEnvelope(conn.encryptedTokens)) as StoredTokenPayload;
  } catch {
    return null;
  }

  const now = Date.now();
  const stillFresh = Boolean(conn.expiresAt && conn.expiresAt > now + 90_000 && stored.accessToken);
  if (stillFresh) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    return stored.accessToken || null;
  }

  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    return stored.accessToken || null;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });

  const reconnectCta =
    conn.provider === "google" ? "Reconnect Google" : "Connect to Google Drive";

  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const meta = parseMetadataSafe(conn.metadataJson);
    meta.lastLiveCheckMessage = `Google session expired or was revoked (${errBody.error_description || errBody.error || `HTTP ${resp.status}`}). Click '${reconnectCta}' to reconnect in one click.`;
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
  }

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) {
    const meta = parseMetadataSafe(conn.metadataJson);
    meta.lastLiveCheckMessage = `Google refresh did not return a fresh access token. Click '${reconnectCta}' to reconnect.`;
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
}> {
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
  const expiresAt = now + expiresInSec * 1000;

  if (params.purpose === "google_drive") {
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
          name: `Google Drive — ${email}`,
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
          name: `Google Drive — ${email}`,
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
      durationMs: 15,
      summary: `Connected Google Drive (${email}) via OAuth Consent Screen — folder '${folder.folderName}' ready`,
    });

    return {
      connectionId,
      email,
      displayName,
      folderName: folder.folderName,
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
    durationMs: 15,
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
  if (/^(rsl_sandbox_|sandbox_|test_)/i.test(token)) {
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

  // 1. Account Management API v1 — iterate ALL accounts (PERSONAL, LOCATION_GROUP, ORGANIZATION)
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

  // 2. Wildcard Business Information API v1 (`accounts/-/locations`) — finds locations across ALL account groups
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

  // 3. Per-Account Business Information API v1 — binds exact `accounts/{id}` + `accountName` & discovers Location Groups
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
        ? `Discovered ${availableLocations.length} Google Business locations under ${emailHint || "your Google account"} — active location: ${selectedLoc.title}.`
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
  if (!accessToken || /^(rsl_sandbox_|sandbox_|test_)/i.test(accessToken)) {
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
