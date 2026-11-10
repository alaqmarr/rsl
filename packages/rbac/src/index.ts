import { and, eq, isNull } from "drizzle-orm";
import { newId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, type TenantContext } from "@rsl/tenancy";
import {
  ALL_PERMISSIONS,
  canPermissionsAccessWebRoute,
  canStaffAccessAdminRoute,
  canStaffRolePerform,
  formatRoleLabel,
  formatStaffRoleLabel,
  getStaffPermissions,
  normalizeSystemRoleSlug,
  PERMISSION_CATALOG,
  STAFF_PERMISSION_CATALOG,
  STAFF_ROLE_PERMISSIONS,
  STAFF_ROUTE_ACCESS_RULES,
  SYSTEM_ROLES,
  VIEW_ONLY_PERMISSIONS,
  WEB_ROUTE_ACCESS_RULES,
  type Permission,
  type PermissionMeta,
  type StaffPermission,
  type StaffRoleSlug,
  type SystemRoleDefinition,
  type SystemRoleSlug,
} from "./catalog";

export {
  ALL_PERMISSIONS,
  canPermissionsAccessWebRoute,
  canStaffAccessAdminRoute,
  canStaffRolePerform,
  formatRoleLabel,
  formatStaffRoleLabel,
  getStaffPermissions,
  normalizeSystemRoleSlug,
  PERMISSION_CATALOG,
  STAFF_PERMISSION_CATALOG,
  STAFF_ROLE_PERMISSIONS,
  STAFF_ROUTE_ACCESS_RULES,
  SYSTEM_ROLES,
  VIEW_ONLY_PERMISSIONS,
  WEB_ROUTE_ACCESS_RULES,
  type Permission,
  type PermissionMeta,
  type StaffPermission,
  type StaffRoleSlug,
  type SystemRoleDefinition,
  type SystemRoleSlug,
};

const seededDbInstances = new WeakSet<object>();

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const membershipCache = new Map<string, TimedEntry<{ roleSlug: string; assetScope: string[] | null } | null>>();
const customRolePermCache = new Map<string, TimedEntry<Set<Permission>>>();

export function invalidateRbacCache(workspaceId?: string, userId?: string): void {
  if (!workspaceId) {
    membershipCache.clear();
    customRolePermCache.clear();
    return;
  }
  if (userId) {
    membershipCache.delete(`${workspaceId}:${userId}`);
  } else {
    for (const k of membershipCache.keys()) {
      if (k.startsWith(`${workspaceId}:`)) {
        membershipCache.delete(k);
      }
    }
  }
  for (const k of customRolePermCache.keys()) {
    if (k.startsWith(`${workspaceId}:`)) {
      customRolePermCache.delete(k);
    }
  }
}

export function ensureSystemRolesSeeded(): void {
  const db = controlDb();
  if (seededDbInstances.has(db.$client)) return;

  const existingSystemCount = db.$client
    .prepare("SELECT COUNT(*) AS cnt FROM roles WHERE is_system = 1")
    .get() as { cnt: number } | undefined;

  if ((existingSystemCount?.cnt ?? 0) >= SYSTEM_ROLES.length) {
    seededDbInstances.add(db.$client);
    return;
  }

  const now = Date.now();
  const seedTx = db.$client.transaction(() => {
    for (const roleDef of SYSTEM_ROLES) {
      let existing = db
        .select()
        .from(controlSchema.roles)
        .where(and(eq(controlSchema.roles.slug, roleDef.slug), eq(controlSchema.roles.isSystem, true)))
        .get();

      if (!existing) {
        const roleId = newId();
        db.insert(controlSchema.roles)
          .values({
            id: roleId,
            workspaceId: null,
            slug: roleDef.slug,
            name: roleDef.name,
            description: roleDef.description,
            isSystem: true,
            createdAt: now,
          })
          .run();
        existing = {
          id: roleId,
          workspaceId: null,
          slug: roleDef.slug,
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
          createdAt: now,
        };
      }

      for (const perm of roleDef.permissions) {
        db.insert(controlSchema.rolePermissions)
          .values({
            id: newId(),
            roleId: existing.id,
            permission: perm,
          })
          .onConflictDoNothing()
          .run();
      }
    }
  });
  seedTx();

  seededDbInstances.add(db.$client);
}

export function getPermissionsForRole(roleSlug: string, workspaceId?: string): Set<Permission> {
  const normalizedSlug = normalizeSystemRoleSlug(roleSlug);
  const sys = SYSTEM_ROLES.find((r) => r.slug === normalizedSlug);
  if (sys) {
    return new Set(sys.permissions);
  }

  if (!workspaceId) return new Set();

  const cacheKey = `${workspaceId}:${roleSlug}`;
  const now = Date.now();
  const cached = customRolePermCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return new Set(cached.value);
  }

  ensureSystemRolesSeeded();
  const db = controlDb();
  const customRole = db
    .select()
    .from(controlSchema.roles)
    .where(
      and(
        eq(controlSchema.roles.workspaceId, workspaceId),
        eq(controlSchema.roles.slug, roleSlug)
      )
    )
    .get();

  if (!customRole) return new Set();

  const rows = db
    .select()
    .from(controlSchema.rolePermissions)
    .where(eq(controlSchema.rolePermissions.roleId, customRole.id))
    .all();

  const permSet = new Set(rows.map((r) => r.permission as Permission));
  customRolePermCache.set(cacheKey, { value: permSet, expiresAt: now + CACHE_TTL_MS });
  return new Set(permSet);
}

export function canRolePerform(
  roleSlug: string,
  permission: Permission,
  workspaceId?: string
): boolean {
  return getPermissionsForRole(roleSlug, workspaceId).has(permission);
}

export function canRolePerformAny(
  roleSlug: string,
  permissions: Permission[],
  workspaceId?: string
): boolean {
  if (permissions.length === 0) return true;
  const granted = getPermissionsForRole(roleSlug, workspaceId);
  return permissions.some((p) => granted.has(p));
}

export function canRoleAccessWebRoute(
  roleSlug: string,
  pathname: string,
  workspaceId?: string
): boolean {
  const granted = getPermissionsForRole(roleSlug, workspaceId);
  return canPermissionsAccessWebRoute(granted, pathname);
}

const API_KEY_PERMISSION_MAP: Partial<Record<Permission, readonly string[]>> = {
  "inbox:view": ["contacts:read", "contacts:write", "messages:write", "whatsapp:read", "whatsapp:write"],
  "inbox:reply": ["contacts:write", "messages:write", "whatsapp:write"],
  "pixel:view": ["pixel:write", "analytics:read"],
  "pixel:manage": ["pixel:write"],
  "whatsapp:view": ["whatsapp:read", "whatsapp:write", "messages:write"],
  "whatsapp:send": ["whatsapp:write", "messages:write"],
  "whatsapp:template.manage": ["whatsapp:write"],
  "tally:view": ["vouchers:read", "vouchers:write"],
  "tally:sync.manage": ["vouchers:write"],
  "tally:invoice.send": ["vouchers:write", "whatsapp:write", "messages:write"],
  "ads:view": ["analytics:read"],
  "logs:view": ["analytics:read"],
};

const AGENT_ALLOWED_PERMISSIONS = new Set<Permission>([
  "tally:view",
  "tally:sync.manage",
  "tally:invoice.send",
]);

const WEBHOOK_ALLOWED_PERMISSIONS = new Set<Permission>([
  "inbox:view",
  "inbox:reply",
  "inbox:note",
  "whatsapp:view",
  "whatsapp:send",
  "tally:view",
  "tally:sync.manage",
  "tally:invoice.send",
  "pixel:view",
  "pixel:manage",
  "ads:view",
]);

function resolveVerifiedMembership(
  workspaceId: string,
  userId: string
): { roleSlug: string; assetScope: string[] | null } | null {
  const cacheKey = `${workspaceId}:${userId}`;
  const now = Date.now();
  const hit = membershipCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const m = controlDb()
    .select()
    .from(controlSchema.memberships)
    .where(
      and(
        eq(controlSchema.memberships.workspaceId, workspaceId),
        eq(controlSchema.memberships.userId, userId)
      )
    )
    .get();

  if (!m) {
    membershipCache.set(cacheKey, { value: null, expiresAt: now + 1_000 });
    return null;
  }

  let parsedAssetScope: string[] | null = null;
  if (m.assetScopeJson) {
    try {
      const parsed = JSON.parse(m.assetScopeJson);
      if (Array.isArray(parsed)) {
        parsedAssetScope = parsed.map(String);
      }
    } catch {
      parsedAssetScope = null;
    }
  }

  const resolved = { roleSlug: m.roleSlug, assetScope: parsedAssetScope };
  membershipCache.set(cacheKey, { value: resolved, expiresAt: now + CACHE_TTL_MS });
  return resolved;
}

function resolveApiKeyScopes(ctx: TenantContext): Set<string> {
  if (Array.isArray(ctx.apiKeyScopes)) {
    return new Set(ctx.apiKeyScopes);
  }
  const keyRow = controlDb()
    .select()
    .from(controlSchema.apiKeys)
    .where(
      and(
        eq(controlSchema.apiKeys.id, ctx.actorId),
        eq(controlSchema.apiKeys.workspaceId, ctx.workspaceId),
        isNull(controlSchema.apiKeys.revokedAt)
      )
    )
    .get();
  if (!keyRow) {
    throw new RslError("RSL-API-1001");
  }
  if (keyRow.expiresAt && keyRow.expiresAt < Date.now()) {
    throw new RslError("RSL-API-1001");
  }
  try {
    const arr = JSON.parse(keyRow.scopesJson);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function authorizeNonUserActor(ctx: TenantContext, permissions: Permission[]): void {
  if (ctx.actorType === "system") {
    if (!ctx.actorId || !ctx.actorId.trim()) {
      throw new RslError("RSL-RBAC-1001", "System capability context is missing an actor identifier.");
    }
    if (
      ctx.systemCapability &&
      ctx.systemCapability !== "*" &&
      !permissions.some((p) => p === ctx.systemCapability)
    ) {
      throw new RslError(
        "RSL-RBAC-1001",
        `System capability '${ctx.systemCapability}' does not permit [${permissions.join(", ")}].`
      );
    }
    return;
  }

  if (ctx.actorType === "webhook") {
    if (!permissions.some((p) => WEBHOOK_ALLOWED_PERMISSIONS.has(p))) {
      throw new RslError("RSL-RBAC-1001", "Webhook context is not permitted to invoke this administrative action.");
    }
    return;
  }

  if (ctx.actorType === "agent") {
    const dev = controlDb()
      .select()
      .from(controlSchema.agentDevices)
      .where(
        and(
          eq(controlSchema.agentDevices.id, ctx.actorId),
          eq(controlSchema.agentDevices.workspaceId, ctx.workspaceId),
          isNull(controlSchema.agentDevices.revokedAt)
        )
      )
      .get();
    if (!dev || dev.status === "revoked") {
      throw new RslError("RSL-TALLY-1002", "Paired Tally connector device is invalid or revoked.");
    }
    if (!permissions.some((p) => AGENT_ALLOWED_PERMISSIONS.has(p))) {
      throw new RslError("RSL-RBAC-1001", "Tally connector devices are restricted to Tally sync permissions.");
    }
    return;
  }

  if (ctx.actorType === "api_key") {
    const grantedScopes = resolveApiKeyScopes(ctx);
    const allowed = permissions.some((perm) => {
      const acceptableScopes = API_KEY_PERMISSION_MAP[perm];
      if (!acceptableScopes || acceptableScopes.length === 0) return false;
      return acceptableScopes.some((s) => grantedScopes.has(s));
    });
    if (!allowed) {
      throw new RslError("RSL-API-1002");
    }
    return;
  }

  if (ctx.actorType === "staff") {
    const staff = controlDb()
      .select()
      .from(controlSchema.platformStaff)
      .where(eq(controlSchema.platformStaff.id, ctx.actorId))
      .get();
    if (!staff || !staff.active) {
      throw new RslError("RSL-AUTH-1001", "Active platform staff session is required.");
    }
    if (staff.staffRole === "super_admin") {
      return;
    }
    if (permissions.some((p) => p === "backup:restore" || p === "backup:manage" || p === "backup:view")) {
      authorizeStaff(staff, "staff:ops.manage");
      return;
    }
    if (permissions.some((p) => p === "billing:manage" || p === "billing:view")) {
      authorizeStaff(staff, "staff:billing.manage");
      return;
    }
    authorizeStaff(staff, "staff:clients.view");
    return;
  }

  throw new RslError("RSL-RBAC-1001");
}

/**
 * Enforces permission and asset-level scoping from verified database membership or API-key scopes.
 * Caller-supplied `ctx.roleSlug` is never trusted for authorization decisions.
 */
export function authorize(
  ctx: TenantContext,
  permission: Permission,
  resource?: { assetId?: string | null }
): void {
  if (ctx.actorType !== "user") {
    authorizeNonUserActor(ctx, [permission]);
    return;
  }

  const membership = resolveVerifiedMembership(ctx.workspaceId, ctx.actorId);
  if (!membership) {
    throw new RslError("RSL-RBAC-1001");
  }

  const perms = getPermissionsForRole(membership.roleSlug, ctx.workspaceId);
  if (!perms.has(permission)) {
    throw new RslError(
      "RSL-RBAC-1001",
      `Your role (${formatRoleLabel(membership.roleSlug)}) does not include '${PERMISSION_CATALOG[permission].label}'.`
    );
  }

  const effectiveAssetScope =
    membership.assetScope && membership.assetScope.length > 0
      ? membership.assetScope
      : ctx.assetScope && ctx.assetScope.length > 0
        ? ctx.assetScope
        : null;

  if (resource?.assetId && effectiveAssetScope) {
    if (!effectiveAssetScope.includes(resource.assetId)) {
      throw new RslError("RSL-RBAC-1002");
    }
  }
}

export function authorizeAny(ctx: TenantContext, permissions: Permission[]): void {
  if (permissions.length === 0) return;

  if (ctx.actorType !== "user") {
    authorizeNonUserActor(ctx, permissions);
    return;
  }

  const membership = resolveVerifiedMembership(ctx.workspaceId, ctx.actorId);
  if (!membership) {
    throw new RslError("RSL-RBAC-1001");
  }

  const perms = getPermissionsForRole(membership.roleSlug, ctx.workspaceId);
  if (!permissions.some((p) => perms.has(p))) {
    const firstLabel = PERMISSION_CATALOG[permissions[0]!].label;
    throw new RslError(
      "RSL-RBAC-1001",
      `Your role (${formatRoleLabel(membership.roleSlug)}) does not include '${firstLabel}'.`
    );
  }
}

export function canStaffPerform(
  staff: { staffRole: string } | string,
  permission: StaffPermission
): boolean {
  const role = typeof staff === "string" ? staff : staff.staffRole;
  return canStaffRolePerform(role, permission);
}

export function authorizeStaff(
  staff: { staffRole: string } | string,
  permission: StaffPermission
): void {
  const role = typeof staff === "string" ? staff : staff.staffRole;
  if (!canStaffRolePerform(role, permission)) {
    throw new RslError(
      "RSL-RBAC-1001",
      `Your staff role (${formatStaffRoleLabel(role)}) does not include permission to ${STAFF_PERMISSION_CATALOG[permission].label.toLowerCase()}.`
    );
  }
}
