import { NextResponse } from "next/server";

export const OPENAPI_V1_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "RapidShift Labs Public REST API",
    version: "1.0.0",
    description:
      "Scoped Bearer API for Tally vouchers, customer contacts, WhatsApp Business templates, and server-side conversion events. All POST endpoints accept an optional Idempotency-Key header (24h retention). Breaking changes require a new /api/v2 prefix with a minimum 6-month Sunset header notice.",
    contact: {
      name: "RapidShift Labs API Support",
      email: "app@rapidshiftlabs.in",
    },
  },
  servers: [{ url: "/api/v1", description: "Version 1 REST API" }],
  components: {
    securitySchemes: {
      bearerApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "rsl_live_<prefix>_<secret>",
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string", minLength: 4, maxLength: 160 },
        description: "Client-supplied key ensuring at-most-once execution for 24 hours.",
      },
      LimitParam: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      OffsetParam: {
        name: "offset",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  security: [{ bearerApiKey: [] }],
  paths: {
    "/contacts": {
      get: {
        summary: "List workspace contacts (paginated)",
        description: "Requires scope `contacts:read`.",
        parameters: [
          { $ref: "#/components/parameters/LimitParam" },
          { $ref: "#/components/parameters/OffsetParam" },
        ],
        responses: { "200": { description: "Paginated contacts list" } },
      },
      post: {
        summary: "Create or upsert a customer contact",
        description: "Requires scope `contacts:write`.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 160 },
                  phoneE164: { type: "string", maxLength: 24 },
                  email: { type: "string", format: "email" },
                  companyName: { type: "string", maxLength: 160 },
                  recordWhatsAppConsent: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Created contact" } },
      },
    },
    "/vouchers": {
      get: {
        summary: "List Tally vouchers and receivables summary (paginated)",
        description: "Requires scope `vouchers:read`.",
        parameters: [
          { $ref: "#/components/parameters/LimitParam" },
          { $ref: "#/components/parameters/OffsetParam" },
        ],
        responses: { "200": { description: "Paginated vouchers and workspace totals" } },
      },
      post: {
        summary: "Record a Tally voucher",
        description: "Requires scope `vouchers:write`. Accepts integer `amountPaise` or finite `amountRupees`.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["voucherNumber", "partyName"],
                properties: {
                  companyName: { type: "string", default: "Primary Tally Company" },
                  voucherNumber: { type: "string", minLength: 1, maxLength: 80 },
                  voucherType: {
                    type: "string",
                    enum: ["Sales", "Receipt", "CreditNote", "Purchase"],
                  },
                  partyName: { type: "string", minLength: 1, maxLength: 160 },
                  partyPhoneE164: { type: "string", maxLength: 32 },
                  amountPaise: { type: "integer", minimum: 1 },
                  amountRupees: { type: "number", exclusiveMinimum: 0 },
                  paidAmountPaise: { type: "integer", minimum: 0 },
                  paidAmountRupees: { type: "number", minimum: 0 },
                  voucherDateIso: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  dueDateIso: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Recorded voucher" } },
      },
    },
    "/tally/bill-event": {
      post: {
        summary: "Ingest Tally Prime XML or JSON bill batch and enqueue automation",
        description: "Requires scope `vouchers:write` and active `api.access` + `tally.sync` entitlements.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "202": { description: "Accepted and queued" } },
      },
    },
    "/whatsapp/templates": {
      get: {
        summary: "List WhatsApp Business message templates",
        description: "Requires scope `contacts:read`.",
        parameters: [
          { $ref: "#/components/parameters/LimitParam" },
          { $ref: "#/components/parameters/OffsetParam" },
        ],
        responses: { "200": { description: "Paginated templates list" } },
      },
      post: {
        summary: "Create and optionally submit a WhatsApp Business template",
        description: "Requires scope `whatsapp:write`.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "201": { description: "Template created" } },
      },
    },
    "/whatsapp/send-template": {
      post: {
        summary: "Queue an approved WhatsApp Business template message",
        description: "Requires scope `whatsapp:write` and active `api.access` + `whatsapp.messaging` entitlements.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "202": { description: "Queued in transactional outbox" } },
      },
    },
    "/pixel/events": {
      post: {
        summary: "Ingest deduplicated website conversion event (Pixel / CAPI)",
        description: "Requires scope `pixel:write` (`contacts:write` fallback sunsets 2026-12-31).",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        responses: { "201": { description: "Conversion event recorded" } },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(OPENAPI_V1_SPEC, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
