import { NextRequest, NextResponse } from "next/server";
import { RslError } from "@rsl/core";
import { exchangePairingCodeForAgentDevice } from "@rsl/tally";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const paired = exchangePairingCodeForAgentDevice({
      pairingCode: String(body.pairingCode || ""),
      deviceName: String(body.deviceName || "Windows Tally PC"),
      osVersion: String(body.osVersion || "Windows 11"),
      agentVersion: String(body.agentVersion || "1.0.0"),
    });
    return NextResponse.json({ ok: true, ...paired });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("pair") }, { status: mapped.httpStatus });
  }
}
