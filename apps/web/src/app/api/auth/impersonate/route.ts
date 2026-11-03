import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  consumeImpersonationHandoffCode,
  resolveUserSessionFromToken,
  signOutSession,
  WEB_SESSION_COOKIE,
} from "@rsl/auth";
import { clearWebSessionCookie, setWebSessionCookie } from "@/lib/session";

async function endSupportSession(req: NextRequest) {
  const jar = await cookies();
  const existingToken = jar.get(WEB_SESSION_COOKIE)?.value;
  if (existingToken) {
    signOutSession(existingToken);
  }
  await clearWebSessionCookie();
  return NextResponse.redirect(new URL("/login?notice=Support+session+ended", req.url), {
    status: 303,
  });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("exit") === "1") {
    return endSupportSession(req);
  }

  // Security (SEC-07): strictly reject raw session tokens or codes in GET query strings
  return NextResponse.json(
    {
      ok: false,
      error:
        "Impersonation tokens cannot be passed in URL query strings. Start support view via POST handoff from the Staff Console.",
    },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  let code = "";
  let rawToken = "";
  let exit = false;

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    code = String(body.code || "").trim();
    rawToken = String(body.token || "").trim();
    exit = body.exit === true || body.exit === "1";
  } else {
    const formData = await req.formData().catch(() => null);
    if (formData) {
      code = String(formData.get("code") || "").trim();
      rawToken = String(formData.get("token") || "").trim();
      exit = formData.get("exit") === "1";
    }
  }

  if (exit || req.nextUrl.searchParams.get("exit") === "1") {
    return endSupportSession(req);
  }

  const resolvedToken = code ? consumeImpersonationHandoffCode(code) : rawToken;
  const valid = resolvedToken ? resolveUserSessionFromToken(resolvedToken) : null;
  if (!valid || !resolvedToken) {
    return NextResponse.redirect(
      new URL("/login?error=Invalid+or+expired+support+session", req.url),
      { status: 303 }
    );
  }

  await setWebSessionCookie(resolvedToken, 30 * 60);
  return NextResponse.redirect(
    new URL("/?notice=Audited+30-minute+support+session+active", req.url),
    { status: 303 }
  );
}
