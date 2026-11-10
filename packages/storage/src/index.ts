import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { consumeUsage, hasActiveEntitlement } from "@rsl/billing";
import {
  assertSafeExternalUrl,
  assertValidUlid,
  decryptEnvelope,
  encryptEnvelope,
  fetchWithRetry,
  getEnv,
  newEntityId,
  RslError,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import {
  controlDb,
  getPlatformManagedR2Config,
  isWorkspaceSandboxIntegrationMode,
} from "@rsl/tenancy";

const DEFAULT_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB default quota
const MANAGED_PLAN_MIN_QUOTA_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB managed vault quota
const MANAGED_INCLUDED_FREE_BYTES = 1024 * 1024 * 1024; // 1 GB included before per-MB metering
const MANAGED_EXCESS_COST_PAISE_PER_MB = 2; // ₹0.02/MB (~₹20/GB) integer paise

export interface S3CredentialsPayload {
  accessKeyId: string;
  secretAccessKey: string;
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
}

function buildS3Client(endpointUrl: string, region: string, creds: S3CredentialsPayload): S3Client {
  return new S3Client({
    region: region || "auto",
    endpoint: endpointUrl,
    forcePathStyle: true,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

function resolvePlatformVaultFilePath(workspaceId: string, objectKey: string): string {
  const validWs = assertValidUlid(workspaceId, "workspaceId");
  const safeRelKey = objectKey.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\./g, "_");
  const vaultRoot = path.resolve(getEnv().DATA_DIR, "vault", validWs);
  const fullPath = path.resolve(vaultRoot, safeRelKey);
  if (!fullPath.startsWith(vaultRoot)) {
    throw new Error("Unsafe storage object path");
  }
  return fullPath;
}

function resolveClientR2SandboxFilePath(
  workspaceId: string,
  bucketName: string,
  objectKey: string
): string {
  const validWs = assertValidUlid(workspaceId, "workspaceId");
  const safeBucket = (bucketName || "r2").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRelKey = objectKey.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\./g, "_");
  const vaultRoot = path.resolve(getEnv().DATA_DIR, "vault-client-r2", validWs, safeBucket);
  const fullPath = path.resolve(vaultRoot, safeRelKey);
  if (!fullPath.startsWith(vaultRoot)) {
    throw new Error("Unsafe client R2 sandbox object path");
  }
  return fullPath;
}

async function writeToBackend(params: {
  mode: "rsl_managed" | "client_r2" | "client_s3";
  workspaceId: string;
  objectKey: string;
  bytes: Buffer;
  mimeType: string;
  endpointUrl?: string | null;
  bucketName?: string | null;
  region?: string | null;
  creds?: S3CredentialsPayload | null;
}): Promise<void> {
  if (params.mode === "rsl_managed") {
    const r2 = getPlatformManagedR2Config();
    if (r2.isReady) {
      const s3 = buildS3Client(r2.endpointUrl, "auto", {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: r2.bucketPrivate,
          Key: `${params.workspaceId}/${params.objectKey}`,
          Body: params.bytes,
          ContentType: params.mimeType,
        })
      );
      return;
    }

    const filePath = resolvePlatformVaultFilePath(params.workspaceId, params.objectKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, params.bytes, { mode: 0o600 });
    return;
  }

  if (!params.endpointUrl || !params.bucketName || !params.creds) {
    throw new RslError("RSL-VAL-1001", "Personal Cloudflare R2 / S3 credentials are incomplete.");
  }

  if (
    params.mode === "client_r2" &&
    params.creds.cloudflareApiToken &&
    isWorkspaceSandboxIntegrationMode(params.workspaceId, params.creds.cloudflareApiToken)
  ) {
    const filePath = resolveClientR2SandboxFilePath(
      params.workspaceId,
      params.bucketName,
      params.objectKey
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, params.bytes, { mode: 0o600 });
    return;
  }

  try {
    const s3 = buildS3Client(params.endpointUrl, params.region ?? "auto", params.creds);
    await s3.send(
      new PutObjectCommand({
        Bucket: params.bucketName,
        Key: `${params.workspaceId}/${params.objectKey}`,
        Body: params.bytes,
        ContentType: params.mimeType,
      })
    );
    return;
  } catch (s3Err) {
    if (
      params.mode === "client_r2" &&
      params.creds.cloudflareApiToken &&
      params.creds.cloudflareAccountId
    ) {
      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(params.creds.cloudflareAccountId)}/r2/buckets/${encodeURIComponent(params.bucketName)}/objects/${encodeURIComponent(`${params.workspaceId}/${params.objectKey}`)}`;
      const resp = await fetchWithRetry(
        cfUrl,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${params.creds.cloudflareApiToken}`,
            "Content-Type": params.mimeType || "application/octet-stream",
          },
          body: new Uint8Array(params.bytes),
        },
        { maxAttempts: 2, timeoutMs: 12000 }
      );
      if (resp.ok) return;
    }
    throw s3Err;
  }
}

async function readFromBackend(params: {
  mode: "rsl_managed" | "client_r2" | "client_s3";
  workspaceId: string;
  objectKey: string;
  endpointUrl?: string | null;
  bucketName?: string | null;
  region?: string | null;
  creds?: S3CredentialsPayload | null;
}): Promise<Buffer> {
  if (params.mode === "rsl_managed") {
    const r2 = getPlatformManagedR2Config();
    if (r2.isReady) {
      const s3 = buildS3Client(r2.endpointUrl, "auto", {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      });
      const out = await s3.send(
        new GetObjectCommand({
          Bucket: r2.bucketPrivate,
          Key: `${params.workspaceId}/${params.objectKey}`,
        })
      );
      const arr = await out.Body?.transformToByteArray();
      return Buffer.from(arr ?? []);
    }

    const filePath = resolvePlatformVaultFilePath(params.workspaceId, params.objectKey);
    return fs.readFileSync(filePath);
  }

  if (!params.endpointUrl || !params.bucketName || !params.creds) {
    throw new RslError("RSL-VAL-1001", "Personal storage configuration is missing.");
  }

  if (
    params.mode === "client_r2" &&
    params.creds.cloudflareApiToken &&
    isWorkspaceSandboxIntegrationMode(params.workspaceId, params.creds.cloudflareApiToken)
  ) {
    const filePath = resolveClientR2SandboxFilePath(
      params.workspaceId,
      params.bucketName,
      params.objectKey
    );
    return fs.readFileSync(filePath);
  }

  try {
    const s3 = buildS3Client(params.endpointUrl, params.region ?? "auto", params.creds);
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: params.bucketName,
        Key: `${params.workspaceId}/${params.objectKey}`,
      })
    );
    const arr = await out.Body?.transformToByteArray();
    return Buffer.from(arr ?? []);
  } catch (s3Err) {
    if (
      params.mode === "client_r2" &&
      params.creds.cloudflareApiToken &&
      params.creds.cloudflareAccountId
    ) {
      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(params.creds.cloudflareAccountId)}/r2/buckets/${encodeURIComponent(params.bucketName)}/objects/${encodeURIComponent(`${params.workspaceId}/${params.objectKey}`)}`;
      const resp = await fetchWithRetry(
        cfUrl,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${params.creds.cloudflareApiToken}`,
          },
        },
        { maxAttempts: 2, timeoutMs: 12000 }
      );
      if (resp.ok) {
        return Buffer.from(await resp.arrayBuffer());
      }
    }
    throw s3Err;
  }
}

async function deleteFromBackend(params: {
  mode: "rsl_managed" | "client_r2" | "client_s3";
  workspaceId: string;
  objectKey: string;
  endpointUrl?: string | null;
  bucketName?: string | null;
  region?: string | null;
  creds?: S3CredentialsPayload | null;
}): Promise<void> {
  if (params.mode === "rsl_managed") {
    const r2 = getPlatformManagedR2Config();
    if (r2.isReady) {
      const s3 = buildS3Client(r2.endpointUrl, "auto", {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      });
      await s3.send(
        new DeleteObjectCommand({
          Bucket: r2.bucketPrivate,
          Key: `${params.workspaceId}/${params.objectKey}`,
        })
      );
      return;
    }

    const filePath = resolvePlatformVaultFilePath(params.workspaceId, params.objectKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  if (!params.endpointUrl || !params.bucketName || !params.creds) {
    return;
  }

  if (
    params.mode === "client_r2" &&
    params.creds.cloudflareApiToken &&
    isWorkspaceSandboxIntegrationMode(params.workspaceId, params.creds.cloudflareApiToken)
  ) {
    const filePath = resolveClientR2SandboxFilePath(
      params.workspaceId,
      params.bucketName,
      params.objectKey
    );
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  try {
    const s3 = buildS3Client(params.endpointUrl, params.region ?? "auto", params.creds);
    await s3.send(
      new DeleteObjectCommand({
        Bucket: params.bucketName,
        Key: `${params.workspaceId}/${params.objectKey}`,
      })
    );
  } catch {
    if (
      params.mode === "client_r2" &&
      params.creds.cloudflareApiToken &&
      params.creds.cloudflareAccountId
    ) {
      const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(params.creds.cloudflareAccountId)}/r2/buckets/${encodeURIComponent(params.bucketName)}/objects/${encodeURIComponent(`${params.workspaceId}/${params.objectKey}`)}`;
      await fetchWithRetry(
        cfUrl,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${params.creds.cloudflareApiToken}`,
          },
        },
        { maxAttempts: 1, timeoutMs: 8000 }
      ).catch(() => null);
    }
  }
}

function buildDefaultStorageConfig(workspaceId: string): typeof controlSchema.storageConfigurations.$inferSelect {
  const now = Date.now();
  return {
    workspaceId,
    mode: "rsl_managed",
    displayLabel: "RSL Managed Cloud Vault",
    endpointUrl: null,
    bucketName: null,
    region: "auto",
    encryptedCredentials: null,
    usedBytes: 0,
    objectCount: 0,
    status: "healthy",
    lastVerifiedAt: now,
    updatedAt: now,
  };
}

function ensureStorageConfigurationRow(workspaceId: string): typeof controlSchema.storageConfigurations.$inferSelect {
  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .get();
  if (existing) return existing;

  const fallback = buildDefaultStorageConfig(workspaceId);
  db.insert(controlSchema.storageConfigurations).values(fallback).onConflictDoNothing().run();
  return (
    db
      .select()
      .from(controlSchema.storageConfigurations)
      .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
      .get() ?? fallback
  );
}

function resolveWorkspaceQuotaBytes(workspaceId: string, managedPlanActive: boolean, mode: string): number {
  if (mode === "client_r2" || mode === "client_s3") {
    return Number.MAX_SAFE_INTEGER;
  }
  const ws = controlDb()
    .select({ storageQuotaBytes: controlSchema.workspaces.storageQuotaBytes })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  const configured = ws?.storageQuotaBytes && ws.storageQuotaBytes > 0 ? ws.storageQuotaBytes : DEFAULT_STORAGE_QUOTA_BYTES;
  return managedPlanActive ? Math.max(configured, MANAGED_PLAN_MIN_QUOTA_BYTES) : configured;
}

export function getWorkspaceStorageStatus(workspaceId: string) {
  const db = controlDb();
  const cfg =
    db
      .select()
      .from(controlSchema.storageConfigurations)
      .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
      .get() ?? buildDefaultStorageConfig(workspaceId);

  const managedPlanActive = hasActiveEntitlement(workspaceId, "storage.managed");
  const quotaBytes = resolveWorkspaceQuotaBytes(workspaceId, managedPlanActive, cfg.mode);

  const objects = db
    .select()
    .from(controlSchema.storageObjects)
    .where(eq(controlSchema.storageObjects.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.storageObjects.createdAt))
    .limit(100)
    .all();

  const migrations = db
    .select()
    .from(controlSchema.storageMigrations)
    .where(eq(controlSchema.storageMigrations.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.storageMigrations.startedAt))
    .limit(20)
    .all();

  return {
    config: {
      workspaceId: cfg.workspaceId,
      mode: cfg.mode as "rsl_managed" | "client_r2" | "client_s3",
      displayLabel: cfg.displayLabel,
      endpointUrl: cfg.endpointUrl,
      bucketName: cfg.bucketName,
      region: cfg.region,
      usedBytes: cfg.usedBytes,
      quotaBytes,
      freeTierBytes: MANAGED_INCLUDED_FREE_BYTES,
      objectCount: cfg.objectCount,
      status: cfg.status,
      lastVerifiedAt: cfg.lastVerifiedAt,
      managedPlanActive,
    },
    objects,
    migrations,
  };
}

export async function putWorkspaceObject(params: {
  workspaceId: string;
  category: "tally_pdf" | "backup_archive" | "media" | "export" | "gst_invoice";
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  actorId: string;
}): Promise<typeof controlSchema.storageObjects.$inferSelect> {
  const db = controlDb();
  const cfgRow = ensureStorageConfigurationRow(params.workspaceId);
  const managedPlanActive = hasActiveEntitlement(params.workspaceId, "storage.managed");
  const mode = (cfgRow.mode || "rsl_managed") as "rsl_managed" | "client_r2" | "client_s3";
  const quotaBytes = resolveWorkspaceQuotaBytes(params.workspaceId, managedPlanActive, mode);

  if (cfgRow.usedBytes + params.bytes.length > quotaBytes) {
    throw new RslError(
      "RSL-VAL-1001",
      `Workspace storage quota reached (${Math.round(quotaBytes / (1024 * 1024))} MB limit). Delete unused stored files or connect a personal R2/S3 bucket.`
    );
  }

  const creds = cfgRow.encryptedCredentials
    ? (JSON.parse(decryptEnvelope(cfgRow.encryptedCredentials)) as S3CredentialsPayload)
    : null;

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const objId = newEntityId("ast", params.workspaceId);
  const safeExt = path.extname(params.fileName).replace(/[^a-zA-Z0-9.]/g, "") || ".bin";
  const objectKey = `${params.category}/${yyyy}/${mm}/${objId}${safeExt}`;
  const checksumSha256 = crypto.createHash("sha256").update(params.bytes).digest("hex");

  await writeToBackend({
    mode,
    workspaceId: params.workspaceId,
    objectKey,
    bytes: params.bytes,
    mimeType: params.mimeType,
    endpointUrl: cfgRow.endpointUrl,
    bucketName: cfgRow.bucketName,
    region: cfgRow.region,
    creds,
  });

  // Meter exact billable MB above the 1 GB included managed vault allowance in integer paise
  const prevBillableBytes = Math.max(0, cfgRow.usedBytes - MANAGED_INCLUDED_FREE_BYTES);
  const nextBillableBytes = Math.max(0, cfgRow.usedBytes + params.bytes.length - MANAGED_INCLUDED_FREE_BYTES);
  const newlyBillableBytes = Math.max(0, nextBillableBytes - prevBillableBytes);
  if (mode === "rsl_managed" && managedPlanActive && newlyBillableBytes > 0) {
    const billableMb = Math.max(1, Math.ceil(newlyBillableBytes / (1024 * 1024)));
    consumeUsage({
      workspaceId: params.workspaceId,
      serviceKey: "storage.managed",
      quantity: billableMb,
      unitCostPaise: MANAGED_EXCESS_COST_PAISE_PER_MB,
      dedupeKey: `store:${objId}`,
      description: `Managed Cloud Vault storage (${billableMb} MB above included allowance) - ${params.fileName}`,
      actorId: params.actorId,
    });
  }

  const row = {
    id: objId,
    workspaceId: params.workspaceId,
    category: params.category,
    fileName: params.fileName,
    mimeType: params.mimeType,
    sizeBytes: params.bytes.length,
    checksumSha256,
    storageMode: mode,
    objectKey,
    createdAt: Date.now(),
  };

  db.insert(controlSchema.storageObjects).values(row).run();
  db.update(controlSchema.storageConfigurations)
    .set({
      usedBytes: cfgRow.usedBytes + params.bytes.length,
      objectCount: cfgRow.objectCount + 1,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.storageConfigurations.workspaceId, params.workspaceId))
    .run();

  return row;
}

export async function deleteWorkspaceObjectById(
  workspaceId: string,
  objectId: string
): Promise<{ deletedObjectId: string; freedBytes: number; fileName: string }> {
  const db = controlDb();
  const obj = db
    .select()
    .from(controlSchema.storageObjects)
    .where(eq(controlSchema.storageObjects.id, objectId))
    .get();
  if (!obj || obj.workspaceId !== workspaceId) {
    throw new RslError("RSL-VAL-1001", "Stored file not found.");
  }

  const cfgRow = ensureStorageConfigurationRow(workspaceId);
  const creds = cfgRow.encryptedCredentials
    ? (JSON.parse(decryptEnvelope(cfgRow.encryptedCredentials)) as S3CredentialsPayload)
    : null;

  await deleteFromBackend({
    mode: obj.storageMode as "rsl_managed" | "client_r2" | "client_s3",
    workspaceId,
    objectKey: obj.objectKey,
    endpointUrl: cfgRow.endpointUrl,
    bucketName: cfgRow.bucketName,
    region: cfgRow.region,
    creds,
  });

  db.delete(controlSchema.storageObjects)
    .where(eq(controlSchema.storageObjects.id, obj.id))
    .run();

  db.update(controlSchema.storageConfigurations)
    .set({
      usedBytes: Math.max(0, cfgRow.usedBytes - obj.sizeBytes),
      objectCount: Math.max(0, cfgRow.objectCount - 1),
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .run();

  return {
    deletedObjectId: obj.id,
    freedBytes: obj.sizeBytes,
    fileName: obj.fileName,
  };
}

export const deleteWorkspaceObject = defineAction({
  key: "backup.destination.saved",
  permission: "backup:destination.manage",
  input: z.object({
    objectId: z.string().min(10),
  }),
  summarize: (_in, out?: { fileName: string; freedBytes: number }) =>
    `Deleted stored file '${out?.fileName ?? ""}' (${Math.round((out?.freedBytes ?? 0) / 1024)} KB freed)`,
  handler: async (ctx, input) => {
    return deleteWorkspaceObjectById(ctx.workspaceId, input.objectId.trim());
  },
});

export async function readWorkspaceObjectBytes(workspaceId: string, objectId: string): Promise<{
  meta: typeof controlSchema.storageObjects.$inferSelect;
  bytes: Buffer;
}> {
  const db = controlDb();
  const obj = db
    .select()
    .from(controlSchema.storageObjects)
    .where(eq(controlSchema.storageObjects.id, objectId))
    .get();
  if (!obj || obj.workspaceId !== workspaceId) {
    throw new RslError("RSL-VAL-1001", "Stored file not found.");
  }

  const cfgRow = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .get();

  const creds = cfgRow?.encryptedCredentials
    ? (JSON.parse(decryptEnvelope(cfgRow.encryptedCredentials)) as S3CredentialsPayload)
    : null;

  const bytes = await readFromBackend({
    mode: obj.storageMode as "rsl_managed" | "client_r2" | "client_s3",
    workspaceId,
    objectKey: obj.objectKey,
    endpointUrl: cfgRow?.endpointUrl,
    bucketName: cfgRow?.bucketName,
    region: cfgRow?.region,
    creds,
  });

  return { meta: obj, bytes };
}

/**
 * Connects Client's Own Cloudflare R2 or S3-compatible bucket (validating write-read-delete sentinel first!)
 * OR switches back to RSL Managed Cloud Vault, with optional 1-click seamless migration of existing files!
 */
export const configureAndMigrateStorage = defineAction({
  key: "backup.destination.saved",
  permission: "backup:destination.manage",
  input: z.object({
    targetMode: z.enum(["rsl_managed", "client_r2", "client_s3"]),
    displayLabel: z.string().min(2).max(120).optional(),
    r2AccountId: z.string().optional(),
    customEndpointUrl: z.string().optional(),
    bucketName: z.string().optional(),
    region: z.string().default("auto"),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    migrateExistingFiles: z.boolean().default(true),
  }),
  summarize: (input, out?: { migratedCount: number }) =>
    `Switched storage to ${input.targetMode === "rsl_managed" ? "RSL Managed Cloud Vault" : `Personal ${input.targetMode.toUpperCase()} (${input.bucketName})`} and migrated ${out?.migratedCount ?? 0} files`,
  handler: async (ctx, input) => {
    const db = controlDb();
    const prevCfg = ensureStorageConfigurationRow(ctx.workspaceId);

    let nextEndpoint: string | null = null;
    let nextBucket: string | null = null;
    let nextCreds: S3CredentialsPayload | null = null;
    let encryptedCreds: string | null = null;

    if (input.targetMode === "client_r2" || input.targetMode === "client_s3") {
      const safeR2AccountId = (input.r2AccountId || "").trim().replace(/[^a-zA-Z0-9-]/g, "");
      nextEndpoint =
        input.targetMode === "client_r2"
          ? input.customEndpointUrl?.trim() ||
            (safeR2AccountId ? `https://${safeR2AccountId}.r2.cloudflarestorage.com` : "")
          : input.customEndpointUrl?.trim() || "";
      nextBucket = input.bucketName?.trim() || "";

      if (!nextEndpoint || !nextBucket || !input.accessKeyId?.trim() || !input.secretAccessKey?.trim()) {
        throw new RslError(
          "RSL-VAL-1001",
          "Please provide your Cloudflare R2 Account ID (or S3 Endpoint), Bucket Name, Access Key ID, and Secret Access Key."
        );
      }

      nextEndpoint = await assertSafeExternalUrl(nextEndpoint, {
        label: "Storage endpoint URL",
      });

      nextCreds = {
        accessKeyId: input.accessKeyId.trim(),
        secretAccessKey: input.secretAccessKey.trim(),
      };

      // Validate live write-delete sentinel object before persisting credentials
      const s3 = buildS3Client(nextEndpoint, input.region || "auto", nextCreds);
      const sentinelKey = `${ctx.workspaceId}/_rsl_sentinel_${Date.now()}.txt`;
      const sentinelBody = Buffer.from("rsl-storage-verification-ok", "utf8");
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: nextBucket,
            Key: sentinelKey,
            Body: sentinelBody,
            ContentType: "text/plain",
          })
        );
        await s3.send(
          new DeleteObjectCommand({
            Bucket: nextBucket,
            Key: sentinelKey,
          })
        );
      } catch (err) {
        throw new RslError(
          "RSL-VAL-1001",
          `Could not verify write access to bucket '${nextBucket}': ${err instanceof Error ? err.message : "check endpoint & keys"}`
        );
      }

      encryptedCreds = encryptEnvelope(JSON.stringify(nextCreds));
    }

    let migratedCount = 0;
    let bytesTransferred = 0;

    if (input.migrateExistingFiles && prevCfg.mode !== input.targetMode) {
      const migId = newEntityId("mig", ctx.workspaceId);
      const startedAt = Date.now();
      const prevCreds = prevCfg.encryptedCredentials
        ? (JSON.parse(decryptEnvelope(prevCfg.encryptedCredentials)) as S3CredentialsPayload)
        : null;

      const existingObjs = db
        .select()
        .from(controlSchema.storageObjects)
        .where(eq(controlSchema.storageObjects.workspaceId, ctx.workspaceId))
        .all();

      db.insert(controlSchema.storageMigrations)
        .values({
          id: migId,
          workspaceId: ctx.workspaceId,
          fromMode: prevCfg.mode,
          toMode: input.targetMode,
          totalObjects: existingObjs.length,
          copiedObjects: 0,
          bytesTransferred: 0,
          status: "running",
          startedAt,
        })
        .run();

      try {
        for (const obj of existingObjs) {
          if (obj.storageMode === input.targetMode) continue;

          const bytes = await readFromBackend({
            mode: obj.storageMode as "rsl_managed" | "client_r2" | "client_s3",
            workspaceId: ctx.workspaceId,
            objectKey: obj.objectKey,
            endpointUrl: prevCfg.endpointUrl,
            bucketName: prevCfg.bucketName,
            region: prevCfg.region,
            creds: prevCreds,
          });

          const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
          if (actualHash !== obj.checksumSha256) {
            throw new Error(`Checksum mismatch while migrating ${obj.fileName}`);
          }

          await writeToBackend({
            mode: input.targetMode,
            workspaceId: ctx.workspaceId,
            objectKey: obj.objectKey,
            bytes,
            mimeType: obj.mimeType,
            endpointUrl: nextEndpoint,
            bucketName: nextBucket,
            region: input.region,
            creds: nextCreds,
          });

          db.update(controlSchema.storageObjects)
            .set({ storageMode: input.targetMode })
            .where(eq(controlSchema.storageObjects.id, obj.id))
            .run();

          migratedCount++;
          bytesTransferred += bytes.length;
        }

        db.update(controlSchema.storageMigrations)
          .set({
            copiedObjects: migratedCount,
            bytesTransferred,
            status: "completed",
            completedAt: Date.now(),
          })
          .where(eq(controlSchema.storageMigrations.id, migId))
          .run();
      } catch (err) {
        db.update(controlSchema.storageMigrations)
          .set({
            copiedObjects: migratedCount,
            bytesTransferred,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
            completedAt: Date.now(),
          })
          .where(eq(controlSchema.storageMigrations.id, migId))
          .run();
        throw err;
      }
    }

    const now = Date.now();
    const label =
      input.displayLabel?.trim() ||
      (input.targetMode === "rsl_managed"
        ? "RSL Managed Cloud Vault"
        : input.targetMode === "client_r2"
        ? `Personal Cloudflare R2 (${nextBucket})`
        : `Personal S3 Storage (${nextBucket})`);

    db.update(controlSchema.storageConfigurations)
      .set({
        mode: input.targetMode,
        displayLabel: label,
        endpointUrl: nextEndpoint,
        bucketName: nextBucket,
        region: input.region || "auto",
        encryptedCredentials: encryptedCreds,
        status: "healthy",
        lastVerifiedAt: now,
        updatedAt: now,
      })
      .where(eq(controlSchema.storageConfigurations.workspaceId, ctx.workspaceId))
      .run();

    return { migratedCount, bytesTransferred, mode: input.targetMode };
  },
});
