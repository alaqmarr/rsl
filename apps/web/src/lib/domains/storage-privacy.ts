import { revalidatePath } from "next/cache";
import { verifyUserStepUp } from "@rsl/auth";
import {
  bulkImportContactsCsv,
  createSignedEncryptedBackup,
  optimizeTenantDatabase,
  requestCustomBackupProvider,
  restoreSignedEncryptedBackup,
} from "@rsl/backup";
import {
  disconnectExternalConnection,
  uploadFileToWorkspaceGoogleDrive,
} from "@rsl/connections";
import { RslError } from "@rsl/core";
import { sendStorageAndBackupNotification } from "@rsl/notifications";
import { authorize } from "@rsl/rbac";
import {
  configureAndMigrateStorage,
  deleteWorkspaceObject,
  putWorkspaceObject,
} from "@rsl/storage";
import {
  eraseAndCryptoShredWorkspace,
  exportWorkspaceDataPortabilitySnapshot,
} from "@rsl/tenancy";
import { clearWebSessionCookie, requireWebSession } from "../session";
import {
  enforceFeaturePaidEntitlement,
  friendlyMessage,
  goWithError,
  goWithNotice,
} from "./shared";

export async function switchStorageModeActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const targetModeRaw = String(formData.get("targetMode") || "rsl_managed");
  const targetMode = (
    ["rsl_managed", "client_r2", "client_s3"].includes(targetModeRaw)
      ? targetModeRaw
      : "rsl_managed"
  ) as "rsl_managed" | "client_r2" | "client_s3";

  if (targetMode === "rsl_managed") {
    await enforceFeaturePaidEntitlement(session.workspace.id, "storage.managed", "/backups");
  }
  const res = await configureAndMigrateStorage(session.ctx, {
    targetMode,
    displayLabel: String(formData.get("displayLabel") || "") || undefined,
    r2AccountId: String(formData.get("r2AccountId") || "") || undefined,
    customEndpointUrl: String(formData.get("customEndpointUrl") || "") || undefined,
    bucketName: String(formData.get("bucketName") || "") || undefined,
    region: String(formData.get("region") || "auto"),
    accessKeyId: String(formData.get("accessKeyId") || "") || undefined,
    secretAccessKey: String(formData.get("secretAccessKey") || "") || undefined,
    migrateExistingFiles: formData.get("migrateExistingFiles") === "on",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);

  await sendStorageAndBackupNotification({
    workspaceId: session.workspace.id,
    businessName: session.workspace.name,
    recipientEmail: session.user.email,
    operationTitle: "Storage updated",
    summaryLine: `Verified storage settings and copied ${res.data.migratedCount} files (${Math.round(res.data.bytesTransferred / 1024)} KB).`,
    checksumOrDetails: `Active Storage: ${res.data.mode}`,
  }).catch(() => undefined);

  return goWithNotice(
    "/backups",
    `Storage updated (${res.data.migratedCount} existing files moved smoothly).`
  );
}

export async function deleteWorkspaceStoredObjectActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const objectId = String(formData.get("objectId") || "").trim();
  const res = await deleteWorkspaceObject(session.ctx, { objectId });
  if (!res.ok) {
    return goWithError("/backups", res.error.message);
  }
  revalidatePath("/backups");
  return goWithNotice(
    "/backups",
    `Deleted stored file '${res.data.fileName}' (${Math.max(1, Math.round(res.data.freedBytes / 1024))} KB freed).`
  );
}

export async function optimizeDatabaseActionImpl() {
  const session = await requireWebSession();
  const res = await optimizeTenantDatabase(session.ctx, {});
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Workspace optimization completed.");
}

export async function createEncryptedBackupActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");
  const label = String(formData.get("destinationLabel") || "Cloud Storage");
  const res = await createSignedEncryptedBackup(session.ctx, { destinationLabel: label });
  if (!res.ok) return goWithError("/backups", res.error.message);

  const bundleBytes = Buffer.from(res.data.bundleBufferBase64, "base64");
  const fileName = `${res.data.backupId}.rslbackup`;

  try {
    await putWorkspaceObject({
      workspaceId: session.workspace.id,
      category: "backup_archive",
      fileName,
      mimeType: "application/json",
      bytes: bundleBytes,
      actorId: session.user.id,
    });
  } catch {
    // Local backup copy already saved
  }

  const driveSync = await uploadFileToWorkspaceGoogleDrive({
    workspaceId: session.workspace.id,
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
  }).catch((err) => ({
    uploaded: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));

  await sendStorageAndBackupNotification({
    workspaceId: session.workspace.id,
    businessName: session.workspace.name,
    recipientEmail: session.user.email,
    operationTitle: "Business Backup Created",
    summaryLine: driveSync.uploaded
      ? `Backup (${Math.max(1, Math.round(res.data.sizeBytes / 1024))} KB) is ready for download and synced automatically to Google Drive (${driveSync.driveEmail || "connected account"}).`
      : `Backup (${Math.max(1, Math.round(res.data.sizeBytes / 1024))} KB) is ready for download.`,
    checksumOrDetails: `Backup ID: ${res.data.backupId}`,
  }).catch(() => undefined);

  if (driveSync.uploaded) {
    return goWithNotice(
      "/backups",
      `Backup created, ready to download, and uploaded automatically to Google Drive (${driveSync.driveEmail || "connected account"} → ${driveSync.folderName || "RapidShift Labs Backups"}).`
    );
  }

  if ("error" in driveSync && driveSync.error) {
    return goWithError(
      "/backups",
      `Local backup saved, but Google Drive upload failed: ${driveSync.error}`
    );
  }

  return goWithNotice("/backups", "Backup created and ready to download.");
}

export async function syncBackupToGoogleDriveNowActionImpl() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");

  const res = await createSignedEncryptedBackup(session.ctx, {
    destinationLabel: "Google Drive Off-Site Vault",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);

  const bundleBytes = Buffer.from(res.data.bundleBufferBase64, "base64");
  const fileName = `${res.data.backupId}.rslbackup`;

  try {
    await putWorkspaceObject({
      workspaceId: session.workspace.id,
      category: "backup_archive",
      fileName,
      mimeType: "application/json",
      bytes: bundleBytes,
      actorId: session.user.id,
    });
  } catch {
    // Local archive already persisted
  }

  const driveSync = await uploadFileToWorkspaceGoogleDrive({
    workspaceId: session.workspace.id,
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
  });

  if (!driveSync.uploaded) {
    return goWithError(
      "/backups",
      driveSync.error ||
        "Google Drive is not connected yet or requires re-authentication. Click 'Connect to Google Drive' first."
    );
  }

  return goWithNotice(
    "/backups",
    `Encrypted backup (${fileName}) created and uploaded directly to Google Drive (${driveSync.driveEmail || "connected account"} → folder '${driveSync.folderName || "RapidShift Labs Backups"}')!`
  );
}

export async function disconnectGoogleDriveFromBackupsActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const connectionId = String(formData.get("connectionId") || "").trim();
  if (!connectionId) {
    return goWithError("/backups", "Missing Google Drive connection ID.");
  }
  const res = await disconnectExternalConnection(session.ctx, { connectionId });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Google Drive automatic backup connection disconnected.");
}

export async function restoreBackupActionImpl(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");
  const confirmPhrase = String(formData.get("confirmPhrase") || "").trim();
  if (confirmPhrase !== "RESTORE") {
    return goWithError(
      "/backups",
      "Type RESTORE in uppercase to confirm replacing your workspace records."
    );
  }

  let bundleJsonText = String(formData.get("bundleJsonText") || "").trim();
  const uploaded = formData.get("backupFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    bundleJsonText = await uploaded.text();
  }

  const res = await restoreSignedEncryptedBackup(session.ctx, {
    bundleJsonText,
    confirmPhrase: "RESTORE",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice(
    "/backups",
    "Backup restored. Your wallet balance, GST invoices, and opt-out list remained untouched."
  );
}

export async function importContactsCsvActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/backups");
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/backups";
  let csvContent = String(formData.get("csvContent") || "").trim();
  const uploaded = formData.get("csvFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > 10 * 1024 * 1024) {
      return goWithError(returnPath, "CSV file must be 10 MB or smaller.");
    }
    csvContent = await uploaded.text();
  }

  const res = await bulkImportContactsCsv(session.ctx, {
    csvContent,
    recordWhatsAppConsent: formData.get("recordWhatsAppConsent") === "on",
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    `Imported ${res.data.importedCount} customer contacts from CSV.`
  );
}

export async function requestCustomAdapterActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const urgencyRaw = String(formData.get("urgency") || "normal");
  const urgency = (
    ["normal", "high", "urgent"].includes(urgencyRaw) ? urgencyRaw : "normal"
  ) as "normal" | "high" | "urgent";
  const res = await requestCustomBackupProvider(session.ctx, {
    providerName: String(formData.get("providerName") || ""),
    providerUrl: String(formData.get("providerUrl") || "") || undefined,
    urgency,
    contactEmail: String(formData.get("contactEmail") || session.user.email),
  });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Your storage integration request has been sent to our team.");
}

export async function exportWorkspaceDpdpDataJsonActionImpl(): Promise<{
  ok: boolean;
  fileName?: string;
  jsonText?: string;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "workspace:manage");
    const snapshot = exportWorkspaceDataPortabilitySnapshot(session.workspace.id);
    const slug = session.workspace.slug || session.workspace.id;
    const dateKey = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      fileName: `${slug}-dpdp-export-${dateKey}.json`,
      jsonText: JSON.stringify(snapshot, null, 2),
      message: "Generated DPDP Act 2023 portable workspace JSON archive.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function deleteWorkspaceAccountActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const confirmPhrase = String(formData.get("confirmPhrase") || "").trim();
  const password = String(formData.get("password") || "");
  const reason =
    String(formData.get("reason") || "").trim() || "Customer DPDP right-to-erasure request";

  try {
    authorize(session.ctx, "workspace:manage");
    if (session.roleSlug !== "owner") {
      throw new RslError(
        "RSL-RBAC-1002",
        "Only the Business Owner can permanently delete and crypto-shred a workspace."
      );
    }
    if (session.impersonatorStaffId) {
      throw new RslError(
        "RSL-RBAC-1002",
        "Support sessions cannot permanently erase a customer workspace."
      );
    }
    if (confirmPhrase !== "DELETE MY WORKSPACE") {
      throw new RslError(
        "RSL-VAL-1001",
        "Type DELETE MY WORKSPACE in uppercase to confirm permanent erasure."
      );
    }

    verifyUserStepUp({
      userId: session.user.id,
      sessionId: session.sessionId,
      currentPassword: password,
    });

    eraseAndCryptoShredWorkspace({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      reason,
    });

    await clearWebSessionCookie();
  } catch (err) {
    return goWithError("/settings/business", friendlyMessage(err));
  }

  return goWithNotice(
    "/login",
    "Workspace deleted and crypto-shredded in accordance with the DPDP Act 2023. Statutory GST tax invoice records are retained per law."
  );
}
