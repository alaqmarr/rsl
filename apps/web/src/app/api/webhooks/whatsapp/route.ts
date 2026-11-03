import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { isValidMetaWebhookVerifyToken } from "@rsl/connections";
import { newEntityId, newId, verifyHmac } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import {
  controlDb,
  getPlatformMetaAppConfig,
  ingressDb,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";

export async function GET(req: Request | NextRequest) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (mode === "subscribe" && challenge && isValidMetaWebhookVerifyToken(token)) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false, error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const metaSecret = getPlatformMetaAppConfig().appSecret;
  const sigHeader = req.headers.get("x-hub-signature-256") || "";
  const sigHex = sigHeader.replace(/^sha256=/i, "");
  const signatureValid = metaSecret
    ? verifyHmac(rawBody, sigHex, metaSecret)
    : false;

  const eventId = `wa_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;
  ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: newId(),
      provider: "whatsapp",
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
      entry?: Array<{
        id?: string;
        changes?: Array<{
          value?: {
            metadata?: { phone_number_id?: string };
            messages?: Array<{ from?: string; id?: string; text?: { body?: string } }>;
          };
        }>;
      }>;
    };

    for (const entry of parsed.entry ?? []) {
      const wabaId = entry.id || "";
      const firstPhoneId = entry.changes?.[0]?.value?.metadata?.phone_number_id || "";
      const ctrl = controlDb();

      let targetWorkspaceId =
        ctrl
          .select({ workspaceId: controlSchema.connections.workspaceId })
          .from(controlSchema.connections)
          .where(
            and(
              eq(controlSchema.connections.provider, "whatsapp"),
              eq(controlSchema.connections.externalAccountId, wabaId)
            )
          )
          .get()?.workspaceId ?? null;

      if (!targetWorkspaceId && firstPhoneId) {
        targetWorkspaceId =
          ctrl
            .select({ workspaceId: controlSchema.connections.workspaceId })
            .from(controlSchema.connections)
            .where(
              and(
                eq(controlSchema.connections.provider, "whatsapp"),
                eq(controlSchema.connections.externalAccountId, firstPhoneId)
              )
            )
            .get()?.workspaceId ?? null;
      }

      if (!targetWorkspaceId) {
        const routed = [wabaId, firstPhoneId]
          .filter(Boolean)
          .map((extId) =>
            ctrl
              .select({ tenantId: controlSchema.assetRouting.tenantId })
              .from(controlSchema.assetRouting)
              .where(
                and(
                  eq(controlSchema.assetRouting.provider, "whatsapp"),
                  eq(controlSchema.assetRouting.externalId, extId)
                )
              )
              .get()
          )
          .find(Boolean);
        targetWorkspaceId = routed?.tenantId ?? null;
      }

      if (!targetWorkspaceId) continue;

      const dataDb = tenantDataDb({ workspaceId: targetWorkspaceId });
      const logsDb = tenantLogsDb({ workspaceId: targetWorkspaceId });
      const now = Date.now();

      for (const ch of entry.changes ?? []) {
        for (const msg of ch.value?.messages ?? []) {
          const fromPhone = msg.from ? `+${msg.from.replace(/^\+/, "")}` : null;
          const bodyText = msg.text?.body?.trim() || "";
          if (!fromPhone || !bodyText) continue;

          if (/^(stop|unsubscribe)$/i.test(bodyText)) {
            logsDb
              .insert(tenantLogsSchema.suppressions)
              .values({
                id: newId(),
                channel: "whatsapp",
                identifier: fromPhone,
                reason: "Customer replied STOP on WhatsApp",
                createdAt: now,
              })
              .onConflictDoNothing()
              .run();
          }

          let contact = dataDb
            .select()
            .from(tenantDataSchema.contacts)
            .where(eq(tenantDataSchema.contacts.phoneE164, fromPhone))
            .get();

          if (!contact) {
            const cId = newEntityId("cnt", targetWorkspaceId, now);
            dataDb
              .insert(tenantDataSchema.contacts)
              .values({
                id: cId,
                name: fromPhone,
                phoneE164: fromPhone,
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
                eq(tenantDataSchema.conversations.channel, "whatsapp")
              )
            )
            .get();

          if (!conv) {
            const convId = newEntityId("cnv", targetWorkspaceId, now);
            dataDb
              .insert(tenantDataSchema.conversations)
              .values({
                id: convId,
                contactId: contact.id,
                channel: "whatsapp",
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
              id: newEntityId("msg", targetWorkspaceId, now),
              conversationId: conv.id,
              direction: "inbound",
              senderType: "contact",
              senderId: contact.id,
              body: bodyText,
              deliveryStatus: "delivered",
              externalMessageId: msg.id ?? null,
              createdAt: now,
            })
            .run();

          void dispatchWorkspaceWebhookEvent(targetWorkspaceId, "whatsapp.message.received", {
            conversationId: conv.id,
            contactId: contact.id,
            fromPhone,
            body: bodyText,
          }).catch(() => 0);
        }
      }
    }
  } catch {
    // Raw event is safely stored in ingress.db
  }

  return NextResponse.json({ ok: true });
}
