import { NextResponse } from "next/server";
import { hasActiveEntitlement } from "@rsl/billing";
import { RslError } from "@rsl/core";
import { authorize } from "@rsl/rbac";
import {
  autoReconcileLocalTallyPort9000IfActive,
  detectOutdatedTdlVersion,
  getTallyWorkspaceSummary,
} from "@rsl/tally";
import { getOptionalWebSession } from "@/lib/session";
import { flushInlineTallyOutboxIfNoRedis } from "@/lib/tally-outbox-runner";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    authorize(session.ctx, "tally:view");
  } catch (err) {
    const msg = err instanceof RslError ? err.message : "Permission denied";
    return NextResponse.json({ ok: false, error: msg }, { status: 403 });
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    return NextResponse.json({ ok: false, entitled: false }, { status: 200 });
  }

  await autoReconcileLocalTallyPort9000IfActive(session.workspace.id);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);

  const summary = getTallyWorkspaceSummary(session.workspace.id);
  const outdated = detectOutdatedTdlVersion(summary.webhookEndpoint.lastUserAgent);
  const latestVoucherUpdatedAt = summary.vouchers.reduce(
    (max, v) => Math.max(max, v.updatedAt ?? v.createdAt ?? 0),
    0
  );

  return NextResponse.json(
    {
      ok: true,
      entitled: true,
      vouchersCount: summary.vouchers.length,
      companiesCount: summary.companies.length,
      nativePdfCount: summary.totals.nativePdfCount,
      latestVoucherUpdatedAt,
      totalBilledPaise: summary.totals.totalBilledPaise,
      eventsReceivedCount: summary.webhookEndpoint.eventsReceivedCount,
      pingsReceivedCount: summary.webhookEndpoint.pingsReceivedCount,
      lastEventAt: summary.webhookEndpoint.lastEventAt,
      lastPingAt: summary.webhookEndpoint.lastPingAt,
      lastErrorAt: summary.webhookEndpoint.lastErrorAt,
      lastErrorMessage: summary.webhookEndpoint.lastErrorMessage,
      lastUserAgent: summary.webhookEndpoint.lastUserAgent,
      outdatedTdl: outdated,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
