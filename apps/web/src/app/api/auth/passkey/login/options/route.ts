import { NextRequest, NextResponse } from "next/server";
import { beginPasskeyAuthentication } from "@rsl/auth";

function resolveWebAuthnRpId(req: NextRequest): string {
  const hostHeader =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    new URL(req.url).host;
  return hostHeader.split(":")[0] || "localhost";
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const options = beginPasskeyAuthentication({
    email: body.email,
    rpId: resolveWebAuthnRpId(req),
  });
  return NextResponse.json({ ok: true, options });
}
