import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { getEnv, hashPiiIdentifier, newId, type ActorType } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { controlDb, ingressDb, tenantDataDb, tenantLogsDb } from "@rsl/tenancy";

export type WorkerLane = "realtime" | "bulk" | "maintenance";

export interface QueueDefinition {
  name: string;
  lane: WorkerLane;
  concurrency: number;
  maxAttempts: number;
  description: string;
}

export const QUEUE_REGISTRY = {
  "webhooks.meta": { name: "webhooks.meta", lane: "realtime", concurrency: 20, maxAttempts: 8, description: "Inbound Facebook & Instagram events" },
  "webhooks.whatsapp": { name: "webhooks.whatsapp", lane: "realtime", concurrency: 20, maxAttempts: 8, description: "Inbound WhatsApp messages & delivery receipts" },
  "webhooks.google": { name: "webhooks.google", lane: "realtime", concurrency: 10, maxAttempts: 8, description: "Google Business review notifications" },
  "webhooks.razorpay": { name: "webhooks.razorpay", lane: "realtime", concurrency: 10, maxAttempts: 8, description: "Razorpay payment confirmations" },
  "webhooks.outbound": { name: "webhooks.outbound", lane: "realtime", concurrency: 10, maxAttempts: 5, description: "Signed customer webhook deliveries" },
  "outbound.whatsapp": { name: "outbound.whatsapp", lane: "realtime", concurrency: 10, maxAttempts: 5, description: "1-to-1 WhatsApp replies & templates" },
  "outbound.meta": { name: "outbound.meta", lane: "realtime", concurrency: 10, maxAttempts: 5, description: "Facebook & Instagram outbound replies" },
  "outbound.google": { name: "outbound.google", lane: "realtime", concurrency: 5, maxAttempts: 5, description: "Google review public replies" },
  "billing.ledger": { name: "billing.ledger", lane: "realtime", concurrency: 1, maxAttempts: 10, description: "Serialized wallet ledger writes" },

  "broadcast.fanout": { name: "broadcast.fanout", lane: "bulk", concurrency: 4, maxAttempts: 3, description: "Chunked WhatsApp broadcasts (50 per batch)" },
  "insights.sync": { name: "insights.sync", lane: "bulk", concurrency: 4, maxAttempts: 5, description: "Ad campaign performance sync" },
  "publishing": { name: "publishing", lane: "bulk", concurrency: 4, maxAttempts: 5, description: "Scheduled social post publishing" },
  "reminders": { name: "reminders", lane: "bulk", concurrency: 6, maxAttempts: 5, description: "Tally overdue bill reminders" },
  "tally.ingest": { name: "tally.ingest", lane: "bulk", concurrency: 4, maxAttempts: 5, description: "Tally Prime voucher delta processing" },
  "backup.run": { name: "backup.run", lane: "bulk", concurrency: 2, maxAttempts: 3, description: "Encrypted customer backup snapshots" },

  "tenant.migrate": { name: "tenant.migrate", lane: "maintenance", concurrency: 2, maxAttempts: 1, description: "Tenant database schema migrations" },
  "ssl.provision": { name: "ssl.provision", lane: "maintenance", concurrency: 2, maxAttempts: 5, description: "Client wildcard subdomain SSL issuance & renewal" },
  "connections.health": { name: "connections.health", lane: "maintenance", concurrency: 2, maxAttempts: 3, description: "6-hour token health verification" },
  "db.maintenance": { name: "db.maintenance", lane: "maintenance", concurrency: 1, maxAttempts: 3, description: "SQLite WAL checkpoint & integrity checks" },
  "logs.rollover": { name: "logs.rollover", lane: "maintenance", concurrency: 1, maxAttempts: 3, description: "Daily log hash anchoring & archival" },
} as const satisfies Record<string, QueueDefinition>;

export type QueueName = keyof typeof QUEUE_REGISTRY;

export const JobEnvelopeSchema = z.object({
  v: z.literal(1),
  type: z.string(),
  queue: z.string(),
  tenantId: z.string(),
  correlationId: z.string(),
  requestId: z.string(),
  actor: z.object({
    type: z.enum(["user", "api_key", "system", "agent", "staff", "webhook"]),
    id: z.string(),
  }),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

let redisClient: IORedis | null = null;
const bullQueues = new Map<string, Queue>();

export function isRedisConfigured(): boolean {
  return Boolean(getEnv().REDIS_URL.trim());
}

export function getRedisConnection(): IORedis | null {
  const url = getEnv().REDIS_URL.trim();
  if (!url) return null;
  if (!redisClient) {
    redisClient = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    redisClient.on("error", () => {
      // Handled per-operation and retried automatically by IORedis
    });
  }
  return redisClient;
}

export function getBullQueue(queueName: QueueName): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  let q = bullQueues.get(queueName);
  if (!q) {
    q = new Queue(queueName, { connection: conn });
    bullQueues.set(queueName, q);
  }
  return q;
}

export async function closeQueueConnectionsForShutdown(): Promise<void> {
  const queues = Array.from(bullQueues.values());
  bullQueues.clear();
  await Promise.allSettled(queues.map((q) => q.close()));
  if (redisClient) {
    const client = redisClient;
    redisClient = null;
    await client.quit().catch(() => client.disconnect());
  }
}

/**
 * Non-restorable duplicate-send protection stored in logs/current.db.
 */
export function reserveSendGuard(params: {
  workspaceId: string;
  idempotencyKey: string;
  channel: string;
  recipient: string;
}): { allowed: boolean; existingState?: string } {
  const logsDb = tenantLogsDb({ workspaceId: params.workspaceId });
  const raw = logsDb.$client;
  const now = Date.now();
  const recipientHash = hashPiiIdentifier(params.recipient);

  const tx = raw.transaction(() => {
    const existing = logsDb
      .select()
      .from(tenantLogsSchema.sendGuards)
      .where(eq(tenantLogsSchema.sendGuards.idempotencyKey, params.idempotencyKey))
      .get();

    if (existing) {
      if (existing.state === "sent" || existing.state === "confirmed") {
        return { allowed: false, existingState: existing.state };
      }
      if (existing.state === "failed" && now - existing.updatedAt >= 1_000) {
        logsDb
          .update(tenantLogsSchema.sendGuards)
          .set({
            state: "reserved",
            recipientHash,
            reservedAt: now,
            updatedAt: now,
          })
          .where(eq(tenantLogsSchema.sendGuards.idempotencyKey, params.idempotencyKey))
          .run();
        return { allowed: true };
      }
      if (existing.state === "reserved" && now - existing.reservedAt > 120_000) {
        logsDb
          .update(tenantLogsSchema.sendGuards)
          .set({ state: "uncertain", updatedAt: now })
          .where(eq(tenantLogsSchema.sendGuards.idempotencyKey, params.idempotencyKey))
          .run();
        return { allowed: false, existingState: "uncertain" };
      }
      return { allowed: false, existingState: existing.state };
    }

    logsDb
      .insert(tenantLogsSchema.sendGuards)
      .values({
        idempotencyKey: params.idempotencyKey,
        channel: params.channel,
        recipientHash,
        state: "reserved",
        reservedAt: now,
        updatedAt: now,
      })
      .run();

    return { allowed: true };
  });

  return tx.immediate();
}

export function markSendGuardOutcome(params: {
  workspaceId: string;
  idempotencyKey: string;
  state: "sent" | "confirmed" | "failed";
  externalId?: string;
}): void {
  tenantLogsDb({ workspaceId: params.workspaceId })
    .update(tenantLogsSchema.sendGuards)
    .set({
      state: params.state,
      externalId: params.externalId ?? null,
      updatedAt: Date.now(),
    })
    .where(eq(tenantLogsSchema.sendGuards.idempotencyKey, params.idempotencyKey))
    .run();
}

function noteTenantOutboxScheduled(tenantId: string, scheduledAt: number): void {
  try {
    controlDb()
      .$client.prepare(
        `UPDATE tenant_registry
         SET next_outbox_at = CASE
           WHEN next_outbox_at IS NULL OR ? < next_outbox_at THEN ?
           ELSE next_outbox_at
         END
         WHERE tenant_id = ?`
      )
      .run(scheduledAt, scheduledAt, tenantId);
  } catch {
    // Non-fatal if tenant_registry row is being initialized
  }
}

export function syncTenantNextOutboxAt(tenantId: string): number | null {
  const dataDb = tenantDataDb({ workspaceId: tenantId });
  const row = dataDb.$client
    .prepare(
      `SELECT MIN(next_run_at) AS minNext
       FROM outbox
       WHERE status IN ('pending', 'enqueued', 'processing')`
    )
    .get() as { minNext: number | null } | undefined;
  const minNext = typeof row?.minNext === "number" ? row.minNext : null;
  try {
    controlDb()
      .$client.prepare(`UPDATE tenant_registry SET next_outbox_at = ? WHERE tenant_id = ?`)
      .run(minNext, tenantId);
  } catch {
    // Ignore control DB update errors during teardown
  }
  return minNext;
}

export function listDueOutboxTenantIds(now = Date.now(), limit = 100): string[] {
  const rows = controlDb()
    .$client.prepare(
      `SELECT tenant_id AS tenantId
       FROM tenant_registry
       WHERE status = 'active'
         AND next_outbox_at IS NOT NULL
         AND next_outbox_at <= ?
       ORDER BY next_outbox_at ASC
       LIMIT ?`
    )
    .all(now, Math.max(1, Math.min(500, limit))) as Array<{ tenantId: string }>;
  return rows.map((r) => r.tenantId);
}

/**
 * Commits a durable outbox row to the tenant SQLite database first, updates the indexed
 * control-plane `next_outbox_at` pointer, and dispatches to BullMQ when `REDIS_URL` is configured.
 */
export async function enqueueJob(params: {
  queue: QueueName;
  jobType: string;
  tenantId: string;
  correlationId: string;
  requestId: string;
  actorType: ActorType;
  actorId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  delayMs?: number;
}): Promise<{ outboxId: string; mode: "bullmq" | "sqlite_durable" }> {
  const envelope: JobEnvelope = JobEnvelopeSchema.parse({
    v: 1,
    type: params.jobType,
    queue: params.queue,
    tenantId: params.tenantId,
    correlationId: params.correlationId,
    requestId: params.requestId,
    actor: { type: params.actorType, id: params.actorId },
    idempotencyKey: params.idempotencyKey,
    payload: params.payload,
  });

  const dataDb = tenantDataDb({ workspaceId: params.tenantId });
  const now = Date.now();
  const scheduledAt = now + Math.max(0, params.delayMs ?? 0);
  const outboxId = newId();

  const inserted = dataDb
    .insert(tenantDataSchema.outbox)
    .values({
      id: outboxId,
      queueName: params.queue,
      jobType: params.jobType,
      idempotencyKey: params.idempotencyKey,
      envelopeJson: JSON.stringify(envelope),
      status: "pending",
      attempts: 0,
      nextRunAt: scheduledAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (inserted.changes > 0) {
    noteTenantOutboxScheduled(params.tenantId, scheduledAt);
  }

  const bullQueue = getBullQueue(params.queue);
  if (bullQueue) {
    const def = QUEUE_REGISTRY[params.queue];
    await bullQueue.add(params.jobType, envelope, {
      jobId: params.idempotencyKey.replace(/:/g, "_"),
      attempts: def.maxAttempts,
      delay: params.delayMs,
      backoff: { type: "exponential", delay: 2000 },
    });

    dataDb
      .update(tenantDataSchema.outbox)
      .set({ status: "enqueued", updatedAt: Date.now() })
      .where(eq(tenantDataSchema.outbox.idempotencyKey, params.idempotencyKey))
      .run();

    return { outboxId, mode: "bullmq" };
  }

  return { outboxId, mode: "sqlite_durable" };
}

export type JobProcessor = (envelope: JobEnvelope) => Promise<void>;

const registeredProcessors = new Map<string, JobProcessor>();

export function registerJobProcessor(jobType: string, handler: JobProcessor): void {
  registeredProcessors.set(jobType, handler);
}

export function hasRegisteredJobProcessor(jobType: string): boolean {
  return registeredProcessors.has(jobType);
}

export function listRegisteredJobProcessors(): string[] {
  return Array.from(registeredProcessors.keys());
}

export function assertRegisteredJobTypes(requiredJobTypes: readonly string[]): void {
  const missing = requiredJobTypes.filter((jobType) => !registeredProcessors.has(jobType));
  if (missing.length > 0) {
    throw new Error(
      `Worker boot check failed: missing job processor(s) for [${missing.join(", ")}].`
    );
  }
}

export interface ProcessOutboxOptions {
  queueName?: QueueName;
  lanes?: Iterable<WorkerLane>;
  idempotencyKey?: string;
  limit?: number;
}

const inFlightTenantDrains = new Map<string, Promise<void>>();

async function withTenantOutboxLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const prev = inFlightTenantDrains.get(tenantId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  inFlightTenantDrains.set(tenantId, chained);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (inFlightTenantDrains.get(tenantId) === chained) {
      inFlightTenantDrains.delete(tenantId);
    }
  }
}

function resolveAllowedQueues(options?: ProcessOutboxOptions): string[] | null {
  if (options?.queueName) {
    return [options.queueName];
  }
  if (options?.lanes) {
    const laneSet = new Set(options.lanes);
    if (laneSet.size === 3) return null;
    return Object.values(QUEUE_REGISTRY)
      .filter((q) => laneSet.has(q.lane))
      .map((q) => q.name);
  }
  return null;
}

/**
 * Processes due outbox items from the tenant SQLite database with single-flight per-tenant
 * serialization, lane/queue scoping, and strict error propagation when a processor is missing.
 */
export async function processDueSqliteOutboxForTenant(
  tenantId: string,
  options?: ProcessOutboxOptions
): Promise<number> {
  return withTenantOutboxLock(tenantId, async () => {
    const dataDb = tenantDataDb({ workspaceId: tenantId });
    const logsDb = tenantLogsDb({ workspaceId: tenantId });
    const raw = dataDb.$client;
    const now = Date.now();
    const workerLockId = `wrk_${process.pid}_${newId().slice(-8)}`;
    const staleProcessingCutoff = now - 5 * 60_000;
    const allowedQueues = resolveAllowedQueues(options);
    if (allowedQueues !== null && allowedQueues.length === 0) {
      return 0;
    }

    const claimableStatuses =
      options?.idempotencyKey || options?.queueName
        ? (["pending", "enqueued"] as const)
        : (["pending"] as const);
    const batchLimit = Math.max(1, Math.min(50, options?.limit ?? 25));

    const claimTx = raw.transaction(() => {
      raw
        .prepare(
          `UPDATE outbox
           SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = ?
           WHERE status = 'processing' AND (locked_at IS NULL OR locked_at < ?)`
        )
        .run(now, staleProcessingCutoff);

      const conditions = [
        inArray(tenantDataSchema.outbox.status, [...claimableStatuses]),
        lte(tenantDataSchema.outbox.nextRunAt, now),
      ];
      if (options?.idempotencyKey) {
        conditions.push(eq(tenantDataSchema.outbox.idempotencyKey, options.idempotencyKey));
      }
      if (allowedQueues !== null) {
        conditions.push(inArray(tenantDataSchema.outbox.queueName, allowedQueues));
      }

      const candidateRows = dataDb
        .select()
        .from(tenantDataSchema.outbox)
        .where(and(...conditions))
        .limit(batchLimit)
        .all();

      if (candidateRows.length === 0) return [];

      const claimedIds: string[] = [];
      const claimStmt = raw.prepare(
        `UPDATE outbox
         SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'enqueued')`
      );
      for (const candidate of candidateRows) {
        const res = claimStmt.run(now, workerLockId, now, candidate.id);
        if (res.changes === 1) {
          claimedIds.push(candidate.id);
        }
      }

      return candidateRows.filter((r) => claimedIds.includes(r.id));
    });

    const dueRows = claimTx.immediate();
    let processed = 0;

    for (const row of dueRows) {
      const started = Date.now();
      const envelope = JSON.parse(row.envelopeJson) as JobEnvelope;
      const processor = registeredProcessors.get(row.jobType);
      const attempt = row.attempts + 1;

      try {
        if (!processor) {
          throw new Error(
            `No job processor registered for jobType '${row.jobType}' on queue '${row.queueName}'.`
          );
        }

        await processor(envelope);

        dataDb
          .update(tenantDataSchema.outbox)
          .set({
            status: "completed",
            attempts: attempt,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            updatedAt: Date.now(),
          })
          .where(eq(tenantDataSchema.outbox.id, row.id))
          .run();

        logsDb
          .insert(tenantLogsSchema.jobRuns)
          .values({
            id: newId(),
            ts: Date.now(),
            queue: row.queueName,
            jobType: row.jobType,
            status: "completed",
            attempt,
            durationMs: Date.now() - started,
            idempotencyKey: row.idempotencyKey,
            correlationId: envelope.correlationId,
          })
          .run();

        processed++;
      } catch (error) {
        const def = QUEUE_REGISTRY[row.queueName as QueueName];
        const maxAttempts = def?.maxAttempts ?? 3;
        const errMsg = error instanceof Error ? error.message : String(error);
        const isDead = attempt >= maxAttempts;
        const backoffMs = Math.min(300_000, 2_000 * 2 ** Math.min(attempt - 1, 7));
        const retryAt = Date.now() + backoffMs;

        dataDb
          .update(tenantDataSchema.outbox)
          .set({
            status: isDead ? "failed" : "pending",
            attempts: attempt,
            nextRunAt: retryAt,
            lockedAt: null,
            lockedBy: null,
            lastError: errMsg,
            updatedAt: Date.now(),
          })
          .where(eq(tenantDataSchema.outbox.id, row.id))
          .run();

        logsDb
          .insert(tenantLogsSchema.jobRuns)
          .values({
            id: newId(),
            ts: Date.now(),
            queue: row.queueName,
            jobType: row.jobType,
            status: isDead ? "dead" : "retrying",
            attempt,
            durationMs: Date.now() - started,
            errorMessage: errMsg,
            idempotencyKey: row.idempotencyKey,
            correlationId: envelope.correlationId,
          })
          .run();
      }
    }

    syncTenantNextOutboxAt(tenantId);
    return processed;
  });
}

/**
 * Rehydrates Redis queues from durable SQLite outbox rows after Redis restart.
 */
export async function rehydrateFromSqlite(): Promise<{ scannedTenants: number; reEnqueued: number }> {
  const tenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  let reEnqueued = 0;
  for (const t of tenants) {
    const dataDb = tenantDataDb({ workspaceId: t.tenantId });
    const pending = dataDb
      .select()
      .from(tenantDataSchema.outbox)
      .where(inArray(tenantDataSchema.outbox.status, ["pending", "enqueued"]))
      .all();

    if (pending.length === 0) {
      syncTenantNextOutboxAt(t.tenantId);
      continue;
    }

    for (const row of pending) {
      const env = JSON.parse(row.envelopeJson) as JobEnvelope;
      const q = getBullQueue(row.queueName as QueueName);
      if (q) {
        await q.add(row.jobType, env, {
          jobId: row.idempotencyKey.replace(/:/g, "_"),
        });
        reEnqueued++;
      } else if (registeredProcessors.has(row.jobType)) {
        await processDueSqliteOutboxForTenant(t.tenantId, {
          idempotencyKey: row.idempotencyKey,
        });
        reEnqueued++;
      }
    }
    syncTenantNextOutboxAt(t.tenantId);
  }

  return { scannedTenants: tenants.length, reEnqueued };
}

export interface PlatformQueueSummarySnapshot {
  mode: "bullmq" | "sqlite_durable";
  tenantsWithPendingOutbox: number;
  pendingInboundWebhooks: number;
  deadInboundWebhooks: number;
  pendingOutboundWebhooks: number;
  deadOutboundWebhooks: number;
  refreshedAt: number;
}

let cachedSummary: PlatformQueueSummarySnapshot | null = null;

export function refreshPlatformQueueSummaryCache(): PlatformQueueSummarySnapshot {
  const ctrlRaw = controlDb().$client;
  const outboxTenantsRow = ctrlRaw
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM tenant_registry
       WHERE status = 'active' AND next_outbox_at IS NOT NULL`
    )
    .get() as { cnt: number } | undefined;

  const outboundCounts = ctrlRaw
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('pending', 'retrying') THEN 1 ELSE 0 END) AS pendingCnt,
         SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS deadCnt
       FROM webhook_deliveries`
    )
    .get() as { pendingCnt: number | null; deadCnt: number | null } | undefined;

  const ingressCounts = ingressDb().$client
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('received', 'enqueued') THEN 1 ELSE 0 END) AS pendingCnt,
         SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS deadCnt
       FROM webhook_inbox`
    )
    .get() as { pendingCnt: number | null; deadCnt: number | null } | undefined;

  void ingressSchema;

  cachedSummary = {
    mode: isRedisConfigured() ? "bullmq" : "sqlite_durable",
    tenantsWithPendingOutbox: Number(outboxTenantsRow?.cnt ?? 0),
    pendingInboundWebhooks: Number(ingressCounts?.pendingCnt ?? 0),
    deadInboundWebhooks: Number(ingressCounts?.deadCnt ?? 0),
    pendingOutboundWebhooks: Number(outboundCounts?.pendingCnt ?? 0),
    deadOutboundWebhooks: Number(outboundCounts?.deadCnt ?? 0),
    refreshedAt: Date.now(),
  };
  return cachedSummary;
}

export function getCachedPlatformQueueSummary(maxAgeMs = 15_000): PlatformQueueSummarySnapshot {
  if (cachedSummary && Date.now() - cachedSummary.refreshedAt <= maxAgeMs) {
    return cachedSummary;
  }
  return refreshPlatformQueueSummaryCache();
}

let cachedOverview: {
  expiresAt: number;
  data: {
    mode: string;
    queues: QueueDefinition[];
    pendingCount: number;
    failedCount: number;
    completedCount: number;
    deadLetters: Array<{
      tenantId: string;
      outboxId: string;
      queueName: string;
      jobType: string;
      attempts: number;
      lastError: string | null;
      updatedAt: number;
    }>;
  };
} | null = null;

export function getPlatformQueueOverview(options?: { bypassCache?: boolean }) {
  if (!options?.bypassCache && cachedOverview && cachedOverview.expiresAt > Date.now()) {
    return cachedOverview.data;
  }

  const tenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  let pendingCount = 0;
  let failedCount = 0;
  let completedCount = 0;
  const deadLetters: Array<{
    tenantId: string;
    outboxId: string;
    queueName: string;
    jobType: string;
    attempts: number;
    lastError: string | null;
    updatedAt: number;
  }> = [];

  for (const t of tenants) {
    const dataDb = tenantDataDb({ workspaceId: t.tenantId });
    const rows = dataDb
      .select()
      .from(tenantDataSchema.outbox)
      .orderBy(desc(tenantDataSchema.outbox.updatedAt))
      .limit(200)
      .all();
    for (const r of rows) {
      if (r.status === "pending" || r.status === "enqueued") pendingCount++;
      else if (r.status === "completed") completedCount++;
      else if (r.status === "failed") {
        failedCount++;
        deadLetters.push({
          tenantId: t.tenantId,
          outboxId: r.id,
          queueName: r.queueName,
          jobType: r.jobType,
          attempts: r.attempts,
          lastError: r.lastError,
          updatedAt: r.updatedAt,
        });
      }
    }
  }

  const data = {
    mode: isRedisConfigured()
      ? "BullMQ + Redis (Durable SQLite Outbox)"
      : "SQLite Durable Queue (Local Mode)",
    queues: Object.values(QUEUE_REGISTRY),
    pendingCount,
    failedCount,
    completedCount,
    deadLetters,
  };
  cachedOverview = { expiresAt: Date.now() + 5_000, data };
  return data;
}

export async function replayDeadLetterJob(tenantId: string, outboxId: string): Promise<void> {
  const dataDb = tenantDataDb({ workspaceId: tenantId });
  const now = Date.now();
  const row = dataDb
    .select()
    .from(tenantDataSchema.outbox)
    .where(eq(tenantDataSchema.outbox.id, outboxId))
    .get();

  dataDb
    .update(tenantDataSchema.outbox)
    .set({ status: "pending", attempts: 0, nextRunAt: now, lastError: null, updatedAt: now })
    .where(eq(tenantDataSchema.outbox.id, outboxId))
    .run();

  noteTenantOutboxScheduled(tenantId, now);

  if (row && registeredProcessors.has(row.jobType)) {
    await processDueSqliteOutboxForTenant(tenantId, {
      idempotencyKey: row.idempotencyKey,
    });
  }
}

export * from "./ssl";
