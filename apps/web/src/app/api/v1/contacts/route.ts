import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { countContacts, createContact, listContacts } from "@rsl/inbox";

const createContactSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(160),
  phoneE164: z.string().trim().min(7).max(24).optional(),
  email: z.string().trim().email("Invalid email address").max(160).optional(),
  companyName: z.string().trim().max(160).optional(),
  recordWhatsAppConsent: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "contacts:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || "50") || 50));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || "0") || 0);
    const totalCount = countContacts(auth.workspaceId);
    const items = listContacts(auth.workspaceId, { limit, offset });
    return NextResponse.json(
      {
        ok: true,
        apiVersion: "v1",
        workspaceId: auth.workspaceId,
        pagination: {
          limit,
          offset,
          totalCount,
          hasMore: offset + items.length < totalCount,
        },
        items,
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
      requiredScope: "contacts:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const rawBody = await req.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      throw new RslError("RSL-VAL-1001", "Request body must be valid JSON.");
    }

    const parsed = createContactSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid contact payload."
      );
    }

    const idemResult = await withApiIdempotency<Record<string, unknown>>({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key"),
      method: "POST",
      path: "/api/v1/contacts",
      rawRequestBody: rawBody,
      execute: async () => {
        const out = await createContact(auth.ctx, {
          name: parsed.data.name,
          phoneE164: parsed.data.phoneE164,
          email: parsed.data.email,
          companyName: parsed.data.companyName,
          recordWhatsAppConsent: parsed.data.recordWhatsAppConsent,
        });
        if (!out.ok) {
          return { statusCode: 400, body: { ok: false, error: out.error } };
        }
        return {
          statusCode: 201,
          body: { ok: true, apiVersion: "v1", contactId: out.data.contactId },
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
