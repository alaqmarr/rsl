import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { decryptEnvelope, newEntityId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { enqueueJob } from "@rsl/queue";
import { controlDb, tenantDataDb } from "@rsl/tenancy";

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

    const wabaConn = controlDb()
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, auth.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (!wabaConn || wabaConn.status !== "healthy") {
      throw new RslError(
        "RSL-VAL-1001",
        "WhatsApp Business Account is not connected for this workspace. Connect WhatsApp first — ₹0.00 deducted."
      );
    }

    const dataDb = tenantDataDb({ workspaceId: auth.workspaceId });
    const tmpl =
      dataDb
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .where(eq(tenantDataSchema.whatsappTemplates.id, templateIdOrName))
        .get() ??
      dataDb
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .where(eq(tenantDataSchema.whatsappTemplates.name, templateIdOrName))
        .get();

    if (!tmpl || tmpl.approvalStatus !== "APPROVED") {
      throw new RslError(
        "RSL-VAL-1001",
        tmpl
          ? `Template '${tmpl.name}' has status '${tmpl.approvalStatus}'. Only Meta-approved ('APPROVED') templates can be sent — ₹0.00 deducted.`
          : `Template '${templateIdOrName}' was not found or is not approved — ₹0.00 deducted.`
      );
    }

    let rawToken = decryptEnvelope(wabaConn.encryptedTokens);
    try {
      const parsed = JSON.parse(rawToken) as { accessToken?: string };
      if (typeof parsed.accessToken === "string") rawToken = parsed.accessToken;
    } catch {
      // Plaintext token fallback
    }
    const isSandbox = /^(rsl_sandbox_|sandbox_|test_)/i.test(rawToken.trim());
    if (!isSandbox && !tmpl.metaTemplateId) {
      throw new RslError(
        "RSL-VAL-1001",
        `Template '${tmpl.name}' has not been verified on Meta WhatsApp Manager yet — ₹0.00 deducted.`
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
