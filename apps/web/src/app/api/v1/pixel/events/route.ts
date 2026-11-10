import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { ingestWebsitePixelEventForWorkspace } from "@rsl/meta";

const CONTACTS_WRITE_PIXEL_SUNSET_MS = Date.UTC(2027, 0, 1, 0, 0, 0);
const CONTACTS_WRITE_PIXEL_SUNSET_HTTP = "Thu, 31 Dec 2026 23:59:59 GMT";

const pixelPayloadSchema = z.object({
  eventId: z.string().trim().min(4).max(120),
  eventName: z.enum(["Purchase", "Lead", "AddToCart", "ViewContent"]),
  valueRupees: z
    .number()
    .finite()
    .min(0)
    .max(100_000_000)
    .default(0),
  currency: z.string().trim().max(6).optional(),
  customerEmail: z.string().trim().max(160).optional(),
  customerPhone: z.string().trim().max(32).optional(),
  customerIdentifier: z.string().trim().max(160).optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  orderRef: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const clientIp = req.headers.get("x-forwarded-for");

    let auth;
    let usedDeprecatedContactsScope = false;
    try {
      auth = await authenticatePublicApiKey({
        authorizationHeader: authHeader,
        requiredScope: "pixel:write",
        clientIp,
      });
    } catch (err) {
      if (
        err instanceof RslError &&
        err.code === "RSL-API-1002" &&
        Date.now() < CONTACTS_WRITE_PIXEL_SUNSET_MS
      ) {
        auth = await authenticatePublicApiKey({
          authorizationHeader: authHeader,
          requiredScope: "contacts:write",
          clientIp,
        });
        usedDeprecatedContactsScope = true;
      } else {
        throw err;
      }
    }

    const rawText = await req.text();
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      throw new RslError("RSL-VAL-1001", "Request body must be valid JSON.");
    }

    const parsed = pixelPayloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid pixel event JSON payload."
      );
    }

    const idemResult = await withApiIdempotency({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key"),
      method: "POST",
      path: "/api/v1/pixel/events",
      rawRequestBody: rawText,
      execute: async () => {
        const result = await ingestWebsitePixelEventForWorkspace({
          workspaceId: auth.workspaceId,
          eventId: parsed.data.eventId,
          eventName: parsed.data.eventName,
          valueRupees: parsed.data.valueRupees,
          currency: parsed.data.currency,
          customerEmail: parsed.data.customerEmail,
          customerPhone: parsed.data.customerPhone,
          customerIdentifier: parsed.data.customerIdentifier,
          sourceUrl: parsed.data.sourceUrl,
          orderRef: parsed.data.orderRef,
          clientIp,
          userAgent: req.headers.get("user-agent"),
        });

        return {
          statusCode: result.deduplicated ? 200 : 201,
          body: {
            ok: true,
            apiVersion: "v1",
            workspaceId: auth.workspaceId,
            ...result,
          },
        };
      },
    });

    const responseHeaders: Record<string, string> = {
      "X-RateLimit-Remaining": String(auth.rateLimitRemaining),
      ...(idemResult.replayed ? { "X-Idempotent-Replayed": "true" } : {}),
    };
    if (usedDeprecatedContactsScope) {
      responseHeaders.Deprecation = "true";
      responseHeaders.Sunset = CONTACTS_WRITE_PIXEL_SUNSET_HTTP;
      responseHeaders.Warning =
        '299 - "API key scope contacts:write for /api/v1/pixel/events is deprecated; provision pixel:write before 2026-12-31."';
    }

    return NextResponse.json(idemResult.body, {
      status: idemResult.statusCode,
      headers: responseHeaders,
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("api") },
      { status: mapped.httpStatus }
    );
  }
}
