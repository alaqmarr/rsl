import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const webhookInbox = sqliteTable(
  "webhook_inbox",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(), // meta | whatsapp | google | razorpay
    eventId: text("event_id").notNull(),
    rawBody: text("raw_body").notNull(),
    headersJson: text("headers_json").notNull(),
    signatureValid: integer("signature_valid", { mode: "boolean" }).notNull(),
    routedTenantId: text("routed_tenant_id"),
    status: text("status").notNull().default("received"), // received | enqueued | processed | dead | ignored
    errorMessage: text("error_message"),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at"),
  },
  (t) => [
    uniqueIndex("uq_webhook_provider_event").on(t.provider, t.eventId),
    index("idx_webhook_status_ts").on(t.status, t.receivedAt),
  ]
);
