import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  listUserActiveSessions,
  registerUserWithWorkspace,
  resolveUserSessionFromToken,
  revokeAllOtherUserSessions,
  signInUser,
  updateAuthenticatedUserProfile,
  updateWorkspaceBusinessSettings,
} from "@rsl/auth";
import {
  buildUpiPaymentPayload,
  diagnoseUpiPayeeConfig,
  getPlatformBillingSettings,
  isValidRbiIfsc,
  isValidUpiVpa,
  sanitizeUpiPayeeName,
  savePlatformBillingSettings,
} from "@rsl/billing";
import {
  disconnectExternalConnection,
  getOrCreateWorkspaceWebhookVerifyToken,
  isValidMetaWebhookVerifyToken,
  linkExternalConnection,
  listWorkspaceConnections,
  rotateWorkspaceWebhookVerifyToken,
  updateExternalConnection,
  verifyExternalConnectionHealth,
} from "@rsl/connections";
import { controlSchema } from "@rsl/database";
import { getOrCreateTallyWebhookEndpoint, rotateTallyWebhookToken } from "@rsl/tally";
import { controlDb } from "@rsl/tenancy";
import { GET as verifyMetaWebhookGet } from "../app/api/webhooks/meta/route";
import { GET as verifyWhatsAppWebhookGet } from "../app/api/webhooks/whatsapp/route";

function setupSessionAccount(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rslphase14.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Director`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Industries`,
    industry: "Manufacturing",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

describe("Phase 14 Suite (UPI Banking Name Fix, Client Profile & Business Settings, Unified Tokens & Channel Whitelisting)", () => {
  it("validates UPI VPA & RBI IFSC, blocks email-like handles, sanitizes pn=, and diagnoses demo placeholders", () => {
    expect(isValidUpiVpa("rslmarketing@okhdfcbank")).toBe(true);
    expect(isValidUpiVpa("9820011223@ybl")).toBe(true);
    // Email addresses must NEVER be accepted as UPI VPA handles (causes 'Could not fetch banking name')
    expect(isValidUpiVpa("billing@rslmarketing.in")).toBe(false);
    expect(isValidUpiVpa("accounts@company.com")).toBe(false);

    // RBI IFSC: 4 letters + '0' + 6 alphanumeric
    expect(isValidRbiIfsc("HDFC0000240")).toBe(true);
    expect(isValidRbiIfsc("ICIC0001234")).toBe(true);
    expect(isValidRbiIfsc("HDFC1000240")).toBe(false); // 5th char not '0'
    expect(isValidRbiIfsc("SHORT")).toBe(false);

    // Payee name sanitization strips characters that break strict bank PSP parsers
    expect(sanitizeUpiPayeeName("RSL Marketing & Tally (India) Pvt. Ltd!")).toBe(
      "RSL Marketing Tally India Pvt Ltd"
    );

    const demoDiag = diagnoseUpiPayeeConfig({
      upiQrMode: "bank_account",
      upiId: "billing@rslmarketing",
      accountNumber: "50200091827364",
      ifscCode: "HDFC0001234",
    });
    expect(demoDiag.isDemoBankPlaceholder).toBe(true);
    expect(demoDiag.isDemoVpaPlaceholder).toBe(true);
    expect(demoDiag.isDemoActiveTarget).toBe(true);
    expect(demoDiag.bankingNameWarning).toBeTruthy();

    const liveDiag = diagnoseUpiPayeeConfig({
      upiQrMode: "upi_id",
      upiId: "rapidshiftlabs@okicici",
      accountNumber: "50200091827364",
      ifscCode: "HDFC0001234",
    });
    expect(liveDiag.hasValidVpa).toBe(true);
    expect(liveDiag.isDemoActiveTarget).toBe(false);
    expect(liveDiag.bankingNameWarning).toBeNull();

    // Rejects saving an email address as UPI ID
    const original = getPlatformBillingSettings();
    expect(() =>
      savePlatformBillingSettings({
        ...original,
        upiId: "support@rapidshift.in",
      })
    ).toThrow(/email address/i);

    // Rejects saving malformed IFSC
    expect(() =>
      savePlatformBillingSettings({
        ...original,
        ifscCode: "HDFC9999999",
      })
    ).toThrow(/IFSC/i);

    // Prefers VPA by default when valid VPA is supplied
    const payload = buildUpiPaymentPayload({
      upiId: "rapidshiftlabs@okicici",
      accountNumber: "50200091827364",
      ifscCode: "HDFC0001234",
      payeeName: "RapidShift & Co.",
      subtotalPaise: 199900,
      workspaceSlug: "acme-corp",
      itemLabel: "WhatsApp Cloud API",
    });
    expect(payload.routingMode).toBe("upi_id");
    expect(payload.payeeAddress).toBe("rapidshiftlabs@okicici");
    expect(payload.upiUri).toContain("pa=rapidshiftlabs@okicici");
    expect(payload.upiUri).toContain("pn=RapidShift%20Co");
  });

  it("updates client personal profile, tracks multi-device sessions, and revokes other sessions cleanly", () => {
    const { email, session } = setupSessionAccount("ProfileTest");

    const updated = updateAuthenticatedUserProfile({
      userId: session.user.id,
      name: "Aarav Deshmukh",
      phone: "+91 98200 55443",
      jobTitle: "Managing Director",
      email,
    });
    expect(updated.name).toBe("Aarav Deshmukh");
    expect(updated.jobTitle).toBe("Managing Director");
    expect(updated.emailChanged).toBe(false);

    // Create a second browser session on Android
    const secondLogin = signInUser({
      email,
      password: "StrongPassword123!",
      ipAddress: "49.36.128.10",
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0.0.0 Mobile",
    });
    expect(secondLogin.rawSessionToken).toBeTruthy();

    const activeBefore = listUserActiveSessions(session.user.id, session.sessionId);
    expect(activeBefore.length).toBe(2);
    expect(activeBefore[0]!.isCurrent).toBe(true);
    expect(activeBefore.some((s) => s.deviceLabel.includes("Android"))).toBe(true);

    const revoked = revokeAllOtherUserSessions({
      userId: session.user.id,
      currentSessionId: session.sessionId,
    });
    expect(revoked.revokedCount).toBe(1);

    const activeAfter = listUserActiveSessions(session.user.id, session.sessionId);
    expect(activeAfter.length).toBe(1);
    expect(resolveUserSessionFromToken(secondLogin.rawSessionToken)).toBeNull();
  });

  it("validates and saves full Business Settings including 15-char GSTIN, PIN code, address, and default Tally company", () => {
    const { session } = setupSessionAccount("BizSettings");

    expect(() =>
      updateWorkspaceBusinessSettings({
        workspaceId: session.workspace.id,
        name: "Shree Ganesh Traders",
        gstin: "INVALIDGSTIN",
      })
    ).toThrow(/15-character/i);

    expect(() =>
      updateWorkspaceBusinessSettings({
        workspaceId: session.workspace.id,
        name: "Shree Ganesh Traders",
        pincode: "01234",
      })
    ).toThrow(/6-digit/i);

    const saved = updateWorkspaceBusinessSettings({
      workspaceId: session.workspace.id,
      name: "Shree Ganesh Traders Pvt Ltd",
      industry: "FMCG Distribution",
      businessPhone: "+91 22 2650 9900",
      billingEmail: "accounts@shreeganesh.in",
      website: "https://shreeganesh.in",
      addressLine: "Gala 14, MIDC Andheri East",
      city: "Mumbai",
      pincode: "400093",
      defaultTallyCompany: "Shree Ganesh FY 2026-27",
      stateCode: "27",
      gstin: "27aaacs1234f1z5",
    });

    expect(saved.gstin).toBe("27AAACS1234F1Z5");
    expect(saved.stateCode).toBe("27");

    const wsRow = controlDb()
      .select()
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, session.workspace.id))
      .get()!;
    expect(wsRow.city).toBe("Mumbai");
    expect(wsRow.pincode).toBe("400093");
    expect(wsRow.defaultTallyCompany).toBe("Shree Ganesh FY 2026-27");
    expect(wsRow.billingEmail).toBe("accounts@shreeganesh.in");
  });

  it("manages unified tokens (Tally rotation, Meta webhook verify token + GET challenge, multi-ID channel routing & in-place token rotation)", async () => {
    const { session } = setupSessionAccount("TokensHub");

    // 1. Tally token rotation
    const initialTally = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    const rotatedTally = await rotateTallyWebhookToken(session.ctx, {});
    expect(rotatedTally.ok).toBe(true);
    if (!rotatedTally.ok) throw new Error("Expected Tally token rotation to succeed");
    expect(rotatedTally.data.webhookToken).not.toBe(initialTally.webhookToken);
    expect(rotatedTally.data.webhookToken.startsWith("tlwh_")).toBe(true);

    // 2. Workspace Meta/WhatsApp webhook verify token & GET challenge verification
    const verifyTok1 = getOrCreateWorkspaceWebhookVerifyToken(session.workspace.id);
    expect(verifyTok1.startsWith("rsl_verify_")).toBe(true);
    expect(isValidMetaWebhookVerifyToken(verifyTok1)).toBe(true);

    const waChallengeResp = await verifyWhatsAppWebhookGet(
      new Request(
        `http://localhost:4500/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyTok1)}&hub.challenge=99887766`
      )
    );
    expect(waChallengeResp.status).toBe(200);
    expect(await waChallengeResp.text()).toBe("99887766");

    const verifyTok2 = rotateWorkspaceWebhookVerifyToken(session.workspace.id);
    expect(verifyTok2).not.toBe(verifyTok1);
    expect(isValidMetaWebhookVerifyToken(verifyTok1)).toBe(false);
    expect(isValidMetaWebhookVerifyToken(verifyTok2)).toBe(true);

    const metaChallengeResp = await verifyMetaWebhookGet(
      new Request(
        `http://localhost:4500/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyTok2)}&hub.challenge=meta_ok_42`
      )
    );
    expect(metaChallengeResp.status).toBe(200);
    expect(await metaChallengeResp.text()).toBe("meta_ok_42");

    // 3. Connect WhatsApp Cloud API with BOTH WABA ID and Phone Number ID + Sandbox token
    const waConn = await linkExternalConnection(session.ctx, {
      provider: "whatsapp",
      displayName: "Main WhatsApp Line",
      externalAccountId: "109988776655441",
      accessToken: "rsl_sandbox_wa_initial_token_1234",
      scopesGranted: ["whatsapp_business_messaging", "whatsapp_business_management"],
      assetType: "waba_phone",
      assetName: "+91 98200 11223",
      metadata: {
        channelKind: "whatsapp_cloud",
        phoneNumberId: "109988776655441",
        wabaId: "208877665544332",
        displayPhone: "+91 98200 11223",
      },
    });
    expect(waConn.ok).toBe(true);
    if (!waConn.ok) throw new Error("Expected WhatsApp connection to succeed");

    // Both Phone Number ID and WABA ID should be registered in asset_routing
    const routedWaba = controlDb()
      .select()
      .from(controlSchema.assetRouting)
      .where(
        and(
          eq(controlSchema.assetRouting.provider, "whatsapp"),
          eq(controlSchema.assetRouting.externalId, "208877665544332")
        )
      )
      .get();
    expect(routedWaba?.tenantId).toBe(session.workspace.id);

    // Live provider check with sandbox token succeeds cleanly
    const liveCheck = await verifyExternalConnectionHealth(session.ctx, {
      connectionId: waConn.data.connectionId,
      checkLiveProvider: true,
    });
    expect(liveCheck.ok).toBe(true);
    if (liveCheck.ok) {
      expect(liveCheck.data.status).toBe("healthy");
      expect(liveCheck.data.liveMessage).toMatch(/Sandbox test token verified/i);
    }

    // Rotate channel token in place without disconnecting
    const rotatedConn = await updateExternalConnection(session.ctx, {
      connectionId: waConn.data.connectionId,
      accessToken: "rsl_sandbox_wa_rotated_token_9876",
    });
    expect(rotatedConn.ok).toBe(true);
    if (rotatedConn.ok) {
      expect(rotatedConn.data.rotatedToken).toBe(true);
      expect(rotatedConn.data.maskedTokenHint).toContain("9876");
    }

    const listed = listWorkspaceConnections(session.workspace.id);
    expect(listed.connections.length).toBe(1);
    expect(listed.connections[0]!.channelKind).toBe("whatsapp_cloud");
    expect(listed.connections[0]!.maskedTokenHint).toContain("9876");

    // Disconnect cleans up routing entries
    await disconnectExternalConnection(session.ctx, {
      connectionId: waConn.data.connectionId,
    });
    const afterDisc = listWorkspaceConnections(session.workspace.id);
    expect(afterDisc.connections.length).toBe(0);
  });
});
