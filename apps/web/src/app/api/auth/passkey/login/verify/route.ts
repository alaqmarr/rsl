import { NextRequest, NextResponse } from "next/server";
import { completePasskeyAuthentication } from "@rsl/auth";
import { setWebSessionCookie } from "@/lib/session";

function resolveWebAuthnContext(req: NextRequest): { rpId: string; expectedOrigin: string } {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(req.url).protocol.replace(":", "") ||
    "http";
  const hostHeader =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    new URL(req.url).host;
  return {
    rpId: hostHeader.split(":")[0] || "localhost",
    expectedOrigin: `${proto}://${hostHeader}`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      challengeId?: string;
      credentialId?: string;
      clientDataJSONBase64Url?: string;
      authenticatorDataBase64Url?: string;
      signatureBase64Url?: string;
    };

    if (
      !body.challengeId ||
      !body.credentialId ||
      !body.clientDataJSONBase64Url ||
      !body.authenticatorDataBase64Url ||
      !body.signatureBase64Url
    ) {
      return NextResponse.json(
        { ok: false, error: "Incomplete WebAuthn Passkey assertion payload." },
        { status: 400 }
      );
    }

    const { rpId, expectedOrigin } = resolveWebAuthnContext(req);
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    const result = completePasskeyAuthentication({
      challengeId: body.challengeId,
      expectedRpId: rpId,
      expectedOrigin,
      credentialId: body.credentialId,
      clientDataJSONBase64Url: body.clientDataJSONBase64Url,
      authenticatorDataBase64Url: body.authenticatorDataBase64Url,
      signatureBase64Url: body.signatureBase64Url,
      ipAddress,
      userAgent: req.headers.get("user-agent") || undefined,
    });

    await setWebSessionCookie(result.rawSessionToken);
    return NextResponse.json({ ok: true, redirectTo: "/" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Passkey sign-in failed" },
      { status: 401 }
    );
  }
}
