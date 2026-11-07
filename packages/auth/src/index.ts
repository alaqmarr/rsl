import crypto from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { ensureServiceCatalogSeeded } from "@rsl/billing";
import {
  decryptEnvelope,
  encryptEnvelope,
  hashPassword,
  newId,
  RslError,
  verifyPassword,
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
  markWorkspaceSslCertificatesQueued,
  platformLogsDb,
  provisionTenantDatabase,
  type TenantContext,
} from "@rsl/tenancy";

export const WEB_SESSION_COOKIE = "rsl_session";
export const ADMIN_SESSION_COOKIE = "rsl_staff_session";

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
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    roleSlug: string;
    billingStatus: string;
  }>;
  ctx: TenantContext;
}

export const DEFAULT_STARTER_TRIAL_DAYS = 7;

export function registerUserWithWorkspace(params: {
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
}): { rawSessionToken: string; userId: string; workspaceId: string } {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }

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
  const normalizedEmail = params.email.trim().toLowerCase();

  const existing = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalizedEmail))
    .get();
  if (existing) {
    throw new RslError("RSL-AUTH-1003");
  }

  const now = Date.now();
  const userId = newId("usr", params.name);
  const workspaceId = newId("biz", params.businessName);
  const passwordHash = hashPassword(params.password);
  const slug = slugifyWorkspace(params.businessName);
  const trialDays = Math.max(0, Math.round(params.grantStarterTrialDays ?? 0));
  const freeAccessUntil = trialDays > 0 ? now + trialDays * 86_400_000 : null;

  const tx = db.$client.transaction(() => {
    db.insert(controlSchema.users)
      .values({
        id: userId,
        name: params.name.trim(),
        email: normalizedEmail,
        emailVerified: true,
        passwordHash,
        totpEnabled: false,
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

  // Provision isolated SQLite files for this business & queue client subdomain SSL
  provisionTenantDatabase(workspaceId);
  markWorkspaceSslCertificatesQueued({ workspaceId, workspaceSlug: slug });

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId: workspaceId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days
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
    durationMs: 5,
    summary: `Created business account '${params.businessName.trim()}'`,
  });

  return { rawSessionToken, userId, workspaceId };
}

export function signInUser(params: {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}): { rawSessionToken: string; userId: string; workspaceId: string } {
  ensureSystemRolesSeeded();
  ensureServiceCatalogSeeded();

  const db = controlDb();
  const normalizedEmail = params.email.trim().toLowerCase();
  const user = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalizedEmail))
    .get();

  if (!user || !user.passwordHash || !verifyPassword(params.password, user.passwordHash)) {
    throw new RslError("RSL-AUTH-1002");
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

  const now = Date.now();
  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId: user.id,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    })
    .run();

  return { rawSessionToken, userId: user.id, workspaceId: activeWorkspaceId };
}

export function signOutSession(rawToken: string): void {
  const tokenHash = hashSessionToken(rawToken);
  controlDb().delete(controlSchema.sessions).where(eq(controlSchema.sessions.tokenHash, tokenHash)).run();
}

export function resolveUserSessionFromToken(rawToken: string | undefined | null): AuthenticatedSession | null {
  if (!rawToken) return null;
  ensureSystemRolesSeeded();

  const db = controlDb();
  const now = Date.now();
  const tokenHash = hashSessionToken(rawToken);

  const session = db
    .select()
    .from(controlSchema.sessions)
    .where(and(eq(controlSchema.sessions.tokenHash, tokenHash), gt(controlSchema.sessions.expiresAt, now)))
    .get();

  if (!session) return null;

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
    })
    .from(controlSchema.memberships)
    .innerJoin(
      controlSchema.workspaces,
      eq(controlSchema.memberships.workspaceId, controlSchema.workspaces.id)
    )
    .where(eq(controlSchema.memberships.userId, user.id))
    .all();

  if (allMemberships.length === 0) return null;

  const currentMembership =
    allMemberships.find((m) => m.workspaceId === session.activeWorkspaceId) ?? allMemberships[0]!;

  const workspace = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, currentMembership.workspaceId))
    .get();
  if (!workspace) return null;

  const permissions = Array.from(getPermissionsForRole(currentMembership.roleSlug, workspace.id));
  const assetScope = currentMembership.assetScopeJson
    ? (JSON.parse(currentMembership.assetScopeJson) as string[])
    : null;

  const reqId = newId();
  const ctx: TenantContext = {
    workspaceId: workspace.id,
    actorType: session.impersonatorStaffId ? "staff" : "user",
    actorId: user.id,
    roleSlug: currentMembership.roleSlug,
    assetScope,
    impersonatorId: session.impersonatorStaffId ?? null,
    requestId: reqId,
    correlationId: reqId,
  };

  return {
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
    workspaces: allMemberships.map((m) => ({
      id: m.workspaceId,
      name: m.name,
      slug: m.slug,
      roleSlug: m.roleSlug,
      billingStatus: m.billingStatus,
    })),
    ctx,
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
    return { mode: "added_existing", email: normalized };
  }

  if (params.initialPassword && params.name) {
    const userId = newId();
    db.insert(controlSchema.users)
      .values({
        id: userId,
        name: params.name.trim(),
        email: normalized,
        emailVerified: true,
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

  const rawSessionToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: hashSessionToken(rawSessionToken),
      activeWorkspaceId: ws.id,
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
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
    durationMs: 5,
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
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  // Security (SEC-06): revoke active sessions on password change
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
  return { revokedCount };
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

export function bootstrapFirstPlatformStaff(params: {
  name: string;
  email: string;
  password: string;
}): { rawToken: string; staffId: string } {
  if (countPlatformStaff() > 0) {
    throw new Error("Initial staff account already exists. Sign in instead.");
  }
  if (params.password.length < 8) {
    throw new RslError("RSL-VAL-1001", "Password must be at least 8 characters long.");
  }

  const db = controlDb();
  const staffId = newId();
  const now = Date.now();
  db.insert(controlSchema.platformStaff)
    .values({
      id: staffId,
      name: params.name.trim(),
      email: params.email.trim().toLowerCase(),
      passwordHash: hashPassword(params.password),
      staffRole: "super_admin",
      totpEnabled: false,
      active: true,
      createdAt: now,
    })
    .run();

  const rawToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.platformStaffSessions)
    .values({
      id: newId(),
      staffId,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: now + 12 * 60 * 60 * 1000, // 12h staff session
      createdAt: now,
    })
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newId(),
      ts: now,
      staffId,
      action: "staff.bootstrapped",
      summary: `Created initial super_admin staff account (${params.email.trim().toLowerCase()})`,
      correlationId: newId(),
    })
    .run();

  return { rawToken, staffId };
}

export function signInPlatformStaff(params: {
  email: string;
  password: string;
}): { rawToken: string; staffId: string } {
  const db = controlDb();
  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.email, params.email.trim().toLowerCase()))
    .get();

  if (!staff || !staff.active || !verifyPassword(params.password, staff.passwordHash)) {
    throw new RslError("RSL-AUTH-1002");
  }

  const now = Date.now();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  db.insert(controlSchema.platformStaffSessions)
    .values({
      id: newId(),
      staffId: staff.id,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: now + 12 * 60 * 60 * 1000,
      createdAt: now,
    })
    .run();

  return { rawToken, staffId: staff.id };
}

export function resolveStaffSessionFromToken(rawToken: string | undefined | null) {
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

  const staff = db
    .select()
    .from(controlSchema.platformStaff)
    .where(eq(controlSchema.platformStaff.id, sess.staffId))
    .get();
  if (!staff || !staff.active) return null;

  return { sessionId: sess.id, staff };
}

export function signOutPlatformStaff(rawToken: string | undefined | null): void {
  if (!rawToken) return;
  controlDb()
    .delete(controlSchema.platformStaffSessions)
    .where(eq(controlSchema.platformStaffSessions.tokenHash, hashSessionToken(rawToken)))
    .run();
}

/**
 * Audited 30-minute Staff Impersonation (Section 10)
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
  const expiresAt = now + 30 * 60 * 1000; // Hard 30-minute cap
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
      expiresAt,
      createdAt: now,
    })
    .run();

  // Single-use 60-second encrypted handoff code (SEC-07): prevents raw session tokens in URLs
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

  // Atomically burn the handoff code on first consumption
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
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.users.id, usr.id))
    .run();

  // Security (SEC-06): revoke all existing sessions when password is reset by staff
  db.delete(controlSchema.sessions)
    .where(eq(controlSchema.sessions.userId, usr.id))
    .run();

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

  // Prevent locking out the last active super_admin
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
