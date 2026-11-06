import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueApiKey } from "@rsl/api-keys";
import { registerUserWithWorkspace, resolveUserSessionFromToken } from "@rsl/auth";
import {
  creditWallet,
  getWalletBalancePaise,
  staffGrantFreeAllToolsAccess,
} from "@rsl/billing";
import { linkExternalConnection } from "@rsl/connections";
import { signHmac } from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { generateSmartReviewDraft, recordGoogleReview } from "@rsl/google";
import {
  createContact,
  replyToConversation,
  startOrLogConversation,
} from "@rsl/inbox";
import {
  createTallyAutomationRule,
  recordTallyVoucher,
  runDueTallyReminders,
  saveTallyReminderRule,
  sendTallyBillOnWhatsApp,
} from "@rsl/tally";
import {
  clearPlatformCredentialOverride,
  savePlatformMetaAppConfig,
  tenantDataDb,
} from "@rsl/tenancy";
import {
  createWhatsAppTemplate,
  executeWhatsAppTemplateSend,
  getWhatsAppWorkspaceData,
  installStarterTallyTemplates,
  launchWhatsAppBroadcast,
  submitWhatsAppTemplateToMeta,
} from "@rsl/whatsapp";
import { POST as apiSendTemplatePost } from "../app/api/v1/whatsapp/send-template/route";
import { POST as whatsappWebhookPost } from "../app/api/webhooks/whatsapp/route";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Traders Pvt Ltd`,
    industry: "Wholesale Distribution",
    stateCode: "27",
  });
  staffGrantFreeAllToolsAccess({
    workspaceId: reg.workspaceId,
    durationDays: 30,
    staffId: "stf_test_p31",
    note: "Phase 31 strict WhatsApp template & zero-error billing test",
  });
  creditWallet({
    workspaceId: reg.workspaceId,
    amountPaise: 50_000, // ₹500.00 starting wallet balance
    entryType: "credit",
    description: "Initial Phase 31 wallet funding",
    idempotencyKey: `init_wal_p31_${reg.workspaceId}`,
    actorId: reg.userId,
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { reg, session, workspaceId: reg.workspaceId };
}

describe("Phase 31 Suite — Strict Meta-Approved WhatsApp Templates, Post-Send-Only Wallet Deduction & Zero-Error / Failed-Webhook Refunds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearPlatformCredentialOverride("meta_app");
  });

  it("never fake-approves templates on disconnected workspaces, blocks unapproved templates in automations, and deducts ₹0.00 when disconnected", async () => {
    const { session, workspaceId } = createTestWorkspace("DisconnectedStrict");
    const initialWallet = getWalletBalancePaise(workspaceId);
    expect(initialWallet).toBe(50_000);

    // 1. Installing starter templates while disconnected saves them as DRAFT (never APPROVED!)
    const starterRes = await installStarterTallyTemplates(session.ctx, {});
    expect(starterRes.ok).toBe(true);
    if (!starterRes.ok) return;
    expect(starterRes.data.installed).toBe(4);
    expect(starterRes.data.approvedCount).toBe(0);
    expect(starterRes.data.draftCount).toBe(4);

    const waData = getWhatsAppWorkspaceData(workspaceId);
    expect(waData.templates.every((t) => t.approvalStatus === "DRAFT" && t.metaTemplateId === null)).toBe(true);

    // 2. Creating a custom template while disconnected also saves as DRAFT
    const customRes = await createWhatsAppTemplate(session.ctx, {
      name: "custom_bill_notice",
      category: "utility",
      language: "en_IN",
      headerType: "TEXT",
      headerText: "Invoice Alert",
      bodyText: "Namaste {{1}}, your invoice #{{2}} for {{3}} is ready.",
      submitToMeta: true,
    });
    expect(customRes.ok).toBe(true);
    if (!customRes.ok) return;
    expect(customRes.data.approvalStatus).toBe("DRAFT");
    expect(customRes.data.metaTemplateId).toBeNull();

    // 3. Tally automation rules & overdue reminder rules strictly reject DRAFT templates
    const draftTmpl = waData.templates[0]!;
    const autoRuleRes = await createTallyAutomationRule(session.ctx, {
      name: "Should Reject Draft Template",
      triggerEvent: "Sales",
      templateId: draftTmpl.id,
      minAmountRupees: 0,
      delaySeconds: 0,
    });
    expect(autoRuleRes.ok).toBe(false);

    const remRuleRes = await saveTallyReminderRule(session.ctx, {
      name: "Should Reject Draft Reminder",
      triggerDaysOffset: 3,
      templateName: draftTmpl.name,
      maxRemindersPerBill: 2,
    });
    expect(remRuleRes.ok).toBe(false);

    // 4. Attempting to send a Tally bill, automation, broadcast, REST API call, or Inbox reply while disconnected deducts ₹0.00!
    const billRes = await recordTallyVoucher(session.ctx, {
      voucherNumber: "INV-DISC-01",
      voucherType: "Sales",
      partyName: "disconnected Party",
      partyPhoneE164: "+919820011223",
      amountRupees: 5400,
      paidAmountRupees: 0,
      voucherDateIso: new Date().toISOString().slice(0, 10),
    });
    expect(billRes.ok).toBe(true);
    if (!billRes.ok) return;

    const sendBillRes = await sendTallyBillOnWhatsApp(session.ctx, {
      voucherId: billRes.data.voucherId,
      sendKind: "invoice",
    });
    expect(sendBillRes.ok).toBe(false);

    const directExec = await executeWhatsAppTemplateSend({
      workspaceId,
      templateIdOrName: draftTmpl.id,
      recipientPhone: "+919820011223",
      variables: { "1": "Party", "2": "INV-DISC-01", "3": "₹5,400", "4": "Today" },
      idempotencyKey: "disc_exec_01",
      actorId: session.user.id,
    });
    expect(directExec.sent).toBe(false);

    const contactRes = await createContact(session.ctx, {
      name: "Opted Customer",
      phoneE164: "+919820011223",
      recordWhatsAppConsent: true,
    });
    expect(contactRes.ok).toBe(true);
    if (!contactRes.ok) return;

    const inboundConv = await startOrLogConversation(session.ctx, {
      contactId: contactRes.data.contactId,
      channel: "whatsapp",
      direction: "inbound",
      body: "Hello, share invoice please",
    });
    expect(inboundConv.ok).toBe(true);
    if (!inboundConv.ok) return;

    const replyRes = await replyToConversation(session.ctx, {
      conversationId: inboundConv.data.conversationId,
      body: "Sharing invoice",
      templateName: draftTmpl.name,
    });
    expect(replyRes.ok).toBe(false);

    const apiKeyRes = await issueApiKey(session.ctx, {
      name: "P31 WA Key",
      mode: "live",
      scopes: ["whatsapp:write"],
    });
    expect(apiKeyRes.ok).toBe(true);
    if (!apiKeyRes.ok) return;

    const apiResp = await apiSendTemplatePost(
      new NextRequest("https://app.rapidshiftlabs.in/api/v1/whatsapp/send-template", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeyRes.data.rawKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          templateName: draftTmpl.name,
          recipientPhone: "+919820011223",
        }),
      })
    );
    expect(apiResp.status).toBe(400);

    // Wallet must remain 100% untouched!
    expect(getWalletBalancePaise(workspaceId)).toBe(initialWallet);
  });

  it("enforces PENDING -> Meta webhook APPROVED lifecycle, deducts strictly AFTER Meta returns wamid, deducts ₹0 on HTTP/network errors, and auto-refunds async 'failed' webhooks", async () => {
    const appSecret = "meta_secret_phase31_strict_wa";
    savePlatformMetaAppConfig({
      appId: "998877665544",
      appSecret,
      webhookVerifyToken: "verify_p31",
      graphVersion: "v21.0",
      staffId: "stf_test_p31",
    });

    const { session, workspaceId } = createTestWorkspace("LiveStrictBilling");
    const startBalance = getWalletBalancePaise(workspaceId);
    expect(startBalance).toBe(50_000);

    await linkExternalConnection(session.ctx, {
      provider: "whatsapp",
      assetType: "waba_phone",
      displayName: "Live Verified WABA",
      externalAccountId: "phone_live_3100",
      accessToken: "EAALiveProductionTokenPhase31_XYZ987654321",
      scopesGranted: ["whatsapp_business_management", "whatsapp_business_messaging"],
      metadata: {
        channelKind: "whatsapp_cloud",
        wabaId: "waba_live_3100",
        phoneNumberId: "phone_live_3100",
      },
    });

    // Save a draft first, then submit it to Meta -> Meta returns PENDING
    const draftRes = await createWhatsAppTemplate(session.ctx, {
      name: "tally_strict_invoice_v1",
      category: "utility",
      language: "en_IN",
      headerType: "TEXT",
      headerText: "Tax Invoice Ready",
      bodyText: "Namaste {{1}}, Invoice #{{2}} for {{3}} (due {{4}}) is ready.",
      submitToMeta: false,
    });
    expect(draftRes.ok).toBe(true);
    if (!draftRes.ok) return;
    expect(draftRes.data.approvalStatus).toBe("DRAFT");

    let sendModeSimulation: "http_400" | "network_throw" | "missing_wamid" | "ok_live" = "http_400";
    let balanceObservedInsideFetch: number | null = null;
    let wamidSeq = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/waba_live_3100/message_templates")) {
        return new Response(
          JSON.stringify({ id: "meta_tmpl_id_778899", status: "PENDING" }),
          { status: 200 }
        );
      }

      if (url.includes("/phone_live_3100/messages")) {
        // Capture wallet balance AT THE MOMENT Meta's API is called — must NOT be deducted yet!
        balanceObservedInsideFetch = getWalletBalancePaise(workspaceId);

        if (sendModeSimulation === "network_throw") {
          throw new Error("ECONNRESET simulated network drop");
        }
        if (sendModeSimulation === "http_400") {
          return new Response(
            JSON.stringify({
              error: { message: "(#132001) Template name does not exist in the translation" },
            }),
            { status: 400 }
          );
        }
        if (sendModeSimulation === "missing_wamid") {
          return new Response(JSON.stringify({ messaging_product: "whatsapp" }), { status: 200 });
        }

        wamidSeq++;
        return new Response(
          JSON.stringify({ messages: [{ id: `wamid.live_p31_${wamidSeq}` }] }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // 1. Submit draft template to Meta -> becomes PENDING
    const submitRes = await submitWhatsAppTemplateToMeta(session.ctx, {
      templateId: draftRes.data.templateId,
    });
    expect(submitRes.ok).toBe(true);
    if (!submitRes.ok) return;
    expect(submitRes.data.approvalStatus).toBe("PENDING");
    expect(submitRes.data.metaTemplateId).toBe("meta_tmpl_id_778899");

    // 2. PENDING template MUST STILL BE BLOCKED from Tally automation rules & sends!
    const pendingRuleAttempt = await createTallyAutomationRule(session.ctx, {
      name: "Blocked While Pending",
      triggerEvent: "Sales",
      templateId: draftRes.data.templateId,
      minAmountRupees: 0,
      delaySeconds: 0,
    });
    expect(pendingRuleAttempt.ok).toBe(false);

    const pendingSendAttempt = await executeWhatsAppTemplateSend({
      workspaceId,
      templateIdOrName: "tally_strict_invoice_v1",
      recipientPhone: "+919820055511",
      variables: { "1": "Shree Traders", "2": "INV-31", "3": "₹9,000", "4": "20 Nov 2026" },
      idempotencyKey: "pending_send_attempt_1",
      actorId: session.user.id,
    });
    expect(pendingSendAttempt.sent).toBe(false);
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    // 3. Meta sends real-time `message_template_status_update` webhook -> upgrades to APPROVED!
    const tmplApproveWebhook = JSON.stringify({
      entry: [
        {
          id: "waba_live_3100",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "meta_tmpl_id_778899",
                message_template_name: "tally_strict_invoice_v1",
                reason: "NONE",
              },
            },
          ],
        },
      ],
    });
    const tmplApproveSig = `sha256=${signHmac(tmplApproveWebhook, appSecret)}`;
    const webhookApproveResp = await whatsappWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": tmplApproveSig },
        body: tmplApproveWebhook,
      })
    );
    expect(webhookApproveResp.status).toBe(200);

    const updatedTmpl = getWhatsAppWorkspaceData(workspaceId).templates.find(
      (t) => t.id === draftRes.data.templateId
    )!;
    expect(updatedTmpl.approvalStatus).toBe("APPROVED");

    // Now Tally automation & reminder rules succeed!
    const approvedRuleRes = await createTallyAutomationRule(session.ctx, {
      name: "Approved Sales Invoice Rule",
      triggerEvent: "Sales",
      templateId: draftRes.data.templateId,
      minAmountRupees: 0,
      delaySeconds: 0,
    });
    expect(approvedRuleRes.ok).toBe(true);

    const tenDaysAgoIso = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const fiveDaysAgoIso = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const voucherRes = await recordTallyVoucher(session.ctx, {
      voucherNumber: "INV-LIVE-3101",
      voucherType: "Sales",
      partyName: "Patel Hardware",
      partyPhoneE164: "+919820055511",
      amountRupees: 9000,
      paidAmountRupees: 0,
      voucherDateIso: tenDaysAgoIso,
      dueDateIso: fiveDaysAgoIso,
    });
    expect(voucherRes.ok).toBe(true);
    if (!voucherRes.ok) return;

    await saveTallyReminderRule(session.ctx, {
      name: "Overdue 3 Days",
      triggerDaysOffset: 3,
      templateName: "tally_strict_invoice_v1",
      maxRemindersPerBill: 3,
    });

    // 4. Test ALL 3 provider error modes -> ZERO wallet deduction!
    // 4a) Meta HTTP 400 error
    sendModeSimulation = "http_400";
    const err400Send = await sendTallyBillOnWhatsApp(session.ctx, {
      voucherId: voucherRes.data.voucherId,
      sendKind: "invoice",
      templateName: "tally_strict_invoice_v1",
    });
    expect(err400Send.ok).toBe(false);
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    // 4b) Network timeout / ECONNRESET during overdue reminder sweep
    sendModeSimulation = "network_throw";
    const netErrSweep = await runDueTallyReminders(session.ctx, { ignoreQuietHours: true });
    expect(netErrSweep.ok).toBe(true);
    if (netErrSweep.ok) {
      expect(netErrSweep.data.sentCount).toBe(0);
    }
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    // 4c) Missing wamid in 200 response
    sendModeSimulation = "missing_wamid";
    const missingWamidExec = await executeWhatsAppTemplateSend({
      workspaceId,
      templateIdOrName: "tally_strict_invoice_v1",
      recipientPhone: "+919820055511",
      variables: { "1": "Patel Hardware", "2": "INV-LIVE-3101", "3": "₹9,000", "4": fiveDaysAgoIso },
      idempotencyKey: "missing_wamid_key_1",
      actorId: session.user.id,
    });
    expect(missingWamidExec.sent).toBe(false);
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    // 5. Now Meta accepts the message (HTTP 200 + valid wamid) -> wallet deducted ONLY AFTER send!
    sendModeSimulation = "ok_live";
    balanceObservedInsideFetch = null;
    const liveOkExec = await executeWhatsAppTemplateSend({
      workspaceId,
      templateIdOrName: "tally_strict_invoice_v1",
      recipientPhone: "+919820055511",
      recipientName: "Patel Hardware",
      variables: { "1": "Patel Hardware", "2": "INV-LIVE-3101", "3": "₹9,000", "4": fiveDaysAgoIso },
      idempotencyKey: "live_ok_key_1",
      actorId: session.user.id,
    });
    expect(liveOkExec.sent).toBe(true);
    expect(liveOkExec.externalMessageId).toBe("wamid.live_p31_1");
    // Prove wallet was STILL untouched while `fetch` was in flight, and deducted only AFTER Meta returned 200!
    expect(balanceObservedInsideFetch).toBe(startBalance);
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance - 85);

    // 6. Async Meta `statuses[]` webhook arrives later with `status: "failed"` -> automatic ₹0.85 refund!
    const failedStatusWebhook = JSON.stringify({
      entry: [
        {
          id: "waba_live_3100",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone_live_3100" },
                statuses: [
                  {
                    id: "wamid.live_p31_1",
                    status: "failed",
                    recipient_id: "919820055511",
                    errors: [
                      {
                        code: 131026,
                        title: "Message undeliverable",
                        message: "Recipient phone number is not registered on WhatsApp",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const failedSig = `sha256=${signHmac(failedStatusWebhook, appSecret)}`;
    const failHookResp1 = await whatsappWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": failedSig },
        body: failedStatusWebhook,
      })
    );
    expect(failHookResp1.status).toBe(200);

    // Wallet MUST be refunded right back to `startBalance` (₹0 net deduction)!
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    // Replaying the exact same failed webhook must be 100% idempotent (no double refund!)
    const failHookResp2 = await whatsappWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": failedSig },
        body: failedStatusWebhook,
      })
    );
    expect(failHookResp2.status).toBe(200);
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance);

    const db = tenantDataDb({ workspaceId });
    const refundedMsg = db
      .select()
      .from(tenantDataSchema.messages)
      .all()
      .find((m) => m.externalMessageId === "wamid.live_p31_1")!;
    expect(refundedMsg.deliveryStatus).toBe("failed");
    expect(refundedMsg.costPaise).toBe(0);

    // 7. Broadcast partial failure test: 2 recipients, 1st succeeds & 2nd fails at Meta HTTP 500 -> ONLY 1st is charged!
    await createContact(session.ctx, {
      name: "Broadcast Good Recipient",
      phoneE164: "+919820077701",
      recordWhatsAppConsent: true,
    });
    await createContact(session.ctx, {
      name: "Broadcast Error Recipient",
      phoneE164: "+919820077702",
      recordWhatsAppConsent: true,
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/phone_live_3100/messages")) {
        const bodyObj = JSON.parse(String(init?.body || "{}")) as { to?: string };
        if (bodyObj.to === "919820077702") {
          return new Response(JSON.stringify({ error: { message: "Rate limit hit" } }), {
            status: 500,
          });
        }
        return new Response(JSON.stringify({ messages: [{ id: "wamid.bcast_ok_1" }] }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const bcastRes = await launchWhatsAppBroadcast(session.ctx, {
      name: "Partial Failure Broadcast",
      templateId: draftRes.data.templateId,
    });
    expect(bcastRes.ok).toBe(true);
    if (!bcastRes.ok) return;

    // Only 1 message succeeded -> wallet charged strictly 85 paise (NOT 170 paise!)
    expect(getWalletBalancePaise(workspaceId)).toBe(startBalance - 85);
    const bcastRow = db
      .select()
      .from(tenantDataSchema.broadcasts)
      .all()
      .find((b) => b.id === bcastRes.data.broadcastId)!;
    expect(bcastRow.sentCount).toBe(1);
    expect(bcastRow.failedCount).toBe(1);
    expect(bcastRow.actualCostPaise).toBe(85);

    // 8. Verify Google Review smart draft also charges after draft persistence
    const revRes = await recordGoogleReview(session.ctx, {
      locationName: "Main Branch",
      reviewerName: "AnilDeshmukh",
      rating: 5,
      comment: "Fast GST dispatch and clean ledger statements!",
    });
    expect(revRes.ok).toBe(true);
    if (revRes.ok) {
      const beforeDraftBal = getWalletBalancePaise(workspaceId);
      const draftReply = await generateSmartReviewDraft(session.ctx, {
        reviewId: revRes.data.reviewId,
      });
      expect(draftReply.ok).toBe(true);
      expect(getWalletBalancePaise(workspaceId)).toBe(beforeDraftBal - 100);
    }
  });
});
