import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { canDebitWalletUsage, consumeUsage, getWalletBalancePaise } from "@rsl/billing";
import { resolveWorkspaceChannelCredentials } from "@rsl/connections";
import { newEntityId, newId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { reserveSendGuard, markSendGuardOutcome } from "@rsl/queue";
import { controlDb, tenantDataDb, tenantLogsDb } from "@rsl/tenancy";

async function dispatchOutboundConversationMessageLive(params: {
  workspaceId: string;
  channel: "whatsapp" | "instagram" | "facebook" | "google_review";
  contact?: typeof tenantDataSchema.contacts.$inferSelect | null;
  body: string;
  templateName?: string;
  correlationId?: string;
}): Promise<{
  ok: boolean;
  mode: "live" | "sandbox" | "disconnected";
  externalMessageId: string | null;
  deliveryStatus: "sent" | "delivered";
  error?: string;
}> {
  if (params.channel === "whatsapp") {
    const creds = resolveWorkspaceChannelCredentials({
      workspaceId: params.workspaceId,
      channelKind: "whatsapp_cloud",
    });
    if (!creds.ok || !creds.accessToken) {
      return {
        ok: false,
        mode: "disconnected",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: "Connect your WhatsApp Business Account under Connected Channels first — ₹0.00 deducted.",
      };
    }

    const dataDb = tenantDataDb({ workspaceId: params.workspaceId });
    let tmplRow: typeof tenantDataSchema.whatsappTemplates.$inferSelect | undefined;
    if (params.templateName) {
      tmplRow =
        dataDb
          .select()
          .from(tenantDataSchema.whatsappTemplates)
          .where(eq(tenantDataSchema.whatsappTemplates.name, params.templateName))
          .get() ??
        dataDb
          .select()
          .from(tenantDataSchema.whatsappTemplates)
          .where(eq(tenantDataSchema.whatsappTemplates.id, params.templateName))
          .get();

      if (!tmplRow || tmplRow.approvalStatus !== "APPROVED") {
        return {
          ok: false,
          mode: creds.mode,
          externalMessageId: null,
          deliveryStatus: "sent",
          error: tmplRow
            ? `Template '${tmplRow.name}' is currently '${tmplRow.approvalStatus}'. Only Meta-approved ('APPROVED') templates can be sent — ₹0.00 deducted.`
            : `Template '${params.templateName}' was not found or is not approved — ₹0.00 deducted.`,
        };
      }

      if (creds.mode === "live" && !tmplRow.metaTemplateId) {
        return {
          ok: false,
          mode: "live",
          externalMessageId: null,
          deliveryStatus: "sent",
          error: `Template '${tmplRow.name}' has not been verified on Meta WhatsApp Manager yet — ₹0.00 deducted.`,
        };
      }
    }

    if (creds.mode === "sandbox") {
      return {
        ok: true,
        mode: "sandbox",
        externalMessageId: `wamid.sb_${newId()}`,
        deliveryStatus: "delivered",
      };
    }

    const rawPhone = params.contact?.phoneE164?.trim() || "";
    const digits = rawPhone.replace(/[^0-9]/g, "");
    const toDigits = digits.length === 10 ? `91${digits}` : digits;
    if (toDigits.length < 10) {
      return {
        ok: false,
        mode: "live",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: "Contact does not have a valid WhatsApp phone number (+91...) — ₹0.00 deducted.",
      };
    }

    const wabaPhoneAsset = controlDb()
      .select()
      .from(controlSchema.assets)
      .where(
        and(
          eq(controlSchema.assets.workspaceId, params.workspaceId),
          eq(controlSchema.assets.assetType, "waba_phone"),
          eq(controlSchema.assets.active, true)
        )
      )
      .get();

    const phoneNumberId =
      creds.metadata?.phoneNumberId ||
      wabaPhoneAsset?.externalId ||
      creds.externalAccountId ||
      "";
    if (!phoneNumberId) {
      return {
        ok: false,
        mode: "live",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: "WhatsApp Phone Number ID is missing on Connected Channels — ₹0.00 deducted.",
      };
    }

    const logsDb = tenantLogsDb({ workspaceId: params.workspaceId });
    const started = Date.now();

    let apiBody: Record<string, unknown>;
    if (params.templateName && tmplRow) {
      const bodySlotNums = Array.from(
        new Set(Array.from(tmplRow.bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])))
      ).sort((a, b) => a - b);
      let sampleVals: Record<string, string> = {};
      try {
        sampleVals = JSON.parse(tmplRow.sampleValuesJson || "{}") as Record<string, string>;
      } catch {
        sampleVals = {};
      }
      const components =
        bodySlotNums.length > 0
          ? [
              {
                type: "body",
                parameters: bodySlotNums.map((slotNum, idx) => ({
                  type: "text",
                  text:
                    idx === 0
                      ? params.contact?.name || sampleVals[String(slotNum)] || "Customer"
                      : sampleVals[String(slotNum)] || params.body.trim().slice(0, 60) || "Update",
                })),
              },
            ]
          : [];

      apiBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toDigits,
        type: "template",
        template: {
          name: tmplRow.name,
          language: { code: tmplRow.language || "en_IN" },
          ...(components.length > 0 ? { components } : {}),
        },
      };
    } else {
      apiBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toDigits,
        type: "text",
        text: {
          preview_url: true,
          body: params.body.trim(),
        },
      };
    }

    try {
      const resp = await fetch(
        `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(apiBody),
          signal: AbortSignal.timeout(10_000),
        }
      );

      logsDb
        .insert(tenantLogsSchema.providerCalls)
        .values({
          id: newEntityId("req", params.workspaceId),
          ts: Date.now(),
          provider: "whatsapp",
          operation: params.templateName ? "inbox.send_template" : "inbox.send_text",
          method: "POST",
          status: resp.status,
          latencyMs: Date.now() - started,
          correlationId: params.correlationId || newEntityId("req", params.workspaceId),
        })
        .run();

      const resBody = (await resp.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; error_user_msg?: string };
      };

      if (!resp.ok) {
        return {
          ok: false,
          mode: "live",
          externalMessageId: null,
          deliveryStatus: "sent",
          error: `WhatsApp Cloud API rejected message (HTTP ${resp.status}): ${resBody.error?.error_user_msg || resBody.error?.message || "Verify 24h window or template status."} — ₹0.00 deducted.`,
        };
      }

      const confirmedMsgId = resBody.messages?.[0]?.id?.trim();
      if (!confirmedMsgId) {
        return {
          ok: false,
          mode: "live",
          externalMessageId: null,
          deliveryStatus: "sent",
          error: "WhatsApp Cloud API did not return a confirmed message ID (wamid) — ₹0.00 deducted.",
        };
      }

      return {
        ok: true,
        mode: "live",
        externalMessageId: confirmedMsgId,
        deliveryStatus: "sent",
      };
    } catch (err) {
      return {
        ok: false,
        mode: "live",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: `${err instanceof Error ? err.message : "Network error reaching WhatsApp Cloud API."} — ₹0.00 deducted.`,
      };
    }
  }

  if (params.channel === "instagram" || params.channel === "facebook") {
    const creds = resolveWorkspaceChannelCredentials({
      workspaceId: params.workspaceId,
      channelKind: params.channel === "instagram" ? "instagram_business" : "facebook_page",
    });
    if (!creds.ok || !creds.accessToken) {
      return {
        ok: true,
        mode: "disconnected",
        externalMessageId: null,
        deliveryStatus: "delivered",
      };
    }

    if (creds.mode === "sandbox") {
      return {
        ok: true,
        mode: "sandbox",
        externalMessageId: `mid.sb_${newId()}`,
        deliveryStatus: "delivered",
      };
    }

    const scopedRecipientId =
      params.channel === "instagram"
        ? params.contact?.instagramHandle?.trim()
        : params.contact?.facebookScopedId?.trim();

    // Only call live Send API if we have a real numeric/scoped sender ID from an inbound DM
    if (!scopedRecipientId || scopedRecipientId.startsWith("@")) {
      return {
        ok: true,
        mode: "disconnected",
        externalMessageId: null,
        deliveryStatus: "delivered",
      };
    }

    const senderNode =
      params.channel === "instagram"
        ? creds.metadata?.igUserId || creds.metadata?.pageId || creds.externalAccountId
        : creds.metadata?.pageId || creds.externalAccountId;

    if (!senderNode) {
      return {
        ok: false,
        mode: "live",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: `Connected ${params.channel} account is missing Page / IG User ID.`,
      };
    }

    try {
      const resp = await fetch(
        `https://graph.facebook.com/${creds.graphVersion}/${encodeURIComponent(senderNode)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipient: { id: scopedRecipientId },
            messaging_type: "RESPONSE",
            message: { text: params.body.trim() },
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );

      const resBody = (await resp.json().catch(() => ({}))) as {
        message_id?: string;
        error?: { message?: string };
      };

      if (!resp.ok) {
        return {
          ok: false,
          mode: "live",
          externalMessageId: null,
          deliveryStatus: "sent",
          error: `Meta Messaging API rejected ${params.channel} reply (HTTP ${resp.status}): ${resBody.error?.message || "Verify 24h DM window & messaging permissions."}`,
        };
      }

      return {
        ok: true,
        mode: "live",
        externalMessageId: resBody.message_id || `mid.live_${Date.now()}`,
        deliveryStatus: "sent",
      };
    } catch (err) {
      return {
        ok: false,
        mode: "live",
        externalMessageId: null,
        deliveryStatus: "sent",
        error: err instanceof Error ? err.message : "Network error reaching Meta Messaging API.",
      };
    }
  }

  return {
    ok: true,
    mode: "disconnected",
    externalMessageId: null,
    deliveryStatus: "delivered",
  };
}

export function listContacts(workspaceId: string, limit = 200) {
  return tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.contacts)
    .orderBy(desc(tenantDataSchema.contacts.createdAt))
    .limit(limit)
    .all();
}

export function listConversationsWithContacts(
  workspaceId: string,
  statusFilter?: string,
  assignedUserIdFilter?: string
) {
  const db = tenantDataDb({ workspaceId });
  const rows = db
    .select({
      conversation: tenantDataSchema.conversations,
      contact: tenantDataSchema.contacts,
    })
    .from(tenantDataSchema.conversations)
    .innerJoin(
      tenantDataSchema.contacts,
      eq(tenantDataSchema.conversations.contactId, tenantDataSchema.contacts.id)
    )
    .orderBy(desc(tenantDataSchema.conversations.lastActivityAt))
    .limit(100)
    .all();

  return rows.filter((r) => {
    if (statusFilter && statusFilter !== "all" && r.conversation.status !== statusFilter) {
      return false;
    }
    if (assignedUserIdFilter) {
      if (assignedUserIdFilter === "unassigned") {
        return !r.conversation.assignedUserId;
      }
      return r.conversation.assignedUserId === assignedUserIdFilter;
    }
    return true;
  });
}

export function getConversationThread(workspaceId: string, conversationId: string) {
  const db = tenantDataDb({ workspaceId });
  const conv = db
    .select()
    .from(tenantDataSchema.conversations)
    .where(eq(tenantDataSchema.conversations.id, conversationId))
    .get();
  if (!conv) return null;

  const contact = db
    .select()
    .from(tenantDataSchema.contacts)
    .where(eq(tenantDataSchema.contacts.id, conv.contactId))
    .get();

  const msgs = db
    .select()
    .from(tenantDataSchema.messages)
    .where(eq(tenantDataSchema.messages.conversationId, conversationId))
    .orderBy(asc(tenantDataSchema.messages.createdAt))
    .all();

  const notes = db
    .select()
    .from(tenantDataSchema.internalNotes)
    .where(eq(tenantDataSchema.internalNotes.conversationId, conversationId))
    .orderBy(asc(tenantDataSchema.internalNotes.createdAt))
    .all();

  const attachedLabels = db
    .select({
      id: tenantDataSchema.labels.id,
      name: tenantDataSchema.labels.name,
      colorHex: tenantDataSchema.labels.colorHex,
    })
    .from(tenantDataSchema.conversationLabels)
    .innerJoin(
      tenantDataSchema.labels,
      eq(tenantDataSchema.conversationLabels.labelId, tenantDataSchema.labels.id)
    )
    .where(eq(tenantDataSchema.conversationLabels.conversationId, conversationId))
    .all();

  const now = Date.now();
  const whatsappWindowOpen =
    conv.channel !== "whatsapp" ||
    (conv.lastCustomerMessageAt !== null && now - conv.lastCustomerMessageAt < 24 * 60 * 60 * 1000);

  return {
    conversation: conv,
    contact: contact ?? null,
    messages: msgs,
    notes,
    labels: attachedLabels,
    whatsappWindowOpen,
  };
}

export function searchInboxFts(workspaceId: string, query: string): Array<{ conversationId: string; snippet: string }> {
  const cleaned = query.replace(/[^a-zA-Z0-9\s]/g, " ").trim();
  if (!cleaned) return [];
  const raw = tenantDataDb({ workspaceId }).$client;
  const terms = cleaned
    .split(/\s+/)
    .map((w) => `"${w}"*`)
    .join(" AND ");

  return raw
    .prepare(
      `SELECT DISTINCT conversation_id AS conversationId, snippet(inbox_search_fts, 3, '[', ']', '…', 12) AS snippet
       FROM inbox_search_fts
       WHERE inbox_search_fts MATCH ?
       LIMIT 25`
    )
    .all(terms) as Array<{ conversationId: string; snippet: string }>;
}

export const createContact = defineAction({
  key: "inbox.contact.created",
  permission: "inbox:reply",
  input: z.object({
    name: z.string().min(1).max(120),
    phoneE164: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    companyName: z.string().optional(),
    recordWhatsAppConsent: z.boolean().default(false),
    consentSource: z.string().default("direct_customer_entry"),
  }),
  summarize: (input) => `Added customer contact '${input.name}'`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();
    const contactId = newId("cnt", ctx.workspaceId);
    const cleanedPhone = input.phoneE164?.trim() || null;

    db.insert(tenantDataSchema.contacts)
      .values({
        id: contactId,
        name: input.name.trim(),
        phoneE164: cleanedPhone,
        email: input.email?.trim() || null,
        companyName: input.companyName?.trim() || null,
        tagsJson: "[]",
        lifetimeValuePaise: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (input.recordWhatsAppConsent && cleanedPhone) {
      db.insert(tenantDataSchema.optIns)
        .values({
          id: newId(),
          contactId,
          phoneE164: cleanedPhone,
          channel: "whatsapp",
          source: input.consentSource,
          evidenceNote: `Permission recorded when adding contact ${input.name.trim()}`,
          consentedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    return { contactId };
  },
});

export const startOrLogConversation = defineAction({
  key: "inbox.conversation.created",
  permission: "inbox:reply",
  input: z.object({
    contactId: z.string().min(10),
    channel: z.enum(["whatsapp", "instagram", "facebook", "google_review"]),
    direction: z.enum(["inbound", "outbound"]),
    body: z.string().min(1).max(4000),
    slaTargetMinutes: z.coerce.number().int().min(5).max(1440).default(30),
  }),
  summarize: (input) => `Logged ${input.direction} ${input.channel} conversation`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const contact = db
      .select()
      .from(tenantDataSchema.contacts)
      .where(eq(tenantDataSchema.contacts.id, input.contactId))
      .get();
    if (!contact) {
      throw new RslError("RSL-VAL-1001", "Selected customer contact was not found.");
    }

    let externalMessageId: string | null = null;
    let outboundDeliveryStatus: "sent" | "delivered" = "delivered";

    if (input.direction === "outbound") {
      const liveOut = await dispatchOutboundConversationMessageLive({
        workspaceId: ctx.workspaceId,
        channel: input.channel,
        contact,
        body: input.body,
        correlationId: ctx.correlationId,
      });
      if (!liveOut.ok) {
        throw new RslError("RSL-VAL-1001", liveOut.error || "Could not deliver outbound message.");
      }
      externalMessageId = liveOut.externalMessageId;
      outboundDeliveryStatus = liveOut.deliveryStatus;
    }

    const now = Date.now();
    const convId = newId("cnv", ctx.workspaceId);
    const msgId = newId("msg", ctx.workspaceId);

    db.insert(tenantDataSchema.conversations)
      .values({
        id: convId,
        contactId: contact.id,
        channel: input.channel,
        status: "open",
        unreadCount: input.direction === "inbound" ? 1 : 0,
        lastCustomerMessageAt: input.direction === "inbound" ? now : null,
        slaTargetMinutes: input.slaTargetMinutes,
        slaBreached: false,
        lastMessagePreview: input.body.slice(0, 140),
        lastActivityAt: now,
        createdAt: now,
      })
      .run();

    db.insert(tenantDataSchema.messages)
      .values({
        id: msgId,
        conversationId: convId,
        direction: input.direction,
        senderType: input.direction === "inbound" ? "customer" : "team_member",
        senderId: input.direction === "inbound" ? contact.id : ctx.actorId,
        body: input.body.trim(),
        deliveryStatus: input.direction === "inbound" ? "read" : outboundDeliveryStatus,
        externalMessageId,
        costPaise: 0,
        createdAt: now,
      })
      .run();

    db.$client
      .prepare(
        "INSERT INTO inbox_search_fts (entity_type, entity_id, conversation_id, content) VALUES (?, ?, ?, ?)"
      )
      .run("message", msgId, convId, `${contact.name} ${contact.companyName ?? ""} ${input.body.trim()}`);

    if (input.direction === "inbound") {
      void dispatchWorkspaceWebhookEvent(ctx.workspaceId, "whatsapp.message.received", {
        conversationId: convId,
        messageId: msgId,
        contactId: contact.id,
        contactName: contact.name,
        phoneE164: contact.phoneE164,
        channel: input.channel,
        body: input.body.trim(),
      }).catch(() => 0);
    }

    return { conversationId: convId, messageId: msgId };
  },
});

export const replyToConversation = defineAction({
  key: "inbox.reply.sent",
  permission: "inbox:reply",
  input: z.object({
    conversationId: z.string().min(10),
    body: z.string().min(1).max(4000),
    templateName: z.string().optional(),
  }),
  summarize: (input) => `Sent reply in conversation ${input.conversationId.slice(-6)}`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const logsDb = tenantLogsDb(ctx);
    const conv = db
      .select()
      .from(tenantDataSchema.conversations)
      .where(eq(tenantDataSchema.conversations.id, input.conversationId))
      .get();
    if (!conv) {
      throw new RslError("RSL-VAL-1001", "Conversation not found.");
    }

    const contact = db
      .select()
      .from(tenantDataSchema.contacts)
      .where(eq(tenantDataSchema.contacts.id, conv.contactId))
      .get();

    const now = Date.now();

    // Enforce WhatsApp 24-hour free-form reply window & unsubscribed check (Section 16)
    if (conv.channel === "whatsapp") {
      if (contact?.phoneE164) {
        const suppressed = logsDb
          .select()
          .from(tenantLogsSchema.suppressions)
          .where(eq(tenantLogsSchema.suppressions.identifier, contact.phoneE164))
          .get();
        if (suppressed) {
          throw new RslError("RSL-WA-1002");
        }
      }

      const windowOpen =
        conv.lastCustomerMessageAt !== null && now - conv.lastCustomerMessageAt < 24 * 60 * 60 * 1000;
      if (!windowOpen && !input.templateName) {
        throw new RslError("RSL-WA-1001");
      }
    }

    let matchedTemplate: typeof tenantDataSchema.whatsappTemplates.$inferSelect | undefined;
    if (conv.channel === "whatsapp" && input.templateName) {
      matchedTemplate =
        db
          .select()
          .from(tenantDataSchema.whatsappTemplates)
          .where(eq(tenantDataSchema.whatsappTemplates.name, input.templateName))
          .get() ??
        db
          .select()
          .from(tenantDataSchema.whatsappTemplates)
          .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateName))
          .get();
      if (!matchedTemplate || matchedTemplate.approvalStatus !== "APPROVED") {
        throw new RslError(
          "RSL-VAL-1001",
          matchedTemplate
            ? `Template '${matchedTemplate.name}' is currently '${matchedTemplate.approvalStatus}'. Select a Meta-approved ('APPROVED') template.`
            : `Template '${input.templateName}' is missing or not approved by Meta.`
        );
      }
    }

    const templateCostPaise =
      conv.channel === "whatsapp" && matchedTemplate
        ? matchedTemplate.category === "marketing"
          ? 95
          : 85
        : 0;
    if (templateCostPaise > 0 && !canDebitWalletUsage(getWalletBalancePaise(ctx.workspaceId), templateCostPaise)) {
      throw new RslError("RSL-BILL-1003");
    }

    const guardKey = `reply:${conv.id}:${Math.floor(now / 2000)}:${input.body.slice(0, 24)}`;
    const guard = reserveSendGuard({
      workspaceId: ctx.workspaceId,
      idempotencyKey: guardKey,
      channel: conv.channel,
      recipient: contact?.phoneE164 ?? contact?.email ?? conv.contactId,
    });
    if (!guard.allowed) {
      return { deduplicated: true, messageId: "" };
    }

    // Dispatch live to WhatsApp Cloud API / Instagram / Facebook Messenger BEFORE charging wallet!
    const liveOut = await dispatchOutboundConversationMessageLive({
      workspaceId: ctx.workspaceId,
      channel: conv.channel as "whatsapp" | "instagram" | "facebook" | "google_review",
      contact,
      body: input.body,
      templateName: matchedTemplate?.name ?? input.templateName,
      correlationId: ctx.correlationId,
    });

    if (!liveOut.ok) {
      markSendGuardOutcome({
        workspaceId: ctx.workspaceId,
        idempotencyKey: guardKey,
        state: "failed",
      });
      throw new RslError("RSL-VAL-1001", liveOut.error || "Provider rejected outbound reply.");
    }

    if (templateCostPaise > 0) {
      consumeUsage({
        workspaceId: ctx.workspaceId,
        serviceKey: "whatsapp.messaging",
        quantity: 1,
        unitCostPaise: templateCostPaise,
        dedupeKey: guardKey,
        description: `WhatsApp template reply '${matchedTemplate?.name ?? input.templateName}' to ${contact?.name ?? conv.contactId}`,
        actorId: ctx.actorId,
      });
    }

    const msgId = newId();
    let firstReplyTimeSec = conv.firstReplyTimeSec;
    let slaBreached = conv.slaBreached;

    if (firstReplyTimeSec === null && conv.lastCustomerMessageAt) {
      firstReplyTimeSec = Math.max(1, Math.round((now - conv.lastCustomerMessageAt) / 1000));
      slaBreached = firstReplyTimeSec > conv.slaTargetMinutes * 60;
    }

    db.insert(tenantDataSchema.messages)
      .values({
        id: msgId,
        conversationId: conv.id,
        direction: "outbound",
        senderType: input.templateName ? "template_automation" : "team_member",
        senderId: ctx.actorId,
        body: input.body.trim(),
        templateName: matchedTemplate?.name || input.templateName || null,
        deliveryStatus: liveOut.deliveryStatus,
        externalMessageId: liveOut.externalMessageId,
        costPaise: templateCostPaise,
        pricingCategory: matchedTemplate ? matchedTemplate.category : input.templateName ? "utility" : "service",
        createdAt: now,
      })
      .run();

    db.update(tenantDataSchema.conversations)
      .set({
        unreadCount: 0,
        assignedUserId: conv.assignedUserId ?? ctx.actorId,
        firstReplyTimeSec,
        slaBreached,
        lastMessagePreview: input.body.trim().slice(0, 140),
        lastActivityAt: now,
      })
      .where(eq(tenantDataSchema.conversations.id, conv.id))
      .run();

    db.$client
      .prepare(
        "INSERT INTO inbox_search_fts (entity_type, entity_id, conversation_id, content) VALUES (?, ?, ?, ?)"
      )
      .run("message", msgId, conv.id, input.body.trim());

    markSendGuardOutcome({
      workspaceId: ctx.workspaceId,
      idempotencyKey: guardKey,
      state: "confirmed",
      externalId: liveOut.externalMessageId ?? msgId,
    });

    return {
      deduplicated: false,
      messageId: msgId,
      externalMessageId: liveOut.externalMessageId,
      mode: liveOut.mode,
    };
  },
});

export const updateConversationStatus = defineAction({
  key: "inbox.status.changed",
  permission: "inbox:assign",
  input: z.object({
    conversationId: z.string().min(10),
    status: z.enum(["open", "pending", "resolved", "snoozed"]),
  }),
  summarize: (input) => `Marked conversation as '${input.status}'`,
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .update(tenantDataSchema.conversations)
      .set({ status: input.status, lastActivityAt: Date.now() })
      .where(eq(tenantDataSchema.conversations.id, input.conversationId))
      .run();
    return { updated: true };
  },
});

export const addConversationInternalNote = defineAction({
  key: "inbox.note.added",
  permission: "inbox:note",
  input: z.object({
    conversationId: z.string().min(10),
    authorName: z.string().min(1).max(100),
    body: z.string().min(1).max(2000),
  }),
  summarize: () => "Added private team note on conversation",
  handler: (ctx, input) => {
    const noteId = newId();
    tenantDataDb(ctx)
      .insert(tenantDataSchema.internalNotes)
      .values({
        id: noteId,
        conversationId: input.conversationId,
        authorUserId: ctx.actorId,
        authorName: input.authorName.trim(),
        body: input.body.trim(),
        createdAt: Date.now(),
      })
      .run();
    return { noteId };
  },
});

export function listCannedReplies(workspaceId: string) {
  return tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.cannedReplies)
    .orderBy(desc(tenantDataSchema.cannedReplies.createdAt))
    .all();
}

export const saveCannedReply = defineAction({
  key: "inbox.canned_reply.saved",
  permission: "inbox:reply",
  input: z.object({
    shortcut: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, hyphens, or underscores (e.g. bank-details)"),
    title: z.string().trim().min(2).max(80),
    body: z.string().trim().min(2).max(1500),
  }),
  summarize: (input) => `Saved quick reply '/${input.shortcut}'`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const id = newId();
    const now = Date.now();
    db.insert(tenantDataSchema.cannedReplies)
      .values({
        id,
        shortcut: input.shortcut.toLowerCase(),
        title: input.title,
        body: input.body,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.cannedReplies.shortcut,
        set: {
          title: input.title,
          body: input.body,
        },
      })
      .run();

    return { id, shortcut: input.shortcut.toLowerCase() };
  },
});

export const deleteCannedReply = defineAction({
  key: "inbox.canned_reply.saved",
  permission: "inbox:reply",
  input: z.object({
    replyId: z.string().min(6),
  }),
  summarize: () => "Removed saved quick reply",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .delete(tenantDataSchema.cannedReplies)
      .where(eq(tenantDataSchema.cannedReplies.id, input.replyId))
      .run();
    return { deleted: true };
  },
});

export function listWorkspaceLabels(workspaceId: string) {
  return tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.labels)
    .orderBy(asc(tenantDataSchema.labels.name))
    .all();
}

export const attachConversationLabel = defineAction({
  key: "inbox.label.updated",
  permission: "inbox:reply",
  input: z.object({
    conversationId: z.string().min(10),
    labelName: z.string().trim().min(2).max(36),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#0E8A56"),
  }),
  summarize: (input) => `Added label '${input.labelName}' to conversation`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const cleanName = input.labelName.trim();
    const now = Date.now();

    let label = db
      .select()
      .from(tenantDataSchema.labels)
      .where(eq(tenantDataSchema.labels.name, cleanName))
      .get();

    if (!label) {
      const labelId = newId();
      db.insert(tenantDataSchema.labels)
        .values({
          id: labelId,
          name: cleanName,
          colorHex: input.colorHex,
          createdAt: now,
        })
        .run();
      label = db
        .select()
        .from(tenantDataSchema.labels)
        .where(eq(tenantDataSchema.labels.id, labelId))
        .get()!;
    }

    db.insert(tenantDataSchema.conversationLabels)
      .values({
        conversationId: input.conversationId,
        labelId: label.id,
      })
      .onConflictDoNothing()
      .run();

    return { labelId: label.id, name: label.name };
  },
});

export const removeConversationLabel = defineAction({
  key: "inbox.label.updated",
  permission: "inbox:reply",
  input: z.object({
    conversationId: z.string().min(10),
    labelId: z.string().min(6),
  }),
  summarize: () => "Removed label from conversation",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .delete(tenantDataSchema.conversationLabels)
      .where(
        and(
          eq(tenantDataSchema.conversationLabels.conversationId, input.conversationId),
          eq(tenantDataSchema.conversationLabels.labelId, input.labelId)
        )
      )
      .run();
    return { removed: true };
  },
});

export const assignConversationToMember = defineAction({
  key: "inbox.assigned",
  permission: "inbox:assign",
  input: z.object({
    conversationId: z.string().min(10),
    assignedUserId: z.string().optional(),
  }),
  summarize: (input) =>
    input.assignedUserId ? `Assigned conversation to team member` : `Unassigned conversation`,
  handler: (ctx, input) => {
    const cleanUser = input.assignedUserId?.trim() || null;
    tenantDataDb(ctx)
      .update(tenantDataSchema.conversations)
      .set({
        assignedUserId: cleanUser,
        lastActivityAt: Date.now(),
      })
      .where(eq(tenantDataSchema.conversations.id, input.conversationId))
      .run();
    return { assignedUserId: cleanUser };
  },
});
