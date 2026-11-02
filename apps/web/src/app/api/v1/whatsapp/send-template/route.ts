import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { newEntityId, RslError } from "@rsl/core";
import { enqueueJob } from "@rsl/queue";

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "whatsapp:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    requireEntitlement(auth.workspaceId, "api.access");
    requireEntitlement(auth.workspaceId, "whatsapp.messaging");

    const body = (await req.json()) as {
      templateName?: string;
      templateId?: string;
      recipientPhone?: string;
      recipientName?: string;
      variables?: Record<string, string>;
      idempotencyKey?: string;
    };

    const templateIdOrName = (body.templateId || body.templateName || "").trim();
    const recipientPhone = (body.recipientPhone || "").trim();

    if (!templateIdOrName || !recipientPhone) {
      throw new RslError(
        "RSL-VAL-1001",
        "Provide templateName (or templateId) and recipientPhone to send a WhatsApp template."
      );
    }

    const idempotencyKey =
      body.idempotencyKey?.trim() ||
      req.headers.get("idempotency-key")?.trim() ||
      `api_wa:${auth.workspaceId}:${templateIdOrName}:${recipientPhone}:${Math.floor(Date.now() / 10000)}`;

    const corr = newEntityId("req", auth.workspaceId);
    const queued = await enqueueJob({
      queue: "outbound.whatsapp",
      jobType: "whatsapp.send.template",
      tenantId: auth.workspaceId,
      correlationId: corr,
      requestId: corr,
      actorType: "api_key",
      actorId: auth.keyId,
      idempotencyKey,
      payload: {
        templateIdOrName,
        recipientPhone,
        recipientName: body.recipientName,
        variables: body.variables ?? {},
      },
    });

    return NextResponse.json(
      {
        ok: true,
        queued: true,
        jobId: queued.outboxId,
        mode: queued.mode,
      },
      { status: 202 }
    );
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
