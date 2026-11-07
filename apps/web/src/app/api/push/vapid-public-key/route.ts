import { NextResponse } from "next/server";
import { ensurePlatformVapidConfig } from "@rsl/tenancy";
import { getOptionalWebSession } from "../../../../lib/session";

export async function GET() {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const vapid = ensurePlatformVapidConfig();
  return NextResponse.json({
    ok: true,
    publicKey: vapid.publicKey,
  });
}
