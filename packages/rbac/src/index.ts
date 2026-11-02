import { and, eq } from "drizzle-orm";
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
} from "./catalog";

export {
  ALL_PERMISSIONS,
  canPermissionsAccessWebRoute,
  canStaffAccessAdminRoute,
  canStaffRolePerform,
  formatRoleLabel,
  formatStaffRoleLabel,
  getStaffPermissions,
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
};

let rolesSeeded = false;

export function ensureSystemRolesSeeded(): void {
  if (rolesSeeded) return;
  const db = controlDb();
  const now = Date.now();

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

  rolesSeeded = true;
}

export function getPermissionsForRole(roleSlug: string, workspaceId?: string): Set<Permission> {
  const sys = SYSTEM_ROLES.find((r) => r.slug === roleSlug);
  if (sys) {
    return new Set(sys.permissions);
  }

  ensureSystemRolesSeeded();
  const db = controlDb();
  const customRole = workspaceId
    ? db
        .select()
        .from(controlSchema.roles)
        .where(
          and(
            eq(controlSchema.roles.workspaceId, workspaceId),
            eq(controlSchema.roles.slug, roleSlug)
          )
        )
        .get()
    : undefined;

  if (!customRole) return new Set();

  const rows = db
    .select()
    .from(controlSchema.rolePermissions)
    .where(eq(controlSchema.rolePermissions.roleId, customRole.id))
    .all();

  return new Set(rows.map((r) => r.permission as Permission));
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

/**
 * Enforces permission and optional asset-level scoping (Section 10).
 * Never compares role names directly.
 */
export function authorize(
  ctx: TenantContext,
  permission: Permission,
  resource?: { assetId?: string | null }
): void {
  if (ctx.actorType === "system" || ctx.actorType === "webhook" || ctx.actorType === "agent") {
    return;
  }

  const resolvedRole =
    ctx.roleSlug ??
    (() => {
      const m = controlDb()
        .select()
        .from(controlSchema.memberships)
        .where(
          and(
            eq(controlSchema.memberships.workspaceId, ctx.workspaceId),
            eq(controlSchema.memberships.userId, ctx.actorId)
          )
        )
        .get();
      return m?.roleSlug;
    })();

  if (!resolvedRole) {
    throw new RslError("RSL-RBAC-1001");
  }

  const perms = getPermissionsForRole(resolvedRole, ctx.workspaceId);
  if (!perms.has(permission)) {
    throw new RslError(
      "RSL-RBAC-1001",
      `Your role (${formatRoleLabel(resolvedRole)}) does not include '${PERMISSION_CATALOG[permission].label}'.`
    );
  }

  if (resource?.assetId && ctx.assetScope && ctx.assetScope.length > 0) {
    if (!ctx.assetScope.includes(resource.assetId)) {
      throw new RslError("RSL-RBAC-1002");
    }
  }
}

export function authorizeAny(ctx: TenantContext, permissions: Permission[]): void {
  if (ctx.actorType === "system" || ctx.actorType === "webhook" || ctx.actorType === "agent") {
    return;
  }
  if (permissions.length === 0) return;

  const resolvedRole =
    ctx.roleSlug ??
    (() => {
      const m = controlDb()
        .select()
        .from(controlSchema.memberships)
        .where(
          and(
            eq(controlSchema.memberships.workspaceId, ctx.workspaceId),
            eq(controlSchema.memberships.userId, ctx.actorId)
          )
        )
        .get();
      return m?.roleSlug;
    })();

  if (!resolvedRole) {
    throw new RslError("RSL-RBAC-1001");
  }

  const perms = getPermissionsForRole(resolvedRole, ctx.workspaceId);
  if (!permissions.some((p) => perms.has(p))) {
    const firstLabel = PERMISSION_CATALOG[permissions[0]!].label;
    throw new RslError(
      "RSL-RBAC-1001",
      `Your role (${formatRoleLabel(resolvedRole)}) does not include '${firstLabel}'.`
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
