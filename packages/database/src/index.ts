import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as controlSchema from "./schemas/control";
import * as ingressSchema from "./schemas/ingress";
import * as platformLogsSchema from "./schemas/platform-logs";
import * as tenantDataSchema from "./schemas/tenant-data";
import * as tenantLogsSchema from "./schemas/tenant-logs";

export * as controlSchema from "./schemas/control";
export * as ingressSchema from "./schemas/ingress";
export * as platformLogsSchema from "./schemas/platform-logs";
export * as tenantDataSchema from "./schemas/tenant-data";
export * as tenantLogsSchema from "./schemas/tenant-logs";
export * from "./ddl";

export type ControlDb = BetterSQLite3Database<typeof controlSchema> & { $client: Database.Database };
export type IngressDb = BetterSQLite3Database<typeof ingressSchema> & { $client: Database.Database };
export type PlatformLogsDb = BetterSQLite3Database<typeof platformLogsSchema> & { $client: Database.Database };
export type TenantDataDb = BetterSQLite3Database<typeof tenantDataSchema> & { $client: Database.Database };
export type TenantLogsDb = BetterSQLite3Database<typeof tenantLogsSchema> & { $client: Database.Database };

export function createSqliteClient(filePath: string, options?: Database.Options): Database.Database {
  return new Database(filePath, options);
}

export function wrapControlDb(sqlite: Database.Database): ControlDb {
  return Object.assign(drizzle(sqlite, { schema: controlSchema }), { $client: sqlite });
}

export function wrapIngressDb(sqlite: Database.Database): IngressDb {
  return Object.assign(drizzle(sqlite, { schema: ingressSchema }), { $client: sqlite });
}

export function wrapPlatformLogsDb(sqlite: Database.Database): PlatformLogsDb {
  return Object.assign(drizzle(sqlite, { schema: platformLogsSchema }), { $client: sqlite });
}

export function wrapTenantDataDb(sqlite: Database.Database): TenantDataDb {
  return Object.assign(drizzle(sqlite, { schema: tenantDataSchema }), { $client: sqlite });
}

export function wrapTenantLogsDb(sqlite: Database.Database): TenantLogsDb {
  return Object.assign(drizzle(sqlite, { schema: tenantLogsSchema }), { $client: sqlite });
}
