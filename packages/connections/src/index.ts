import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { decryptEnvelope, encryptEnvelope, getEnv, newId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { controlDb } from "@rsl/tenancy";

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
  driveEmail?: string;
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
          const resp = await fetch(
            `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
            {
              method: "GET",
              signal: AbortSignal.timeout(4500),
            }
          );
          if (resp.ok) {
            nextStatus = "healthy";
            liveMessage = "Verified live with Google OAuth2 Token Info API.";
          } else {
            nextStatus = "needs_reauth";
            liveMessage =
              "Google OAuth2 rejected this token (expired or invalid). Generate a fresh OAuth access token with business.manage / drive.file scope.";
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

    db.update(controlSchema.connections)
      .set({
        status: nextStatus,
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
