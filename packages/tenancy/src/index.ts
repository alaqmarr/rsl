import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
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
  readonly apiKeyScopes?: string[] | null;
  readonly systemCapability?: string | null;
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
let ingressAppliedVersion = 0;
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
  const latestIngressVersion = INGRESS_MIGRATIONS[INGRESS_MIGRATIONS.length - 1]?.version ?? 0;
  if (ingressSingleton) {
    if (ingressAppliedVersion < latestIngressVersion) {
      ingressAppliedVersion = runSqlMigrations(ingressSingleton.$client, INGRESS_MIGRATIONS);
    }
    return ingressSingleton;
  }
  const env = getEnv();
  const platformDir = path.join(env.DATA_DIR, "platform");
  ensureSecureDir(platformDir);

  const dbPath = path.join(platformDir, "ingress.db");
  const raw = createSqliteClient(dbPath);
  applyConnectionPragmas(raw, "standard");
  ingressAppliedVersion = runSqlMigrations(raw, INGRESS_MIGRATIONS);
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

interface CachedHandle<T extends { $client: TenantDataDb["$client"] }> {
  db: T;
  close: () => void;
}

function disposeHandleSafely<T extends { $client: TenantDataDb["$client"] }>(
  value: CachedHandle<T>,
  reason: LRUCache.DisposeReason
): void {
  // Explicit deletes (restore, backup close, shutdown, crypto-shred) must release OS locks synchronously
  if (reason === "delete" || reason === "set") {
    value.close();
    return;
  }

  // Evict / TTL expire: defer past current synchronous call stack and wait out active transactions
  const attemptClose = (retriesLeft: number) => {
    try {
      const raw = value.db.$client;
      if (raw.open && raw.inTransaction && retriesLeft > 0) {
        const timer = setTimeout(() => attemptClose(retriesLeft - 1), 200);
        timer.unref?.();
        return;
      }
    } catch {
      // Fall through to close
    }
    value.close();
  };

  const immediate = setImmediate(() => attemptClose(10));
  immediate.unref?.();
}

const dataHandleCache = new LRUCache<string, CachedHandle<TenantDataDb>>({
  max: getEnv().TENANT_DB_MAX_OPEN,
  ttl: getEnv().TENANT_DB_IDLE_CLOSE_MS,
  updateAgeOnGet: true,
  dispose: (value, _key, reason) => {
    disposeHandleSafely(value, reason);
  },
});

const logsHandleCache = new LRUCache<string, CachedHandle<TenantLogsDb>>({
  max: getEnv().TENANT_DB_MAX_OPEN,
  ttl: getEnv().TENANT_DB_IDLE_CLOSE_MS,
  updateAgeOnGet: true,
  dispose: (value, _key, reason) => {
    disposeHandleSafely(value, reason);
  },
});

interface CachedTenantRegistryRow {
  dataDbPath: string;
  logsDbPath: string;
  status: string;
  dataSchemaVersion: number;
  logsSchemaVersion: number;
}

const tenantRegistryCache = new LRUCache<string, CachedTenantRegistryRow>({
  max: 2000,
  ttl: 5_000,
});

const tenantInvalidationListeners = new Set<(tenantId?: string) => void>();

export function onTenantRegistryInvalidated(listener: (tenantId?: string) => void): void {
  tenantInvalidationListeners.add(listener);
}

export function invalidateTenantRegistryCache(tenantId?: string): void {
  if (tenantId) {
    tenantRegistryCache.delete(tenantId);
  } else {
    tenantRegistryCache.clear();
  }
  for (const listener of tenantInvalidationListeners) {
    try {
      listener(tenantId);
    } catch {
      // Never block cache invalidation on listener errors
    }
  }
}

function verifyActiveTenantStatus(tenantId: string, allowSuspendedRead = false): CachedTenantRegistryRow {
  let reg = tenantRegistryCache.get(tenantId);
  if (!reg) {
    const ctrl = controlDb();
    const dbRow = ctrl
      .select()
      .from(controlSchema.tenantRegistry)
      .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
      .get();

    if (!dbRow) {
      throw new RslError("RSL-TENANT-1001", "Business storage is not initialized yet.");
    }
    reg = {
      dataDbPath: dbRow.dataDbPath,
      logsDbPath: dbRow.logsDbPath,
      status: dbRow.status,
      dataSchemaVersion: dbRow.dataSchemaVersion,
      logsSchemaVersion: dbRow.logsSchemaVersion,
    };
    tenantRegistryCache.set(tenantId, reg);
  }

  if (reg.status === "restoring" || reg.status === "migrating" || reg.status === "migration_failed" || reg.status === "deleted") {
    throw new RslError("RSL-TENANT-1001");
  }

  if (reg.status === "suspended" && !allowSuspendedRead) {
    throw new RslError("RSL-TENANT-1002");
  }

  return reg;
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

  // Write to control.db ONLY when a lazy schema migration actually advanced the version
  if (version !== reg.dataSchemaVersion) {
    const ctrl = controlDb();
    ctrl
      .update(controlSchema.tenantRegistry)
      .set({ dataSchemaVersion: version, updatedAt: Date.now() })
      .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
      .run();
    reg.dataSchemaVersion = version;
    tenantRegistryCache.set(tenantId, reg);
  }

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

  if (version !== reg.logsSchemaVersion) {
    const ctrl = controlDb();
    ctrl
      .update(controlSchema.tenantRegistry)
      .set({ logsSchemaVersion: version, updatedAt: Date.now() })
      .where(eq(controlSchema.tenantRegistry.tenantId, tenantId))
      .run();
    reg.logsSchemaVersion = version;
    tenantRegistryCache.set(tenantId, reg);
  }

  return wrapped;
}

export function closeTenantHandles(tenantId: string): void {
  const validId = assertValidUlid(tenantId, "tenantId");
  tenantRegistryCache.delete(validId);
  dataHandleCache.delete(validId);
  logsHandleCache.delete(validId);
}

export function closeAllHandlesForShutdown(): void {
  for (const handle of dataHandleCache.values()) {
    try {
      if (handle.db.$client.open) {
        handle.db.$client.pragma("wal_checkpoint(PASSIVE)");
      }
    } catch {
      // Best-effort checkpoint during shutdown
    }
    handle.close();
  }
  for (const handle of logsHandleCache.values()) {
    try {
      if (handle.db.$client.open) {
        handle.db.$client.pragma("wal_checkpoint(PASSIVE)");
      }
    } catch {
      // Best-effort checkpoint during shutdown
    }
    handle.close();
  }
  tenantRegistryCache.clear();
  dataHandleCache.clear();
  logsHandleCache.clear();
  if (controlSingleton) {
    try {
      if (controlSingleton.$client.open) {
        controlSingleton.$client.pragma("wal_checkpoint(PASSIVE)");
      }
    } catch {
      // Best-effort checkpoint during shutdown
    }
    controlSingleton.$client.close();
    controlSingleton = null;
    controlAppliedVersion = 0;
  }
  if (ingressSingleton) {
    try {
      if (ingressSingleton.$client.open) {
        ingressSingleton.$client.pragma("wal_checkpoint(PASSIVE)");
      }
    } catch {
      // Best-effort checkpoint during shutdown
    }
    ingressSingleton.$client.close();
    ingressSingleton = null;
    ingressAppliedVersion = 0;
  }
  if (platformLogsSingleton) {
    try {
      if (platformLogsSingleton.$client.open) {
        platformLogsSingleton.$client.pragma("wal_checkpoint(PASSIVE)");
      }
    } catch {
      // Best-effort checkpoint during shutdown
    }
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
        status: "active",
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
  tenantRegistryCache.delete(validId);

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

/* ============================================================================
 * DPDP Act 2023 Right-to-Access Export, Crypto-Shredding Erasure & Staff Audit
 * ============================================================================ */

export interface CustomerVisibleStaffAccessEntry {
  id: string;
  kind: "impersonation" | "inspection" | "staff_action";
  ts: number;
  endedAt: number | null;
  staffName: string;
  staffRole: string;
  action: string;
  ticketReference: string | null;
  summary: string;
}

export function listCustomerVisibleStaffAccessLogs(
  workspaceId: string,
  limit = 50
): CustomerVisibleStaffAccessEntry[] {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const ctrl = controlDb();
  const plogs = platformLogsDb();

  const staffRows = ctrl.select().from(controlSchema.platformStaff).all();
  const staffMap = new Map(staffRows.map((s) => [s.id, s]));

  const impersonations = plogs
    .select()
    .from(platformLogsSchema.impersonationLogs)
    .where(eq(platformLogsSchema.impersonationLogs.workspaceId, validId))
    .orderBy(desc(platformLogsSchema.impersonationLogs.startedAt))
    .limit(limit)
    .all();

  const actions = plogs
    .select()
    .from(platformLogsSchema.staffActionLogs)
    .where(eq(platformLogsSchema.staffActionLogs.targetTenantId, validId))
    .orderBy(desc(platformLogsSchema.staffActionLogs.ts))
    .limit(limit)
    .all();

  const merged: CustomerVisibleStaffAccessEntry[] = [
    ...impersonations.map((imp) => {
      const staff = staffMap.get(imp.staffId);
      return {
        id: imp.id,
        kind: "impersonation" as const,
        ts: imp.startedAt,
        endedAt: imp.endedAt ?? null,
        staffName: staff?.name ?? "Platform Support Engineer",
        staffRole: staff?.staffRole ?? "support",
        action: "support.impersonation_session",
        ticketReference: null,
        summary: `Temporary support session (${imp.reason})`,
      };
    }),
    ...actions.map((act) => {
      const staff = staffMap.get(act.staffId);
      return {
        id: act.id,
        kind: (act.action.startsWith("inspector.") ? "inspection" : "staff_action") as
          | "inspection"
          | "staff_action",
        ts: act.ts,
        endedAt: null,
        staffName: staff?.name ?? "Platform Staff",
        staffRole: staff?.staffRole ?? "support",
        action: act.action,
        ticketReference: act.ticketReference ?? null,
        summary: act.summary,
      };
    }),
  ];

  return merged.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function exportWorkspaceDataPortabilitySnapshot(workspaceId: string): Record<string, unknown> {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const ctrl = controlDb();
  const ws = ctrl
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, validId))
    .get();
  if (!ws) {
    throw new RslError("RSL-TENANT-1001", "Workspace not found.");
  }

  const tdb = tenantDataDb({ workspaceId: validId }, { allowSuspendedRead: true });
  const raw = tdb.$client;

  const safeAll = (table: string, maxRows = 10_000) => {
    try {
      return raw.prepare(`SELECT * FROM ${table} LIMIT ?`).all(maxRows);
    } catch {
      return [];
    }
  };

  return {
    exportedAt: new Date().toISOString(),
    schema: "rsl-dpdp-portability-v1",
    workspace: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      gstin: ws.gstin,
      billingEmail: ws.billingEmail,
      businessPhone: ws.businessPhone,
      stateCode: ws.stateCode,
      currency: ws.currency,
      timezone: ws.timezone,
      createdAt: ws.createdAt,
    },
    invoices: ctrl
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.workspaceId, validId))
      .all(),
    ledgerEntries: ctrl
      .select()
      .from(controlSchema.ledgerEntries)
      .where(eq(controlSchema.ledgerEntries.workspaceId, validId))
      .all(),
    contacts: safeAll("contacts"),
    conversations: safeAll("conversations"),
    messages: safeAll("messages"),
    tallyCompanies: safeAll("tally_companies"),
    tallyParties: safeAll("tally_parties"),
    tallyVouchers: safeAll("tally_vouchers"),
    campaigns: safeAll("campaigns"),
    reviews: safeAll("reviews"),
    staffAccessAuditTrail: listCustomerVisibleStaffAccessLogs(validId, 200),
  };
}

export function eraseAndCryptoShredWorkspace(params: {
  workspaceId: string;
  actorId: string;
  reason: string;
}): { shreddedAt: number; tombstoneId: string } {
  const validId = assertValidUlid(params.workspaceId, "workspaceId");
  const ctrl = controlDb();
  const ws = ctrl
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, validId))
    .get();
  if (!ws) {
    throw new RslError("RSL-TENANT-1001", "Workspace does not exist.");
  }

  const reason = params.reason.trim() || "DPDP right-to-erasure request";
  const now = Date.now();

  // 1. Release all open SQLite handles before unlinking tenant files
  closeTenantHandles(validId);

  // 2. Crypto-shred wrapped secrets, revoke tokens/sessions, and scrub workspace PII in one transaction
  const shredSentinel = `shredded:${crypto.randomBytes(16).toString("hex")}`;
  const tx = ctrl.$client.transaction(() => {
    ctrl
      .update(controlSchema.tenantRegistry)
      .set({
        status: "deleted",
        nextOutboxAt: null,
        dataSizeBytes: 0,
        logsSizeBytes: 0,
        updatedAt: now,
      })
      .where(eq(controlSchema.tenantRegistry.tenantId, validId))
      .run();

    ctrl
      .update(controlSchema.connections)
      .set({ encryptedTokens: shredSentinel, status: "revoked", updatedAt: now })
      .where(eq(controlSchema.connections.workspaceId, validId))
      .run();

    ctrl
      .update(controlSchema.agentDevices)
      .set({ signingSecretEncrypted: shredSentinel, status: "revoked", revokedAt: now })
      .where(eq(controlSchema.agentDevices.workspaceId, validId))
      .run();

    ctrl
      .update(controlSchema.backupDestinations)
      .set({ encryptedConfig: shredSentinel, status: "degraded" })
      .where(eq(controlSchema.backupDestinations.workspaceId, validId))
      .run();

    ctrl
      .update(controlSchema.storageConfigurations)
      .set({ encryptedCredentials: null, usedBytes: 0, objectCount: 0, status: "deleted", updatedAt: now })
      .where(eq(controlSchema.storageConfigurations.workspaceId, validId))
      .run();

    ctrl
      .update(controlSchema.apiKeys)
      .set({ revokedAt: now })
      .where(eq(controlSchema.apiKeys.workspaceId, validId))
      .run();

    ctrl.delete(controlSchema.tallyWebhookEndpoints).where(eq(controlSchema.tallyWebhookEndpoints.workspaceId, validId)).run();
    ctrl.delete(controlSchema.outboundWebhookEndpoints).where(eq(controlSchema.outboundWebhookEndpoints.workspaceId, validId)).run();
    ctrl.delete(controlSchema.webPushSubscriptions).where(eq(controlSchema.webPushSubscriptions.workspaceId, validId)).run();
    ctrl.delete(controlSchema.invitations).where(eq(controlSchema.invitations.workspaceId, validId)).run();
    ctrl.delete(controlSchema.assetRouting).where(eq(controlSchema.assetRouting.tenantId, validId)).run();
    ctrl.delete(controlSchema.sessions).where(eq(controlSchema.sessions.activeWorkspaceId, validId)).run();
    ctrl.delete(controlSchema.memberships).where(eq(controlSchema.memberships.workspaceId, validId)).run();

    ctrl
      .update(controlSchema.workspaces)
      .set({
        name: `[Deleted Workspace ${validId.slice(-6)}]`,
        businessPhone: null,
        billingEmail: null,
        website: null,
        addressLine: null,
        city: null,
        pincode: null,
        gstin: null,
        upiVpa: null,
        upiPayeeName: null,
        bankName: null,
        bankBranch: null,
        bankAccountNumber: null,
        bankIfsc: null,
        webhookVerifyToken: null,
        billingStatus: "cancelled",
        publicLinkEpoch: (ws.publicLinkEpoch ?? 1) + 1000,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.workspaces.id, validId))
      .run();
  });
  tx();
  invalidateTenantRegistryCache(validId);

  // 3. Remove physical per-tenant SQLite & log files on disk
  const tenantDir = resolveSafeTenantDir(validId);
  if (fs.existsSync(tenantDir)) {
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }

  // 4. Write immutable deletion tombstone in platform-logs.db
  platformLogsDb()
    .insert(platformLogsSchema.tenantDeletionTombstones)
    .values({
      tenantId: validId,
      workspaceName: ws.name,
      deletedByActorId: params.actorId,
      cryptoShreddedAt: now,
      reason,
    })
    .onConflictDoUpdate({
      target: platformLogsSchema.tenantDeletionTombstones.tenantId,
      set: {
        deletedByActorId: params.actorId,
        cryptoShreddedAt: now,
        reason,
      },
    })
    .run();

  return { shreddedAt: now, tombstoneId: validId };
}

/**
 * Checks whether a token uses the explicit internal `rsl_sandbox_` sentinel.
 * Real provider tokens beginning with `test_` or `sandbox_` are never treated as sandbox tokens.
 */
export function isExplicitInternalSandboxSentinel(token?: string | null): boolean {
  return typeof token === "string" && token.trim().startsWith("rsl_sandbox_");
}

/**
 * Returns true only when an explicit `rsl_sandbox_` sentinel is paired with a `"test"` workspace
 * (or automated test runner). Live production workspaces never enter simulated sandbox mode.
 */
export function isWorkspaceSandboxIntegrationMode(
  workspaceId: string,
  token?: string | null
): boolean {
  if (!isExplicitInternalSandboxSentinel(token)) {
    return false;
  }
  const ws = controlDb()
    .select({ mode: controlSchema.workspaces.mode })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  if (ws?.mode === "test") {
    return true;
  }
  if (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) {
    return true;
  }
  return false;
}

export * from "./ssl";
export * from "./platform-credentials";
export * from "./credential-diagnostics";
export * from "./free-ai-services";
export * from "./client-cloudflare";
