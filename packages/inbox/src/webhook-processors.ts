import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { creditWallet } from "@rsl/billing";
import { resolveWorkspaceChannelCredentials } from "@rsl/connections";
import { decryptEnvelope, fetchWithRetry, newEntityId, newId } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { sendWorkspaceWebPushNotification } from "@rsl/notifications";
import {
  getBullQueue,
  isRedisConfigured,
  QUEUE_REGISTRY,
  registerJobProcessor,
  type JobEnvelope,
} from "@rsl/queue";
import {
  controlDb,
  getPlatformCloudflareAiConfig,
  ingressDb,
  tenantDataDb,
  tenantLogsDb,
  transcribeCloudflareWorkersAiAudio,
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

interface MetaLeadFieldItem {
  name?: string;
  values?: string[];
}

function normalizePhoneFromLead(raw?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
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

export function extractWhatsAppWebhookEventId(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      entry?: Array<{
        id?: string;
        changes?: Array<{
          field?: string;
          value?: {
            messages?: Array<{ id?: string }>;
            statuses?: Array<{ id?: string; status?: string }>;
            message_template_id?: string | number;
            event?: string;
          };
        }>;
      }>;
    };
    const tokens: string[] = [];
    for (const entry of parsed.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        for (const m of ch.value?.messages ?? []) {
          if (m.id?.trim()) tokens.push(`msg:${m.id.trim()}`);
        }
        for (const s of ch.value?.statuses ?? []) {
          if (s.id?.trim()) tokens.push(`st:${s.id.trim()}:${(s.status ?? "").trim()}`);
        }
        if (ch.field === "message_template_status_update" && ch.value?.message_template_id) {
          tokens.push(`tmpl:${ch.value.message_template_id}:${ch.value.event ?? ""}`);
        }
      }
    }
    if (tokens.length > 0) {
      const joined = tokens.join("|");
      return joined.length <= 96
        ? `wa_${joined}`
        : `wa_${crypto.createHash("sha256").update(joined).digest("hex").slice(0, 32)}`;
    }
  } catch {
    // Fall back to body digest below
  }
  return `wa_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

export function extractMetaWebhookEventId(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      entry?: Array<{
        messaging?: Array<{ message?: { mid?: string } }>;
        changes?: Array<{ field?: string; value?: { leadgen_id?: string } }>;
      }>;
    };
    const tokens: string[] = [];
    for (const entry of parsed.entry ?? []) {
      for (const evt of entry.messaging ?? []) {
        if (evt.message?.mid?.trim()) tokens.push(`mid:${evt.message.mid.trim()}`);
      }
      for (const ch of entry.changes ?? []) {
        if (ch.value?.leadgen_id?.trim()) tokens.push(`lead:${ch.value.leadgen_id.trim()}`);
      }
    }
    if (tokens.length > 0) {
      const joined = tokens.join("|");
      return joined.length <= 96
        ? `meta_${joined}`
        : `meta_${crypto.createHash("sha256").update(joined).digest("hex").slice(0, 32)}`;
    }
  } catch {
    // Fall back to body digest below
  }
  return `meta_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

export async function processWhatsAppWebhookPayload(rawBody: string): Promise<{
  routedTenantId: string | null;
}> {
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

  let firstRoutedTenantId: string | null = null;

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
    if (!firstRoutedTenantId) firstRoutedTenantId = targetWorkspaceId;

    const wsRow = ctrl
      .select({ mode: controlSchema.workspaces.mode })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, targetWorkspaceId))
      .get();
    const isSandboxWorkspace = wsRow?.mode === "test";

    const dataDb = tenantDataDb({ workspaceId: targetWorkspaceId });
    const logsDb = tenantLogsDb({ workspaceId: targetWorkspaceId });
    const now = Date.now();

    for (const ch of entry.changes ?? []) {
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

          void sendWorkspaceWebPushNotification({
            workspaceId: targetWorkspaceId,
            payload: {
              title:
                nextStatus === "APPROVED"
                  ? `WhatsApp Template Approved: ${matchedTmpl.name}`
                  : `WhatsApp Template ${nextStatus}: ${matchedTmpl.name}`,
              body:
                nextStatus === "APPROVED"
                  ? `Meta approved '${matchedTmpl.name}'. It is now ready for automations and broadcasts.`
                  : rejReason
                    ? `Reason: ${rejReason}`
                    : `Meta updated status to ${nextStatus}.`,
              url: "/whatsapp",
              tag: `wa-tmpl-${matchedTmpl.id}`,
            },
          }).catch(() => undefined);
        }
      }

      const profileNameByWaId = new Map<string, string>();
      for (const c of ch.value?.contacts ?? []) {
        if (c.wa_id && c.profile?.name?.trim()) {
          profileNameByWaId.set(c.wa_id.replace(/^\+/, ""), c.profile.name.trim());
        }
      }

      for (const st of ch.value?.statuses ?? []) {
        const extMsgId = st.id?.trim();
        const incomingStatus = (st.status || "").trim().toLowerCase();
        if (!extMsgId || !["sent", "delivered", "read", "failed"].includes(incomingStatus)) {
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

      for (const msg of ch.value?.messages ?? []) {
        const extInboundId = msg.id?.trim() || null;
        if (extInboundId) {
          const dupMsg = dataDb
            .select({ id: tenantDataSchema.messages.id })
            .from(tenantDataSchema.messages)
            .where(
              and(
                eq(tenantDataSchema.messages.externalMessageId, extInboundId),
                eq(tenantDataSchema.messages.direction, "inbound")
              )
            )
            .get();
          if (dupMsg) continue;
        }

        const rawDigits = msg.from?.replace(/^\+/, "") || "";
        const fromPhone = rawDigits ? `+${rawDigits}` : null;
        let bodyText = extractWhatsAppInboundText(msg);
        if (!fromPhone || !bodyText) continue;

        if (msg.audio?.id && !isSandboxWorkspace && getPlatformCloudflareAiConfig().isReady) {
          try {
            const waConn = ctrl
              .select({ encryptedTokens: controlSchema.connections.encryptedTokens })
              .from(controlSchema.connections)
              .where(
                and(
                  eq(controlSchema.connections.workspaceId, targetWorkspaceId),
                  eq(controlSchema.connections.provider, "whatsapp")
                )
              )
              .get();
            if (waConn?.encryptedTokens) {
              const dec = decryptEnvelope(waConn.encryptedTokens);
              let accessToken = dec.trim();
              try {
                const parsedTok = JSON.parse(dec) as { accessToken?: string };
                if (parsedTok.accessToken) accessToken = parsedTok.accessToken.trim();
              } catch {
                // Plain string token
              }
              if (accessToken && !/^rsl_sandbox_/i.test(accessToken)) {
                const metaRes = await fetchWithRetry(
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(msg.audio.id)}`,
                  { headers: { Authorization: `Bearer ${accessToken}` } },
                  { timeoutMs: 8_000, retries: 1 }
                );
                if (metaRes.ok) {
                  const mediaInfo = (await metaRes.json()) as { url?: string };
                  if (mediaInfo.url) {
                    const binRes = await fetchWithRetry(
                      mediaInfo.url,
                      { headers: { Authorization: `Bearer ${accessToken}` } },
                      { timeoutMs: 10_000, retries: 1 }
                    );
                    if (binRes.ok) {
                      const audioBytes = new Uint8Array(await binRes.arrayBuffer());
                      const whisper = await transcribeCloudflareWorkersAiAudio({ audioBytes });
                      if (whisper.ok && whisper.transcript) {
                        bodyText = `${bodyText} - "${whisper.transcript}"`;
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // Keep base voice-note label on failure
          }
        }

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
            externalMessageId: extInboundId,
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

        await dispatchWorkspaceWebhookEvent(
          targetWorkspaceId,
          "whatsapp.message.received",
          {
            conversationId: conv.id,
            contactId: contact.id,
            fromPhone,
            messageType: msg.type || "text",
            body: bodyText,
          },
          { asyncOnly: isRedisConfigured() }
        );

        void sendWorkspaceWebPushNotification({
          workspaceId: targetWorkspaceId,
          payload: {
            title: `WhatsApp from ${contact.name}`,
            body: bodyText.slice(0, 140),
            url: `/inbox?conversation=${encodeURIComponent(conv.id)}`,
            tag: `wa-conv-${conv.id}`,
          },
        }).catch(() => undefined);
      }
    }
  }

  return { routedTenantId: firstRoutedTenantId };
}

export async function processMetaWebhookPayload(rawBody: string): Promise<{
  routedTenantId: string | null;
}> {
  const parsed = JSON.parse(rawBody) as {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        message?: {
          mid?: string;
          text?: string;
          is_echo?: boolean;
          attachments?: Array<{ type?: string; payload?: { url?: string } }>;
        };
      }>;
      changes?: Array<{
        field?: string;
        value?: {
          leadgen_id?: string;
          page_id?: string;
          form_id?: string;
          ad_id?: string;
          campaign_id?: string;
          created_time?: number;
          field_data?: MetaLeadFieldItem[];
        };
      }>;
    }>;
  };

  const channel = parsed.object === "instagram" ? "instagram" : "facebook";
  const ctrl = controlDb();
  let firstRoutedTenantId: string | null = null;

  for (const entry of parsed.entry ?? []) {
    const assetExtId = entry.id || entry.changes?.[0]?.value?.page_id || "";
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
    if (!firstRoutedTenantId) firstRoutedTenantId = routed;

    const dataDb = tenantDataDb({ workspaceId: routed });
    const now = Date.now();

    for (const evt of entry.messaging ?? []) {
      if (evt.message?.is_echo) continue;
      const extMid = evt.message?.mid?.trim() || null;
      if (extMid) {
        const dupMsg = dataDb
          .select({ id: tenantDataSchema.messages.id })
          .from(tenantDataSchema.messages)
          .where(
            and(
              eq(tenantDataSchema.messages.externalMessageId, extMid),
              eq(tenantDataSchema.messages.direction, "inbound")
            )
          )
          .get();
        if (dupMsg) continue;
      }

      const senderScopedId = evt.sender?.id?.trim();
      const attachmentLabel = evt.message?.attachments?.[0]?.type
        ? `[${evt.message.attachments[0].type.toUpperCase()} attachment received]`
        : "";
      const bodyText = evt.message?.text?.trim() || attachmentLabel;
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

      const msgId = newEntityId("msg", routed, now);
      dataDb
        .insert(tenantDataSchema.messages)
        .values({
          id: msgId,
          conversationId: conv.id,
          direction: "inbound",
          senderType: "contact",
          senderId: contact.id,
          body: bodyText,
          deliveryStatus: "delivered",
          externalMessageId: extMid,
          createdAt: now,
        })
        .run();

      try {
        dataDb.$client
          .prepare(
            "INSERT INTO inbox_search_fts (entity_type, entity_id, conversation_id, content) VALUES (?, ?, ?, ?)"
          )
          .run("message", msgId, conv.id, `${contact.name} ${bodyText}`);
      } catch {
        // Non-fatal
      }
    }

    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value) continue;
      const leadgenId = ch.value.leadgen_id?.trim() || "";
      const leadExtMsgId = leadgenId ? `leadgen:${leadgenId}` : null;
      if (leadExtMsgId) {
        const dupLead = dataDb
          .select({ id: tenantDataSchema.messages.id })
          .from(tenantDataSchema.messages)
          .where(eq(tenantDataSchema.messages.externalMessageId, leadExtMsgId))
          .get();
        if (dupLead) continue;
      }

      let adId = ch.value.ad_id?.trim() || "";
      let campaignExtId = ch.value.campaign_id?.trim() || "";
      let fieldData: MetaLeadFieldItem[] = Array.isArray(ch.value.field_data)
        ? ch.value.field_data
        : [];

      if (fieldData.length === 0 && leadgenId) {
        const pageCreds = resolveWorkspaceChannelCredentials({
          workspaceId: routed,
          channelKind: "facebook_page",
        });
        const adsCreds = !pageCreds.ok
          ? resolveWorkspaceChannelCredentials({
              workspaceId: routed,
              channelKind: "meta_ads_pixel",
            })
          : null;
        const activeCreds = pageCreds.ok ? pageCreds : adsCreds;

        if (activeCreds?.ok && activeCreds.mode === "live" && activeCreds.accessToken) {
          try {
            const leadResp = await fetchWithRetry(
              `https://graph.facebook.com/${activeCreds.graphVersion}/${encodeURIComponent(leadgenId)}?fields=created_time,field_data,ad_id,campaign_id,form_id`,
              {
                headers: { Authorization: `Bearer ${activeCreds.accessToken}` },
              },
              { timeoutMs: 8_000, retries: 1 }
            );
            if (leadResp.ok) {
              const leadBody = (await leadResp.json()) as {
                field_data?: MetaLeadFieldItem[];
                ad_id?: string;
                campaign_id?: string;
              };
              if (Array.isArray(leadBody.field_data)) {
                fieldData = leadBody.field_data;
              }
              if (!adId && leadBody.ad_id) adId = leadBody.ad_id;
              if (!campaignExtId && leadBody.campaign_id) campaignExtId = leadBody.campaign_id;
            }
          } catch {
            // Proceed with basic leadgen_id record
          }
        }
      }

      const fieldMap = new Map<string, string>();
      const formattedAnswers: string[] = [];
      for (const item of fieldData) {
        const key = (item.name || "").trim().toLowerCase();
        const val = (item.values ?? []).join(", ").trim();
        if (key && val) {
          fieldMap.set(key, val);
          formattedAnswers.push(`${item.name}: ${val}`);
        }
      }

      const fullName =
        fieldMap.get("full_name") ||
        [fieldMap.get("first_name"), fieldMap.get("last_name")].filter(Boolean).join(" ").trim() ||
        `Meta Lead ${leadgenId ? leadgenId.slice(-6) : Date.now().toString().slice(-4)}`;
      const phoneE164 = normalizePhoneFromLead(
        fieldMap.get("phone_number") || fieldMap.get("phone") || fieldMap.get("whatsapp_number")
      );
      const email =
        (fieldMap.get("email") || fieldMap.get("work_email") || "").trim().toLowerCase() || null;
      const companyName =
        (fieldMap.get("company_name") || fieldMap.get("business_name") || "").trim() || null;

      let contact = phoneE164
        ? dataDb
            .select()
            .from(tenantDataSchema.contacts)
            .where(eq(tenantDataSchema.contacts.phoneE164, phoneE164))
            .get()
        : email
          ? dataDb
              .select()
              .from(tenantDataSchema.contacts)
              .where(eq(tenantDataSchema.contacts.email, email))
              .get()
          : undefined;

      if (!contact) {
        const cId = newEntityId("cnt", routed, now);
        dataDb
          .insert(tenantDataSchema.contacts)
          .values({
            id: cId,
            name: fullName,
            phoneE164,
            email,
            companyName,
            tagsJson: JSON.stringify(["meta_lead_ad"]),
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

      if (phoneE164) {
        dataDb
          .insert(tenantDataSchema.optIns)
          .values({
            id: newId(),
            contactId: contact.id,
            phoneE164,
            channel: "whatsapp",
            source: "meta_lead_ad_form",
            evidenceNote: `Meta Instant Lead Form ${ch.value.form_id || leadgenId || "submission"}`,
            consentedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }

      const leadSummaryBody = [
        `New Meta Lead Ad Enquiry (${fullName})`,
        ...(formattedAnswers.length > 0
          ? formattedAnswers
          : [`Lead ID: ${leadgenId || "direct"}`]),
      ].join("\n");

      const leadConvChannel = phoneE164 ? "whatsapp" : "facebook";
      let conv = dataDb
        .select()
        .from(tenantDataSchema.conversations)
        .where(
          and(
            eq(tenantDataSchema.conversations.contactId, contact.id),
            eq(tenantDataSchema.conversations.channel, leadConvChannel)
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
            channel: leadConvChannel,
            status: "open",
            unreadCount: 1,
            lastCustomerMessageAt: now,
            lastMessagePreview: leadSummaryBody.slice(0, 140),
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
            unreadCount: (conv.unreadCount ?? 0) + 1,
            lastCustomerMessageAt: now,
            lastMessagePreview: leadSummaryBody.slice(0, 140),
            lastActivityAt: now,
          })
          .where(eq(tenantDataSchema.conversations.id, conv.id))
          .run();
      }

      const leadMsgId = newEntityId("msg", routed, now);
      dataDb
        .insert(tenantDataSchema.messages)
        .values({
          id: leadMsgId,
          conversationId: conv.id,
          direction: "inbound",
          senderType: "contact",
          senderId: contact.id,
          body: leadSummaryBody,
          deliveryStatus: "delivered",
          externalMessageId: leadExtMsgId,
          createdAt: now,
        })
        .run();

      try {
        dataDb.$client
          .prepare(
            "INSERT INTO inbox_search_fts (entity_type, entity_id, conversation_id, content) VALUES (?, ?, ?, ?)"
          )
          .run("message", leadMsgId, conv.id, `${fullName} ${leadSummaryBody}`);
      } catch {
        // Non-fatal
      }

      if (campaignExtId || adId) {
        const conditions = [
          campaignExtId
            ? eq(tenantDataSchema.campaigns.externalCampaignId, campaignExtId)
            : undefined,
          adId ? eq(tenantDataSchema.campaigns.externalAdId, adId) : undefined,
        ].filter(Boolean);

        if (conditions.length > 0) {
          dataDb
            .update(tenantDataSchema.campaigns)
            .set({
              conversions: sql`${tenantDataSchema.campaigns.conversions} + 1`,
              updatedAt: now,
            })
            .where(conditions.length === 2 ? or(conditions[0]!, conditions[1]!) : conditions[0]!)
            .run();
        }
      }

      await dispatchWorkspaceWebhookEvent(
        routed,
        "whatsapp.message.received",
        {
          type: "meta_leadgen",
          leadgenId,
          contactId: contact.id,
          conversationId: conv.id,
          name: fullName,
          phoneE164,
          email,
        },
        { asyncOnly: isRedisConfigured() }
      );
    }
  }

  return { routedTenantId: firstRoutedTenantId };
}

export async function processWebhookInboxRecord(inboxId: string): Promise<boolean> {
  const db = ingressDb();
  const row = db
    .select()
    .from(ingressSchema.webhookInbox)
    .where(eq(ingressSchema.webhookInbox.id, inboxId))
    .get();

  if (!row || row.status === "processed" || row.status === "dead" || row.status === "ignored") {
    return false;
  }

  const attempt = (row.attempts ?? 0) + 1;
  const maxAttempts =
    row.provider === "whatsapp"
      ? QUEUE_REGISTRY["webhooks.whatsapp"].maxAttempts
      : QUEUE_REGISTRY["webhooks.meta"].maxAttempts;

  try {
    let routedTenantId: string | null = null;
    if (row.provider === "whatsapp") {
      const res = await processWhatsAppWebhookPayload(row.rawBody);
      routedTenantId = res.routedTenantId;
    } else if (row.provider === "meta") {
      const res = await processMetaWebhookPayload(row.rawBody);
      routedTenantId = res.routedTenantId;
    } else {
      return false;
    }

    db.update(ingressSchema.webhookInbox)
      .set({
        status: "processed",
        routedTenantId,
        attempts: attempt,
        nextRetryAt: null,
        errorMessage: null,
        processedAt: Date.now(),
      })
      .where(eq(ingressSchema.webhookInbox.id, row.id))
      .run();

    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isDead = attempt >= maxAttempts;
    const backoffMs = Math.min(300_000, 2_000 * 2 ** Math.min(attempt - 1, 7));

    db.update(ingressSchema.webhookInbox)
      .set({
        status: isDead ? "dead" : "received",
        attempts: attempt,
        nextRetryAt: isDead ? null : Date.now() + backoffMs,
        errorMessage: errMsg,
      })
      .where(eq(ingressSchema.webhookInbox.id, row.id))
      .run();

    return false;
  }
}

let inboundWebhookProcessorsRegistered = false;

export function ensureInboundWebhookProcessorsRegistered(): void {
  if (inboundWebhookProcessorsRegistered) return;
  registerJobProcessor("webhooks.whatsapp.ingest", async (envelope) => {
    const inboxId = String(envelope.payload.inboxId ?? "").trim();
    if (!inboxId) return;
    await processWebhookInboxRecord(inboxId);
  });
  registerJobProcessor("webhooks.meta.ingest", async (envelope) => {
    const inboxId = String(envelope.payload.inboxId ?? "").trim();
    if (!inboxId) return;
    await processWebhookInboxRecord(inboxId);
  });
  inboundWebhookProcessorsRegistered = true;
}

ensureInboundWebhookProcessorsRegistered();

export async function ingestInboundProviderWebhook(params: {
  provider: "whatsapp" | "meta";
  rawBody: string;
  sigHeader: string;
  deferToWorker?: boolean;
}): Promise<{
  deduplicated: boolean;
  queued: boolean;
  eventId: string;
  inboxId: string | null;
}> {
  ensureInboundWebhookProcessorsRegistered();
  const eventId =
    params.provider === "whatsapp"
      ? extractWhatsAppWebhookEventId(params.rawBody)
      : extractMetaWebhookEventId(params.rawBody);

  const now = Date.now();
  const inboxId = newId();
  const db = ingressDb();

  const inserted = db
    .insert(ingressSchema.webhookInbox)
    .values({
      id: inboxId,
      provider: params.provider,
      eventId,
      rawBody: params.rawBody.slice(0, 65536),
      headersJson: JSON.stringify({ sigHeader: params.sigHeader }),
      signatureValid: true,
      status: "received",
      attempts: 0,
      nextRetryAt: now,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (inserted.changes === 0) {
    return {
      deduplicated: true,
      queued: false,
      eventId,
      inboxId: null,
    };
  }

  const queueName = params.provider === "whatsapp" ? "webhooks.whatsapp" : "webhooks.meta";
  const jobType =
    params.provider === "whatsapp" ? "webhooks.whatsapp.ingest" : "webhooks.meta.ingest";
  const bullQueue = getBullQueue(queueName);

  if (bullQueue) {
    const def = QUEUE_REGISTRY[queueName];
    const envelope: JobEnvelope = {
      v: 1,
      type: jobType,
      queue: queueName,
      tenantId: "ingress",
      correlationId: inboxId,
      requestId: inboxId,
      actor: { type: "webhook", id: `${params.provider}_ingress` },
      idempotencyKey: `ingress:${params.provider}:${inboxId}`,
      payload: { inboxId, provider: params.provider, eventId },
    };
    await bullQueue.add(jobType, envelope, {
      jobId: `ingress_${params.provider}_${inboxId}`,
      attempts: def.maxAttempts,
      backoff: { type: "exponential", delay: 2000 },
    });
    db.update(ingressSchema.webhookInbox)
      .set({ status: "enqueued" })
      .where(eq(ingressSchema.webhookInbox.id, inboxId))
      .run();
    return {
      deduplicated: false,
      queued: true,
      eventId,
      inboxId,
    };
  }

  if (params.deferToWorker) {
    return {
      deduplicated: false,
      queued: true,
      eventId,
      inboxId,
    };
  }

  await processWebhookInboxRecord(inboxId);
  return {
    deduplicated: false,
    queued: false,
    eventId,
    inboxId,
  };
}

export async function sweepPendingWebhookInbox(limit = 50): Promise<number> {
  const db = ingressDb();
  const now = Date.now();
  const staleEnqueuedCutoff = now - 30_000;

  const dueRows = db
    .select({ id: ingressSchema.webhookInbox.id })
    .from(ingressSchema.webhookInbox)
    .where(
      and(
        inArray(ingressSchema.webhookInbox.provider, ["whatsapp", "meta"]),
        or(
          and(
            eq(ingressSchema.webhookInbox.status, "received"),
            or(
              isNull(ingressSchema.webhookInbox.nextRetryAt),
              lte(ingressSchema.webhookInbox.nextRetryAt, now)
            )
          ),
          and(
            eq(ingressSchema.webhookInbox.status, "enqueued"),
            lte(ingressSchema.webhookInbox.receivedAt, staleEnqueuedCutoff)
          )
        )
      )
    )
    .limit(Math.max(1, Math.min(200, limit)))
    .all();

  let processed = 0;
  for (const row of dueRows) {
    const ok = await processWebhookInboxRecord(row.id);
    if (ok) processed++;
  }
  return processed;
}
