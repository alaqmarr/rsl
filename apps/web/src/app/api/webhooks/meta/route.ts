import crypto from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import {
  isValidMetaWebhookVerifyToken,
  resolveWorkspaceChannelCredentials,
} from "@rsl/connections";
import { newEntityId, newId, verifyHmac } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema } from "@rsl/database";
import { controlDb, getPlatformMetaAppConfig, ingressDb, tenantDataDb } from "@rsl/tenancy";

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
  const signatureValid =
    Boolean(metaSecret) && /^[0-9a-f]{64}$/i.test(sigHex)
      ? verifyHmac(rawBody, sigHex, metaSecret)
      : false;

  // Reject unauthenticated payloads in memory BEFORE touching ingress.db (P2-08 / SEC-09)
  if (!signatureValid) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  const eventId = `meta_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;
  ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: newId(),
      provider: "meta",
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

      const dataDb = tenantDataDb({ workspaceId: routed });
      const now = Date.now();

      // 1. Handle Messenger & Instagram Direct Messages
      for (const evt of entry.messaging ?? []) {
        if (evt.message?.is_echo) continue;
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
            externalMessageId: evt.message?.mid ?? null,
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

      // 2. Handle Instant Lead Ads (field === "leadgen")
      for (const ch of entry.changes ?? []) {
        if (ch.field !== "leadgen" || !ch.value) continue;
        const leadgenId = ch.value.leadgen_id?.trim() || "";
        let adId = ch.value.ad_id?.trim() || "";
        let campaignExtId = ch.value.campaign_id?.trim() || "";
        let fieldData: MetaLeadFieldItem[] = Array.isArray(ch.value.field_data)
          ? ch.value.field_data
          : [];

        // Fetch full lead form answers from Graph API when Meta sends leadgen_id pointer
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
              const leadResp = await fetch(
                `https://graph.facebook.com/${activeCreds.graphVersion}/${encodeURIComponent(leadgenId)}?fields=created_time,field_data,ad_id,campaign_id,form_id`,
                {
                  headers: { Authorization: `Bearer ${activeCreds.accessToken}` },
                  signal: AbortSignal.timeout(8000),
                }
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
            externalMessageId: leadgenId ? `leadgen:${leadgenId}` : null,
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

        // Increment attributed conversions on the matching Meta Ad Campaign if synced!
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

        void dispatchWorkspaceWebhookEvent(routed, "whatsapp.message.received", {
          type: "meta_leadgen",
          leadgenId,
          contactId: contact.id,
          conversationId: conv.id,
          name: fullName,
          phoneE164,
          email,
        }).catch(() => 0);
      }
    }
  } catch {
    // Raw event already stored in ingress.db
  }

  return NextResponse.json({ ok: true });
}
