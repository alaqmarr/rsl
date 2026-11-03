import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertValidUlid,
  decryptEnvelope,
  encryptEnvelope,
  getEnv,
  newEntityId,
  RslError,
  signHmac,
  verifyHmac,
} from "@rsl/core";
import {
  controlSchema,
  createSqliteClient,
  EXPECTED_TENANT_DATA_TABLES,
  runSqlMigrations,
  TENANT_DATA_MIGRATIONS,
  tenantDataSchema,
  tenantLogsSchema,
} from "@rsl/database";
import { defineAction } from "@rsl/logging";
import {
  closeTenantHandles,
  controlDb,
  refreshTenantDiskMetrics,
  resolveSafeTenantDir,
  tenantDataDb,
  tenantLogsDb,
} from "@rsl/tenancy";

export interface SignedBackupBundle {
  format: "rsl-backup-v1";
  manifest: {
    backupId: string;
    tenantId: string;
    dataSchemaVersion: number;
    appVersion: string;
    compression: "zstd" | "gzip";
    createdAt: number;
    rawSqliteSha256: string;
    ciphertextSha256: string;
    signingKeyVersion: number;
  };
  signatureHex: string;
  encryptedPayload: string;
}

function compressBytes(raw: Buffer): { compressed: Buffer; algo: "zstd" | "gzip" } {
  const anyZlib = zlib as unknown as {
    zstdCompressSync?: (buf: Buffer) => Buffer;
  };
  if (typeof anyZlib.zstdCompressSync === "function") {
    return { compressed: anyZlib.zstdCompressSync(raw), algo: "zstd" };
  }
  return { compressed: zlib.gzipSync(raw, { level: 6 }), algo: "gzip" };
}

function decompressBytes(buf: Buffer, algo: "zstd" | "gzip"): Buffer {
  const anyZlib = zlib as unknown as {
    zstdDecompressSync?: (input: Buffer) => Buffer;
  };
  if (algo === "zstd" && typeof anyZlib.zstdDecompressSync === "function") {
    return anyZlib.zstdDecompressSync(buf);
  }
  return zlib.gunzipSync(buf);
}

export function getWorkspaceDatabaseManagementInfo(workspaceId: string) {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const dataDb = tenantDataDb({ workspaceId: validId });
  const logsDb = tenantLogsDb({ workspaceId: validId });
  const ctrl = controlDb();

  const reg = ctrl
    .select()
    .from(controlSchema.tenantRegistry)
    .where(eq(controlSchema.tenantRegistry.tenantId, validId))
    .get();

  const walPath = reg ? `${reg.dataDbPath}-wal` : "";
  const dataSizeBytes = reg && fs.existsSync(reg.dataDbPath) ? fs.statSync(reg.dataDbPath).size : 0;
  const walSizeBytes = walPath && fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  const logsSizeBytes = reg && fs.existsSync(reg.logsDbPath) ? fs.statSync(reg.logsDbPath).size : 0;

  const count = (rawDb: typeof dataDb.$client, table: string): number => {
    const row = rawDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number } | undefined;
    return Number(row?.c ?? 0);
  };

  const quickCheckRow = dataDb.$client.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;

  const backupRuns = logsDb
    .select()
    .from(tenantLogsSchema.backupRuns)
    .orderBy(desc(tenantLogsSchema.backupRuns.createdAt))
    .limit(30)
    .all();

  const providerRequests = ctrl
    .select()
    .from(controlSchema.providerRequests)
    .where(eq(controlSchema.providerRequests.workspaceId, validId))
    .orderBy(desc(controlSchema.providerRequests.createdAt))
    .all();

  return {
    tenantId: validId,
    status: reg?.status ?? "active",
    dataSchemaVersion: reg?.dataSchemaVersion ?? 1,
    logsSchemaVersion: reg?.logsSchemaVersion ?? 1,
    lastBackupAt: reg?.lastBackupAt ?? null,
    integrityStatus: quickCheckRow?.quick_check === "ok" ? "Verified Healthy" : quickCheckRow?.quick_check ?? "Unknown",
    files: {
      dataSizeBytes,
      walSizeBytes,
      logsSizeBytes,
      totalBytes: dataSizeBytes + walSizeBytes + logsSizeBytes,
    },
    tableCounts: [
      { table: "contacts", label: "Customer Contacts", rows: count(dataDb.$client, "contacts"), restorable: true },
      { table: "conversations", label: "Message Threads", rows: count(dataDb.$client, "conversations"), restorable: true },
      { table: "messages", label: "Chat Messages", rows: count(dataDb.$client, "messages"), restorable: true },
      { table: "tally_companies", label: "Tally Companies", rows: count(dataDb.$client, "tally_companies"), restorable: true },
      { table: "tally_vouchers", label: "Tally Bills & Receipts", rows: count(dataDb.$client, "tally_vouchers"), restorable: true },
      { table: "tally_automation_rules", label: "Tally WhatsApp Automations", rows: count(dataDb.$client, "tally_automation_rules"), restorable: true },
      { table: "campaigns", label: "Ad Campaigns", rows: count(dataDb.$client, "campaigns"), restorable: true },
      { table: "scheduled_posts", label: "Scheduled Social Posts", rows: count(dataDb.$client, "scheduled_posts"), restorable: true },
      { table: "reviews", label: "Google Business Reviews", rows: count(dataDb.$client, "reviews"), restorable: true },
      { table: "whatsapp_templates", label: "WhatsApp Templates", rows: count(dataDb.$client, "whatsapp_templates"), restorable: true },
      { table: "broadcasts", label: "WhatsApp Broadcasts", rows: count(dataDb.$client, "broadcasts"), restorable: true },
      { table: "action_logs", label: "Activity History", rows: count(logsDb.$client, "action_logs"), restorable: false },
      { table: "suppressions", label: "Unsubscribed Numbers", rows: count(logsDb.$client, "suppressions"), restorable: false },
    ],
    backupRuns,
    providerRequests,
  };
}

export const optimizeTenantDatabase = defineAction({
  key: "workspace.updated",
  permission: "backup:manage",
  input: z.object({}),
  summarize: () => "Optimized workspace storage and verified record integrity",
  handler: (ctx) => {
    const dataDb = tenantDataDb(ctx);
    const logsDb = tenantLogsDb(ctx);

    dataDb.$client.pragma("wal_checkpoint(TRUNCATE)");
    dataDb.$client.pragma("optimize");
    logsDb.$client.pragma("wal_checkpoint(TRUNCATE)");
    logsDb.$client.pragma("optimize");

    const check = dataDb.$client.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    const sizes = refreshTenantDiskMetrics(ctx.workspaceId);

    return {
      integrity: check.integrity_check,
      dataSizeBytes: sizes.dataSizeBytes,
      logsSizeBytes: sizes.logsSizeBytes,
    };
  },
});

export const createSignedEncryptedBackup = defineAction({
  key: "backup.created",
  permission: "backup:manage",
  input: z.object({
    destinationLabel: z.string().default("Primary Backup Vault"),
  }),
  summarize: (_in, out?: { backupId: string; sizeBytes: number }) =>
    `Created signed encrypted backup ${out?.backupId ?? ""} (${Math.round((out?.sizeBytes ?? 0) / 1024)} KB)`,
  handler: async (ctx, input) => {
    const started = Date.now();
    const env = getEnv();
    const backupId = newEntityId("bkp", ctx.workspaceId);
    const stagingDir = path.join(env.BACKUP_STAGING_DIR, ctx.workspaceId);
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

    const stagedSnapshotPath = path.join(stagingDir, `${backupId}_snapshot.db`);
    const dataDb = tenantDataDb(ctx);

    // Online SQLite Backup API (non-blocking, consistent snapshot)
    await dataDb.$client.backup(stagedSnapshotPath);

    try {
      const verifyClient = createSqliteClient(stagedSnapshotPath, { readonly: true });
      verifyClient.pragma("trusted_schema = OFF");
      const qc = verifyClient.prepare("PRAGMA quick_check").get() as { quick_check: string };
      verifyClient.close();
      if (qc.quick_check !== "ok") {
        throw new Error(`Snapshot quick_check failed: ${qc.quick_check}`);
      }

      const rawSqliteBytes = fs.readFileSync(stagedSnapshotPath);
      const rawSqliteSha256 = crypto.createHash("sha256").update(rawSqliteBytes).digest("hex");
      const { compressed, algo } = compressBytes(rawSqliteBytes);
      const encryptedPayload = encryptEnvelope(compressed.toString("base64"));
      const ciphertextSha256 = crypto.createHash("sha256").update(encryptedPayload).digest("hex");

      const verRow = dataDb.$client.prepare("SELECT MAX(version) AS v FROM schema_meta").get() as { v: number | null } | undefined;
      const manifest: SignedBackupBundle["manifest"] = {
        backupId,
        tenantId: ctx.workspaceId,
        dataSchemaVersion: verRow?.v ?? 2,
        appVersion: "1.0.0",
        compression: algo,
        createdAt: Date.now(),
        rawSqliteSha256,
        ciphertextSha256,
        signingKeyVersion: env.BACKUP_SIGNING_KEY_VERSION,
      };

      const signatureHex = signHmac(JSON.stringify(manifest), env.BACKUP_SIGNING_KEY);
      const bundle: SignedBackupBundle = {
        format: "rsl-backup-v1",
        manifest,
        signatureHex,
        encryptedPayload,
      };

      const serializedBundle = Buffer.from(JSON.stringify(bundle), "utf8");
      const tenantBackupsDir = path.join(resolveSafeTenantDir(ctx.workspaceId), "backups");
      fs.mkdirSync(tenantBackupsDir, { recursive: true, mode: 0o700 });
      const artifactPath = path.join(tenantBackupsDir, `${backupId}.rslbackup`);
      fs.writeFileSync(artifactPath, serializedBundle, { mode: 0o600 });

      const now = Date.now();
      tenantLogsDb(ctx)
        .insert(tenantLogsSchema.backupRuns)
        .values({
          id: backupId,
          destinationName: input.destinationLabel,
          kind: "backup",
          status: "completed",
          sizeBytes: serializedBundle.length,
          durationMs: now - started,
          checksumSha256: ciphertextSha256,
          artifactPath,
          createdAt: now,
        })
        .run();

      controlDb()
        .update(controlSchema.tenantRegistry)
        .set({ lastBackupAt: now, updatedAt: now })
        .where(eq(controlSchema.tenantRegistry.tenantId, ctx.workspaceId))
        .run();

      return {
        backupId,
        sizeBytes: serializedBundle.length,
        checksumSha256: ciphertextSha256,
        artifactPath,
        bundleBufferBase64: serializedBundle.toString("base64"),
      };
    } finally {
      if (fs.existsSync(stagedSnapshotPath)) {
        fs.unlinkSync(stagedSnapshotPath);
      }
    }
  },
});

export function readLocalBackupBundleBytes(workspaceId: string, backupId: string): Buffer {
  const validId = assertValidUlid(workspaceId, "workspaceId");
  const validBkp = assertValidUlid(backupId, "backupId");
  const filePath = path.join(resolveSafeTenantDir(validId), "backups", `${validBkp}.rslbackup`);
  if (!fs.existsSync(filePath)) {
    throw new RslError("RSL-VAL-1001", "Backup archive not found on disk.");
  }
  return fs.readFileSync(filePath);
}

/**
 * Strict Verified Restore Pipeline (Section 22.6):
 * 1. Verifies HMAC manifest signature & ciphertext digest (`RSL-BACKUP-1001` on tamper)
 * 2. Decrypts & opens with `trusted_schema = OFF`
 * 3. Rejects unexpected tables, views, or triggers (`RSL-BACKUP-1002`)
 * 4. Runs `PRAGMA integrity_check`
 * 5. Takes 7-day pre-restore snapshot, swaps `data.db` atomically while leaving
 *    `control.db` (Wallet, Entitlements) and `logs/current.db` (Unsubscribed numbers, SendGuards) untouched!
 */
export const restoreSignedEncryptedBackup = defineAction({
  key: "backup.restored",
  permission: "backup:restore",
  input: z.object({
    bundleJsonText: z.string().min(20),
    confirmPhrase: z.literal("RESTORE"),
  }),
  summarize: (_in, out?: { restoredBackupId: string }) => `Restored business data from verified backup ${out?.restoredBackupId ?? ""}`,
  handler: async (ctx, input) => {
    const started = Date.now();
    const env = getEnv();

    let bundle: SignedBackupBundle;
    try {
      bundle = JSON.parse(input.bundleJsonText) as SignedBackupBundle;
    } catch {
      throw new RslError("RSL-BACKUP-1001");
    }

    if (
      bundle.format !== "rsl-backup-v1" ||
      !bundle.manifest ||
      !bundle.signatureHex ||
      !bundle.encryptedPayload
    ) {
      throw new RslError("RSL-BACKUP-1001");
    }

    const validSig = verifyHmac(
      JSON.stringify(bundle.manifest),
      bundle.signatureHex,
      env.BACKUP_SIGNING_KEY
    );
    if (!validSig) {
      throw new RslError("RSL-BACKUP-1001");
    }

    const actualCipherSha = crypto.createHash("sha256").update(bundle.encryptedPayload).digest("hex");
    if (actualCipherSha !== bundle.manifest.ciphertextSha256) {
      throw new RslError("RSL-BACKUP-1001", "Backup file verification failed — the file may be incomplete or altered.");
    }

    const compressedB64 = decryptEnvelope(bundle.encryptedPayload);
    const sqliteBytes = decompressBytes(Buffer.from(compressedB64, "base64"), bundle.manifest.compression);
    const actualRawSha = crypto.createHash("sha256").update(sqliteBytes).digest("hex");
    if (actualRawSha !== bundle.manifest.rawSqliteSha256) {
      throw new RslError("RSL-BACKUP-1001", "Restored backup data verification failed.");
    }

    const stagingDir = path.join(env.BACKUP_STAGING_DIR, ctx.workspaceId);
    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const stagedDbPath = path.join(stagingDir, `restore_${Date.now()}.db`);
    fs.writeFileSync(stagedDbPath, sqliteBytes, { mode: 0o600 });

    try {
      // Security inspection with trusted_schema = OFF
      const stagedClient = createSqliteClient(stagedDbPath);
      stagedClient.pragma("trusted_schema = OFF");

      const masterRows = stagedClient
        .prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .all() as Array<{ type: string; name: string }>;

      for (const item of masterRows) {
        if (item.type === "trigger" || item.type === "view") {
          stagedClient.close();
          throw new RslError(
            "RSL-BACKUP-1002",
            `Backup rejected: unexpected structure '${item.name}' detected in archive.`
          );
        }
        if (item.type === "table" && !EXPECTED_TENANT_DATA_TABLES.has(item.name)) {
          stagedClient.close();
          throw new RslError(
            "RSL-BACKUP-1002",
            `Backup rejected: unexpected record group '${item.name}' detected.`
          );
        }
      }

      const ic = stagedClient.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (ic.integrity_check !== "ok") {
        stagedClient.close();
        throw new RslError("RSL-BACKUP-1002", "Backup archive failed safety check before restore.");
      }

      runSqlMigrations(stagedClient, TENANT_DATA_MIGRATIONS);

      // Pause any automated broadcasts on restore per Section 22.6 step 9
      stagedClient.prepare("UPDATE broadcasts SET status = 'paused' WHERE status = 'sending'").run();
      stagedClient.close();

      const ctrl = controlDb();
      const reg = ctrl
        .select()
        .from(controlSchema.tenantRegistry)
        .where(eq(controlSchema.tenantRegistry.tenantId, ctx.workspaceId))
        .get();
      if (!reg) throw new Error("Tenant registry entry missing");

      // Gate status to restoring
      ctrl
        .update(controlSchema.tenantRegistry)
        .set({ status: "restoring", updatedAt: Date.now() })
        .where(eq(controlSchema.tenantRegistry.tenantId, ctx.workspaceId))
        .run();

      try {
        closeTenantHandles(ctx.workspaceId);

        // Save 7-day pre-restore safety snapshot
        const preRestorePath = path.join(
          resolveSafeTenantDir(ctx.workspaceId),
          "backups",
          `pre_restore_${Date.now()}.db`
        );
        fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(preRestorePath), {
          recursive: true,
          mode: 0o700,
        });
        const hadExistingDb = fs.existsSync(/*turbopackIgnore: true*/ reg.dataDbPath);
        if (hadExistingDb) {
          fs.copyFileSync(
            /*turbopackIgnore: true*/ reg.dataDbPath,
            /*turbopackIgnore: true*/ preRestorePath
          );
        }

        // Stage candidate replacement adjacent to target DB for atomic swap with automatic rollback
        const atomicCandidatePath = `${reg.dataDbPath}.restoring.tmp`;
        fs.copyFileSync(
          /*turbopackIgnore: true*/ stagedDbPath,
          /*turbopackIgnore: true*/ atomicCandidatePath
        );

        try {
          // Remove stale WAL/SHM files before atomic rename swap
          for (const ext of ["-wal", "-shm"]) {
            const walFile = `${reg.dataDbPath}${ext}`;
            if (fs.existsSync(/*turbopackIgnore: true*/ walFile)) {
              fs.unlinkSync(/*turbopackIgnore: true*/ walFile);
            }
          }

          fs.renameSync(
            /*turbopackIgnore: true*/ atomicCandidatePath,
            /*turbopackIgnore: true*/ reg.dataDbPath
          );
        } catch (swapError) {
          if (fs.existsSync(/*turbopackIgnore: true*/ atomicCandidatePath)) {
            try {
              fs.unlinkSync(/*turbopackIgnore: true*/ atomicCandidatePath);
            } catch {
              // Ignore temp cleanup failure
            }
          }
          if (hadExistingDb && fs.existsSync(/*turbopackIgnore: true*/ preRestorePath)) {
            fs.copyFileSync(
              /*turbopackIgnore: true*/ preRestorePath,
              /*turbopackIgnore: true*/ reg.dataDbPath
            );
          }
          throw swapError;
        }
      } finally {
        ctrl
          .update(controlSchema.tenantRegistry)
          .set({ status: "active", updatedAt: Date.now() })
          .where(eq(controlSchema.tenantRegistry.tenantId, ctx.workspaceId))
          .run();
      }

      refreshTenantDiskMetrics(ctx.workspaceId);

      tenantLogsDb(ctx)
        .insert(tenantLogsSchema.backupRuns)
        .values({
          id: newEntityId("bkp", ctx.workspaceId),
          destinationName: "Verified Restore",
          kind: "restore",
          status: "completed",
          sizeBytes: sqliteBytes.length,
          durationMs: Date.now() - started,
          checksumSha256: actualRawSha,
          createdAt: Date.now(),
        })
        .run();

      return { restoredBackupId: bundle.manifest.backupId };
    } finally {
      if (fs.existsSync(/*turbopackIgnore: true*/ stagedDbPath)) {
        fs.unlinkSync(/*turbopackIgnore: true*/ stagedDbPath);
      }
    }
  },
});

export function exportPortableWorkspaceJson(workspaceId: string): string {
  const db = tenantDataDb({ workspaceId });
  const payload = {
    exportedAt: new Date().toISOString(),
    workspaceId,
    contacts: db.select().from(tenantDataSchema.contacts).all(),
    conversations: db.select().from(tenantDataSchema.conversations).all(),
    messages: db.select().from(tenantDataSchema.messages).all(),
    tallyCompanies: db.select().from(tenantDataSchema.tallyCompanies).all(),
    tallyVouchers: db.select().from(tenantDataSchema.tallyVouchers).all(),
    campaigns: db.select().from(tenantDataSchema.campaigns).all(),
    insightSnapshots: db.select().from(tenantDataSchema.insightSnapshots).all(),
    scheduledPosts: db.select().from(tenantDataSchema.scheduledPosts).all(),
    reviews: db.select().from(tenantDataSchema.reviews).all(),
    whatsappTemplates: db.select().from(tenantDataSchema.whatsappTemplates).all(),
    broadcasts: db.select().from(tenantDataSchema.broadcasts).all(),
  };
  return JSON.stringify(payload, null, 2);
}

export function exportContactsAsCsv(workspaceId: string): string {
  const rows = tenantDataDb({ workspaceId }).select().from(tenantDataSchema.contacts).all();
  const header = "Id,Name,PhoneE164,Email,CompanyName,CreatedAt";
  const lines = rows.map((r) => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      q(r.id),
      q(r.name),
      q(r.phoneE164 ?? ""),
      q(r.email ?? ""),
      q(r.companyName ?? ""),
      new Date(r.createdAt).toISOString(),
    ].join(",");
  });
  return [header, ...lines].join("\n");
}

export const bulkImportContactsCsv = defineAction({
  key: "inbox.contact.created",
  permission: "inbox:reply",
  input: z.object({
    csvContent: z.string().min(5),
    recordWhatsAppConsent: z.boolean().default(false),
  }),
  summarize: (_in, out?: { importedCount: number }) => `Imported ${out?.importedCount ?? 0} contacts from CSV`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const lines = input.csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      throw new RslError("RSL-VAL-1001", "CSV must include a header row and at least one contact.");
    }

    const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
    const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

    const iName = idx(["name", "customer", "contact"]);
    const iPhone = idx(["phone", "mobile", "whatsapp"]);
    const iEmail = idx(["email"]);
    const iCompany = idx(["company", "business", "firm"]);

    const now = Date.now();
    let importedCount = 0;

    const tx = db.$client.transaction(() => {
      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r]!
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());
        const name = (iName >= 0 ? cols[iName] : cols[0])?.trim();
        if (!name) continue;

        const phone = (iPhone >= 0 ? cols[iPhone] : undefined)?.trim() || null;
        const email = (iEmail >= 0 ? cols[iEmail] : undefined)?.trim() || null;
        const company = (iCompany >= 0 ? cols[iCompany] : undefined)?.trim() || null;
        const cid = newEntityId("cnt", ctx.workspaceId);

        db.insert(tenantDataSchema.contacts)
          .values({
            id: cid,
            name,
            phoneE164: phone,
            email,
            companyName: company,
            tagsJson: "[]",
            lifetimeValuePaise: 0,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        if (input.recordWhatsAppConsent && phone) {
          db.insert(tenantDataSchema.optIns)
            .values({
              id: newEntityId("opt", ctx.workspaceId),
              contactId: cid,
              phoneE164: phone,
              channel: "whatsapp",
              source: "csv_import",
              evidenceNote: "Imported with explicit consent checkbox confirmed",
              consentedAt: now,
            })
            .onConflictDoNothing()
            .run();
        }
        importedCount++;
      }
    });

    tx.immediate();
    return { importedCount };
  },
});

export const requestCustomBackupProvider = defineAction({
  key: "backup.destination.saved",
  permission: "backup:destination.manage",
  input: z.object({
    providerName: z.string().min(2).max(120),
    providerUrl: z.string().optional(),
    urgency: z.enum(["normal", "high", "urgent"]).default("normal"),
    contactEmail: z.string().email(),
  }),
  summarize: (input) => `Requested custom backup adapter for '${input.providerName}'`,
  handler: (ctx, input) => {
    const id = newEntityId("dst", ctx.workspaceId);
    controlDb()
      .insert(controlSchema.providerRequests)
      .values({
        id,
        workspaceId: ctx.workspaceId,
        providerName: input.providerName.trim(),
        providerUrl: input.providerUrl?.trim() || null,
        urgency: input.urgency,
        contactEmail: input.contactEmail.trim(),
        status: "submitted",
        createdAt: Date.now(),
      })
      .run();
    return { requestId: id };
  },
});
