import http from "node:http";
import * as Sentry from "@sentry/node";
import { Worker } from "bullmq";
import { Cron } from "croner";
import { and, eq, lte, sql } from "drizzle-orm";
import { createSignedEncryptedBackup, optimizeTenantDatabase } from "@rsl/backup";
import { sweepAutomaticBillingReminders } from "@rsl/billing";
import { getEnv } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { anchorTenantLogsForToday, appendActionLog, getDiagnosticLogger } from "@rsl/logging";
import {
  ensureSslProvisionProcessorRegistered,
  getRedisConnection,
  isRedisConfigured,
  JobEnvelopeSchema,
  markSendGuardOutcome,
  processDueSqliteOutboxForTenant,
  QUEUE_REGISTRY,
  registerJobProcessor,
  reserveSendGuard,
  sweepDueSslProvisioningJobs,
  type WorkerLane,
} from "@rsl/queue";
import {
  closeAllHandlesForShutdown,
  controlDb,
  migrateAllTenantsWithCanary,
  refreshTenantDiskMetrics,
  tenantDataDb,
} from "@rsl/tenancy";
import {
  buildSignedTallyVoucherPdfUrl,
  getNativeTallyVoucherPdf,
  sweepDueTallyPaymentReminders,
} from "@rsl/tally";
import { executeWhatsAppTemplateSend } from "@rsl/whatsapp";

const env = getEnv();

Sentry.init({
  dsn: env.SENTRY_DSN_WORKER || undefined,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
});

const logger = getDiagnosticLogger("worker");

function parseSelectedLanes(): Set<WorkerLane> {
  const arg = process.argv.find((a) => a.startsWith("--lane="));
  const raw = arg ? arg.split("=")[1] : "all";
  if (raw === "realtime" || raw === "bulk" || raw === "maintenance") {
    return new Set([raw]);
  }
  return new Set(["realtime", "bulk", "maintenance"]);
}

function resolveWorkerHealthPort(): number {
  const arg = process.argv.find((a) => a.startsWith("--health-port="));
  const raw = arg ? Number(arg.split("=")[1]) : env.WORKER_HEALTH_PORT;
  if (!Number.isInteger(raw) || raw < 4500 || raw > 4600) {
    throw new Error(`Worker health port ${raw} violates mandatory 4500-4600 port range policy.`);
  }
  return raw;
}

function registerStandardJobHandlers() {
  ensureSslProvisionProcessorRegistered();

  // 1. Automatic Tally-to-WhatsApp Bill & Receipt Worker Processor
  registerJobProcessor("tally.whatsapp.automation", async (envelope) => {
    const payload = envelope.payload as {
      voucherId?: string;
      voucherGuid?: string;
      ruleId?: string;
      templateId?: string;
      templateName?: string;
      recipientPhone?: string;
      recipientName?: string;
      variables?: Record<string, string>;
    };

    const templateTarget = payload.templateId || payload.templateName || "";
    const recipientPhone = payload.recipientPhone || "";
    if (!templateTarget || !recipientPhone) {
      logger.warn({ tenantId: envelope.tenantId }, "Skipped tally.whatsapp.automation with missing phone/template");
      return;
    }

    const nativePdf = getNativeTallyVoucherPdf(
      envelope.tenantId,
      payload.voucherId || payload.voucherGuid || ""
    );
    const signedPdfUrl = nativePdf
      ? buildSignedTallyVoucherPdfUrl({
          workspaceId: envelope.tenantId,
          voucherId: nativePdf.voucherId,
          filename: nativePdf.filename,
        })
      : null;

    const res = await executeWhatsAppTemplateSend({
      workspaceId: envelope.tenantId,
      templateIdOrName: templateTarget,
      recipientPhone,
      recipientName: payload.recipientName,
      variables: payload.variables ?? {},
      idempotencyKey: envelope.idempotencyKey,
      actorId: envelope.actor.id,
      linkedVoucherGuid: payload.voucherGuid,
      serviceKey: "tally.invoicing",
      correlationId: envelope.correlationId,
      pdfDocument:
        nativePdf && signedPdfUrl
          ? {
              url: signedPdfUrl,
              filename: nativePdf.filename,
              caption: `Bill #${nativePdf.voucherNumber} (${nativePdf.companyName})`,
            }
          : undefined,
    });

    if (res.sent) {
      const now = Date.now();
      const db = tenantDataDb({ workspaceId: envelope.tenantId });

      if (payload.voucherId) {
        db.update(tenantDataSchema.tallyVouchers)
          .set({
            whatsappInvoiceSentAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.tallyVouchers.id, payload.voucherId))
          .run();
      }

      if (payload.ruleId) {
        db.update(tenantDataSchema.tallyAutomationRules)
          .set({
            triggeredCount: sql`${tenantDataSchema.tallyAutomationRules.triggeredCount} + 1`,
            lastTriggeredAt: now,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.tallyAutomationRules.id, payload.ruleId))
          .run();
      }

      appendActionLog({
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        source: "worker",
        action: "tally.invoice.sent",
        outcome: "success",
        requestId: envelope.requestId,
        correlationId: envelope.correlationId,
        durationMs: 12,
        summary: `Automatically sent WhatsApp template '${payload.templateName || templateTarget}'${
          nativePdf ? ` with native Tally PDF (${nativePdf.filename})` : ""
        } for Tally bill to ${payload.recipientName || "customer"}`,
      });
    }
  });

  // 2. Direct API / Webhook WhatsApp Template Dispatcher
  registerJobProcessor("whatsapp.send.template", async (envelope) => {
    const payload = envelope.payload as {
      templateIdOrName?: string;
      recipientPhone?: string;
      recipientName?: string;
      variables?: Record<string, string>;
    };

    if (!payload.templateIdOrName || !payload.recipientPhone) return;

    await executeWhatsAppTemplateSend({
      workspaceId: envelope.tenantId,
      templateIdOrName: payload.templateIdOrName,
      recipientPhone: payload.recipientPhone,
      recipientName: payload.recipientName,
      variables: payload.variables ?? {},
      idempotencyKey: envelope.idempotencyKey,
      actorId: envelope.actor.id,
      serviceKey: "whatsapp.messaging",
      correlationId: envelope.correlationId,
    });
  });

  registerJobProcessor("whatsapp.send", async (envelope) => {
    const recipient = String(envelope.payload.to ?? envelope.payload.phoneE164 ?? "unknown");
    const guard = reserveSendGuard({
      workspaceId: envelope.tenantId,
      idempotencyKey: envelope.idempotencyKey,
      channel: "whatsapp",
      recipient,
    });
    if (!guard.allowed) {
      logger.info({ tenantId: envelope.tenantId, state: guard.existingState }, "Duplicate send skipped");
      return;
    }
    markSendGuardOutcome({
      workspaceId: envelope.tenantId,
      idempotencyKey: envelope.idempotencyKey,
      state: "sent",
    });
  });

  registerJobProcessor("backup.snapshot", async (envelope) => {
    await createSignedEncryptedBackup(
      {
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        roleSlug: "owner",
        correlationId: envelope.correlationId,
        requestId: envelope.requestId,
      },
      {
        destinationLabel: String(envelope.payload.label ?? "Scheduled Nightly Backup"),
      }
    );
  });

  registerJobProcessor("db.optimize", async (envelope) => {
    await optimizeTenantDatabase(
      {
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        roleSlug: "owner",
        correlationId: envelope.correlationId,
        requestId: envelope.requestId,
      },
      {}
    );
  });

  registerJobProcessor("logs.anchor", async (envelope) => {
    anchorTenantLogsForToday(envelope.tenantId);
  });

  registerJobProcessor("tenant.migrate.all", async () => {
    migrateAllTenantsWithCanary();
  });
}

async function sweepActiveTenantOutboxes() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      await processDueSqliteOutboxForTenant(tenant.tenantId);
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId } });
      logger.error({ tenantId: tenant.tenantId, err: String(error) }, "Tenant outbox sweep error");
    }
  }
}

async function runScheduledMaintenance() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      await optimizeTenantDatabase(
        {
          workspaceId: tenant.tenantId,
          actorType: "system",
          actorId: "worker_maintenance",
          roleSlug: "owner",
          correlationId: `maint_${Date.now()}`,
          requestId: `maint_${Date.now()}`,
        },
        {}
      );
      refreshTenantDiskMetrics(tenant.tenantId);
      sweepDueTallyPaymentReminders({
        workspaceId: tenant.tenantId,
        actorId: "worker_reminders",
      });

      const now = Date.now();
      const tDb = tenantDataDb({ workspaceId: tenant.tenantId });
      const duePosts = tDb
        .select()
        .from(tenantDataSchema.scheduledPosts)
        .where(
          and(
            eq(tenantDataSchema.scheduledPosts.status, "scheduled"),
            lte(tenantDataSchema.scheduledPosts.scheduledFor, now)
          )
        )
        .all();

      for (const post of duePosts) {
        tDb
          .update(tenantDataSchema.scheduledPosts)
          .set({ status: "published", publishedAt: now })
          .where(eq(tenantDataSchema.scheduledPosts.id, post.id))
          .run();

        appendActionLog({
          workspaceId: tenant.tenantId,
          actorType: "system",
          actorId: "worker_scheduler",
          source: "worker",
          action: "posts.published",
          outcome: "success",
          requestId: `post_${post.id}`,
          correlationId: `post_${post.id}`,
          durationMs: 5,
          summary: `Published scheduled ${post.channel.replace(/_/g, " ")} post on schedule`,
        });
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId } });
    }
  }

  try {
    await sweepAutomaticBillingReminders();
  } catch (error) {
    Sentry.captureException(error, { tags: { job: "billing.reminders.sweep" } });
  }

  try {
    sweepDueSslProvisioningJobs();
  } catch (error) {
    Sentry.captureException(error, { tags: { job: "ssl.provision.sweep" } });
  }
}

function runDailyHashAnchoring() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      anchorTenantLogsForToday(tenant.tenantId);
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId } });
    }
  }
}

async function startWorker() {
  const lanes = parseSelectedLanes();
  registerStandardJobHandlers();
  try {
    sweepDueSslProvisioningJobs();
  } catch {
    // Non-blocking startup SSL check
  }

  const bullWorkers: Worker[] = [];
  const redisConn = getRedisConnection();

  if (redisConn && isRedisConfigured()) {
    for (const def of Object.values(QUEUE_REGISTRY)) {
      if (!lanes.has(def.lane)) continue;
      const w = new Worker(
        def.name,
        async (job) => {
          const parsed = JobEnvelopeSchema.parse(job.data);
          await processDueSqliteOutboxForTenant(parsed.tenantId);
        },
        {
          connection: redisConn,
          concurrency: def.concurrency,
        }
      );
      w.on("failed", (job, err) => {
        Sentry.captureException(err, {
          tags: { queue: def.name, jobId: job?.id ?? "unknown" },
        });
        logger.error({ queue: def.name, jobId: job?.id, err: err.message }, "BullMQ job failed");
      });
      bullWorkers.push(w);
    }
  }

  const jobs: Cron[] = [];

  // Sweep durable outbox every 3 seconds so Tally bills trigger WhatsApp messages immediately
  jobs.push(
    new Cron("*/3 * * * * *", { protect: true }, async () => {
      await sweepActiveTenantOutboxes();
    })
  );

  if (lanes.has("maintenance")) {
    // Checkpoint WAL & refresh disk usage every 30 minutes
    jobs.push(
      new Cron("*/30 * * * *", { protect: true }, async () => {
        await runScheduledMaintenance();
      })
    );

    // Anchor tenant audit log chains daily at 00:05 IST
    jobs.push(
      new Cron("5 0 * * *", { timezone: "Asia/Kolkata", protect: true }, () => {
        runDailyHashAnchoring();
      })
    );
  }

  const laneList = Array.from(lanes).join(", ");
  const healthPort = resolveWorkerHealthPort();
  let isDraining = false;

  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/api/health") {
      try {
        const row = controlDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number };
        const ok = !isDraining && row?.ok === 1;
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok,
            draining: isDraining,
            service: "rsl-worker",
            lanes: Array.from(lanes),
            port: healthPort,
            ts: new Date().toISOString(),
          })
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  healthServer.listen(healthPort, "127.0.0.1", () => {
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });

  logger.info(
    { lanes: laneList, healthPort, redisEnabled: isRedisConfigured() },
    "RSL background worker started"
  );
  console.log(
    `[rsl-worker] Active lanes: [${laneList}] | Health: http://127.0.0.1:${healthPort}/health | Mode: ${
      isRedisConfigured() ? "BullMQ + SQLite Outbox" : "SQLite Durable Outbox"
    }`
  );

  const shutdown = async (signal: string) => {
    isDraining = true;
    console.log(`[rsl-worker] Received ${signal}, draining cleanly...`);
    for (const c of jobs) c.stop();
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    await Promise.allSettled(bullWorkers.map((w) => w.close()));
    closeAllHandlesForShutdown();
    await Sentry.close(2000);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

startWorker().catch((err) => {
  Sentry.captureException(err);
  console.error("[rsl-worker] Fatal startup error:", err);
  process.exit(1);
});
