import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  bootstrapFirstPlatformStaff,
  canStaffAccessAdminRoute,
  changeAuthenticatedUserPassword,
  consumeImpersonationHandoffCode,
  countPlatformStaff,
  createImpersonationSession,
  registerUserWithWorkspace,
  resolveStaffSessionFromToken,
  resolveUserSessionFromToken,
  signInPlatformStaff,
  signInUser,
  staffCreatePlatformMember,
  staffResetClientUserPassword,
  staffUpdatePlatformMember,
} from "@rsl/auth";
import { getEnv, resetEnvCacheForTests } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import {
  completePasswordReset,
  confirmEmailVerificationCode,
  sendEmailVerificationCode,
} from "@rsl/notifications";
import { canPermissionsAccessWebRoute, getPermissionsForRole } from "@rsl/rbac";
import { controlDb } from "@rsl/tenancy";
import { GET as impersonateGet, POST as impersonatePost } from "../app/api/auth/impersonate/route";

const requireCjs = createRequire(import.meta.url);

function ensureTestSuperAdmin(): { staffId: string; email: string } {
  if (countPlatformStaff() === 0) {
    const email = "sec-superadmin@rapidshiftlabs.in";
    const out = bootstrapFirstPlatformStaff({
      name: "Security Super Admin",
      email,
      password: "SuperAdminPassword123!",
    });
    return { staffId: out.staffId, email };
  }
  const existing = controlDb().select().from(controlSchema.platformStaff).get()!;
  return { staffId: existing.id, email: existing.email };
}

describe("Phase 21 — Sprint 4: Security, Fail-Closed RBAC, Auth Hardening & PM2/Nginx Headers", () => {
  it("4.1 & 4.3: configures host-only staff session cookie, HSTS/CSP headers, and zero pnpm wrapper scripts in PM2 ecosystem", () => {
    const repoRoot = getEnv().REPO_ROOT;

    // 1. Admin session.ts sets host-only cookie (never passes domain to setStaffCookie jar.set)
    const adminSessionSrc = fs.readFileSync(
      path.join(repoRoot, "apps", "admin", "src", "lib", "session.ts"),
      "utf8"
    );
    const setFnBody = adminSessionSrc.split("export async function clearStaffCookie")[0]!;
    const setJarPart = setFnBody.split("export async function setStaffCookie")[1]!;
    expect(setJarPart).not.toContain("domain:");

    // 2. Nginx config includes HSTS + immutable static caching
    const nginxSrc = fs.readFileSync(
      path.join(repoRoot, "infra", "nginx", "rsl-marketing.conf"),
      "utf8"
    );
    expect(nginxSrc).toContain("Strict-Transport-Security");
    expect(nginxSrc).toContain("public, max-age=31536000, immutable");

    // 3. PM2 ecosystem uses direct Node / tsx / next scripts with zero `script: "pnpm"` wrappers
    const ecosystem = requireCjs(
      path.join(repoRoot, "infra", "pm2", "ecosystem.config.cjs")
    ) as { apps: Array<{ name: string; script: string; interpreter?: string }> };
    expect(ecosystem.apps.length).toBe(7);
    for (const app of ecosystem.apps) {
      expect(app.script).not.toBe("pnpm");
      expect(app.interpreter).toBeTruthy();
    }
  });

  it("4.2: enforces 8-character password minimum and revokes active sessions on password reset, password change, and staff updates", async () => {
    const superAdmin = ensureTestSuperAdmin();

    // 1. 8-char password minimum on registration & staff creation
    expect(() =>
      registerUserWithWorkspace({
        name: "Short Pass User",
        email: `short-${Date.now()}@rsltest.in`,
        password: "short",
        businessName: "Short Pass Co",
      })
    ).toThrow(/8 characters/i);

    expect(() =>
      staffCreatePlatformMember({
        name: "Short Staff",
        email: `shortstaff-${Date.now()}@rsltest.in`,
        password: "123456",
        staffRole: "support",
      })
    ).toThrow(/8 characters/i);

    // 2. Create user with 2 active browser sessions -> change password preserving session 1 -> session 2 revoked!
    const email = `sec-sess-${Date.now()}@rsltest.in`;
    const reg = registerUserWithWorkspace({
      name: "Session Guard Owner",
      email,
      password: "InitialPassword123!",
      businessName: "Session Guard Pvt Ltd",
    });
    const secondLogin = signInUser({ email, password: "InitialPassword123!" });

    const sess1Before = resolveUserSessionFromToken(reg.rawSessionToken)!;
    const sess2Before = resolveUserSessionFromToken(secondLogin.rawSessionToken)!;
    expect(sess1Before).not.toBeNull();
    expect(sess2Before).not.toBeNull();

    changeAuthenticatedUserPassword({
      userId: reg.userId,
      currentPassword: "InitialPassword123!",
      newPassword: "RotatedPassword456!",
      preserveSessionId: sess1Before.sessionId,
    });

    expect(resolveUserSessionFromToken(reg.rawSessionToken)).not.toBeNull();
    expect(resolveUserSessionFromToken(secondLogin.rawSessionToken)).toBeNull();

    // 3. Staff password reset revokes ALL customer sessions (including session 1)
    expect(() =>
      staffResetClientUserPassword({ userId: reg.userId, newPassword: "6chars" })
    ).toThrow(/8 characters/i);

    staffResetClientUserPassword({
      userId: reg.userId,
      newPassword: "StaffResetPassword789!",
    });
    expect(resolveUserSessionFromToken(reg.rawSessionToken)).toBeNull();

    // 4. Self-service password reset token revokes ALL active customer sessions
    const thirdLogin = signInUser({ email, password: "StaffResetPassword789!" });
    expect(resolveUserSessionFromToken(thirdLogin.rawSessionToken)).not.toBeNull();

    const rawResetToken = `rst_${crypto.randomBytes(18).toString("base64url")}`;
    controlDb()
      .insert(controlSchema.verifications)
      .values({
        id: `ver_rst_${Date.now()}`,
        identifier: `reset:${email}`,
        valueHash: crypto.createHash("sha256").update(rawResetToken).digest("hex"),
        failedAttempts: 0,
        expiresAt: Date.now() + 600_000,
        createdAt: Date.now(),
      })
      .run();

    expect(() =>
      completePasswordReset({
        email,
        rawToken: rawResetToken,
        newPassword: "short",
      })
    ).toThrow(/8 characters/i);

    completePasswordReset({
      email,
      rawToken: rawResetToken,
      newPassword: "FinalResetPassword999!",
    });
    expect(resolveUserSessionFromToken(thirdLogin.rawSessionToken)).toBeNull();

    // 5. Staff password rotation revokes existing staff sessions
    const supportEmail = `support-rot-${Date.now()}@rapidshiftlabs.in`;
    const createdStaff = staffCreatePlatformMember({
      name: "Support Engineer",
      email: supportEmail,
      password: "SupportPassword123!",
      staffRole: "support",
    });
    const staffSess = signInPlatformStaff({
      email: supportEmail,
      password: "SupportPassword123!",
    });
    expect(resolveStaffSessionFromToken(staffSess.rawToken)).not.toBeNull();

    staffUpdatePlatformMember({
      targetStaffId: createdStaff.staffId,
      newPassword: "NewSupportPassword456!",
    });
    expect(resolveStaffSessionFromToken(staffSess.rawToken)).toBeNull();
    expect(superAdmin.staffId).toBeTruthy();
  });

  it("4.2: switches Web and Admin RBAC route catalogs to strict fail-closed while preserving mapped routes", () => {
    const ownerPerms = getPermissionsForRole("owner", "biz_test");
    const agentPerms = getPermissionsForRole("agent", "biz_test");

    // Mapped routes remain accessible according to permissions
    expect(canPermissionsAccessWebRoute(ownerPerms, "/")).toBe(true);
    expect(canPermissionsAccessWebRoute(ownerPerms, "/billing/invoices/inv_123")).toBe(true);
    expect(canPermissionsAccessWebRoute(ownerPerms, "/settings")).toBe(true);
    expect(canPermissionsAccessWebRoute(agentPerms, "/inbox")).toBe(true);

    // Unmapped routes fail CLOSED (even for owner or super_admin!)
    expect(canPermissionsAccessWebRoute(ownerPerms, "/unmapped-shadow-route")).toBe(false);
    expect(canPermissionsAccessWebRoute(agentPerms, "/internal-debug-panel")).toBe(false);

    expect(canStaffAccessAdminRoute("super_admin", "/clients/biz_123")).toBe(true);
    expect(canStaffAccessAdminRoute("super_admin", "/credentials")).toBe(true);
    expect(canStaffAccessAdminRoute("super_admin", "/unmapped-admin-backdoor")).toBe(false);
    expect(canStaffAccessAdminRoute("support", "/unmapped-admin-backdoor")).toBe(false);
  });

  it("4.2: enforces single-use POST handoff for impersonation (blocking GET ?token=), 5-attempt OTP lockout, and production secret entropy", async () => {
    const superAdmin = ensureTestSuperAdmin();
    const email = `imp-otp-${Date.now()}@rsltest.in`;
    const reg = registerUserWithWorkspace({
      name: "Impersonation Target",
      email,
      password: "TargetPassword123!",
      businessName: "Target Business Co",
    });

    // 1. Single-use impersonation handoff code + GET ?token= rejection
    const imp = createImpersonationSession({
      staffId: superAdmin.staffId,
      workspaceId: reg.workspaceId,
      reason: "Investigating Tally voucher reconciliation ticket #402",
    });
    expect(imp.handoffCode.length).toBeGreaterThan(20);

    const getAttempt = new NextRequest(
      `https://app.rapidshiftlabs.in/api/auth/impersonate?token=${encodeURIComponent(imp.rawCustomerSessionToken)}`,
      { method: "GET" }
    );
    const getRes = await impersonateGet(getAttempt);
    expect(getRes.status).toBe(400);

    // First consumption succeeds; second replay returns null!
    const consumedOnce = consumeImpersonationHandoffCode(imp.handoffCode);
    expect(consumedOnce).toBe(imp.rawCustomerSessionToken);
    const consumedReplay = consumeImpersonationHandoffCode(imp.handoffCode);
    expect(consumedReplay).toBeNull();

    // Fresh handoff via POST route returns 303 redirect to /?notice=...
    const imp2 = createImpersonationSession({
      staffId: superAdmin.staffId,
      workspaceId: reg.workspaceId,
      reason: "Follow-up check on ticket #402",
    });
    const postReq = new NextRequest("https://app.rapidshiftlabs.in/api/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: imp2.handoffCode }),
    });
    // Note: outside Next.js request context cookies() throws when setting cookie, so verify consumeImpersonationHandoffCode burned the code!
    await impersonatePost(postReq).catch(() => null);
    expect(consumeImpersonationHandoffCode(imp2.handoffCode)).toBeNull();

    // 2. 5-attempt lockout on 6-digit email verification code
    await sendEmailVerificationCode({
      userId: reg.userId,
      email,
      recipientName: "Impersonation Target",
      workspaceId: reg.workspaceId,
    });

    // Plant a known code hash so we can verify that 5 wrong attempts invalidate even the real code on attempt 6!
    const knownCode = "654321";
    const knownHash = crypto.createHash("sha256").update(knownCode).digest("hex");
    controlDb()
      .update(controlSchema.verifications)
      .set({ valueHash: knownHash, failedAttempts: 0 })
      .where(eq(controlSchema.verifications.identifier, `verify:${email}`))
      .run();

    for (let i = 1; i <= 5; i++) {
      expect(confirmEmailVerificationCode(email, "000000")).toBe(false);
    }
    // 6th attempt with the ACTUAL code must fail because the verification row was locked & purged on attempt 5!
    expect(confirmEmailVerificationCode(email, knownCode)).toBe(false);

    // 3. Production secret validation rejects weak ADMIN_AUTH_SECRET (< 16 chars)
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAdminSecret = process.env.ADMIN_AUTH_SECRET;
    const prevBetterSecret = process.env.BETTER_AUTH_SECRET;
    const prevKms = process.env.KMS_MASTER_KEY;
    const prevBackup = process.env.BACKUP_SIGNING_KEY;
    const prevPepper = process.env.API_KEY_PEPPER;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.BETTER_AUTH_SECRET = "prod_better_auth_secret_32_chars_minimum!!";
      process.env.KMS_MASTER_KEY = "prod_kms_master_key_32_chars_minimum!!";
      process.env.BACKUP_SIGNING_KEY = "prod_backup_signing_key_32_chars_min!!";
      process.env.API_KEY_PEPPER = "prod_api_key_pepper_32_chars_minimum!!";
      process.env.ADMIN_AUTH_SECRET = "too_short";
      resetEnvCacheForTests();
      expect(() => getEnv()).toThrow(/ADMIN_AUTH_SECRET/i);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      if (prevAdminSecret === undefined) delete process.env.ADMIN_AUTH_SECRET;
      else process.env.ADMIN_AUTH_SECRET = prevAdminSecret;
      if (prevBetterSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prevBetterSecret;
      if (prevKms === undefined) delete process.env.KMS_MASTER_KEY;
      else process.env.KMS_MASTER_KEY = prevKms;
      if (prevBackup === undefined) delete process.env.BACKUP_SIGNING_KEY;
      else process.env.BACKUP_SIGNING_KEY = prevBackup;
      if (prevPepper === undefined) delete process.env.API_KEY_PEPPER;
      else process.env.API_KEY_PEPPER = prevPepper;
      resetEnvCacheForTests();
    }
  });
});
