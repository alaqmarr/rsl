import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { LRUCache } from "lru-cache";
import pLimit from "p-limit";
import { assertValidUlid, getEnv, newId, RslError, type ActorType } from "@rsl/core";
import {
  applyConnectionPragmas,
  CONTROL_MIGRATIONS,
  createSqliteClient,
  INGRESS_MIGRATIONS,
  PLATFORM_LOGS_MIGRATIONS,
  runSqlMigrations,
  TENANT_DATA_MIGRATIONS,
  TENANT_LOGS_MIGRATIONS,
  wrapControlDb,
  wrapIngressDb,
  wrapPlatformLogsDb,
  wrapTenantDataDb,
  wrapTenantLogsDb,
  controlSchema,
  platformLogsSchema,
  type ControlDb,
  type IngressDb,
  type PlatformLogsDb,
  type TenantDataDb,
  type TenantLogsDb,
} from "@rsl/database";

export interface TenantContext {
  readonly workspaceId: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly roleSlug?: string;
  readonly assetScope?: string[] | null;
  readonly impersonatorId?: string | null;
  readonly correlationId: string;
  readonly requestId: string;
}

function ensureSecureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

export function resolveSafeTenantDir(tenantId: string): string {
  const validId = assertValidUlid(tenantId, "tenantId");
  const env = getEnv();
  const baseTenantsDir = path.resolve(env.DATA_DIR, "tenants");
  const tenantDir = path.resolve(baseTenantsDir, validId);

  const relative = path.relative(baseTenantsDir, tenantDir);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative !== validId) {
    throw new Error("Path traversal blocked by tenant handle manager");
  }
  return tenantDir;
}

let controlSingleton: ControlDb | null = null;
let controlAppliedVersion = 0;
let ingressSingleton: IngressDb | null = null;
let platformLogsSingleton: PlatformLogsDb | null = null;

export function controlDb(): ControlDb {
  const latestControlVersion = CONTROL_MIGRATIONS[CONTROL_MIGRATIONS.length - 1]?.version ?? 0;
  if (controlSingleton) {
    if (controlAppliedVersion < latestControlVersion) {
      controlAppliedVersion = runSqlMigrations(controlSingleton.$client, CONTROL_MIGRATIONS);
    }
    return controlSingleton;
  }
  const env = getEnv();
  const platformDir = path.join(env.DATA_DIR, "platform");
  ensureSecureDir(platformDir);

  const dbPath = path.join(platformDir, "control.db");
  const raw = createSqliteClient(dbPath);
  applyConnectionPragmas(raw, "control");
  controlAppliedVersion = runSqlMigrations(raw, CONTROL_MIGRATIONS);
  controlSingleton = wrapControlDb(raw);
  return controlSingleton;
}

export function ingressDb(): IngressDb {
  if (ingressSingleton) return ingressSingleton;
  const env = getEnv();
  const platformDir = path.join(env.DATA_DIR, "platform");
  ensureSecureDir(platformDir);

  const dbPath = path.join(platformDir, "ingress.db");
  const raw = createSqliteClient(dbPath);
  applyConnectionPragmas(raw, "standard");
  runSqlMigrations(raw, INGRESS_MIGRATIONS);
  ingressSingleton = wrapIngressDb(raw);
  return ingressSingleton;
}

export function platformLogsDb(): PlatformLogsDb {
  if (platformLogsSingleton) return platformLogsSingleton;
  const env = getEnv();
  const platformDir = path.join(env.DATA_DIR, "platform");
  ensureSecureDir(platformDir);

  const dbPath = path.join(platformDir, "platform-logs.db");
  const raw = createSqliteClient(dbPath);
  applyConnectionPragmas(raw, "standard");
  runSqlMigrations(raw, PLATFORM_LOGS_MIGRATIONS);
  platformLogsSingleton = wrapPlatformLogsDb(raw);
  return platformLogsSingleton;
}

interface CachedHandle<T> {
  db: T;
  close: () => void;
}

const dataHandleCache = new LRUCache<string, CachedHandle<TenantDataDb>>({
  max: getEnv().TENANT_DB_MAX_OPEN,
  ttl: getEnv().TENANT_DB_IDLE_CLOSE_MS,
  updateAgeOnGet: true,
  dispose: (value) => {
    value.close();
  },
});

const logsHandleCache = new LRUCache<string, CachedHandle<TenantLogsDb>>({
  max: getEnv().TENANT_DB_MAX_OPEN,
  ttl: getEnv().TENANT_DB_IDLE_CLOSE_MS,
  updateAgeOnGet: true,
  dispose: (value) => {
    value.close();
  },
});

function verifyActiveTenantStatus(tenantId: string, allowSuspendedRead = false): {
  dataDbPath: string;
  logsDbPath: string;
  status: string;
} {
  const ctrl = controlDb();
  const reg = ctrl
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
    .get();

  if (!reg) {
    throw new RslError("RSL-TENANT-1001", "Business storage is not initialized yet.");
  }

  if (reg.status === "restoring" || reg.status === "migrating" || reg.status === "migration_failed" || reg.status === "deleted") {
    throw new RslError("RSL-TENANT-1001");
  }

  if (reg.status === "suspended" && !allowSuspendedRead) {
    throw new RslError("RSL-TENANT-1002");
  }

  return {
    dataDbPath: reg.dataDbPath,
    logsDbPath: reg.logsDbPath,
    status: reg.status,
  };
}

export function tenantDataDb(ctx: Pick<TenantContext, "workspaceId">, options?: { allowSuspendedRead?: boolean }): TenantDataDb {
  const tenantId = assertValidUlid(ctx.workspaceId, "workspaceId");
  const reg = verifyActiveTenantStatus(tenantId, options?.allowSuspendedRead ?? true);

  const existing = dataHandleCache.get(tenantId);
  if (existing) {
    return existing.db;
  }

  const raw = createSqliteClient(reg.dataDbPath);
  applyConnectionPragmas(raw, "standard");
  const version = runSqlMigrations(raw, TENANT_DATA_MIGRATIONS);

  const wrapped = wrapTenantDataDb(raw);
  dataHandleCache.set(tenantId, {
    db: wrapped,
    close: () => {
      try {
        if (raw.open) {
          raw.pragma("optimize");
          raw.close();
        }
      } catch {
        // Ignore optimize errors on close
      }
    },
  });

  // Update schema version if lazy-migrated
  const ctrl = controlDb();
  ctrl
    .update(controlSchema.tenantRegistry)
    .set({ dataSchemaVersion: version, updatedAt: Date.now() })
    .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
    .run();

  return wrapped;
}

export function tenantLogsDb(ctx: Pick<TenantContext, "workspaceId">): TenantLogsDb {
  const tenantId = assertValidUlid(ctx.workspaceId, "workspaceId");
  const reg = verifyActiveTenantStatus(tenantId, true);

  const existing = logsHandleCache.get(tenantId);
  if (existing) {
    return existing.db;
  }

  const raw = createSqliteClient(reg.logsDbPath);
  applyConnectionPragmas(raw, "standard");
  const version = runSqlMigrations(raw, TENANT_LOGS_MIGRATIONS);

  const wrapped = wrapTenantLogsDb(raw);
  logsHandleCache.set(tenantId, {
    db: wrapped,
    close: () => {
      try {
        if (raw.open) {
          raw.pragma("optimize");
          raw.close();
        }
      } catch {
        // Ignore optimize errors on close
      }
    },
  });

  const ctrl = controlDb();
  ctrl
    .update(controlSchema.tenantRegistry)
    .set({ logsSchemaVersion: version, updatedAt: Date.now() })
    .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
    .run();

  return wrapped;
}

export function closeTenantHandles(tenantId: string): void {
  const validId = assertValidUlid(tenantId, "tenantId");
  dataHandleCache.delete(validId);
  logsHandleCache.delete(validId);
}

export function closeAllHandlesForShutdown(): void {
  dataHandleCache.clear();
  logsHandleCache.clear();
  if (controlSingleton) {
    controlSingleton.$client.close();
    controlSingleton = null;
  }
  if (ingressSingleton) {
    ingressSingleton.$client.close();
    ingressSingleton = null;
  }
  if (platformLogsSingleton) {
    platformLogsSingleton.$client.close();
    platformLogsSingleton = null;
  }
}

export { pLimit };

/**
 * Provisions isolated physical SQLite databases for a newly created business workspace.
 */
export function provisionTenantDatabase(workspaceId: string): {
  tenantDir: string;
  dataDbPath: string;
  logsDbPath: string;
} {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const tenantDir = resolveSafeTenantDir(validId);
  const logsDir = path.join(tenantDir, "logs");
  const archiveDir = path.join(logsDir, "archive");

  ensureSecureDir(tenantDir);
  ensureSecureDir(logsDir);
  ensureSecureDir(archiveDir);

  const dataDbPath = path.join(tenantDir, "data.db");
  const logsDbPath = path.join(logsDir, "current.db");

  const dataRaw = createSqliteClient(dataDbPath);
  applyConnectionPragmas(dataRaw, "standard");
  const dataVersion = runSqlMigrations(dataRaw, TENANT_DATA_MIGRATIONS);
  dataRaw.close();

  const logsRaw = createSqliteClient(logsDbPath);
  applyConnectionPragmas(logsRaw, "standard");
  const logsVersion = runSqlMigrations(logsRaw, TENANT_LOGS_MIGRATIONS);
  logsRaw.close();

  const now = Date.now();
  const dataSize = fs.existsSync(dataDbPath) ? fs.statSync(dataDbPath).size : 0;
  const logsSize = fs.existsSync(logsDbPath) ? fs.statSync(logsDbPath).size : 0;

  fs.writeFileSync(
    path.join(tenantDir, "meta.json"),
    JSON.stringify(
      {
        tenantId: validId,
        dataSchemaVersion: dataVersion,
        logsSchemaVersion: logsVersion,
        createdAt: new Date(now).toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  const ctrl = controlDb();
  ctrl
    .insert(controlSchema.tenantRegistry)
    .values({
      tenantId: validId,
      host: "local",
      dataDbPath,
      logsDbPath,
      status: "active",
      dataSchemaVersion: dataVersion,
      logsSchemaVersion: logsVersion,
      dataSizeBytes: dataSize,
      logsSizeBytes: logsSize,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.tenantRegistry.tenantId,
      set: {
        dataDbPath,
        logsDbPath,
        dataSchemaVersion: dataVersion,
        logsSchemaVersion: logsVersion,
        dataSizeBytes: dataSize,
        logsSizeBytes: logsSize,
        updatedAt: now,
      },
    })
    .run();

  return { tenantDir, dataDbPath, logsDbPath };
}

export function refreshTenantDiskMetrics(tenantId: string): { dataSizeBytes: number; logsSizeBytes: number } {
  const validId = assertValidUlid(tenantId, "tenantId");
  const ctrl = controlDb();
  const reg = ctrl
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.tenantId, validId))
    .get();
  if (!reg) return { dataSizeBytes: 0, logsSizeBytes: 0 };

  const dataSizeBytes = fs.existsSync(reg.dataDbPath) ? fs.statSync(reg.dataDbPath).size : 0;
  const logsSizeBytes = fs.existsSync(reg.logsDbPath) ? fs.statSync(reg.logsDbPath).size : 0;

  ctrl
    .update(controlSchema.tenantRegistry)
    .set({ dataSizeBytes, logsSizeBytes, updatedAt: Date.now() })
    .where(eq(controlSchema.tenantRegistry.tenantId, validId))
    .run();

  return { dataSizeBytes, logsSizeBytes };
}

export const ALLOWLISTED_INSPECTOR_QUERIES = {
  summary_counts: {
    label: "Account record counts (contacts, chats, Tally bills, campaigns)",
    sql: `
      SELECT
        (SELECT COUNT(*) FROM contacts) AS contacts,
        (SELECT COUNT(*) FROM conversations) AS conversations,
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COUNT(*) FROM tally_vouchers) AS tally_vouchers,
        (SELECT COUNT(*) FROM campaigns) AS campaigns,
        (SELECT COUNT(*) FROM reviews) AS reviews,
        (SELECT COUNT(*) FROM outbox WHERE status = 'pending') AS pending_tasks
    `,
  },
  recent_conversations: {
    label: "Latest 20 customer chats (status & reply times only)",
    sql: `
      SELECT id, channel, status, unread_count, sla_breached, first_reply_time_sec, last_activity_at
      FROM conversations
      ORDER BY last_activity_at DESC
      LIMIT 20
    `,
  },
  recent_vouchers: {
    label: "Latest 20 Tally bills & payment status",
    sql: `
      SELECT voucher_number, voucher_type, amount_paise, paid_amount_paise, payment_status, reminders_sent_count, voucher_date
      FROM tally_vouchers
      ORDER BY voucher_date DESC
      LIMIT 20
    `,
  },
  outbox_pending: {
    label: "Waiting or failed background tasks",
    sql: `
      SELECT id, queue_name, job_type, status, attempts, last_error, created_at
      FROM outbox
      WHERE status IN ('pending', 'failed')
      ORDER BY created_at DESC
      LIMIT 30
    `,
  },
  integrity_quick_check: {
    label: "Account data file health check",
    sql: `PRAGMA quick_check`,
  },
} as const;

export type InspectorQueryKey = keyof typeof ALLOWLISTED_INSPECTOR_QUERIES;

/**
 * Staff Tenant Inspector (Section 7.7):
 * Opens a strictly read-only SQLite connection, executes ONLY allowlisted read-only queries,
 * and writes an immutable audit trail entry to platform-logs.db.
 */
export function runAllowlistedTenantInspection(params: {
  staffId: string;
  tenantId: string;
  queryKey: InspectorQueryKey;
  ticketReference: string;
  correlationId?: string;
}): Record<string, unknown>[] {
  const validId = assertValidUlid(params.tenantId, "tenantId");
  if (!params.ticketReference.trim()) {
    throw new Error("Ticket reference is mandatory for Tenant Inspector access");
  }

  const ctrl = controlDb();
  const reg = ctrl
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.tenantId, validId))
    .get();
  if (!reg) {
    throw new Error("Tenant not found in registry");
  }

  const def = ALLOWLISTED_INSPECTOR_QUERIES[params.queryKey];
  const ro = createSqliteClient(reg.dataDbPath, { readonly: true });
  ro.pragma("trusted_schema = OFF");

  try {
    const rows = ro.prepare(def.sql).all() as Record<string, unknown>[];
    platformLogsDb()
      .insert(platformLogsSchema.staffActionLogs)
      .values({
        id: newId(),
        ts: Date.now(),
        staffId: params.staffId,
        action: `inspector.${params.queryKey}`,
        targetTenantId: validId,
        ticketReference: params.ticketReference.trim(),
        summary: `Executed read-only query '${def.label}' (${rows.length} rows)`,
        correlationId: params.correlationId ?? newId(),
      })
      .run();
    return rows;
  } finally {
    ro.close();
  }
}

export function migrateAllTenantsWithCanary(): {
  total: number;
  migrated: number;
  failed: string[];
} {
  const ctrl = controlDb();
  const allTenants = ctrl.select().from(controlSchema.tenantRegistry).all();
  const activeTenants = allTenants.filter((t) => t.status === "active" || t.status === "suspended");

  const canarySlice = activeTenants.slice(0, 5);
  const restSlice = activeTenants.slice(5);
  const failed: string[] = [];
  let migrated = 0;

  const migrateOne = (tenant: (typeof activeTenants)[number]): boolean => {
    try {
      closeTenantHandles(tenant.tenantId);
      const dataRaw = createSqliteClient(tenant.dataDbPath);
      applyConnectionPragmas(dataRaw, "standard");
      const dv = runSqlMigrations(dataRaw, TENANT_DATA_MIGRATIONS);
      dataRaw.close();

      const logsRaw = createSqliteClient(tenant.logsDbPath);
      applyConnectionPragmas(logsRaw, "standard");
      const lv = runSqlMigrations(logsRaw, TENANT_LOGS_MIGRATIONS);
      logsRaw.close();

      ctrl
        .update(controlSchema.tenantRegistry)
        .set({
          dataSchemaVersion: dv,
          logsSchemaVersion: lv,
          updatedAt: Date.now(),
        })
        .where(eq(controlSchema.tenantRegistry.tenantId, tenant.tenantId))
        .run();

      migrated++;
      return true;
    } catch {
      ctrl
        .update(controlSchema.tenantRegistry)
        .set({ status: "migration_failed", updatedAt: Date.now() })
        .where(eq(controlSchema.tenantRegistry.tenantId, tenant.tenantId))
        .run();
      failed.push(tenant.tenantId);
      return false;
    }
  };

  // Canary first: halt immediately on any canary failure (Section 7.6)
  for (const canary of canarySlice) {
    if (!migrateOne(canary)) {
      return { total: activeTenants.length, migrated, failed };
    }
  }

  for (const tenant of restSlice) {
    migrateOne(tenant);
  }

  return { total: activeTenants.length, migrated, failed };
}

export function getTenancyHandleMetrics() {
  const env = getEnv();
  const platformDir = path.join(env.DATA_DIR, "platform");
  const statSafe = (filePath: string) => {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  };

  return {
    openDataHandles: dataHandleCache.size,
    openLogsHandles: logsHandleCache.size,
    maxOpenHandles: env.TENANT_DB_MAX_OPEN,
    idleCloseMs: env.TENANT_DB_IDLE_CLOSE_MS,
    platformFiles: {
      controlDbBytes: statSafe(path.join(platformDir, "control.db")),
      controlWalBytes: statSafe(path.join(platformDir, "control.db-wal")),
      ingressDbBytes: statSafe(path.join(platformDir, "ingress.db")),
      platformLogsDbBytes: statSafe(path.join(platformDir, "platform-logs.db")),
    },
  };
}

export * from "./ssl";
export * from "./platform-credentials";
