import { NextRequest, NextResponse } from "next/server";
import {
  listUserWebPushSubscriptions,
  removeUserWebPushSubscription,
  saveUserWebPushSubscription,
  sendWorkspaceWebPushNotification,
} from "@rsl/notifications";
import { getOptionalWebSession } from "@/lib/session";

export async function GET() {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }
  const subscriptions = listUserWebPushSubscriptions(session.user.id, session.workspace.id);
  return NextResponse.json({ ok: true, subscriptions });
}

export async function POST(req: NextRequest) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  let body: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    deviceLabel?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json(
      { ok: false, error: "Push subscription endpoint, p256dh, and auth keys are required." },
      { status: 400 }
    );
  }

  const saved = saveUserWebPushSubscription({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    subscription: {
      endpoint: body.endpoint,
      keys: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    },
    userAgent: body.deviceLabel || req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

export async function PATCH() {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const res = await sendWorkspaceWebPushNotification({
    workspaceId: session.workspace.id,
    payload: {
      title: `${session.workspace.name} — Live Push Active`,
      body: "Instant alerts for WhatsApp chats, Tally payments, Google reviews & vendor bills are enabled!",
      url: "/settings/profile",
      tag: "rsl-test-push",
    },
  });

  return NextResponse.json({ ok: true, ...res });
}

export async function DELETE(req: NextRequest) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  let body: { subscriptionId?: string; endpoint?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Allow empty body check
  }

  removeUserWebPushSubscription({
    userId: session.user.id,
    subscriptionId: body.subscriptionId,
    endpoint: body.endpoint,
  });
  return NextResponse.json({ ok: true });
}
