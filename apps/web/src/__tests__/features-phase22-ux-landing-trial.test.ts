import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STARTER_TRIAL_DAYS,
  registerUserWithWorkspace,
} from "@rsl/auth";
import {
  activatePlanOrBundleFromWallet,
  creditWallet,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  hasActiveEntitlement,
  listPublicPricingCatalog,
} from "@rsl/billing";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Sprint 5 — UX, WCAG 2.1 AA, Public Storefront, 7-Day Trial & De-Cluttering", () => {
  it("grants a 7-day starter trial when grantStarterTrialDays is supplied and validates GSTIN-state prefix on signup", () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const trialSignup = registerUserWithWorkspace({
      name: "Trial Merchant Owner",
      email: `trial-owner-${suffix}@rapidshiftlabs.in`,
      password: "StrongPassword123!",
      businessName: `Trial Traders ${suffix}`,
      stateCode: "27",
      gstin: "27AABCU9603R1ZM",
      grantStarterTrialDays: DEFAULT_STARTER_TRIAL_DAYS,
    });

    const freeStatus = getWorkspaceFreeAccessStatus(trialSignup.workspaceId);
    expect(DEFAULT_STARTER_TRIAL_DAYS).toBe(7);
    expect(freeStatus.isActive).toBe(true);
    expect(freeStatus.remainingDays).toBeGreaterThanOrEqual(6);
    expect(hasActiveEntitlement(trialSignup.workspaceId, "tally.sync")).toBe(true);
    expect(hasActiveEntitlement(trialSignup.workspaceId, "whatsapp")).toBe(true);

    // Mismatched GSTIN state prefix (29 Karnataka vs 27 Maharashtra) is rejected cleanly
    expect(() =>
      registerUserWithWorkspace({
        name: "Mismatch Merchant",
        email: `mismatch-${suffix}@rapidshiftlabs.in`,
        password: "StrongPassword123!",
        businessName: `Mismatch Co ${suffix}`,
        stateCode: "27",
        gstin: "29AABCU9603R1ZM",
      })
    ).toThrow(/must match your selected Billing State/i);
  });

  it("serves DB-backed public pricing catalog and unlocks plans atomically from prepaid wallet with GST Tax Invoice", () => {
    const catalog = listPublicPricingCatalog();
    expect(catalog.bundles.length).toBeGreaterThanOrEqual(3);
    expect(catalog.services.length).toBeGreaterThanOrEqual(10);
    expect(catalog.bundles[0]!.monthlyAmountPaise).toBeGreaterThan(0);
    expect(catalog.bundles[0]!.quarterlyAmountPaise).toBeGreaterThan(0);
    expect(catalog.bundles[0]!.yearlyAmountPaise).toBeGreaterThan(0);

    const suffix = crypto.randomBytes(4).toString("hex");
    const reg = registerUserWithWorkspace({
      name: "Wallet Buyer",
      email: `wallet-buyer-${suffix}@rapidshiftlabs.in`,
      password: "StrongPassword123!",
      businessName: `Wallet Buyer Co ${suffix}`,
      stateCode: "27",
    });

    expect(hasActiveEntitlement(reg.workspaceId, "inbox")).toBe(false);

    // Insufficient wallet balance should fail cleanly without mutating state
    expect(() =>
      activatePlanOrBundleFromWallet({
        workspaceId: reg.workspaceId,
        targetType: "service",
        targetKey: "inbox",
        billingCycle: "monthly",
        actorId: reg.userId,
      })
    ).toThrow(/Insufficient wallet balance/i);
    expect(hasActiveEntitlement(reg.workspaceId, "inbox")).toBe(false);

    // Credit wallet with ₹10,000 (1,000,000 paise) and unlock instantly
    creditWallet({
      workspaceId: reg.workspaceId,
      amountPaise: 1_000_000,
      description: "Test prepaid wallet deposit",
      idempotencyKey: `test-credit-${suffix}`,
      actorId: reg.userId,
    });

    const activated = activatePlanOrBundleFromWallet({
      workspaceId: reg.workspaceId,
      targetType: "service",
      targetKey: "inbox",
      billingCycle: "monthly",
      actorId: reg.userId,
    });

    expect(activated.invoiceNumber).toMatch(/^RSL\//);
    expect(activated.totalDebitedPaise).toBeGreaterThan(0);
    expect(getWalletBalancePaise(reg.workspaceId)).toBe(1_000_000 - activated.totalDebitedPaise);
    expect(hasActiveEntitlement(reg.workspaceId, "inbox")).toBe(true);
  });

  it("retains form inputs via useActionState + PasswordInput and enforces modal focus traps + aria-modal", () => {
    const webAuthForms = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/auth-forms.tsx"),
      "utf8"
    );
    const adminAuthForms = fs.readFileSync(
      path.join(REPO_ROOT, "apps/admin/src/components/admin-auth-forms.tsx"),
      "utf8"
    );
    expect(webAuthForms).toContain("useActionState");
    expect(webAuthForms).toContain("PasswordInput");
    expect(webAuthForms).toContain("htmlFor=");
    expect(adminAuthForms).toContain("useActionState");
    expect(adminAuthForms).toContain("PasswordInput");
    expect(adminAuthForms).toContain("htmlFor=");

    const workspaceChrome = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/workspace-chrome.tsx"),
      "utf8"
    );
    expect(workspaceChrome).toContain("useDialogFocusTrap");
    expect(workspaceChrome).toContain('aria-modal="true"');
    expect(workspaceChrome).toContain("ArrowDown");
    expect(workspaceChrome).toContain("ArrowUp");

    const confirmReminder = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/confirm-whatsapp-reminder.tsx"),
      "utf8"
    );
    expect(confirmReminder).toContain("useDialogFocusTrap");
    expect(confirmReminder).toContain("Confirm WhatsApp Payment Reminder");

    const templateBuilder = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/whatsapp-template-builder.tsx"),
      "utf8"
    );
    expect(templateBuilder).toContain("/1024");
    expect(templateBuilder).toContain("/60");
    expect(templateBuilder).toContain("/25");
  });

  it("shields customer /status from SQLite PRAGMA/ports, switches mobile /inbox panes, and modularizes /clients/[id]", () => {
    const statusPage = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/status/page.tsx"),
      "utf8"
    );
    expect(statusPage).not.toMatch(/PRAGMA/i);
    expect(statusPage).not.toMatch(/quick_check/i);
    expect(statusPage).not.toMatch(/4500|4501|4502|4503/);

    const inboxPage = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/inbox/page.tsx"),
      "utf8"
    );
    expect(inboxPage).toContain("hasMobileThreadOpen");
    expect(inboxPage).toContain("All Threads");

    const webLayout = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/layout.tsx"),
      "utf8"
    );
    expect(webLayout).toContain("getOptionalWebSession");
    expect(webLayout).toContain("formatRoleLabel(session.roleSlug)");
    expect(webLayout).not.toContain("<PageWalkthroughBanner");

    const settingsNav = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/settings-nav.tsx"),
      "utf8"
    );
    expect(settingsNav).toContain("lg:hidden");

    const clientDetailPage = fs.readFileSync(
      path.join(REPO_ROOT, "apps/admin/src/app/(console)/clients/[id]/page.tsx"),
      "utf8"
    );
    expect(clientDetailPage.split("\n").length).toBeLessThan(350);
    expect(clientDetailPage).toContain("ClientPlansEntitlementsTab");
  });
});
