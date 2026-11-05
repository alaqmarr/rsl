import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { ingestWebsitePixelEventForWorkspace } from "@rsl/meta";

const pixelPayloadSchema = z.object({
  eventId: z.string().min(4).max(120),
  eventName: z.enum(["Purchase", "Lead", "AddToCart", "ViewContent"]),
  valueRupees: z.coerce.number().min(0).default(0),
  currency: z.string().max(6).optional(),
  customerEmail: z.string().max(160).optional(),
  customerPhone: z.string().max(32).optional(),
  customerIdentifier: z.string().max(160).optional(),
  sourceUrl: z.string().max(500).optional(),
  orderRef: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const clientIp = req.headers.get("x-forwarded-for");

    let auth;
    try {
      auth = await authenticatePublicApiKey({
        authorizationHeader: authHeader,
        requiredScope: "pixel:write",
        clientIp,
      });
    } catch (err) {
      // Also accept keys provisioned with contacts:write prior to pixel:write scope introduction
      if (err instanceof RslError && err.code === "RSL-API-1002") {
        auth = await authenticatePublicApiKey({
          authorizationHeader: authHeader,
          requiredScope: "contacts:write",
          clientIp,
        });
      } else {
        throw err;
      }
    }

    const rawBody = await req.json();
    const parsed = pixelPayloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid pixel event JSON payload."
      );
    }

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

    return NextResponse.json(
      {
        ok: true,
        workspaceId: auth.workspaceId,
        ...result,
      },
      {
        status: result.deduplicated ? 200 : 201,
        headers: { "X-RateLimit-Remaining": String(auth.rateLimitRemaining) },
      }
    );
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("api") },
      { status: mapped.httpStatus }
    );
  }
}
