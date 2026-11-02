import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { createWhatsAppTemplate, getWhatsAppWorkspaceData } from "@rsl/whatsapp";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "contacts:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });

    const wa = getWhatsAppWorkspaceData(auth.workspaceId);
    return NextResponse.json({
      ok: true,
      workspaceId: auth.workspaceId,
      templates: wa.templates,
    });
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

    const body = (await req.json()) as Record<string, unknown>;
    const out = await createWhatsAppTemplate(auth.ctx, {
      name: String(body.name || "").trim().toLowerCase(),
      category: (String(body.category || "utility") as "utility" | "marketing" | "authentication"),
      language: String(body.language || "en_IN"),
      headerType: (String(body.headerType || "NONE") as "NONE" | "TEXT" | "DOCUMENT" | "IMAGE"),
      headerText: body.headerText ? String(body.headerText) : undefined,
      bodyText: String(body.bodyText || ""),
      footerText: body.footerText ? String(body.footerText) : undefined,
      variableMappings:
        body.variableMappings && typeof body.variableMappings === "object"
          ? (body.variableMappings as Record<string, string>)
          : undefined,
      submitToMeta: body.submitToMeta !== false,
    });

    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, ...out.data }, { status: 201 });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
