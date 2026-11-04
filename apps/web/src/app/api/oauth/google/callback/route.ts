import { NextResponse, type NextRequest } from "next/server";
import { completeGoogleOAuthConnection, type GoogleOAuthPurpose } from "@rsl/connections";
import { getEnv, isTrustedPlatformHost, resolveEndpointsFromHeaders, verifyHmac } from "@rsl/core";
import { syncGoogleBusinessReviewsForWorkspace } from "@rsl/google";
import { canRolePerform } from "@rsl/rbac";
import { getOptionalWebSession } from "@/lib/session";

interface ParsedOAuthState {
  nonce: string;
  ws: string;
  uid: string;
  purpose: GoogleOAuthPurpose;
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

function buildAppRedirect(baseUrl: string, returnTo: string, kind: "notice" | "error", msg: string) {
  const url = new URL(returnTo, baseUrl);
  url.searchParams.set(kind, msg);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete("rsl_google_oauth_state");
  res.cookies.delete("rsl_google_oauth_pkce");
  return res;
}

export async function GET(req: NextRequest) {
  const rawHost =
    (req.headers.get("x-forwarded-host")?.split(",")[0] || req.headers.get("host") || "").trim();
  if (rawHost && !isTrustedPlatformHost(rawHost)) {
    return NextResponse.json(
      { ok: false, error: "Untrusted Host header rejected for OAuth callback safety." },
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
  const cookieState = (req.cookies.get("rsl_google_oauth_state")?.value || "").trim();

  // Attempt to extract returnTo even if error occurred
  let parsedState: ParsedOAuthState | null = null;
  if (stateParam.includes(".")) {
    const [payloadB64, sigHex] = stateParam.split(".");
    if (
      payloadB64 &&
      sigHex &&
      /^[0-9a-f]+$/i.test(sigHex) &&
      verifyHmac(payloadB64, sigHex, getEnv().BETTER_AUTH_SECRET)
    ) {
      try {
        parsedState = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ParsedOAuthState;
      } catch {
        parsedState = null;
      }
    }
  }

  const returnTo = sanitizeReturnTo(parsedState?.returnTo);

  const oauthError = sp.get("error");
  if (oauthError) {
    const friendly =
      oauthError === "access_denied"
        ? "Google sign-in was cancelled before granting permission."
        : `Google sign-in returned an error (${oauthError}).`;
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
      "Your Google sign-in session expired or changed workspaces. Click 'Connect to Google Drive' again."
    );
  }

  const canManage =
    canRolePerform(session.roleSlug, "connections:manage", session.workspace.id) ||
    (parsedState.purpose === "google_drive" &&
      canRolePerform(session.roleSlug, "backup:destination.manage", session.workspace.id));

  if (!canManage) {
    return buildAppRedirect(
      appBaseUrl,
      returnTo,
      "error",
      "You do not have permission to connect Google accounts in this workspace."
    );
  }

  const code = (sp.get("code") || "").trim();
  if (!code) {
    return buildAppRedirect(
      appBaseUrl,
      returnTo,
      "error",
      "Google did not return an authorization code. Please try connecting again."
    );
  }

  const redirectUri = `${appBaseUrl}/api/oauth/google/callback`;
  const pkceCookieRaw = (req.cookies.get("rsl_google_oauth_pkce")?.value || "").trim();
  let codeVerifier: string | undefined;
  if (pkceCookieRaw.includes(".")) {
    const [cvCandidate, cvSig] = pkceCookieRaw.split(".");
    if (
      cvCandidate &&
      cvSig &&
      /^[0-9a-f]+$/i.test(cvSig) &&
      verifyHmac(cvCandidate, cvSig, getEnv().BETTER_AUTH_SECRET)
    ) {
      codeVerifier = cvCandidate;
    } else {
      return buildAppRedirect(
        appBaseUrl,
        returnTo,
        "error",
        "Google PKCE verification check failed. Click 'Connect to Google Drive' again."
      );
    }
  }

  try {
    const result = await completeGoogleOAuthConnection({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      code,
      redirectUri,
      purpose: parsedState.purpose,
      codeVerifier,
    });

    if (parsedState.purpose === "google_drive") {
      const successMsg = `Google Drive (${result.email}) connected! Folder '${result.folderName || "RapidShift Labs Backups"}' was created automatically in your Google Drive.`;
      return buildAppRedirect(appBaseUrl, returnTo, "notice", successMsg);
    }

    let successMsg = result.storeName
      ? `Google Business Profile '${result.storeName}' (${result.email}) connected!`
      : `Google Business Profile (${result.email}) connected!`;

    if (result.locationId) {
      const syncRes = await syncGoogleBusinessReviewsForWorkspace({
        workspaceId: session.workspace.id,
        connectionId: result.connectionId,
        forceDiscovery: false,
      }).catch(() => null);
      if (syncRes?.ok) {
        successMsg = `${successMsg} ${syncRes.message}`;
      } else if (syncRes?.message) {
        successMsg = `${successMsg} (${syncRes.message})`;
      }
    } else if (result.gbpDiscoveryDetail) {
      successMsg = `${successMsg} ${result.gbpDiscoveryDetail}`;
    }

    return buildAppRedirect(appBaseUrl, returnTo, "notice", successMsg);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to complete Google OAuth token exchange.";
    return buildAppRedirect(appBaseUrl, returnTo, "error", message);
  }
}
