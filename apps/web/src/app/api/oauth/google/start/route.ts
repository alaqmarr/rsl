import { NextResponse, type NextRequest } from "next/server";
import {
  buildGoogleOAuthAuthorizeUrl,
  generateGoogleOAuthPkcePair,
  type GoogleOAuthPurpose,
} from "@rsl/connections";
import {
  getEnv,
  isTrustedPlatformHost,
  newId,
  resolveEndpointsFromHeaders,
  signHmac,
} from "@rsl/core";
import { canRolePerform } from "@rsl/rbac";
import { getOptionalWebSession } from "@/lib/session";

function sanitizeReturnTo(raw: string | null): string {
  const s = (raw || "").trim();
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("://")) {
    return s;
  }
  return "/connections";
}

function appendFeedbackQuery(baseUrl: string, pathWithOptionalQuery: string, kind: "notice" | "error", msg: string): string {
  const url = new URL(pathWithOptionalQuery, baseUrl);
  url.searchParams.set(kind, msg);
  return url.toString();
}

export async function GET(req: NextRequest) {
  const rawHost =
    (req.headers.get("x-forwarded-host")?.split(",")[0] || req.headers.get("host") || "").trim();
  if (rawHost && !isTrustedPlatformHost(rawHost)) {
    return NextResponse.json(
      { ok: false, error: "Untrusted Host header rejected for OAuth redirect safety." },
      { status: 400 }
    );
  }

  const endpoints = resolveEndpointsFromHeaders(req.headers);
  const appBaseUrl =
    endpoints.isLocalDev && endpoints.localBaseUrl
      ? endpoints.localBaseUrl
      : endpoints.cloudBaseUrl;
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.redirect(`${appBaseUrl}/login`);
  }

  const sp = req.nextUrl.searchParams;
  const rawPurpose = (sp.get("purpose") || "google_drive").trim();
  const purpose: GoogleOAuthPurpose =
    rawPurpose === "google_business" ? "google_business" : "google_drive";
  const returnTo = sanitizeReturnTo(
    sp.get("returnTo") || (purpose === "google_drive" ? "/backups" : "/connections")
  );

  const canManage =
    canRolePerform(session.roleSlug, "connections:manage", session.workspace.id) ||
    (purpose === "google_drive" &&
      canRolePerform(session.roleSlug, "backup:destination.manage", session.workspace.id));

  if (!canManage) {
    return NextResponse.redirect(
      appendFeedbackQuery(
        appBaseUrl,
        returnTo,
        "error",
        "Your current workspace role does not have permission to connect Google accounts. Ask the Business Owner or an Admin."
      )
    );
  }

  const redirectUri = `${appBaseUrl}/api/oauth/google/callback`;
  const { codeVerifier, codeChallenge } = generateGoogleOAuthPkcePair();
  const stateObj = {
    nonce: newId("req", session.workspace.id),
    ws: session.workspace.id,
    uid: session.user.id,
    purpose,
    returnTo,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(stateObj), "utf8").toString("base64url");
  const secret = getEnv().BETTER_AUTH_SECRET;
  const sig = signHmac(payloadB64, secret);
  const stateToken = `${payloadB64}.${sig}`;
  const pkceSig = signHmac(codeVerifier, secret);
  const pkceCookieVal = `${codeVerifier}.${pkceSig}`;

  try {
    const googleAuthorizeUrl = buildGoogleOAuthAuthorizeUrl({
      redirectUri,
      state: stateToken,
      purpose,
      codeChallenge,
    });

    const isSecure = appBaseUrl.startsWith("https://");
    const response = NextResponse.redirect(googleAuthorizeUrl);
    response.cookies.set("rsl_google_oauth_state", stateToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 600,
    });
    response.cookies.set("rsl_google_oauth_pkce", pkceCookieVal, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Google OAuth Sign-In is not configured yet on this platform.";
    return NextResponse.redirect(
      appendFeedbackQuery(appBaseUrl, returnTo, "error", message)
    );
  }
}
