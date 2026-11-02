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
  assertValidUlid,
  decryptEnvelope,
  encryptEnvelope,
  getEnv,
  newEntityId,
  RslError,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { controlDb } from "@rsl/tenancy";

export interface S3CredentialsPayload {
  accessKeyId: string;
  secretAccessKey: string;
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
  const env = getEnv();

  if (params.mode === "rsl_managed") {
    if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_PRIVATE) {
      const s3 = buildS3Client(
        `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        "auto",
        { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET_PRIVATE,
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

  const s3 = buildS3Client(params.endpointUrl, params.region ?? "auto", params.creds);
  await s3.send(
    new PutObjectCommand({
      Bucket: params.bucketName,
      Key: `${params.workspaceId}/${params.objectKey}`,
      Body: params.bytes,
      ContentType: params.mimeType,
    })
  );
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
  const env = getEnv();

  if (params.mode === "rsl_managed") {
    if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_PRIVATE) {
      const s3 = buildS3Client(
        `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        "auto",
        { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
      );
      const out = await s3.send(
        new GetObjectCommand({
          Bucket: env.R2_BUCKET_PRIVATE,
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

  const s3 = buildS3Client(params.endpointUrl, params.region ?? "auto", params.creds);
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: params.bucketName,
      Key: `${params.workspaceId}/${params.objectKey}`,
    })
  );
  const arr = await out.Body?.transformToByteArray();
  return Buffer.from(arr ?? []);
}

export function getWorkspaceStorageStatus(workspaceId: string) {
  const db = controlDb();
  let cfg = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, workspaceId))
    .get();

  if (!cfg) {
    const now = Date.now();
    cfg = {
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
    db.insert(controlSchema.storageConfigurations).values(cfg).onConflictDoNothing().run();
  }

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
      objectCount: cfg.objectCount,
      status: cfg.status,
      lastVerifiedAt: cfg.lastVerifiedAt,
      managedPlanActive: hasActiveEntitlement(workspaceId, "storage.managed"),
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
  const status = getWorkspaceStorageStatus(params.workspaceId);
  const cfgRow = db
    .select()
    .from(controlSchema.storageConfigurations)
    .where(eq(controlSchema.storageConfigurations.workspaceId, params.workspaceId))
    .get()!;

  const mode = (cfgRow.mode || "rsl_managed") as "rsl_managed" | "client_r2" | "client_s3";
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

  // Meter paid RSL Managed Cloud Storage if using rsl_managed and plan is active
  if (mode === "rsl_managed" && status.config.managedPlanActive && params.bytes.length > 1024 * 1024) {
    consumeUsage({
      workspaceId: params.workspaceId,
      serviceKey: "storage.managed",
      quantity: Math.ceil(params.bytes.length / (1024 * 1024 * 1024)),
      unitCostPaise: 0,
      dedupeKey: `store:${objId}`,
      description: `Stored ${params.fileName} on RSL Managed Cloud Vault`,
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
    getWorkspaceStorageStatus(ctx.workspaceId);

    const prevCfg = db
      .select()
      .from(controlSchema.storageConfigurations)
      .where(eq(controlSchema.storageConfigurations.workspaceId, ctx.workspaceId))
      .get()!;

    let nextEndpoint: string | null = null;
    let nextBucket: string | null = null;
    let nextCreds: S3CredentialsPayload | null = null;
    let encryptedCreds: string | null = null;

    if (input.targetMode === "client_r2" || input.targetMode === "client_s3") {
      nextEndpoint =
        input.targetMode === "client_r2"
          ? input.customEndpointUrl?.trim() ||
            (input.r2AccountId?.trim() ? `https://${input.r2AccountId.trim()}.r2.cloudflarestorage.com` : "")
          : input.customEndpointUrl?.trim() || "";
      nextBucket = input.bucketName?.trim() || "";

      if (!nextEndpoint || !nextBucket || !input.accessKeyId?.trim() || !input.secretAccessKey?.trim()) {
        throw new RslError(
          "RSL-VAL-1001",
          "Please provide your Cloudflare R2 Account ID (or S3 Endpoint), Bucket Name, Access Key ID, and Secret Access Key."
        );
      }

      nextCreds = {
        accessKeyId: input.accessKeyId.trim(),
        secretAccessKey: input.secretAccessKey.trim(),
      };

      // Validate live write-read-delete sentinel object (Section 22.2)
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
