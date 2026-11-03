import fs from "node:fs";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import pino, { type Logger } from "pino";
import type { z } from "zod";
import {
  computeChainHash,
  err,
  getContext,
  getEnv,
  newId,
  ok,
  RslError,
  runWithContext,
  type ActorType,
  type ErrorCode,
  type RequestSource,
  type Result,
} from "@rsl/core";
import { requireEntitlement } from "@rsl/billing";
import { controlSchema, platformLogsSchema, tenantLogsSchema } from "@rsl/database";
import { authorize, type Permission } from "@rsl/rbac";
import { controlDb, platformLogsDb, tenantLogsDb, type TenantContext } from "@rsl/tenancy";

export interface ActionCatalogEntry {
  key: string;
  label: string;
  category: string;
  severity: "normal" | "important" | "critical";
}

export const ACTION_CATALOG = {
  "workspace.updated": { key: "workspace.updated", label: "Updated business settings", category: "Business", severity: "important" },
  "team.member.invited": { key: "team.member.invited", label: "Invited a team member", category: "Team", severity: "important" },
  "team.invite.accepted": { key: "team.invite.accepted", label: "Accepted team invitation", category: "Team", severity: "important" },
  "team.member.role_updated": { key: "team.member.role_updated", label: "Updated a team member's role", category: "Team", severity: "important" },
  "team.member.removed": { key: "team.member.removed", label: "Removed a team member", category: "Team", severity: "critical" },
  "user.password.changed": { key: "user.password.changed", label: "Changed account password", category: "Team", severity: "important" },
  "user.profile.updated": { key: "user.profile.updated", label: "Updated personal profile", category: "Team", severity: "normal" },
  "user.session.revoked": { key: "user.session.revoked", label: "Signed out an active browser session", category: "Team", severity: "important" },

  "billing.wallet.topup": { key: "billing.wallet.topup", label: "Added funds to prepaid wallet", category: "Wallet & Billing", severity: "important" },
  "billing.service.activated": { key: "billing.service.activated", label: "Activated a business plan", category: "Wallet & Billing", severity: "important" },
  "billing.service.deactivated": { key: "billing.service.deactivated", label: "Cancelled a business plan", category: "Wallet & Billing", severity: "important" },

  "connections.linked": { key: "connections.linked", label: "Connected an external account", category: "Connected Apps", severity: "important" },
  "connections.updated": { key: "connections.updated", label: "Updated connected account or rotated token", category: "Connected Apps", severity: "important" },
  "connections.verified": { key: "connections.verified", label: "Verified connected account health", category: "Connected Apps", severity: "normal" },
  "connections.disconnected": { key: "connections.disconnected", label: "Disconnected an external account", category: "Connected Apps", severity: "critical" },

  "inbox.contact.created": { key: "inbox.contact.created", label: "Added a customer contact", category: "Customer Messages", severity: "normal" },
  "inbox.conversation.created": { key: "inbox.conversation.created", label: "Started or received a conversation", category: "Customer Messages", severity: "normal" },
  "inbox.reply.sent": { key: "inbox.reply.sent", label: "Sent a customer reply", category: "Customer Messages", severity: "normal" },
  "inbox.status.changed": { key: "inbox.status.changed", label: "Updated conversation status", category: "Customer Messages", severity: "normal" },
  "inbox.note.added": { key: "inbox.note.added", label: "Added an internal team note", category: "Customer Messages", severity: "normal" },
  "inbox.label.updated": { key: "inbox.label.updated", label: "Updated conversation labels", category: "Customer Messages", severity: "normal" },
  "inbox.assigned": { key: "inbox.assigned", label: "Assigned conversation to team member", category: "Customer Messages", severity: "normal" },
  "inbox.canned_reply.saved": { key: "inbox.canned_reply.saved", label: "Updated saved quick replies", category: "Customer Messages", severity: "normal" },

  "whatsapp.template.created": { key: "whatsapp.template.created", label: "Created a WhatsApp message template", category: "WhatsApp", severity: "normal" },
  "whatsapp.optin.recorded": { key: "whatsapp.optin.recorded", label: "Recorded customer WhatsApp permission", category: "WhatsApp", severity: "normal" },
  "whatsapp.suppression.added": { key: "whatsapp.suppression.added", label: "Added number to unsubscribed list", category: "WhatsApp", severity: "important" },
  "whatsapp.suppression.removed": { key: "whatsapp.suppression.removed", label: "Re-enabled opted-in WhatsApp number", category: "WhatsApp", severity: "important" },
  "whatsapp.broadcast.launched": { key: "whatsapp.broadcast.launched", label: "Launched a WhatsApp broadcast", category: "WhatsApp", severity: "important" },

  "tally.pairing.created": { key: "tally.pairing.created", label: "Generated Tally PC pairing code", category: "Tally Sync", severity: "important" },
  "tally.agent.paired": { key: "tally.agent.paired", label: "Paired Tally Prime Windows PC", category: "Tally Sync", severity: "important" },
  "tally.vouchers.synced": { key: "tally.vouchers.synced", label: "Synced Tally bills & receipts", category: "Tally Sync", severity: "normal" },
  "tally.invoice.sent": { key: "tally.invoice.sent", label: "Sent Tally bill reminder on WhatsApp", category: "Tally Sync", severity: "normal" },
  "tally.rule.created": { key: "tally.rule.created", label: "Saved payment reminder schedule", category: "Tally Sync", severity: "normal" },
  "tally.reminders.swept": { key: "tally.reminders.swept", label: "Processed due payment reminders", category: "Tally Sync", severity: "normal" },
  "tally.webhook.rotated": { key: "tally.webhook.rotated", label: "Rotated Tally Prime webhook token", category: "Tally Sync", severity: "important" },

  "campaigns.created": { key: "campaigns.created", label: "Created an ad campaign", category: "Ad Campaigns", severity: "normal" },
  "campaigns.status.updated": { key: "campaigns.status.updated", label: "Paused or resumed ad campaign", category: "Ad Campaigns", severity: "normal" },
  "campaigns.snapshot.recorded": { key: "campaigns.snapshot.recorded", label: "Recorded daily campaign metrics", category: "Ad Campaigns", severity: "normal" },
  "posts.scheduled": { key: "posts.scheduled", label: "Scheduled a social post", category: "Social Publishing", severity: "normal" },
  "posts.published": { key: "posts.published", label: "Published a social post", category: "Social Publishing", severity: "normal" },
  "posts.deleted": { key: "posts.deleted", label: "Removed a scheduled social post", category: "Social Publishing", severity: "normal" },
  "pixel.event.recorded": { key: "pixel.event.recorded", label: "Recorded website sales event", category: "Website Tracking", severity: "normal" },

  "reviews.recorded": { key: "reviews.recorded", label: "Synced Google Business review", category: "Google Reviews", severity: "normal" },
  "reviews.draft_generated": { key: "reviews.draft_generated", label: "Prepared smart reply draft for Google review", category: "Google Reviews", severity: "normal" },
  "reviews.replied": { key: "reviews.replied", label: "Published reply to Google review", category: "Google Reviews", severity: "normal" },

  "backup.destination.saved": { key: "backup.destination.saved", label: "Saved backup storage folder", category: "Backups", severity: "important" },
  "backup.created": { key: "backup.created", label: "Created signed encrypted backup", category: "Backups", severity: "important" },
  "backup.exported": { key: "backup.exported", label: "Exported portable business data", category: "Backups", severity: "important" },
  "backup.restored": { key: "backup.restored", label: "Restored business data from backup", category: "Backups", severity: "critical" },

  "apikeys.created": { key: "apikeys.created", label: "Created developer API key", category: "Developer API", severity: "critical" },
  "apikeys.rotated": { key: "apikeys.rotated", label: "Rotated developer API key", category: "Developer API", severity: "critical" },
  "apikeys.revoked": { key: "apikeys.revoked", label: "Revoked developer API key", category: "Developer API", severity: "critical" },
  "webhooks.endpoint.saved": { key: "webhooks.endpoint.saved", label: "Updated outbound webhook endpoint", category: "Developer API", severity: "important" },
  "webhooks.endpoint.tested": { key: "webhooks.endpoint.tested", label: "Sent signed test webhook", category: "Developer API", severity: "normal" },
  "api.v1.called": { key: "api.v1.called", label: "Processed public API request", category: "Developer API", severity: "normal" },
} as const satisfies Record<string, ActionCatalogEntry>;

export type ActionKey = keyof typeof ACTION_CATALOG | (string & {});

const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|cookie|apikey|api_key|private_key)/i;
const PHONE_REGEX = /\+?[1-9]\d{9,14}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RSL_KEY_REGEX = /rsl_(live|test)_[a-zA-Z0-9]+_[a-zA-Z0-9]+/g;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function redactText(input: string): string {
  return input
    .replace(RSL_KEY_REGEX, "[REDACTED_API_KEY]")
    .replace(BEARER_REGEX, "Bearer [REDACTED_TOKEN]")
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(PHONE_REGEX, "[REDACTED_PHONE]");
}

export function redactObject(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactObject);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactObject(v);
      }
    }
    return out;
  }
  return value;
}

function canonicalizeActionRow(row: {
  id: string;
  ts: number;
  actorType: string;
  actorId: string;
  action: string;
  outcome: string;
  correlationId: string;
  summary: string;
}): string {
  return JSON.stringify([
    row.id,
    row.ts,
    row.actorType,
    row.actorId,
    row.action,
    row.outcome,
    row.correlationId,
    row.summary,
  ]);
}

export function appendActionLog(params: {
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  impersonatorId?: string | null;
  source: RequestSource;
  action: ActionKey;
  resourceType?: string | null;
  resourceId?: string | null;
  assetId?: string | null;
  outcome: "success" | "denied" | "error" | "skipped";
  errorCode?: string | null;
  requestId: string;
  correlationId: string;
  ip?: string | null;
  userAgent?: string | null;
  durationMs: number;
  summary: string;
}): string {
  const logsDb = tenantLogsDb({ workspaceId: params.workspaceId });
  const raw = logsDb.$client;
  const id = newId("act", params.workspaceId);
  const ts = Date.now();
  const safeSummary = redactText(params.summary).slice(0, 500);

  const tx = raw.transaction(() => {
    const prevRow = raw
      .prepare("SELECT hash FROM action_logs ORDER BY rowid DESC LIMIT 1")
      .get() as { hash: string } | undefined;
    const prevHash = prevRow?.hash ?? "GENESIS";

    const canonical = canonicalizeActionRow({
      id,
      ts,
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      outcome: params.outcome,
      correlationId: params.correlationId,
      summary: safeSummary,
    });
    const hash = computeChainHash(prevHash, canonical);

    logsDb
      .insert(tenantLogsSchema.actionLogs)
      .values({
        id,
        ts,
        actorType: params.actorType,
        actorId: params.actorId,
        impersonatorId: params.impersonatorId ?? null,
        source: params.source,
        action: params.action,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        assetId: params.assetId ?? null,
        outcome: params.outcome,
        errorCode: params.errorCode ?? null,
        requestId: params.requestId,
        correlationId: params.correlationId,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        durationMs: Math.max(0, Math.round(params.durationMs)),
        summary: safeSummary,
        prevHash,
        hash,
      })
      .run();
  });

  tx.immediate();
  return id;
}

export function verifyTenantHashChain(workspaceId: string): {
  valid: boolean;
  rowCount: number;
  latestHash: string;
  brokenAtId?: string;
  anchoredDaysCount: number;
} {
  const logsDb = tenantLogsDb({ workspaceId });
  const rows = logsDb.$client
    .prepare(
      "SELECT id, ts, actor_type as actorType, actor_id as actorId, action, outcome, correlation_id as correlationId, summary, prev_hash as prevHash, hash FROM action_logs ORDER BY rowid ASC"
    )
    .all() as Array<{
    id: string;
    ts: number;
    actorType: string;
    actorId: string;
    action: string;
    outcome: string;
    correlationId: string;
    summary: string;
    prevHash: string;
    hash: string;
  }>;

  let expectedPrev = "GENESIS";
  for (const r of rows) {
    if (r.prevHash !== expectedPrev) {
      return {
        valid: false,
        rowCount: rows.length,
        latestHash: r.hash,
        brokenAtId: r.id,
        anchoredDaysCount: 0,
      };
    }
    const expectedHash = computeChainHash(expectedPrev, canonicalizeActionRow(r));
    if (r.hash !== expectedHash) {
      return {
        valid: false,
        rowCount: rows.length,
        latestHash: r.hash,
        brokenAtId: r.id,
        anchoredDaysCount: 0,
      };
    }
    expectedPrev = r.hash;
  }

  const anchors = controlDb()
    .select()
    .from(controlSchema.logAnchors)
    .where(eq(controlSchema.logAnchors.tenantId, workspaceId))
    .all();

  return {
    valid: true,
    rowCount: rows.length,
    latestHash: expectedPrev,
    anchoredDaysCount: anchors.length,
  };
}

export function anchorTenantLogsForToday(workspaceId: string): void {
  const chain = verifyTenantHashChain(workspaceId);
  if (!chain.valid || chain.rowCount === 0) return;

  const dayKey = new Date().toISOString().slice(0, 10);
  controlDb()
    .insert(controlSchema.logAnchors)
    .values({
      id: newId(),
      tenantId: workspaceId,
      dayKey,
      finalHash: chain.latestHash,
      rowCount: chain.rowCount,
      anchoredAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [controlSchema.logAnchors.tenantId, controlSchema.logAnchors.dayKey],
      set: {
        finalHash: chain.latestHash,
        rowCount: chain.rowCount,
        anchoredAt: Date.now(),
      },
    })
    .run();
}

export async function instrumentedFetch(params: {
  workspaceId: string;
  provider: "meta" | "whatsapp" | "google" | "razorpay" | "r2" | "s3" | "gdrive";
  operation: string; // template e.g. POST /v21.0/{phoneId}/messages (never raw token URL)
  url: string;
  init?: RequestInit;
  correlationId?: string;
}): Promise<Response> {
  const started = Date.now();
  const ctx = getContext();
  const correlationId = params.correlationId ?? ctx?.correlationId ?? newId();
  const method = params.init?.method ?? "GET";

  try {
    const res = await fetch(params.url, params.init);
    const latencyMs = Date.now() - started;
    const providerRequestId =
      res.headers.get("x-fb-trace-id") ??
      res.headers.get("x-guploader-uploadid") ??
      res.headers.get("x-request-id") ??
      null;
    const rateLimitState =
      res.headers.get("x-business-use-case-usage") ?? res.headers.get("x-app-usage") ?? null;

    let redactedErrorBody: string | null = null;
    if (!res.ok) {
      const cloned = res.clone();
      const rawErr = await cloned.text().catch(() => "");
      redactedErrorBody = redactText(rawErr).slice(0, 1024);
    }

    tenantLogsDb({ workspaceId: params.workspaceId })
      .insert(tenantLogsSchema.providerCalls)
      .values({
        id: newId(),
        ts: Date.now(),
        provider: params.provider,
        operation: params.operation,
        method,
        status: res.status,
        latencyMs,
        retryCount: 0,
        rateLimitState,
        providerRequestId,
        errorCode: res.ok ? null : `HTTP_${res.status}`,
        redactedErrorBody,
        correlationId,
      })
      .run();

    return res;
  } catch (error) {
    const latencyMs = Date.now() - started;
    tenantLogsDb({ workspaceId: params.workspaceId })
      .insert(tenantLogsSchema.providerCalls)
      .values({
        id: newId(),
        ts: Date.now(),
        provider: params.provider,
        operation: params.operation,
        method,
        status: 0,
        latencyMs,
        retryCount: 0,
        errorCode: "NETWORK_ERROR",
        redactedErrorBody: redactText(error instanceof Error ? error.message : String(error)).slice(0, 512),
        correlationId,
      })
      .run();
    throw error;
  }
}

export interface TimelineStep {
  id: string;
  ts: number;
  kind: "action" | "provider_call" | "job_run" | "webhook_event";
  title: string;
  status: string;
  durationMs?: number;
  detail: string;
}

export function getCorrelationTimeline(workspaceId: string, correlationId: string): TimelineStep[] {
  const db = tenantLogsDb({ workspaceId });

  const actions = db
    .select()
    .from(tenantLogsSchema.actionLogs)
    .where(eq(tenantLogsSchema.actionLogs.correlationId, correlationId))
    .orderBy(asc(tenantLogsSchema.actionLogs.ts))
    .all();

  const providers = db
    .select()
    .from(tenantLogsSchema.providerCalls)
    .where(eq(tenantLogsSchema.providerCalls.correlationId, correlationId))
    .orderBy(asc(tenantLogsSchema.providerCalls.ts))
    .all();

  const jobs = db
    .select()
    .from(tenantLogsSchema.jobRuns)
    .where(eq(tenantLogsSchema.jobRuns.correlationId, correlationId))
    .orderBy(asc(tenantLogsSchema.jobRuns.ts))
    .all();

  const events = db
    .select()
    .from(tenantLogsSchema.eventLogs)
    .where(eq(tenantLogsSchema.eventLogs.correlationId, correlationId))
    .orderBy(asc(tenantLogsSchema.eventLogs.ts))
    .all();

  const merged: TimelineStep[] = [
    ...actions.map((a) => ({
      id: a.id,
      ts: a.ts,
      kind: "action" as const,
      title: ACTION_CATALOG[a.action as keyof typeof ACTION_CATALOG]?.label ?? a.action,
      status: a.outcome,
      durationMs: a.durationMs,
      detail: a.summary,
    })),
    ...providers.map((p) => ({
      id: p.id,
      ts: p.ts,
      kind: "provider_call" as const,
      title: `${p.provider.toUpperCase()} — ${p.operation}`,
      status: p.status >= 200 && p.status < 300 ? "success" : "error",
      durationMs: p.latencyMs,
      detail: `HTTP ${p.status}${p.providerRequestId ? ` • Trace ${p.providerRequestId}` : ""}`,
    })),
    ...jobs.map((j) => ({
      id: j.id,
      ts: j.ts,
      kind: "job_run" as const,
      title: `Background task: ${j.jobType}`,
      status: j.status,
      durationMs: j.durationMs,
      detail: `Queue ${j.queue} (Attempt #${j.attempt})`,
    })),
    ...events.map((e) => ({
      id: e.id,
      ts: e.ts,
      kind: "webhook_event" as const,
      title: `Inbound event from ${e.provider}`,
      status: e.outcome,
      detail: e.summary,
    })),
  ];

  return merged.sort((a, b) => a.ts - b.ts);
}

export function listRecentActionLogs(
  workspaceId: string,
  limit = 100,
  filters?: { outcome?: string; category?: string }
) {
  const rows = tenantLogsDb({ workspaceId })
    .select()
    .from(tenantLogsSchema.actionLogs)
    .orderBy(desc(tenantLogsSchema.actionLogs.ts))
    .limit(Math.max(limit, 250))
    .all()
    .map((row) => ({
      ...row,
      friendlyLabel: ACTION_CATALOG[row.action as keyof typeof ACTION_CATALOG]?.label ?? row.action,
      category: ACTION_CATALOG[row.action as keyof typeof ACTION_CATALOG]?.category ?? "General",
    }));

  return rows
    .filter((r) => {
      if (filters?.outcome && filters.outcome !== "all" && r.outcome !== filters.outcome) {
        return false;
      }
      if (filters?.category && filters.category !== "all" && r.category !== filters.category) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

function escapeCsvCell(val: unknown): string {
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "0";
  const raw = val === null || val === undefined ? "" : String(val);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportActionLogsAsCsv(workspaceId: string): string {
  const rows = listRecentActionLogs(workspaceId, 1000);
  const header = [
    "timestamp_iso",
    "category",
    "action_key",
    "outcome",
    "error_code",
    "reference_id",
    "duration_ms",
    "summary",
  ].join(",");

  const lines = rows.map((r) =>
    [
      new Date(r.ts).toISOString(),
      r.category,
      r.action,
      r.outcome,
      r.errorCode ?? "",
      r.correlationId,
      r.durationMs,
      redactText(r.summary),
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return [header, ...lines].join("\r\n");
}

export function generateRedactedSupportBundle(params: {
  workspaceId: string;
  staffId: string;
  ticketReference: string;
}) {
  const ticket = params.ticketReference.trim();
  if (ticket.length < 3) {
    throw new RslError("RSL-VAL-1001", "Enter a support call or ticket reference (at least 3 characters).");
  }

  const cDb = controlDb();
  const ws = cDb
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Client business workspace not found.");
  }

  const entitlements = cDb
    .select({
      serviceKey: controlSchema.entitlements.serviceKey,
      status: controlSchema.entitlements.status,
      activatedAt: controlSchema.entitlements.activatedAt,
    })
    .from(controlSchema.entitlements)
    .where(eq(controlSchema.entitlements.workspaceId, params.workspaceId))
    .all();

  const connections = cDb
    .select({
      id: controlSchema.connections.id,
      provider: controlSchema.connections.provider,
      displayName: controlSchema.connections.displayName,
      status: controlSchema.connections.status,
      lastHealthCheckAt: controlSchema.connections.lastHealthCheckAt,
      expiresAt: controlSchema.connections.expiresAt,
    })
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, params.workspaceId))
    .all();

  const tLogs = tenantLogsDb({ workspaceId: params.workspaceId });
  const chain = verifyTenantHashChain(params.workspaceId);
  const recentActions = listRecentActionLogs(params.workspaceId, 100).map((a) => ({
    id: a.id,
    tsIso: new Date(a.ts).toISOString(),
    action: a.action,
    category: a.category,
    outcome: a.outcome,
    errorCode: a.errorCode,
    correlationId: a.correlationId,
    durationMs: a.durationMs,
    summary: redactText(a.summary),
  }));

  const recentProviderCalls = tLogs
    .select()
    .from(tenantLogsSchema.providerCalls)
    .orderBy(desc(tenantLogsSchema.providerCalls.ts))
    .limit(50)
    .all()
    .map((p) => ({
      id: p.id,
      tsIso: new Date(p.ts).toISOString(),
      provider: p.provider,
      operation: p.operation,
      method: p.method,
      status: p.status,
      latencyMs: p.latencyMs,
      errorCode: p.errorCode,
      correlationId: p.correlationId,
    }));

  const recentJobs = tLogs
    .select()
    .from(tenantLogsSchema.jobRuns)
    .orderBy(desc(tenantLogsSchema.jobRuns.ts))
    .limit(50)
    .all();

  const now = Date.now();
  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId: params.staffId,
      targetTenantId: params.workspaceId,
      action: "inspector.support_bundle",
      ticketReference: ticket,
      summary: `Exported redacted support bundle for '${ws.name}' (Ref: ${ticket})`,
      correlationId: newId(),
    })
    .run();

  return {
    bundleVersion: "1.0",
    generatedAtIso: new Date(now).toISOString(),
    ticketReference: ticket,
    workspace: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      stateCode: ws.stateCode,
      billingStatus: ws.billingStatus,
      createdAtIso: new Date(ws.createdAt).toISOString(),
    },
    hashChainIntegrity: chain,
    entitlements,
    connectionsHealth: connections,
    recentActions,
    recentProviderCalls,
    recentJobs,
  };
}

/**
 * Structural Action Wrapper (Section 12.2):
 * Enforces permission check, service entitlement check, Zod validation, timing, error mapping,
 * and immutable hash-chained ActionLog capture.
 */
export function defineAction<TInputSchema extends z.ZodTypeAny, TOutput>(config: {
  key: ActionKey;
  permission?: Permission;
  service?: string;
  input: TInputSchema;
  summarize?: (input: z.infer<TInputSchema>, output?: NoInfer<TOutput>) => string;
  handler: (ctx: TenantContext, input: z.infer<TInputSchema>) => Promise<TOutput> | TOutput;
}) {
  return async function executeAction(
    ctx: TenantContext,
    rawInput: z.input<TInputSchema>
  ): Promise<Result<TOutput, ReturnType<RslError["toPublicObject"]>>> {
    const started = Date.now();
    const reqCtx = {
      tenantId: ctx.workspaceId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      impersonatorId: ctx.impersonatorId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      source: "web" as const,
      roleSlug: ctx.roleSlug,
      assetScope: ctx.assetScope,
    };

    return runWithContext(reqCtx, async () => {
      try {
        if (config.permission) {
          authorize(ctx, config.permission);
        }
        if (config.service) {
          requireEntitlement(ctx.workspaceId, config.service);
        }

        const parsed = config.input.safeParse(rawInput);
        if (!parsed.success) {
          const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "Field"}: ${i.message}`).join("; ");
          throw new RslError("RSL-VAL-1001", msg);
        }

        const output = await config.handler(ctx, parsed.data);
        const summary =
          config.summarize?.(parsed.data, output) ??
          ACTION_CATALOG[config.key as keyof typeof ACTION_CATALOG]?.label ??
          config.key;

        appendActionLog({
          workspaceId: ctx.workspaceId,
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          impersonatorId: ctx.impersonatorId,
          source: "web",
          action: config.key,
          outcome: "success",
          requestId: ctx.requestId,
          correlationId: ctx.correlationId,
          durationMs: Date.now() - started,
          summary,
        });

        return ok(output);
      } catch (error) {
        const mapped =
          error instanceof RslError
            ? error
            : new RslError("RSL-SYS-1001", error instanceof Error ? error.message : undefined);

        const outcome = mapped.code.startsWith("RSL-RBAC") || mapped.code.startsWith("RSL-BILL") ? "denied" : "error";

        try {
          appendActionLog({
            workspaceId: ctx.workspaceId,
            actorType: ctx.actorType,
            actorId: ctx.actorId,
            impersonatorId: ctx.impersonatorId,
            source: "web",
            action: config.key,
            outcome,
            errorCode: mapped.code,
            requestId: ctx.requestId,
            correlationId: ctx.correlationId,
            durationMs: Date.now() - started,
            summary: mapped.message,
          });
        } catch {
          // Never mask original error if tenant DB itself is unavailable
        }

        return err(mapped.toPublicObject(ctx.correlationId));
      }
    });
  };
}

export interface RegisteredApiRoute {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  title: string;
  summary: string;
  scopes: string[];
  permission?: Permission;
  service?: string;
  rateLimitPerMin: number;
  supportsIdempotency: boolean;
  errorCodes: ErrorCode[];
  requestExample?: Record<string, unknown>;
  responseExample: Record<string, unknown>;
}

export const REGISTERED_API_ROUTES: RegisteredApiRoute[] = [];

export function registerApiRouteDoc(meta: RegisteredApiRoute): void {
  const existingIdx = REGISTERED_API_ROUTES.findIndex(
    (r) => r.method === meta.method && r.path === meta.path
  );
  if (existingIdx >= 0) {
    REGISTERED_API_ROUTES[existingIdx] = meta;
  } else {
    REGISTERED_API_ROUTES.push(meta);
  }
}

const pinoLoggers = new Map<string, Logger>();

/**
 * Pino NDJSON diagnostic logger (Section 12.1 & 12.8)
 * Writes redacted structured JSON lines to LOG_DIR/<service>/YYYY-MM-DD.ndjson
 */
export function getDiagnosticLogger(serviceName: "web" | "admin" | "docs" | "worker"): Logger {
  const day = new Date().toISOString().slice(0, 10);
  const cacheKey = `${serviceName}:${day}`;
  const cached = pinoLoggers.get(cacheKey);
  if (cached) return cached;

  const env = getEnv();
  const dir = path.join(env.LOG_DIR, serviceName);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = pino.destination({ dest: path.join(dir, `${day}.ndjson`), sync: false });

  const logger = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: serviceName },
      redact: {
        paths: [
          "password",
          "*.password",
          "token",
          "*.token",
          "accessToken",
          "*.accessToken",
          "refreshToken",
          "*.refreshToken",
          "apiKey",
          "*.apiKey",
          "authorization",
          "headers.authorization",
          "headers.cookie",
          "phone",
          "phoneE164",
          "email",
          "body",
        ],
        censor: "[REDACTED]",
      },
    },
    dest
  );

  pinoLoggers.set(cacheKey, logger);
  return logger;
}
