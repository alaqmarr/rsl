import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import { issueApiKey, listWorkspaceApiKeys, rotateApiKey } from "@rsl/api-keys";
import { registerUserWithWorkspace } from "@rsl/auth";
import { staffRecordPlanPaymentAndActivate } from "@rsl/billing";
import {
  linkExternalConnection,
  listWorkspaceConnections,
  verifyExternalConnectionHealth,
} from "@rsl/connections";
import { controlSchema } from "@rsl/database";
import { recordDocsFeedback, searchDocs } from "@rsl/docs";
import {
  appendActionLog,
  exportActionLogsAsCsv,
  generateRedactedSupportBundle,
  listRecentActionLogs,
} from "@rsl/logging";
import {
  deleteScheduledPost,
  getMetaWorkspaceSummary,
  publishScheduledPost,
  scheduleSocialPost,
  sweepDueScheduledPosts,
} from "@rsl/meta";
import { controlDb } from "@rsl/tenancy";
import { GET as getAnalyticsRoute } from "../app/api/v1/analytics/route";

function setupFreshAccount(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rsltest.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "InitialPassword123!",
    businessName: `${tag} Traders`,
    industry: "Distribution",
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
      requestId: `req_p11_${Date.now()}`,
      correlationId: `cor_p11_${Date.now()}`,
    },
  };
}

describe("Phase 11 end-to-end features (Audit Exports, Support Bundles, Key Rotation, Scheduled Posts, Connection Health & Docs Ops)", () => {
  it("filters action logs by outcome/category, exports redacted CSV, and generates audited redacted support bundles", () => {
    const acct = setupFreshAccount("AuditSupport");

    appendActionLog({
      workspaceId: acct.workspaceId,
      actorType: "user",
      actorId: acct.userId,
      source: "web",
      action: "workspace.updated",
      outcome: "success",
      requestId: "req_1",
      correlationId: "cor_1",
      durationMs: 4,
      summary: "Updated contact email to secret.customer@example.com and phone +919820012345",
    });

    appendActionLog({
      workspaceId: acct.workspaceId,
      actorType: "user",
      actorId: acct.userId,
      source: "web",
      action: "apikeys.created",
      outcome: "denied",
      errorCode: "RSL-BILL-1001",
      requestId: "req_2",
      correlationId: "cor_2",
      durationMs: 2,
      summary: "Blocked API key creation while plan is locked",
    });

    const deniedOnly = listRecentActionLogs(acct.workspaceId, 50, { outcome: "denied" });
    expect(deniedOnly.length).toBeGreaterThanOrEqual(1);
    expect(deniedOnly.every((r) => r.outcome === "denied")).toBe(true);

    const devApiOnly = listRecentActionLogs(acct.workspaceId, 50, { category: "Developer API" });
    expect(devApiOnly.length).toBeGreaterThanOrEqual(1);
    expect(devApiOnly.every((r) => r.category === "Developer API")).toBe(true);

    const csv = exportActionLogsAsCsv(acct.workspaceId);
    expect(csv).toContain("timestamp_iso,category,action_key,outcome");
    expect(csv).not.toContain("secret.customer@example.com");
    expect(csv).not.toContain("+919820012345");

    const bundle = generateRedactedSupportBundle({
      workspaceId: acct.workspaceId,
      staffId: "stf_support_01",
      ticketReference: "SUP-9912",
    });
    expect(bundle.bundleVersion).toBe("1.0");
    expect(bundle.ticketReference).toBe("SUP-9912");
    expect(bundle.hashChainIntegrity.valid).toBe(true);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("secret.customer@example.com");
    expect(serialized).not.toContain("+919820012345");

    const adminStats = getPlatformAdminAnalytics();
    expect(
      adminStats.recentAdminLogs.some(
        (l) => l.action === "inspector.support_bundle" && l.ticketReference === "SUP-9912"
      )
    ).toBe(true);
  });

  it("rotates active API keys atomically, revoking the old key and tracking lastUsedAt", async () => {
    const acct = setupFreshAccount("RotateKeyBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "api.access",
      amountPaidPaise: 149900,
      paymentMethod: "upi",
      paymentReference: "UTRROT001",
      staffId: "stf_admin_01",
    });

    const issued = await issueApiKey(acct.ctx, {
      name: "Primary Tally ERP Key",
      mode: "live",
      scopes: ["analytics:read", "vouchers:read"],
      rateLimitPerMin: 240,
      expiresInDays: 0,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const firstCall = await getAnalyticsRoute(
      new NextRequest("http://localhost:4500/api/v1/analytics?range=7d", {
        headers: {
          Authorization: `Bearer ${issued.data.rawKey}`,
          "x-forwarded-for": "203.0.113.42",
        },
      })
    );
    expect(firstCall.status).toBe(200);

    const beforeRotateKeys = listWorkspaceApiKeys(acct.workspaceId);
    const originalRecord = beforeRotateKeys.find((k) => k.id === issued.data.id);
    expect(originalRecord?.lastUsedAt).toBeTruthy();

    const rotated = await rotateApiKey(acct.ctx, { keyId: issued.data.id });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.data.rawKey).not.toBe(issued.data.rawKey);

    // Old key must immediately fail with 401
    const oldKeyCall = await getAnalyticsRoute(
      new NextRequest("http://localhost:4500/api/v1/analytics?range=7d", {
        headers: { Authorization: `Bearer ${issued.data.rawKey}` },
      })
    );
    expect(oldKeyCall.status).toBe(401);

    // New rotated key must immediately succeed with preserved scopes
    const newKeyCall = await getAnalyticsRoute(
      new NextRequest("http://localhost:4500/api/v1/analytics?range=7d", {
        headers: { Authorization: `Bearer ${rotated.data.rawKey}` },
      })
    );
    expect(newKeyCall.status).toBe(200);
  });

  it("publishes, sweeps due scheduled social posts, and removes cancelled posts", async () => {
    const acct = setupFreshAccount("SocialSchedBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "meta.instagram",
      amountPaidPaise: 99900,
      paymentMethod: "bank_transfer",
      paymentReference: "UTRSOC001",
      staffId: "stf_admin_01",
    });

    const pastIso = new Date(Date.now() - 3600_000).toISOString();
    const futureIso = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const duePost = await scheduleSocialPost(acct.ctx, {
      channel: "instagram_feed",
      caption: "Festive wholesale dispatch update",
      scheduledForIso: pastIso,
      publishNow: false,
    });
    const futurePost = await scheduleSocialPost(acct.ctx, {
      channel: "instagram_reel",
      caption: "Next week warehouse tour",
      scheduledForIso: futureIso,
      publishNow: false,
    });
    expect(duePost.ok).toBe(true);
    expect(futurePost.ok).toBe(true);
    if (!duePost.ok || !futurePost.ok) return;

    const sweptCount = sweepDueScheduledPosts(acct.workspaceId);
    expect(sweptCount).toBe(1);

    let summary = getMetaWorkspaceSummary(acct.workspaceId);
    const sweptRow = summary.posts.find((p) => p.id === duePost.data.postId);
    const futureRow = summary.posts.find((p) => p.id === futurePost.data.postId);
    expect(sweptRow?.status).toBe("published");
    expect(futureRow?.status).toBe("scheduled");

    // Manual publish now on future post
    const pubNow = await publishScheduledPost(acct.ctx, { postId: futurePost.data.postId });
    expect(pubNow.ok).toBe(true);
    summary = getMetaWorkspaceSummary(acct.workspaceId);
    expect(summary.posts.find((p) => p.id === futurePost.data.postId)?.status).toBe("published");

    // Remove post
    const removed = await deleteScheduledPost(acct.ctx, { postId: futurePost.data.postId });
    expect(removed.ok).toBe(true);
    summary = getMetaWorkspaceSummary(acct.workspaceId);
    expect(summary.posts.some((p) => p.id === futurePost.data.postId)).toBe(false);
  });

  it("verifies connected account token health and surfaces help feedback & zero-result searches in admin analytics", async () => {
    const acct = setupFreshAccount("ConnDocsBiz");

    const linked = await linkExternalConnection(acct.ctx, {
      provider: "whatsapp",
      displayName: "Main Dispatch WABA",
      externalAccountId: `waba_${Date.now()}`,
      accessToken: "EAAGValidLongToken1234567890",
      scopesGranted: ["messages"],
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;

    const checkHealthy = await verifyExternalConnectionHealth(acct.ctx, {
      connectionId: linked.data.connectionId,
    });
    expect(checkHealthy.ok).toBe(true);
    if (!checkHealthy.ok) return;
    expect(checkHealthy.data.status).toBe("healthy");

    // Simulate expired provider token
    controlDb()
      .update(controlSchema.connections)
      .set({ expiresAt: Date.now() - 60_000 })
      .where(eq(controlSchema.connections.id, linked.data.connectionId))
      .run();

    const checkExpired = await verifyExternalConnectionHealth(acct.ctx, {
      connectionId: linked.data.connectionId,
    });
    expect(checkExpired.ok).toBe(true);
    if (!checkExpired.ok) return;
    expect(checkExpired.data.status).toBe("needs_reauth");

    const conns = listWorkspaceConnections(acct.workspaceId);
    expect(conns.connections[0]?.status).toBe("needs_reauth");
    expect(conns.connections[0]?.lastHealthCheckAt).toBeTruthy();

    // Record docs feedback & zero-result search
    recordDocsFeedback({
      slug: "tally-prime-whatsapp-setup",
      helpful: false,
      comment: "Please add Tally Prime 5.0 screenshot",
      workspaceId: acct.workspaceId,
    });
    const uniqueMissingTerm = `zxqvmissingterm${Date.now()}`;
    const hits = searchDocs(uniqueMissingTerm, "help");
    expect(hits.length).toBe(0);

    const adminAnalytics = getPlatformAdminAnalytics();
    expect(
      adminAnalytics.docsFeedbackRows.some(
        (fb) => fb.slug === "tally-prime-whatsapp-setup" && fb.helpful === false
      )
    ).toBe(true);
    expect(
      adminAnalytics.zeroResultSearches.some((z) => z.query === uniqueMissingTerm)
    ).toBe(true);
  });
});
