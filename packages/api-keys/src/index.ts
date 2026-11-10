import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import Redis from "ioredis";
import { RateLimiterMemory, RateLimiterRedis, type RateLimiterAbstract } from "rate-limiter-flexible";
import { z } from "zod";
import { requireEntitlement } from "@rsl/billing";
import { getEnv, hashApiKey, newEntityId, RslError, sanitizeClientTag } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import {
  enqueueJob,
  isRedisConfigured,
  processDueSqliteOutboxForTenant,
  QUEUE_REGISTRY,
  registerJobProcessor,
} from "@rsl/queue";
import { controlDb, type TenantContext } from "@rsl/tenancy";

export const API_SCOPES = [
  { key: "contacts:read", label: "Read customer contacts" },
  { key: "contacts:write", label: "Create and update customer contacts" },
  { key: "vouchers:read", label: "Read Tally bills and payment receipts" },
  { key: "vouchers:write", label: "Push Tally bills and payment updates" },
  { key: "whatsapp:read", label: "Read WhatsApp Business templates" },
  { key: "whatsapp:write", label: "Create WhatsApp templates and send template messages" },
  { key: "messages:write", label: "Send approved WhatsApp notifications" },
  { key: "pixel:write", label: "Ingest website sales pixel & Meta CAPI events" },
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

  const instanceDivisor = Math.max(
    1,
    Number(process.env.PM2_INSTANCES || process.env.WEB_CONCURRENCY || 1)
  );
  const perProcessInsurancePoints = Math.max(1, Math.ceil(rpm / instanceDivisor));

  const limiter = sharedRedisClient
    ? new RateLimiterRedis({
        storeClient: sharedRedisClient,
        keyPrefix: `rsl:apikey:${rpm}`,
        points: rpm,
        duration: 60,
        insuranceLimiter: new RateLimiterMemory({
          points: perProcessInsurancePoints,
          duration: 60,
        }),
      })
    : new RateLimiterMemory({
        keyPrefix: `rsl:apikey:${rpm}`,
        points: perProcessInsurancePoints,
        duration: 60,
      });

  limiterByRpm.set(rpm, limiter);
  return limiter;
}

interface BufferedApiKeyUsage {
  lastUsedAt: number;
  lastUsedIp: string | null;
}

const pendingApiKeyUsage = new Map<string, BufferedApiKeyUsage>();
let usageFlushTimer: ReturnType<typeof setInterval> | null = null;
const API_KEY_USAGE_FLUSH_MS = 45_000;

export function flushApiKeyUsageStats(): number {
  if (pendingApiKeyUsage.size === 0) return 0;
  const entries = Array.from(pendingApiKeyUsage.entries());
  pendingApiKeyUsage.clear();

  try {
    const raw = controlDb().$client;
    const stmt = raw.prepare(
      `UPDATE api_keys
       SET last_used_at = CASE WHEN last_used_at IS NULL OR ? > last_used_at THEN ? ELSE last_used_at END,
           last_used_ip = COALESCE(?, last_used_ip)
       WHERE id = ?`
    );
    const tx = raw.transaction(() => {
      for (const [id, item] of entries) {
        stmt.run(item.lastUsedAt, item.lastUsedAt, item.lastUsedIp, id);
      }
    });
    tx.immediate();
    return entries.length;
  } catch {
    for (const [id, item] of entries) {
      if (!pendingApiKeyUsage.has(id)) {
        pendingApiKeyUsage.set(id, item);
      }
    }
    return 0;
  }
}

function scheduleApiKeyUsageFlush(keyId: string, lastUsedAt: number, lastUsedIp: string | null): void {
  pendingApiKeyUsage.set(keyId, { lastUsedAt, lastUsedIp });
  if (!usageFlushTimer) {
    usageFlushTimer = setInterval(() => {
      flushApiKeyUsageStats();
    }, API_KEY_USAGE_FLUSH_MS);
    usageFlushTimer.unref?.();
  }
}

export function listWorkspaceApiKeys(workspaceId: string) {
  return controlDb()
    .select()
    .from(controlSchema.apiKeys)
    .where(eq(controlSchema.apiKeys.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.apiKeys.createdAt))
    .all()
    .map((row) => {
      const buffered = pendingApiKeyUsage.get(row.id);
      const effectiveLastUsedAt =
        buffered && (!row.lastUsedAt || buffered.lastUsedAt > row.lastUsedAt)
          ? buffered.lastUsedAt
          : row.lastUsedAt;
      const effectiveLastUsedIp =
        buffered && buffered.lastUsedIp ? buffered.lastUsedIp : row.lastUsedIp;

      return {
        id: row.id,
        name: row.name,
        mode: row.mode as "live" | "test",
        maskedKey: `rsl_${row.mode}_${row.prefix}_••••••••••••••••••••`,
        prefix: row.prefix,
        scopes: JSON.parse(row.scopesJson) as string[],
        rateLimitPerMin: row.rateLimitPerMin,
        lastUsedAt: effectiveLastUsedAt,
        lastUsedIp: effectiveLastUsedIp,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        status: row.revokedAt
          ? "revoked"
          : row.expiresAt && row.expiresAt < Date.now()
            ? "expired"
            : "active",
      };
    });
}

export const issueApiKey = defineAction({
  key: "apikeys.created",
  permission: "apikeys:manage",
  service: "api.access",
  input: z.object({
    name: z
      .string()
      .trim()
      .min(2, "Enter a descriptive key name (e.g. Website Checkout or ERP Bridge)")
      .max(80),
    mode: z.enum(["live", "test"]).default("live"),
    scopes: z.array(z.string()).min(1, "Select at least one permission scope for this API key"),
    rateLimitPerMin: z.coerce.number().int().min(10).max(1200).default(120),
    expiresInDays: z.coerce.number().int().min(0).max(1095).default(0),
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
      rawKey,
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
      .where(
        and(
          eq(controlSchema.apiKeys.id, input.keyId),
          eq(controlSchema.apiKeys.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!existing) {
      throw new RslError("RSL-VAL-1001", "API key not found for this business.");
    }

    const revokedAt = Date.now();
    db.update(controlSchema.apiKeys)
      .set({ revokedAt })
      .where(eq(controlSchema.apiKeys.id, existing.id))
      .run();

    apiKeyLookupCache.delete(existing.prefix);

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
    apiKeyLookupCache.delete(existing.prefix);

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

const apiKeyLookupCache = new Map<
  string,
  { expiresAt: number; row: typeof controlSchema.apiKeys.$inferSelect }
>();

/**
 * Verifies an inbound `Authorization: Bearer rsl_live_<prefix>_<secret>` header
 * using constant-time HMAC comparison, checks plan status & scope, enforces per-key
 * rate limits, and batches usage timestamps off the hot write path.
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
  const now = Date.now();

  let candidate: typeof controlSchema.apiKeys.$inferSelect | undefined;
  const cached = apiKeyLookupCache.get(prefix);
  if (cached && cached.expiresAt > now) {
    candidate = cached.row;
  } else {
    candidate = controlDb()
      .select()
      .from(controlSchema.apiKeys)
      .where(and(eq(controlSchema.apiKeys.prefix, prefix), isNull(controlSchema.apiKeys.revokedAt)))
      .get();
    if (candidate) {
      apiKeyLookupCache.set(prefix, { expiresAt: now + 3_000, row: candidate });
    }
  }

  if (!candidate || candidate.revokedAt) {
    throw new RslError("RSL-API-1001");
  }

  const expectedBuf = Buffer.from(candidate.secretHash, "hex");
  const actualBuf = Buffer.from(hashApiKey(rawKey), "hex");
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new RslError("RSL-API-1001");
  }

  if (candidate.expiresAt && candidate.expiresAt < now) {
    throw new RslError(
      "RSL-API-1001",
      "This API key has expired. Generate a fresh key in Developer API settings."
    );
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

  scheduleApiKeyUsageFlush(candidate.id, now, params.clientIp ?? null);

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
      apiKeyScopes: scopes,
      assetScope: null,
      impersonatorId: null,
      correlationId: requestId,
      requestId,
    },
  };
}

let lastIdempotencyPurgeAt = 0;

export async function withApiIdempotency<T>(params: {
  workspaceId: string;
  idempotencyKey: string | null | undefined;
  method: string;
  path: string;
  rawRequestBody: string;
  ttlMs?: number;
  execute: () => Promise<{ statusCode: number; body: T }>;
}): Promise<{ statusCode: number; body: T; replayed: boolean }> {
  const cleanKey = params.idempotencyKey?.trim() ?? "";
  if (!cleanKey) {
    const fresh = await params.execute();
    return { ...fresh, replayed: false };
  }
  if (cleanKey.length > 128) {
    throw new RslError("RSL-VAL-1001", "Idempotency-Key must be at most 128 characters.");
  }

  const db = controlDb();
  const now = Date.now();
  if (now - lastIdempotencyPurgeAt > 60_000) {
    lastIdempotencyPurgeAt = now;
    db.delete(controlSchema.idempotencyRecords)
      .where(lte(controlSchema.idempotencyRecords.expiresAt, now))
      .run();
  }

  const requestHash = crypto
    .createHash("sha256")
    .update(`${params.method.toUpperCase()}:${params.path}:${params.rawRequestBody}`)
    .digest("hex");

  const existing = db
    .select()
    .from(controlSchema.idempotencyRecords)
    .where(
      and(
        eq(controlSchema.idempotencyRecords.workspaceId, params.workspaceId),
        eq(controlSchema.idempotencyRecords.idempotencyKey, cleanKey)
      )
    )
    .get();

  if (existing && existing.expiresAt > now) {
    if (existing.requestHash !== requestHash) {
      throw new RslError(
        "RSL-VAL-1001",
        "Idempotency-Key has already been used with a different request payload."
      );
    }
    return {
      statusCode: existing.statusCode,
      body: JSON.parse(existing.responseJson) as T,
      replayed: true,
    };
  }

  const result = await params.execute();
  if (result.statusCode < 500) {
    const ttlMs = params.ttlMs ?? 24 * 60 * 60_000;
    db.insert(controlSchema.idempotencyRecords)
      .values({
        id: newEntityId("req", params.workspaceId, now),
        workspaceId: params.workspaceId,
        idempotencyKey: cleanKey,
        method: params.method.toUpperCase(),
        path: params.path,
        requestHash,
        statusCode: result.statusCode,
        responseJson: JSON.stringify(result.body),
        createdAt: now,
        expiresAt: now + ttlMs,
      })
      .onConflictDoUpdate({
        target: [
          controlSchema.idempotencyRecords.workspaceId,
          controlSchema.idempotencyRecords.idempotencyKey,
        ],
        set: {
          requestHash,
          statusCode: result.statusCode,
          responseJson: JSON.stringify(result.body),
          createdAt: now,
          expiresAt: now + ttlMs,
        },
      })
      .run();
  }

  return { ...result, replayed: false };
}

export const WEBHOOK_EVENTS = [
  { key: "tally.bill.created", label: "New Tally sales bill synced" },
  { key: "tally.bill.cancelled", label: "Tally sales bill cancelled" },
  { key: "tally.payment.received", label: "Tally payment receipt recorded" },
  { key: "whatsapp.message.received", label: "Inbound customer WhatsApp message" },
  { key: "whatsapp.broadcast.completed", label: "WhatsApp broadcast campaign finished" },
  { key: "pixel.event.recorded", label: "Website conversion pixel event recorded" },
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

export function listWorkspaceWebhookDeliveries(workspaceId: string, limit = 50) {
  return controlDb()
    .select()
    .from(controlSchema.outboundWebhookDeliveries)
    .where(eq(controlSchema.outboundWebhookDeliveries.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.outboundWebhookDeliveries.createdAt))
    .limit(Math.max(1, Math.min(200, limit)))
    .all();
}

export function isPrivateOrReservedIp(
  rawIp: string,
  options?: { allowLoopback?: boolean }
): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, "").split("%")[0]!.toLowerCase();
  const allowLoopback = Boolean(options?.allowLoopback);

  if (ip.startsWith("::ffff:")) {
    const mappedV4 = ip.slice("::ffff:".length);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrReservedIp(mappedV4, options);
    }
    const hexParts = mappedV4.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrReservedIp(v4, options);
      }
    }
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => Number(p));
    const [a = 0, b = 0] = parts;
    if (a === 127) return !allowLoopback;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return !allowLoopback;
    if (ip === "::" || ip === "0:0:0:0:0:0:0:0") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(ip)) return true;
    if (ip.startsWith("ff")) return true;
    return false;
  }

  return true;
}

export async function assertSafeOutboundWebhookTarget(
  rawUrl: string,
  options?: { requireDnsResolution?: boolean }
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter a valid HTTPS webhook URL (for example: https://erp.yourcompany.in/webhooks/rsl)."
    );
  }

  const allowLoopback = getEnv().NODE_ENV !== "production";
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (
    parsed.protocol !== "https:" &&
    !(allowLoopback && parsed.protocol === "http:" && isLoopbackHost)
  ) {
    throw new RslError(
      "RSL-VAL-1001",
      "Outbound webhook URLs must use https:// (http://localhost is permitted only for local non-production testing)."
    );
  }

  if (
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new RslError(
      "RSL-VAL-1001",
      "Outbound webhooks cannot target internal or cloud metadata hostnames."
    );
  }

  if (net.isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host, { allowLoopback })) {
      throw new RslError(
        "RSL-VAL-1001",
        "Outbound webhooks cannot target private, link-local, or cloud metadata IP addresses."
      );
    }
    return parsed.toString();
  }

  if (allowLoopback && host === "localhost") {
    return parsed.toString();
  }

  try {
    const resolved = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (resolved.length === 0 && options?.requireDnsResolution) {
      throw new RslError(
        "RSL-VAL-1001",
        `Webhook hostname '${host}' did not resolve to any IP address.`
      );
    }
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address, { allowLoopback })) {
        throw new RslError(
          "RSL-VAL-1001",
          `Outbound webhook blocked: '${host}' resolves to a private or reserved IP address.`
        );
      }
    }
  } catch (err) {
    if (err instanceof RslError) throw err;
    if (options?.requireDnsResolution) {
      throw new RslError("RSL-VAL-1001", `Unable to resolve outbound webhook hostname '${host}'.`);
    }
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
  handler: async (ctx, input) => {
    const cleanUrl = await assertSafeOutboundWebhookTarget(input.targetUrl, {
      requireDnsResolution: false,
    });
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
    const deliveryId = newEntityId("req", ctx.workspaceId, now);
    const payloadObj = {
      id: deliveryId,
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

    let deliveryStatus = "HTTP 200 OK";
    let httpStatus: number | null = null;
    let responseSnippet: string | null = null;
    let lastError: string | null = null;
    let ok = false;

    try {
      await assertSafeOutboundWebhookTarget(endpoint.targetUrl, { requireDnsResolution: true });
      const resp = await fetch(endpoint.targetUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RSL-Marketing-Webhooks/1.0",
          "X-RSL-Signature": signatureHeader,
          "X-RSL-Event": "webhook.ping",
          "X-RSL-Delivery": deliveryId,
        },
        body: rawBody,
        signal: AbortSignal.timeout(4000),
      });
      httpStatus = resp.status;
      responseSnippet = (await resp.text().catch(() => "")).slice(0, 240) || null;
      ok = resp.ok;
      deliveryStatus = resp.ok ? `HTTP ${resp.status} OK` : `HTTP ${resp.status}`;
      if (!resp.ok) {
        lastError = `Endpoint returned HTTP ${resp.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      deliveryStatus =
        err instanceof RslError ? `Blocked: ${err.message}` : "Unreachable (signed payload prepared)";
    }

    db.insert(controlSchema.outboundWebhookDeliveries)
      .values({
        id: deliveryId,
        endpointId: endpoint.id,
        workspaceId: ctx.workspaceId,
        eventType: "webhook.ping",
        payloadJson: rawBody,
        status: ok ? "delivered" : "dead",
        attemptCount: 1,
        httpStatus,
        responseSnippet,
        lastError,
        nextRetryAt: null,
        createdAt: now,
        deliveredAt: ok ? Date.now() : null,
      })
      .run();

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

async function executeOutboundWebhookDeliveryAttempt(deliveryId: string): Promise<boolean> {
  const db = controlDb();
  const delivery = db
    .select()
    .from(controlSchema.outboundWebhookDeliveries)
    .where(eq(controlSchema.outboundWebhookDeliveries.id, deliveryId))
    .get();

  if (!delivery || delivery.status === "delivered") {
    return true;
  }

  const endpoint = db
    .select()
    .from(controlSchema.outboundWebhookEndpoints)
    .where(eq(controlSchema.outboundWebhookEndpoints.id, delivery.endpointId))
    .get();

  if (!endpoint || !endpoint.active) {
    db.update(controlSchema.outboundWebhookDeliveries)
      .set({
        status: "dead",
        lastError: "Webhook endpoint was deleted or deactivated.",
        nextRetryAt: null,
      })
      .where(eq(controlSchema.outboundWebhookDeliveries.id, deliveryId))
      .run();
    return false;
  }

  const now = Date.now();
  const attempt = delivery.attemptCount + 1;
  const maxAttempts = QUEUE_REGISTRY["webhooks.outbound"].maxAttempts;
  const signatureHeader = computeOutboundWebhookSignature(
    endpoint.signingSecret,
    now,
    delivery.payloadJson
  );

  let httpStatus: number | null = null;
  let responseSnippet: string | null = null;

  try {
    await assertSafeOutboundWebhookTarget(endpoint.targetUrl, { requireDnsResolution: true });
    const resp = await fetch(endpoint.targetUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "RSL-Marketing-Webhooks/1.0",
        "X-RSL-Signature": signatureHeader,
        "X-RSL-Event": delivery.eventType,
        "X-RSL-Delivery": delivery.id,
      },
      body: delivery.payloadJson,
      signal: AbortSignal.timeout(5000),
    });

    httpStatus = resp.status;
    responseSnippet = (await resp.text().catch(() => "")).slice(0, 240) || null;

    if (!resp.ok) {
      throw new Error(`Endpoint responded with HTTP ${resp.status}`);
    }

    const statusLabel = `HTTP ${resp.status} OK`;
    db.update(controlSchema.outboundWebhookDeliveries)
      .set({
        status: "delivered",
        attemptCount: attempt,
        httpStatus,
        responseSnippet,
        lastError: null,
        nextRetryAt: null,
        deliveredAt: Date.now(),
      })
      .where(eq(controlSchema.outboundWebhookDeliveries.id, delivery.id))
      .run();

    db.update(controlSchema.outboundWebhookEndpoints)
      .set({
        lastDeliveryStatus: statusLabel,
        lastDeliveredAt: now,
      })
      .where(eq(controlSchema.outboundWebhookEndpoints.id, endpoint.id))
      .run();

    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isPermanentBlock = err instanceof RslError;
    const isDead = isPermanentBlock || attempt >= maxAttempts;
    const backoffMs = Math.min(300_000, 2_000 * 2 ** Math.min(attempt - 1, 7));
    const nextRetryAt = isDead ? null : Date.now() + backoffMs;
    const endpointLabel = httpStatus
      ? `HTTP ${httpStatus}${isDead ? " (dead-lettered)" : " (retrying)"}`
      : isPermanentBlock
        ? `Blocked: ${errMsg}`
        : isDead
          ? "Failed after max retries"
          : "Unreachable (retry scheduled)";

    db.update(controlSchema.outboundWebhookDeliveries)
      .set({
        status: isDead ? "dead" : "retrying",
        attemptCount: attempt,
        httpStatus,
        responseSnippet,
        lastError: errMsg,
        nextRetryAt,
      })
      .where(eq(controlSchema.outboundWebhookDeliveries.id, delivery.id))
      .run();

    db.update(controlSchema.outboundWebhookEndpoints)
      .set({
        lastDeliveryStatus: endpointLabel,
        lastDeliveredAt: now,
      })
      .where(eq(controlSchema.outboundWebhookEndpoints.id, endpoint.id))
      .run();

    if (isPermanentBlock) {
      return false;
    }
    throw new Error(errMsg);
  }
}

let outboundWebhookProcessorRegistered = false;

export function ensureOutboundWebhookProcessorRegistered(): void {
  if (outboundWebhookProcessorRegistered) return;
  registerJobProcessor("webhooks.outbound.deliver", async (envelope) => {
    const deliveryId = String(envelope.payload.deliveryId ?? "").trim();
    if (!deliveryId) return;
    await executeOutboundWebhookDeliveryAttempt(deliveryId);
  });
  outboundWebhookProcessorRegistered = true;
}

ensureOutboundWebhookProcessorRegistered();

/**
 * Persists a durable delivery record per subscribed endpoint and enqueues `webhooks.outbound.deliver`
 * with exponential backoff and dead-letter handling.
 */
export async function dispatchWorkspaceWebhookEvent(
  workspaceId: string,
  eventType: string,
  data: Record<string, unknown>,
  options?: { asyncOnly?: boolean }
): Promise<number> {
  ensureOutboundWebhookProcessorRegistered();
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

  const createdDeliveryIds: string[] = [];
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
    const deliveryId = newEntityId("req", workspaceId, now);
    const payloadObj = {
      id: deliveryId,
      event: eventType,
      workspaceId,
      createdAt: new Date(now).toISOString(),
      data,
    };
    const rawBody = JSON.stringify(payloadObj);

    db.insert(controlSchema.outboundWebhookDeliveries)
      .values({
        id: deliveryId,
        endpointId: endpoint.id,
        workspaceId,
        eventType,
        payloadJson: rawBody,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: now,
        createdAt: now,
      })
      .run();

    await enqueueJob({
      queue: "webhooks.outbound",
      jobType: "webhooks.outbound.deliver",
      tenantId: workspaceId,
      correlationId: deliveryId,
      requestId: deliveryId,
      actorType: "system",
      actorId: "webhook_dispatcher",
      idempotencyKey: `wh_out:${deliveryId}`,
      payload: {
        deliveryId,
        endpointId: endpoint.id,
        eventType,
      },
    });

    createdDeliveryIds.push(deliveryId);
  }

  if (createdDeliveryIds.length === 0) return 0;

  if (options?.asyncOnly || isRedisConfigured()) {
    return createdDeliveryIds.length;
  }

  await processDueSqliteOutboxForTenant(workspaceId, {
    queueName: "webhooks.outbound",
  });

  let deliveredCount = 0;
  for (const deliveryId of createdDeliveryIds) {
    const row = db
      .select({ status: controlSchema.outboundWebhookDeliveries.status })
      .from(controlSchema.outboundWebhookDeliveries)
      .where(eq(controlSchema.outboundWebhookDeliveries.id, deliveryId))
      .get();
    if (row?.status === "delivered") {
      deliveredCount++;
    }
  }
  return deliveredCount;
}
