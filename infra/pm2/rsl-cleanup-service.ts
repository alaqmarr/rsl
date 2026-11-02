import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, lt } from "drizzle-orm";
import { getEnv } from "@rsl/core";
import { controlSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import {
  closeAllHandlesForShutdown,
  controlDb,
  platformLogsDb,
  refreshTenantDiskMetrics,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";

const execFileAsync = promisify(execFile);

/**
 * STRICT ISOLATION CONSTANTS:
 * 1. Never probe, bind, or touch any port outside 4500-4600.
 * 2. Never inspect, reload, restart, or flush any PM2 process outside RSL_ALLOWED_PM2_APPS.
 */
const PORT_MIN = 4500;
const PORT_MAX = 4600;

const RSL_ALLOWED_PM2_APPS = new Set([
  "rsl-web",
  "rsl-admin",
  "rsl-docs",
  "rsl-worker-realtime",
  "rsl-worker-bulk",
  "rsl-worker-maintenance",
  "rsl-cleanup",
]);

interface MonitoredService {
  pm2Name: string;
  port: number;
  healthPath: string;
}

const MONITORED_SERVICES: MonitoredService[] = [
  { pm2Name: "rsl-web", port: 4500, healthPath: "/api/health" },
  { pm2Name: "rsl-admin", port: 4501, healthPath: "/api/health" },
  { pm2Name: "rsl-docs", port: 4502, healthPath: "/api/health" },
  { pm2Name: "rsl-worker-realtime", port: 4510, healthPath: "/health" },
  { pm2Name: "rsl-worker-bulk", port: 4511, healthPath: "/health" },
  { pm2Name: "rsl-worker-maintenance", port: 4512, healthPath: "/health" },
];

interface CleanupReport {
  ranAt: string;
  durationMs: number;
  stagingFilesRemoved: number;
  expiredSessionsRemoved: number;
  expiredTokensRemoved: number;
  expiredPairingCodesRemoved: number;
  oldSendGuardsRemoved: number;
  rotatedLogFiles: number;
  walCheckpointedTenants: number;
}

const env = getEnv();
const failureCounts = new Map<string, number>();
let lastCleanupReport: CleanupReport | null = null;
let lastWatchdogStatus: Record<string, { healthy: boolean; consecutiveFailures: number; checkedAt: string }> = {};

function assertAllowedPort(port: number): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(`Port ${port} is outside mandatory 4500-4600 range.`);
  }
}

function cleanDirectoryOlderThan(dirPath: string, maxAgeMs: number): number {
  if (!fs.existsSync(dirPath)) return 0;
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      // Ignore concurrent file removal
    }
  }
  return removed;
}

function rotateOversizedRslLogs(logRoot: string, maxBytes = 50 * 1024 * 1024, maxAgeDays = 14): number {
  if (!fs.existsSync(logRoot)) return 0;
  let rotated = 0;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;

  const dirsToScan = [logRoot, path.join(logRoot, "pm2")];
  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".log") && !entry.name.endsWith(".ndjson") && !entry.name.endsWith(".old")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(full);
        if (entry.name.endsWith(".old") && stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          rotated++;
          continue;
        }
        if (stat.size > maxBytes) {
          const backupPath = `${full}.old`;
          fs.copyFileSync(full, backupPath);
          fs.truncateSync(full, 0);
          rotated++;
        }
      } catch {
        // Non-fatal
      }
    }
  }
  return rotated;
}

export async function runCleanupCycle(): Promise<CleanupReport> {
  const started = Date.now();
  const now = Date.now();

  // 1. Clean temporary staging archives older than 2 hours (strictly inside RSL's BACKUP_STAGING_DIR)
  const stagingFilesRemoved = cleanDirectoryOlderThan(env.BACKUP_STAGING_DIR, 2 * 3600_000);

  // 2. Prune expired sessions, email/reset verification tokens & expired Tally pairing codes in control.db
  const cdb = controlDb();
  const expiredUserSessions = cdb
    .delete(controlSchema.sessions)
    .where(lt(controlSchema.sessions.expiresAt, now))
    .run().changes;
  const expiredStaffSessions = cdb
    .delete(controlSchema.platformStaffSessions)
    .where(lt(controlSchema.platformStaffSessions.expiresAt, now))
    .run().changes;
  const expiredTokensRemoved = cdb
    .delete(controlSchema.verifications)
    .where(lt(controlSchema.verifications.expiresAt, now))
    .run().changes;
  const expiredPairingCodesRemoved = cdb
    .delete(controlSchema.agentPairingCodes)
    .where(lt(controlSchema.agentPairingCodes.expiresAt, now))
    .run().changes;

  // Checkpoint platform SQLite WAL files without blocking writers
  cdb.$client.pragma("wal_checkpoint(PASSIVE)");
  platformLogsDb().$client.pragma("wal_checkpoint(PASSIVE)");

  // 3. Per-tenant cleanup: >7d completed outbox rows, >90d SendGuard dedup locks, and WAL checkpoint
  //    (NEVER touches immutable ledger_entries or action_logs!)
  let oldSendGuardsRemoved = 0;
  let walCheckpointedTenants = 0;
  const sevenDaysAgo = now - 7 * 86_400_000;
  const ninetyDaysAgo = now - 90 * 86_400_000;

  const activeTenants = cdb
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.status, "active"))
    .all();

  for (const t of activeTenants) {
    try {
      const ctx = {
        workspaceId: t.tenantId,
        actorType: "system" as const,
        actorId: "rsl_cleanup_service",
        roleSlug: "owner",
        correlationId: `cleanup_${now}`,
        requestId: `cleanup_${now}`,
      };
      const ddb = tenantDataDb(ctx);
      const ldb = tenantLogsDb(ctx);

      ddb
        .delete(tenantDataSchema.outbox)
        .where(
          and(
            eq(tenantDataSchema.outbox.status, "completed"),
            lt(tenantDataSchema.outbox.updatedAt, sevenDaysAgo)
          )
        )
        .run();

      oldSendGuardsRemoved += ldb
        .delete(tenantLogsSchema.sendGuards)
        .where(lt(tenantLogsSchema.sendGuards.reservedAt, ninetyDaysAgo))
        .run().changes;

      ddb.$client.pragma("wal_checkpoint(PASSIVE)");
      ldb.$client.pragma("wal_checkpoint(PASSIVE)");
      refreshTenantDiskMetrics(t.tenantId);
      walCheckpointedTenants++;
    } catch (err) {
      console.error(`[rsl-cleanup] Tenant ${t.tenantId} cleanup warning:`, err);
    }
  }

  // 4. Rotate only RSL's own logs inside LOG_DIR and LOG_DIR/pm2 (never touches ~/.pm2/logs of other apps!)
  const rotatedLogFiles = rotateOversizedRslLogs(env.LOG_DIR);

  const report: CleanupReport = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    stagingFilesRemoved,
    expiredSessionsRemoved: expiredUserSessions + expiredStaffSessions,
    expiredTokensRemoved,
    expiredPairingCodesRemoved,
    oldSendGuardsRemoved,
    rotatedLogFiles,
    walCheckpointedTenants,
  };

  lastCleanupReport = report;
  console.log(`[rsl-cleanup] Cycle complete in ${report.durationMs}ms:`, JSON.stringify(report));
  return report;
}

async function getOnlineRslPm2Apps(): Promise<Map<string, { uptimeMs: number }>> {
  const result = new Map<string, { uptimeMs: number }>();
  const pm2Bin = process.platform === "win32" ? "pm2.cmd" : "pm2";
  try {
    const { stdout } = await execFileAsync(pm2Bin, ["jlist"], { timeout: 6000 });
    const list = JSON.parse(stdout) as Array<{
      name?: string;
      pm2_env?: { status?: string; namespace?: string; pm_uptime?: number };
    }>;
    for (const proc of list) {
      const name = proc.name ?? "";
      // STRICT GUARD: Ignore all non-RSL PM2 processes on the host!
      if (!RSL_ALLOWED_PM2_APPS.has(name)) continue;
      if (proc.pm2_env?.status === "online") {
        const uptimeMs = proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0;
        result.set(name, { uptimeMs });
      }
    }
  } catch {
    // PM2 CLI not running or not installed in local non-PM2 dev mode
  }
  return result;
}

async function probeLocalHealth(port: number, healthPath: string): Promise<boolean> {
  assertAllowedPort(port);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${healthPath}`, {
      signal: AbortSignal.timeout(4500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function reloadSingleRslAppSafely(pm2Name: string): Promise<void> {
  if (!RSL_ALLOWED_PM2_APPS.has(pm2Name)) {
    throw new Error(`Refusing to touch non-RSL PM2 process: ${pm2Name}`);
  }
  const pm2Bin = process.platform === "win32" ? "pm2.cmd" : "pm2";
  console.warn(`[rsl-cleanup] Triggering isolated graceful reload of unhealthy RSL process: ${pm2Name}`);
  await execFileAsync(pm2Bin, ["reload", pm2Name, "--update-env"], { timeout: 20000 });
}

async function runWatchdogCheck(): Promise<void> {
  const onlineRslApps = await getOnlineRslPm2Apps();
  const nextStatus: typeof lastWatchdogStatus = {};

  for (const svc of MONITORED_SERVICES) {
    assertAllowedPort(svc.port);
    const healthy = await probeLocalHealth(svc.port, svc.healthPath);
    const prevFailures = failureCounts.get(svc.pm2Name) ?? 0;
    const consecutiveFailures = healthy ? 0 : prevFailures + 1;
    failureCounts.set(svc.pm2Name, consecutiveFailures);

    nextStatus[svc.pm2Name] = {
      healthy,
      consecutiveFailures,
      checkedAt: new Date().toISOString(),
    };

    // Self-heal ONLY if this specific RSL app is managed & online in PM2 (uptime > 45s) and failed 3 probes in a row
    const pm2Info = onlineRslApps.get(svc.pm2Name);
    if (!healthy && consecutiveFailures >= 3 && pm2Info && pm2Info.uptimeMs > 45_000) {
      failureCounts.set(svc.pm2Name, 0);
      await reloadSingleRslAppSafely(svc.pm2Name).catch((err) => {
        console.error(`[rsl-cleanup] Failed to reload ${svc.pm2Name}:`, err);
      });
    }
  }

  lastWatchdogStatus = nextStatus;
}

async function main() {
  const onceMode = process.argv.includes("--once");
  await runCleanupCycle();

  if (onceMode) {
    closeAllHandlesForShutdown();
    process.exit(0);
  }

  const servicePort = env.CLEANUP_SERVICE_PORT;
  assertAllowedPort(servicePort);

  const cleanupTimer = setInterval(() => {
    void runCleanupCycle().catch((err) => console.error("[rsl-cleanup] Scheduled cleanup error:", err));
  }, 20 * 60_000);

  const watchdogTimer = setInterval(() => {
    void runWatchdogCheck().catch((err) => console.error("[rsl-cleanup] Watchdog error:", err));
  }, 60_000);

  void runWatchdogCheck();

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/api/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "rsl-cleanup",
          portRangePolicy: `${PORT_MIN}-${PORT_MAX}`,
          port: servicePort,
          allowedPm2Apps: Array.from(RSL_ALLOWED_PM2_APPS),
          lastCleanup: lastCleanupReport,
          watchdog: lastWatchdogStatus,
          ts: new Date().toISOString(),
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/run-cleanup") {
      try {
        const report = await runCleanupCycle();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, report }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(servicePort, "127.0.0.1", () => {
    console.log(
      `[rsl-cleanup] Running on http://127.0.0.1:${servicePort}/health (strictly scoped to rsl-* apps & ports 4500-4600)`
    );
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });

  const shutdown = (signal: string) => {
    console.log(`[rsl-cleanup] Received ${signal}, shutting down cleanly...`);
    clearInterval(cleanupTimer);
    clearInterval(watchdogTimer);
    server.close(() => {
      closeAllHandlesForShutdown();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[rsl-cleanup] Fatal startup error:", err);
  process.exit(1);
});
