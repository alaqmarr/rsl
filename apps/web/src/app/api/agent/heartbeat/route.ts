import { NextRequest, NextResponse } from "next/server";
import { RslError } from "@rsl/core";
import { recordAgentHeartbeat, verifyAgentSignedRequest } from "@rsl/tally";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const verified = verifyAgentSignedRequest({
      deviceId: req.headers.get("x-rsl-device-id") || "",
      timestampHeader: req.headers.get("x-rsl-timestamp") || "",
      signatureHex: req.headers.get("x-rsl-signature") || "",
      rawBody,
    });

    let bodyObj: Record<string, unknown> = {};
    if (rawBody.trim().startsWith("{")) {
      try {
        bodyObj = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        bodyObj = {};
      }
    }

    const tallyReachable =
      bodyObj.tallyReachable === undefined ? true : Boolean(bodyObj.tallyReachable);

    recordAgentHeartbeat({
      deviceId: verified.deviceId,
      tallyReachable,
      tallyHost: typeof bodyObj.tallyHost === "string" ? bodyObj.tallyHost : undefined,
      tallyPort: typeof bodyObj.tallyPort === "number" ? bodyObj.tallyPort : undefined,
      activeCompanyName:
        bodyObj.activeCompanyName === null || typeof bodyObj.activeCompanyName === "string"
          ? (bodyObj.activeCompanyName as string | null)
          : undefined,
      openCompanies: Array.isArray(bodyObj.openCompanies)
        ? bodyObj.openCompanies.map((c) => String(c))
        : undefined,
      lastAlterId: typeof bodyObj.lastAlterId === "number" ? bodyObj.lastAlterId : undefined,
      lastErrorMessage:
        bodyObj.lastErrorMessage === null || typeof bodyObj.lastErrorMessage === "string"
          ? (bodyObj.lastErrorMessage as string | null)
          : undefined,
      agentVersion: typeof bodyObj.agentVersion === "string" ? bodyObj.agentVersion : undefined,
      osVersion: typeof bodyObj.osVersion === "string" ? bodyObj.osVersion : undefined,
    });

    return NextResponse.json({
      ok: true,
      workspaceId: verified.workspaceId,
      deviceId: verified.deviceId,
      tallyReachable,
      receivedAt: new Date().toISOString(),
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("agent") },
      { status: mapped.httpStatus }
    );
  }
}
