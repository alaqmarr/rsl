import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { RslError } from "@rsl/core";
import { ingestTallyBillEventAndEnqueueAutomation } from "@rsl/tally";

const MAX_BILL_EVENT_BODY_BYTES = 512 * 1024;

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
    if (!rawBody.trim()) {
      throw new RslError("RSL-VAL-1001", "Bill event request body cannot be empty.");
    }
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BILL_EVENT_BODY_BYTES) {
      throw new RslError("RSL-VAL-1001", "Bill event payload exceeds the 512 KB limit.");
    }

    const idemResult = await withApiIdempotency({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key"),
      method: "POST",
      path: "/api/v1/tally/bill-event",
      rawRequestBody: rawBody,
      execute: async () => {
        const out = await ingestTallyBillEventAndEnqueueAutomation({
          workspaceId: auth.workspaceId,
          actorType: "api_key",
          actorId: auth.keyId,
          rawPayload: rawBody,
          sourceLabel: "api",
          correlationId: auth.ctx.correlationId,
        });

        return {
          statusCode: 202,
          body: {
            ok: true,
            apiVersion: "v1",
            workspaceId: auth.workspaceId,
            upsertedBills: out.upserted,
            queuedWhatsAppJobs: out.queuedJobs,
            vouchers: out.vouchers,
          },
        };
      },
    });

    return NextResponse.json(idemResult.body, {
      status: idemResult.statusCode,
      headers: {
        "X-RateLimit-Remaining": String(auth.rateLimitRemaining),
        ...(idemResult.replayed ? { "X-Idempotent-Replayed": "true" } : {}),
      },
    });
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Invalid bill event payload");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
