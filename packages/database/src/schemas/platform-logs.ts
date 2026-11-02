import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const staffActionLogs = sqliteTable(
  "staff_action_logs",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    staffId: text("staff_id").notNull(),
    action: text("action").notNull(),
    targetTenantId: text("target_tenant_id"),
    ticketReference: text("ticket_reference"),
    summary: text("summary").notNull(),
    correlationId: text("correlation_id").notNull(),
    ipAddress: text("ip_address"),
  },
  (t) => [index("idx_staff_action_ts").on(t.ts)]
);

export const impersonationLogs = sqliteTable("impersonation_logs", {
  id: text("id").primaryKey(),
  staffId: text("staff_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  targetUserId: text("target_user_id").notNull(),
  reason: text("reason").notNull(),
  startedAt: integer("started_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  endedAt: integer("ended_at"),
});

export const systemEvents = sqliteTable(
  "system_events",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    severity: text("severity").notNull(), // info | warn | error | critical
    component: text("component").notNull(),
    message: text("message").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
  },
  (t) => [index("idx_system_events_ts").on(t.ts)]
);

export const tenantDeletionTombstones = sqliteTable("tenant_deletion_tombstones", {
  tenantId: text("tenant_id").primaryKey(),
  workspaceName: text("workspace_name").notNull(),
  deletedByActorId: text("deleted_by_actor_id").notNull(),
  cryptoShreddedAt: integer("crypto_shredded_at").notNull(),
  reason: text("reason").notNull(),
});
