import { NextResponse, type NextRequest } from "next/server";
import { buildMetaOAuthAuthorizeUrl, type MetaOAuthPurpose } from "@rsl/connections";
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

function appendFeedbackQuery(
  baseUrl: string,
  pathWithOptionalQuery: string,
  kind: "notice" | "error",
  msg: string
): string {
  const url = new URL(pathWithOptionalQuery, baseUrl);
  url.searchParams.set(kind, msg);
  return url.toString();
}

export async function GET(req: NextRequest) {
  const rawHost = (
    req.headers.get("x-forwarded-host")?.split(",")[0] ||
    req.headers.get("host") ||
    ""
  ).trim();
  if (rawHost && !isTrustedPlatformHost(rawHost)) {
    return NextResponse.json(
      { ok: false, error: "Untrusted Host header rejected for Meta OAuth safety." },
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
  const rawPurpose = (sp.get("purpose") || "meta_all").trim();
  const purpose: MetaOAuthPurpose =
    rawPurpose === "facebook_page" ||
    rawPurpose === "instagram_business" ||
    rawPurpose === "meta_ads_pixel" ||
    rawPurpose === "whatsapp_cloud"
      ? rawPurpose
      : "meta_all";
  const returnTo = sanitizeReturnTo(sp.get("returnTo") || "/connections");

  if (!canRolePerform(session.roleSlug, "connections:manage", session.workspace.id)) {
    return NextResponse.redirect(
      appendFeedbackQuery(
        appBaseUrl,
        returnTo,
        "error",
        "Your workspace role does not have permission to connect Meta accounts. Ask the Business Owner or an Admin."
      )
    );
  }

  const redirectUri = `${appBaseUrl}/api/oauth/meta/callback`;
  const stateObj = {
    nonce: newId("req", session.workspace.id),
    ws: session.workspace.id,
    uid: session.user.id,
    purpose,
    returnTo,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(stateObj), "utf8").toString("base64url");
  const sig = signHmac(payloadB64, getEnv().BETTER_AUTH_SECRET);
  const stateToken = `${payloadB64}.${sig}`;

  try {
    const metaAuthorizeUrl = buildMetaOAuthAuthorizeUrl({
      redirectUri,
      state: stateToken,
      purpose,
    });

    const isSecure = appBaseUrl.startsWith("https://");
    const response = NextResponse.redirect(metaAuthorizeUrl);
    response.cookies.set("rsl_meta_oauth_state", stateToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Meta 1-Click OAuth is not configured yet.";
    return NextResponse.redirect(appendFeedbackQuery(appBaseUrl, returnTo, "error", message));
  }
}
