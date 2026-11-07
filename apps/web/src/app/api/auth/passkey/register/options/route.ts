import { NextRequest, NextResponse } from "next/server";
import { beginPasskeyRegistration } from "@rsl/auth";
import { getOptionalWebSession } from "@/lib/session";

function resolveWebAuthnRpId(req: NextRequest): string {
  const hostHeader =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    new URL(req.url).host;
  return hostHeader.split(":")[0] || "localhost";
}

export async function POST(req: NextRequest) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const options = beginPasskeyRegistration({
    userId: session.user.id,
    userEmail: session.user.email,
    userName: session.user.name,
    rpId: resolveWebAuthnRpId(req),
  });

  return NextResponse.json({ ok: true, options });
}
