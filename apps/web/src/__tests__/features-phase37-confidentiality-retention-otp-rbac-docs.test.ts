import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  beginPlatformStaffTotpEnrollment,
  beginUserTotpEnrollment,
  bootstrapFirstPlatformStaff,
  confirmUserTotpEnrollment,
  countPlatformStaff,
  disableUserTotpMfa,
  getUserTotpStatus,
  listPlatformStaffMembers,
  registerUserWithWorkspace,
  signInUser,
  verifyUserTotpOrBackupCode,
} from "@rsl/auth";
import {
  buildTotpQrCodeDataUri,
  buildTotpQrCodeSvgMarkup,
  computeTotpCode,
} from "@rsl/core";
import {
  canRoleAccessWebRoute,
  canRolePerform,
  normalizeSystemRoleSlug,
  SYSTEM_ROLES,
} from "@rsl/rbac";
import {
  getTallyWorkspaceSummary,
  getWorkspaceConfidentialityPolicy,
  getWorkspacePartiesLedgerSummary,
  isConfidentialityUnmaskActive,
  listWorkspaceTallyVouchers,
  maskConfidentialCompanyName,
  maskConfidentialEmail,
  maskConfidentialGstin,
  maskConfidentialPhone,
  recordTallyVoucher,
  requestConfidentialityUnmaskOtp,
  revokeConfidentialityUnmaskGrant,
  runWorkspaceDataRetentionSweep,
  verifyConfidentialityUnmaskOtp,
  writeWorkspaceConfidentialityPolicy,
} from "@rsl/tally";
import {
  getWorkspaceStorageStatus,
  putWorkspaceObject,
  readWorkspaceObjectBytes,
} from "@rsl/storage";
import {
  buildCloudflareOneClickConnectUrl,
  clearPlatformCredentialOverride,
  connectWorkspaceCloudflareOneClick,
  deriveCloudflareR2S3Credentials,
  disconnectWorkspaceCloudflare,
  generateSmartAdCopy,
  getWorkspaceCloudflareStatus,
  probeWorkspaceCloudflareConnection,
  provisionWorkspaceCloudflareResource,
  runCloudflareWorkersAiText,
  updateWorkspaceCloudflareWorkloads,
  verifyCloudflareTurnstileToken,
} from "@rsl/tenancy";
import { TotpQrCodeCard, TurnstileWidget } from "@rsl/ui";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Phase 37 - Confidentiality Vault, Custom Retention, 6-Digit OTP Reveal, Strict RBAC, Turnstile Skip & 2026 Docs", () => {
  let userId = "";
  let secondUserId = "";
  let workspaceId = "";

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const reg = await registerUserWithWorkspace({
      name: "Confidentiality Owner",
      email: `vault-owner-${suffix}@rapidshiftlabs.in`,
      password: "Password123!",
      businessName: `Vault Industries ${suffix}`,
      industry: "Manufacturing",
    });
    userId = reg.userId;
    workspaceId = reg.workspaceId;

    const secondReg = await registerUserWithWorkspace({
      name: "Second Colleague",
      email: `vault-colleague-${suffix}@rapidshiftlabs.in`,
      password: "Password123!",
      businessName: `Colleague Co ${suffix}`,
      industry: "Wholesale",
    });
    secondUserId = secondReg.userId;
  });

  it("skips Cloudflare Turnstile verification and widget rendering when credentials are missing", async () => {
    clearPlatformCredentialOverride("cloudflare_turnstile");
    const prevSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const prevSecret = process.env.TURNSTILE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    try {
      const verification = await verifyCloudflareTurnstileToken({
        token: null,
        remoteIp: "127.0.0.1",
        surface: "login",
      });
      expect(verification.allowed).toBe(true);
      expect(verification.skipped).toBe(true);

      const html = renderToStaticMarkup(
        React.createElement(TurnstileWidget, { siteKey: "" })
      );
      expect(html).toBe("");
    } finally {
      if (prevSite !== undefined) process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = prevSite;
      if (prevSecret !== undefined) process.env.TURNSTILE_SECRET_KEY = prevSecret;
    }
  });

  it("masks supplier/buyer identities in portal views while allowing API-only cleartext and 6-digit OTP reveal", async () => {
    expect(maskConfidentialCompanyName("Shree Ganesh Traders Pvt Ltd")).toContain("•••");
    expect(maskConfidentialGstin("27AABCU9603R1ZM")).toBe("27AA••••••••1ZM");
    expect(maskConfidentialPhone("+919820012345")).toContain("••••• ••345");
    expect(maskConfidentialEmail("accounts@shreeganesh.in")).toContain("••••@");

    // Record a sample sales bill with buyer company and phone
    await recordTallyVoucher(
      {
        workspaceId,
        actorType: "user",
        actorId: userId,
        roleSlug: "owner",
        correlationId: "req_vault_test_1",
        requestId: "req_vault_test_1",
      },
      {
        voucherNumber: "INV-VAULT-101",
        voucherType: "Sales",
        partyName: "Mahavir Copper Cables Pvt Ltd",
        partyPhoneE164: "+919820099887",
        companyName: "Vault Industries Main",
        amountRupees: 45800,
        voucherDateIso: "2026-11-01",
        dueDateIso: "2026-12-15",
      }
    );

    // Enable masking + API-only unmasked mode
    writeWorkspaceConfidentialityPolicy(workspaceId, {
      saveBillsAndDetails: true,
      autoDeleteRetentionHours: 72,
      maskCompanyAndContactDetails: true,
      allowApiUnmaskedAccessOnly: true,
      requireOtpToUnmask: true,
    });

    const policy = getWorkspaceConfidentialityPolicy(workspaceId);
    expect(policy.maskCompanyAndContactDetails).toBe(true);
    expect(policy.allowApiUnmaskedAccessOnly).toBe(true);
    expect(policy.autoDeleteRetentionHours).toBe(72);

    // Portal view is masked
    const portalVouchers = listWorkspaceTallyVouchers(workspaceId, {
      limit: 20,
      userId,
      forPublicApi: false,
    });
    const portalRow = portalVouchers.items.find((v) => v.voucherNumber === "INV-VAULT-101");
    expect(portalRow).toBeDefined();
    expect(portalRow?.partyName).not.toContain("Mahavir Copper");
    expect(portalRow?.partyName).toContain("•");

    // Public API view (/api/v1/vouchers) receives unmasked cleartext
    const apiVouchers = listWorkspaceTallyVouchers(workspaceId, {
      limit: 20,
      forPublicApi: true,
    });
    const apiRow = apiVouchers.items.find((v) => v.voucherNumber === "INV-VAULT-101");
    expect(apiRow?.partyName).toBe("Mahavir Copper Cables Pvt Ltd");

    // Switch allowApiUnmaskedAccessOnly off and test 6-digit OTP reveal for userId
    writeWorkspaceConfidentialityPolicy(workspaceId, {
      allowApiUnmaskedAccessOnly: false,
      requireOtpToUnmask: true,
    });

    const otpReq = requestConfidentialityUnmaskOtp({
      workspaceId,
      userId,
    });
    expect(otpReq.otpSent).toBe(true);
    expect(otpReq.devOtpCode).toMatch(/^\d{6}$/);

    // Wrong code throws an auth error
    expect(() =>
      verifyConfidentialityUnmaskOtp({
        workspaceId,
        userId,
        code: "000000",
      })
    ).toThrow();

    // Valid 6-digit OTP unlocks cleartext for userId for 15 minutes
    const goodVerify = verifyConfidentialityUnmaskOtp({
      workspaceId,
      userId,
      code: otpReq.devOtpCode!,
    });
    expect(goodVerify.unmasked).toBe(true);
    expect(isConfidentialityUnmaskActive(workspaceId, userId).active).toBe(true);

    // userId now sees cleartext in portal, while secondUserId still sees masked company names
    const unlockedVouchers = listWorkspaceTallyVouchers(workspaceId, {
      limit: 20,
      userId,
      forPublicApi: false,
    });
    expect(
      unlockedVouchers.items.find((v) => v.voucherNumber === "INV-VAULT-101")?.partyName
    ).toBe("Mahavir Copper Cables Pvt Ltd");

    const colleagueParties = getWorkspacePartiesLedgerSummary(workspaceId, undefined, {
      userId: secondUserId,
    });
    expect(colleagueParties.confidentiality.isMasked).toBe(true);
    expect(colleagueParties.parties.every((r) => !r.name.includes("Mahavir Copper"))).toBe(
      true
    );

    // Revoking unmask grant immediately re-masks portal queries
    revokeConfidentialityUnmaskGrant({ workspaceId, userId });
    expect(isConfidentialityUnmaskActive(workspaceId, userId).active).toBe(false);
    const relockedSummary = getTallyWorkspaceSummary(workspaceId, { userId });
    expect(relockedSummary.confidentiality.isMasked).toBe(true);
  });

  it("enforces custom auto-delete retention windows and Zero-Persistence Ephemeral Mode", async () => {
    const suffix = Date.now().toString(36);
    const ws = await registerUserWithWorkspace({
      name: "Ephemeral Owner",
      email: `ephemeral-${suffix}@rapidshiftlabs.in`,
      password: "Password123!",
      businessName: `Ephemeral Vault ${suffix}`,
      industry: "Distribution",
    });

    // Enable Zero-Persistence Ephemeral Mode (saveBillsAndDetails = false)
    writeWorkspaceConfidentialityPolicy(ws.workspaceId, {
      saveBillsAndDetails: false,
      autoDeleteRetentionHours: 0,
    });

    await recordTallyVoucher(
      {
        workspaceId: ws.workspaceId,
        actorType: "user",
        actorId: ws.userId,
        roleSlug: "owner",
        correlationId: "req_vault_test_2",
        requestId: "req_vault_test_2",
      },
      {
        voucherNumber: "INV-EPHEMERAL-1",
        voucherType: "Sales",
        partyName: "Secret Buyer LLP",
        partyPhoneE164: "+919811122233",
        amountRupees: 19500,
        voucherDateIso: "2026-11-01",
        dueDateIso: "2026-12-20",
      }
    );

    const sweep = runWorkspaceDataRetentionSweep(ws.workspaceId);
    expect(sweep.purgedVouchersCount).toBeGreaterThanOrEqual(0);

    const purgeNow = runWorkspaceDataRetentionSweep(ws.workspaceId, { forceImmediate: true });
    expect(purgeNow.mode).toBe("manual_purge");

    const remaining = listWorkspaceTallyVouchers(ws.workspaceId, {
      limit: 10,
      forPublicApi: true,
    });
    expect(remaining.items.length).toBe(0);
  });

  it("enforces strict 8-role departmental RBAC between Marketing and Accountant roles", () => {
    const slugs = SYSTEM_ROLES.map((r) => r.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "owner",
        "admin",
        "manager",
        "accountant",
        "marketing",
        "agent",
        "billing",
        "analyst",
      ])
    );

    expect(normalizeSystemRoleSlug("marketer")).toBe("marketing");
    expect(normalizeSystemRoleSlug("ca")).toBe("accountant");

    // Marketing role: full Ads/Social/Reviews/WhatsApp Broadcasts, ZERO Tally/Billing/Backups/Tokens
    expect(canRoleAccessWebRoute("marketing", "/campaigns")).toBe(true);
    expect(canRoleAccessWebRoute("marketing", "/reviews")).toBe(true);
    expect(canRoleAccessWebRoute("marketing", "/whatsapp")).toBe(true);
    expect(canRoleAccessWebRoute("marketing", "/tally")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/tally/parties")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/tally/products")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/billing")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/backups")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/settings/tokens")).toBe(false);
    expect(canRoleAccessWebRoute("marketing", "/settings/team")).toBe(false);
    expect(canRolePerform("marketing", "tally:view")).toBe(false);
    expect(canRolePerform("marketing", "tally:sync.manage")).toBe(false);
    expect(canRolePerform("marketing", "billing:view")).toBe(false);

    // Accountant role: full Tally/Parties/Products/Billing/Backups, ZERO Ads/Social/Reviews/Inbox
    expect(canRoleAccessWebRoute("accountant", "/tally")).toBe(true);
    expect(canRoleAccessWebRoute("accountant", "/tally/parties")).toBe(true);
    expect(canRoleAccessWebRoute("accountant", "/tally/products")).toBe(true);
    expect(canRoleAccessWebRoute("accountant", "/billing")).toBe(true);
    expect(canRoleAccessWebRoute("accountant", "/backups")).toBe(true);
    expect(canRoleAccessWebRoute("accountant", "/campaigns")).toBe(false);
    expect(canRoleAccessWebRoute("accountant", "/reviews")).toBe(false);
    expect(canRoleAccessWebRoute("accountant", "/inbox")).toBe(false);
    expect(canRolePerform("accountant", "ads:view")).toBe(false);
    expect(canRolePerform("accountant", "posts:schedule")).toBe(false);
    expect(canRolePerform("accountant", "reviews:view")).toBe(false);
  });

  it("enforces oklab color blends, zero em-dashes across docs & UI, and updated 2026 Google/Meta guides", () => {
    const themeCss = fs.readFileSync(
      path.join(REPO_ROOT, "packages/ui/src/theme.css"),
      "utf8"
    );
    expect(themeCss).toContain("color-mix(in oklab");
    expect(themeCss).toContain("--text-primary: var(--ink);");
    expect(themeCss).toContain("--status-success-bg:");
    expect(themeCss).toContain("--status-danger-bg:");
    expect(themeCss).toContain("--scrollbar-thumb:");
    expect(themeCss).toContain("::-webkit-scrollbar");
    expect(themeCss).toContain("::-webkit-scrollbar-button");
    expect(themeCss).toContain("scrollbar-width: thin;");
    expect(themeCss).toContain(".rsl-sidebar-scroll");
    expect(themeCss).toContain(".rsl-custom-scrollbar");
    expect(themeCss).toContain(".rsl-nav-group-rail");
    expect(themeCss).toContain(".rsl-nav-section-btn");
    expect(themeCss).toContain(".rsl-account-dock");
    expect(themeCss).toContain(".font-mono:not(code):not(pre):not(kbd)");
    expect(themeCss).toContain("tabular-nums lining-nums");
    expect(themeCss).toContain("--sileo-fill:");
    expect(themeCss).toContain("--sileo-state-success:");
    expect(themeCss).toContain("--sileo-state-error:");
    expect(themeCss).toContain("[data-sileo-viewport] [data-sileo-pill]");
    expect(themeCss).toContain(".rsl-sileo-title");
    expect(themeCss).toContain(".rsl-sileo-description");

    const sileoToastTsx = fs.readFileSync(
      path.join(REPO_ROOT, "packages/ui/src/sileo-toast.tsx"),
      "utf8"
    );
    expect(sileoToastTsx).toContain('fill: "var(--sileo-fill)"');
    expect(sileoToastTsx).toContain("options={RSL_SILEO_TOAST_OPTIONS}");

    const webChrome = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/workspace-chrome.tsx"),
      "utf8"
    );
    expect(webChrome).toContain("Overview & Intelligence");
    expect(webChrome).toContain("Tally Prime & Accounting");
    expect(webChrome).toContain("Marketing & Campaigns");
    expect(webChrome).toContain("Customer Support Desk");
    expect(webChrome).toContain("Channels, API & Vault");
    expect(webChrome).toContain("Administration & Billing");
    expect(webChrome).toContain("Audit, Health & Guides");
    expect(webChrome).toContain("rsl-nav-group-rail");
    expect(webChrome).toContain("DOCK_ONLY_WORKSPACE_ITEMS");

    const webDashboardLayout = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/layout.tsx"),
      "utf8"
    );
    expect(webDashboardLayout).toContain("rsl-account-dock");
    expect(webDashboardLayout).toContain("Your Profile");
    expect(webDashboardLayout).toContain("Open Business Settings");
    expect(
      webDashboardLayout.indexOf("<SidebarNavLinks")
    ).toBeLessThan(webDashboardLayout.indexOf("{workspaceSwitcherCard}"));

    const adminNavRoutes = fs.readFileSync(
      path.join(REPO_ROOT, "apps/admin/src/lib/nav-routes.ts"),
      "utf8"
    );
    expect(adminNavRoutes).toContain("Revenue & Client Billing");
    expect(adminNavRoutes).toContain("Client & Channel Operations");
    expect(adminNavRoutes).toContain("Platform Vault & Infrastructure");
    expect(adminNavRoutes).toContain("Security, Staff & Audit");

    const channelsDoc = fs.readFileSync(
      path.join(REPO_ROOT, "content/en/connecting-channels-whatsapp-meta-google.md"),
      "utf8"
    );
    expect(channelsDoc).toContain("Google Auth Platform");
    expect(channelsDoc).toContain("Developer tokens are no longer required");
    expect(channelsDoc).toContain("Your application for explorer-level access was not approved");
    expect(channelsDoc).toContain("Facebook Login for Business");
    expect(channelsDoc).toContain("WhatsApp Embedded Signup");

    // Verify zero em-dashes across all markdown docs in content/en
    const contentDir = path.join(REPO_ROOT, "content/en");
    for (const file of fs.readdirSync(contentDir)) {
      if (!file.endsWith(".md")) continue;
      const text = fs.readFileSync(path.join(contentDir, file), "utf8");
      expect(text, `em-dash found in content/en/${file}`).not.toContain("—");
      expect(text, `&mdash; found in content/en/${file}`).not.toContain("&mdash;");
    }
  });

  it("supports 1-Click Client Cloudflare Connect for R2 Storage, Workers AI & Compute while keeping Turnstile CAPTCHA on RSL Platform", async () => {
    const templateUrl = buildCloudflareOneClickConnectUrl({
      workspaceName: "Shree Copper Works",
    });
    expect(templateUrl).toContain("https://dash.cloudflare.com/profile/api-tokens?");
    expect(decodeURIComponent(templateUrl)).toContain('"key":"workers_r2"');
    expect(decodeURIComponent(templateUrl)).toContain('"key":"workers_ai"');
    expect(decodeURIComponent(templateUrl)).toContain('"key":"workers_scripts"');
    expect(decodeURIComponent(templateUrl)).toContain('"key":"workers_kv_storage"');
    expect(decodeURIComponent(templateUrl)).toContain('"key":"account_settings"');

    // Derive S3 credentials from a Cloudflare API token + tokenId
    const derived = deriveCloudflareR2S3Credentials({
      apiToken: "cf_live_token_sample_1234567890",
      tokenId: "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
    });
    expect(derived.s3AccessKeyId).toBe("9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c");
    expect(derived.s3SecretAccessKey).toMatch(/^[a-f0-9]{64}$/);

    // Connect workspace via 1-Click Cloudflare Connect
    const connected = await connectWorkspaceCloudflareOneClick({
      workspaceId,
      apiToken: "rsl_sandbox_cf_oneclick_token_998877",
      preferredBucketName: "shree-copper-r2-vault",
      useClientR2Storage: true,
      useClientWorkersAi: true,
      useClientWorkersCompute: true,
    });

    expect(connected.connected).toBe(true);
    expect(connected.r2BucketName).toBe("shree-copper-r2-vault");
    expect(connected.responsibilitySplit.captchaAndBotProtection).toBe("rsl_platform");
    expect(connected.responsibilitySplit.platformEmailAndIngress).toBe("rsl_platform");
    expect(connected.responsibilitySplit.r2ObjectStorage).toBe("client_cloudflare");
    expect(connected.responsibilitySplit.workersAiInference).toBe("client_cloudflare");
    expect(connected.responsibilitySplit.workersEdgeCompute).toBe("client_cloudflare");

    // Storage configuration automatically switched to client_r2
    const storageStatus = getWorkspaceStorageStatus(workspaceId);
    expect(storageStatus.config.mode).toBe("client_r2");
    expect(storageStatus.config.bucketName).toBe("shree-copper-r2-vault");

    // Write and read an object into the client's R2 bucket
    const storedObj = await putWorkspaceObject({
      workspaceId,
      category: "tally_pdf",
      fileName: "GST-INV-2026-001.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("PDF-CONTENT-CLIENT-R2-VAULT", "utf8"),
      actorId: userId,
    });
    const readBack = await readWorkspaceObjectBytes(workspaceId, storedObj.id);
    expect(readBack.bytes.toString("utf8")).toBe("PDF-CONTENT-CLIENT-R2-VAULT");

    // Workers AI calls for this workspace now execute on the client's Cloudflare account
    const aiText = await runCloudflareWorkersAiText({
      workspaceId,
      systemPrompt: "Summarize invoice status.",
      userPrompt: "Invoice INV-2026-001 paid via UPI.",
    });
    expect(aiText.ok).toBe(true);
    expect(aiText.billingOwner).toBe("client_cloudflare");

    const adCopy = await generateSmartAdCopy({
      workspaceId,
      businessName: "Shree Copper Works",
      offerSummary: "IS-grade copper coils with ready GST dispatch",
      channel: "meta_ads",
    });
    expect(adCopy.isAiGenerated).toBe(true);
    expect(adCopy.billingOwner).toBe("client_cloudflare");

    // Provision a new R2 bucket and KV namespace in 1 click
    const newKv = await provisionWorkspaceCloudflareResource({
      workspaceId,
      resourceType: "kv_namespace",
      resourceName: "shree-edge-routing-kv",
    });
    expect(newKv.created).toBe(true);
    expect(
      newKv.status.kvNamespaces.some((k) => k.title === "shree-edge-routing-kv")
    ).toBe(true);

    const probe = await probeWorkspaceCloudflareConnection(workspaceId);
    expect(probe.ok).toBe(true);

    // Toggle Workers AI back to platform while keeping R2 on client's Cloudflare
    const toggled = await updateWorkspaceCloudflareWorkloads({
      workspaceId,
      useClientR2Storage: true,
      useClientWorkersAi: false,
      useClientWorkersCompute: true,
    });
    expect(toggled.responsibilitySplit.r2ObjectStorage).toBe("client_cloudflare");
    expect(toggled.responsibilitySplit.workersAiInference).toBe("rsl_platform");

    // Disconnect restores RSL Managed Vault cleanly
    const afterDisconnect = disconnectWorkspaceCloudflare(workspaceId);
    expect(afterDisconnect.connected).toBe(false);
    expect(getWorkspaceStorageStatus(workspaceId).config.mode).toBe("rsl_managed");
  });

  it("generates ISO/IEC 18004 Authenticator QR codes and supports full Staff & Customer TOTP MFA enrollment, verification, recovery codes, and sign-in challenges", async () => {
    // 1. Test core QR code SVG & Data URI generation
    const sampleUri =
      "otpauth://totp/RapidShift%20Labs:owner%40shree.in?secret=JBSWY3DPEHPK3PXP&issuer=RapidShift%20Labs&algorithm=SHA1&digits=6&period=30";
    const svgMarkup = buildTotpQrCodeSvgMarkup(sampleUri);
    expect(svgMarkup).toContain("<svg");
    expect(svgMarkup).toContain('role="img"');
    expect(svgMarkup).toContain("<path");

    const dataUri = buildTotpQrCodeDataUri(sampleUri);
    expect(dataUri.startsWith("data:image/svg+xml;utf8,")).toBe(true);

    // 2. Render TotpQrCodeCard component to static markup
    const qrCardHtml = renderToStaticMarkup(
      React.createElement(TotpQrCodeCard, {
        qrCodeDataUri: dataUri,
        otpauthUri: sampleUri,
        secret: "JBSWY3DPEHPK3PXP",
        accountEmail: "owner@shree.in",
        issuer: "RapidShift Labs",
      })
    );
    expect(qrCardHtml).toContain("rsl-totp-qr-frame");
    expect(qrCardHtml).toContain("rsl-totp-qr-image");
    expect(qrCardHtml).toContain("Open in Authenticator App");
    expect(qrCardHtml).toContain("JBSWY3DPEHPK3PXP");

    // 3. Test Platform Staff TOTP enrollment includes QR code Data URI
    let staffId: string;
    if (countPlatformStaff() === 0) {
      const boot = bootstrapFirstPlatformStaff({
        name: "Platform Super Admin",
        email: "admin-qr@rsl.test",
        password: "StrongStaffPassword#2026",
      });
      staffId = boot.staffId;
    } else {
      const allStaff = listPlatformStaffMembers();
      staffId = allStaff[0]!.id;
    }
    const staffEnroll = beginPlatformStaffTotpEnrollment(staffId);
    expect(staffEnroll.secret.length).toBeGreaterThanOrEqual(16);
    expect(staffEnroll.otpauthUri).toContain("otpauth://totp/");
    expect(staffEnroll.qrCodeDataUri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(staffEnroll.issuer).toBe("RapidShift Labs Staff");

    // 4. Test Customer User TOTP MFA enrollment, QR code, 6-digit verification & recovery codes
    const initialStatus = getUserTotpStatus(userId);
    expect(initialStatus.totpEnabled).toBe(false);

    const userEnroll = beginUserTotpEnrollment(userId);
    expect(userEnroll.secret.length).toBeGreaterThanOrEqual(16);
    expect(userEnroll.otpauthUri).toContain("otpauth://totp/RapidShift%20Labs:");
    expect(userEnroll.qrCodeDataUri.startsWith("data:image/svg+xml;utf8,")).toBe(true);

    const validSixDigitCode = computeTotpCode(userEnroll.secret);
    const confirmed = confirmUserTotpEnrollment({
      userId,
      code: validSixDigitCode,
    });
    expect(confirmed.backupCodes.length).toBe(8);

    const enabledStatus = getUserTotpStatus(userId);
    expect(enabledStatus.totpEnabled).toBe(true);
    expect(enabledStatus.backupCodesRemaining).toBe(8);

    // 5. Web sign-in with requireTotpIfEnrolled: true requires 6-digit code
    expect(() =>
      signInUser({
        email: userEnroll.accountEmail,
        password: "Password123!",
        requireTotpIfEnrolled: true,
      })
    ).toThrow(/Enter the 6-digit code from your authenticator app/i);

    const signedInWithTotp = signInUser({
      email: userEnroll.accountEmail,
      password: "Password123!",
      totpCode: computeTotpCode(userEnroll.secret),
      requireTotpIfEnrolled: true,
    });
    expect(signedInWithTotp.userId).toBe(userId);

    // 6. Test verification via 6-digit Authenticator code and one-time recovery code
    expect(verifyUserTotpOrBackupCode(userId, computeTotpCode(userEnroll.secret))).toBe(true);
    expect(verifyUserTotpOrBackupCode(userId, confirmed.backupCodes[0]!)).toBe(true);
    expect(getUserTotpStatus(userId).backupCodesRemaining).toBe(7);

    // 7. Disable Customer TOTP MFA
    disableUserTotpMfa({
      userId,
      codeOrPassword: "Password123!",
    });
    expect(getUserTotpStatus(userId).totpEnabled).toBe(false);
  });
});
