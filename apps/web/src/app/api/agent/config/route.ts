import { NextRequest, NextResponse } from "next/server";
import { RslError } from "@rsl/core";
import { getTallyWorkspaceSummary, verifyAgentSignedRequest } from "@rsl/tally";

export async function GET(req: NextRequest) {
  try {
    const verified = verifyAgentSignedRequest({
      deviceId: req.headers.get("x-rsl-device-id") || "",
      timestampHeader: req.headers.get("x-rsl-timestamp") || "",
      signatureHex: req.headers.get("x-rsl-signature") || "",
      rawBody: "",
    });
    const summary = getTallyWorkspaceSummary(verified.workspaceId);
    return NextResponse.json({
      ok: true,
      workspaceId: verified.workspaceId,
      pollIntervalSeconds: 15,
      companies: summary.companies,
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("agent") }, { status: mapped.httpStatus });
  }
}
