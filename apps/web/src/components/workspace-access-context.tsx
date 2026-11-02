"use client";

import React, { createContext, useContext, useMemo } from "react";
import {
  ALL_PERMISSIONS,
  canPermissionsAccessWebRoute,
  formatRoleLabel,
  type Permission,
} from "@rsl/rbac/catalog";

export interface WorkspaceAccessContextValue {
  roleSlug: string;
  roleLabel: string;
  permissions: Permission[];
  canPerform: (permission: Permission) => boolean;
  canAccessRoute: (pathname: string) => boolean;
}

const DEFAULT_ACCESS: WorkspaceAccessContextValue = {
  roleSlug: "owner",
  roleLabel: "Business Owner",
  permissions: ALL_PERMISSIONS,
  canPerform: () => true,
  canAccessRoute: () => true,
};

const WorkspaceAccessContext = createContext<WorkspaceAccessContextValue>(DEFAULT_ACCESS);

export function WorkspaceAccessProvider({
  roleSlug,
  permissions,
  children,
}: {
  roleSlug: string;
  permissions: Permission[];
  children: React.ReactNode;
}) {
  const value = useMemo<WorkspaceAccessContextValue>(() => {
    const permSet = new Set<Permission>(permissions);
    return {
      roleSlug,
      roleLabel: formatRoleLabel(roleSlug),
      permissions,
      canPerform: (permission: Permission) => permSet.has(permission),
      canAccessRoute: (pathname: string) => canPermissionsAccessWebRoute(permSet, pathname),
    };
  }, [roleSlug, permissions]);

  return (
    <WorkspaceAccessContext.Provider value={value}>{children}</WorkspaceAccessContext.Provider>
  );
}

export function useWorkspaceAccess(): WorkspaceAccessContextValue {
  return useContext(WorkspaceAccessContext);
}
