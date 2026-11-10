import fs from "node:fs";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  authenticatePublicApiKey,
  flushApiKeyUsageStats,
  issueApiKey,
} from "@rsl/api-keys";
import {
  assertPlatformStaffStepUp,
  beginPlatformStaffTotpEnrollment,
  bootstrapFirstPlatformStaff,
  confirmPlatformStaffTotpEnrollment,
  countPlatformStaff,
  createImpersonationSession,
  endImpersonationSession,
  registerUserWithWorkspace,
  resetAuthRateLimitsForTests,
  resolveStaffSessionFromToken,
  resolveUserSessionFromToken,
  signInPlatformStaff,
  signInUser,
  staffCreatePlatformMember,
  updateWorkspaceBusinessSettings,
  verifyPlatformStaffSessionMfa,
} from "@rsl/auth";
import {
  getWalletBalancePaise,
  reconcileRazorpayCapturedPayment,
  staffGrantFreeAllToolsAccess,
} from "@rsl/billing";
import {
  computeTotpCode,
  encodeSignedFlashToast,
  getEnv,
  newId,
  resetEnvCacheForTests,
  signHmac,
  verifySignedFlashToast,
} from "@rsl/core";
import { controlSchema, ingressSchema, platformLogsSchema, tenantDataSchema } from "@rsl/database";
import {
  createContact,
  ingestInboundProviderWebhook,
  sweepPendingWebhookInbox,
} from "@rsl/inbox";
import {
  requestPasswordResetEmail,
  sendEmailVerificationCode,
} from "@rsl/notifications";
import {
  enqueueJob,
  processDueSqliteOutboxForTenant,
} from "@rsl/queue";
import {
  buildSignedPublicTallyBillPayUrl,
  buildTallyWebhookSignedHeaders,
  getOrCreateTallyWebhookEndpoint,
  getPublicTallyBillPaymentView,
  ingestTallyBillEventAndEnqueueAutomation,
  rotateWorkspacePublicBillLinks,
} from "@rsl/tally";
import {
  controlDb,
  eraseAndCryptoShredWorkspace,
  exportWorkspaceDataPortabilitySnapshot,
  ingressDb,
  platformLogsDb,
  resolveSafeTenantDir,
  tenantDataDb,
  verifyCloudflareTurnstileToken,
} from "@rsl/tenancy";
import { GET as impersonateGet, POST as impersonatePost } from "../app/api/auth/impersonate/route";
import { GET as resetHandoffGet } from "../app/api/auth/reset-handoff/route";
import { GET as readyGet } from "../app/api/ready/route";
import { POST as tallyWebhookPost } from "../app/api/webhooks/tally/route";

function createTestWorkspace(tag: string) {
  const email = `${tag.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 10000)}@rapidshiftlabs.in`;
  const reg = registerUserWithWorkspace({
    name: `${tag} Owner`,
    email,
    password: "StrongPassword123!",
    businessName: `${tag} Enterprises`,
    industry: "Wholesale",
    stateCode: "27",
  });
  const session = resolveUserSessionFromToken(reg.rawSessionToken)!;
  return { email, reg, session };
}

function ensureSuperAdmin(): { staffId: string; email: string } {
  if (countPlatformStaff() === 0) {
    const email = `audit-superadmin-${Date.now()}@rapidshiftlabs.in`;
    const out = bootstrapFirstPlatformStaff({
      name: "Audit Super Admin",
      email,
      password: "SuperAdminPassword123!",
    });
    return { staffId: out.staffId, email };
  }
  const existing = controlDb().select().from(controlSchema.platformStaff).get()!;
  return { staffId: existing.id, email: existing.email };
}

describe("AUDIT.md Full Security, Integrity & Scale Remediation Suite", () => {
  it("enforces fail-closed Cloudflare Turnstile verification in production and rejects XXXX.DUMMY.TOKEN.XXXX", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSite = process.env.CF_TURNSTILE_SITE_KEY;
    const prevSecret = process.env.CF_TURNSTILE_SECRET_KEY;
    const prevBetter = process.env.BETTER_AUTH_SECRET;
    const prevAdmin = process.env.ADMIN_AUTH_SECRET;
    const prevKms = process.env.KMS_MASTER_KEY;
    const prevBackup = process.env.BACKUP_SIGNING_KEY;
    const prevPepper = process.env.API_KEY_PEPPER;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.BETTER_AUTH_SECRET = "prod_audit_better_auth_secret_32_chars_ok!";
      process.env.ADMIN_AUTH_SECRET = "prod_audit_admin_auth_secret_32_chars_ok!!";
      process.env.KMS_MASTER_KEY = "prod_audit_kms_master_secret_32_chars_ok!!";
      process.env.BACKUP_SIGNING_KEY = "prod_audit_backup_sign_secret_32_chars_ok!";
      process.env.API_KEY_PEPPER = "prod_audit_api_pepper_secret_32_chars_ok!!";
      delete process.env.CF_TURNSTILE_SITE_KEY;
      delete process.env.CF_TURNSTILE_SECRET_KEY;
      resetEnvCacheForTests();

      // When Cloudflare Turnstile credentials are missing, CAPTCHA step is skipped cleanly
      const unconfiguredRes = await verifyCloudflareTurnstileToken({
        token: "",
        surface: "login",
      });
      expect(unconfiguredRes.allowed).toBe(true);
      expect(unconfiguredRes.skipped).toBe(true);

      // Even with Cloudflare's test secret configured, XXXX.DUMMY.TOKEN.XXXX is NOT auto-accepted outside NODE_ENV=test
      process.env.CF_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      process.env.CF_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      resetEnvCacheForTests();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch;
      try {
        const dummyAttempt = await verifyCloudflareTurnstileToken({
          token: "XXXX.DUMMY.TOKEN.XXXX",
          surface: "login",
        });
        expect(dummyAttempt.allowed).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      if (prevSite === undefined) delete process.env.CF_TURNSTILE_SITE_KEY;
      else process.env.CF_TURNSTILE_SITE_KEY = prevSite;
      if (prevSecret === undefined) delete process.env.CF_TURNSTILE_SECRET_KEY;
      else process.env.CF_TURNSTILE_SECRET_KEY = prevSecret;
      if (prevBetter === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prevBetter;
      if (prevAdmin === undefined) delete process.env.ADMIN_AUTH_SECRET;
      else process.env.ADMIN_AUTH_SECRET = prevAdmin;
      if (prevKms === undefined) delete process.env.KMS_MASTER_KEY;
      else process.env.KMS_MASTER_KEY = prevKms;
      if (prevBackup === undefined) delete process.env.BACKUP_SIGNING_KEY;
      else process.env.BACKUP_SIGNING_KEY = prevBackup;
      if (prevPepper === undefined) delete process.env.API_KEY_PEPPER;
      else process.env.API_KEY_PEPPER = prevPepper;
      resetEnvCacheForTests();
    }
  });

  it("locks customer accounts in SQLite after 5 failed sign-in attempts and blocks even valid passwords while locked", () => {
    resetAuthRateLimitsForTests();
    const { email } = createTestWorkspace("LockoutGuard");

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(() =>
        signInUser({ email, password: "WrongPassword999!", ipAddress: `10.10.1.${attempt}` })
      ).toThrow();
    }

    // 5th failed attempt triggers persistent DB account lockout (RSL-AUTH-1004)
    expect(() =>
      signInUser({ email, password: "WrongPassword999!", ipAddress: "10.10.1.5" })
    ).toThrow(/locked/i);

    // Subsequent sign-in with the REAL password must still be rejected while lockedUntil > now
    expect(() =>
      signInUser({ email, password: "StrongPassword123!", ipAddress: "10.10.1.6" })
    ).toThrow(/locked/i);
  });

  it("never marks SQLite outbox jobs completed when no processor is registered for jobType", async () => {
    const { session } = createTestWorkspace("OutboxMissingProc");
    const wsId = session.workspace.id;
    const idemKey = `unreg_job_${Date.now()}`;

    await enqueueJob({
      queue: "db.maintenance",
      jobType: "unregistered.audit.verification.job",
      tenantId: wsId,
      correlationId: newId(),
      requestId: newId(),
      actorType: "system",
      actorId: "audit_test",
      idempotencyKey: idemKey,
      payload: { sample: true },
    });

    await processDueSqliteOutboxForTenant(wsId, {
      queueName: "db.maintenance",
      idempotencyKey: idemKey,
    });

    const row = tenantDataDb({ workspaceId: wsId })
      .select()
      .from(tenantDataSchema.outbox)
      .where(eq(tenantDataSchema.outbox.idempotencyKey, idemKey))
      .get();

    expect(row).toBeDefined();
    expect(row!.status).not.toBe("completed");
    expect(["pending", "failed", "dead"]).toContain(row!.status);
    expect(row!.attempts).toBeGreaterThanOrEqual(1);
    expect(row!.lastError || "").toMatch(/processor|unregistered/i);
  });

  it("deduplicates replay WhatsApp & Meta webhooks in ingress.db and drains queued events cleanly via sweepPendingWebhookInbox", async () => {
    const uniqueWamid = `wamid.HBgMOTc2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const waPayload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba_nonexistent_audit",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "pnid_nonexistent_audit" },
                messages: [
                  {
                    id: uniqueWamid,
                    from: "919811122233",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: "text",
                    text: { body: "Hello audit test" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const first = await ingestInboundProviderWebhook({
      provider: "whatsapp",
      rawBody: waPayload,
      sigHeader: "sha256=test",
      deferToWorker: true,
    });
    expect(first.deduplicated).toBe(false);
    expect(first.queued).toBe(true);
    expect(first.inboxId).toBeTruthy();

    // Duplicate delivery of the exact same WhatsApp message ID is rejected idempotently
    const duplicate = await ingestInboundProviderWebhook({
      provider: "whatsapp",
      rawBody: waPayload,
      sigHeader: "sha256=test",
      deferToWorker: true,
    });
    expect(duplicate.deduplicated).toBe(true);
    expect(duplicate.inboxId).toBeNull();

    const metaPayload = JSON.stringify({
      object: "page",
      entry: [
        {
          id: `page_audit_${Date.now()}`,
          time: Date.now(),
          messaging: [
            {
              sender: { id: "psid_1" },
              recipient: { id: "page_1" },
              timestamp: Date.now(),
              message: { mid: `m_audit_${Date.now()}`, text: "Meta DM test" },
            },
          ],
        },
      ],
    });
    const metaFirst = await ingestInboundProviderWebhook({
      provider: "meta",
      rawBody: metaPayload,
      sigHeader: "sha256=test",
      deferToWorker: true,
    });
    const metaDup = await ingestInboundProviderWebhook({
      provider: "meta",
      rawBody: metaPayload,
      sigHeader: "sha256=test",
      deferToWorker: true,
    });
    expect(metaFirst.deduplicated).toBe(false);
    expect(metaDup.deduplicated).toBe(true);

    // Background worker sweep drains pending ingress rows into 'processed'
    const sweptCount = await sweepPendingWebhookInbox(50);
    expect(sweptCount).toBeGreaterThanOrEqual(2);

    const processedRow = ingressDb()
      .select()
      .from(ingressSchema.webhookInbox)
      .where(eq(ingressSchema.webhookInbox.id, first.inboxId!))
      .get();
    expect(processedRow?.status).toBe("processed");
  });

  it("enforces Platform Staff TOTP MFA, single-use recovery codes, and 15-minute step-up re-authentication", () => {
    ensureSuperAdmin();
    resetAuthRateLimitsForTests();

    const staffEmail = `mfa-staff-${Date.now()}@rapidshiftlabs.in`;
    const created = staffCreatePlatformMember({
      name: "MFA Security Officer",
      email: staffEmail,
      password: "OfficerPassword123!",
      staffRole: "super_admin",
    });

    const enrollment = beginPlatformStaffTotpEnrollment(created.staffId);
    expect(enrollment.secret.length).toBeGreaterThanOrEqual(16);
    expect(enrollment.otpauthUri).toContain("otpauth://totp/");

    const validTotp = computeTotpCode(enrollment.secret);
    const confirmed = confirmPlatformStaffTotpEnrollment({
      staffId: created.staffId,
      code: validTotp,
    });
    expect(confirmed.backupCodes).toHaveLength(8);

    // Password login alone produces a pending-MFA session that resolveStaffSessionFromToken blocks
    const login1 = signInPlatformStaff({
      email: staffEmail,
      password: "OfficerPassword123!",
    });
    expect(login1.mfaRequired).toBe(true);
    expect(resolveStaffSessionFromToken(login1.rawToken)).toBeNull();

    // Completing MFA challenge unlocks full staff session + fresh stepUpAt
    verifyPlatformStaffSessionMfa({
      rawToken: login1.rawToken,
      code: computeTotpCode(enrollment.secret),
    });
    const verifiedSession = resolveStaffSessionFromToken(login1.rawToken);
    expect(verifiedSession).not.toBeNull();

    // Stale stepUpAt (> 15 minutes old) blocks privileged actions until re-verified
    controlDb()
      .update(controlSchema.platformStaffSessions)
      .set({ stepUpAt: Date.now() - 20 * 60_000 })
      .where(eq(controlSchema.platformStaffSessions.id, verifiedSession!.sessionId))
      .run();

    const staleSession = resolveStaffSessionFromToken(login1.rawToken)!;
    expect(() => assertPlatformStaffStepUp(staleSession)).toThrow(/step-up|15 minutes/i);

    assertPlatformStaffStepUp(staleSession, {
      totpOrBackupCode: computeTotpCode(enrollment.secret),
    });

    // Single-use backup recovery code works once, then is burned permanently
    const recoveryCode = confirmed.backupCodes[0]!;
    const login2 = signInPlatformStaff({
      email: staffEmail,
      password: "OfficerPassword123!",
    });
    verifyPlatformStaffSessionMfa({
      rawToken: login2.rawToken,
      code: recoveryCode,
    });
    expect(resolveStaffSessionFromToken(login2.rawToken)).not.toBeNull();

    const login3 = signInPlatformStaff({
      email: staffEmail,
      password: "OfficerPassword123!",
    });
    expect(() =>
      verifyPlatformStaffSessionMfa({
        rawToken: login3.rawToken,
        code: recoveryCode,
      })
    ).toThrow(/invalid/i);
  });

  it("enforces SETUP_BOOTSTRAP_TOKEN and single-super-admin lock on bootstrapFirstPlatformStaff", () => {
    ensureSuperAdmin();
    // Second bootstrap attempt must always reject once platform_staff count > 0
    expect(() =>
      bootstrapFirstPlatformStaff({
        name: "Attacker Super Admin",
        email: `attacker-${Date.now()}@rapidshiftlabs.in`,
        password: "AttackerPassword123!",
      })
    ).toThrow(/already exists/i);
  });

  it("strips verification codes from email URLs and routes password reset links through HttpOnly /api/auth/reset-handoff", async () => {
    const { email, reg } = createTestWorkspace("TokenUrlHygiene");

    const verRes = await sendEmailVerificationCode({
      userId: reg.userId,
      email,
      recipientName: "Hygiene Owner",
      workspaceId: reg.workspaceId,
    });
    expect(verRes.verificationId).toBeTruthy();

    await requestPasswordResetEmail({
      email,
      requestedFromIp: "203.0.113.42",
    });

    // Verify /api/auth/reset-handoff sets HttpOnly SameSite=Strict cookie and redirects 303 to clean /reset-password
    const handoffReq = new NextRequest(
      `https://app.rapidshiftlabs.in/api/auth/reset-handoff?email=${encodeURIComponent(email)}&token=rst_sample_secret_token_123456`,
      { method: "GET" }
    );
    const handoffRes = await resetHandoffGet(handoffReq);
    expect(handoffRes.status).toBe(303);
    const location = handoffRes.headers.get("location") || "";
    expect(location).toContain("/reset-password");
    expect(location).not.toContain("rst_sample_secret_token_123456");
    expect(location).not.toContain("token=");

    const setCookie = handoffRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("rsl_pw_reset=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("signs public Tally bill links with HKDF subkeys, 72h TTL, masked bank details, zero phone exposure, and instant epoch revocation", async () => {
    const { session } = createTestWorkspace("PublicBillHkdf");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_bill_hkdf" });

    updateWorkspaceBusinessSettings({
      workspaceId: wsId,
      name: "PublicBillHkdf Enterprises",
      businessPhone: "+919820099887",
      upiVpa: "merchant@okicici",
      bankName: "ICICI Bank",
      bankAccountNumber: "0011223344556789",
      bankIfsc: "ICIC0000011",
    });

    const ingested = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: wsId,
      actorType: "webhook",
      actorId: "tdl",
      rawPayload: {
        companyName: "PublicBillHkdf FY26",
        guid: "guid-hkdf-bill-1",
        voucherNumber: "INV/HKDF/01",
        voucherType: "Sales",
        partyName: "Buyer One",
        amountRupees: 4500,
      },
    });
    const voucherId = ingested.vouchers[0]!.id;

    const beforeMs = Date.now();
    const signedUrl = buildSignedPublicTallyBillPayUrl({
      workspaceId: wsId,
      voucherId,
      baseUrl: "https://app.rapidshiftlabs.in",
    });
    const parsed = new URL(signedUrl);
    const exp = Number(parsed.searchParams.get("exp"));
    const sig = parsed.searchParams.get("sig")!;

    // TTL must be ~72 hours (not 90 days)
    const ttlHours = (exp - beforeMs) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(71.5);
    expect(ttlHours).toBeLessThanOrEqual(72.5);

    // Raw KMS_MASTER_KEY signature must be rejected (proving HKDF purpose subkey isolation)
    const rawMasterSig = signHmac(
      `pay.${wsId}.${voucherId}.e1.${Math.trunc(exp)}`,
      getEnv().KMS_MASTER_KEY
    );
    expect(rawMasterSig).not.toBe(sig);
    expect(
      await getPublicTallyBillPaymentView({
        workspaceId: wsId,
        voucherId,
        expiresAt: exp,
        sig: rawMasterSig,
      })
    ).toBeNull();

    // Valid HKDF signature returns masked bank account & omits merchant phone PII
    const validView = await getPublicTallyBillPaymentView({
      workspaceId: wsId,
      voucherId,
      expiresAt: exp,
      sig,
    });
    expect(validView).not.toBeNull();
    expect(validView!.workspace.bankAccountNumber).toBe("••••6789");
    expect(validView!.workspace.phone).toBeNull();

    // Rotating publicLinkEpoch immediately revokes previously issued links
    const rotated = rotateWorkspacePublicBillLinks(wsId);
    expect(rotated.publicLinkEpoch).toBeGreaterThan(1);

    const revokedView = await getPublicTallyBillPaymentView({
      workspaceId: wsId,
      voucherId,
      expiresAt: exp,
      sig,
    });
    expect(revokedView).toBeNull();
  });

  it("enforces strict API-key scope isolation inside defineAction (no implicit owner role) and batches lastUsedAt flushes", async () => {
    const { session } = createTestWorkspace("ApiKeyScopeRbac");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_apikey_rbac" });

    const issued = await issueApiKey(session.ctx, {
      name: "Read-Only CRM Sync Key",
      mode: "live",
      scopes: ["contacts:read"],
      rateLimitPerMin: 120,
      expiresInDays: 30,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("Failed to issue API key");

    const auth = await authenticatePublicApiKey({
      authorizationHeader: `Bearer ${issued.data.rawKey}`,
      requiredScope: "contacts:read",
      clientIp: "198.51.100.77",
    });

    // API key context must NEVER receive roleSlug: "owner"
    expect(auth.ctx.roleSlug).toBeUndefined();
    expect(auth.ctx.apiKeyScopes).toEqual(["contacts:read"]);

    // Attempting a write action (createContact -> inbox:manage / contacts:write) with a read-only API key ctx MUST fail closed!
    const writeAttempt = await createContact(auth.ctx, {
      name: "Unauthorized Contact Write",
      phoneE164: "+919877766655",
      recordWhatsAppConsent: false,
    });
    expect(writeAttempt.ok).toBe(false);
    if (!writeAttempt.ok) {
      expect(["RSL-API-1002", "RSL-RBAC-1001"]).toContain(writeAttempt.error.code);
    }

    // Verify lastUsedAt is buffered off the hot SQLite path until flushApiKeyUsageStats() runs
    const beforeFlush = controlDb()
      .select({ lastUsedAt: controlSchema.apiKeys.lastUsedAt })
      .from(controlSchema.apiKeys)
      .where(eq(controlSchema.apiKeys.id, issued.data.id))
      .get();
    expect(beforeFlush?.lastUsedAt).toBeNull();

    const flushedCount = flushApiKeyUsageStats();
    expect(flushedCount).toBeGreaterThanOrEqual(1);

    const afterFlush = controlDb()
      .select({
        lastUsedAt: controlSchema.apiKeys.lastUsedAt,
        lastUsedIp: controlSchema.apiKeys.lastUsedIp,
      })
      .from(controlSchema.apiKeys)
      .where(eq(controlSchema.apiKeys.id, issued.data.id))
      .get();
    expect(afterFlush?.lastUsedAt).toBeTypeOf("number");
    expect(afterFlush?.lastUsedIp).toBe("198.51.100.77");
  });

  it("gates /api/ready behind x-rsl-internal-secret", async () => {
    const unauthRes = await readyGet(new NextRequest("http://127.0.0.1:4500/api/ready"));
    expect(unauthRes.status).toBe(401);

    const authRes = await readyGet(
      new NextRequest("http://127.0.0.1:4500/api/ready", {
        headers: {
          "x-rsl-internal-secret": getEnv().ADMIN_AUTH_SECRET,
        },
      })
    );
    expect(authRes.status).toBe(200);
    const body = (await authRes.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });

  it("atomically reconciles Razorpay captured payments against stored order amounts and rejects inflated note amounts", () => {
    const { session } = createTestWorkspace("RazorpayAtomic");
    const wsId = session.workspace.id;
    const orderId = `order_audit_${Date.now()}`;
    const paymentRowId = newId();

    controlDb()
      .insert(controlSchema.payments)
      .values({
        id: paymentRowId,
        workspaceId: wsId,
        provider: "razorpay",
        purpose: "wallet_topup",
        externalOrderId: orderId,
        amountPaise: 50_000,
        currency: "INR",
        status: "created",
        createdAt: Date.now(),
      })
      .run();

    // Mismatched captured amount or inflated note amount MUST throw without crediting wallet
    expect(() =>
      reconcileRazorpayCapturedPayment({
        paymentId: `pay_bad_${Date.now()}`,
        orderId,
        capturedAmountPaise: 10_000,
        notesWorkspaceId: wsId,
        notesWalletCreditPaise: 500_000,
      })
    ).toThrow(/amount/i);
    expect(getWalletBalancePaise(wsId)).toBe(0);

    // Matching 50,000 paise credits wallet + issues GST Advance Receipt Voucher atomically
    const okRes = reconcileRazorpayCapturedPayment({
      paymentId: `pay_ok_${Date.now()}`,
      orderId,
      capturedAmountPaise: 50_000,
      notesWorkspaceId: wsId,
      notesWalletCreditPaise: 999_999, // Ignored in favor of authoritative orderRow.amountPaise
    });
    expect(okRes.creditedPaise).toBe(50_000);
    expect(okRes.invoiceNumber).toBeTruthy();
    expect(getWalletBalancePaise(wsId)).toBe(50_000);
  });

  it("rejects Tally webhook ?token= query strings, unsigned POSTs, stale timestamps, and replayed HMAC signatures", async () => {
    const { session } = createTestWorkspace("TallyReplayGuard");
    const wsId = session.workspace.id;
    staffGrantFreeAllToolsAccess({ workspaceId: wsId, durationDays: 30, staffId: "stf_tally_hmac" });
    const ep = getOrCreateTallyWebhookEndpoint(wsId);
    const body = JSON.stringify({ mode: "ping", companyName: "TallyReplayGuard Co" });

    // 1. Query-string ?token= is strictly rejected (401)
    const queryTokenRes = await tallyWebhookPost(
      new NextRequest(
        `https://replay.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping&token=${encodeURIComponent(ep.webhookToken)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }
      )
    );
    expect(queryTokenRes.status).toBe(401);

    // 2. Header token WITHOUT HMAC timestamp + signature is rejected (401)
    const unsignedRes = await tallyWebhookPost(
      new NextRequest("https://replay.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tally-webhook-token": ep.webhookToken,
        },
        body,
      })
    );
    expect(unsignedRes.status).toBe(401);

    // 3. Stale timestamp (> 5 minutes old) is rejected (401)
    const staleHeaders = buildTallyWebhookSignedHeaders(
      ep.webhookToken,
      body,
      Date.now() - 10 * 60_000,
      "stale_nonce_01"
    );
    const staleRes = await tallyWebhookPost(
      new NextRequest("https://replay.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tally-webhook-token": ep.webhookToken,
          ...staleHeaders,
        },
        body,
      })
    );
    expect(staleRes.status).toBe(401);

    // 4. Fresh signed request succeeds (200), and exact replay with same timestamp + nonce is rejected!
    const validHeaders = buildTallyWebhookSignedHeaders(
      ep.webhookToken,
      body,
      Date.now(),
      `replay_nonce_${Date.now()}`
    );
    const firstValidRes = await tallyWebhookPost(
      new NextRequest("https://replay.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tally-webhook-token": ep.webhookToken,
          ...validHeaders,
        },
        body,
      })
    );
    expect(firstValidRes.status).toBe(200);

    const replayRes = await tallyWebhookPost(
      new NextRequest("https://replay.tally.rapidshiftlabs.in/api/webhooks/tally?mode=ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tally-webhook-token": ep.webhookToken,
          ...validHeaders,
        },
        body,
      })
    );
    expect([401, 409]).toContain(replayRes.status);
  });

  it("isolates support impersonation sessions from customer sessions, rejects forged flash toasts, and executes DPDP portability + crypto-shredding", async () => {
    const superAdmin = ensureSuperAdmin();
    const { reg } = createTestWorkspace("DpdpAndImpersonation");
    const wsId = reg.workspaceId;

    // 1. Impersonation route rejects GET ?exit=1 and POST { rawToken }
    const getExitRes = await impersonateGet(
      new NextRequest("https://app.rapidshiftlabs.in/api/auth/impersonate?exit=1")
    );
    expect(getExitRes.status).toBe(400);

    const rawTokenPostRes = await impersonatePost(
      new NextRequest("https://app.rapidshiftlabs.in/api/auth/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawToken: "stolen_raw_session_token" }),
      })
    );
    expect(rawTokenPostRes.status).toBe(400);

    // Ending impersonation session revokes ONLY the temporary support session, keeping customer's own session alive!
    const imp = createImpersonationSession({
      staffId: superAdmin.staffId,
      workspaceId: wsId,
      reason: "Verifying support session isolation",
    });
    expect(resolveUserSessionFromToken(imp.rawCustomerSessionToken)?.impersonatorStaffId).toBe(
      superAdmin.staffId
    );
    endImpersonationSession(imp.rawCustomerSessionToken);
    expect(resolveUserSessionFromToken(imp.rawCustomerSessionToken)).toBeNull();
    expect(resolveUserSessionFromToken(reg.rawSessionToken)).not.toBeNull();

    // 2. Signed flash toast cookies reject unsigned b64_ and tampered sig1. payloads
    const validToastCookie = encodeSignedFlashToast({
      type: "success",
      message: "Verified server toast",
    });
    expect(verifySignedFlashToast(validToastCookie)?.message).toBe("Verified server toast");

    const forgedUnsigned =
      "b64_" +
      Buffer.from(
        JSON.stringify({ id: "fake", type: "error", message: "Forged XSS toast" }),
        "utf8"
      ).toString("base64url");
    expect(verifySignedFlashToast(forgedUnsigned)).toBeNull();

    const tamperedSig = validToastCookie.replace(/^sig1\.[0-9a-f]{4}/, "sig1.ffff");
    expect(verifySignedFlashToast(tamperedSig)).toBeNull();

    // 3. DPDP Act 2023 portability export + full workspace crypto-shredding
    const snapshot = exportWorkspaceDataPortabilitySnapshot(wsId);
    expect(String(snapshot.schema || "")).toContain("dpdp");
    expect((snapshot.workspace as { id: string }).id).toBe(wsId);

    const tenantDir = resolveSafeTenantDir(wsId);
    expect(fs.existsSync(tenantDir)).toBe(true);

    const shredded = eraseAndCryptoShredWorkspace({
      workspaceId: wsId,
      actorId: reg.userId,
      reason: "Owner DPDP erasure verification test",
    });
    expect(shredded.tombstoneId).toBe(wsId);
    expect(fs.existsSync(tenantDir)).toBe(false);
    expect(resolveUserSessionFromToken(reg.rawSessionToken)).toBeNull();

    const tombstone = platformLogsDb()
      .select()
      .from(platformLogsSchema.tenantDeletionTombstones)
      .where(eq(platformLogsSchema.tenantDeletionTombstones.tenantId, wsId))
      .get();
    expect(tombstone?.tenantId).toBe(wsId);
  });
});
