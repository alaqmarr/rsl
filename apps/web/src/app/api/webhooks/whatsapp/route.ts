import crypto from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { creditWallet } from "@rsl/billing";
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

interface RawWhatsAppInboundMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; voice?: boolean };
  video?: { id?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

interface RawWhatsAppStatusEvent {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

function extractWhatsAppInboundText(msg: RawWhatsAppInboundMessage): string {
  if (msg.text?.body?.trim()) return msg.text.body.trim();
  if (msg.button?.text?.trim()) return msg.button.text.trim();
  if (msg.button?.payload?.trim()) return msg.button.payload.trim();
  if (msg.interactive?.button_reply?.title?.trim()) {
    return msg.interactive.button_reply.title.trim();
  }
  if (msg.interactive?.list_reply?.title?.trim()) {
    const descText = msg.interactive.list_reply.description?.trim();
    return descText
      ? `${msg.interactive.list_reply.title.trim()} (${descText})`
      : msg.interactive.list_reply.title.trim();
  }
  if (msg.image) {
    return msg.image.caption?.trim()
      ? `[Image] ${msg.image.caption.trim()}`
      : "[Image received]";
  }
  if (msg.document) {
    const fileLabel = msg.document.filename?.trim() || "document";
    return msg.document.caption?.trim()
      ? `[Document: ${fileLabel}] ${msg.document.caption.trim()}`
      : `[Document: ${fileLabel}]`;
  }
  if (msg.video) {
    return msg.video.caption?.trim()
      ? `[Video] ${msg.video.caption.trim()}`
      : "[Video received]";
  }
  if (msg.audio) {
    return msg.audio.voice ? "[Voice note received]" : "[Audio message received]";
  }
  if (msg.location) {
    const label =
      msg.location.name?.trim() ||
      msg.location.address?.trim() ||
      `${msg.location.latitude ?? 0},${msg.location.longitude ?? 0}`;
    return `[Location shared: ${label}]`;
  }
  return "";
}

function statusRank(st: string): number {
  switch (st) {
    case "read":
      return 3;
    case "delivered":
      return 2;
    case "sent":
      return 1;
    default:
      return 0;
  }
}

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
  const signatureValid =
    Boolean(metaSecret) && /^[0-9a-f]{64}$/i.test(sigHex)
      ? verifyHmac(rawBody, sigHex, metaSecret)
      : false;

  // Reject unauthenticated payloads in memory BEFORE touching ingress.db (P2-08 / SEC-09)
  if (!signatureValid) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const eventId = `wa_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;
  ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: newId(),
      provider: "whatsapp",
      eventId,
      rawBody: rawBody.slice(0, 65536),
      headersJson: JSON.stringify({ sigHeader }),
      signatureValid: true,
      status: "processed",
      receivedAt: Date.now(),
      processedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  try {
    const parsed = JSON.parse(rawBody) as {
      entry?: Array<{
        id?: string;
        changes?: Array<{
          field?: string;
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
            messages?: RawWhatsAppInboundMessage[];
            statuses?: RawWhatsAppStatusEvent[];
            event?: string;
            message_template_id?: string | number;
            message_template_name?: string;
            reason?: string;
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

      if (!targetWorkspaceId && wabaId) {
        const waConns = ctrl
          .select({
            workspaceId: controlSchema.connections.workspaceId,
            metadataJson: controlSchema.connections.metadataJson,
          })
          .from(controlSchema.connections)
          .where(eq(controlSchema.connections.provider, "whatsapp"))
          .all();
        for (const wc of waConns) {
          try {
            const meta = JSON.parse(wc.metadataJson || "{}") as { wabaId?: string };
            if (meta.wabaId === wabaId) {
              targetWorkspaceId = wc.workspaceId;
              break;
            }
          } catch {
            // Ignore malformed metadata
          }
        }
      }

      if (!targetWorkspaceId) continue;

      const dataDb = tenantDataDb({ workspaceId: targetWorkspaceId });
      const logsDb = tenantLogsDb({ workspaceId: targetWorkspaceId });
      const now = Date.now();

      for (const ch of entry.changes ?? []) {
        // 0. Real-time Meta WhatsApp Template Approval / Rejection Status Sync
        if (
          ch.field === "message_template_status_update" &&
          ch.value?.event &&
          (ch.value.message_template_id || ch.value.message_template_name)
        ) {
          const nextStatus = ch.value.event.trim().toUpperCase();
          const metaTmplId = ch.value.message_template_id
            ? String(ch.value.message_template_id).trim()
            : null;
          const metaTmplName = ch.value.message_template_name
            ? ch.value.message_template_name.trim().toLowerCase()
            : null;
          const rejReason =
            nextStatus === "REJECTED" && ch.value.reason && ch.value.reason !== "NONE"
              ? ch.value.reason
              : null;

          const matchedTmpl =
            (metaTmplId
              ? dataDb
                  .select()
                  .from(tenantDataSchema.whatsappTemplates)
                  .where(eq(tenantDataSchema.whatsappTemplates.metaTemplateId, metaTmplId))
                  .get()
              : undefined) ??
            (metaTmplName
              ? dataDb
                  .select()
                  .from(tenantDataSchema.whatsappTemplates)
                  .where(eq(tenantDataSchema.whatsappTemplates.name, metaTmplName))
                  .get()
              : undefined);

          if (matchedTmpl) {
            dataDb
              .update(tenantDataSchema.whatsappTemplates)
              .set({
                approvalStatus: nextStatus,
                metaTemplateId: metaTmplId ?? matchedTmpl.metaTemplateId,
                rejectionReason: rejReason,
                lastSyncedAt: now,
                updatedAt: now,
              })
              .where(eq(tenantDataSchema.whatsappTemplates.id, matchedTmpl.id))
              .run();
          }
        }

        const profileNameByWaId = new Map<string, string>();
        for (const c of ch.value?.contacts ?? []) {
          if (c.wa_id && c.profile?.name?.trim()) {
            profileNameByWaId.set(c.wa_id.replace(/^\+/, ""), c.profile.name.trim());
          }
        }

        // 1. Process outbound delivery & read receipts (statuses[]) — including automatic ₹0-error wallet refund on failed deliveries!
        for (const st of ch.value?.statuses ?? []) {
          const extMsgId = st.id?.trim();
          const incomingStatus = (st.status || "").trim().toLowerCase();
          if (
            !extMsgId ||
            !["sent", "delivered", "read", "failed"].includes(incomingStatus)
          ) {
            continue;
          }

          const existingMsg = dataDb
            .select()
            .from(tenantDataSchema.messages)
            .where(eq(tenantDataSchema.messages.externalMessageId, extMsgId))
            .get();
          if (!existingMsg) continue;

          const prevStatus = (existingMsg.deliveryStatus || "sent").toLowerCase();
          if (prevStatus === incomingStatus) continue;

          const errInfo = st.errors?.[0];
          const errorDetail =
            incomingStatus === "failed"
              ? `${errInfo?.code ? `[${errInfo.code}] ` : ""}${errInfo?.error_data?.details || errInfo?.message || errInfo?.title || "Delivery failed on WhatsApp"}`
              : existingMsg.errorDetail;

          const shouldAdvanceStatus =
            incomingStatus === "failed" ||
            (prevStatus !== "failed" && statusRank(incomingStatus) > statusRank(prevStatus));

          if (!shouldAdvanceStatus) continue;

          const refundAmountPaise =
            incomingStatus === "failed" && prevStatus !== "failed" && existingMsg.costPaise > 0
              ? existingMsg.costPaise
              : 0;

          if (refundAmountPaise > 0) {
            creditWallet({
              workspaceId: targetWorkspaceId,
              amountPaise: refundAmountPaise,
              entryType: "refund",
              idempotencyKey: `wa_fail_refund:${extMsgId}`,
              description: `Auto-refund: WhatsApp delivery failed (${extMsgId}${errInfo?.code ? ` • code ${errInfo.code}` : ""})`,
              actorId: "whatsapp_webhook",
              createInvoice: false,
            });
          }

          dataDb
            .update(tenantDataSchema.messages)
            .set({
              deliveryStatus: incomingStatus,
              errorDetail: errorDetail ?? null,
              ...(refundAmountPaise > 0 ? { costPaise: 0 } : {}),
            })
            .where(eq(tenantDataSchema.messages.id, existingMsg.id))
            .run();

          if (existingMsg.broadcastId) {
            const addDelivered =
              (incomingStatus === "delivered" || incomingStatus === "read") &&
              statusRank(prevStatus) < 2
                ? 1
                : 0;
            const addRead = incomingStatus === "read" && prevStatus !== "read" ? 1 : 0;
            const addFailed = incomingStatus === "failed" && prevStatus !== "failed" ? 1 : 0;

            if (addDelivered > 0 || addRead > 0 || addFailed > 0 || refundAmountPaise > 0) {
              dataDb
                .update(tenantDataSchema.broadcasts)
                .set({
                  deliveredCount: sql`${tenantDataSchema.broadcasts.deliveredCount} + ${addDelivered}`,
                  readCount: sql`${tenantDataSchema.broadcasts.readCount} + ${addRead}`,
                  failedCount: sql`${tenantDataSchema.broadcasts.failedCount} + ${addFailed}`,
                  ...(refundAmountPaise > 0
                    ? {
                        actualCostPaise: sql`MAX(0, ${tenantDataSchema.broadcasts.actualCostPaise} - ${refundAmountPaise})`,
                      }
                    : {}),
                })
                .where(eq(tenantDataSchema.broadcasts.id, existingMsg.broadcastId))
                .run();
            }
          }
        }

        // 2. Process inbound customer messages (text, quick-reply buttons, interactive lists, media)
        for (const msg of ch.value?.messages ?? []) {
          const rawDigits = msg.from?.replace(/^\+/, "") || "";
          const fromPhone = rawDigits ? `+${rawDigits}` : null;
          const bodyText = extractWhatsAppInboundText(msg);
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

          const profileName = profileNameByWaId.get(rawDigits);

          if (!contact) {
            const cId = newEntityId("cnt", targetWorkspaceId, now);
            dataDb
              .insert(tenantDataSchema.contacts)
              .values({
                id: cId,
                name: profileName || fromPhone,
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
          } else if (profileName && contact.name === fromPhone) {
            dataDb
              .update(tenantDataSchema.contacts)
              .set({ name: profileName, updatedAt: now })
              .where(eq(tenantDataSchema.contacts.id, contact.id))
              .run();
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
                unreadCount: 1,
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
            // Check if customer is replying to a recent broadcast
            const lastBroadcastMsg = dataDb
              .select()
              .from(tenantDataSchema.messages)
              .where(
                and(
                  eq(tenantDataSchema.messages.conversationId, conv.id),
                  eq(tenantDataSchema.messages.direction, "outbound"),
                  isNotNull(tenantDataSchema.messages.broadcastId)
                )
              )
              .orderBy(desc(tenantDataSchema.messages.createdAt))
              .get();

            if (lastBroadcastMsg?.broadcastId) {
              dataDb
                .update(tenantDataSchema.broadcasts)
                .set({
                  repliedCount: sql`${tenantDataSchema.broadcasts.repliedCount} + 1`,
                })
                .where(eq(tenantDataSchema.broadcasts.id, lastBroadcastMsg.broadcastId))
                .run();
            }

            dataDb
              .update(tenantDataSchema.conversations)
              .set({
                status: "open",
                unreadCount: (conv.unreadCount ?? 0) + 1,
                lastCustomerMessageAt: now,
                lastMessagePreview: bodyText.slice(0, 140),
                lastActivityAt: now,
              })
              .where(eq(tenantDataSchema.conversations.id, conv.id))
              .run();
          }

          const newMsgId = newEntityId("msg", targetWorkspaceId, now);
          dataDb
            .insert(tenantDataSchema.messages)
            .values({
              id: newMsgId,
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

          try {
            dataDb.$client
              .prepare(
                "INSERT INTO inbox_search_fts (entity_type, entity_id, conversation_id, content) VALUES (?, ?, ?, ?)"
              )
              .run("message", newMsgId, conv.id, `${contact.name} ${bodyText}`);
          } catch {
            // Non-fatal FTS update
          }

          void dispatchWorkspaceWebhookEvent(targetWorkspaceId, "whatsapp.message.received", {
            conversationId: conv.id,
            contactId: contact.id,
            fromPhone,
            messageType: msg.type || "text",
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
