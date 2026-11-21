import { getWorkspaceDatabaseManagementInfo } from "@rsl/backup";
import { getWorkspacePlansByKeys } from "@rsl/billing";
import { listWorkspaceConnections } from "@rsl/connections";
import { canRolePerform } from "@rsl/rbac";
import { getWorkspaceStorageStatus } from "@rsl/storage";
import { getPublicGoogleOAuthStatus, getWorkspaceCloudflareStatus } from "@rsl/tenancy";

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function loadBackupsWorkspaceContext(workspaceId: string, roleSlug: string) {
  const canRunBackups = canRolePerform(roleSlug, "backup:manage", workspaceId);
  const canManageStorage = canRolePerform(roleSlug, "backup:destination.manage", workspaceId);
  const canRestoreBackup = canRolePerform(roleSlug, "backup:restore", workspaceId);
  const canImportContacts = canRolePerform(roleSlug, "inbox:reply", workspaceId);

  const dbInfo = getWorkspaceDatabaseManagementInfo(workspaceId);
  const storage = getWorkspaceStorageStatus(workspaceId);
  const googleOAuth = getPublicGoogleOAuthStatus();
  const cloudflareStatus = getWorkspaceCloudflareStatus(workspaceId);
  const workspaceConnections = listWorkspaceConnections(workspaceId);
  const activeDriveConn = workspaceConnections.connections.find(
    (c) => c.channelKind === "google_drive"
  );
  const addonPlans = getWorkspacePlansByKeys(workspaceId, [
    "backup.export",
    "storage.managed",
    "backup.custom",
  ]);
  const backupPlan = addonPlans.find((p) => p.key === "backup.export");
  const managedStoragePlan = addonPlans.find((p) => p.key === "storage.managed");
  const customAdapterPlan = addonPlans.find((p) => p.key === "backup.custom");

  return {
    canRunBackups,
    canManageStorage,
    canRestoreBackup,
    canImportContacts,
    dbInfo,
    storage,
    googleOAuth,
    cloudflareStatus,
    activeDriveConn,
    backupPlan,
    managedStoragePlan,
    customAdapterPlan,
    hasBackupEntitlement: Boolean(backupPlan?.isUnlocked),
    hasManagedStorageEntitlement: Boolean(managedStoragePlan?.isUnlocked),
  };
}
