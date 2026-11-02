import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { createContact, listContacts } from "@rsl/inbox";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "contacts:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const items = listContacts(auth.workspaceId, 100);
    return NextResponse.json(
      { ok: true, workspaceId: auth.workspaceId, items },
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
    const body = (await req.json()) as Record<string, unknown>;
    const out = await createContact(auth.ctx, {
      name: String(body.name || ""),
      phoneE164: body.phoneE164 ? String(body.phoneE164) : undefined,
      email: body.email ? String(body.email) : undefined,
      companyName: body.companyName ? String(body.companyName) : undefined,
      recordWhatsAppConsent: Boolean(body.recordWhatsAppConsent),
    });
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, contactId: out.data.contactId }, { status: 201 });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
