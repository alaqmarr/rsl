import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeGstinCheckDigit,
  newId,
  searchHsnSacCatalog,
  validateIndianGstin,
} from "@rsl/core";
import {
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  completePasskeyAuthentication,
  completePasskeyRegistration,
  listUserPasskeys,
  registerUserWithWorkspace,
  revokeUserPasskey,
  updateWorkspaceBusinessSettings,
} from "@rsl/auth";
import { staffGrantFreeAllToolsAccess } from "@rsl/billing";
import {
  buildVapidAuthorizationHeader,
  encryptWebPushPayloadAes128Gcm,
  listUserWebPushSubscriptions,
  saveUserWebPushSubscription,
} from "@rsl/notifications";
import {
  buildNpciUpiPayUri,
  buildSignedPublicTallyBillPayUrl,
  getPublicTallyBillPaymentView,
  importSupplierBillDraftToTally,
  ingestInboundSupplierEmailBill,
  listSupplierBillDrafts,
  recordTallyVoucher,
} from "@rsl/tally";
import {
  buildCloudflareEmailWorkerSnippet,
  ensurePlatformVapidConfig,
  generateSmartAdCopy,
  getPlatformCloudflareEmailConfig,
  getPlatformTurnstileConfig,
  lintWhatsAppTemplateForMeta,
  seedPlatformCredentialsBundle,
  translateIndianBusinessText,
  verifyCloudflareTurnstileToken,
  type TenantContext,
} from "@rsl/tenancy";

describe("Phase 32 — Free Tools Suite: Cloudflare Stack, India Open SMB Utilities, UPI Bill Pay, Web Push & Passkeys", () => {
  it("seeds encrypted platform credentials into control.db and enforces Cloudflare Turnstile & Email Routing helpers", async () => {
    const seedRes = seedPlatformCredentialsBundle({
      staffId: "stf_phase32_seeder",
      bundle: {
        cloudflare_turnstile: {
          enabled: true,
          siteKey: "1x00000000000000000000AA",
          secretKey: "1x0000000000000000000000000000000AA",
          enforceOnLogin: true,
          enforceOnRegister: true,
          enforceOnPublicForms: true,
        },
        cloudflare_email_routing: {
          enabled: true,
          inboundDomain: "bills.rapidshiftlabs.in",
          autoGenerateSecret: true,
        },
        web_push_vapid: {
          enabled: true,
          subject: "mailto:alerts@rapidshiftlabs.in",
          autoGenerate: true,
        },
      },
    });

    expect(seedRes.seeded).toEqual(
      expect.arrayContaining([
        "cloudflare_turnstile",
        "cloudflare_email_routing",
        "web_push_vapid",
      ])
    );

    const turnstileCfg = getPlatformTurnstileConfig();
    expect(turnstileCfg.isReady).toBe(true);
    expect(turnstileCfg.source).toBe("database");

    const missingCheck = await verifyCloudflareTurnstileToken({
      token: "",
      surface: "login",
    });
    expect(missingCheck.allowed).toBe(false);

    const validCheck = await verifyCloudflareTurnstileToken({
      token: "XXXX.DUMMY.TOKEN.XXXX",
      surface: "login",
    });
    expect(validCheck.allowed).toBe(true);

    const emailCfg = getPlatformCloudflareEmailConfig();
    expect(emailCfg.isReady).toBe(true);
    expect(emailCfg.inboundDomain).toBe("bills.rapidshiftlabs.in");
    expect(emailCfg.webhookSecret.startsWith("rsl_cf_eml_")).toBe(true);

    const workerSnippet = buildCloudflareEmailWorkerSnippet("https://app.rapidshiftlabs.in");
    expect(workerSnippet).toContain("https://app.rapidshiftlabs.in/api/webhooks/cloudflare-email");
    expect(workerSnippet).toContain("X-RSL-Email-Secret");
  });

  it("validates Indian GSTIN Modulo-36 checksums, suggests typo fixes, and searches CBIC HSN/SAC rates", () => {
    const prefix14 = "27AABCU9603R1Z";
    const expected15th = computeGstinCheckDigit(prefix14);
    expect(expected15th).toBeTruthy();

    const validGstin = `${prefix14}${expected15th}`;
    const validRes = validateIndianGstin(validGstin, { strictChecksum: true });
    expect(validRes.isValid).toBe(true);
    expect(validRes.checksumValid).toBe(true);
    expect(validRes.stateCode).toBe("27");
    expect(validRes.stateName).toBe("Maharashtra");
    expect(validRes.pan).toBe("AABCU9603R");

    const wrongDigit = expected15th === "M" ? "9" : "M";
    const typoGstin = `${prefix14}${wrongDigit}`;
    const typoRes = validateIndianGstin(typoGstin, { strictChecksum: true });
    expect(typoRes.formatValid).toBe(true);
    expect(typoRes.checksumValid).toBe(false);
    expect(typoRes.isValid).toBe(false);
    expect(typoRes.suggestedGstin).toBe(validGstin);

    const hsnMatches = searchHsnSacCatalog("steel");
    expect(hsnMatches.length).toBeGreaterThan(0);
    expect(hsnMatches[0]?.gstRateBps).toBeGreaterThanOrEqual(0);
  });

  it("generates NPCI 0%-MDR UPI QR codes on signed public Tally bill payment portals and imports inbound supplier email bills", async () => {
    const prefix14 = "27AABCR4412K1Z";
    const validGstin = `${prefix14}${computeGstinCheckDigit(prefix14)}`;

    const reg = registerUserWithWorkspace({
      name: "Rajesh Shah",
      email: "rajesh.phase32@radiantindustrial.in",
      password: "StrongPassword#2026",
      businessName: "Radiant Industrial Co",
      stateCode: "27",
      gstin: validGstin,
      grantStarterTrialDays: 14,
    });

    staffGrantFreeAllToolsAccess({
      workspaceId: reg.workspaceId,
      durationDays: 30,
      staffId: "stf_phase32",
      note: "Phase 32 test entitlement",
    });

    updateWorkspaceBusinessSettings({
      workspaceId: reg.workspaceId,
      actorUserId: reg.userId,
      name: "Radiant Industrial Co",
      stateCode: "27",
      gstin: validGstin,
      city: "Mumbai",
      pincode: "400001",
      upiVpa: "radiantindustrial@okicici",
      upiPayeeName: "Radiant Industrial Co",
      bankName: "ICICI Bank",
      bankBranch: "Nariman Point",
      bankAccountNumber: "000405112233",
      bankIfsc: "ICIC0000004",
    });

    const ctx: TenantContext = {
      workspaceId: reg.workspaceId,
      actorType: "user",
      actorId: reg.userId,
      roleSlug: "owner",
      correlationId: newId("req"),
      requestId: newId("req"),
    };

    const saleRes = await recordTallyVoucher(ctx, {
      companyName: "Radiant Industrial FY26-27",
      voucherNumber: "INV-2026-501",
      voucherType: "Sales",
      partyName: "Apex Engineering Works",
      partyPhone: "+919820012345",
      amountRupees: 14750,
      paidAmountRupees: 2750,
      voucherDateIso: "2026-11-05",
      dueDateIso: "2026-11-20",
      lineItems: [
        {
          itemName: "SS 304 Industrial Valve",
          billedQty: 5,
          rateRupees: 2500,
          hsnCode: "8481",
          gstRatePct: 18,
        },
      ],
    });
    expect(saleRes.ok).toBe(true);
    if (!saleRes.ok) throw saleRes.error;

    const upiDirect = buildNpciUpiPayUri({
      upiVpa: "radiantindustrial@okicici",
      payeeName: "Radiant Industrial Co",
      amountPaise: 1200000,
      voucherNumber: "INV-2026-501",
    });
    expect(upiDirect.startsWith("upi://pay?")).toBe(true);
    expect(upiDirect).toContain("am=12000.00");

    const signedUrl = buildSignedPublicTallyBillPayUrl({
      workspaceId: reg.workspaceId,
      voucherId: saleRes.data.voucherId,
      baseUrl: "https://app.rapidshiftlabs.in",
    });
    const parsedUrl = new URL(signedUrl);
    const exp = Number(parsedUrl.searchParams.get("exp"));
    const sig = parsedUrl.searchParams.get("sig") || "";

    const portalView = await getPublicTallyBillPaymentView({
      workspaceId: reg.workspaceId,
      voucherId: saleRes.data.voucherId,
      expiresAt: exp,
      sig,
    });
    expect(portalView).not.toBeNull();
    expect(portalView?.voucher.balancePaise).toBe(1200000);
    expect(portalView?.upiUri).toContain("pa=radiantindustrial%40okicici");
    expect(portalView?.upiQrDataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    expect(portalView?.workspace.bankIfsc).toBe("ICIC0000004");

    // Tampered signature must be rejected
    const tamperedView = await getPublicTallyBillPaymentView({
      workspaceId: reg.workspaceId,
      voucherId: saleRes.data.voucherId,
      expiresAt: exp,
      sig: `${sig.slice(0, -4)}dead`,
    });
    expect(tamperedView).toBeNull();

    // Inbound Supplier Email Bill -> 1-Click Tally Purchase Voucher
    const vendorGstinPrefix = "24AAACC1206D1Z";
    const vendorGstin = `${vendorGstinPrefix}${computeGstinCheckDigit(vendorGstinPrefix)}`;
    const draftOut = await ingestInboundSupplierEmailBill({
      workspaceId: reg.workspaceId,
      senderEmail: "billing@shreesteelsurat.in",
      senderName: "Shree Steel Traders",
      subject: "Tax Invoice #SST/26-27/908 attached",
      bodyText: `Supplier: Shree Steel Traders\nGSTIN: ${vendorGstin}\nInvoice No: SST/26-27/908\nDate: 2026-11-06\nHSN: 7208\nGrand Total: Rs. 23,600.00`,
    });
    expect(draftOut.billNumber).toBe("SST/26-27/908");
    expect(draftOut.totalAmountPaise).toBe(2360000);

    const drafts = listSupplierBillDrafts(reg.workspaceId);
    expect(drafts.some((d) => d.id === draftOut.draftId)).toBe(true);

    const importRes = await importSupplierBillDraftToTally(ctx, {
      draftId: draftOut.draftId,
      companyName: "Radiant Industrial FY26-27",
    });
    expect(importRes.ok).toBe(true);
    if (importRes.ok) {
      expect(importRes.data.alreadyImported).toBe(false);
      expect(importRes.data.voucherId).toContain("tvch_");
    }
  });

  it("lints WhatsApp templates against Meta rejection rules and preserves {{n}} variables in regional translation", async () => {
    const riskyReport = await lintWhatsAppTemplateForMeta({
      category: "utility",
      bodyText: "{{1}}, hurry limited offer 50% discount! Pay at https://bit.ly/pay123 {{3}}",
    });
    expect(riskyReport.riskLevel).toBe("high");
    expect(riskyReport.recommendedCategory).toBe("marketing");
    expect(riskyReport.findings.some((f) => f.severity === "blocker")).toBe(true);

    const cleanReport = await lintWhatsAppTemplateForMeta({
      category: "utility",
      bodyText:
        "Hello {{1}}, your GST tax invoice #{{2}} for {{3}} has been generated. View or pay securely at {{4}}. Thank you for your business.",
    });
    expect(cleanReport.riskLevel).toBe("low");
    expect(cleanReport.findings).toHaveLength(0);

    const hindiRes = await translateIndianBusinessText({
      text: "Dear {{1}}, your invoice #{{2}} is due tomorrow. Thank you!",
      targetLanguage: "hi",
    });
    expect(hindiRes.ok).toBe(true);
    expect(hindiRes.translatedText).toContain("{{1}}");
    expect(hindiRes.translatedText).toContain("{{2}}");

    const adCopy = await generateSmartAdCopy({
      businessName: "Radiant Industrial Co",
      offerSummary: "SS 304 Industrial Valves with same-day Mumbai dispatch",
      channel: "google_ads",
    });
    expect(adCopy.headline.length).toBeGreaterThan(3);
    expect(adCopy.primaryText.length).toBeGreaterThan(15);
  });

  it("encrypts RFC 8291 Web Push payloads and completes full cryptographic WebAuthn Passkey registration & sign-in", () => {
    const vapid = ensurePlatformVapidConfig();
    expect(vapid.isReady).toBe(true);

    const subEcdh = crypto.createECDH("prime256v1");
    subEcdh.generateKeys();
    const subscriberP256dh = subEcdh.getPublicKey().toString("base64url");
    const subscriberAuth = crypto.randomBytes(16).toString("base64url");

    const encrypted = encryptWebPushPayloadAes128Gcm({
      plaintextUtf8: JSON.stringify({ title: "Receipt Synced", body: "₹12,000 received" }),
      subscriberP256dhBase64Url: subscriberP256dh,
      subscriberAuthBase64Url: subscriberAuth,
    });
    expect(encrypted.length).toBeGreaterThan(90);

    const vapidHeader = buildVapidAuthorizationHeader({
      endpoint: "https://fcm.googleapis.com/fcm/send/demo-token",
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKeyJwkJson: vapid.privateKeyJwkJson,
    });
    expect(vapidHeader.startsWith("vapid t=")).toBe(true);

    const owner = registerUserWithWorkspace({
      name: "Anita Desai",
      email: "anita.passkey@radiantindustrial.in",
      password: "PasskeyPassword#2026",
      businessName: "Desai Exports Pvt Ltd",
      stateCode: "27",
    });

    saveUserWebPushSubscription({
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/anita-device-1",
        keys: { p256dh: subscriberP256dh, auth: subscriberAuth },
      },
      userAgent: "Vitest Chrome/131",
    });
    expect(listUserWebPushSubscriptions(owner.userId)).toHaveLength(1);

    // WebAuthn ES256 Passkey E2E Ceremony
    const rpId = "app.rapidshiftlabs.in";
    const origin = "https://app.rapidshiftlabs.in";
    const regOpts = beginPasskeyRegistration({
      userId: owner.userId,
      userEmail: "anita.passkey@radiantindustrial.in",
      userName: "Anita Desai",
      rpId,
    });

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const credentialId = crypto.randomBytes(24).toString("base64url");

    const rpHash = crypto.createHash("sha256").update(rpId).digest();
    const flags = Buffer.from([0x05]); // UP=1, UV=1
    const signCount1 = Buffer.alloc(4);
    signCount1.writeUInt32BE(1, 0);
    const regAuthData = Buffer.concat([rpHash, flags, signCount1]);

    const regClientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: regOpts.challenge,
        origin,
      }),
      "utf8"
    );

    const savedPk = completePasskeyRegistration({
      userId: owner.userId,
      expectedRpId: rpId,
      expectedOrigin: origin,
      credentialId,
      clientDataJSONBase64Url: regClientData.toString("base64url"),
      authenticatorDataBase64Url: regAuthData.toString("base64url"),
      publicKeySpkiBase64Url: spkiDer.toString("base64url"),
      algorithm: -7,
      deviceLabel: "Anita MacBook Touch ID",
    });
    expect(savedPk.deviceLabel).toBe("Anita MacBook Touch ID");
    expect(listUserPasskeys(owner.userId)).toHaveLength(1);

    // Authenticate with Passkey (signCount = 2)
    const authOpts = beginPasskeyAuthentication({
      rpId,
      email: "anita.passkey@radiantindustrial.in",
    });
    expect(authOpts.allowCredentials).toHaveLength(1);

    const signCount2 = Buffer.alloc(4);
    signCount2.writeUInt32BE(2, 0);
    const assertionAuthData = Buffer.concat([rpHash, flags, signCount2]);
    const assertionClientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: authOpts.challenge,
        origin,
      }),
      "utf8"
    );
    const clientDataHash = crypto.createHash("sha256").update(assertionClientData).digest();
    const signatureDer = crypto.sign(
      "sha256",
      Buffer.concat([assertionAuthData, clientDataHash]),
      privateKey
    );

    const loginRes = completePasskeyAuthentication({
      challengeId: authOpts.challengeId,
      expectedRpId: rpId,
      expectedOrigin: origin,
      credentialId,
      clientDataJSONBase64Url: assertionClientData.toString("base64url"),
      authenticatorDataBase64Url: assertionAuthData.toString("base64url"),
      signatureBase64Url: signatureDer.toString("base64url"),
    });
    expect(loginRes.userId).toBe(owner.userId);
    expect(loginRes.workspaceId).toBe(owner.workspaceId);
    expect(loginRes.rawSessionToken.length).toBeGreaterThan(20);

    // Replay with stale signCount=2 must fail
    const replayOpts = beginPasskeyAuthentication({ rpId });
    const replayClientData = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: replayOpts.challenge,
        origin,
      }),
      "utf8"
    );
    const replaySig = crypto.sign(
      "sha256",
      Buffer.concat([
        assertionAuthData,
        crypto.createHash("sha256").update(replayClientData).digest(),
      ]),
      privateKey
    );
    expect(() =>
      completePasskeyAuthentication({
        challengeId: replayOpts.challengeId,
        expectedRpId: rpId,
        expectedOrigin: origin,
        credentialId,
        clientDataJSONBase64Url: replayClientData.toString("base64url"),
        authenticatorDataBase64Url: assertionAuthData.toString("base64url"),
        signatureBase64Url: replaySig.toString("base64url"),
      })
    ).toThrow(/counter/i);

    revokeUserPasskey({ userId: owner.userId, passkeyId: savedPk.id });
    expect(listUserPasskeys(owner.userId)).toHaveLength(0);
  });
});
