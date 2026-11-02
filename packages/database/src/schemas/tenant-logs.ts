import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const actionLogs = sqliteTable(
  "action_logs",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    actorType: text("actor_type").notNull(), // user | api_key | system | agent | staff | webhook
    actorId: text("actor_id").notNull(),
    impersonatorId: text("impersonator_id"),
    source: text("source").notNull(), // web | admin | api | worker | agent | webhook
    action: text("action").notNull(), // dotted key e.g. inbox.reply.sent
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    assetId: text("asset_id"),
    outcome: text("outcome").notNull(), // success | denied | error | skipped
    errorCode: text("error_code"),
    requestId: text("request_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    durationMs: integer("duration_ms").notNull(),
    summary: text("summary").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    index("idx_action_logs_ts").on(t.ts),
    index("idx_action_logs_actor_ts").on(t.actorId, t.ts),
    index("idx_action_logs_action_ts").on(t.action, t.ts),
    index("idx_action_logs_correlation").on(t.correlationId),
  ]
);

export const providerCalls = sqliteTable(
  "provider_calls",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    provider: text("provider").notNull(), // meta | whatsapp | google | razorpay | r2 | s3 | gdrive
    operation: text("operation").notNull(),
    method: text("method").notNull(),
    status: integer("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    rateLimitState: text("rate_limit_state"),
    providerRequestId: text("provider_request_id"),
    errorCode: text("error_code"),
    redactedErrorBody: text("redacted_error_body"),
    correlationId: text("correlation_id").notNull(),
  },
  (t) => [
    index("idx_provider_calls_correlation").on(t.correlationId),
    index("idx_provider_calls_provider_ts").on(t.provider, t.ts),
  ]
);

export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    queue: text("queue").notNull(),
    jobType: text("job_type").notNull(),
    status: text("status").notNull(), // active | completed | retrying | dead | skipped
    attempt: integer("attempt").notNull().default(1),
    durationMs: integer("duration_ms").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: text("correlation_id").notNull(),
  },
  (t) => [
    index("idx_job_runs_correlation").on(t.correlationId),
    index("idx_job_runs_queue_status_ts").on(t.queue, t.status, t.ts),
  ]
);

export const eventLogs = sqliteTable(
  "event_logs",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    externalEventId: text("external_event_id").notNull(),
    outcome: text("outcome").notNull(), // processed | ignored | error
    correlationId: text("correlation_id").notNull(),
    summary: text("summary").notNull(),
  },
  (t) => [index("idx_event_logs_correlation").on(t.correlationId)]
);

/**
 * SendGuard (Section 14.5): Non-restorable guard preventing duplicate sends on retry or restore.
 */
export const sendGuards = sqliteTable(
  "send_guards",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    channel: text("channel").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    state: text("state").notNull(), // reserved | sent | confirmed | failed | uncertain
    externalId: text("external_id"),
    reservedAt: integer("reserved_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_send_guard_key").on(t.idempotencyKey)]
);

/**
 * Suppressions (Section 7.2 & 16): Non-restorable opt-out/unsubscribed numbers.
 * Kept in logs/current.db so restoring an older data.db can NEVER resurrect revoked consent.
 */
export const suppressions = sqliteTable(
  "suppressions",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(), // whatsapp | sms | email
    identifier: text("identifier").notNull(), // E.164 phone or lowercase email
    reason: text("reason").notNull(), // customer_stop_keyword | manual_block | bounce
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_suppression_channel_id").on(t.channel, t.identifier)]
);

export const backupRuns = sqliteTable("backup_runs", {
  id: text("id").primaryKey(),
  destinationId: text("destination_id"),
  destinationName: text("destination_name").notNull(),
  kind: text("kind").notNull().default("backup"), // backup | portable_export | restore
  status: text("status").notNull(), // running | completed | failed
  sizeBytes: integer("size_bytes").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  checksumSha256: text("checksum_sha256"),
  artifactPath: text("artifact_path"),
  errorCode: text("error_code"),
  createdAt: integer("created_at").notNull(),
});

export const logsSchemaMeta = sqliteTable("schema_meta", {
  version: integer("version").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});
