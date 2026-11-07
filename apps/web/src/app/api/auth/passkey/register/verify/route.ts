import { NextRequest, NextResponse } from "next/server";
import { completePasskeyRegistration, revokeUserPasskey } from "@rsl/auth";
import { getOptionalWebSession } from "@/lib/session";

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
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      credentialId?: string;
      clientDataJSONBase64Url?: string;
      authenticatorDataBase64Url?: string;
      publicKeySpkiBase64Url?: string;
      algorithm?: number;
      transports?: string[];
      deviceLabel?: string;
    };

    if (
      !body.credentialId ||
      !body.clientDataJSONBase64Url ||
      !body.authenticatorDataBase64Url ||
      !body.publicKeySpkiBase64Url
    ) {
      return NextResponse.json(
        { ok: false, error: "Incomplete WebAuthn Passkey registration response." },
        { status: 400 }
      );
    }

    const { rpId, expectedOrigin } = resolveWebAuthnContext(req);
    const saved = completePasskeyRegistration({
      userId: session.user.id,
      expectedRpId: rpId,
      expectedOrigin,
      credentialId: body.credentialId,
      clientDataJSONBase64Url: body.clientDataJSONBase64Url,
      authenticatorDataBase64Url: body.authenticatorDataBase64Url,
      publicKeySpkiBase64Url: body.publicKeySpkiBase64Url,
      algorithm: body.algorithm,
      transports: body.transports,
      deviceLabel: body.deviceLabel,
    });

    return NextResponse.json({ ok: true, passkey: saved });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Passkey registration failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { passkeyId?: string };
  if (!body.passkeyId) {
    return NextResponse.json({ ok: false, error: "passkeyId is required" }, { status: 400 });
  }
  revokeUserPasskey({ userId: session.user.id, passkeyId: body.passkeyId });
  return NextResponse.json({ ok: true });
}
