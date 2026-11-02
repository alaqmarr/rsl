import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  computeOutboundWebhookSignature,
  createOutboundWebhookEndpoint,
  dispatchWorkspaceWebhookEvent,
  issueApiKey,
  listOutboundWebhookEndpoints,
} from "@rsl/api-keys";
import {
  acceptWorkspaceInvitation,
  addOrInviteTeamMember,
  getInvitationPreviewByToken,
  listWorkspaceTeam,
  regenerateWorkspaceInvitationToken,
  registerUserWithWorkspace,
  resolveUserSessionFromToken,
} from "@rsl/auth";
import {
  approveWalletRechargeRequest,
  getWalletBalancePaise,
  staffRecordPlanPaymentAndActivate,
  submitWalletRechargeRequest,
} from "@rsl/billing";
import { generateOpenApiSpec } from "@rsl/docs";
import {
  assignConversationToMember,
  attachConversationLabel,
  createContact,
  getConversationThread,
  listConversationsWithContacts,
  removeConversationLabel,
  startOrLogConversation,
} from "@rsl/inbox";
import {
  deleteTallyReminderRule,
  getTallyWorkspaceSummary,
  recordTallyVoucher,
  runDueTallyReminders,
  saveTallyReminderRule,
} from "@rsl/tally";
import { GET as getAnalyticsRoute } from "../app/api/v1/analytics/route";

function setupFreshAccount(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}@rsltest.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "InitialPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Wholesale",
    stateCode: "27",
  });
  return {
    email,
    userId: reg.userId,
    workspaceId: reg.workspaceId,
    ctx: {
      workspaceId: reg.workspaceId,
      actorType: "user" as const,
      actorId: reg.userId,
      roleSlug: "owner",
      assetScope: null,
      impersonatorId: null,
      requestId: `req_test_${Date.now()}`,
      correlationId: `cor_test_${Date.now()}`,
    },
  };
}

describe("Phase 10 end-to-end features (Invite Acceptance, /api/v1/analytics, Live Webhooks, Inbox Labels & Tally Reminders)", () => {
  it("completes team invitation preview, token regeneration, and acceptance for both new and existing users", () => {
    const acct = setupFreshAccount("InviteBiz");
    const secondAcct = setupFreshAccount("SecondInviteBiz");
    const newColleagueEmail = `invitee-${Date.now()}@rsltest.in`;

    // Both workspaces send an email invite before the colleague creates their account
    const invited = addOrInviteTeamMember({
      workspaceId: acct.workspaceId,
      email: newColleagueEmail,
      roleSlug: "manager",
      invitedByUserId: acct.userId,
    });
    const existingInvite = addOrInviteTeamMember({
      workspaceId: secondAcct.workspaceId,
      email: newColleagueEmail,
      roleSlug: "agent",
      invitedByUserId: secondAcct.userId,
    });
    expect(invited.mode).toBe("invited");
    expect(invited.rawInviteToken).toBeTruthy();
    expect(existingInvite.mode).toBe("invited");
    expect(existingInvite.rawInviteToken).toBeTruthy();

    const firstToken = invited.rawInviteToken!;
    const preview1 = getInvitationPreviewByToken(firstToken);
    expect(preview1).not.toBeNull();
    expect(preview1?.email).toBe(newColleagueEmail);
    expect(preview1?.roleSlug).toBe("manager");
    expect(preview1?.existingUser).toBe(false);

    const pendingRow = listWorkspaceTeam(acct.workspaceId).invites[0]!;
    const regenerated = regenerateWorkspaceInvitationToken({
      workspaceId: acct.workspaceId,
      invitationId: pendingRow.id,
    });

    // Old token must be invalidated immediately
    expect(getInvitationPreviewByToken(firstToken)).toBeNull();
    expect(getInvitationPreviewByToken(regenerated.rawInviteToken)).not.toBeNull();

    const accepted = acceptWorkspaceInvitation({
      rawToken: regenerated.rawInviteToken,
      name: "Neha Joshi",
      password: "ColleaguePassword123!",
    });
    expect(accepted.workspaceId).toBe(acct.workspaceId);
    expect(accepted.email).toBe(newColleagueEmail);

    const sessionInfo = resolveUserSessionFromToken(accepted.rawSessionToken);
    expect(sessionInfo).not.toBeNull();
    expect(sessionInfo?.workspace.id).toBe(acct.workspaceId);
    expect(sessionInfo?.roleSlug).toBe("manager");

    // Pending invites list should now be empty while members has 2
    const afterTeam = listWorkspaceTeam(acct.workspaceId);
    expect(afterTeam.invites).toHaveLength(0);
    expect(afterTeam.members).toHaveLength(2);

    // Second pending invite now detects existingUser === true and verifies their password
    const existingPreview = getInvitationPreviewByToken(existingInvite.rawInviteToken!);
    expect(existingPreview?.existingUser).toBe(true);

    expect(() =>
      acceptWorkspaceInvitation({
        rawToken: existingInvite.rawInviteToken!,
        password: "WrongPassword999!",
      })
    ).toThrow();

    const joinedSecond = acceptWorkspaceInvitation({
      rawToken: existingInvite.rawInviteToken!,
      password: "ColleaguePassword123!",
    });
    expect(joinedSecond.workspaceId).toBe(secondAcct.workspaceId);
  });

  it("exposes GET /api/v1/analytics in OpenAPI 3.1 and enforces analytics:read scope", async () => {
    const spec = generateOpenApiSpec("http://localhost:4500");
    expect(spec.paths["/api/v1/analytics"]).toBeDefined();

    const acct = setupFreshAccount("AnalyticsApiBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "api.access",
      amountPaidPaise: 149900,
      paymentMethod: "upi",
      paymentReference: "UTRANA001",
      staffId: "stf_admin_01",
    });

    const withoutScope = await issueApiKey(acct.ctx, {
      name: "Contacts Only Key",
      mode: "live",
      scopes: ["contacts:read"],
      rateLimitPerMin: 120,
      expiresInDays: 0,
    });
    expect(withoutScope.ok).toBe(true);
    if (!withoutScope.ok) return;

    const deniedRes = await getAnalyticsRoute(
      new NextRequest("http://localhost:4500/api/v1/analytics?range=30d", {
        headers: { Authorization: `Bearer ${withoutScope.data.rawKey}` },
      })
    );
    expect(deniedRes.status).toBe(403);
    const deniedBody = (await deniedRes.json()) as { ok: boolean; error: { code: string } };
    expect(deniedBody.ok).toBe(false);
    expect(deniedBody.error.code).toBe("RSL-API-1002");

    const withScope = await issueApiKey(acct.ctx, {
      name: "BI Analytics Key",
      mode: "live",
      scopes: ["analytics:read"],
      rateLimitPerMin: 120,
      expiresInDays: 0,
    });
    expect(withScope.ok).toBe(true);
    if (!withScope.ok) return;

    const allowedRes = await getAnalyticsRoute(
      new NextRequest("http://localhost:4500/api/v1/analytics?range=30d", {
        headers: { Authorization: `Bearer ${withScope.data.rawKey}` },
      })
    );
    expect(allowedRes.status).toBe(200);
    const body = (await allowedRes.json()) as {
      ok: boolean;
      workspaceId: string;
      range: string;
      kpis: { walletBalancePaise: number };
      receivablesAging: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe(acct.workspaceId);
    expect(body.range).toBe("30d");
    expect(typeof body.kpis.walletBalancePaise).toBe("number");
    expect(Array.isArray(body.receivablesAging)).toBe(true);
  });

  it("dispatches live HMAC-SHA256 signed outbound webhooks to subscribed localhost HTTP endpoints", async () => {
    const acct = setupFreshAccount("LiveHookBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "api.access",
      amountPaidPaise: 149900,
      paymentMethod: "upi",
      paymentReference: "UTRLIVEHOOK1",
      staffId: "stf_admin_01",
    });

    const receivedRequests: Array<{
      signature: string;
      eventHeader: string;
      rawBody: string;
    }> = [];

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedRequests.push({
          signature: String(req.headers["x-rsl-signature"] || ""),
          eventHeader: String(req.headers["x-rsl-event"] || ""),
          rawBody: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));

    try {
      const port = (server.address() as AddressInfo).port;
      const endpointRes = await createOutboundWebhookEndpoint(acct.ctx, {
        name: "Local ERP Receiver",
        targetUrl: `http://127.0.0.1:${port}/webhook`,
        events: ["tally.bill.created"],
      });
      expect(endpointRes.ok).toBe(true);
      if (!endpointRes.ok) return;

      // Unsubscribed event should not fire
      const skipped = await dispatchWorkspaceWebhookEvent(acct.workspaceId, "review.created", {
        rating: 5,
      });
      expect(skipped).toBe(0);
      expect(receivedRequests).toHaveLength(0);

      // Subscribed event fires and verifies HMAC-SHA256 signature
      const delivered = await dispatchWorkspaceWebhookEvent(
        acct.workspaceId,
        "tally.bill.created",
        {
          voucherNumber: "GST/26-27/901",
          amountPaise: 185000,
        }
      );
      expect(delivered).toBe(1);
      expect(receivedRequests).toHaveLength(1);

      const captured = receivedRequests[0]!;
      expect(captured.eventHeader).toBe("tally.bill.created");
      const tsMatch = /^t=(\d+),v1=([0-9a-f]+)$/.exec(captured.signature);
      expect(tsMatch).not.toBeNull();
      const tsNum = Number(tsMatch![1]);
      expect(
        computeOutboundWebhookSignature(endpointRes.data.signingSecret, tsNum, captured.rawBody)
      ).toBe(captured.signature);

      const savedEndpoint = listOutboundWebhookEndpoints(acct.workspaceId)[0]!;
      expect(savedEndpoint.lastDeliveryStatus).toBe("HTTP 200 OK");
      expect(savedEndpoint.lastDeliveredAt).not.toBeNull();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("manages inbox labels & staff assignment and runs due-date Tally payment reminders with deduplication", async () => {
    const acct = setupFreshAccount("InboxAndRemindersBiz");

    // Add colleague for assignment test
    addOrInviteTeamMember({
      workspaceId: acct.workspaceId,
      email: `agent-${Date.now()}@rsltest.in`,
      name: "Amit Verma",
      roleSlug: "agent",
      invitedByUserId: acct.userId,
      initialPassword: "AgentPassword123!",
    });
    const colleague = listWorkspaceTeam(acct.workspaceId).members.find(
      (m) => m.userId !== acct.userId
    )!;

    // Unlock inbox + tally.sync + tally.invoicing and fund wallet
    for (const key of ["inbox", "tally.sync", "tally.invoicing"]) {
      staffRecordPlanPaymentAndActivate({
        workspaceId: acct.workspaceId,
        serviceKey: key,
        amountPaidPaise: 99900,
        paymentMethod: "upi",
        paymentReference: `UTR_${key}`,
        staffId: "stf_admin_01",
      });
    }
    const topup = submitWalletRechargeRequest({
      workspaceId: acct.workspaceId,
      amountPaise: 50000,
      utrOrReference: "UTRWAL_REM",
      paymentMethod: "upi",
    });
    approveWalletRechargeRequest({ paymentId: topup.paymentId, staffId: "stf_admin_01" });

    // 1. Inbox labels & assignment
    const contactRes = await createContact(acct.ctx, {
      name: "Mehta Electricals",
      phoneE164: "+919820044556",
      recordWhatsAppConsent: true,
      consentSource: "direct_customer_entry",
    });
    expect(contactRes.ok).toBe(true);
    if (!contactRes.ok) return;

    const convRes = await startOrLogConversation(acct.ctx, {
      contactId: contactRes.data.contactId,
      channel: "whatsapp",
      direction: "inbound",
      body: "Please share our pending statement.",
      slaTargetMinutes: 30,
    });
    expect(convRes.ok).toBe(true);
    if (!convRes.ok) return;

    // Wait grab conversationId via listConversationsWithContacts
    const convId = listConversationsWithContacts(acct.workspaceId)[0]!.conversation.id;

    const lbl1 = await attachConversationLabel(acct.ctx, {
      conversationId: convId,
      labelName: "Payment Follow-Up",
      colorHex: "#0E8A56",
    });
    const lbl2 = await attachConversationLabel(acct.ctx, {
      conversationId: convId,
      labelName: "VIP Wholesale",
      colorHex: "#0284C7",
    });
    expect(lbl1.ok).toBe(true);
    expect(lbl2.ok).toBe(true);
    if (!lbl1.ok) return;

    const threadWithLabels = getConversationThread(acct.workspaceId, convId)!;
    expect(threadWithLabels.labels).toHaveLength(2);

    await removeConversationLabel(acct.ctx, {
      conversationId: convId,
      labelId: lbl1.data.labelId,
    });
    expect(getConversationThread(acct.workspaceId, convId)?.labels).toHaveLength(1);

    const assigned = await assignConversationToMember(acct.ctx, {
      conversationId: convId,
      assignedUserId: colleague.userId,
    });
    expect(assigned.ok).toBe(true);
    expect(listConversationsWithContacts(acct.workspaceId, "all", colleague.userId)).toHaveLength(1);
    expect(listConversationsWithContacts(acct.workspaceId, "all", "unassigned")).toHaveLength(0);

    // 2. Tally overdue payment reminder schedule runner
    const tenDaysAgoIso = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const twentyDaysAgoIso = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);

    const billRes = await recordTallyVoucher(acct.ctx, {
      companyName: "InboxAndRemindersBiz Enterprises",
      voucherNumber: "INV-OVERDUE-101",
      voucherType: "Sales",
      partyName: "Mehta Electricals",
      partyPhoneE164: "+919820044556",
      amountRupees: 12500,
      paidAmountRupees: 0,
      voucherDateIso: twentyDaysAgoIso,
      dueDateIso: tenDaysAgoIso,
    });
    expect(billRes.ok).toBe(true);

    const ruleRes = await saveTallyReminderRule(acct.ctx, {
      name: "7 Days Overdue Follow-Up",
      triggerDaysOffset: 7,
      templateName: "tally_overdue_bill_reminder",
      maxRemindersPerBill: 2,
    });
    expect(ruleRes.ok).toBe(true);

    const walletBefore = getWalletBalancePaise(acct.workspaceId);
    const run1 = await runDueTallyReminders(acct.ctx, { ignoreQuietHours: true });
    expect(run1.ok).toBe(true);
    if (!run1.ok) return;
    expect(run1.data.sentCount).toBe(1);
    expect(getWalletBalancePaise(acct.workspaceId)).toBe(walletBefore - 85);

    const voucherAfter = getTallyWorkspaceSummary(acct.workspaceId).vouchers[0]!;
    expect(voucherAfter.remindersSentCount).toBe(1);

    // Running again on the same day for the same rule is deduplicated
    const run2 = await runDueTallyReminders(acct.ctx, { ignoreQuietHours: true });
    expect(run2.ok).toBe(true);
    if (!run2.ok) return;
    expect(run2.data.sentCount).toBe(0);

    // Delete reminder rule
    const ruleId = getTallyWorkspaceSummary(acct.workspaceId).rules[0]!.id;
    const deletedRule = await deleteTallyReminderRule(acct.ctx, { ruleId });
    expect(deletedRule.ok).toBe(true);
    expect(getTallyWorkspaceSummary(acct.workspaceId).rules).toHaveLength(0);
  });
});
