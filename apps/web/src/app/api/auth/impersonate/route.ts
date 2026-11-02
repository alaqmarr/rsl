import { NextRequest, NextResponse } from "next/server";
import { resolveUserSessionFromToken } from "@rsl/auth";
import { clearWebSessionCookie, setWebSessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("exit") === "1") {
    await clearWebSessionCookie();
    return NextResponse.redirect(new URL("/login?notice=Support+session+ended", req.url));
  }
  const token = req.nextUrl.searchParams.get("token") || "";
  const valid = resolveUserSessionFromToken(token);
  if (!valid) {
    return NextResponse.redirect(new URL("/login?error=Invalid+or+expired+support+session", req.url));
  }
  await setWebSessionCookie(token, 30 * 60);
  return NextResponse.redirect(new URL("/?notice=Audited+30-minute+support+session+active", req.url));
}
