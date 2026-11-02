import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { RslError } from "@rsl/core";
import { ingestTallyBillEventAndEnqueueAutomation } from "@rsl/tally";

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "vouchers:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    requireEntitlement(auth.workspaceId, "api.access");
    requireEntitlement(auth.workspaceId, "tally.sync");

    const rawBody = await req.text();
    const out = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: auth.workspaceId,
      actorType: "api_key",
      actorId: auth.keyId,
      rawPayload: rawBody,
      sourceLabel: "api",
      correlationId: auth.ctx.correlationId,
    });

    return NextResponse.json(
      {
        ok: true,
        workspaceId: auth.workspaceId,
        upsertedBills: out.upserted,
        queuedWhatsAppJobs: out.queuedJobs,
        vouchers: out.vouchers,
      },
      { status: 202 }
    );
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Invalid bill event payload");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
