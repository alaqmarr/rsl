import { NextRequest, NextResponse } from "next/server";
import { newEntityId, RslError } from "@rsl/core";
import { bulkImportTallyData, verifyAgentSignedRequest } from "@rsl/tally";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const verified = verifyAgentSignedRequest({
      deviceId: req.headers.get("x-rsl-device-id") || "",
      timestampHeader: req.headers.get("x-rsl-timestamp") || "",
      signatureHex: req.headers.get("x-rsl-signature") || "",
      rawBody,
    });

    const parsed = JSON.parse(rawBody) as { companyName?: string; xml?: string; csv?: string };
    const reqId = newEntityId("req", verified.workspaceId);
    const out = await bulkImportTallyData(
      {
        workspaceId: verified.workspaceId,
        actorType: "agent",
        actorId: verified.deviceId,
        roleSlug: "owner",
        correlationId: reqId,
        requestId: reqId,
      },
      {
        companyName: parsed.companyName || "Primary Tally Company",
        format: parsed.xml ? "tally_xml" : "csv",
        rawContent: parsed.xml || parsed.csv || "",
      }
    );

    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("agent") }, { status: mapped.httpStatus });
  }
}
