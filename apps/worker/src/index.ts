import crypto from "node:crypto";
import http from "node:http";
import * as Sentry from "@sentry/node";
import { Worker } from "bullmq";
import { Cron } from "croner";
import { eq, sql } from "drizzle-orm";
import { createSignedEncryptedBackup, optimizeTenantDatabase } from "@rsl/backup";
import { hasActiveEntitlement, sweepAutomaticBillingReminders } from "@rsl/billing";
import { uploadFileToWorkspaceGoogleDrive } from "@rsl/connections";
import { getEnv } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { anchorTenantLogsForToday, appendActionLog, getDiagnosticLogger } from "@rsl/logging";
import {
  sweepDueScheduledPostsAsync,
  syncAllWorkspaceAdCampaignsInsights,
} from "@rsl/meta";
import {
  ensureSslProvisionProcessorRegistered,
  getRedisConnection,
  isRedisConfigured,
  JobEnvelopeSchema,
  processDueSqliteOutboxForTenant,
  QUEUE_REGISTRY,
  registerJobProcessor,
  sweepDueSslProvisioningJobs,
  type WorkerLane,
} from "@rsl/queue";
import { putWorkspaceObject } from "@rsl/storage";
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
import {
  ensureWhatsAppBroadcastProcessorRegistered,
  executeWhatsAppTemplateSend,
  sendWhatsAppDirectTextJob,
} from "@rsl/whatsapp";

const env = getEnv();

if (env.SENTRY_DSN_WORKER) {
  Sentry.init({
    dsn: env.SENTRY_DSN_WORKER,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.2 : 1.0,
  });
}

const logger = getDiagnosticLogger("worker");

function parseSelectedLanes(): Set<WorkerLane> {
  const arg = process.argv.find((a) => a.startsWith("--lane="));
  const raw = (arg ? arg.split("=")[1] ?? "" : process.env.WORKER_LANE || "all").trim();
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

async function createAndUploadOffsiteWorkspaceBackup(params: {
  workspaceId: string;
  actorType: "user" | "system" | "staff";
  actorId: string;
  correlationId: string;
  requestId: string;
  label: string;
}): Promise<void> {
  const res = await createSignedEncryptedBackup(
    {
      workspaceId: params.workspaceId,
      actorType: params.actorType,
      actorId: params.actorId,
      roleSlug: "owner",
      correlationId: params.correlationId,
      requestId: params.requestId,
    },
    {
      destinationLabel: params.label,
    }
  );
  if (!res.ok) return;

  const bundleBytes = Buffer.from(res.data.bundleBufferBase64, "base64");
  const fileName = `${res.data.backupId}.rslbackup`;

  await putWorkspaceObject({
    workspaceId: params.workspaceId,
    category: "backup_archive",
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
    actorId: params.actorId,
  }).catch(() => undefined);

  await uploadFileToWorkspaceGoogleDrive({
    workspaceId: params.workspaceId,
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
  }).catch(() => undefined);
}

function registerStandardJobHandlers() {
  ensureSslProvisionProcessorRegistered();
  ensureWhatsAppBroadcastProcessorRegistered();

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
    } else if (!res.deduplicated) {
      appendActionLog({
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        source: "worker",
        action: "tally.invoice.sent",
        outcome: "skipped",
        requestId: envelope.requestId,
        correlationId: envelope.correlationId,
        durationMs: 12,
        summary: `WhatsApp automation skipped for '${payload.templateName || templateTarget}' (${
          res.skippedReason || "provider error"
        }) — ₹0.00 deducted`,
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

    const res = await executeWhatsAppTemplateSend({
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

    if (!res.sent && !res.deduplicated) {
      appendActionLog({
        workspaceId: envelope.tenantId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        source: "worker",
        action: "whatsapp.template.sent",
        outcome: "skipped",
        requestId: envelope.requestId,
        correlationId: envelope.correlationId,
        durationMs: 10,
        summary: `WhatsApp API template send skipped for '${payload.templateIdOrName}' (${
          res.skippedReason || "provider error"
        }) — ₹0.00 deducted`,
      });
    }
  });

  // 3. Direct 24h WhatsApp Text Worker Processor (Live Cloud API)
  registerJobProcessor("whatsapp.send", async (envelope) => {
    const recipient = String(envelope.payload.to ?? envelope.payload.phoneE164 ?? "");
    const body = String(envelope.payload.body ?? envelope.payload.text ?? "");
    if (!recipient || !body) return;

    await sendWhatsAppDirectTextJob({
      workspaceId: envelope.tenantId,
      recipientPhone: recipient,
      body,
      idempotencyKey: envelope.idempotencyKey,
    });
  });

  // 4. Signed Encrypted Backup + Off-Site R2 & Google Drive Sync
  registerJobProcessor("backup.snapshot", async (envelope) => {
    await createAndUploadOffsiteWorkspaceBackup({
      workspaceId: envelope.tenantId,
      actorType:
        envelope.actor.type === "user" || envelope.actor.type === "staff"
          ? envelope.actor.type
          : "system",
      actorId: envelope.actor.id,
      correlationId: envelope.correlationId,
      requestId: envelope.requestId,
      label: String(envelope.payload.label ?? "Scheduled Nightly Cloud & Google Drive Backup"),
    });
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

async function sweepDueSocialPostsAcrossTenants() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      const publishedCount = await sweepDueScheduledPostsAsync(tenant.tenantId);
      if (publishedCount > 0) {
        appendActionLog({
          workspaceId: tenant.tenantId,
          actorType: "system",
          actorId: "worker_scheduler",
          source: "worker",
          action: "posts.published",
          outcome: "success",
          requestId: `post_sweep_${Date.now()}`,
          correlationId: `post_sweep_${Date.now()}`,
          durationMs: 25,
          summary: `Published ${publishedCount} scheduled social post(s) live on schedule`,
        });
      }
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId, job: "social.posts.sweep" } });
    }
  }
}

async function syncAdCampaignSpendAndVaultCapsAcrossTenants() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      await syncAllWorkspaceAdCampaignsInsights(tenant.tenantId);
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId, job: "ads.insights.sync" } });
    }
  }
}

async function runNightlyOffsiteBackups() {
  const activeTenants = controlDb()
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const tenant of activeTenants) {
    try {
      if (!hasActiveEntitlement(tenant.tenantId, "backup.export")) continue;
      await createAndUploadOffsiteWorkspaceBackup({
        workspaceId: tenant.tenantId,
        actorType: "system",
        actorId: "worker_nightly_backup",
        correlationId: `bk_${Date.now()}`,
        requestId: `bk_${Date.now()}`,
        label: "Nightly Automated R2 & Google Drive Backup",
      });
    } catch (error) {
      Sentry.captureException(error, { tags: { tenantId: tenant.tenantId, job: "nightly.backup" } });
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
      await sweepDueTallyPaymentReminders({
        workspaceId: tenant.tenantId,
        actorId: "worker_reminders",
      });
      await sweepDueScheduledPostsAsync(tenant.tenantId);
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
  const laneList = Array.from(lanes).join(", ");
  const healthPort = resolveWorkerHealthPort();
  let isDraining = false;

  // Bind loopback health endpoint immediately so PM2 / ops:verify probes never time out during queue attach
  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/api/health") {
      const providedSecret = String(req.headers["x-rsl-internal-secret"] || "");
      const expectedSecret = getEnv().ADMIN_AUTH_SECRET;
      const isInternalCaller =
        providedSecret.length > 0 &&
        expectedSecret.length > 0 &&
        providedSecret.length === expectedSecret.length &&
        crypto.timingSafeEqual(
          Buffer.from(providedSecret, "utf8"),
          Buffer.from(expectedSecret, "utf8")
        );

      try {
        const row = controlDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number };
        const ok = !isDraining && row?.ok === 1;
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            isInternalCaller
              ? {
                  ok,
                  status: ok ? "healthy" : "unhealthy",
                  draining: isDraining,
                  service: "rsl-worker",
                  lanes: Array.from(lanes),
                  port: healthPort,
                  ts: new Date().toISOString(),
                }
              : {
                  ok,
                  status: ok ? "healthy" : "unhealthy",
                }
          )
        );
      } catch (err) {
        logger.error({ err }, "Worker health probe failed");
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            isInternalCaller
              ? { ok: false, status: "unhealthy", error: String(err) }
              : { ok: false, status: "unhealthy" }
          )
        );
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    healthServer.once("error", reject);
    healthServer.listen(healthPort, "127.0.0.1", () => {
      healthServer.removeListener("error", reject);
      if (typeof process.send === "function") {
        process.send("ready");
      }
      resolve();
    });
  });

  registerStandardJobHandlers();

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
      w.on("error", (err) => {
        logger.warn({ queue: def.name, err: err.message }, "BullMQ worker connection warning");
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

  // Publish due scheduled Facebook, Instagram & Google Business posts every minute
  if (lanes.has("realtime") || lanes.has("maintenance")) {
    jobs.push(
      new Cron("* * * * *", { protect: true }, async () => {
        await sweepDueSocialPostsAcrossTenants();
      })
    );
  }

  if (lanes.has("maintenance")) {
    setImmediate(() => {
      try {
        sweepDueSslProvisioningJobs();
      } catch {
        // Non-blocking startup SSL check
      }
    });

    // Hourly live Meta & Google Ads insights sync + 0-overdraft Managed Vault auto-pause guard
    jobs.push(
      new Cron("15 * * * *", { protect: true }, async () => {
        await syncAdCampaignSpendAndVaultCapsAcrossTenants();
      })
    );

    // Checkpoint WAL & refresh disk usage every 30 minutes
    jobs.push(
      new Cron("*/30 * * * *", { protect: true }, async () => {
        await runScheduledMaintenance();
      })
    );

    // Nightly encrypted off-site backups to Cloudflare R2 & Google Drive at 02:30 IST
    jobs.push(
      new Cron("30 2 * * *", { timezone: "Asia/Kolkata", protect: true }, async () => {
        await runNightlyOffsiteBackups();
      })
    );

    // Anchor tenant audit log chains daily at 00:05 IST
    jobs.push(
      new Cron("5 0 * * *", { timezone: "Asia/Kolkata", protect: true }, () => {
        runDailyHashAnchoring();
      })
    );
  }

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
