import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  consumeImpersonationHandoffCode,
  endImpersonationSession,
  resolveUserSessionFromToken,
  WEB_SESSION_COOKIE,
} from "@rsl/auth";
import { getEnv, isTrustedPlatformHost } from "@rsl/core";
import {
  clearWebSessionCookie,
  setSignedWebFlashToast,
  setWebSessionCookie,
} from "@/lib/session";

function isTrustedSupportHandoffOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    const fetchSite = req.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
      return false;
    }
    return true;
  }
  try {
    const parsed = new URL(origin);
    const env = getEnv();
    const allowedOrigins = new Set<string>();
    for (const candidate of [env.APP_URL, env.ADMIN_URL, req.nextUrl.origin]) {
      try {
        allowedOrigins.add(new URL(candidate).origin);
      } catch {
        // ignore invalid candidate
      }
    }
    if (allowedOrigins.has(parsed.origin)) {
      return true;
    }
    return isTrustedPlatformHost(parsed.host);
  } catch {
    return false;
  }
}

async function endSupportSession(req: NextRequest) {
  const jar = await cookies();
  const existingToken = jar.get(WEB_SESSION_COOKIE)?.value;
  if (existingToken) {
    const result = endImpersonationSession(existingToken);
    if (result.ended) {
      await clearWebSessionCookie();
      await setSignedWebFlashToast("info", "Support session ended.");
      return NextResponse.redirect(new URL("/login", req.url), {
        status: 303,
      });
    }
    await setSignedWebFlashToast("info", "No active support session.");
    return NextResponse.redirect(new URL("/", req.url), {
      status: 303,
    });
  }
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

export async function GET(_req?: NextRequest | Request) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Impersonation start and exit require POST requests with a single-use handoff code.",
    },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  if (!isTrustedSupportHandoffOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: "Untrusted cross-origin impersonation request rejected." },
      { status: 403 }
    );
  }

  let code = "";
  let exit = false;

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    code = String(body.code || "").trim();
    exit = body.exit === true || body.exit === "1" || body.intent === "exit";
    if (!code && body.rawToken) {
      return NextResponse.json(
        { ok: false, error: "Direct rawToken handoff is prohibited; use a single-use handoff code." },
        { status: 400 }
      );
    }
  } else {
    const formData = await req.formData().catch(() => null);
    if (formData) {
      code = String(formData.get("code") || "").trim();
      exit = formData.get("exit") === "1" || formData.get("intent") === "exit";
      if (!code && formData.get("rawToken")) {
        return NextResponse.json(
          { ok: false, error: "Direct rawToken handoff is prohibited; use a single-use handoff code." },
          { status: 400 }
        );
      }
    }
  }

  if (exit) {
    return endSupportSession(req);
  }

  if (!code) {
    await setSignedWebFlashToast("error", "Missing one-time support handoff code.");
    return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  }

  const resolvedToken = consumeImpersonationHandoffCode(code);
  const valid = resolvedToken ? resolveUserSessionFromToken(resolvedToken) : null;
  if (!valid || !resolvedToken) {
    await setSignedWebFlashToast("error", "Invalid or expired support session.");
    return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  }

  await setWebSessionCookie(resolvedToken, 30 * 60);
  await setSignedWebFlashToast("info", "Audited 30-minute support session active.");
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
