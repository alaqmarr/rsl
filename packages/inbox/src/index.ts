import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { canDebitWalletUsage, consumeUsage, getWalletBalancePaise } from "@rsl/billing";
import { newId, RslError } from "@rsl/core";
import { tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { reserveSendGuard, markSendGuardOutcome } from "@rsl/queue";
import { tenantDataDb, tenantLogsDb } from "@rsl/tenancy";

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
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const contact = db
      .select()
      .from(tenantDataSchema.contacts)
      .where(eq(tenantDataSchema.contacts.id, input.contactId))
      .get();
    if (!contact) {
      throw new RslError("RSL-VAL-1001", "Selected customer contact was not found.");
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
        deliveryStatus: input.direction === "inbound" ? "read" : "delivered",
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
  handler: (ctx, input) => {
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

    const templateCostPaise = conv.channel === "whatsapp" && input.templateName ? 85 : 0;
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

    if (templateCostPaise > 0) {
      consumeUsage({
        workspaceId: ctx.workspaceId,
        serviceKey: "whatsapp.messaging",
        quantity: 1,
        unitCostPaise: templateCostPaise,
        dedupeKey: guardKey,
        description: `WhatsApp template reply '${input.templateName}' to ${contact?.name ?? conv.contactId}`,
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
        templateName: input.templateName || null,
        deliveryStatus: "delivered",
        costPaise: input.templateName ? 85 : 0,
        pricingCategory: input.templateName ? "utility" : "service",
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
      externalId: msgId,
    });

    return { deduplicated: false, messageId: msgId };
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
