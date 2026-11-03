import { NextResponse, type NextRequest } from "next/server";
import { completeGoogleOAuthConnection, type GoogleOAuthPurpose } from "@rsl/connections";
import { getEnv, resolveEndpointsFromHeaders, verifyHmac } from "@rsl/core";
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
  return res;
}

export async function GET(req: NextRequest) {
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
      "Your Google sign-in session expired or changed workspaces. Click 'Connect with Google' again."
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

  try {
    const result = await completeGoogleOAuthConnection({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      code,
      redirectUri,
      purpose: parsedState.purpose,
    });

    const successMsg =
      parsedState.purpose === "google_drive"
        ? `Google Drive (${result.email}) connected! Folder '${result.folderName || "RapidShift Labs Backups"}' was created automatically in your Google Drive.`
        : `Google Business Profile (${result.email}) connected via Google Sign-In!`;

    return buildAppRedirect(appBaseUrl, returnTo, "notice", successMsg);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to complete Google OAuth token exchange.";
    return buildAppRedirect(appBaseUrl, returnTo, "error", message);
  }
}
