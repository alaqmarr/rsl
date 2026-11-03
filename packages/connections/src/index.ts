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
  storeName?: string;
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
    storeName: z.string().optional(),
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
            liveMessage =
              "Verified live with Google OAuth2 API (automatic refresh token active).";
          } else {
            nextStatus = "needs_reauth";
            liveMessage =
              "Google OAuth2 rejected this token. Click 'Connect with Google' to re-authorize your account in one click.";
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
      .select({ encryptedTokens: controlSchema.connections.encryptedTokens, expiresAt: controlSchema.connections.expiresAt })
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
      displayName: conn.displayName,
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

export function buildGoogleOAuthAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  purpose: GoogleOAuthPurpose;
}): string {
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Google OAuth 2.0 is not configured yet on the Staff Portal. Ask your Super Admin to save the Google OAuth Web Client ID & Secret under Staff Portal → OAuth & API Credentials."
    );
  }
  if (params.purpose === "google_drive" && !cfg.enableDriveOAuth) {
    throw new RslError("RSL-VAL-1001", "Google Drive 1-click OAuth is currently disabled by platform admin.");
  }
  if (params.purpose === "google_business" && !cfg.enableGbpOAuth) {
    throw new RslError("RSL-VAL-1001", "Google Business Profile 1-click OAuth is currently disabled by platform admin.");
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

  if (!resp.ok) {
    return stored.accessToken || null;
  }

  const data = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!data.access_token) {
    return stored.accessToken || null;
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
}): Promise<{
  connectionId: string;
  email: string;
  displayName: string;
  folderName?: string;
  locationId?: string;
}> {
  const cfg = getPlatformGoogleOAuthConfig();
  if (!cfg.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Google OAuth credentials are not configured in the platform database."
    );
  }

  const tokenParams = new URLSearchParams({
    code: params.code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
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

  // Google Business Profile (`google_business`) OAuth auto-discovery
  let accountId = "";
  let locationId = "";
  let storeName = "";
  try {
    const accResp = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(7000),
    });
    if (accResp.ok) {
      const accBody = (await accResp.json()) as {
        accounts?: Array<{ name?: string; accountName?: string }>;
      };
      const firstAcc = accBody.accounts?.[0];
      if (firstAcc?.name) {
        accountId = firstAcc.name;
        const locResp = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${firstAcc.name}/locations?readMask=name,title&pageSize=10`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(7000),
          }
        );
        if (locResp.ok) {
          const locBody = (await locResp.json()) as {
            locations?: Array<{ name?: string; title?: string }>;
          };
          const firstLoc = locBody.locations?.[0];
          if (firstLoc?.name) {
            locationId = firstLoc.name;
            storeName = firstLoc.title || "";
          }
        }
      }
    }
  } catch {
    // Graceful fallback if GBP API quota is pending approval
  }

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

  const extId = locationId || accountId || googleSub || email;
  const displayName = storeName ? `${storeName} (${email})` : `Google Business (${email})`;
  const meta: ConnectionMetadata = {
    channelKind: "google_business",
    accountId: accountId || undefined,
    locationId: locationId || undefined,
    storeName: storeName || undefined,
    driveEmail: email,
    googleUserName,
    oauthConnected: true,
    maskedTokenHint: maskSecretToken(accessToken),
    tokenMode: "live",
    lastLiveCheckMessage: locationId
      ? `Connected via Google Consent Screen (${storeName || locationId}).`
      : `Connected Google OAuth (${email}). Enter your store Location ID if you manage multiple branches.`,
    lastLiveCheckedAccountName: storeName || email,
  };

  const connectionId = existingGbp?.id ?? newId();
  if (existingGbp) {
    db.update(controlSchema.connections)
      .set({
        displayName,
        externalAccountId: extId,
        encryptedTokens,
        scopesGrantedJson: JSON.stringify(scopesGranted),
        metadataJson: JSON.stringify(meta),
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
        displayName,
        externalAccountId: extId,
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

  upsertRoutingEntry("google", extId, params.workspaceId, now);

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
    summary: `Connected Google Business Profile (${email}) via OAuth Consent Screen`,
  });

  return {
    connectionId,
    email,
    displayName,
    locationId: locationId || undefined,
  };
}

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
