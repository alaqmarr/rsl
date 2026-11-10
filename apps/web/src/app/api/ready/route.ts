import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@rsl/core";
import { getCachedPlatformQueueSummary } from "@rsl/queue";
import { controlDb, getTenancyHandleMetrics, ingressDb, platformLogsDb } from "@rsl/tenancy";

function isAuthorizedInternalProbe(req: Request | NextRequest): boolean {
  const provided = (req.headers.get("x-rsl-internal-secret") || "").trim();
  if (!provided) return false;

  const env = getEnv();
  const candidates = [env.INTERNAL_SERVICE_SECRET, env.ADMIN_AUTH_SECRET].filter((s) =>
    Boolean(s && s.length > 0)
  );
  const providedBuf = Buffer.from(provided, "utf8");
  return candidates.some((expected) => {
    const expBuf = Buffer.from(expected, "utf8");
    return expBuf.length === providedBuf.length && crypto.timingSafeEqual(providedBuf, expBuf);
  });
}

export async function GET(req?: Request | NextRequest) {
  if (!req || !isAuthorizedInternalProbe(req)) {
    return NextResponse.json(
      { ready: false, error: "Internal readiness secret required." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const c = controlDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  const i = ingressDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  const p = platformLogsDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  const handles = getTenancyHandleMetrics();
  const queueSummary = getCachedPlatformQueueSummary();

  const healthy = c?.ok === 1 && i?.ok === 1 && p?.ok === 1;
  return NextResponse.json(
    {
      ready: healthy,
      databases: {
        control: c?.ok === 1 ? "ok" : "error",
        ingress: i?.ok === 1 ? "ok" : "error",
        platformLogs: p?.ok === 1 ? "ok" : "error",
      },
      queueMode: queueSummary.mode,
      tenantsWithPendingOutbox: queueSummary.tenantsWithPendingOutbox,
      pendingInboundWebhooks: queueSummary.pendingInboundWebhooks,
      deadInboundWebhooks: queueSummary.deadInboundWebhooks,
      pendingOutboundWebhooks: queueSummary.pendingOutboundWebhooks,
      deadOutboundWebhooks: queueSummary.deadOutboundWebhooks,
      openTenantHandles: handles.openDataHandles + handles.openLogsHandles,
      checkedAt: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
