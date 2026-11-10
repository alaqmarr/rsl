import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { requireEntitlement } from "@rsl/billing";
import { decryptEnvelope, newEntityId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { enqueueJob } from "@rsl/queue";
import { controlDb, isWorkspaceSandboxIntegrationMode, tenantDataDb } from "@rsl/tenancy";

const sendTemplateSchema = z
  .object({
    templateName: z.string().trim().min(1).max(160).optional(),
    templateId: z.string().trim().min(1).max(160).optional(),
    recipientPhone: z.string().trim().min(7, "recipientPhone is required").max(24),
    recipientName: z.string().trim().max(160).optional(),
    variables: z.record(z.string(), z.string().max(1000)).optional(),
    idempotencyKey: z.string().trim().min(4).max(160).optional(),
  })
  .refine((v) => Boolean(v.templateId || v.templateName), {
    message: "Provide templateName or templateId.",
  });

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "whatsapp:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    requireEntitlement(auth.workspaceId, "api.access");
    requireEntitlement(auth.workspaceId, "whatsapp.messaging");

    const rawBody = await req.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      throw new RslError("RSL-VAL-1001", "Request body must be valid JSON.");
    }

    const parsed = sendTemplateSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid WhatsApp template send payload."
      );
    }

    const body = parsed.data;
    const templateIdOrName = (body.templateId || body.templateName || "").trim();
    const recipientPhone = body.recipientPhone.trim();

    const idemResult = await withApiIdempotency({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key") || body.idempotencyKey,
      method: "POST",
      path: "/api/v1/whatsapp/send-template",
      rawRequestBody: rawBody,
      execute: async () => {
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
            "WhatsApp Business Account is not connected or requires re-authentication for this workspace."
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
              ? `Template '${tmpl.name}' has status '${tmpl.approvalStatus}'. Only Meta-approved ('APPROVED') templates can be sent.`
              : `Template '${templateIdOrName}' was not found or is not approved.`
          );
        }

        let rawToken = decryptEnvelope(wabaConn.encryptedTokens);
        try {
          const parsedTok = JSON.parse(rawToken) as { accessToken?: string };
          if (typeof parsedTok.accessToken === "string") rawToken = parsedTok.accessToken;
        } catch {
          // Plaintext token fallback
        }
        const isSandbox = isWorkspaceSandboxIntegrationMode(auth.workspaceId, rawToken.trim());
        if (!isSandbox && !tmpl.metaTemplateId) {
          throw new RslError(
            "RSL-VAL-1001",
            `Template '${tmpl.name}' has not been verified on Meta WhatsApp Manager yet.`
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

        return {
          statusCode: 202,
          body: {
            ok: true,
            apiVersion: "v1",
            queued: true,
            jobId: queued.outboxId,
            mode: queued.mode,
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
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
