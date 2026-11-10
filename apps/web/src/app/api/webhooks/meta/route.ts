import { NextRequest, NextResponse } from "next/server";
import { isValidMetaWebhookVerifyToken } from "@rsl/connections";
import { verifyHmac } from "@rsl/core";
import { ingestInboundProviderWebhook } from "@rsl/inbox";
import { getPlatformMetaAppConfig } from "@rsl/tenancy";

export async function GET(req: Request | NextRequest) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (mode === "subscribe" && challenge && isValidMetaWebhookVerifyToken(token)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Meta webhook verification failed" }, { status: 403 });
}

export async function POST(req: Request | NextRequest) {
  const rawBody = await req.text();
  const metaSecret = getPlatformMetaAppConfig().appSecret;
  const sigHeader = req.headers.get("x-hub-signature-256") || "";
  const sigHex = sigHeader.replace(/^sha256=/i, "");
  const signatureValid =
    Boolean(metaSecret) && /^[0-9a-f]{64}$/i.test(sigHex)
      ? verifyHmac(rawBody, sigHex, metaSecret)
      : false;

  if (!signatureValid) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const res = await ingestInboundProviderWebhook({
    provider: "meta",
    rawBody,
    sigHeader,
  });

  if (res.deduplicated) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  return NextResponse.json({ ok: true, queued: res.queued, eventId: res.eventId });
}
