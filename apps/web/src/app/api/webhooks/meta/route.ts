import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isValidMetaWebhookVerifyToken } from "@rsl/connections";
import { newEntityId, newId, verifyHmac } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema } from "@rsl/database";
import { controlDb, getPlatformMetaAppConfig, ingressDb, tenantDataDb } from "@rsl/tenancy";

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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const metaSecret = getPlatformMetaAppConfig().appSecret;
  const sigHeader = req.headers.get("x-hub-signature-256") || "";
  const sigHex = sigHeader.replace(/^sha256=/i, "");
  const signatureValid = metaSecret
    ? verifyHmac(rawBody, sigHex, metaSecret)
    : false;

  const eventId = `meta_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;
  ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: newId(),
      provider: "meta",
      eventId,
      rawBody: rawBody.slice(0, 65536),
      headersJson: JSON.stringify({ sigHeader }),
      signatureValid,
      status: signatureValid ? "processed" : "ignored",
      receivedAt: Date.now(),
      processedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  if (!signatureValid) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      object?: string;
      entry?: Array<{
        id?: string;
        messaging?: Array<{
          sender?: { id?: string };
          message?: { mid?: string; text?: string; is_echo?: boolean };
        }>;
      }>;
    };

    const channel = parsed.object === "instagram" ? "instagram" : "facebook";
    const ctrl = controlDb();

    for (const entry of parsed.entry ?? []) {
      const assetExtId = entry.id || "";
      if (!assetExtId) continue;

      const routed =
        ctrl
          .select({ tenantId: controlSchema.assetRouting.tenantId })
          .from(controlSchema.assetRouting)
          .where(
            and(
              eq(controlSchema.assetRouting.provider, "meta"),
              eq(controlSchema.assetRouting.externalId, assetExtId)
            )
          )
          .get()?.tenantId ??
        ctrl
          .select({ workspaceId: controlSchema.connections.workspaceId })
          .from(controlSchema.connections)
          .where(
            and(
              eq(controlSchema.connections.provider, "meta"),
              eq(controlSchema.connections.externalAccountId, assetExtId)
            )
          )
          .get()?.workspaceId ??
        null;

      if (!routed) continue;

      const dataDb = tenantDataDb({ workspaceId: routed });
      const now = Date.now();

      for (const evt of entry.messaging ?? []) {
        if (evt.message?.is_echo) continue;
        const senderScopedId = evt.sender?.id?.trim();
        const bodyText = evt.message?.text?.trim();
        if (!senderScopedId || !bodyText) continue;

        let contact =
          channel === "instagram"
            ? dataDb
                .select()
                .from(tenantDataSchema.contacts)
                .where(eq(tenantDataSchema.contacts.instagramHandle, senderScopedId))
                .get()
            : dataDb
                .select()
                .from(tenantDataSchema.contacts)
                .where(eq(tenantDataSchema.contacts.facebookScopedId, senderScopedId))
                .get();

        if (!contact) {
          const cId = newEntityId("cnt", routed, now);
          dataDb
            .insert(tenantDataSchema.contacts)
            .values({
              id: cId,
              name:
                channel === "instagram"
                  ? `IG User ${senderScopedId.slice(-6)}`
                  : `FB User ${senderScopedId.slice(-6)}`,
              instagramHandle: channel === "instagram" ? senderScopedId : null,
              facebookScopedId: channel === "facebook" ? senderScopedId : null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          contact = dataDb
            .select()
            .from(tenantDataSchema.contacts)
            .where(eq(tenantDataSchema.contacts.id, cId))
            .get()!;
        }

        let conv = dataDb
          .select()
          .from(tenantDataSchema.conversations)
          .where(
            and(
              eq(tenantDataSchema.conversations.contactId, contact.id),
              eq(tenantDataSchema.conversations.channel, channel)
            )
          )
          .get();

        if (!conv) {
          const convId = newEntityId("cnv", routed, now);
          dataDb
            .insert(tenantDataSchema.conversations)
            .values({
              id: convId,
              contactId: contact.id,
              channel,
              status: "open",
              lastCustomerMessageAt: now,
              lastMessagePreview: bodyText.slice(0, 140),
              lastActivityAt: now,
              createdAt: now,
            })
            .run();
          conv = dataDb
            .select()
            .from(tenantDataSchema.conversations)
            .where(eq(tenantDataSchema.conversations.id, convId))
            .get()!;
        } else {
          dataDb
            .update(tenantDataSchema.conversations)
            .set({
              status: "open",
              lastCustomerMessageAt: now,
              lastMessagePreview: bodyText.slice(0, 140),
              lastActivityAt: now,
            })
            .where(eq(tenantDataSchema.conversations.id, conv.id))
            .run();
        }

        dataDb
          .insert(tenantDataSchema.messages)
          .values({
            id: newEntityId("msg", routed, now),
            conversationId: conv.id,
            direction: "inbound",
            senderType: "contact",
            senderId: contact.id,
            body: bodyText,
            deliveryStatus: "delivered",
            externalMessageId: evt.message?.mid ?? null,
            createdAt: now,
          })
          .run();
      }
    }
  } catch {
    // Raw event already stored in ingress.db
  }

  return NextResponse.json({ ok: true });
}
