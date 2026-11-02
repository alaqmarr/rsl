import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import Redis from "ioredis";
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from "rate-limiter-flexible";
import { z } from "zod";
import { requireEntitlement } from "@rsl/billing";
import { getEnv, hashApiKey, newEntityId, RslError, sanitizeClientTag } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { controlDb, type TenantContext } from "@rsl/tenancy";

export const API_SCOPES = [
  { key: "contacts:read", label: "Read customer contacts" },
  { key: "contacts:write", label: "Create and update customer contacts" },
  { key: "vouchers:read", label: "Read Tally bills and payment receipts" },
  { key: "vouchers:write", label: "Push Tally bills and payment updates" },
  { key: "whatsapp:read", label: "Read WhatsApp Business templates" },
  { key: "whatsapp:write", label: "Create WhatsApp templates and send template messages" },
  { key: "messages:write", label: "Send approved WhatsApp notifications" },
  { key: "analytics:read", label: "Read business analytics summaries" },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["key"];

const ALPHANUM = "0123456789abcdefghjkmnpqrstvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

function randomBase58(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHANUM[bytes[i]! % ALPHANUM.length]!;
  }
  return out;
}

let sharedRedisClient: Redis | null | undefined;
const limiterByRpm = new Map<number, RateLimiterAbstract>();

function getRateLimiter(pointsPerMin: number): RateLimiterAbstract {
  const rpm = Math.max(10, Math.min(6000, pointsPerMin));
  const existing = limiterByRpm.get(rpm);
  if (existing) return existing;

  const env = getEnv();
  if (sharedRedisClient === undefined) {
    sharedRedisClient = env.REDIS_URL
      ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : null;
  }

  const limiter = sharedRedisClient
    ? new RateLimiterRedis({
        storeClient: sharedRedisClient,
        keyPrefix: `rsl:apikey:${rpm}`,
        points: rpm,
        duration: 60,
        insuranceLimiter: new RateLimiterMemory({ points: rpm, duration: 60 }),
      })
    : new RateLimiterMemory({
        keyPrefix: `rsl:apikey:${rpm}`,
        points: rpm,
        duration: 60,
      });

  limiterByRpm.set(rpm, limiter);
  return limiter;
}

export function listWorkspaceApiKeys(workspaceId: string) {
  return controlDb()
    .select()
    .from(controlSchema.apiKeys)
    .where(eq(controlSchema.apiKeys.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.apiKeys.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      mode: row.mode as "live" | "test",
      maskedKey: `rsl_${row.mode}_${row.prefix}_••••••••••••••••••••`,
      prefix: row.prefix,
      scopes: JSON.parse(row.scopesJson) as string[],
      rateLimitPerMin: row.rateLimitPerMin,
      lastUsedAt: row.lastUsedAt,
      lastUsedIp: row.lastUsedIp,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      status: row.revokedAt
        ? "revoked"
        : row.expiresAt && row.expiresAt < Date.now()
          ? "expired"
          : "active",
    }));
}

export const issueApiKey = defineAction({
  key: "apikeys.created",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    name: z.string().trim().min(2, "Enter a descriptive key name (e.g. Website Checkout or ERP Bridge)").max(80),
    mode: z.enum(["live", "test"]).default("live"),
    scopes: z.array(z.string()).min(1, "Select at least one permission scope for this API key"),
    rateLimitPerMin: z.coerce.number().int().min(10).max(1200).default(120),
    expiresInDays: z.coerce.number().int().min(0).max(1095).default(0), // 0 = no expiry
  }),
  summarize: (input) => `Issued ${input.mode.toUpperCase()} developer API key "${input.name}"`,
  handler: (ctx, input) => {
    const db = controlDb();
    const clientTag = sanitizeClientTag(ctx.workspaceId);
    const prefix = `${clientTag}${randomBase58(6).toLowerCase()}`;
    const secretPart = randomBase58(28);
    const rawKey = `rsl_${input.mode}_${prefix}_${secretPart}`;
    const secretHash = hashApiKey(rawKey);
    const now = Date.now();
    const id = newEntityId("key", ctx.workspaceId, now);
    const expiresAt = input.expiresInDays > 0 ? now + input.expiresInDays * 86_400_000 : null;

    db.insert(controlSchema.apiKeys)
      .values({
        id,
        workspaceId: ctx.workspaceId,
        name: input.name,
        mode: input.mode,
        prefix,
        secretHash,
        scopesJson: JSON.stringify(input.scopes),
        rateLimitPerMin: input.rateLimitPerMin,
        createdByUserId: ctx.actorId,
        expiresAt,
        createdAt: now,
      })
      .run();

    return {
      id,
      name: input.name,
      mode: input.mode,
      prefix,
      rawKey, // Returned ONCE at creation time — never stored in plaintext
      scopes: input.scopes,
      expiresAt,
    };
  },
});

export const revokeApiKey = defineAction({
  key: "apikeys.revoked",
  permission: "apikeys:manage",
  input: z.object({
    keyId: z.string().min(8),
  }),
  summarize: (input) => `Revoked developer API key ${input.keyId}`,
  handler: (ctx, input) => {
    const db = controlDb();
    const existing = db
      .select()
      .from(controlSchema.apiKeys)
      .where(and(eq(controlSchema.apiKeys.id, input.keyId), eq(controlSchema.apiKeys.workspaceId, ctx.workspaceId)))
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "API key not found for this business.");
    }

    const revokedAt = Date.now();
    db.update(controlSchema.apiKeys)
      .set({ revokedAt })
      .where(eq(controlSchema.apiKeys.id, existing.id))
      .run();

    return { id: existing.id, revokedAt };
  },
});

export const rotateApiKey = defineAction({
  key: "apikeys.rotated",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    keyId: z.string().min(8),
  }),
  summarize: (_in, out?: { name: string }) =>
    `Rotated developer API key "${out?.name ?? "key"}" and revoked previous secret`,
  handler: (ctx, input) => {
    const db = controlDb();
    const existing = db
      .select()
      .from(controlSchema.apiKeys)
      .where(
        and(
          eq(controlSchema.apiKeys.id, input.keyId),
          eq(controlSchema.apiKeys.workspaceId, ctx.workspaceId),
          isNull(controlSchema.apiKeys.revokedAt)
        )
      )
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Active API key not found for rotation.");
    }

    const now = Date.now();
    const clientTag = sanitizeClientTag(ctx.workspaceId);
    const mode = existing.mode === "test" ? "test" : "live";
    const prefix = `${clientTag}${randomBase58(6).toLowerCase()}`;
    const secretPart = randomBase58(28);
    const rawKey = `rsl_${mode}_${prefix}_${secretPart}`;
    const secretHash = hashApiKey(rawKey);
    const newKeyId = newEntityId("key", ctx.workspaceId, now);

    const tx = db.$client.transaction(() => {
      db.update(controlSchema.apiKeys)
        .set({ revokedAt: now })
        .where(eq(controlSchema.apiKeys.id, existing.id))
        .run();

      db.insert(controlSchema.apiKeys)
        .values({
          id: newKeyId,
          workspaceId: ctx.workspaceId,
          name: existing.name,
          mode,
          prefix,
          secretHash,
          scopesJson: existing.scopesJson,
          rateLimitPerMin: existing.rateLimitPerMin,
          createdByUserId: ctx.actorId,
          expiresAt: existing.expiresAt,
          createdAt: now,
        })
        .run();
    });
    tx.immediate();

    return {
      revokedKeyId: existing.id,
      id: newKeyId,
      name: existing.name,
      mode,
      prefix,
      rawKey,
    };
  },
});

export interface AuthenticatedApiKeyResult {
  keyId: string;
  workspaceId: string;
  mode: "live" | "test";
  scopes: string[];
  rateLimitRemaining: number;
  ctx: TenantContext;
}

/**
 * Verifies an inbound `Authorization: Bearer rsl_live_<prefix>_<secret>` header
 * using constant-time HMAC comparison, checks plan status & scope, and enforces per-key rate limits.
 */
export async function authenticatePublicApiKey(params: {
  authorizationHeader: string | null;
  requiredScope: ApiScope;
  clientIp?: string | null;
}): Promise<AuthenticatedApiKeyResult> {
  if (!params.authorizationHeader || !params.authorizationHeader.startsWith("Bearer ")) {
    throw new RslError("RSL-API-1001", "Missing Authorization: Bearer rsl_live_... header.");
  }

  const rawKey = params.authorizationHeader.slice("Bearer ".length).trim();
  const match = /^rsl_(live|test)_([a-zA-Z0-9]{4,24})_([a-zA-Z0-9]{16,64})$/.exec(rawKey);
  if (!match) {
    throw new RslError("RSL-API-1001", "Malformed API key format.");
  }

  const mode = match[1] as "live" | "test";
  const prefix = match[2]!;
  const db = controlDb();

  const candidate = db
    .select()
    .from(controlSchema.apiKeys)
    .where(and(eq(controlSchema.apiKeys.prefix, prefix), isNull(controlSchema.apiKeys.revokedAt)))
    .get();

  if (!candidate) {
    throw new RslError("RSL-API-1001");
  }

  const expectedBuf = Buffer.from(candidate.secretHash, "hex");
  const actualBuf = Buffer.from(hashApiKey(rawKey), "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new RslError("RSL-API-1001");
  }

  if (candidate.expiresAt && candidate.expiresAt < Date.now()) {
    throw new RslError("RSL-API-1001", "This API key has expired. Generate a fresh key in Developer API settings.");
  }

  requireEntitlement(candidate.workspaceId, "api.access");

  const scopes = JSON.parse(candidate.scopesJson) as string[];
  if (!scopes.includes(params.requiredScope) && !scopes.includes("*")) {
    throw new RslError(
      "RSL-API-1002",
      `This API key does not include the "${params.requiredScope}" permission scope.`
    );
  }

  const limiter = getRateLimiter(candidate.rateLimitPerMin);
  let rateLimitRemaining = candidate.rateLimitPerMin - 1;
  try {
    const rlRes = await limiter.consume(candidate.id, 1);
    rateLimitRemaining = rlRes.remainingPoints;
  } catch {
    throw new RslError("RSL-API-1003");
  }

  const now = Date.now();
  db.update(controlSchema.apiKeys)
    .set({
      lastUsedAt: now,
      lastUsedIp: params.clientIp ?? null,
    })
    .where(eq(controlSchema.apiKeys.id, candidate.id))
    .run();

  const requestId = newEntityId("req", candidate.workspaceId, now);
  return {
    keyId: candidate.id,
    workspaceId: candidate.workspaceId,
    mode,
    scopes,
    rateLimitRemaining,
    ctx: {
      workspaceId: candidate.workspaceId,
      actorType: "api_key",
      actorId: candidate.id,
      roleSlug: "owner",
      assetScope: null,
      impersonatorId: null,
      correlationId: requestId,
      requestId,
    },
  };
}

export const WEBHOOK_EVENTS = [
  { key: "tally.bill.created", label: "New Tally sales bill synced" },
  { key: "tally.payment.received", label: "Tally payment receipt recorded" },
  { key: "whatsapp.message.received", label: "Inbound customer WhatsApp message" },
  { key: "whatsapp.broadcast.completed", label: "WhatsApp broadcast campaign finished" },
  { key: "review.created", label: "New Google Business review received" },
] as const;

export function computeOutboundWebhookSignature(
  signingSecret: string,
  timestampMs: number,
  rawBody: string
): string {
  const mac = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestampMs}.${rawBody}`)
    .digest("hex");
  return `t=${timestampMs},v1=${mac}`;
}

export function listOutboundWebhookEndpoints(workspaceId: string) {
  return controlDb()
    .select()
    .from(controlSchema.outboundWebhookEndpoints)
    .where(eq(controlSchema.outboundWebhookEndpoints.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.outboundWebhookEndpoints.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      targetUrl: row.targetUrl,
      signingSecret: row.signingSecret,
      events: JSON.parse(row.eventsJson) as string[],
      active: row.active,
      lastDeliveryStatus: row.lastDeliveryStatus,
      lastDeliveredAt: row.lastDeliveredAt,
      createdAt: row.createdAt,
    }));
}

function validateOutboundWebhookUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new RslError("RSL-VAL-1001", "Enter a valid HTTPS webhook URL (for example: https://erp.yourcompany.in/webhooks/rsl).");
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalLoopback = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalLoopback)) {
    throw new RslError(
      "RSL-VAL-1001",
      "Outbound webhook URLs must use https:// (http://localhost is permitted only for local testing)."
    );
  }
  return parsed.toString();
}

export const createOutboundWebhookEndpoint = defineAction({
  key: "webhooks.endpoint.saved",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    name: z.string().trim().min(2, "Enter a descriptive endpoint name").max(80),
    targetUrl: z.string().trim().min(8).max(400),
    events: z.array(z.string()).min(1, "Select at least one event to subscribe to"),
  }),
  summarize: (input) => `Added outbound webhook endpoint "${input.name}"`,
  handler: (ctx, input) => {
    const cleanUrl = validateOutboundWebhookUrl(input.targetUrl);
    const now = Date.now();
    const id = newEntityId("req", ctx.workspaceId, now);
    const signingSecret = `whsec_${randomBase58(28)}`;

    controlDb()
      .insert(controlSchema.outboundWebhookEndpoints)
      .values({
        id,
        workspaceId: ctx.workspaceId,
        name: input.name,
        targetUrl: cleanUrl,
        signingSecret,
        eventsJson: JSON.stringify(input.events),
        active: true,
        createdAt: now,
      })
      .run();

    return { id, signingSecret, targetUrl: cleanUrl };
  },
});

export const deleteOutboundWebhookEndpoint = defineAction({
  key: "webhooks.endpoint.saved",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    endpointId: z.string().min(6),
  }),
  summarize: () => "Removed outbound webhook endpoint",
  handler: (ctx, input) => {
    const db = controlDb();
    const existing = db
      .select()
      .from(controlSchema.outboundWebhookEndpoints)
      .where(
        and(
          eq(controlSchema.outboundWebhookEndpoints.id, input.endpointId),
          eq(controlSchema.outboundWebhookEndpoints.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Webhook endpoint not found for this business.");
    }

    db.delete(controlSchema.outboundWebhookEndpoints)
      .where(eq(controlSchema.outboundWebhookEndpoints.id, existing.id))
      .run();

    return { deleted: true };
  },
});

export const testOutboundWebhookEndpoint = defineAction({
  key: "webhooks.endpoint.tested",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    endpointId: z.string().min(6),
  }),
  summarize: () => "Dispatched signed test event to outbound webhook",
  handler: async (ctx, input) => {
    const db = controlDb();
    const endpoint = db
      .select()
      .from(controlSchema.outboundWebhookEndpoints)
      .where(
        and(
          eq(controlSchema.outboundWebhookEndpoints.id, input.endpointId),
          eq(controlSchema.outboundWebhookEndpoints.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!endpoint) {
      throw new RslError("RSL-VAL-1001", "Webhook endpoint not found.");
    }

    const now = Date.now();
    const payloadObj = {
      id: newEntityId("req", ctx.workspaceId, now),
      event: "webhook.ping",
      workspaceId: ctx.workspaceId,
      createdAt: new Date(now).toISOString(),
      data: {
        message: "Signed test delivery from RSL Marketing",
        subscribedEvents: JSON.parse(endpoint.eventsJson) as string[],
      },
    };
    const rawBody = JSON.stringify(payloadObj);
    const signatureHeader = computeOutboundWebhookSignature(endpoint.signingSecret, now, rawBody);

    let deliveryStatus = "delivered (200)";
    try {
      const resp = await fetch(endpoint.targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RSL-Marketing-Webhooks/1.0",
          "X-RSL-Signature": signatureHeader,
          "X-RSL-Event": "webhook.ping",
        },
        body: rawBody,
        signal: AbortSignal.timeout(4000),
      });
      deliveryStatus = resp.ok ? `HTTP ${resp.status} OK` : `HTTP ${resp.status}`;
    } catch {
      deliveryStatus = "Unreachable (signed payload prepared)";
    }

    db.update(controlSchema.outboundWebhookEndpoints)
      .set({
        lastDeliveryStatus: deliveryStatus,
        lastDeliveredAt: now,
      })
      .where(eq(controlSchema.outboundWebhookEndpoints.id, endpoint.id))
      .run();

    return {
      endpointId: endpoint.id,
      deliveryStatus,
      signatureHeader,
    };
  },
});

/**
 * Dispatches a live signed outbound webhook event to all active endpoints subscribed
 * to `eventType` (or `"*"`) for the given workspace. Updates `lastDeliveryStatus`
 * and `lastDeliveredAt` on each matching endpoint without throwing to the caller.
 */
export async function dispatchWorkspaceWebhookEvent(
  workspaceId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<number> {
  const db = controlDb();
  const endpoints = db
    .select()
    .from(controlSchema.outboundWebhookEndpoints)
    .where(
      and(
        eq(controlSchema.outboundWebhookEndpoints.workspaceId, workspaceId),
        eq(controlSchema.outboundWebhookEndpoints.active, true)
      )
    )
    .all();

  if (endpoints.length === 0) return 0;

  let deliveredCount = 0;
  for (const endpoint of endpoints) {
    let subscribed: string[] = [];
    try {
      subscribed = JSON.parse(endpoint.eventsJson) as string[];
    } catch {
      subscribed = [];
    }
    if (!subscribed.includes(eventType) && !subscribed.includes("*")) {
      continue;
    }

    const now = Date.now();
    const payloadObj = {
      id: newEntityId("req", workspaceId, now),
      event: eventType,
      workspaceId,
      createdAt: new Date(now).toISOString(),
      data,
    };
    const rawBody = JSON.stringify(payloadObj);
    const signatureHeader = computeOutboundWebhookSignature(endpoint.signingSecret, now, rawBody);

    let deliveryStatus = "HTTP 200 OK";
    try {
      const resp = await fetch(endpoint.targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RSL-Marketing-Webhooks/1.0",
          "X-RSL-Signature": signatureHeader,
          "X-RSL-Event": eventType,
        },
        body: rawBody,
        signal: AbortSignal.timeout(4000),
      });
      deliveryStatus = resp.ok ? `HTTP ${resp.status} OK` : `HTTP ${resp.status}`;
      if (resp.ok) deliveredCount++;
    } catch {
      deliveryStatus = "Unreachable (signed payload prepared)";
    }

    db.update(controlSchema.outboundWebhookEndpoints)
      .set({
        lastDeliveryStatus: deliveryStatus,
        lastDeliveredAt: now,
      })
      .where(eq(controlSchema.outboundWebhookEndpoints.id, endpoint.id))
      .run();
  }

  return deliveredCount;
}
