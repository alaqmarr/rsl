import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeOutboundWebhookSignature,
  createOutboundWebhookEndpoint,
  deleteOutboundWebhookEndpoint,
  listOutboundWebhookEndpoints,
} from "@rsl/api-keys";
import {
  addOrInviteTeamMember,
  changeAuthenticatedUserPassword,
  listWorkspaceTeam,
  registerUserWithWorkspace,
  removeWorkspaceMember,
  signInUser,
  updateWorkspaceMemberRole,
} from "@rsl/auth";
import {
  approveWalletRechargeRequest,
  getWalletBalancePaise,
  staffRecordPlanPaymentAndActivate,
  submitWalletRechargeRequest,
} from "@rsl/billing";
import {
  generateSmartReviewDraft,
  listGoogleReviews,
  recordGoogleReview,
  replyToGoogleReview,
} from "@rsl/google";
import { deleteCannedReply, listCannedReplies, saveCannedReply } from "@rsl/inbox";
import {
  addWhatsAppUnsubscribedNumber,
  getWhatsAppWorkspaceData,
  removeWhatsAppUnsubscribedNumber,
} from "@rsl/whatsapp";

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

describe("Phase 9 end-to-end features (Smart Review Drafts, Signed Webhooks, Team & Quick Replies)", () => {
  it("gates Smart Review Reply Drafts behind google.autoreply, meters ₹1.00, and requires explicit owner approval", async () => {
    const acct = setupFreshAccount("ReviewBiz");

    // Unlock base google.reviews only (not google.autoreply yet)
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "google.reviews",
      amountPaidPaise: 59900,
      paymentMethod: "upi",
      paymentReference: "UTRREV001",
      staffId: "stf_admin_01",
    });

    const recorded = await recordGoogleReview(acct.ctx, {
      locationName: "Andheri Showroom",
      reviewerName: "Rohan Kulkarni",
      rating: 5,
      comment: "Very polite staff and timely delivery of hardware items!",
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    // Attempting smart draft before google.autoreply is unlocked must fail with entitlement error
    const deniedDraft = await generateSmartReviewDraft(acct.ctx, {
      reviewId: recorded.data.reviewId,
    });
    expect(deniedDraft.ok).toBe(false);

    // Unlock google.autoreply via verified staff payment + fund wallet with ₹500
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "google.autoreply",
      amountPaidPaise: 39900,
      paymentMethod: "upi",
      paymentReference: "UTRREV002",
      staffId: "stf_admin_01",
    });
    const topup = submitWalletRechargeRequest({
      workspaceId: acct.workspaceId,
      amountPaise: 50000,
      utrOrReference: "UTRWAL001",
      paymentMethod: "upi",
    });
    approveWalletRechargeRequest({ paymentId: topup.paymentId, staffId: "stf_admin_01" });
    expect(getWalletBalancePaise(acct.workspaceId)).toBe(50000);

    // Generate smart draft -> deducts ₹1.00 (100 paise) and sets status to draft_ready (NOT replied yet!)
    const drafted = await generateSmartReviewDraft(acct.ctx, {
      reviewId: recorded.data.reviewId,
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.data.draftText).toContain("Rohan");
    expect(getWalletBalancePaise(acct.workspaceId)).toBe(49900);

    const afterDraft = listGoogleReviews(acct.workspaceId)[0]!;
    expect(afterDraft.replyStatus).toBe("draft_ready");
    expect(afterDraft.repliedAt).toBeNull();

    // Owner approves and publishes reply
    const published = await replyToGoogleReview(acct.ctx, {
      reviewId: recorded.data.reviewId,
      replyText: drafted.data.draftText,
    });
    expect(published.ok).toBe(true);
    const afterPublish = listGoogleReviews(acct.workspaceId)[0]!;
    expect(afterPublish.replyStatus).toBe("replied");
    expect(afterPublish.repliedAt).not.toBeNull();
  });

  it("manages outbound signed webhook endpoints and produces valid HMAC-SHA256 X-RSL-Signature headers", async () => {
    const acct = setupFreshAccount("WebhookBiz");

    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "api.access",
      amountPaidPaise: 149900,
      paymentMethod: "bank_transfer",
      paymentReference: "NEFTAPI001",
      staffId: "stf_admin_01",
    });

    // Reject insecure non-localhost HTTP URLs
    const badHttp = await createOutboundWebhookEndpoint(acct.ctx, {
      name: "Insecure Hook",
      targetUrl: "http://example.com/hook",
      events: ["tally.bill.created"],
    });
    expect(badHttp.ok).toBe(false);

    const created = await createOutboundWebhookEndpoint(acct.ctx, {
      name: "ERP Sync Hook",
      targetUrl: "https://erp.example.com/webhooks/rsl",
      events: ["tally.bill.created", "whatsapp.message.received"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.signingSecret.startsWith("whsec_")).toBe(true);

    const body = JSON.stringify({ event: "tally.bill.created", voucherNumber: "INV-01" });
    const ts = 1762000000000;
    const sigHeader = computeOutboundWebhookSignature(created.data.signingSecret, ts, body);
    const expectedHmac = crypto
      .createHmac("sha256", created.data.signingSecret)
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(sigHeader).toBe(`t=${ts},v1=${expectedHmac}`);

    expect(listOutboundWebhookEndpoints(acct.workspaceId)).toHaveLength(1);

    const removed = await deleteOutboundWebhookEndpoint(acct.ctx, {
      endpointId: created.data.id,
    });
    expect(removed.ok).toBe(true);
    expect(listOutboundWebhookEndpoints(acct.workspaceId)).toHaveLength(0);
  });

  it("supports team role updates, member removal, primary owner protection, and password change", () => {
    const acct = setupFreshAccount("TeamBiz");

    addOrInviteTeamMember({
      workspaceId: acct.workspaceId,
      email: `colleague-${Date.now()}@rsltest.in`,
      name: "Priya Deshmukh",
      roleSlug: "agent",
      invitedByUserId: acct.userId,
      initialPassword: "AgentPassword123!",
    });

    const teamBefore = listWorkspaceTeam(acct.workspaceId);
    expect(teamBefore.members).toHaveLength(2);
    const ownerMember = teamBefore.members.find((m) => m.userId === acct.userId)!;
    const staffMember = teamBefore.members.find((m) => m.userId !== acct.userId)!;

    // Primary owner cannot be downgraded or removed
    expect(() =>
      updateWorkspaceMemberRole({
        workspaceId: acct.workspaceId,
        membershipId: ownerMember.membershipId,
        roleSlug: "agent",
      })
    ).toThrow();
    expect(() =>
      removeWorkspaceMember({
        workspaceId: acct.workspaceId,
        membershipId: ownerMember.membershipId,
      })
    ).toThrow();

    // Colleague role can be promoted and later removed
    updateWorkspaceMemberRole({
      workspaceId: acct.workspaceId,
      membershipId: staffMember.membershipId,
      roleSlug: "manager",
    });
    expect(
      listWorkspaceTeam(acct.workspaceId).members.find(
        (m) => m.membershipId === staffMember.membershipId
      )?.roleSlug
    ).toBe("manager");

    removeWorkspaceMember({
      workspaceId: acct.workspaceId,
      membershipId: staffMember.membershipId,
    });
    expect(listWorkspaceTeam(acct.workspaceId).members).toHaveLength(1);

    // Self-service password change requires matching current password
    expect(() =>
      changeAuthenticatedUserPassword({
        userId: acct.userId,
        currentPassword: "WrongPassword!",
        newPassword: "UpdatedPassword999!",
      })
    ).toThrow();

    changeAuthenticatedUserPassword({
      userId: acct.userId,
      currentPassword: "InitialPassword123!",
      newPassword: "UpdatedPassword999!",
    });

    const loginWithNew = signInUser({
      email: acct.email,
      password: "UpdatedPassword999!",
    });
    expect(loginWithNew.userId).toBe(acct.userId);
  });

  it("saves inbox quick replies and allows re-enabling WhatsApp numbers after customer re-consent", async () => {
    const acct = setupFreshAccount("QuickReplyBiz");

    const saved = await saveCannedReply(acct.ctx, {
      shortcut: "bank-details",
      title: "Bank NEFT Details",
      body: "Please remit via NEFT to HDFC Bank A/C 50200089112233 (IFSC HDFC0000142).",
    });
    expect(saved.ok).toBe(true);
    const replies = listCannedReplies(acct.workspaceId);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.shortcut).toBe("bank-details");

    await deleteCannedReply(acct.ctx, { replyId: replies[0]!.id });
    expect(listCannedReplies(acct.workspaceId)).toHaveLength(0);

    const addedSup = await addWhatsAppUnsubscribedNumber(acct.ctx, {
      phoneE164: "+919820099887",
      reason: "Customer replied STOP",
    });
    expect(addedSup.ok).toBe(true);
    const supRows = getWhatsAppWorkspaceData(acct.workspaceId).suppressions;
    expect(supRows).toHaveLength(1);

    const removedSup = await removeWhatsAppUnsubscribedNumber(acct.ctx, {
      suppressionId: supRows[0]!.id,
    });
    expect(removedSup.ok).toBe(true);
    expect(getWhatsAppWorkspaceData(acct.workspaceId).suppressions).toHaveLength(0);
  });
});
