import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { createWhatsAppTemplate, getWhatsAppWorkspaceData } from "@rsl/whatsapp";

const createTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .transform((s) => s.toLowerCase()),
  category: z.enum(["utility", "marketing", "authentication"]).default("utility"),
  language: z.string().trim().min(2).max(20).default("en_IN"),
  headerType: z.enum(["NONE", "TEXT", "DOCUMENT", "IMAGE"]).default("NONE"),
  headerText: z.string().trim().max(160).optional(),
  bodyText: z.string().trim().min(2, "bodyText is required").max(1024),
  footerText: z.string().trim().max(60).optional(),
  variableMappings: z.record(z.string(), z.string().max(160)).optional(),
  submitToMeta: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "contacts:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });

    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || "100") || 100));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || "0") || 0);
    const wa = getWhatsAppWorkspaceData(auth.workspaceId);
    const paged = wa.templates.slice(offset, offset + limit);
    return NextResponse.json(
      {
        ok: true,
        apiVersion: "v1",
        workspaceId: auth.workspaceId,
        pagination: {
          limit,
          offset,
          totalCount: wa.templates.length,
          hasMore: offset + paged.length < wa.templates.length,
        },
        templates: paged,
      },
      { headers: { "X-RateLimit-Remaining": String(auth.rateLimitRemaining) } }
    );
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "whatsapp:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });

    const rawBody = await req.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      throw new RslError("RSL-VAL-1001", "Request body must be valid JSON.");
    }

    const parsed = createTemplateSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid WhatsApp template payload."
      );
    }

    const idemResult = await withApiIdempotency<Record<string, unknown>>({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key"),
      method: "POST",
      path: "/api/v1/whatsapp/templates",
      rawRequestBody: rawBody,
      execute: async () => {
        const out = await createWhatsAppTemplate(auth.ctx, parsed.data);
        if (!out.ok) {
          return { statusCode: 400, body: { ok: false, error: out.error } };
        }
        return {
          statusCode: 201,
          body: { ok: true, apiVersion: "v1", ...out.data },
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
