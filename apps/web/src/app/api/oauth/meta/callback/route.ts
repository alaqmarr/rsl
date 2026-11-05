import { NextResponse, type NextRequest } from "next/server";
import { completeMetaOAuthConnection, type MetaOAuthPurpose } from "@rsl/connections";
import { getEnv, isTrustedPlatformHost, resolveEndpointsFromHeaders, verifyHmac } from "@rsl/core";
import { canRolePerform } from "@rsl/rbac";
import { getOptionalWebSession } from "@/lib/session";

interface ParsedMetaOAuthState {
  nonce: string;
  ws: string;
  uid: string;
  purpose: MetaOAuthPurpose;
  returnTo: string;
  exp: number;
}

function sanitizeReturnTo(raw: string | undefined): string {
  const s = (raw || "").trim();
  if (s.startsWith("/") && !s.startsWith("//") && !s.includes("://")) {
    return s;
  }
  return "/connections";
}

function buildAppRedirect(
  baseUrl: string,
  returnTo: string,
  kind: "notice" | "error",
  msg: string
) {
  const url = new URL(returnTo, baseUrl);
  url.searchParams.set(kind, msg);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete("rsl_meta_oauth_state");
  return res;
}

export async function GET(req: NextRequest) {
  const rawHost = (
    req.headers.get("x-forwarded-host")?.split(",")[0] ||
    req.headers.get("host") ||
    ""
  ).trim();
  if (rawHost && !isTrustedPlatformHost(rawHost)) {
    return NextResponse.json(
      { ok: false, error: "Untrusted Host header rejected for Meta OAuth callback safety." },
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
  const stateParam = (sp.get("state") || "").trim();
  const cookieState = (req.cookies.get("rsl_meta_oauth_state")?.value || "").trim();

  let parsedState: ParsedMetaOAuthState | null = null;
  if (stateParam.includes(".")) {
    const [payloadB64, sigHex] = stateParam.split(".");
    if (
      payloadB64 &&
      sigHex &&
      /^[0-9a-f]+$/i.test(sigHex) &&
      verifyHmac(payloadB64, sigHex, getEnv().BETTER_AUTH_SECRET)
    ) {
      try {
        parsedState = JSON.parse(
          Buffer.from(payloadB64, "base64url").toString("utf8")
        ) as ParsedMetaOAuthState;
      } catch {
        parsedState = null;
      }
    }
  }

  const returnTo = sanitizeReturnTo(parsedState?.returnTo);

  const oauthError = sp.get("error") || sp.get("error_reason");
  if (oauthError) {
    const friendly =
      oauthError === "access_denied" || oauthError === "user_denied"
        ? "Facebook / Meta sign-in was cancelled before granting permissions."
        : `Meta sign-in returned an error (${sp.get("error_description") || oauthError}).`;
    return buildAppRedirect(appBaseUrl, returnTo, "error", friendly);
  }

  if (
    !parsedState ||
    !cookieState ||
    stateParam !== cookieState ||
    parsedState.exp < Date.now() ||
    parsedState.uid !== session.user.id ||
    parsedState.ws !== session.workspace.id
  ) {
    return buildAppRedirect(
      appBaseUrl,
      returnTo,
      "error",
      "Your Meta sign-in session expired or changed workspaces. Click 'Connect with Facebook' again."
    );
  }

  if (!canRolePerform(session.roleSlug, "connections:manage", session.workspace.id)) {
    return buildAppRedirect(
      appBaseUrl,
      returnTo,
      "error",
      "You do not have permission to connect Meta accounts in this workspace."
    );
  }

  const code = (sp.get("code") || "").trim();
  if (!code) {
    return buildAppRedirect(
      appBaseUrl,
      returnTo,
      "error",
      "Meta did not return an authorization code. Please try connecting again."
    );
  }

  const redirectUri = `${appBaseUrl}/api/oauth/meta/callback`;

  try {
    const result = await completeMetaOAuthConnection({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      code,
      redirectUri,
      purpose: parsedState.purpose,
    });

    const kind = result.connectedLabels.length > 0 ? "notice" : "error";
    return buildAppRedirect(appBaseUrl, returnTo, kind, result.summaryMessage);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to complete Meta OAuth token exchange.";
    return buildAppRedirect(appBaseUrl, returnTo, "error", message);
  }
}
