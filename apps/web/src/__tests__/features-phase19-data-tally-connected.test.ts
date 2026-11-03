import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  assertSafeOutboundWebhookTarget,
  isPrivateOrReservedIp,
} from "@rsl/api-keys";
import { registerUserWithWorkspace } from "@rsl/auth";
import {
  approveWalletRechargeRequest,
  getWalletBalancePaise,
  staffRecordPlanPaymentAndActivate,
  submitWalletRechargeRequest,
} from "@rsl/billing";
import {
  buildGoogleOAuthAuthorizeUrl,
  generateGoogleOAuthPkcePair,
  linkExternalConnection,
  refreshGoogleConnectionIfNeeded,
} from "@rsl/connections";
import { isTrustedPlatformHost, resolveEndpointsFromHeaders, RslError } from "@rsl/core";
import { controlSchema, ingressSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { createContact } from "@rsl/inbox";
import { markSendGuardOutcome, reserveSendGuard } from "@rsl/queue";
import {
  exportTallyVouchersAsCsv,
  exportTallyVouchersAsXml,
  generateStandaloneTallyConnectorMjs,
  generateTallyPrimeTdlAddOn,
  generateWindowsTallyInstallerBat,
  ingestTallyBillEventAndEnqueueAutomation,
  reconcileTallyCompanySnapshot,
  recordTallyVoucher,
  runDueTallyReminders,
  saveTallyReminderRule,
} from "@rsl/tally";
import {
  clearPlatformCredentialOverride,
  controlDb,
  ingressDb,
  savePlatformGoogleOAuthConfig,
  savePlatformMetaAppConfig,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";
import {
  installStarterTallyTemplates,
  launchWhatsAppBroadcast,
} from "@rsl/whatsapp";
import { GET as startGoogleOAuthGet } from "../app/api/oauth/google/start/route";
import { POST as metaWebhookPost } from "../app/api/webhooks/meta/route";
import { POST as whatsappWebhookPost } from "../app/api/webhooks/whatsapp/route";

function setupFreshAccount(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}@rsltest.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "InitialPassword123!",
    businessName: `${tag} Traders`,
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
      requestId: `req_p19_${Date.now()}`,
      correlationId: `cor_p19_${Date.now()}`,
    },
  };
}

describe("Phase 19 — Sprint 1 & 2: Tally Prime Integrity, Double-Entry XML, Multi-Currency, Queues, OAuth PKCE & SSRF Hardening", () => {
  it("trips RSL-SYNC-CIRCUIT-BREAKER when Tally returns a 0-voucher snapshot against existing company vouchers", async () => {
    const acct = setupFreshAccount("CircuitBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "tally.sync",
      amountPaidPaise: 99900,
      paymentMethod: "upi",
      paymentReference: `UPI-P19-CB-${Date.now()}`,
      staffId: "stf_p19",
    });

    await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: acct.workspaceId,
      actorType: "webhook",
      actorId: "wh_test",
      rawPayload: {
        vouchers: [
          {
            guid: "guid-cb-1",
            companyName: "Circuit Traders Pvt Ltd",
            voucherNumber: "GST/26-27/001",
            voucherType: "Sales",
            partyName: "Omkar Agencies",
            amountRupees: 12500,
          },
          {
            guid: "guid-cb-2",
            companyName: "Circuit Traders Pvt Ltd",
            voucherNumber: "GST/26-27/002",
            voucherType: "Sales",
            partyName: "Shree Traders",
            amountRupees: 8400,
          },
        ],
      },
    });

    expect(() =>
      reconcileTallyCompanySnapshot({
        workspaceId: acct.workspaceId,
        companyName: "Circuit Traders Pvt Ltd",
        activeCanonicalGuids: [],
        actorType: "agent",
        actorId: "dev_test",
      })
    ).toThrowError(RslError);

    try {
      reconcileTallyCompanySnapshot({
        workspaceId: acct.workspaceId,
        companyName: "Circuit Traders Pvt Ltd",
        activeCanonicalGuids: [],
        actorType: "agent",
        actorId: "dev_test",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RslError);
      expect((err as RslError).code).toBe("RSL-SYNC-CIRCUIT-BREAKER");
    }

    // Verify zero vouchers were wiped!
    const remaining = tenantDataDb({ workspaceId: acct.workspaceId })
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .all();
    expect(remaining).toHaveLength(2);
  });

  it("exports balanced double-entry Tally Prime XML in IST timezone and sanitizes CSV formula injection", async () => {
    const acct = setupFreshAccount("XmlBalanceBiz");
    // 2026-11-02T19:00:00Z === 2026-11-03 00:30:00 IST -> must format as 20261103 in Tally XML!
    const earlyMorningIstTs = Date.parse("2026-11-02T19:00:00.000Z");

    const db = tenantDataDb({ workspaceId: acct.workspaceId });
    db.insert(tenantDataSchema.tallyCompanies)
      .values({
        id: "tco_xml_test",
        companyGuid: "comp_xml_test",
        name: "XML Test Co",
        financialYearFrom: "2026-04-01",
        lastAlterId: 10,
        lastSyncedAt: earlyMorningIstTs,
        createdAt: earlyMorningIstTs,
      })
      .run();

    const rowsToInsert = [
      {
        id: "tvch_xml_sales",
        guid: "guid-xml-sales",
        companyId: "tco_xml_test",
        voucherNumber: "INV-101",
        voucherType: "Sales",
        partyName: "=CMD|' /C calc'!A0 Traders",
        partyPhoneE164: "+919820011223",
        amountPaise: 250000,
        paidAmountPaise: 50000,
        voucherDate: earlyMorningIstTs,
        dueDate: earlyMorningIstTs + 86400_000,
        paymentStatus: "partial",
        alterId: 1,
        contentHash: "h1",
        createdAt: earlyMorningIstTs,
        updatedAt: earlyMorningIstTs,
      },
      {
        id: "tvch_xml_rcpt",
        guid: "guid-xml-rcpt",
        companyId: "tco_xml_test",
        voucherNumber: "RCPT-202",
        voucherType: "Receipt",
        partyName: "Mehta Sons",
        partyPhoneE164: "+919820099887",
        amountPaise: 100000,
        paidAmountPaise: 100000,
        voucherDate: earlyMorningIstTs,
        dueDate: null,
        paymentStatus: "paid",
        alterId: 2,
        contentHash: "h2",
        createdAt: earlyMorningIstTs,
        updatedAt: earlyMorningIstTs,
      },
      {
        id: "tvch_xml_cn",
        guid: "guid-xml-cn",
        companyId: "tco_xml_test",
        voucherNumber: "CN-303",
        voucherType: "CreditNote",
        partyName: "Mehta Sons",
        partyPhoneE164: null,
        amountPaise: 30000,
        paidAmountPaise: 30000,
        voucherDate: earlyMorningIstTs,
        dueDate: null,
        paymentStatus: "paid",
        alterId: 3,
        contentHash: "h3",
        createdAt: earlyMorningIstTs,
        updatedAt: earlyMorningIstTs,
      },
    ];
    for (const r of rowsToInsert) {
      db.insert(tenantDataSchema.tallyVouchers).values(r).run();
    }

    const xml = exportTallyVouchersAsXml(acct.workspaceId);
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<DATE>20261103</DATE>");
    expect(xml).not.toContain("<RSLPARTYPHONE>");
    expect(xml).not.toContain("<RSLPAIDAMOUNT>");

    // Verify every <VOUCHER> block has >= 2 ledger entries whose signed amounts sum to 0.00!
    const vchBlocks = xml.match(/<VOUCHER[\s\S]*?<\/VOUCHER>/g) ?? [];
    expect(vchBlocks).toHaveLength(3);
    for (const block of vchBlocks) {
      const entries = block.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) ?? [];
      expect(entries.length).toBeGreaterThanOrEqual(2);
      const amounts = entries.map((e) => Number(e.match(/<AMOUNT>([-\d.]+)<\/AMOUNT>/)?.[1] ?? "NaN"));
      const sum = amounts.reduce((acc, n) => acc + n, 0);
      expect(Math.abs(sum)).toBeLessThan(0.001);
    }

    // Verify Receipt credits Party (ISDEEMEDPOSITIVE=No, +1000.00) and debits Cash (ISDEEMEDPOSITIVE=Yes, -1000.00)
    const rcptBlock = vchBlocks.find((b) => b.includes("RCPT-202"))!;
    expect(rcptBlock).toContain("<LEDGERNAME>Mehta Sons</LEDGERNAME>\n            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>\n            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n            <AMOUNT>1000.00</AMOUNT>");
    expect(rcptBlock).toContain("<LEDGERNAME>Cash</LEDGERNAME>\n            <ISPARTYLEDGER>No</ISPARTYLEDGER>\n            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n            <AMOUNT>-1000.00</AMOUNT>");

    // CSV formula injection neutralizer
    const csv = exportTallyVouchersAsCsv(acct.workspaceId);
    expect(csv).toContain(`"'=CMD|' /C calc'!A0 Traders"`);
    expect(csv).toContain("2026-11-03");
  });

  it("parses multi-currency USD Tally XML vouchers, persists masterId & forex rates, and tracks signed party balances", async () => {
    const acct = setupFreshAccount("ForexTallyBiz");
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <TALLYMESSAGE>
        <LEDGER NAME="Global Exports LLC">
          <PARENT>Sundry Debtors</PARENT>
          <LEDGERMOBILE>+919811122233</LEDGERMOBILE>
        </LEDGER>
        <VOUCHER VCHTYPE="Sales">
          <MASTERID>9842</MASTERID>
          <GUID>forex-guid-1</GUID>
          <ALTERID>55</ALTERID>
          <DATE>20261101</DATE>
          <VOUCHERNUMBER>EXP/26-27/09</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>Global Exports LLC</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Global Exports LLC</LEDGERNAME>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>-$1500.00 @ ₹84.50/$ = -₹126750.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
        <VOUCHER VCHTYPE="Credit Note">
          <MASTERID>9843</MASTERID>
          <GUID>forex-guid-cn</GUID>
          <ALTERID>56</ALTERID>
          <DATE>20261102</DATE>
          <VOUCHERNUMBER>CN/26-27/01</VOUCHERNUMBER>
          <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>Global Exports LLC</PARTYLEDGERNAME>
          <AMOUNT>6750.00</AMOUNT>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;

    const res = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: acct.workspaceId,
      actorType: "agent",
      actorId: "dev_forex",
      rawPayload: sampleXml,
    });
    expect(res.upserted).toBe(2);

    const db = tenantDataDb({ workspaceId: acct.workspaceId });
    const salesRow = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.voucherNumber, "EXP/26-27/09"))
      .get()!;
    expect(salesRow.masterId).toBe("9842");
    expect(salesRow.amountPaise).toBe(12_675_000); // ₹1,26,750.00, NEVER ₹1,500!
    expect(salesRow.originalCurrency).toBe("USD");
    expect(salesRow.originalAmountMinor).toBe(150_000); // $1,500.00
    expect(salesRow.exchangeRateMicros).toBe(84_500_000);

    // Party closing balance = ₹1,26,750 (Sales) - ₹6,750 (Credit Note) = ₹1,20,000 (12,000,000 paise)
    const partyRow = db
      .select()
      .from(tenantDataSchema.tallyParties)
      .where(eq(tenantDataSchema.tallyParties.name, "Global Exports LLC"))
      .get()!;
    expect(partyRow.parentGroup).toBe("Sundry Debtors");
    expect(partyRow.closingBalancePaise).toBe(12_000_000);

    // Verify TDL compound voucher party formula + signed connector + Windows .bat installer
    const tdl = generateTallyPrimeTdlAddOn({
      workspaceName: "Forex Traders",
      webhookUrl: "https://tally.rapidshiftlabs.in/api/webhooks/tally",
      webhookToken: "tlwh_test123",
    });
    expect(tdl).toContain("$$FilterValue:$Amount:AllLedgerEntries:1:");
    const mjs = generateStandaloneTallyConnectorMjs({
      serverUrl: "https://tally.rapidshiftlabs.in",
      workspaceName: "Forex Traders",
    });
    expect(mjs).toContain("icacls");
    expect(mjs).toContain("manifestHmac");
    const bat = generateWindowsTallyInstallerBat({
      serverUrl: "https://tally.rapidshiftlabs.in",
      workspaceName: "Forex Traders",
      webhookToken: "tlwh_test123",
      pairingCode: "RSL-1234-5678",
    });
    expect(bat).toContain("RSL-Tally-Background-Sync.vbs");
    expect(bat).toContain("RSL-1234-5678");
  });

  it("dispatches real WhatsApp messages for payment reminders and fanout broadcasts via durable outbox", async () => {
    const acct = setupFreshAccount("OutboxReminderBiz");
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "tally.invoicing",
      amountPaidPaise: 149900,
      paymentMethod: "upi",
      paymentReference: `UPI-P19-REM-${Date.now()}`,
      staffId: "stf_p19",
    });
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "whatsapp.messaging",
      amountPaidPaise: 99900,
      paymentMethod: "upi",
      paymentReference: `UPI-P19-WA-${Date.now()}`,
      staffId: "stf_p19",
    });
    staffRecordPlanPaymentAndActivate({
      workspaceId: acct.workspaceId,
      serviceKey: "whatsapp.broadcast",
      amountPaidPaise: 129900,
      paymentMethod: "upi",
      paymentReference: `UPI-P19-BC-${Date.now()}`,
      staffId: "stf_p19",
    });

    const rech = submitWalletRechargeRequest({
      workspaceId: acct.workspaceId,
      amountPaise: 50_000,
      utrOrReference: `UTR-P19-${Date.now()}`,
      paymentMethod: "upi",
    });
    approveWalletRechargeRequest({
      paymentId: rech.paymentId,
      staffId: "stf_p19",
    });

    await installStarterTallyTemplates(acct.ctx, {});
    const tenDaysAgoIso = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    const fiveDaysAgoIso = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    await recordTallyVoucher(acct.ctx, {
      voucherNumber: "REM-INV-01",
      voucherType: "Sales",
      partyName: "Kiran Hardware",
      partyPhoneE164: "+919876543210",
      amountRupees: 4500,
      paidAmountRupees: 0,
      voucherDateIso: tenDaysAgoIso,
      dueDateIso: fiveDaysAgoIso,
    });
    await saveTallyReminderRule(acct.ctx, {
      name: "5 Days Overdue Reminder",
      triggerDaysOffset: 3,
      templateName: "tally_overdue_bill_reminder",
      maxRemindersPerBill: 2,
    });

    const walletBefore = getWalletBalancePaise(acct.workspaceId);
    const remRes = await runDueTallyReminders(acct.ctx, { ignoreQuietHours: true });
    expect(remRes.ok).toBe(true);
    if (remRes.ok) {
      expect(remRes.data.sentCount).toBe(1);
    }
    expect(getWalletBalancePaise(acct.workspaceId)).toBe(walletBefore - 85);

    // Verify outbound message was genuinely persisted in Customer Messages!
    const db = tenantDataDb({ workspaceId: acct.workspaceId });
    const msgsAfterRem = db.select().from(tenantDataSchema.messages).all();
    expect(msgsAfterRem.some((m) => m.body.includes("REM-INV-01"))).toBe(true);

    // Test WhatsApp Broadcast Chunk Consumer
    await createContact(acct.ctx, {
      name: "Opted Customer 1",
      phoneE164: "+919820000111",
      recordWhatsAppConsent: true,
    });
    await createContact(acct.ctx, {
      name: "Opted Customer 2",
      phoneE164: "+919820000222",
      recordWhatsAppConsent: true,
    });
    const tmpl = db.select().from(tenantDataSchema.whatsappTemplates).get()!;
    const bcastRes = await launchWhatsAppBroadcast(acct.ctx, {
      name: "Diwali Collection Update",
      templateId: tmpl.id,
    });
    expect(bcastRes.ok).toBe(true);
    if (bcastRes.ok) {
      expect(bcastRes.data.recipientCount).toBe(2);
      const bcastRow = db
        .select()
        .from(tenantDataSchema.broadcasts)
        .where(eq(tenantDataSchema.broadcasts.id, bcastRes.data.broadcastId))
        .get()!;
      expect(bcastRow.status).toBe("completed");
      expect(bcastRow.sentCount).toBe(2);
    }
  });

  it("reclaims failed SendGuard locks after retry cooldown", async () => {
    const acct = setupFreshAccount("SendGuardRetryBiz");
    const key = `retry_guard_${Date.now()}`;

    const first = reserveSendGuard({
      workspaceId: acct.workspaceId,
      idempotencyKey: key,
      channel: "whatsapp",
      recipient: "+919900112233",
    });
    expect(first.allowed).toBe(true);

    // While reserved, duplicate is blocked
    const dup = reserveSendGuard({
      workspaceId: acct.workspaceId,
      idempotencyKey: key,
      channel: "whatsapp",
      recipient: "+919900112233",
    });
    expect(dup.allowed).toBe(false);

    // Mark failed and backdate createdAt by 2 seconds to simulate worker backoff cooldown
    markSendGuardOutcome({
      workspaceId: acct.workspaceId,
      idempotencyKey: key,
      state: "failed",
    });
    tenantLogsDb({ workspaceId: acct.workspaceId })
      .update(tenantLogsSchema.sendGuards)
      .set({ updatedAt: Date.now() - 2500 })
      .where(eq(tenantLogsSchema.sendGuards.idempotencyKey, key))
      .run();

    const reclaimed = reserveSendGuard({
      workspaceId: acct.workspaceId,
      idempotencyKey: key,
      channel: "whatsapp",
      recipient: "+919900112233",
    });
    expect(reclaimed.allowed).toBe(true);
  });

  it("enforces Host allowlists, PKCE S256 parameters, and marks Google connections needs_reauth on refresh failure", async () => {
    expect(isTrustedPlatformHost("app.rapidshiftlabs.in", "rapidshiftlabs.in")).toBe(true);
    expect(isTrustedPlatformHost("localhost:4500", "rapidshiftlabs.in")).toBe(true);
    expect(isTrustedPlatformHost("evil-phishing.com", "rapidshiftlabs.in")).toBe(false);
    expect(
      isTrustedPlatformHost("app.rapidshiftlabs.in.evil-phishing.com", "rapidshiftlabs.in")
    ).toBe(false);

    // Untrusted X-Forwarded-Host must never poison resolved endpoints or OAuth start route
    const poisonedHeaders = new Headers({
      host: "evil-phishing.com",
      "x-forwarded-host": "evil-phishing.com",
    });
    const safeEndpoints = resolveEndpointsFromHeaders(poisonedHeaders);
    expect(safeEndpoints.cloudBaseUrl).not.toContain("evil-phishing.com");

    const poisonedReq = new NextRequest("https://app.rapidshiftlabs.in/api/oauth/google/start", {
      headers: poisonedHeaders,
    });
    const rejectedResp = await startGoogleOAuthGet(poisonedReq);
    expect(rejectedResp.status).toBe(400);

    // PKCE S256 check
    savePlatformGoogleOAuthConfig({
      enabled: true,
      clientId: "123456-pkce.apps.googleusercontent.com",
      clientSecret: "GOCSPX-pkceSecret",
      consentAppName: "RapidShift Labs",
      publishingStatus: "production",
      defaultDriveFolderName: "RapidShift Labs Backups",
      enableDriveOAuth: true,
      enableGbpOAuth: true,
      staffId: "stf_p19",
    });

    const pkce = generateGoogleOAuthPkcePair();
    const expectedChallenge = crypto
      .createHash("sha256")
      .update(pkce.codeVerifier, "ascii")
      .digest("base64url");
    expect(pkce.codeChallenge).toBe(expectedChallenge);

    const authUrl = new URL(
      buildGoogleOAuthAuthorizeUrl({
        redirectUri: "https://app.rapidshiftlabs.in/api/oauth/google/callback",
        state: "st_123",
        purpose: "google_drive",
        codeChallenge: pkce.codeChallenge,
      })
    );
    expect(authUrl.searchParams.get("code_challenge")).toBe(pkce.codeChallenge);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");

    // Simulate expired Google refresh token -> connection must transition to needs_reauth
    const acct = setupFreshAccount("GoogleRefreshBiz");
    const linked = await linkExternalConnection(acct.ctx, {
      provider: "gdrive",
      displayName: "Google Drive (expired@test.in)",
      externalAccountId: "folder_123",
      accessToken: "ya29.expired_token_value",
      refreshToken: "1//revoked_refresh_token",
      scopesGranted: ["https://www.googleapis.com/auth/drive.file"],
    });
    expect(linked.ok).toBe(true);
    if (linked.ok) {
      controlDb()
        .update(controlSchema.connections)
        .set({ expiresAt: Date.now() - 60_000 })
        .where(eq(controlSchema.connections.id, linked.data.connectionId))
        .run();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
        );
      try {
        const refreshed = await refreshGoogleConnectionIfNeeded(
          acct.workspaceId,
          linked.data.connectionId
        );
        expect(refreshed).toBeNull();
      } finally {
        fetchSpy.mockRestore();
      }

      const updatedConn = controlDb()
        .select()
        .from(controlSchema.connections)
        .where(eq(controlSchema.connections.id, linked.data.connectionId))
        .get()!;
      expect(updatedConn.status).toBe("needs_reauth");
    }

    clearPlatformCredentialOverride("google_oauth");
  });

  it("blocks SSRF private/metadata IPs on outbound webhooks and rejects unsigned Meta/WhatsApp webhooks before DB write", async () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.42")).toBe(true);
    expect(isPrivateOrReservedIp("172.20.1.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);

    await expect(
      assertSafeOutboundWebhookTarget("https://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/private|metadata/i);
    await expect(
      assertSafeOutboundWebhookTarget("https://10.12.0.5/internal-hook")
    ).rejects.toThrow(/private|metadata/i);
    await expect(
      assertSafeOutboundWebhookTarget("https://metadata.google.internal/computeMetadata/v1/")
    ).rejects.toThrow(/internal|metadata/i);

    // Meta & WhatsApp webhook HMAC pre-validation BEFORE ingress.db insert
    savePlatformMetaAppConfig({
      enabled: true,
      appId: "998877",
      appSecret: "super_secret_meta_hmac_key",
      webhookVerifyToken: "verify_tok",
      staffId: "stf_p19",
    });

    const beforeCount = ingressDb().select().from(ingressSchema.webhookInbox).all().length;

    const unsignedMeta = await metaWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/meta", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body: JSON.stringify({ object: "page", entry: [] }),
      })
    );
    expect(unsignedMeta.status).toBe(401);

    const unsignedWa = await whatsappWebhookPost(
      new NextRequest("https://app.rapidshiftlabs.in/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=0000" },
        body: JSON.stringify({ entry: [] }),
      })
    );
    expect(unsignedWa.status).toBe(401);

    const afterCount = ingressDb().select().from(ingressSchema.webhookInbox).all().length;
    expect(afterCount).toBe(beforeCount);

    clearPlatformCredentialOverride("meta_app");
  });
});
