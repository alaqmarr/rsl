import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { ensureServiceCatalogSeeded } from "@rsl/billing";
import {
  buildTotpOtpAuthUri,
  buildTotpQrCodeDataUri,
  consumeMfaBackupCode,
  decryptEnvelope,
  encryptEnvelope,
  generateMfaBackupCodes,
  generateTotpSecret,
  getEnv,
  hashPassword,
  hashPasswordAsync,
  newId,
  passwordHashNeedsUpgrade,
  RslError,
  verifyPassword,
  verifyPasswordAsync,
  verifyTotpCode,
} from "@rsl/core";
import { controlSchema, platformLogsSchema } from "@rsl/database";
import { appendActionLog } from "@rsl/logging";
import {
  authorizeStaff,
  canStaffAccessAdminRoute,
  canStaffPerform,
  canStaffRolePerform,
  ensureSystemRolesSeeded,
  formatStaffRoleLabel,
  getPermissionsForRole,
  getStaffPermissions,
  invalidateRbacCache,
  STAFF_PERMISSION_CATALOG,
  STAFF_ROLE_PERMISSIONS,
  STAFF_ROUTE_ACCESS_RULES,
  type Permission,
  type StaffPermission,
  type StaffRoleSlug,
} from "@rsl/rbac";

export {
  authorizeStaff,
  canStaffAccessAdminRoute,
  canStaffPerform,
  canStaffRolePerform,
  formatStaffRoleLabel,
  getStaffPermissions,
  STAFF_PERMISSION_CATALOG,
  STAFF_ROLE_PERMISSIONS,
  STAFF_ROUTE_ACCESS_RULES,
  type StaffPermission,
  type StaffRoleSlug,
};
import {
  controlDb,
  invalidateTenantRegistryCache,
  markWorkspaceSslCertificatesQueued,
  onTenantRegistryInvalidated,
  platformLogsDb,
  provisionTenantDatabase,
  type TenantContext,
} from "@rsl/tenancy";

export const WEB_SESSION_COOKIE = "rsl_session";
export const ADMIN_SESSION_COOKIE = "rsl_staff_session";

export const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WEB_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const STAFF_SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_CACHE_TTL_MS = 3_000;
const ACCOUNT_LOCKOUT_THRESHOLD = 5;
const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const authRateWindows = new Map<string, number[]>();

export function consumeAuthRateLimit(params: {
  bucket: string;
  key: string;
  maxAttempts: number;
  windowMs: number;
}): void {
  const now = Date.now();
  const instances = Math.max(1, Number(process.env.PM2_INSTANCES || 1));
  const perInstanceLimit =
    process.env.NODE_ENV === "production" && instances > 1
      ? Math.max(2, Math.ceil(params.maxAttempts / instances))
      : params.maxAttempts;
  const fullKey = `${params.bucket}:${params.key}`;
  const cutoff = now - params.windowMs;
  const existing = (authRateWindows.get(fullKey) ?? []).filter((ts) => ts > cutoff);
  if (existing.length >= perInstanceLimit) {
    authRateWindows.set(fullKey, existing);
    throw new RslError(
      "RSL-AUTH-1004",
      "Too many authentication attempts. Please wait a minute and try again."
    );
  }
  existing.push(now);
  authRateWindows.set(fullKey, existing);
  if (authRateWindows.size > 4096) {
    for (const [k, stamps] of authRateWindows.entries()) {
      if (stamps.every((ts) => ts <= cutoff)) {
        authRateWindows.delete(k);
      }
    }
  }
}

export function resetAuthRateLimitsForTests(): void {
  authRateWindows.clear();
  userSessionCache.clear();
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function slugifyWorkspace(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = crypto.randomBytes(2).toString("hex");
  return `${base || "business"}-${suffix}`;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    jobTitle: string | null;
    emailVerified: boolean;
    totpEnabled: boolean;
    createdAt: number;
  };
  workspace: typeof controlSchema.workspaces.$inferSelect;
  roleSlug: string;
  permissions: Permission[];
  impersonatorStaffId: string | null;
  impersonationReason: string | null;
  stepUpAt: number | null;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    roleSlug: string;
    billingStatus: string;
  }>;
  ctx: TenantContext;
}

const userSessionCache = new Map<
  string,
  { expiresAtMs: number; session: Omit<AuthenticatedSession, "ctx">; baseCtx: Omit<TenantContext, "requestId" | "correlationId"> }
>();

export function invalidateSessionCache(workspaceId?: string): void {
  if (!workspaceId) {
    userSessionCache.clear();
    return;
  }
  for (const [tokenHash, entry] of userSessionCache.entries()) {
    if (
      entry.session.workspace.id === workspaceId ||
      entry.session.workspaces.some((w) => w.id === workspaceId)
    ) {
      userSessionCache.delete(tokenHash);
    }
  }
}

onTenantRegistryInvalidated((tenantId) => {
  invalidateSessionCache(tenantId);
  invalidateRbacCache(tenantId);
});

export const DEFAULT_STARTER_TRIAL_DAYS = 7;

export interface RegisterUserParams {
  name: string;
  email: string;
  password: string;
  businessName: string;
  industry?: string;
  stateCode?: string;
  gstin?: string;
  ipAddress?: string;
  userAgent?: string;
  grantStarterTrialDays?: number;
  emailVerified?: boolean;
}

function validateAndPrepareRegistration(params: RegisterUserParams) {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }

  const normalizedEmail = params.email.trim().toLowerCase();
  if (params.ipAddress) {
    consumeAuthRateLimit({
      bucket: "register-ip",
      key: params.ipAddress,
      maxAttempts: 10,
      windowMs: 15 * 60_000,
    });
  }
  consumeAuthRateLimit({
    bucket: "register-email",
    key: normalizedEmail,
    maxAttempts: 4,
    windowMs: 10 * 60_000,
  });

  const effectiveStateCode = params.stateCode?.trim() || "27";
  const normalizedGstin = params.gstin?.trim().toUpperCase() || null;
  if (normalizedGstin) {
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalizedGstin)) {
      throw new RslError(
        "RSL-VAL-1001",
        "Enter a valid 15-character Indian GSTIN (for example: 27AABCU9603R1ZM), or leave GSTIN blank if unregistered."
      );
    }
    if (normalizedGstin.slice(0, 2) !== effectiveStateCode) {
      throw new RslError(
        "RSL-VAL-1001",
        `GSTIN state prefix (${normalizedGstin.slice(0, 2)}) must match your selected Billing State (${effectiveStateCode}).`
      );
    }
  }

  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalizedEmail))
    .get();
  if (existing) {
    throw new RslError("RSL-AUTH-1003");
  }

  return { db, normalizedEmail, effectiveStateCode, normalizedGstin };
}

function finalizeRegistrationWithHash(
  params: RegisterUserParams,
  prepared: ReturnType<typeof validateAndPrepareRegistration>,
  passwordHash: string,
  startedAt: number
): { rawSessionToken: string; userId: string; workspaceId: string } {
  const { db, normalizedEmail, effectiveStateCode, normalizedGstin } = prepared;
  const now = Date.now();
  const userId = newId("usr", params.name);
  const workspaceId = newId("biz", params.businessName);
  const slug = slugifyWorkspace(params.businessName);
  const trialDays = Math.max(0, Math.round(params.grantStarterTrialDays ?? 0));
  const freeAccessUntil = trialDays > 0 ? now + trialDays * 86_400_000 : null;

  const tx = db.$client.transaction(() => {
    const conflict = db
      .select({ id: controlSchema.users.id })
      .from(controlSchema.users)
      .where(eq(controlSchema.users.email, normalizedEmail))
      .get();
    if (conflict) {
      throw new RslError("RSL-AUTH-1003");
    }

    db.insert(controlSchema.users)
      .values({
        id: userId,
        name: params.name.trim(),
        email: normalizedEmail,
        emailVerified: Boolean(params.emailVerified ?? false),
        passwordHash,
        totpEnabled: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        activeWorkspaceId: workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(controlSchema.workspaces)
      .values({
        id: workspaceId,
        name: params.businessName.trim(),
        slug,
        industry: params.industry?.trim() || null,
        gstin: normalizedGstin,
        stateCode: effectiveStateCode,
        currency: "INR",
        timezone: "Asia/Kolkata",
        billingStatus: "active",
        mode: "live",
        ownerUserId: userId,
        freeAccessUntil,
        freeAccessNote: trialDays > 0 ? `${trialDays}-Day New Business Starter Trial` : null,
        freeAccessGrantedBy: trialDays > 0 ? "system_onboarding" : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(controlSchema.memberships)
      .values({
        id: newId(),
        workspaceId,
        userId,
        roleSlug: "owner",
        assetScopeJson: null,
        createdAt: now,
      })
      .run();
  });

  tx.immediate();

  provisionTenantDatabase(workspaceId);
  markWorkspaceSslCertificatesQueued({ workspaceId, workspaceSlug: slug });
  invalidateRbacCache(workspaceId);
  invalidateTenantRegistryCache(workspaceId);

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId: workspaceId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      lastActiveAt: now,
      stepUpAt: now,
      expiresAt: now + WEB_SESSION_TTL_MS,
      createdAt: now,
    })
    .run();

  const corrId = newId();
  appendActionLog({
    workspaceId,
    actorType: "user",
    actorId: userId,
    source: "web",
    action: "workspace.updated",
    outcome: "success",
    requestId: corrId,
    correlationId: corrId,
    durationMs: Math.max(1, Date.now() - startedAt),
    summary: `Created business account '${params.businessName.trim()}'`,
  });

  return { rawSessionToken, userId, workspaceId };
}

export function registerUserWithWorkspace(
  params: RegisterUserParams
): { rawSessionToken: string; userId: string; workspaceId: string } {
  const startedAt = Date.now();
  const prepared = validateAndPrepareRegistration(params);
  const passwordHash = hashPassword(params.password);
  return finalizeRegistrationWithHash(params, prepared, passwordHash, startedAt);
}

export async function registerUserWithWorkspaceAsync(
  params: RegisterUserParams
): Promise<{ rawSessionToken: string; userId: string; workspaceId: string }> {
  const startedAt = Date.now();
  const prepared = validateAndPrepareRegistration(params);
  const passwordHash = await hashPasswordAsync(params.password);
  return finalizeRegistrationWithHash(params, prepared, passwordHash, startedAt);
}

export function assertUserEmailVerified(userId: string, actionDescription?: string): void {
  const usr = controlDb()
    .select({ emailVerified: controlSchema.users.emailVerified })
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, userId))
    .get();
  if (!usr || !usr.emailVerified) {
    throw new RslError(
      "RSL-AUTH-1005",
      actionDescription
        ? `Please verify your email address before ${actionDescription}.`
        : undefined
    );
  }
}

function recordUserFailedSignIn(user: typeof controlSchema.users.$inferSelect): never {
  const now = Date.now();
  const nextAttempts = (user.failedLoginAttempts ?? 0) + 1;
  const shouldLock = nextAttempts >= ACCOUNT_LOCKOUT_THRESHOLD;
  controlDb()
    .update(controlSchema.users)
    .set({
      failedLoginAttempts: nextAttempts,
      lockedUntil: shouldLock ? now + ACCOUNT_LOCKOUT_DURATION_MS : user.lockedUntil,
      updatedAt: now,
    })
    .where(eq(controlSchema.users.id, user.id))
    .run();

  if (shouldLock) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Account temporarily locked after repeated failed sign-in attempts. Please wait 15 minutes or reset your password."
    );
  }
  throw new RslError("RSL-AUTH-1002");
}

function mintAuthenticatedUserSession(
  user: typeof controlSchema.users.$inferSelect,
  params: { ipAddress?: string; userAgent?: string },
  upgradedPasswordHash?: string | null
): { rawSessionToken: string; userId: string; workspaceId: string } {
  const db = controlDb();
  const now = Date.now();
  if ((user.failedLoginAttempts ?? 0) > 0 || user.lockedUntil || upgradedPasswordHash) {
    db.update(controlSchema.users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(upgradedPasswordHash ? { passwordHash: upgradedPasswordHash } : {}),
        updatedAt: now,
      })
      .where(eq(controlSchema.users.id, user.id))
      .run();
  }

  const userMemberships = db
    .select()
    .from(controlSchema.memberships)
    .where(eq(controlSchema.memberships.userId, user.id))
    .all();

  const activeWorkspaceId =
    userMemberships.find((m) => m.workspaceId === user.activeWorkspaceId)?.workspaceId ??
    userMemberships[0]?.workspaceId;

  if (!activeWorkspaceId) {
    throw new RslError("RSL-AUTH-1001", "No business workspace is linked to this account.");
  }

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId: user.id,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      lastActiveAt: now,
      stepUpAt: now,
      expiresAt: now + WEB_SESSION_TTL_MS,
      createdAt: now,
    })
    .run();

  return { rawSessionToken, userId: user.id, workspaceId: activeWorkspaceId };
}

export function signInUser(params: {
  email: string;
  password: string;
  totpCode?: string;
  requireTotpIfEnrolled?: boolean;
  ipAddress?: string;
  userAgent?: string;
}): { rawSessionToken: string; userId: string; workspaceId: string } {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  const normalizedEmail = params.email.trim().toLowerCase();
  const ipKey = params.ipAddress?.trim() || "local";
  consumeAuthRateLimit({
    bucket: "signin-acct-min",
    key: `${ipKey}:${normalizedEmail}`,
    maxAttempts: 5,
    windowMs: 60_000,
  });
  consumeAuthRateLimit({
    bucket: "signin-acct-hr",
    key: normalizedEmail,
    maxAttempts: 20,
    windowMs: 3_600_000,
  });
  if (params.ipAddress) {
    consumeAuthRateLimit({
      bucket: "signin-ip",
      key: params.ipAddress,
      maxAttempts: 25,
      windowMs: 60_000,
    });
  }

  const db = controlDb();
  const now = Date.now();
  const user = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalizedEmail))
    .get();

  if (user?.lockedUntil && user.lockedUntil > now) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Account temporarily locked after repeated failed sign-in attempts. Please wait 15 minutes or reset your password."
    );
  }

  if (!user || !user.passwordHash) {
    throw new RslError("RSL-AUTH-1002");
  }

  if (!verifyPassword(params.password, user.passwordHash)) {
    recordUserFailedSignIn(user);
  }

  if (user.totpEnabled && user.totpSecretEncrypted && (params.requireTotpIfEnrolled || params.totpCode !== undefined)) {
    const cleanCode = (params.totpCode || "").trim();
    if (!cleanCode) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Enter the 6-digit code from your authenticator app (or a recovery code) to complete sign-in."
      );
    }
    if (!verifyUserTotpOrBackupCode(user.id, cleanCode)) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Invalid 6-digit authenticator or recovery code. Check your authenticator app and try again."
      );
    }
  }

  const upgraded = passwordHashNeedsUpgrade(user.passwordHash)
    ? hashPassword(params.password)
    : null;
  return mintAuthenticatedUserSession(user, params, upgraded);
}

export async function signInUserAsync(params: {
  email: string;
  password: string;
  totpCode?: string;
  requireTotpIfEnrolled?: boolean;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ rawSessionToken: string; userId: string; workspaceId: string }> {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  const normalizedEmail = params.email.trim().toLowerCase();
  const ipKey = params.ipAddress?.trim() || "local";
  consumeAuthRateLimit({
    bucket: "signin-acct-min",
    key: `${ipKey}:${normalizedEmail}`,
    maxAttempts: 5,
    windowMs: 60_000,
  });
  consumeAuthRateLimit({
    bucket: "signin-acct-hr",
    key: normalizedEmail,
    maxAttempts: 20,
    windowMs: 3_600_000,
  });
  if (params.ipAddress) {
    consumeAuthRateLimit({
      bucket: "signin-ip",
      key: params.ipAddress,
      maxAttempts: 25,
      windowMs: 60_000,
    });
  }

  const db = controlDb();
  const now = Date.now();
  const user = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalizedEmail))
    .get();

  if (user?.lockedUntil && user.lockedUntil > now) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Account temporarily locked after repeated failed sign-in attempts. Please wait 15 minutes or reset your password."
    );
  }

  if (!user || !user.passwordHash) {
    throw new RslError("RSL-AUTH-1002");
  }

  if (!(await verifyPasswordAsync(params.password, user.passwordHash))) {
    recordUserFailedSignIn(user);
  }

  if (user.totpEnabled && user.totpSecretEncrypted && (params.requireTotpIfEnrolled || params.totpCode !== undefined)) {
    const cleanCode = (params.totpCode || "").trim();
    if (!cleanCode) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Enter the 6-digit code from your authenticator app (or a recovery code) to complete sign-in."
      );
    }
    if (!verifyUserTotpOrBackupCode(user.id, cleanCode)) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Invalid 6-digit authenticator or recovery code. Check your authenticator app and try again."
      );
    }
  }

  const upgraded = passwordHashNeedsUpgrade(user.passwordHash)
    ? await hashPasswordAsync(params.password)
    : null;
  return mintAuthenticatedUserSession(user, params, upgraded);
}

export function signOutSession(rawToken: string): void {
  const tokenHash = hashSessionToken(rawToken);
  userSessionCache.delete(tokenHash);
  controlDb()
    .delete(controlSchema.sessions)
    .where(eq(controlSchema.sessions.tokenHash, tokenHash))
    .run();
}

export function endImpersonationSession(rawToken: string | undefined | null): { ended: boolean } {
  if (!rawToken) return { ended: false };
  const tokenHash = hashSessionToken(rawToken);
  userSessionCache.delete(tokenHash);
  const db = controlDb();
  const session = db
    .select()
    .from(controlSchema.sessions)
    .where(eq(controlSchema.sessions.tokenHash, tokenHash))
    .get();
  if (!session || !session.impersonatorStaffId) {
    return { ended: false };
  }

  const now = Date.now();
  db.delete(controlSchema.sessions)
    .where(eq(controlSchema.sessions.id, session.id))
    .run();

  try {
    const latestImpLog = platformLogsDb()
      .select()
      .from(platformLogsSchema.impersonationLogs)
      .where(
        and(
          eq(platformLogsSchema.impersonationLogs.staffId, session.impersonatorStaffId),
          eq(
            platformLogsSchema.impersonationLogs.workspaceId,
            session.activeWorkspaceId ?? ""
          ),
          isNull(platformLogsSchema.impersonationLogs.endedAt)
        )
      )
      .orderBy(desc(platformLogsSchema.impersonationLogs.startedAt))
      .get();
    if (latestImpLog) {
      platformLogsDb()
        .update(platformLogsSchema.impersonationLogs)
        .set({ endedAt: now })
        .where(eq(platformLogsSchema.impersonationLogs.id, latestImpLog.id))
        .run();
    }
    platformLogsDb()
      .insert(platformLogsSchema.staffActionLogs)
      .values({
        id: newId(),
        ts: now,
        staffId: session.impersonatorStaffId,
        action: "staff.impersonation.ended",
        targetTenantId: session.activeWorkspaceId ?? null,
        summary: `Ended support impersonation session early`,
        correlationId: newId(),
      })
      .run();
  } catch {
    // Do not block session termination if audit log update fails
  }

  return { ended: true };
}

export function resolveUserSessionFromToken(
  rawToken: string | undefined | null
): AuthenticatedSession | null {
  if (!rawToken) return null;
  const now = Date.now();
  const tokenHash = hashSessionToken(rawToken);

  const cached = userSessionCache.get(tokenHash);
  if (cached && cached.expiresAtMs > now) {
    const stillActive = controlDb()
      .$client.prepare("SELECT 1 FROM sessions WHERE id = ? AND expires_at > ? LIMIT 1")
      .get(cached.session.sessionId, now);
    if (!stillActive) {
      userSessionCache.delete(tokenHash);
      return null;
    }
    const reqId = newId();
    return {
      ...cached.session,
      ctx: {
        ...cached.baseCtx,
        requestId: reqId,
        correlationId: reqId,
      },
    };
  }

  ensureSystemRolesSeeded();
  const db = controlDb();

  const session = db
    .select()
    .from(controlSchema.sessions)
    .where(
      and(eq(controlSchema.sessions.tokenHash, tokenHash), gt(controlSchema.sessions.expiresAt, now))
    )
    .get();

  if (!session) {
    userSessionCache.delete(tokenHash);
    return null;
  }

  if (session.lastActiveAt && now - session.lastActiveAt > WEB_SESSION_IDLE_MS) {
    db.delete(controlSchema.sessions)
      .where(eq(controlSchema.sessions.id, session.id))
      .run();
    userSessionCache.delete(tokenHash);
    return null;
  }

  if (!session.lastActiveAt || now - session.lastActiveAt > SESSION_TOUCH_INTERVAL_MS) {
    db.update(controlSchema.sessions)
      .set({ lastActiveAt: now })
      .where(eq(controlSchema.sessions.id, session.id))
      .run();
  }

  const user = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, session.userId))
    .get();
  if (!user) return null;

  const allMemberships = db
    .select({
      workspaceId: controlSchema.memberships.workspaceId,
      roleSlug: controlSchema.memberships.roleSlug,
      assetScopeJson: controlSchema.memberships.assetScopeJson,
      name: controlSchema.workspaces.name,
      slug: controlSchema.workspaces.slug,
      billingStatus: controlSchema.workspaces.billingStatus,
      deletedAt: controlSchema.workspaces.deletedAt,
    })
    .from(controlSchema.memberships)
    .innerJoin(
      controlSchema.workspaces,
      eq(controlSchema.memberships.workspaceId, controlSchema.workspaces.id)
    )
    .where(eq(controlSchema.memberships.userId, user.id))
    .all()
    .filter((m) => !m.deletedAt);

  if (allMemberships.length === 0) return null;

  const currentMembership =
    allMemberships.find((m) => m.workspaceId === session.activeWorkspaceId) ?? allMemberships[0]!;

  const workspace = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, currentMembership.workspaceId))
    .get();
  if (!workspace || workspace.deletedAt) return null;

  const permissions = Array.from(getPermissionsForRole(currentMembership.roleSlug, workspace.id));
  const assetScope = currentMembership.assetScopeJson
    ? (JSON.parse(currentMembership.assetScopeJson) as string[])
    : null;

  const baseCtx: Omit<TenantContext, "requestId" | "correlationId"> = {
    workspaceId: workspace.id,
    actorType: "user",
    actorId: user.id,
    roleSlug: currentMembership.roleSlug,
    assetScope,
    impersonatorId: session.impersonatorStaffId ?? null,
  };

  const reqId = newId();
  const baseSession: Omit<AuthenticatedSession, "ctx"> = {
    sessionId: session.id,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      jobTitle: user.jobTitle ?? null,
      emailVerified: Boolean(user.emailVerified),
      totpEnabled: user.totpEnabled,
      createdAt: user.createdAt,
    },
    workspace,
    roleSlug: currentMembership.roleSlug,
    permissions,
    impersonatorStaffId: session.impersonatorStaffId ?? null,
    impersonationReason: session.impersonationReason ?? null,
    stepUpAt: session.stepUpAt ?? null,
    workspaces: allMemberships.map((m) => ({
      id: m.workspaceId,
      name: m.name,
      slug: m.slug,
      roleSlug: m.roleSlug,
      billingStatus: m.billingStatus,
    })),
  };

  userSessionCache.set(tokenHash, {
    expiresAtMs: now + SESSION_CACHE_TTL_MS,
    session: baseSession,
    baseCtx,
  });

  return {
    ...baseSession,
    ctx: {
      ...baseCtx,
      requestId: reqId,
      correlationId: reqId,
    },
  };
}

export function switchActiveWorkspace(sessionId: string, userId: string, targetWorkspaceId: string): void {
  const db = controlDb();
  const membership = db
    .select()
    .from(controlSchema.memberships)
    .where(
      and(
        eq(controlSchema.memberships.userId, userId),
        eq(controlSchema.memberships.workspaceId, targetWorkspaceId)
      )
    )
    .get();

  if (!membership) {
    throw new RslError("RSL-RBAC-1001", "You are not a member of that business account.");
  }

  db.update(controlSchema.sessions)
    .set({ activeWorkspaceId: targetWorkspaceId })
    .where(eq(controlSchema.sessions.id, sessionId))
    .run();

  db.update(controlSchema.users)
    .set({ activeWorkspaceId: targetWorkspaceId, updatedAt: Date.now() })
    .where(eq(controlSchema.users.id, userId))
    .run();

  invalidateSessionCache();
}

export function createAdditionalWorkspace(params: {
  sessionId: string;
  userId: string;
  businessName: string;
  industry?: string;
  stateCode?: string;
  gstin?: string;
}): string {
  const db = controlDb();
  const now = Date.now();
  const workspaceId = newId("biz", params.businessName);
  const slug = slugifyWorkspace(params.businessName);
  const { cleanGstin, cleanStateCode } = validateWorkspaceGstinAndState(
    params.gstin,
    params.stateCode
  );

  db.insert(controlSchema.workspaces)
    .values({
      id: workspaceId,
      name: params.businessName.trim(),
      slug,
      industry: params.industry?.trim() || null,
      gstin: cleanGstin,
      stateCode: cleanStateCode,
      currency: "INR",
      timezone: "Asia/Kolkata",
      billingStatus: "active",
      mode: "live",
      ownerUserId: params.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(controlSchema.memberships)
    .values({
      id: newId(),
      workspaceId,
      userId: params.userId,
      roleSlug: "owner",
      assetScopeJson: null,
      createdAt: now,
    })
    .run();

  provisionTenantDatabase(workspaceId);
  markWorkspaceSslCertificatesQueued({ workspaceId, workspaceSlug: slug });
  switchActiveWorkspace(params.sessionId, params.userId, workspaceId);
  return workspaceId;
}

export function listWorkspaceTeam(workspaceId: string) {
  const db = controlDb();
  const members = db
    .select({
      membershipId: controlSchema.memberships.id,
      userId: controlSchema.users.id,
      name: controlSchema.users.name,
      email: controlSchema.users.email,
      roleSlug: controlSchema.memberships.roleSlug,
      joinedAt: controlSchema.memberships.createdAt,
    })
    .from(controlSchema.memberships)
    .innerJoin(controlSchema.users, eq(controlSchema.memberships.userId, controlSchema.users.id))
    .where(eq(controlSchema.memberships.workspaceId, workspaceId))
    .all();

  const invites = db
    .select()
    .from(controlSchema.invitations)
    .where(
      and(
        eq(controlSchema.invitations.workspaceId, workspaceId),
        eq(controlSchema.invitations.status, "pending")
      )
    )
    .all();

  return { members, invites };
}

export function addOrInviteTeamMember(params: {
  workspaceId: string;
  email: string;
  name?: string;
  roleSlug: string;
  invitedByUserId: string;
  initialPassword?: string;
  actorRoleSlug?: string;
}): {
  mode: "added_existing" | "created_member" | "invited";
  email: string;
  rawInviteToken?: string;
} {
  consumeAuthRateLimit({
    bucket: "team-invite-ws",
    key: params.workspaceId,
    maxAttempts: 30,
    windowMs: 15 * 60_000,
  });

  const db = controlDb();
  const normalized = params.email.trim().toLowerCase();
  const now = Date.now();

  if (params.roleSlug === "owner" && params.actorRoleSlug && params.actorRoleSlug !== "owner") {
    throw new RslError(
      "RSL-AUTH-1002",
      "Only a Business Owner can invite or promote a member to the Business Owner role."
    );
  }

  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const existingUser = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalized))
    .get();

  if (existingUser) {
    const existingMembership = db
      .select()
      .from(controlSchema.memberships)
      .where(
        and(
          eq(controlSchema.memberships.workspaceId, params.workspaceId),
          eq(controlSchema.memberships.userId, existingUser.id)
        )
      )
      .get();

    if (ws && existingUser.id === ws.ownerUserId && params.roleSlug !== "owner") {
      throw new RslError("RSL-VAL-1001", "The primary business owner role cannot be downgraded.");
    }
    if (
      existingMembership?.roleSlug === "owner" &&
      params.actorRoleSlug &&
      params.actorRoleSlug !== "owner"
    ) {
      throw new RslError(
        "RSL-AUTH-1002",
        "Only a Business Owner can modify an existing Business Owner's access."
      );
    }

    db.insert(controlSchema.memberships)
      .values({
        id: newId(),
        workspaceId: params.workspaceId,
        userId: existingUser.id,
        roleSlug: params.roleSlug,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [controlSchema.memberships.workspaceId, controlSchema.memberships.userId],
        set: { roleSlug: params.roleSlug },
      })
      .run();
    invalidateRbacCache(params.workspaceId);
    invalidateSessionCache();
    return { mode: "added_existing", email: normalized };
  }

  if (params.initialPassword && params.name) {
    const userId = newId();
    db.insert(controlSchema.users)
      .values({
        id: userId,
        name: params.name.trim(),
        email: normalized,
        emailVerified: false,
        passwordHash: hashPassword(params.initialPassword),
        totpEnabled: false,
        activeWorkspaceId: params.workspaceId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(controlSchema.memberships)
      .values({
        id: newId(),
        workspaceId: params.workspaceId,
        userId,
        roleSlug: params.roleSlug,
        createdAt: now,
      })
      .run();
    invalidateRbacCache(params.workspaceId);
    invalidateSessionCache();
    return { mode: "created_member", email: normalized };
  }

  const rawInviteToken = crypto.randomBytes(24).toString("base64url");
  db.insert(controlSchema.invitations)
    .values({
      id: newId(),
      workspaceId: params.workspaceId,
      email: normalized,
      roleSlug: params.roleSlug,
      tokenHash: hashSessionToken(rawInviteToken),
      invitedByUserId: params.invitedByUserId,
      status: "pending",
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
    .run();

  return { mode: "invited", email: normalized, rawInviteToken };
}

export function updateWorkspaceMemberRole(params: {
  workspaceId: string;
  membershipId: string;
  roleSlug: string;
  actorRoleSlug?: string;
}): { email: string; roleSlug: string } {
  const db = controlDb();
  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Business workspace not found.");
  }

  const membership = db
    .select()
    .from(controlSchema.memberships)
    .where(
      and(
        eq(controlSchema.memberships.id, params.membershipId),
        eq(controlSchema.memberships.workspaceId, params.workspaceId)
      )
    )
    .get();
  if (!membership) {
    throw new RslError("RSL-VAL-1001", "Team member record not found.");
  }

  if (membership.userId === ws.ownerUserId && params.roleSlug !== "owner") {
    throw new RslError(
      "RSL-VAL-1001",
      "The primary business owner role cannot be downgraded."
    );
  }

  if (
    (params.roleSlug === "owner" || membership.roleSlug === "owner") &&
    params.actorRoleSlug &&
    params.actorRoleSlug !== "owner"
  ) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Only a Business Owner can assign or modify a Business Owner role."
    );
  }

  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, membership.userId))
    .get();

  db.update(controlSchema.memberships)
    .set({ roleSlug: params.roleSlug })
    .where(eq(controlSchema.memberships.id, membership.id))
    .run();

  // Rotate sessions on privilege change so active sessions re-authenticate or pick up updated bounds cleanly
  db.delete(controlSchema.sessions)
    .where(
      and(
        eq(controlSchema.sessions.userId, membership.userId),
        eq(controlSchema.sessions.activeWorkspaceId, params.workspaceId)
      )
    )
    .run();

  invalidateRbacCache(params.workspaceId);
  invalidateSessionCache();

  return { email: usr?.email ?? membership.userId, roleSlug: params.roleSlug };
}

export function removeWorkspaceMember(params: {
  workspaceId: string;
  membershipId: string;
  actorRoleSlug?: string;
}): { email: string } {
  const db = controlDb();
  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Business workspace not found.");
  }

  const membership = db
    .select()
    .from(controlSchema.memberships)
    .where(
      and(
        eq(controlSchema.memberships.id, params.membershipId),
        eq(controlSchema.memberships.workspaceId, params.workspaceId)
      )
    )
    .get();
  if (!membership) {
    throw new RslError("RSL-VAL-1001", "Team member record not found.");
  }

  if (membership.userId === ws.ownerUserId) {
    throw new RslError(
      "RSL-VAL-1001",
      "The primary business owner cannot be removed from this workspace."
    );
  }

  if (
    membership.roleSlug === "owner" &&
    params.actorRoleSlug &&
    params.actorRoleSlug !== "owner"
  ) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Only a Business Owner can remove another Business Owner."
    );
  }

  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, membership.userId))
    .get();

  db.delete(controlSchema.memberships)
    .where(eq(controlSchema.memberships.id, membership.id))
    .run();

  db.delete(controlSchema.sessions)
    .where(
      and(
        eq(controlSchema.sessions.userId, membership.userId),
        eq(controlSchema.sessions.activeWorkspaceId, params.workspaceId)
      )
    )
    .run();

  invalidateRbacCache(params.workspaceId);
  invalidateSessionCache();

  return { email: usr?.email ?? membership.userId };
}

export function revokeWorkspaceInvitation(params: {
  workspaceId: string;
  invitationId: string;
  actorRoleSlug?: string;
}): { email: string } {
  const db = controlDb();
  const inv = db
    .select()
    .from(controlSchema.invitations)
    .where(
      and(
        eq(controlSchema.invitations.id, params.invitationId),
        eq(controlSchema.invitations.workspaceId, params.workspaceId)
      )
    )
    .get();
  if (!inv) {
    throw new RslError("RSL-VAL-1001", "Invitation not found.");
  }
  if (inv.roleSlug === "owner" && params.actorRoleSlug && params.actorRoleSlug !== "owner") {
    throw new RslError(
      "RSL-AUTH-1002",
      "Only a Business Owner can cancel a Business Owner invitation."
    );
  }

  db.delete(controlSchema.invitations)
    .where(eq(controlSchema.invitations.id, inv.id))
    .run();

  return { email: inv.email };
}

export function regenerateWorkspaceInvitationToken(params: {
  workspaceId: string;
  invitationId: string;
  actorRoleSlug?: string;
}): { email: string; roleSlug: string; rawInviteToken: string } {
  const db = controlDb();
  const inv = db
    .select()
    .from(controlSchema.invitations)
    .where(
      and(
        eq(controlSchema.invitations.id, params.invitationId),
        eq(controlSchema.invitations.workspaceId, params.workspaceId),
        eq(controlSchema.invitations.status, "pending")
      )
    )
    .get();
  if (!inv) {
    throw new RslError("RSL-VAL-1001", "Pending invitation not found.");
  }
  if (inv.roleSlug === "owner" && params.actorRoleSlug && params.actorRoleSlug !== "owner") {
    throw new RslError(
      "RSL-AUTH-1002",
      "Only a Business Owner can reissue a Business Owner invitation."
    );
  }

  const rawInviteToken = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  db.update(controlSchema.invitations)
    .set({
      tokenHash: hashSessionToken(rawInviteToken),
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    })
    .where(eq(controlSchema.invitations.id, inv.id))
    .run();

  return { email: inv.email, roleSlug: inv.roleSlug, rawInviteToken };
}

export function getInvitationPreviewByToken(rawToken: string): {
  invitationId: string;
  email: string;
  roleSlug: string;
  workspaceId: string;
  workspaceName: string;
  existingUser: boolean;
  existingUserName: string | null;
} | null {
  const trimmed = rawToken.trim();
  if (!trimmed) return null;
  const db = controlDb();
  const now = Date.now();
  const inv = db
    .select()
    .from(controlSchema.invitations)
    .where(
      and(
        eq(controlSchema.invitations.tokenHash, hashSessionToken(trimmed)),
        eq(controlSchema.invitations.status, "pending"),
        gt(controlSchema.invitations.expiresAt, now)
      )
    )
    .get();
  if (!inv) return null;

  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, inv.workspaceId))
    .get();
  if (!ws) return null;

  const existing = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, inv.email))
    .get();

  return {
    invitationId: inv.id,
    email: inv.email,
    roleSlug: inv.roleSlug,
    workspaceId: ws.id,
    workspaceName: ws.name,
    existingUser: Boolean(existing),
    existingUserName: existing?.name ?? null,
  };
}

export function acceptWorkspaceInvitation(params: {
  rawToken: string;
  name?: string;
  password: string;
}): {
  rawSessionToken: string;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
} {
  const startedAt = Date.now();
  ensureSystemRolesSeeded();
  const trimmed = params.rawToken.trim();
  if (!trimmed) {
    throw new RslError("RSL-AUTH-1001", "Invitation link is missing or invalid.");
  }

  const db = controlDb();
  const now = Date.now();
  const inv = db
    .select()
    .from(controlSchema.invitations)
    .where(
      and(
        eq(controlSchema.invitations.tokenHash, hashSessionToken(trimmed)),
        eq(controlSchema.invitations.status, "pending"),
        gt(controlSchema.invitations.expiresAt, now)
      )
    )
    .get();

  if (!inv) {
    throw new RslError("RSL-AUTH-1001", "This team invitation has expired or was already used.");
  }

  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, inv.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Invited business workspace was not found.");
  }

  const existingUser = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, inv.email))
    .get();

  let userId: string;
  if (existingUser) {
    if (!existingUser.passwordHash || !verifyPassword(params.password, existingUser.passwordHash)) {
      throw new RslError(
        "RSL-AUTH-1002",
        "Enter your existing RSL Marketing account password to join this business."
      );
    }
    userId = existingUser.id;
    db.update(controlSchema.users)
      .set({ activeWorkspaceId: ws.id, emailVerified: true, updatedAt: now })
      .where(eq(controlSchema.users.id, userId))
      .run();
  } else {
    const cleanName = (params.name || "").trim();
    if (cleanName.length < 2) {
      throw new RslError("RSL-VAL-1001", "Please enter your full name to create your login.");
    }
    if (params.password.length < 8) {
      throw new RslError("RSL-VAL-1001", "Please choose a password of at least 8 characters.");
    }
    userId = newId("usr", cleanName);
    db.insert(controlSchema.users)
      .values({
        id: userId,
        name: cleanName,
        email: inv.email,
        emailVerified: true,
        passwordHash: hashPassword(params.password),
        totpEnabled: false,
        activeWorkspaceId: ws.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  db.insert(controlSchema.memberships)
    .values({
      id: newId(),
      workspaceId: ws.id,
      userId,
      roleSlug: inv.roleSlug,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [controlSchema.memberships.workspaceId, controlSchema.memberships.userId],
      set: { roleSlug: inv.roleSlug },
    })
    .run();

  db.update(controlSchema.invitations)
    .set({ status: "accepted" })
    .where(eq(controlSchema.invitations.id, inv.id))
    .run();

  invalidateRbacCache(ws.id);
  invalidateSessionCache();

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId: ws.id,
      lastActiveAt: now,
      stepUpAt: now,
      expiresAt: now + WEB_SESSION_TTL_MS,
      createdAt: now,
    })
    .run();

  const corrId = newId();
  appendActionLog({
    workspaceId: ws.id,
    actorType: "user",
    actorId: userId,
    source: "web",
    action: "team.invite.accepted",
    outcome: "success",
    requestId: corrId,
    correlationId: corrId,
    durationMs: Math.max(1, Date.now() - startedAt),
    summary: `${inv.email} accepted invitation and joined '${ws.name}' as ${inv.roleSlug}`,
  });

  return {
    rawSessionToken,
    userId,
    workspaceId: ws.id,
    workspaceName: ws.name,
    email: inv.email,
  };
}

export function changeAuthenticatedUserPassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  preserveSessionId?: string;
}): void {
  if (params.newPassword.length < 8) {
    throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
  }

  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();

  if (!usr || !usr.passwordHash || !verifyPassword(params.currentPassword, usr.passwordHash)) {
    throw new RslError("RSL-AUTH-1002", "Your current password did not match.");
  }

  db.update(controlSchema.users)
    .set({
      passwordHash: hashPassword(params.newPassword),
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  if (params.preserveSessionId) {
    db.delete(controlSchema.sessions)
      .where(
        and(
          eq(controlSchema.sessions.userId, usr.id),
          ne(controlSchema.sessions.id, params.preserveSessionId)
        )
      )
      .run();
  } else {
    db.delete(controlSchema.sessions)
      .where(eq(controlSchema.sessions.userId, usr.id))
      .run();
  }
  invalidateSessionCache();
}

export async function changeAuthenticatedUserPasswordAsync(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  preserveSessionId?: string;
}): Promise<void> {
  if (params.newPassword.length < 8) {
    throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
  }

  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();

  if (!usr || !usr.passwordHash || !(await verifyPasswordAsync(params.currentPassword, usr.passwordHash))) {
    throw new RslError("RSL-AUTH-1002", "Your current password did not match.");
  }

  const nextHash = await hashPasswordAsync(params.newPassword);
  db.update(controlSchema.users)
    .set({
      passwordHash: nextHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  if (params.preserveSessionId) {
    db.delete(controlSchema.sessions)
      .where(
        and(
          eq(controlSchema.sessions.userId, usr.id),
          ne(controlSchema.sessions.id, params.preserveSessionId)
        )
      )
      .run();
  } else {
    db.delete(controlSchema.sessions)
      .where(eq(controlSchema.sessions.userId, usr.id))
      .run();
  }
  invalidateSessionCache();
}

const GSTIN_FORMAT_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const INDIA_PINCODE_REGEX = /^[1-9][0-9]{5}$/;

function validateWorkspaceGstinAndState(
  gstin?: string | null,
  stateCode?: string | null
): { cleanGstin: string | null; cleanStateCode: string } {
  const cleanGstin = gstin?.trim().toUpperCase() || null;
  if (cleanGstin && !GSTIN_FORMAT_REGEX.test(cleanGstin)) {
    throw new RslError(
      "RSL-VAL-1001",
      "GSTIN must be a valid 15-character Indian GST number (for example: 27AAAAA0000A1Z5)."
    );
  }
  const explicitState = stateCode?.trim() || "";
  const cleanStateCode = explicitState || (cleanGstin ? cleanGstin.slice(0, 2) : "27");
  if (cleanGstin && explicitState && cleanGstin.slice(0, 2) !== cleanStateCode) {
    throw new RslError(
      "RSL-VAL-1001",
      `GSTIN state prefix (${cleanGstin.slice(0, 2)}) must match your selected Billing State (${cleanStateCode}).`
    );
  }
  return { cleanGstin, cleanStateCode };
}

export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Web Browser Session";
  const lower = ua.toLowerCase();
  const browser = lower.includes("edg/")
    ? "Microsoft Edge"
    : lower.includes("chrome/")
      ? "Google Chrome"
      : lower.includes("firefox/")
        ? "Mozilla Firefox"
        : lower.includes("safari/") && !lower.includes("chrome/")
          ? "Apple Safari"
          : "Web Browser";
  const os = lower.includes("windows")
    ? "Windows"
    : lower.includes("mac os") || lower.includes("macintosh")
      ? "macOS"
      : lower.includes("android")
        ? "Android"
        : lower.includes("iphone") || lower.includes("ipad")
          ? "iOS"
          : lower.includes("linux")
            ? "Linux"
            : "Desktop";
  return `${browser} on ${os}`;
}

export function updateAuthenticatedUserProfile(params: {
  userId: string;
  name: string;
  phone?: string;
  jobTitle?: string;
  email?: string;
}): {
  name: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  emailChanged: boolean;
} {
  const cleanName = params.name.trim();
  if (cleanName.length < 2) {
    throw new RslError("RSL-VAL-1001", "Please enter your full name (at least 2 characters).");
  }

  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!existing) {
    throw new RslError("RSL-VAL-1001", "User account not found.");
  }

  const cleanPhone = params.phone?.trim() || null;
  const cleanJobTitle = params.jobTitle?.trim() || null;
  const nextEmail = params.email ? params.email.trim().toLowerCase() : existing.email;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    throw new RslError("RSL-VAL-1001", "Enter a valid work email address.");
  }

  const emailChanged = nextEmail !== existing.email;
  if (emailChanged) {
    const conflict = db
      .select()
      .from(controlSchema.users)
      .where(eq(controlSchema.users.email, nextEmail))
      .get();
    if (conflict && conflict.id !== existing.id) {
      throw new RslError("RSL-AUTH-1003", "Another account is already using this email address.");
    }
  }

  db.update(controlSchema.users)
    .set({
      name: cleanName,
      email: nextEmail,
      phone: cleanPhone,
      jobTitle: cleanJobTitle,
      emailVerified: emailChanged ? false : existing.emailVerified,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, existing.id))
    .run();

  invalidateSessionCache();

  return {
    name: cleanName,
    email: nextEmail,
    phone: cleanPhone,
    jobTitle: cleanJobTitle,
    emailChanged,
  };
}

export function listUserActiveSessions(userId: string, currentSessionId: string) {
  const now = Date.now();
  const rows = controlDb()
    .select()
    .from(controlSchema.sessions)
    .where(and(eq(controlSchema.sessions.userId, userId), gt(controlSchema.sessions.expiresAt, now)))
    .all();

  return rows
    .map((s) => ({
      id: s.id,
      isCurrent: s.id === currentSessionId,
      ipAddress: s.ipAddress || "Local / Private IP",
      userAgent: s.userAgent || "",
      deviceLabel: summarizeUserAgent(s.userAgent),
      impersonatorStaffId: s.impersonatorStaffId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }))
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
}

export function revokeUserSessionById(params: {
  userId: string;
  targetSessionId: string;
  currentSessionId: string;
}): { revoked: boolean } {
  if (params.targetSessionId === params.currentSessionId) {
    throw new RslError("RSL-VAL-1001", "Use Sign Out to end your current browser session.");
  }
  const db = controlDb();
  const target = db
    .select()
    .from(controlSchema.sessions)
    .where(
      and(
        eq(controlSchema.sessions.id, params.targetSessionId),
        eq(controlSchema.sessions.userId, params.userId)
      )
    )
    .get();
  if (!target) return { revoked: false };

  db.delete(controlSchema.sessions).where(eq(controlSchema.sessions.id, target.id)).run();
  invalidateSessionCache();
  return { revoked: true };
}

export function revokeAllOtherUserSessions(params: {
  userId: string;
  currentSessionId: string;
}): { revokedCount: number } {
  const db = controlDb();
  const rows = db
    .select({ id: controlSchema.sessions.id })
    .from(controlSchema.sessions)
    .where(eq(controlSchema.sessions.userId, params.userId))
    .all();

  let revokedCount = 0;
  for (const r of rows) {
    if (r.id === params.currentSessionId) continue;
    db.delete(controlSchema.sessions).where(eq(controlSchema.sessions.id, r.id)).run();
    revokedCount++;
  }
  if (revokedCount > 0) invalidateSessionCache();
  return { revokedCount };
}

const USER_TOTP_BACKUP_PREFIX = "user_totp_backup:";
const USER_TOTP_PENDING_PREFIX = "user_totp_pending:";

function readUserTotpBackupHashes(userId: string): string[] {
  const row = controlDb()
    .select()
    .from(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, `${USER_TOTP_BACKUP_PREFIX}${userId}`))
    .get();
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.valueHash) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUserTotpBackupHashes(userId: string, hashes: string[]): void {
  const db = controlDb();
  const identifier = `${USER_TOTP_BACKUP_PREFIX}${userId}`;
  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, identifier))
    .run();
  if (hashes.length > 0) {
    const now = Date.now();
    db.insert(controlSchema.verifications)
      .values({
        id: newId(),
        identifier,
        valueHash: JSON.stringify(hashes),
        failedAttempts: 0,
        expiresAt: now + 10 * 365 * 86_400_000,
        createdAt: now,
      })
      .run();
  }
}

export function getUserTotpStatus(userId: string): {
  totpEnabled: boolean;
  backupCodesRemaining: number;
} {
  const usr = controlDb()
    .select({
      totpEnabled: controlSchema.users.totpEnabled,
      totpSecretEncrypted: controlSchema.users.totpSecretEncrypted,
    })
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, userId))
    .get();
  const totpEnabled = Boolean(usr?.totpEnabled && usr?.totpSecretEncrypted);
  const backupCodesRemaining = totpEnabled ? readUserTotpBackupHashes(userId).length : 0;
  return { totpEnabled, backupCodesRemaining };
}

export function beginUserTotpEnrollment(userId: string): {
  secret: string;
  otpauthUri: string;
  qrCodeDataUri: string;
  accountEmail: string;
  issuer: string;
} {
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-AUTH-1001", "User account not found.");
  }

  const secret = generateTotpSecret();
  const now = Date.now();
  const pendingIdentifier = `${USER_TOTP_PENDING_PREFIX}${usr.id}`;
  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, pendingIdentifier))
    .run();
  db.insert(controlSchema.verifications)
    .values({
      id: newId(),
      identifier: pendingIdentifier,
      valueHash: encryptEnvelope(secret),
      failedAttempts: 0,
      expiresAt: now + 30 * 60_000,
      createdAt: now,
    })
    .run();

  const issuer = "RapidShift Labs";
  const otpauthUri = buildTotpOtpAuthUri({
    secretBase32: secret,
    accountEmail: usr.email,
    issuer,
  });

  return {
    secret,
    otpauthUri,
    qrCodeDataUri: buildTotpQrCodeDataUri(otpauthUri),
    accountEmail: usr.email,
    issuer,
  };
}

export function confirmUserTotpEnrollment(params: {
  userId: string;
  code: string;
  sessionId?: string;
}): { backupCodes: string[] } {
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-AUTH-1001", "User account not found.");
  }

  const now = Date.now();
  const pendingIdentifier = `${USER_TOTP_PENDING_PREFIX}${usr.id}`;
  const pendingRow = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, pendingIdentifier),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  const encryptedCandidate = pendingRow?.valueHash ?? usr.totpSecretEncrypted;
  if (!encryptedCandidate) {
    throw new RslError(
      "RSL-VAL-1001",
      "Start Authenticator QR setup first before verifying a 6-digit code."
    );
  }

  const secret = decryptEnvelope(encryptedCandidate);
  if (!verifyTotpCode(secret, params.code)) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Invalid 6-digit authenticator code. Check your device clock and try again."
    );
  }

  const { plainCodes, hashedCodes } = generateMfaBackupCodes(8);
  db.update(controlSchema.users)
    .set({
      totpSecretEncrypted: encryptEnvelope(secret),
      totpEnabled: true,
      updatedAt: now,
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, pendingIdentifier))
    .run();
  writeUserTotpBackupHashes(usr.id, hashedCodes);

  if (params.sessionId) {
    db.update(controlSchema.sessions)
      .set({ stepUpAt: now, lastActiveAt: now })
      .where(eq(controlSchema.sessions.id, params.sessionId))
      .run();
  }
  invalidateSessionCache();

  return { backupCodes: plainCodes };
}

export function verifyUserTotpOrBackupCode(userId: string, rawCode: string): boolean {
  const usr = controlDb()
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, userId))
    .get();
  if (!usr || !usr.totpEnabled || !usr.totpSecretEncrypted) {
    return false;
  }
  const secret = decryptEnvelope(usr.totpSecretEncrypted);
  if (verifyTotpCode(secret, rawCode)) {
    return true;
  }
  const existingHashes = readUserTotpBackupHashes(userId);
  if (existingHashes.length > 0) {
    const consumed = consumeMfaBackupCode(rawCode, existingHashes);
    if (consumed.matched) {
      writeUserTotpBackupHashes(userId, consumed.remainingHashes);
      return true;
    }
  }
  return false;
}

export function disableUserTotpMfa(params: {
  userId: string;
  codeOrPassword: string;
}): void {
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-AUTH-1001", "User account not found.");
  }

  const candidate = (params.codeOrPassword || "").trim();
  if (!candidate) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your current 6-digit authenticator code or account password to disable 2FA."
    );
  }

  const validTotp = verifyUserTotpOrBackupCode(usr.id, candidate);
  const validPwd = Boolean(usr.passwordHash && verifyPassword(candidate, usr.passwordHash));
  if (!validTotp && !validPwd) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Confirmation failed. Enter a valid 6-digit authenticator code, recovery code, or account password."
    );
  }

  db.update(controlSchema.users)
    .set({
      totpEnabled: false,
      totpSecretEncrypted: null,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, `${USER_TOTP_PENDING_PREFIX}${usr.id}`))
    .run();
  writeUserTotpBackupHashes(usr.id, []);
  invalidateSessionCache();
}

export function verifyUserStepUp(params: {
  userId: string;
  sessionId: string;
  currentPassword: string;
}): void {
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-AUTH-1002", "Password confirmation did not match.");
  }
  const candidate = params.currentPassword || "";
  const validTotp =
    usr.totpEnabled && usr.totpSecretEncrypted
      ? verifyUserTotpOrBackupCode(usr.id, candidate)
      : false;
  const validPwd = Boolean(usr.passwordHash && verifyPassword(candidate, usr.passwordHash));
  if (!validTotp && !validPwd) {
    throw new RslError("RSL-AUTH-1002", "Password or authenticator confirmation did not match.");
  }
  db.update(controlSchema.sessions)
    .set({ stepUpAt: Date.now() })
    .where(eq(controlSchema.sessions.id, params.sessionId))
    .run();
  invalidateSessionCache();
}

export function updateWorkspaceBusinessSettings(params: {
  workspaceId: string;
  name: string;
  industry?: string;
  businessPhone?: string;
  billingEmail?: string;
  website?: string;
  addressLine?: string;
  city?: string;
  pincode?: string;
  defaultTallyCompany?: string;
  stateCode?: string;
  gstin?: string;
  upiVpa?: string;
  upiPayeeName?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
}): {
  name: string;
  stateCode: string;
  gstin: string | null;
  upiVpa: string | null;
  bankIfsc: string | null;
} {
  const cleanName = params.name.trim();
  if (cleanName.length < 2) {
    throw new RslError("RSL-VAL-1001", "Business name must be at least 2 characters.");
  }

  const { cleanGstin, cleanStateCode } = validateWorkspaceGstinAndState(
    params.gstin,
    params.stateCode
  );

  const cleanBillingEmail = params.billingEmail?.trim().toLowerCase() || null;
  if (cleanBillingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanBillingEmail)) {
    throw new RslError("RSL-VAL-1001", "Enter a valid billing email address.");
  }

  const cleanPincode = params.pincode?.trim() || null;
  if (cleanPincode && !INDIA_PINCODE_REGEX.test(cleanPincode)) {
    throw new RslError("RSL-VAL-1001", "PIN code must be a valid 6-digit Indian postal code.");
  }

  const cleanUpiVpa = params.upiVpa?.trim().toLowerCase() || null;
  if (cleanUpiVpa && !/^[a-z0-9._-]{2,64}@[a-z0-9.-]{2,64}$/i.test(cleanUpiVpa)) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter a valid NPCI UPI ID / VPA (for example: yourbusiness@hdfcbank or 9876543210@okicici)."
    );
  }

  const cleanBankIfsc = params.bankIfsc?.trim().toUpperCase() || null;
  if (cleanBankIfsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanBankIfsc)) {
    throw new RslError(
      "RSL-VAL-1001",
      "Bank IFSC must be 11 characters (4 bank letters + '0' + 6 branch characters, e.g. HDFC0000001)."
    );
  }

  const existingWs = controlDb()
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();

  const nextUpiVpa =
    params.upiVpa !== undefined ? cleanUpiVpa : (existingWs?.upiVpa ?? null);
  const nextUpiPayeeName =
    params.upiPayeeName !== undefined
      ? params.upiPayeeName.trim() || null
      : (existingWs?.upiPayeeName ?? null);
  const nextBankName =
    params.bankName !== undefined
      ? params.bankName.trim() || null
      : (existingWs?.bankName ?? null);
  const nextBankBranch =
    params.bankBranch !== undefined
      ? params.bankBranch.trim() || null
      : (existingWs?.bankBranch ?? null);
  const nextBankAccountNumber =
    params.bankAccountNumber !== undefined
      ? params.bankAccountNumber.trim() || null
      : (existingWs?.bankAccountNumber ?? null);
  const nextBankIfsc =
    params.bankIfsc !== undefined ? cleanBankIfsc : (existingWs?.bankIfsc ?? null);

  controlDb()
    .update(controlSchema.workspaces)
    .set({
      name: cleanName,
      industry: params.industry?.trim() || null,
      businessPhone: params.businessPhone?.trim() || null,
      billingEmail: cleanBillingEmail,
      website: params.website?.trim() || null,
      addressLine: params.addressLine?.trim() || null,
      city: params.city?.trim() || null,
      pincode: cleanPincode,
      defaultTallyCompany: params.defaultTallyCompany?.trim() || null,
      stateCode: cleanStateCode,
      gstin: cleanGstin,
      upiVpa: nextUpiVpa,
      upiPayeeName: nextUpiPayeeName,
      bankName: nextBankName,
      bankBranch: nextBankBranch,
      bankAccountNumber: nextBankAccountNumber,
      bankIfsc: nextBankIfsc,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();

  markWorkspaceSslCertificatesQueued({ workspaceId: params.workspaceId });
  invalidateSessionCache();

  return {
    name: cleanName,
    stateCode: cleanStateCode,
    gstin: cleanGstin,
    upiVpa: nextUpiVpa,
    bankIfsc: nextBankIfsc,
  };
}

// ==========================================
// Platform Staff Authentication (apps/admin)
// ==========================================

export function countPlatformStaff(): number {
  const row = controlDb()
    .select({ c: sql<number>`count(*)` })
    .from(controlSchema.platformStaff)
    .get();
  return Number(row?.c ?? 0);
}

function assertSetupBootstrapTokenValid(providedToken?: string): void {
  const configuredToken = (getEnv().SETUP_BOOTSTRAP_TOKEN || "").trim();
  if (process.env.NODE_ENV === "production" && !configuredToken) {
    throw new RslError(
      "RSL-AUTH-1001",
      "SETUP_BOOTSTRAP_TOKEN must be configured in .env before initializing the first Super Admin account."
    );
  }
  if (!configuredToken) return;
  const provided = (providedToken || "").trim();
  if (!provided) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Enter the one-time Setup Bootstrap Key from SETUP_BOOTSTRAP_TOKEN in .env."
    );
  }
  const expectedDigest = crypto.createHash("sha256").update(configuredToken).digest();
  const actualDigest = crypto.createHash("sha256").update(provided).digest();
  if (!crypto.timingSafeEqual(expectedDigest, actualDigest)) {
    throw new RslError(
      "RSL-AUTH-1002",
      "Invalid Setup Bootstrap Key. Check SETUP_BOOTSTRAP_TOKEN in .env."
    );
  }
}

function finalizeStaffBootstrapWithHash(
  params: { name: string; email: string; setupBootstrapToken?: string },
  passwordHash: string
): { rawToken: string; staffId: string } {
  assertSetupBootstrapTokenValid(params.setupBootstrapToken);

  const db = controlDb();
  const staffId = newId();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const normalizedEmail = params.email.trim().toLowerCase();

  const tx = db.$client.transaction(() => {
    const existingRow = db
      .select({ c: sql<number>`count(*)` })
      .from(controlSchema.platformStaff)
      .get();
    if (Number(existingRow?.c ?? 0) > 0) {
      throw new Error("Initial staff account already exists. Sign in instead.");
    }

    db.insert(controlSchema.platformStaff)
      .values({
        id: staffId,
        name: params.name.trim(),
        email: normalizedEmail,
        passwordHash,
        staffRole: "super_admin",
        totpEnabled: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        active: true,
        createdAt: now,
      })
      .run();

    db.insert(controlSchema.platformStaffSessions)
      .values({
        id: newId(),
        staffId,
        tokenHash: hashSessionToken(rawToken),
        lastActiveAt: now,
        stepUpAt: now,
        expiresAt: now + STAFF_SESSION_TTL_MS,
        createdAt: now,
      })
      .run();
  });

  tx.immediate();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId,
      action: "staff.bootstrapped",
      summary: `Created initial super_admin staff account (${normalizedEmail})`,
      correlationId: newId(),
    })
    .run();

  return { rawToken, staffId };
}

export function bootstrapFirstPlatformStaff(params: {
  name: string;
  email: string;
  password: string;
  setupBootstrapToken?: string;
}): { rawToken: string; staffId: string } {
  if (countPlatformStaff() > 0) {
    throw new Error("Initial staff account already exists. Sign in instead.");
  }
  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }
  const passwordHash = hashPassword(params.password);
  return finalizeStaffBootstrapWithHash(params, passwordHash);
}

export async function bootstrapFirstPlatformStaffAsync(params: {
  name: string;
  email: string;
  password: string;
  setupBootstrapToken?: string;
}): Promise<{ rawToken: string; staffId: string }> {
  if (countPlatformStaff() > 0) {
    throw new Error("Initial staff account already exists. Sign in instead.");
  }
  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }
  assertSetupBootstrapTokenValid(params.setupBootstrapToken);
  const passwordHash = await hashPasswordAsync(params.password);
  return finalizeStaffBootstrapWithHash(params, passwordHash);
}

function recordStaffFailedSignIn(staff: typeof controlSchema.platformStaff.$inferSelect): never {
  const now = Date.now();
  const nextAttempts = (staff.failedLoginAttempts ?? 0) + 1;
  const shouldLock = nextAttempts >= ACCOUNT_LOCKOUT_THRESHOLD;
  controlDb()
    .update(controlSchema.platformStaff)
    .set({
      failedLoginAttempts: nextAttempts,
      lockedUntil: shouldLock ? now + ACCOUNT_LOCKOUT_DURATION_MS : staff.lockedUntil,
    })
    .where(eq(controlSchema.platformStaff.id, staff.id))
    .run();
  if (shouldLock) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Staff account locked for 15 minutes after repeated failed sign-in attempts."
    );
  }
  throw new RslError("RSL-AUTH-1002");
}

function mintPlatformStaffSession(
  staff: typeof controlSchema.platformStaff.$inferSelect,
  upgradedHash?: string | null
): { rawToken: string; staffId: string; mfaRequired: boolean } {
  const db = controlDb();
  const now = Date.now();
  if ((staff.failedLoginAttempts ?? 0) > 0 || staff.lockedUntil || upgradedHash) {
    db.update(controlSchema.platformStaff)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
      })
      .where(eq(controlSchema.platformStaff.id, staff.id))
      .run();
  }

  const mfaRequired = Boolean(staff.totpEnabled) || process.env.NODE_ENV === "production";
  const rawToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.platformStaffSessions)
    .values({
      id: newId(),
      staffId: staff.id,
      tokenHash: hashSessionToken(rawToken),
      mfaVerifiedAt: mfaRequired ? null : now,
      stepUpAt: mfaRequired ? null : now,
      lastActiveAt: now,
      expiresAt: now + STAFF_SESSION_TTL_MS,
      createdAt: now,
    })
    .run();

  return { rawToken, staffId: staff.id, mfaRequired };
}

export function signInPlatformStaff(params: {
  email: string;
  password: string;
  ipAddress?: string;
}): { rawToken: string; staffId: string; mfaRequired: boolean } {
  const normalizedEmail = params.email.trim().toLowerCase();
  const ipKey = params.ipAddress?.trim() || "local";
  consumeAuthRateLimit({
    bucket: "staff-signin-min",
    key: `${ipKey}:${normalizedEmail}`,
    maxAttempts: 5,
    windowMs: 60_000,
  });

  const db = controlDb();
  const now = Date.now();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.email, normalizedEmail))
    .get();

  if (staff?.lockedUntil && staff.lockedUntil > now) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Staff account locked for 15 minutes after repeated failed sign-in attempts."
    );
  }

  if (!staff || !staff.active) {
    throw new RslError("RSL-AUTH-1002");
  }

  if (!verifyPassword(params.password, staff.passwordHash)) {
    recordStaffFailedSignIn(staff);
  }

  const upgraded = passwordHashNeedsUpgrade(staff.passwordHash)
    ? hashPassword(params.password)
    : null;
  return mintPlatformStaffSession(staff, upgraded);
}

export async function signInPlatformStaffAsync(params: {
  email: string;
  password: string;
  ipAddress?: string;
}): Promise<{ rawToken: string; staffId: string; mfaRequired: boolean }> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const ipKey = params.ipAddress?.trim() || "local";
  consumeAuthRateLimit({
    bucket: "staff-signin-min",
    key: `${ipKey}:${normalizedEmail}`,
    maxAttempts: 5,
    windowMs: 60_000,
  });

  const db = controlDb();
  const now = Date.now();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.email, normalizedEmail))
    .get();

  if (staff?.lockedUntil && staff.lockedUntil > now) {
    throw new RslError(
      "RSL-AUTH-1004",
      "Staff account locked for 15 minutes after repeated failed sign-in attempts."
    );
  }

  if (!staff || !staff.active) {
    throw new RslError("RSL-AUTH-1002");
  }

  if (!(await verifyPasswordAsync(params.password, staff.passwordHash))) {
    recordStaffFailedSignIn(staff);
  }

  const upgraded = passwordHashNeedsUpgrade(staff.passwordHash)
    ? await hashPasswordAsync(params.password)
    : null;
  return mintPlatformStaffSession(staff, upgraded);
}

export interface ResolvedStaffSession {
  sessionId: string;
  staff: typeof controlSchema.platformStaff.$inferSelect;
  mfaEnrolled: boolean;
  mfaVerified: boolean;
  mfaRequired: boolean;
  stepUpAt: number | null;
}

export function resolveStaffSessionFromToken(
  rawToken: string | undefined | null,
  options?: { allowPendingMfa?: boolean }
): ResolvedStaffSession | null {
  if (!rawToken) return null;
  const db = controlDb();
  const now = Date.now();
  const sess = db
    .select()
    .from(controlSchema.platformStaffSessions)
    .where(
      and(
        eq(controlSchema.platformStaffSessions.tokenHash, hashSessionToken(rawToken)),
        gt(controlSchema.platformStaffSessions.expiresAt, now)
      )
    )
    .get();
  if (!sess) return null;

  if (sess.lastActiveAt && now - sess.lastActiveAt > STAFF_SESSION_IDLE_MS) {
    db.delete(controlSchema.platformStaffSessions)
      .where(eq(controlSchema.platformStaffSessions.id, sess.id))
      .run();
    return null;
  }

  if (!sess.lastActiveAt || now - sess.lastActiveAt > SESSION_TOUCH_INTERVAL_MS) {
    db.update(controlSchema.platformStaffSessions)
      .set({ lastActiveAt: now })
      .where(eq(controlSchema.platformStaffSessions.id, sess.id))
      .run();
  }

  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, sess.staffId))
    .get();
  if (!staff || !staff.active) return null;

  const mfaEnrolled = Boolean(staff.totpEnabled && staff.totpSecretEncrypted);
  const mfaVerified = Boolean(sess.mfaVerifiedAt);
  const mfaRequired = mfaEnrolled || process.env.NODE_ENV === "production";

  if (mfaRequired && !mfaVerified && !options?.allowPendingMfa) {
    return null;
  }

  return {
    sessionId: sess.id,
    staff,
    mfaEnrolled,
    mfaVerified,
    mfaRequired,
    stepUpAt: sess.stepUpAt ?? null,
  };
}

export function beginPlatformStaffTotpEnrollment(staffId: string): {
  secret: string;
  otpauthUri: string;
  qrCodeDataUri: string;
  accountEmail: string;
  issuer: string;
} {
  const db = controlDb();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, staffId))
    .get();
  if (!staff || !staff.active) {
    throw new RslError("RSL-AUTH-1001", "Staff account not found.");
  }
  const secret = generateTotpSecret();
  db.update(controlSchema.platformStaff)
    .set({
      totpSecretEncrypted: encryptEnvelope(secret),
      totpEnabled: false,
    })
    .where(eq(controlSchema.platformStaff.id, staff.id))
    .run();

  const issuer = "RapidShift Labs Staff";
  const otpauthUri = buildTotpOtpAuthUri({
    secretBase32: secret,
    accountEmail: staff.email,
    issuer,
  });

  return {
    secret,
    otpauthUri,
    qrCodeDataUri: buildTotpQrCodeDataUri(otpauthUri),
    accountEmail: staff.email,
    issuer,
  };
}

export function confirmPlatformStaffTotpEnrollment(params: {
  staffId: string;
  code: string;
  sessionId?: string;
}): { backupCodes: string[] } {
  const db = controlDb();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, params.staffId))
    .get();
  if (!staff || !staff.totpSecretEncrypted) {
    throw new RslError(
      "RSL-VAL-1001",
      "Start TOTP authenticator enrollment first before verifying a 6-digit code."
    );
  }
  const secret = decryptEnvelope(staff.totpSecretEncrypted);
  if (!verifyTotpCode(secret, params.code)) {
    throw new RslError("RSL-AUTH-1002", "Invalid 6-digit authenticator code. Check device clock and try again.");
  }

  const { plainCodes, hashedCodes } = generateMfaBackupCodes(8);
  const now = Date.now();
  db.update(controlSchema.platformStaff)
    .set({
      totpEnabled: true,
      totpEnrolledAt: now,
      totpBackupCodesJson: JSON.stringify(hashedCodes),
    })
    .where(eq(controlSchema.platformStaff.id, staff.id))
    .run();

  if (params.sessionId) {
    db.update(controlSchema.platformStaffSessions)
      .set({ mfaVerifiedAt: now, stepUpAt: now, lastActiveAt: now })
      .where(eq(controlSchema.platformStaffSessions.id, params.sessionId))
      .run();
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId: staff.id,
      action: "staff.mfa.enrolled",
      summary: `Enrolled TOTP multi-factor authenticator for ${staff.email}`,
      correlationId: newId(),
    })
    .run();

  return { backupCodes: plainCodes };
}

function verifyStaffTotpOrBackupCode(
  staff: typeof controlSchema.platformStaff.$inferSelect,
  rawCode: string
): boolean {
  if (!staff.totpEnabled || !staff.totpSecretEncrypted) {
    return false;
  }
  const secret = decryptEnvelope(staff.totpSecretEncrypted);
  if (verifyTotpCode(secret, rawCode)) {
    return true;
  }
  if (staff.totpBackupCodesJson) {
    try {
      const parsed = JSON.parse(staff.totpBackupCodesJson) as string[];
      if (Array.isArray(parsed)) {
        const consumed = consumeMfaBackupCode(rawCode, parsed);
        if (consumed.matched) {
          controlDb()
            .update(controlSchema.platformStaff)
            .set({ totpBackupCodesJson: JSON.stringify(consumed.remainingHashes) })
            .where(eq(controlSchema.platformStaff.id, staff.id))
            .run();
          return true;
        }
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function verifyPlatformStaffSessionMfa(params: {
  rawToken: string;
  code: string;
}): { sessionId: string; staffId: string } {
  const pending = resolveStaffSessionFromToken(params.rawToken, { allowPendingMfa: true });
  if (!pending) {
    throw new RslError("RSL-AUTH-1001", "Staff session expired. Sign in again.");
  }

  consumeAuthRateLimit({
    bucket: "staff-mfa",
    key: pending.staff.id,
    maxAttempts: 6,
    windowMs: 5 * 60_000,
  });

  if (!verifyStaffTotpOrBackupCode(pending.staff, params.code)) {
    throw new RslError("RSL-AUTH-1002", "Invalid 6-digit authenticator or backup recovery code.");
  }

  const now = Date.now();
  controlDb()
    .update(controlSchema.platformStaffSessions)
    .set({ mfaVerifiedAt: now, stepUpAt: now, lastActiveAt: now })
    .where(eq(controlSchema.platformStaffSessions.id, pending.sessionId))
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId: pending.staff.id,
      action: "staff.mfa.verified",
      summary: `Verified MFA challenge for ${pending.staff.email}`,
      correlationId: newId(),
    })
    .run();

  return { sessionId: pending.sessionId, staffId: pending.staff.id };
}

export function verifyPlatformStaffStepUp(params: {
  sessionId: string;
  staffId: string;
  totpOrBackupCode?: string;
  currentPassword?: string;
}): void {
  const db = controlDb();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, params.staffId))
    .get();
  if (!staff || !staff.active) {
    throw new RslError("RSL-AUTH-1001", "Staff account not found.");
  }

  consumeAuthRateLimit({
    bucket: "staff-stepup",
    key: staff.id,
    maxAttempts: 6,
    windowMs: 5 * 60_000,
  });

  if (staff.totpEnabled && staff.totpSecretEncrypted) {
    const code = (params.totpOrBackupCode || "").trim();
    if (!code || !verifyStaffTotpOrBackupCode(staff, code)) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Step-up verification failed. Enter a valid 6-digit authenticator or backup recovery code."
      );
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new RslError(
        "RSL-AUTH-1006",
        "Enroll TOTP multi-factor authentication before performing privileged actions."
      );
    }
    const pwd = params.currentPassword || "";
    if (!pwd || !verifyPassword(pwd, staff.passwordHash)) {
      throw new RslError(
        "RSL-AUTH-1006",
        "Confirm your staff password (or enroll TOTP MFA) to authorize this privileged action."
      );
    }
  }

  const now = Date.now();
  db.update(controlSchema.platformStaffSessions)
    .set({ stepUpAt: now, lastActiveAt: now })
    .where(eq(controlSchema.platformStaffSessions.id, params.sessionId))
    .run();
}

export function assertPlatformStaffStepUp(
  session: Pick<ResolvedStaffSession, "sessionId" | "staff" | "stepUpAt">,
  inlineStepUp?: { totpOrBackupCode?: string; currentPassword?: string },
  maxAgeMs = 15 * 60 * 1000
): void {
  const now = Date.now();
  if (session.stepUpAt && now - session.stepUpAt <= maxAgeMs) {
    return;
  }
  if (inlineStepUp?.totpOrBackupCode?.trim() || inlineStepUp?.currentPassword) {
    verifyPlatformStaffStepUp({
      sessionId: session.sessionId,
      staffId: session.staff.id,
      totpOrBackupCode: inlineStepUp.totpOrBackupCode,
      currentPassword: inlineStepUp.currentPassword,
    });
    return;
  }
  throw new RslError(
    "RSL-AUTH-1006",
    "Recent step-up re-authentication (within 15 minutes) is required for impersonation, credential changes, password resets, and database restores."
  );
}

export function signOutPlatformStaff(rawToken: string | undefined | null): void {
  if (!rawToken) return;
  controlDb()
    .delete(controlSchema.platformStaffSessions)
    .where(eq(controlSchema.platformStaffSessions.tokenHash, hashSessionToken(rawToken)))
    .run();
}

/**
 * Audited 30-minute Staff Impersonation
 */
export function createImpersonationSession(params: {
  staffId: string;
  workspaceId: string;
  reason: string;
}): { rawCustomerSessionToken: string; handoffCode: string; expiresAt: number } {
  if (params.reason.trim().length < 5) {
    throw new Error("A clear support reason (at least 5 characters) is required to impersonate.");
  }

  const db = controlDb();
  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) throw new Error("Workspace not found");

  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000;
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const handoffCode = crypto.randomBytes(24).toString("base64url");
  const handoffCodeHash = crypto.createHash("sha256").update(handoffCode).digest("hex");

  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId: ws.ownerUserId,
      tokenHash: hashSessionToken(rawToken),
      activeWorkspaceId: ws.id,
      impersonatorStaffId: params.staffId,
      impersonationReason: params.reason.trim(),
      lastActiveAt: now,
      expiresAt,
      createdAt: now,
    })
    .run();

  db.insert(controlSchema.verifications)
    .values({
      id: newId(),
      identifier: `imp_handoff:${handoffCodeHash}`,
      valueHash: encryptEnvelope(rawToken),
      failedAttempts: 0,
      expiresAt: now + 60 * 1000,
      createdAt: now,
    })
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.impersonationLogs)
    .values({
      id: newId(),
      staffId: params.staffId,
      workspaceId: ws.id,
      targetUserId: ws.ownerUserId,
      reason: params.reason.trim(),
      startedAt: now,
      expiresAt,
    })
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId: params.staffId,
      action: "staff.impersonation.started",
      targetTenantId: ws.id,
      summary: `Started 30-minute impersonation for '${ws.name}': ${params.reason.trim()}`,
      correlationId: newId(),
    })
    .run();

  return { rawCustomerSessionToken: rawToken, handoffCode, expiresAt };
}

export function consumeImpersonationHandoffCode(handoffCode: string): string | null {
  const trimmed = handoffCode.trim();
  if (!trimmed) return null;
  const db = controlDb();
  const now = Date.now();
  const handoffCodeHash = crypto.createHash("sha256").update(trimmed).digest("hex");
  const identifier = `imp_handoff:${handoffCodeHash}`;

  const row = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, identifier),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  if (!row) return null;

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.id, row.id))
    .run();

  try {
    return decryptEnvelope(row.valueHash);
  } catch {
    return null;
  }
}

export function staffUpdateClientWorkspace(params: {
  workspaceId: string;
  name: string;
  industry?: string;
  gstin?: string;
  stateCode?: string;
  billingStatus: "active" | "suspended";
}): void {
  const db = controlDb();
  const trimmedName = params.name.trim();
  if (trimmedName.length < 2) {
    throw new RslError("RSL-VAL-1001", "Business name must be at least 2 characters.");
  }
  const { cleanGstin, cleanStateCode } = validateWorkspaceGstinAndState(
    params.gstin,
    params.stateCode
  );
  const now = Date.now();
  db.update(controlSchema.workspaces)
    .set({
      name: trimmedName,
      industry: params.industry?.trim() || null,
      gstin: cleanGstin,
      stateCode: cleanStateCode,
      billingStatus: params.billingStatus,
      updatedAt: now,
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();

  db.update(controlSchema.tenantRegistry)
    .set({
      status: params.billingStatus === "suspended" ? "suspended" : "active",
      updatedAt: now,
    })
    .where(eq(controlSchema.tenantRegistry.tenantId, params.workspaceId))
    .run();

  invalidateTenantRegistryCache(params.workspaceId);
  invalidateSessionCache();
}

export function staffResetClientUserPassword(params: {
  userId: string;
  newPassword: string;
}): { email: string } {
  if (params.newPassword.length < 8) {
    throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
  }
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-VAL-1001", "Client user account not found.");
  }

  db.update(controlSchema.users)
    .set({
      passwordHash: hashPassword(params.newPassword),
      emailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  db.delete(controlSchema.sessions)
    .where(eq(controlSchema.sessions.userId, usr.id))
    .run();
  invalidateSessionCache();

  return { email: usr.email };
}

export function staffVerifyClientUserEmail(params: { userId: string }): { email: string } {
  const db = controlDb();
  const usr = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();
  if (!usr) {
    throw new RslError("RSL-VAL-1001", "Client user account not found.");
  }
  db.update(controlSchema.users)
    .set({ emailVerified: true, updatedAt: Date.now() })
    .where(eq(controlSchema.users.id, usr.id))
    .run();
  invalidateSessionCache();
  return { email: usr.email };
}

export function listPlatformStaffMembers() {
  const db = controlDb();
  const now = Date.now();
  const staffRows = db
    .select()
    .from(controlSchema.platformStaff)
    .all()
    .sort((a, b) => a.createdAt - b.createdAt);

  const activeSessions = db
    .select()
    .from(controlSchema.platformStaffSessions)
    .where(gt(controlSchema.platformStaffSessions.expiresAt, now))
    .all();

  const sessionCountByStaff = new Map<string, number>();
  for (const s of activeSessions) {
    sessionCountByStaff.set(s.staffId, (sessionCountByStaff.get(s.staffId) ?? 0) + 1);
  }

  return staffRows.map((st) => ({
    id: st.id,
    name: st.name,
    email: st.email,
    staffRole: st.staffRole,
    totpEnabled: st.totpEnabled,
    active: st.active,
    createdAt: st.createdAt,
    activeSessionsCount: sessionCountByStaff.get(st.id) ?? 0,
  }));
}

export function staffCreatePlatformMember(params: {
  name: string;
  email: string;
  password: string;
  staffRole: "super_admin" | "finance" | "support";
}): { staffId: string; email: string } {
  if (params.name.trim().length < 2) {
    throw new RslError("RSL-VAL-1001", "Staff member name is required.");
  }
  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }
  const normalized = params.email.trim().toLowerCase();
  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.email, normalized))
    .get();
  if (existing) {
    throw new RslError("RSL-VAL-1001", "A staff account with this email already exists.");
  }

  const staffId = newId();
  db.insert(controlSchema.platformStaff)
    .values({
      id: staffId,
      name: params.name.trim(),
      email: normalized,
      passwordHash: hashPassword(params.password),
      staffRole: params.staffRole,
      totpEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      active: true,
      createdAt: Date.now(),
    })
    .run();

  return { staffId, email: normalized };
}

export function staffUpdatePlatformMember(params: {
  targetStaffId: string;
  staffRole?: "super_admin" | "finance" | "support";
  active?: boolean;
  newPassword?: string;
}): { email: string } {
  const db = controlDb();
  const target = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, params.targetStaffId))
    .get();
  if (!target) {
    throw new RslError("RSL-VAL-1001", "Staff member not found.");
  }

  if (
    target.staffRole === "super_admin" &&
    (params.active === false || (params.staffRole && params.staffRole !== "super_admin"))
  ) {
    const activeAdmins = db
      .select()
      .from(controlSchema.platformStaff)
      .where(
        and(
          eq(controlSchema.platformStaff.staffRole, "super_admin"),
          eq(controlSchema.platformStaff.active, true)
        )
      )
      .all();
    if (activeAdmins.length <= 1) {
      throw new RslError(
        "RSL-VAL-1001",
        "At least one active Super Admin account must remain enabled."
      );
    }
  }

  const updates: Partial<typeof controlSchema.platformStaff.$inferInsert> = {};
  if (params.staffRole) updates.staffRole = params.staffRole;
  if (params.active !== undefined) updates.active = params.active;
  let passwordChanged = false;
  if (params.newPassword !== undefined && params.newPassword.trim().length > 0) {
    if (params.newPassword.trim().length < 8) {
      throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
    }
    updates.passwordHash = hashPassword(params.newPassword.trim());
    updates.failedLoginAttempts = 0;
    updates.lockedUntil = null;
    passwordChanged = true;
  }

  if (Object.keys(updates).length > 0) {
    db.update(controlSchema.platformStaff)
      .set(updates)
      .where(eq(controlSchema.platformStaff.id, target.id))
      .run();
  }

  if (params.active === false || passwordChanged) {
    db.delete(controlSchema.platformStaffSessions)
      .where(eq(controlSchema.platformStaffSessions.staffId, target.id))
      .run();
  }

  return { email: target.email };
}

export * from "./passkeys";
