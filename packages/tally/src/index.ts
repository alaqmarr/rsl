import crypto from "node:crypto";
import http from "node:http";
import zlib from "node:zlib";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchWorkspaceWebhookEvent } from "@rsl/api-keys";
import { canDebitWalletUsage, getWalletBalancePaise } from "@rsl/billing";
import { executeWhatsAppTemplateSend } from "@rsl/whatsapp";
import {
  decryptEnvelope,
  encryptEnvelope,
  formatInr,
  getEnv,
  newEntityId,
  newId,
  resolvePublicEndpoints,
  RslError,
  rupeesToPaise,
  signHmac,
  verifyHmac,
  type ActorType,
} from "@rsl/core";
import { controlSchema, tenantDataSchema, tenantLogsSchema } from "@rsl/database";
import { appendActionLog, defineAction } from "@rsl/logging";
import {
  enqueueJob,
  isRedisConfigured,
  markSendGuardOutcome,
  processDueSqliteOutboxForTenant,
  registerJobProcessor,
  reserveSendGuard,
} from "@rsl/queue";
import { controlDb, tenantDataDb, tenantLogsDb } from "@rsl/tenancy";
import {
  collectVoucherStockItemIdsBeforeDelete,
  extractInventoryLineItemsFromVoucherXml,
  ingestTallyMastersJsonForWorkspace,
  ingestTallyMastersXmlForWorkspace,
  listVoucherLineItemsMap,
  parseJsonVoucherLineItems,
  parseTallyOpenCompaniesInput,
  recalculateCompanyInventoryMovements,
  syncLocalTallyInventoryMastersFromPort9000,
  syncVoucherInventoryLineItems,
  toTallyJsonObjectArray,
  unwrapTallyMultiPartJson,
  type ParsedTallyVoucherLineItem,
} from "./inventory";
import {
  extractBillAllocationsFromVoucherXml,
  isCashOrBankPartyName,
  normalizeBillAllocationType,
  parseBillAllocationsJson,
  reconcileCompanyBillSettlementsAndPartyBalances,
  serializeBillAllocationsJson,
  type ParsedTallyBillAllocation,
  type TallySuiteVoucherType,
} from "./ledgers";

export * from "./inventory";
export * from "./ledgers";

export const AGENT_HEARTBEAT_STALE_MS = 120_000;
export const LATEST_TALLY_TDL_VERSION = "2.9";
const TALLY_COMPANY_ROUTING_SETTING_KEY = "tally.company_routing";
const TALLY_BATCH_PREFIX = "tally.sync_batch.";
const PENDING_PDF_ID_PREFIX = "pending_pdf:";

function toCleanBusinessSlug(workspaceName: string, maxLen = 40): string {
  const cleaned = (workspaceName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return cleaned || "business";
}

/**
 * Builds a personalized business-named Tally Prime `.tdl` filename
 * (e.g. `"Sharma Traders"` -> `"sharma-traders-rsl-sync.tdl"`).
 */
export function buildWorkspaceTdlFilename(
  workspaceName: string,
  opts?: { isolatedSlug?: string }
): string {
  const bizSlug = toCleanBusinessSlug(workspaceName, 38);
  const isoSlug = opts?.isolatedSlug
    ? toCleanBusinessSlug(opts.isolatedSlug, 16)
    : "";
  if (isoSlug && isoSlug !== bizSlug) {
    return `${bizSlug}-${isoSlug}-rsl-sync.tdl`;
  }
  return `${bizSlug}-rsl-sync.tdl`;
}

/**
 * Builds a personalized Windows 1-Click Installer `.bat` filename
 * (e.g. `"Sharma Traders"` -> `"Install-Sharma-Traders-RSL-Sync.bat"`).
 */
export function buildWindowsInstallerFilename(workspaceName: string): string {
  const words = (workspaceName || "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const titleSlug = words.length > 0 ? words.join("-") : "Business";
  return `Install-${titleSlug}-RSL-Sync.bat`;
}

/**
 * Builds the sanitized in-Tally display brand title (`"<Business Name> & RSL Sync"`),
 * guaranteed free of colons, quotes, brackets, or newlines so it is 100% safe inside
 * Tally Prime Gateway Menu items, `Start Progress` headers, and `Msg Box` titles.
 */
export function buildTallyDisplayBrandTitle(
  workspaceName: string,
  opts?: { maxBusinessChars?: number }
): string {
  const maxChars = opts?.maxBusinessChars ?? 26;
  let cleanBiz = (workspaceName || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[:"'[\]\\`\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  cleanBiz = cleanBiz.replace(/\s*&\s*rsl\s*sync$/i, "").trim();
  if (!cleanBiz) {
    cleanBiz = "Business";
  }
  if (cleanBiz.length > maxChars) {
    cleanBiz = cleanBiz.slice(0, maxChars).trim();
  }
  return `${cleanBiz} & RSL Sync`;
}

// =========================================================================
// Exact Native Tally-Printed PDF Storage & Signed URL Engine
// Stores Tally Prime's exact printed PDF bytes (%PDF-1.x) untouched without
// modifying or redesigning the client's invoice format.
// =========================================================================

function ensureTallyVoucherPdfsTable(workspaceId: string): void {
  // Managed via versioned TENANT_DATA_MIGRATIONS (0003_tally_pdfs_masterid_currency_and_outbox_lock)
  tenantDataDb({ workspaceId });
}

export interface TallyVoucherPdfMeta {
  voucherId: string;
  voucherGuid: string;
  voucherNumber: string;
  companyName: string;
  filename: string;
  byteSize: number;
  sha256: string;
  alterId: number;
  masterId: string | null;
  capturedFrom: string;
  updatedAt: number;
}

export interface TallyVoucherPdfDocument extends TallyVoucherPdfMeta {
  pdfBuffer: Buffer;
}

function sanitizePdfFilename(voucherNumber: string, voucherType = "Invoice"): string {
  const cleanNo = (voucherNumber || "Bill")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const prefix = /receipt/i.test(voucherType)
    ? "Receipt"
    : /credit/i.test(voucherType)
      ? "CreditNote"
      : "Invoice";
  return `${prefix}-${cleanNo || "Tally"}.pdf`;
}

export function saveNativeTallyVoucherPdf(params: {
  workspaceId: string;
  voucherId?: string;
  voucherGuid?: string;
  voucherNumber?: string;
  voucherType?: string;
  companyName?: string;
  alterId?: number;
  masterId?: string | null;
  pdfBuffer: Buffer;
  capturedFrom?: string;
}): TallyVoucherPdfMeta {
  if (
    !Buffer.isBuffer(params.pdfBuffer) ||
    params.pdfBuffer.length < 16 ||
    params.pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new RslError(
      "RSL-VAL-1001",
      "Uploaded file is not a valid native Tally Prime PDF (%PDF- header missing)."
    );
  }

  ensureTallyVoucherPdfsTable(params.workspaceId);
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const raw = db.$client;

  let matchedVoucher: typeof tenantDataSchema.tallyVouchers.$inferSelect | undefined;
  if (params.voucherId && !params.voucherId.startsWith(PENDING_PDF_ID_PREFIX)) {
    matchedVoucher = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, params.voucherId))
      .get();
  }

  const cleanGuid = params.voucherGuid?.trim() ?? "";
  const compName = (params.companyName || "Primary Tally Company").trim();
  const compGuid = `comp_${compName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

  if (!matchedVoucher && cleanGuid) {
    matchedVoucher =
      db
        .select()
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.guid, `${compGuid}::${cleanGuid}`))
        .get() ??
      db
        .select()
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.guid, cleanGuid))
        .get();
  }

  if (!matchedVoucher && params.voucherNumber?.trim()) {
    const candidates = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.voucherNumber, params.voucherNumber.trim()))
      .all();
    matchedVoucher = candidates[0];
  }

  const effectiveVoucherId =
    matchedVoucher?.id ??
    params.voucherId?.trim() ??
    `${PENDING_PDF_ID_PREFIX}${cleanGuid || params.voucherNumber?.trim() || newId()}`;
  const effectiveGuid = matchedVoucher?.guid ?? (cleanGuid || effectiveVoucherId);
  const effectiveNumber = matchedVoucher?.voucherNumber ?? (params.voucherNumber?.trim() || "Bill");
  const effectiveType = matchedVoucher?.voucherType ?? params.voucherType ?? "Sales";
  const filename = sanitizePdfFilename(effectiveNumber, effectiveType);
  const sha256 = crypto.createHash("sha256").update(params.pdfBuffer).digest("hex");
  const pdfBase64 = params.pdfBuffer.toString("base64");
  const byteSize = params.pdfBuffer.byteLength;
  const alterId = Math.max(0, Math.trunc(params.alterId ?? matchedVoucher?.alterId ?? 0));
  const capturedFrom = (params.capturedFrom || "tally_native").slice(0, 60);
  const now = Date.now();

  if (matchedVoucher && cleanGuid) {
    // Clean up any pre-staged pending row for this GUID before saving canonical voucher_id
    raw
      .prepare(`DELETE FROM tally_voucher_pdfs WHERE voucher_id = ? OR voucher_id = ?`)
      .run(`${PENDING_PDF_ID_PREFIX}${cleanGuid}`, `${PENDING_PDF_ID_PREFIX}${matchedVoucher.guid}`);
  }

  raw
    .prepare(
      `INSERT INTO tally_voucher_pdfs (
        voucher_id, voucher_guid, voucher_number, company_name, filename,
        pdf_base64, byte_size, sha256, alter_id, master_id, captured_from, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(voucher_id) DO UPDATE SET
        voucher_guid = excluded.voucher_guid,
        voucher_number = excluded.voucher_number,
        company_name = excluded.company_name,
        filename = excluded.filename,
        pdf_base64 = excluded.pdf_base64,
        byte_size = excluded.byte_size,
        sha256 = excluded.sha256,
        alter_id = excluded.alter_id,
        master_id = COALESCE(excluded.master_id, tally_voucher_pdfs.master_id),
        captured_from = excluded.captured_from,
        updated_at = excluded.updated_at`
    )
    .run(
      effectiveVoucherId,
      effectiveGuid,
      effectiveNumber,
      compName,
      filename,
      pdfBase64,
      byteSize,
      sha256,
      alterId,
      params.masterId ?? null,
      capturedFrom,
      now
    );

  return {
    voucherId: effectiveVoucherId,
    voucherGuid: effectiveGuid,
    voucherNumber: effectiveNumber,
    companyName: compName,
    filename,
    byteSize,
    sha256,
    alterId,
    masterId: params.masterId ?? null,
    capturedFrom,
    updatedAt: now,
  };
}

function linkPendingTallyPdfToSavedVoucher(
  workspaceId: string,
  voucher: { id: string; guid: string; voucherNumber: string; voucherType: string; alterId: number },
  rawGuid?: string
): void {
  ensureTallyVoucherPdfsTable(workspaceId);
  const raw = tenantDataDb({ workspaceId }).$client;
  const candidateIds = Array.from(
    new Set(
      [
        rawGuid ? `${PENDING_PDF_ID_PREFIX}${rawGuid}` : "",
        `${PENDING_PDF_ID_PREFIX}${voucher.guid}`,
        `${PENDING_PDF_ID_PREFIX}${voucher.voucherNumber}`,
      ].filter(Boolean)
    )
  );
  if (candidateIds.length === 0) return;

  for (const pendingId of candidateIds) {
    const pendingRow = raw
      .prepare(`SELECT * FROM tally_voucher_pdfs WHERE voucher_id = ? LIMIT 1`)
      .get(pendingId) as
      | {
          pdf_base64: string;
          company_name: string;
          byte_size: number;
          sha256: string;
          master_id: string | null;
          captured_from: string;
        }
      | undefined;
    if (!pendingRow) continue;

    const now = Date.now();
    const filename = sanitizePdfFilename(voucher.voucherNumber, voucher.voucherType);
    raw
      .prepare(
        `INSERT INTO tally_voucher_pdfs (
          voucher_id, voucher_guid, voucher_number, company_name, filename,
          pdf_base64, byte_size, sha256, alter_id, master_id, captured_from, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(voucher_id) DO UPDATE SET
          voucher_guid = excluded.voucher_guid,
          voucher_number = excluded.voucher_number,
          filename = excluded.filename,
          pdf_base64 = excluded.pdf_base64,
          byte_size = excluded.byte_size,
          sha256 = excluded.sha256,
          alter_id = excluded.alter_id,
          updated_at = excluded.updated_at`
      )
      .run(
        voucher.id,
        voucher.guid,
        voucher.voucherNumber,
        pendingRow.company_name,
        filename,
        pendingRow.pdf_base64,
        pendingRow.byte_size,
        pendingRow.sha256,
        voucher.alterId,
        pendingRow.master_id,
        pendingRow.captured_from,
        now
      );
    raw.prepare(`DELETE FROM tally_voucher_pdfs WHERE voucher_id = ?`).run(pendingId);
    break;
  }
}

function removeStoredTallyVoucherPdf(workspaceId: string, voucher: { id: string; guid: string }): void {
  try {
    ensureTallyVoucherPdfsTable(workspaceId);
    tenantDataDb({ workspaceId })
      .$client.prepare(`DELETE FROM tally_voucher_pdfs WHERE voucher_id = ? OR voucher_guid = ?`)
      .run(voucher.id, voucher.guid);
  } catch {
    // Ignore if table not initialized
  }
}

export function getNativeTallyVoucherPdf(
  workspaceId: string,
  voucherIdOrGuid: string
): TallyVoucherPdfDocument | null {
  ensureTallyVoucherPdfsTable(workspaceId);
  const raw = tenantDataDb({ workspaceId }).$client;
  const row = raw
    .prepare(
      `SELECT voucher_id, voucher_guid, voucher_number, company_name, filename,
              pdf_base64, byte_size, sha256, alter_id, master_id, captured_from, updated_at
       FROM tally_voucher_pdfs
       WHERE voucher_id = ? OR voucher_guid = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(voucherIdOrGuid, voucherIdOrGuid) as
    | {
        voucher_id: string;
        voucher_guid: string;
        voucher_number: string;
        company_name: string;
        filename: string;
        pdf_base64: string;
        byte_size: number;
        sha256: string;
        alter_id: number;
        master_id: string | null;
        captured_from: string;
        updated_at: number;
      }
    | undefined;

  if (!row) return null;
  const pdfBuffer = Buffer.from(row.pdf_base64, "base64");
  return {
    voucherId: row.voucher_id,
    voucherGuid: row.voucher_guid,
    voucherNumber: row.voucher_number,
    companyName: row.company_name,
    filename: row.filename,
    pdfBuffer,
    byteSize: row.byte_size,
    sha256: row.sha256,
    alterId: row.alter_id,
    masterId: row.master_id,
    capturedFrom: row.captured_from,
    updatedAt: row.updated_at,
  };
}

export function listWorkspaceVoucherPdfStatusMap(
  workspaceId: string
): Map<string, TallyVoucherPdfMeta> {
  ensureTallyVoucherPdfsTable(workspaceId);
  const raw = tenantDataDb({ workspaceId }).$client;
  const rows = raw
    .prepare(
      `SELECT voucher_id, voucher_guid, voucher_number, company_name, filename,
              byte_size, sha256, alter_id, master_id, captured_from, updated_at
       FROM tally_voucher_pdfs`
    )
    .all() as Array<{
    voucher_id: string;
    voucher_guid: string;
    voucher_number: string;
    company_name: string;
    filename: string;
    byte_size: number;
    sha256: string;
    alter_id: number;
    master_id: string | null;
    captured_from: string;
    updated_at: number;
  }>;

  const map = new Map<string, TallyVoucherPdfMeta>();
  for (const r of rows) {
    map.set(r.voucher_id, {
      voucherId: r.voucher_id,
      voucherGuid: r.voucher_guid,
      voucherNumber: r.voucher_number,
      companyName: r.company_name,
      filename: r.filename,
      byteSize: r.byte_size,
      sha256: r.sha256,
      alterId: r.alter_id,
      masterId: r.master_id,
      capturedFrom: r.captured_from,
      updatedAt: r.updated_at,
    });
  }
  return map;
}

export function buildSignedTallyVoucherPdfUrl(params: {
  workspaceId: string;
  voucherId: string;
  filename?: string;
  baseUrl?: string;
  ttlMs?: number;
}): string {
  const expiresAt = Date.now() + (params.ttlMs ?? 30 * 24 * 3600_000);
  const canonical = `${params.workspaceId}.${params.voucherId}.${expiresAt}`;
  const sig = signHmac(canonical, getEnv().KMS_MASTER_KEY);

  let resolvedBase = params.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  if (!resolvedBase) {
    const ws = controlDb()
      .select({ slug: controlSchema.workspaces.slug })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();
    const endpoints = resolvePublicEndpoints({ workspaceSlug: ws?.slug ?? null });
    resolvedBase = endpoints.tallyCloudBaseUrl;
  }

  const safeFile = (params.filename || "Invoice.pdf").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${resolvedBase}/api/public/tally-invoice/${encodeURIComponent(params.workspaceId)}/${encodeURIComponent(params.voucherId)}/${encodeURIComponent(safeFile)}?exp=${expiresAt}&sig=${sig}`;
}

export function verifySignedTallyVoucherPdfToken(params: {
  workspaceId: string;
  voucherId: string;
  expiresAt: number;
  sig: string;
}): boolean {
  if (!Number.isFinite(params.expiresAt) || params.expiresAt <= Date.now()) {
    return false;
  }
  if (!params.sig || params.sig.length < 32) {
    return false;
  }
  const canonical = `${params.workspaceId}.${params.voucherId}.${Math.trunc(params.expiresAt)}`;
  return verifyHmac(canonical, params.sig, getEnv().KMS_MASTER_KEY);
}

export function buildLocalTallyNativeVoucherPdfXml(params: {
  masterId: string | number;
  companyName?: string;
}): string {
  const cleanMasterId = String(params.masterId).replace(/[^0-9]/g, "");
  const companyStatic = params.companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXml(params.companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>RSLNativeVoucherPrint</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:PDF</SVEXPORTFORMAT>
        <SVPRINTMODE>$$SysName:NormalPrint</SVPRINTMODE>${companyStatic}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="RSLNativeVoucherPrint" ISMODIFY="No">
            <USE>Voucher</USE>
            <OBJECT>Voucher : "ID:${cleanMasterId}"</OBJECT>
          </REPORT>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Exports the exact native printed invoice PDF (%PDF-1.x) directly from Tally Prime's
 * own Voucher print engine over HTTP without modifying the client's invoice design
 * and without opening any interactive UI dialog in Tally Prime.
 */
export async function exportNativeVoucherPdfFromLocalTally(params: {
  host?: string;
  port?: number;
  masterId: string | number;
  companyName?: string;
  timeoutMs?: number;
}): Promise<Buffer | null> {
  const cleanMasterId = String(params.masterId ?? "").replace(/[^0-9]/g, "");
  if (!cleanMasterId) return null;
  const host = params.host || "127.0.0.1";
  const port =
    params.port && Number.isInteger(params.port) && params.port >= 1024 && params.port <= 65535
      ? params.port
      : 9000;
  const xmlBody = buildLocalTallyNativeVoucherPdfXml({
    masterId: cleanMasterId,
    companyName: params.companyName,
  });
  const timeoutMs = params.timeoutMs ?? 2400;

  return new Promise<Buffer | null>((resolve) => {
    let settled = false;
    const finish = (val: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    try {
      const req = http.request(
        {
          hostname: host,
          port,
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "Content-Length": Buffer.byteLength(xmlBody),
            "Accept-Encoding": "identity",
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              let rawBuf = Buffer.concat(chunks);
              if (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
                rawBuf = zlib.gunzipSync(rawBuf);
              }
              if (rawBuf.length >= 16 && rawBuf.subarray(0, 5).toString("ascii") === "%PDF-") {
                finish(rawBuf);
                return;
              }
              finish(null);
            } catch {
              finish(null);
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        finish(null);
      });
      req.on("error", () => {
        finish(null);
      });
      req.write(xmlBody);
      req.end();
    } catch {
      finish(null);
    }
  });
}

export interface TallyCompanyRoutingConfig {
  mode: "all" | "selected";
  allowedCompanyNames: string[];
}

export function getTallyCompanyRoutingConfig(workspaceId: string): TallyCompanyRoutingConfig {
  try {
    const row = tenantDataDb({ workspaceId })
      .select()
      .from(tenantDataSchema.settings)
      .where(eq(tenantDataSchema.settings.key, TALLY_COMPANY_ROUTING_SETTING_KEY))
      .get();
    if (!row?.valueJson) {
      return { mode: "all", allowedCompanyNames: [] };
    }
    const parsed = JSON.parse(row.valueJson) as Partial<TallyCompanyRoutingConfig>;
    const names = Array.isArray(parsed.allowedCompanyNames)
      ? Array.from(
          new Set(
            parsed.allowedCompanyNames
              .map((n) => String(n ?? "").trim())
              .filter((n) => n.length > 0)
          )
        )
      : [];
    return {
      mode: parsed.mode === "selected" && names.length > 0 ? "selected" : "all",
      allowedCompanyNames: names,
    };
  } catch {
    return { mode: "all", allowedCompanyNames: [] };
  }
}

export function isTallyCompanyAllowed(
  companyName: string | null | undefined,
  routing: TallyCompanyRoutingConfig
): boolean {
  if (routing.mode !== "selected" || routing.allowedCompanyNames.length === 0) {
    return true;
  }
  const candidate = (companyName ?? "").trim().toLowerCase();
  if (!candidate) return false;
  return routing.allowedCompanyNames.some((allowed) => allowed.trim().toLowerCase() === candidate);
}

function normalizeFinancialYearIso(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }
  const parsed = parseTallyDateNullableLocal(trimmed);
  if (parsed !== null) {
    return new Date(parsed + 5.5 * 3600_000).toISOString().slice(0, 10);
  }
  return null;
}

function parseTallyDateNullableLocal(raw: string): number | null {
  const monthNames: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const alphaMatch = raw.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (alphaMatch) {
    const day = Number(alphaMatch[1]);
    const monIdx = monthNames[alphaMatch[2]!.slice(0, 3).toLowerCase()];
    const rawYear = Number(alphaMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (monIdx !== undefined && day >= 1 && day <= 31) {
      return Date.UTC(year, monIdx, day);
    }
  }
  return null;
}

/**
 * Registers one or more open Tally Prime companies into `tally_companies` immediately
 * (even when a newly opened company has 0 vouchers and 0 products yet), honoring
 * workspace Multi-Company Routing rules.
 */
export function registerTallyCompaniesForWorkspace(params: {
  workspaceId: string;
  companies: Array<string | { name?: string; guid?: string; startingFrom?: string }>;
  updateLastSyncedAt?: boolean;
}): {
  registeredCompanies: Array<{ id: string; name: string; companyGuid: string }>;
  ignoredCount: number;
} {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const routing = getTallyCompanyRoutingConfig(params.workspaceId);
  const now = Date.now();
  const registeredCompanies: Array<{ id: string; name: string; companyGuid: string }> = [];
  const seenSlugs = new Set<string>();
  let ignoredCount = 0;

  for (const entry of params.companies) {
    const rawName = typeof entry === "string" ? entry : entry?.name;
    const cleanName = String(rawName ?? "")
      .replace(/^[\x00-\x1f]+/, "")
      .trim();
    if (!cleanName || cleanName === "Primary Tally Company") continue;

    if (!isTallyCompanyAllowed(cleanName, routing)) {
      ignoredCount++;
      continue;
    }

    const companyGuid = `comp_${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    if (seenSlugs.has(companyGuid)) continue;
    seenSlugs.add(companyGuid);

    const fyIso =
      typeof entry === "object" && entry !== null
        ? normalizeFinancialYearIso(entry.startingFrom)
        : null;

    let row = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();

    if (!row) {
      const id = newEntityId("tco", params.workspaceId, now);
      db.insert(tenantDataSchema.tallyCompanies)
        .values({
          id,
          companyGuid,
          name: cleanName,
          financialYearFrom: fyIso ?? "2026-04-01",
          lastAlterId: 0,
          lastSyncedAt: params.updateLastSyncedAt === false ? null : now,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      row = db
        .select()
        .from(tenantDataSchema.tallyCompanies)
        .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
        .get();
    } else if (params.updateLastSyncedAt !== false || fyIso) {
      db.update(tenantDataSchema.tallyCompanies)
        .set({
          name: cleanName,
          ...(fyIso ? { financialYearFrom: fyIso } : {}),
          ...(params.updateLastSyncedAt !== false ? { lastSyncedAt: now } : {}),
        })
        .where(eq(tenantDataSchema.tallyCompanies.id, row.id))
        .run();
    }

    if (row) {
      registeredCompanies.push({
        id: row.id,
        name: row.name,
        companyGuid: row.companyGuid,
      });
    }
  }

  return { registeredCompanies, ignoredCount };
}

export const saveTallyCompanyRouting = defineAction({
  key: "tally.webhook.rotated",
  permission: "tally:sync.manage",
  input: z.object({
    mode: z.enum(["all", "selected"]),
    allowedCompanyNames: z.array(z.string().max(160)).max(50).default([]),
  }),
  summarize: (input) =>
    input.mode === "selected" && input.allowedCompanyNames.length > 0
      ? `Restricted Tally sync to ${input.allowedCompanyNames.length} selected Tally company(ies)`
      : "Configured Tally sync to accept all open Tally companies",
  handler: (ctx, input) => {
    const cleaned = Array.from(
      new Set(
        input.allowedCompanyNames
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
      )
    );
    const effectiveMode: "all" | "selected" =
      input.mode === "selected" && cleaned.length > 0 ? "selected" : "all";
    const valueJson = JSON.stringify({
      mode: effectiveMode,
      allowedCompanyNames: cleaned,
    });
    const now = Date.now();
    tenantDataDb(ctx)
      .insert(tenantDataSchema.settings)
      .values({
        key: TALLY_COMPANY_ROUTING_SETTING_KEY,
        valueJson,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.settings.key,
        set: { valueJson, updatedAt: now },
      })
      .run();
    return { mode: effectiveMode, allowedCompanyNames: cleaned };
  },
});

function cancelPendingOutboxJobsForVoucher(
  workspaceId: string,
  voucher: { id: string; guid: string }
): number {
  const db = tenantDataDb({ workspaceId });
  const pendingRows = db
    .select()
    .from(tenantDataSchema.outbox)
    .where(
      and(
        eq(tenantDataSchema.outbox.status, "pending"),
        eq(tenantDataSchema.outbox.jobType, "tally.whatsapp.automation")
      )
    )
    .all();

  let cancelled = 0;
  const now = Date.now();
  for (const row of pendingRows) {
    if (
      row.envelopeJson.includes(`"${voucher.id}"`) ||
      row.envelopeJson.includes(`"${voucher.guid}"`)
    ) {
      db.update(tenantDataSchema.outbox)
        .set({
          status: "completed",
          lastError: "Skipped: voucher deleted or cancelled in Tally Prime",
          updatedAt: now,
        })
        .where(eq(tenantDataSchema.outbox.id, row.id))
        .run();
      cancelled++;
    }
  }
  return cancelled;
}

export function detectOutdatedTdlVersion(lastUserAgent?: string | null): {
  isOutdated: boolean;
  detectedVersion: string | null;
  latestVersion: string;
} {
  if (!lastUserAgent) {
    return {
      isOutdated: false,
      detectedVersion: null,
      latestVersion: LATEST_TALLY_TDL_VERSION,
    };
  }
  const m = lastUserAgent.match(/TallyPrime-RSL-TDL\/(\d+(?:\.\d+)?)/i);
  if (!m?.[1]) {
    return {
      isOutdated: false,
      detectedVersion: null,
      latestVersion: LATEST_TALLY_TDL_VERSION,
    };
  }
  const detected = m[1];
  const parsed = Number(detected);
  return {
    isOutdated: Number.isFinite(parsed) && parsed < Number(LATEST_TALLY_TDL_VERSION),
    detectedVersion: detected,
    latestVersion: LATEST_TALLY_TDL_VERSION,
  };
}

export type TallyWebhookLiveState =
  | "receiving_live"
  | "handshake_verified"
  | "awaiting_first_event"
  | "error"
  | "paused";

export interface TallyWebhookLiveStatus {
  state: TallyWebhookLiveState;
  label: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  detail: string;
}

export function computeTallyWebhookLiveStatus(endpoint: {
  enabled: boolean;
  eventsReceivedCount: number;
  pingsReceivedCount?: number | null;
  lastEventAt?: number | null;
  lastPingAt?: number | null;
  lastErrorAt?: number | null;
  lastErrorMessage?: string | null;
}): TallyWebhookLiveStatus {
  if (!endpoint.enabled) {
    return {
      state: "paused",
      label: "Paused",
      tone: "neutral",
      detail: "Incoming Tally webhook deliveries are paused. Resume ingress to receive live bills.",
    };
  }

  const lastOkAt = Math.max(endpoint.lastEventAt ?? 0, endpoint.lastPingAt ?? 0);
  if (endpoint.lastErrorAt && endpoint.lastErrorAt > lastOkAt) {
    return {
      state: "error",
      label: "Delivery Error",
      tone: "danger",
      detail:
        endpoint.lastErrorMessage ||
        "The most recent Tally webhook request failed payload or token validation.",
    };
  }

  if (endpoint.eventsReceivedCount > 0 && endpoint.lastEventAt) {
    return {
      state: "receiving_live",
      label: "Verified & Receiving",
      tone: "success",
      detail: `${endpoint.eventsReceivedCount} Tally voucher event(s) synced cleanly.`,
    };
  }

  if ((endpoint.pingsReceivedCount ?? 0) > 0 && endpoint.lastPingAt) {
    return {
      state: "handshake_verified",
      label: "Handshake Verified",
      tone: "info",
      detail: `Endpoint & token verified (${endpoint.pingsReceivedCount} check(s)) — waiting for first Tally voucher.`,
    };
  }

  return {
    state: "awaiting_first_event",
    label: "Awaiting Connection",
    tone: "warning",
    detail:
      "Endpoint provisioned — run Live Endpoint Check or load the .tdl add-on in Tally Prime.",
  };
}

export type TallyAgentLiveState = "connected" | "tally_unreachable" | "offline" | "revoked";

export interface TallyAgentLiveStatus {
  state: TallyAgentLiveState;
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  detail: string;
  isOnline: boolean;
}

export function computeAgentDeviceLiveStatus(
  device: {
    status: string;
    tallyReachable?: boolean | null;
    tallyHost?: string | null;
    tallyPort?: number | null;
    activeCompanyName?: string | null;
    lastHeartbeatAt?: number | null;
    lastErrorMessage?: string | null;
    revokedAt?: number | null;
  },
  now = Date.now()
): TallyAgentLiveStatus {
  if (device.revokedAt !== null && device.revokedAt !== undefined) {
    return {
      state: "revoked",
      label: "Unpaired",
      tone: "danger",
      detail: "This PC connector was unpaired and can no longer push vouchers.",
      isOnline: false,
    };
  }
  if (device.status === "revoked") {
    return {
      state: "revoked",
      label: "Unpaired",
      tone: "danger",
      detail: "This PC connector was unpaired and can no longer push vouchers.",
      isOnline: false,
    };
  }

  const hbAge = device.lastHeartbeatAt ? now - device.lastHeartbeatAt : Number.POSITIVE_INFINITY;
  const heartbeatFresh = hbAge >= 0 && hbAge <= AGENT_HEARTBEAT_STALE_MS && device.status !== "offline";

  if (!heartbeatFresh) {
    return {
      state: "offline",
      label: "Offline",
      tone: "neutral",
      detail: device.lastHeartbeatAt
        ? "No heartbeat received from this office PC in the last 2 minutes."
        : "Paired — waiting for first background heartbeat from office PC.",
      isOnline: false,
    };
  }

  const hostPort = `${device.tallyHost || "127.0.0.1"}:${device.tallyPort || 9000}`;
  if (device.tallyReachable) {
    return {
      state: "connected",
      label: "Connected • Port 9000 Ready",
      tone: "success",
      detail: device.activeCompanyName
        ? `Tally Prime reachable on ${hostPort} (${device.activeCompanyName})`
        : `Tally Prime XML Server reachable on ${hostPort}`,
      isOnline: true,
    };
  }

  return {
    state: "tally_unreachable",
    label: "PC Online • Tally Port Closed",
    tone: "warning",
    detail:
      device.lastErrorMessage ||
      `Connector is online, but Tally Prime is not responding on ${hostPort}. Open Tally Prime -> F1 -> Connectivity -> Client/Server = Both, Port = ${device.tallyPort || 9000}.`,
    isOnline: true,
  };
}

export function getOrCreateTallyWebhookEndpoint(workspaceId: string) {
  const ctrl = controlDb();
  const existing = ctrl
    .select()
    .from(controlSchema.tallyWebhookEndpoints)
    .where(eq(controlSchema.tallyWebhookEndpoints.workspaceId, workspaceId))
    .get();

  if (existing) return existing;

  const now = Date.now();
  const id = newEntityId("tlwh", workspaceId, now);
  const webhookToken = `tlwh_${crypto.randomBytes(18).toString("hex")}`;

  ctrl
    .insert(controlSchema.tallyWebhookEndpoints)
    .values({
      id,
      workspaceId,
      webhookToken,
      enabled: true,
      eventsReceivedCount: 0,
      pingsReceivedCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  return ctrl
    .select()
    .from(controlSchema.tallyWebhookEndpoints)
    .where(eq(controlSchema.tallyWebhookEndpoints.workspaceId, workspaceId))
    .get()!;
}

export function lookupTallyWebhookEndpointByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return (
    controlDb()
      .select()
      .from(controlSchema.tallyWebhookEndpoints)
      .where(eq(controlSchema.tallyWebhookEndpoints.webhookToken, trimmed))
      .get() ?? null
  );
}

export function resolveWorkspaceByTallyWebhookToken(token: string): { workspaceId: string; endpointId: string } | null {
  const row = lookupTallyWebhookEndpointByToken(token);
  if (!row || !row.enabled) return null;
  return { workspaceId: row.workspaceId, endpointId: row.id };
}

export function recordTallyWebhookPing(params: {
  endpointId: string;
  sourceIp?: string | null;
  userAgent?: string | null;
}) {
  const ctrl = controlDb();
  const existing = ctrl
    .select()
    .from(controlSchema.tallyWebhookEndpoints)
    .where(eq(controlSchema.tallyWebhookEndpoints.id, params.endpointId))
    .get();
  if (!existing) return null;

  const now = Date.now();
  const nextPings = (existing.pingsReceivedCount ?? 0) + 1;
  ctrl
    .update(controlSchema.tallyWebhookEndpoints)
    .set({
      pingsReceivedCount: nextPings,
      lastPingAt: now,
      lastSourceIp: params.sourceIp?.slice(0, 120) ?? existing.lastSourceIp ?? null,
      lastUserAgent: params.userAgent?.slice(0, 180) ?? existing.lastUserAgent ?? null,
      lastErrorMessage: null,
      updatedAt: now,
    })
    .where(eq(controlSchema.tallyWebhookEndpoints.id, existing.id))
    .run();

  return { pingsReceivedCount: nextPings, lastPingAt: now };
}

export function recordTallyWebhookError(params: {
  endpointId: string;
  errorMessage: string;
  sourceIp?: string | null;
  userAgent?: string | null;
}) {
  const now = Date.now();
  controlDb()
    .update(controlSchema.tallyWebhookEndpoints)
    .set({
      lastErrorAt: now,
      lastErrorMessage: params.errorMessage.slice(0, 300),
      ...(params.sourceIp ? { lastSourceIp: params.sourceIp.slice(0, 120) } : {}),
      ...(params.userAgent ? { lastUserAgent: params.userAgent.slice(0, 180) } : {}),
      updatedAt: now,
    })
    .where(eq(controlSchema.tallyWebhookEndpoints.id, params.endpointId))
    .run();
}

export function getTallyWorkspaceSummary(workspaceId: string) {
  const dataDb = tenantDataDb({ workspaceId });
  const ctrl = controlDb();
  const now = Date.now();

  const companies = dataDb
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .orderBy(desc(tenantDataSchema.tallyCompanies.createdAt))
    .all();

  const vouchers = dataDb
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .orderBy(desc(tenantDataSchema.tallyVouchers.voucherDate))
    .limit(200)
    .all();

  const rules = dataDb
    .select()
    .from(tenantDataSchema.reminderRules)
    .orderBy(desc(tenantDataSchema.reminderRules.createdAt))
    .all();

  const automationRules = dataDb
    .select()
    .from(tenantDataSchema.tallyAutomationRules)
    .orderBy(desc(tenantDataSchema.tallyAutomationRules.createdAt))
    .all();

  const templates = dataDb
    .select({
      id: tenantDataSchema.whatsappTemplates.id,
      name: tenantDataSchema.whatsappTemplates.name,
      category: tenantDataSchema.whatsappTemplates.category,
      approvalStatus: tenantDataSchema.whatsappTemplates.approvalStatus,
    })
    .from(tenantDataSchema.whatsappTemplates)
    .orderBy(desc(tenantDataSchema.whatsappTemplates.createdAt))
    .all();

  const syncRuns = dataDb
    .select()
    .from(tenantDataSchema.syncRuns)
    .orderBy(desc(tenantDataSchema.syncRuns.createdAt))
    .limit(25)
    .all();

  const rawDevices = ctrl
    .select({
      id: controlSchema.agentDevices.id,
      deviceName: controlSchema.agentDevices.deviceName,
      osVersion: controlSchema.agentDevices.osVersion,
      agentVersion: controlSchema.agentDevices.agentVersion,
      status: controlSchema.agentDevices.status,
      tallyReachable: controlSchema.agentDevices.tallyReachable,
      tallyHost: controlSchema.agentDevices.tallyHost,
      tallyPort: controlSchema.agentDevices.tallyPort,
      activeCompanyName: controlSchema.agentDevices.activeCompanyName,
      lastAlterId: controlSchema.agentDevices.lastAlterId,
      lastHeartbeatAt: controlSchema.agentDevices.lastHeartbeatAt,
      lastSyncAt: controlSchema.agentDevices.lastSyncAt,
      lastErrorMessage: controlSchema.agentDevices.lastErrorMessage,
      revokedAt: controlSchema.agentDevices.revokedAt,
      createdAt: controlSchema.agentDevices.createdAt,
    })
    .from(controlSchema.agentDevices)
    .where(eq(controlSchema.agentDevices.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.agentDevices.createdAt))
    .all();

  const devices = rawDevices
    .filter((d) => d.revokedAt === null && d.status !== "revoked")
    .map((d) => ({
      ...d,
      liveStatus: computeAgentDeviceLiveStatus(d, now),
    }));

  const webhookEndpoint = getOrCreateTallyWebhookEndpoint(workspaceId);
  const webhookLiveStatus = computeTallyWebhookLiveStatus(webhookEndpoint);

  const waConnections = ctrl
    .select({
      id: controlSchema.connections.id,
      provider: controlSchema.connections.provider,
      displayName: controlSchema.connections.displayName,
      status: controlSchema.connections.status,
    })
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, workspaceId))
    .all()
    .filter((c) => c.provider === "whatsapp" && c.status !== "revoked");

  const approvedTemplatesCount = templates.filter((t) => t.approvalStatus === "APPROVED").length;
  const activeAutomationRulesCount = automationRules.filter((r) => r.active).length;
  const activeReminderRulesCount = rules.filter((r) => r.active).length;
  const connectedPcCount = devices.filter((d) => d.liveStatus.state === "connected").length;
  const tallyUnreachablePcCount = devices.filter(
    (d) => d.liveStatus.state === "tally_unreachable"
  ).length;

  const overallState: "live_connected" | "handshake_ready" | "attention_needed" | "not_connected" =
    connectedPcCount > 0 || webhookLiveStatus.state === "receiving_live"
      ? "live_connected"
      : webhookLiveStatus.state === "error"
        ? "attention_needed"
        : webhookLiveStatus.state === "handshake_verified" || tallyUnreachablePcCount > 0
          ? "handshake_ready"
          : "not_connected";

  const connectionOverview = {
    overallState,
    overallLabel:
      overallState === "live_connected"
        ? "Live Tally Sync Connected"
        : overallState === "handshake_ready"
          ? tallyUnreachablePcCount > 0
            ? "PC Online • Tally Port 9000 Closed"
            : "Endpoint Verified • Awaiting Tally Voucher"
          : overallState === "attention_needed"
            ? "Webhook Error — Check Diagnostics"
            : "Awaiting Tally Prime Connection",
    overallTone:
      overallState === "live_connected"
        ? ("success" as const)
        : overallState === "handshake_ready"
          ? ("info" as const)
          : overallState === "attention_needed"
            ? ("danger" as const)
            : ("warning" as const),
    webhookLiveStatus,
    connectedPcCount,
    tallyUnreachablePcCount,
    pairedPcCount: devices.length,
    whatsappConnected: waConnections.length > 0,
    whatsappAccountName: waConnections[0]?.displayName ?? null,
    approvedTemplatesCount,
    activeAutomationRulesCount,
    activeReminderRulesCount,
    workflowSteps: [
      {
        step: 1,
        key: "endpoint",
        title: "Cloud Subdomain Endpoint & Token",
        status:
          webhookLiveStatus.state === "receiving_live" ||
          webhookLiveStatus.state === "handshake_verified"
            ? ("complete" as const)
            : webhookLiveStatus.state === "error" || webhookLiveStatus.state === "paused"
              ? ("warning" as const)
              : ("ready" as const),
        summary: webhookLiveStatus.detail,
      },
      {
        step: 2,
        key: "tally_bridge",
        title: "Tally Prime Bridge (.tdl or PC Connector)",
        status:
          connectedPcCount > 0 ||
          webhookEndpoint.eventsReceivedCount > 0 ||
          Boolean(webhookEndpoint.lastUserAgent?.startsWith("TallyPrime"))
            ? ("complete" as const)
            : tallyUnreachablePcCount > 0
              ? ("warning" as const)
              : ("pending" as const),
        summary:
          connectedPcCount > 0
            ? `${connectedPcCount} Windows PC connector(s) live on Tally port 9000.`
            : webhookEndpoint.eventsReceivedCount > 0
              ? `Tally Prime .tdl / API has pushed ${webhookEndpoint.eventsReceivedCount} voucher(s).`
              : webhookEndpoint.lastUserAgent?.startsWith("TallyPrime")
                ? "Tally Prime desktop .tdl verified — save any voucher in Tally to sync."
                : tallyUnreachablePcCount > 0
                  ? "Office PC connector is online, but Tally Prime port 9000 is not open."
                  : "Load the .tdl add-on in Tally Prime or pair your office Windows PC.",
      },
      {
        step: 3,
        key: "whatsapp",
        title: "WhatsApp Cloud API & Approved Templates",
        status:
          waConnections.length > 0 && approvedTemplatesCount > 0
            ? ("complete" as const)
            : waConnections.length > 0 || approvedTemplatesCount > 0
              ? ("warning" as const)
              : ("pending" as const),
        summary:
          waConnections.length > 0 && approvedTemplatesCount > 0
            ? `${waConnections[0]!.displayName} linked • ${approvedTemplatesCount} approved template(s).`
            : waConnections.length === 0
              ? "Link your WhatsApp Business Cloud API number in Connected Accounts."
              : "Add or approve at least one WhatsApp utility template for bills/receipts.",
      },
      {
        step: 4,
        key: "automation",
        title: "Automatic Bill & Overdue Rules",
        status:
          activeAutomationRulesCount > 0 || activeReminderRulesCount > 0
            ? ("complete" as const)
            : ("pending" as const),
        summary:
          activeAutomationRulesCount > 0 || activeReminderRulesCount > 0
            ? `${activeAutomationRulesCount} instant voucher rule(s) • ${activeReminderRulesCount} overdue schedule(s) active.`
            : "Create an instant Sales/Receipt rule or overdue reminder schedule.",
      },
    ],
  };

  const pdfStatusMap = listWorkspaceVoucherPdfStatusMap(workspaceId);
  const lineItemsMap = listVoucherLineItemsMap(workspaceId);
  const stockItemsCount = dataDb
    .select({ id: tenantDataSchema.tallyStockItems.id })
    .from(tenantDataSchema.tallyStockItems)
    .all().length;
  const partyRows = dataDb
    .select({
      id: tenantDataSchema.tallyParties.id,
      companyId: tenantDataSchema.tallyParties.companyId,
      name: tenantDataSchema.tallyParties.name,
    })
    .from(tenantDataSchema.tallyParties)
    .all();
  const partyIdLookup = new Map(
    partyRows.map((p) => [`${p.companyId}::${p.name.trim().toLowerCase()}`, p.id])
  );
  const settlementRows = dataDb
    .select()
    .from(tenantDataSchema.tallyBillSettlements)
    .all();
  const settlementsByBillMap = new Map<
    string,
    Array<typeof tenantDataSchema.tallyBillSettlements.$inferSelect>
  >();
  const voucherSettledViaReceiptOrCnMap = new Map<string, number>();
  for (const s of settlementRows) {
    const arr = settlementsByBillMap.get(s.billVoucherId) ?? [];
    arr.push(s);
    settlementsByBillMap.set(s.billVoucherId, arr);
    if (s.settlementVoucherId) {
      voucherSettledViaReceiptOrCnMap.set(
        s.billVoucherId,
        (voucherSettledViaReceiptOrCnMap.get(s.billVoucherId) ?? 0) + s.amountPaise
      );
    }
  }

  const nextSuggestedBillNumber = suggestNextSequentialVoucherNumber(vouchers);

  const enrichedVouchers = vouchers.map((v) => {
    const pdfMeta = pdfStatusMap.get(v.id);
    return {
      ...v,
      partyId: partyIdLookup.get(`${v.companyId}::${v.partyName.trim().toLowerCase()}`) ?? null,
      hasNativePdf: Boolean(pdfMeta),
      nativePdfFilename: pdfMeta?.filename ?? null,
      nativePdfByteSize: pdfMeta?.byteSize ?? null,
      nativePdfCapturedFrom: pdfMeta?.capturedFrom ?? null,
      lineItems: lineItemsMap.get(v.id) ?? [],
      settlements: settlementsByBillMap.get(v.id) ?? [],
    };
  });

  let totalBilledPaise = 0;
  let totalCollectedPaise = 0;
  let totalPendingPaise = 0;
  let overdueCount = 0;
  let overdueAmountPaise = 0;
  let latestVoucherUpdatedAt = 0;
  let nativePdfCount = 0;

  // Deduplicate Receipt vouchers vs settled Sales bills so moneyCollected is never counted twice!
  const partyReceiptTotals = new Map<string, number>();
  const partySalesDirectPaidTotals = new Map<string, number>();
  const partyHasSettlementRows = new Set<string>();
  for (const v of enrichedVouchers) {
    if (v.paymentStatus === "cancelled") continue;
    const pKey = `${v.companyId}::${v.partyName.trim().toLowerCase()}`;
    if (v.settlements.length > 0) {
      partyHasSettlementRows.add(pKey);
    }
    if (v.voucherType === "Receipt") {
      partyReceiptTotals.set(pKey, (partyReceiptTotals.get(pKey) ?? 0) + v.amountPaise);
    } else if (v.voucherType === "Sales") {
      const settledBySeparateVch = voucherSettledViaReceiptOrCnMap.get(v.id) ?? 0;
      const nonVoucherPaid = Math.max(0, v.paidAmountPaise - settledBySeparateVch);
      partySalesDirectPaidTotals.set(
        pKey,
        (partySalesDirectPaidTotals.get(pKey) ?? 0) + nonVoucherPaid
      );
    }
  }
  const allCollectionKeys = new Set([
    ...partyReceiptTotals.keys(),
    ...partySalesDirectPaidTotals.keys(),
  ]);
  for (const pk of allCollectionKeys) {
    const rcptAmt = partyReceiptTotals.get(pk) ?? 0;
    const directSalesAmt = partySalesDirectPaidTotals.get(pk) ?? 0;
    // When `tally_bill_settlements` is populated, `settledBySeparateVch` already subtracted `rcptAmt`
    // from `nonVoucherPaid`; if raw SQL rows were inserted without running settlement reconciliation,
    // `Math.max(rcptAmt, directSalesAmt)` prevents double-counting.
    totalCollectedPaise += partyHasSettlementRows.has(pk)
      ? rcptAmt + directSalesAmt
      : Math.max(rcptAmt, directSalesAmt);
  }

  for (const v of enrichedVouchers) {
    if (v.hasNativePdf) nativePdfCount++;
    if (v.updatedAt > latestVoucherUpdatedAt) {
      latestVoucherUpdatedAt = v.updatedAt;
    }
    if (v.voucherType === "Sales" && v.paymentStatus !== "cancelled") {
      totalBilledPaise += v.amountPaise;
      const balance = Math.max(0, v.amountPaise - v.paidAmountPaise);
      totalPendingPaise += balance;
      if (balance > 0 && v.dueDate && v.dueDate < now) {
        overdueCount++;
        overdueAmountPaise += balance;
      }
    }
  }

  const companyRouting = getTallyCompanyRoutingConfig(workspaceId);

  return {
    companies,
    companyRouting,
    vouchers: enrichedVouchers,
    nextSuggestedBillNumber,
    latestVoucherUpdatedAt,
    rules,
    automationRules,
    templates,
    webhookEndpoint,
    webhookLiveStatus,
    connectionOverview,
    syncRuns,
    devices,
    totals: {
      totalBilledPaise,
      totalCollectedPaise,
      totalPendingPaise,
      overdueCount,
      overdueAmountPaise,
      nativePdfCount,
      stockItemsCount,
      partiesCount: partyRows.length,
    },
  };
}

function suggestNextSequentialVoucherNumber(
  vouchers: Array<{ voucherNumber: string; voucherType: string }>
): string {
  const existingSet = new Set(vouchers.map((v) => v.voucherNumber.trim().toUpperCase()));
  for (const v of vouchers) {
    const trimmed = v.voucherNumber.trim();
    if (trimmed.startsWith("SIM-")) continue;
    const m = trimmed.match(/^(.*?)(\d+)$/);
    if (m) {
      const prefix = m[1] ?? "";
      const digits = m[2] ?? "1";
      let nextNum = Number(digits) + 1;
      for (let guard = 0; guard < 500; guard++) {
        const candidate = `${prefix}${String(nextNum).padStart(digits.length, "0")}`;
        if (!existingSet.has(candidate.toUpperCase())) {
          return candidate;
        }
        nextNum++;
      }
    }
  }
  return `INV-${1001 + vouchers.length}`;
}

export const generateTallyPairingCode = defineAction({
  key: "tally.pairing.created",
  permission: "tally:sync.manage",
  input: z.object({}),
  summarize: () => "Generated 15-minute Tally Prime PC pairing code",
  handler: (ctx) => {
    const rawCode = `RSL-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");
    const now = Date.now();
    const expiresAt = now + 15 * 60 * 1000;

    controlDb()
      .insert(controlSchema.agentPairingCodes)
      .values({
        id: newId(),
        workspaceId: ctx.workspaceId,
        codeHash,
        displayHint: rawCode.slice(0, 7) + "••••",
        expiresAt,
        createdByUserId: ctx.actorId,
        createdAt: now,
      })
      .run();

    return { pairingCode: rawCode, expiresAt };
  },
});

export function exchangePairingCodeForAgentDevice(params: {
  pairingCode: string;
  deviceName: string;
  osVersion?: string;
  agentVersion: string;
}): { deviceId: string; signingSecret: string; workspaceId: string } {
  const db = controlDb();
  const now = Date.now();
  const codeHash = crypto.createHash("sha256").update(params.pairingCode.trim()).digest("hex");

  const codeRow = db
    .select()
    .from(controlSchema.agentPairingCodes)
    .where(eq(controlSchema.agentPairingCodes.codeHash, codeHash))
    .get();

  if (!codeRow || codeRow.consumedAt !== null || codeRow.expiresAt < now) {
    throw new RslError("RSL-TALLY-1001");
  }

  const signingSecret = crypto.randomBytes(32).toString("hex");
  const deviceId = newId();

  db.update(controlSchema.agentPairingCodes)
    .set({ consumedAt: now })
    .where(eq(controlSchema.agentPairingCodes.id, codeRow.id))
    .run();

  db.insert(controlSchema.agentDevices)
    .values({
      id: deviceId,
      workspaceId: codeRow.workspaceId,
      deviceName: params.deviceName.trim(),
      osVersion: params.osVersion ?? "Windows",
      agentVersion: params.agentVersion,
      signingSecretEncrypted: encryptEnvelope(signingSecret),
      status: "online",
      lastHeartbeatAt: now,
      createdAt: now,
    })
    .run();

  const corr = newId();
  appendActionLog({
    workspaceId: codeRow.workspaceId,
    actorType: "agent",
    actorId: deviceId,
    source: "agent",
    action: "tally.agent.paired",
    outcome: "success",
    requestId: corr,
    correlationId: corr,
    durationMs: 4,
    summary: `Paired Windows Tally PC '${params.deviceName.trim()}'`,
  });

  return { deviceId, signingSecret, workspaceId: codeRow.workspaceId };
}

export function verifyAgentSignedRequest(params: {
  deviceId: string;
  timestampHeader: string;
  signatureHex: string;
  rawBody: string;
}): { workspaceId: string; deviceId: string } {
  const ts = Number(params.timestampHeader);
  const now = Date.now();
  // 5-minute replay window (Section 17)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
    throw new RslError("RSL-TALLY-1002", "Agent timestamp outside 5-minute security window.");
  }

  const dev = controlDb()
    .select()
    .from(controlSchema.agentDevices)
    .where(eq(controlSchema.agentDevices.id, params.deviceId))
    .get();

  if (!dev || dev.revokedAt !== null) {
    throw new RslError("RSL-TALLY-1002");
  }

  const secret = decryptEnvelope(dev.signingSecretEncrypted);
  const canonical = `${ts}.${params.rawBody}`;
  if (!verifyHmac(canonical, params.signatureHex, secret)) {
    throw new RslError("RSL-TALLY-1002");
  }

  controlDb()
    .update(controlSchema.agentDevices)
    .set({ lastHeartbeatAt: now, status: "online" })
    .where(eq(controlSchema.agentDevices.id, dev.id))
    .run();

  return { workspaceId: dev.workspaceId, deviceId: dev.id };
}

export function recordAgentHeartbeat(params: {
  deviceId: string;
  tallyReachable: boolean;
  tallyHost?: string;
  tallyPort?: number;
  activeCompanyName?: string | null;
  openCompanies?: string[];
  lastAlterId?: number;
  lastErrorMessage?: string | null;
  agentVersion?: string;
  osVersion?: string;
}) {
  const now = Date.now();
  const ctrl = controlDb();
  const devRow = ctrl
    .select({ workspaceId: controlSchema.agentDevices.workspaceId })
    .from(controlSchema.agentDevices)
    .where(eq(controlSchema.agentDevices.id, params.deviceId))
    .get();

  const normalizedOpenList = Array.isArray(params.openCompanies)
    ? params.openCompanies.map((c) => String(c ?? "").trim()).filter(Boolean)
    : [];
  const effectiveActiveLabel =
    normalizedOpenList.length > 0
      ? normalizedOpenList.join(", ")
      : params.activeCompanyName;

  ctrl
    .update(controlSchema.agentDevices)
    .set({
      status: "online",
      tallyReachable: params.tallyReachable,
      ...(params.tallyHost ? { tallyHost: params.tallyHost.slice(0, 120) } : {}),
      ...(params.tallyPort && Number.isFinite(params.tallyPort)
        ? { tallyPort: Math.max(1, Math.min(65535, Math.trunc(params.tallyPort))) }
        : {}),
      ...(effectiveActiveLabel !== undefined
        ? { activeCompanyName: effectiveActiveLabel ? effectiveActiveLabel.slice(0, 160) : null }
        : {}),
      ...(params.lastAlterId !== undefined && Number.isFinite(params.lastAlterId)
        ? { lastAlterId: Math.max(0, Math.trunc(params.lastAlterId)) }
        : {}),
      lastErrorMessage: params.tallyReachable
        ? null
        : params.lastErrorMessage
          ? params.lastErrorMessage.slice(0, 280)
          : "Tally Prime XML HTTP server did not respond on configured host/port.",
      ...(params.agentVersion ? { agentVersion: params.agentVersion.slice(0, 40) } : {}),
      ...(params.osVersion ? { osVersion: params.osVersion.slice(0, 80) } : {}),
      lastHeartbeatAt: now,
    })
    .where(eq(controlSchema.agentDevices.id, params.deviceId))
    .run();

  if (devRow?.workspaceId && params.tallyReachable) {
    const candidates =
      normalizedOpenList.length > 0
        ? normalizedOpenList
        : params.activeCompanyName
          ? params.activeCompanyName
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
    if (candidates.length > 0) {
      try {
        registerTallyCompaniesForWorkspace({
          workspaceId: devRow.workspaceId,
          companies: candidates,
          updateLastSyncedAt: true,
        });
      } catch {
        // Non-blocking
      }
    }
  }

  return { recordedAt: now };
}

export function recordAgentSyncSuccess(params: {
  deviceId: string;
  activeCompanyName?: string | null;
  lastAlterId?: number;
}) {
  const now = Date.now();
  controlDb()
    .update(controlSchema.agentDevices)
    .set({
      status: "online",
      tallyReachable: true,
      ...(params.activeCompanyName
        ? { activeCompanyName: params.activeCompanyName.slice(0, 160) }
        : {}),
      ...(params.lastAlterId !== undefined && Number.isFinite(params.lastAlterId)
        ? { lastAlterId: Math.max(0, Math.trunc(params.lastAlterId)) }
        : {}),
      lastErrorMessage: null,
      lastHeartbeatAt: now,
      lastSyncAt: now,
    })
    .where(eq(controlSchema.agentDevices.id, params.deviceId))
    .run();
}

export const toggleTallyWebhookEndpoint = defineAction({
  key: "tally.webhook.rotated",
  permission: "tally:sync.manage",
  input: z.object({
    enabled: z.boolean(),
  }),
  summarize: (input) =>
    `${input.enabled ? "Resumed" : "Paused"} incoming Tally Prime webhook endpoint`,
  handler: (ctx, input) => {
    const endpoint = getOrCreateTallyWebhookEndpoint(ctx.workspaceId);
    const now = Date.now();
    controlDb()
      .update(controlSchema.tallyWebhookEndpoints)
      .set({
        enabled: input.enabled,
        updatedAt: now,
      })
      .where(eq(controlSchema.tallyWebhookEndpoints.id, endpoint.id))
      .run();
    return { enabled: input.enabled };
  },
});

export const revokeTallyAgentDevice = defineAction({
  key: "tally.pairing.created",
  permission: "tally:sync.manage",
  input: z.object({
    deviceId: z.string().min(4),
  }),
  summarize: () => "Unpaired Windows Tally PC connector",
  handler: (ctx, input) => {
    const dev = controlDb()
      .select()
      .from(controlSchema.agentDevices)
      .where(
        and(
          eq(controlSchema.agentDevices.id, input.deviceId),
          eq(controlSchema.agentDevices.workspaceId, ctx.workspaceId)
        )
      )
      .get();

    if (!dev) {
      throw new RslError("RSL-VAL-1001", "Paired Windows PC device not found.");
    }

    const now = Date.now();
    controlDb()
      .update(controlSchema.agentDevices)
      .set({
        status: "revoked",
        revokedAt: now,
      })
      .where(eq(controlSchema.agentDevices.id, dev.id))
      .run();

    return { revoked: true, deviceName: dev.deviceName };
  },
});

export const recordTallyVoucher = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    companyName: z.string().min(2).max(120).default("Primary Tally Company"),
    voucherId: z.string().optional(),
    voucherNumber: z.string().min(1).max(60),
    voucherType: z.enum(["Sales", "Receipt", "Payment", "CreditNote", "DebitNote", "Purchase"]),
    partyName: z.string().min(1).max(120),
    partyPhoneE164: z.string().optional(),
    amountRupees: z.coerce.number().positive(),
    paidAmountRupees: z.coerce.number().min(0).default(0),
    againstBillNumber: z.string().max(64).optional(),
    ledgerAccountName: z.string().max(120).optional(),
    narration: z.string().max(300).optional(),
    voucherDateIso: z.string(),
    dueDateIso: z.string().optional(),
    preventOverwrite: z.boolean().default(false),
    lineItems: z
      .array(
        z.object({
          itemName: z.string().min(1).max(160),
          godownName: z.string().optional(),
          batchName: z.string().optional(),
          hsnCode: z.string().optional(),
          uom: z.string().optional(),
          billedQty: z.coerce.number().positive(),
          actualQty: z.coerce.number().optional(),
          rateRupees: z.coerce.number().min(0),
          discountPct: z.coerce.number().min(0).max(100).optional(),
          gstRatePct: z.coerce.number().min(0).max(100).optional(),
          amountRupees: z.coerce.number().min(0).optional(),
        })
      )
      .optional(),
  }),
  summarize: (input) =>
    `Synced Tally ${input.voucherType} #${input.voucherNumber} for ${input.partyName} (${formatInr(rupeesToPaise(input.amountRupees))})`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();
    const companyGuid = `comp_${input.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

    let company = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();

    if (!company) {
      const compId = newId("tco", ctx.workspaceId);
      db.insert(tenantDataSchema.tallyCompanies)
        .values({
          id: compId,
          companyGuid,
          name: input.companyName.trim(),
          financialYearFrom: "2026-04-01",
          lastAlterId: 1,
          lastSyncedAt: now,
          createdAt: now,
        })
        .run();
      company = db
        .select()
        .from(tenantDataSchema.tallyCompanies)
        .where(eq(tenantDataSchema.tallyCompanies.id, compId))
        .get()!;
    }

    const cleanVoucherNo = input.voucherNumber.trim();
    const cleanPartyName = input.partyName.trim();
    const cleanPhoneE164 = normalizePhoneOrNull(input.partyPhoneE164) ?? (input.partyPhoneE164?.trim() || null);

    const amountPaise = rupeesToPaise(input.amountRupees);
    const isSettlementVoucher =
      input.voucherType === "Receipt" ||
      input.voucherType === "Payment" ||
      input.voucherType === "CreditNote" ||
      input.voucherType === "DebitNote";
    const directPaidPaise = isSettlementVoucher
      ? amountPaise
      : isCashOrBankPartyName(cleanPartyName)
        ? amountPaise
        : Math.min(amountPaise, rupeesToPaise(input.paidAmountRupees));
    const paidAmountPaise = directPaidPaise;

    const paymentStatus =
      isSettlementVoucher || paidAmountPaise >= amountPaise
        ? "paid"
        : paidAmountPaise > 0
          ? "partial"
          : "unpaid";

    const billAllocationsJson =
      isSettlementVoucher && input.againstBillNumber?.trim()
        ? serializeBillAllocationsJson([
            {
              billName: input.againstBillNumber.trim(),
              billType: "Agst Ref",
              amountPaise,
            },
          ])
        : "[]";

    const voucherDate = new Date(input.voucherDateIso).getTime() || now;
    const dueDate = input.dueDateIso
      ? new Date(input.dueDateIso).getTime()
      : voucherDate + 15 * 24 * 60 * 60 * 1000;

    const targetExisting = input.voucherId?.trim()
      ? db
          .select()
          .from(tenantDataSchema.tallyVouchers)
          .where(eq(tenantDataSchema.tallyVouchers.id, input.voucherId.trim()))
          .get()
      : undefined;

    let guid = targetExisting?.guid ?? `vch_${company.id}_${input.voucherType}_${cleanVoucherNo}`;

    if (!targetExisting) {
      const existingByNo = db
        .select()
        .from(tenantDataSchema.tallyVouchers)
        .where(
          and(
            eq(tenantDataSchema.tallyVouchers.companyId, company.id),
            eq(tenantDataSchema.tallyVouchers.voucherType, input.voucherType),
            eq(tenantDataSchema.tallyVouchers.voucherNumber, cleanVoucherNo)
          )
        )
        .get();

      if (existingByNo) {
        if (input.preventOverwrite) {
          const allCompanyVouchers = db
            .select({
              voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
              voucherType: tenantDataSchema.tallyVouchers.voucherType,
            })
            .from(tenantDataSchema.tallyVouchers)
            .where(eq(tenantDataSchema.tallyVouchers.companyId, company.id))
            .all();
          const suggested = suggestNextSequentialVoucherNumber(allCompanyVouchers);
          throw new RslError(
            "RSL-VAL-1001",
            `${input.voucherType} Bill #${cleanVoucherNo} is already saved for '${existingByNo.partyName}'. Enter a new Bill Number (for example ${suggested}) so your saved bill is not overwritten.`
          );
        }

        if (existingByNo.partyName.trim().toLowerCase() !== cleanPartyName.toLowerCase()) {
          // Different party with the same bill number: allocate a distinct canonical GUID so neither bill overwrites the other!
          const partySlug = cleanPartyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .slice(0, 24);
          guid = `vch_${company.id}_${input.voucherType}_${cleanVoucherNo}_${partySlug}_${newId().slice(-6)}`;
        } else {
          guid = existingByNo.guid;
        }
      }
    }

    const contentHash = crypto
      .createHash("sha256")
      .update(`${guid}|${cleanVoucherNo}|${cleanPartyName}|${amountPaise}|${paidAmountPaise}|${paymentStatus}|${voucherDate}`)
      .digest("hex")
      .slice(0, 32);

    const voucherId = targetExisting?.id ?? newId("tvch", ctx.workspaceId);
    const nextAlterId = company.lastAlterId + 1;

    db.update(tenantDataSchema.tallyCompanies)
      .set({ lastAlterId: nextAlterId, lastSyncedAt: now })
      .where(eq(tenantDataSchema.tallyCompanies.id, company.id))
      .run();

    db.insert(tenantDataSchema.tallyVouchers)
      .values({
        id: voucherId,
        guid,
        companyId: company.id,
        voucherNumber: cleanVoucherNo,
        voucherType: input.voucherType,
        partyName: cleanPartyName,
        partyPhoneE164: cleanPhoneE164,
        amountPaise,
        paidAmountPaise,
        directPaidPaise,
        narration: input.narration?.trim() || null,
        ledgerAccountName: input.ledgerAccountName?.trim() || null,
        billAllocationsJson,
        voucherDate,
        dueDate:
          input.voucherType === "Sales" || input.voucherType === "Purchase" ? dueDate : null,
        paymentStatus,
        alterId: nextAlterId,
        contentHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.tallyVouchers.guid,
        set: {
          voucherNumber: cleanVoucherNo,
          voucherType: input.voucherType,
          partyName: cleanPartyName,
          partyPhoneE164: cleanPhoneE164,
          amountPaise,
          paidAmountPaise,
          directPaidPaise,
          narration: input.narration?.trim() || null,
          ledgerAccountName: input.ledgerAccountName?.trim() || null,
          billAllocationsJson,
          voucherDate,
          dueDate:
            input.voucherType === "Sales" || input.voucherType === "Purchase" ? dueDate : null,
          paymentStatus,
          alterId: nextAlterId,
          contentHash,
          updatedAt: now,
        },
      })
      .run();

    upsertWorkspaceTallyParty({
      db,
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      partyName: cleanPartyName,
      voucherType: input.voucherType,
      phoneE164: cleanPhoneE164,
      now,
    });

    reconcileCompanyBillSettlementsAndPartyBalances({
      db,
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      now,
      cancelPaidVoucherOutbox: (paidVch) =>
        cancelPendingOutboxJobsForVoucher(ctx.workspaceId, paidVch),
    });

    db.insert(tenantDataSchema.syncRuns)
      .values({
        id: newId(),
        companyId: company.id,
        source: "manual",
        vouchersUpserted: 1,
        durationMs: 6,
        status: "success",
        createdAt: now,
      })
      .run();

    const savedVoucher = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, guid))
      .get();

    if (savedVoucher && input.lineItems && input.lineItems.length > 0) {
      const normalizedLines: ParsedTallyVoucherLineItem[] = input.lineItems.map((li) => ({
        itemName: li.itemName.trim(),
        godownName: li.godownName?.trim() || "Main Location",
        batchName: li.batchName?.trim() || "Primary Batch",
        hsnCode: li.hsnCode?.trim() || undefined,
        uom: li.uom?.trim() || "PCS",
        billedQty: li.billedQty,
        actualQty: li.actualQty ?? li.billedQty,
        rateRupees: li.rateRupees,
        discountPct: li.discountPct ?? 0,
        gstRatePct: li.gstRatePct ?? 0,
        amountRupees:
          li.amountRupees && li.amountRupees > 0
            ? li.amountRupees
            : Math.round(li.billedQty * li.rateRupees * (1 - (li.discountPct ?? 0) / 100) * 100) / 100,
      }));
      syncVoucherInventoryLineItems({
        db,
        workspaceId: ctx.workspaceId,
        companyId: company.id,
        voucher: savedVoucher,
        lineItems: normalizedLines,
        now,
      });
    }

    let queuedJobs = 0;
    if (savedVoucher && savedVoucher.partyPhoneE164) {
      queuedJobs = await enqueueMatchingAutomationsForVoucher({
        workspaceId: ctx.workspaceId,
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        companyName: company.name,
        voucher: savedVoucher,
      });
    }

    if (savedVoucher) {
      const eventName =
        savedVoucher.voucherType === "Receipt" ? "tally.payment.received" : "tally.bill.created";
      void dispatchWorkspaceWebhookEvent(ctx.workspaceId, eventName, {
        voucherId: savedVoucher.id,
        voucherNumber: savedVoucher.voucherNumber,
        voucherType: savedVoucher.voucherType,
        partyName: savedVoucher.partyName,
        partyPhoneE164: savedVoucher.partyPhoneE164,
        amountPaise: savedVoucher.amountPaise,
        paidAmountPaise: savedVoucher.paidAmountPaise,
        paymentStatus: savedVoucher.paymentStatus,
      }).catch(() => 0);
    }

    return { voucherId: savedVoucher?.id ?? voucherId, guid, queuedJobs };
  },
});

function extractWabaTokenFromEncrypted(encryptedBlob: string): string {
  const decrypted = decryptEnvelope(encryptedBlob);
  try {
    const parsed = JSON.parse(decrypted) as { accessToken?: unknown };
    if (parsed && typeof parsed.accessToken === "string") {
      return parsed.accessToken.trim();
    }
  } catch {
    // Plaintext envelope fallback
  }
  return decrypted.trim();
}

function assertTemplateIsMetaApproved(
  workspaceId: string,
  tmpl: typeof tenantDataSchema.whatsappTemplates.$inferSelect | undefined,
  requestedLabel?: string
): asserts tmpl is typeof tenantDataSchema.whatsappTemplates.$inferSelect {
  if (!tmpl) {
    throw new RslError(
      "RSL-VAL-1001",
      requestedLabel
        ? `WhatsApp template '${requestedLabel}' was not found. Install or create a Meta-approved template under WhatsApp & Templates first.`
        : "Please select a valid Meta-approved WhatsApp message template first."
    );
  }
  if (tmpl.approvalStatus !== "APPROVED") {
    throw new RslError(
      "RSL-VAL-1001",
      `Template '${tmpl.name}' is currently '${tmpl.approvalStatus}'. Only Meta-approved ('APPROVED') WhatsApp templates can be used for automations and reminders.`
    );
  }

  const wabaConn = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, workspaceId),
        eq(controlSchema.connections.provider, "whatsapp")
      )
    )
    .get();

  if (wabaConn && wabaConn.status === "healthy") {
    const token = extractWabaTokenFromEncrypted(wabaConn.encryptedTokens);
    const isSandbox = /^(rsl_sandbox_|sandbox_|test_)/i.test(token);
    if (!isSandbox && !tmpl.metaTemplateId) {
      throw new RslError(
        "RSL-VAL-1001",
        `Template '${tmpl.name}' has not been verified on Meta WhatsApp Manager yet. Submit or sync your templates under WhatsApp & Templates first.`
      );
    }
  }
}

export const saveTallyReminderRule = defineAction({
  key: "tally.rule.created",
  permission: "tally:sync.manage",
  input: z.object({
    name: z.string().min(2).max(120),
    triggerDaysOffset: z.coerce.number().int().min(-30).max(90),
    templateName: z.string().min(2).max(64),
    maxRemindersPerBill: z.coerce.number().int().min(1).max(10).default(3),
  }),
  summarize: (input) => `Saved payment reminder schedule '${input.name}'`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const trimmedTemplate = input.templateName.trim();
    let tmpl = db
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.name, trimmedTemplate))
      .get();
    if (!tmpl) {
      tmpl = db
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .where(eq(tenantDataSchema.whatsappTemplates.id, trimmedTemplate))
        .get();
    }
    assertTemplateIsMetaApproved(ctx.workspaceId, tmpl, trimmedTemplate);

    const id = newId();
    db.insert(tenantDataSchema.reminderRules)
      .values({
        id,
        name: input.name.trim(),
        triggerDaysOffset: input.triggerDaysOffset,
        templateName: tmpl.name,
        maxRemindersPerBill: input.maxRemindersPerBill,
        quietHoursStart: 20,
        quietHoursEnd: 9,
        active: true,
        createdAt: Date.now(),
      })
      .run();
    return { ruleId: id };
  },
});

export const deleteTallyReminderRule = defineAction({
  key: "tally.rule.created",
  permission: "tally:sync.manage",
  input: z.object({
    ruleId: z.string().min(6),
  }),
  summarize: () => "Removed overdue payment reminder schedule",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .delete(tenantDataSchema.reminderRules)
      .where(eq(tenantDataSchema.reminderRules.id, input.ruleId))
      .run();
    return { deleted: true };
  },
});

async function executeQueuedTallyReminderJob(params: {
  workspaceId: string;
  voucherId: string;
  voucherGuid: string;
  ruleId: string;
  ruleName: string;
  templateName: string;
  nextSeq: number;
  dailyGuardKey: string;
  guardKey: string;
  actorId: string;
  correlationId: string;
}): Promise<boolean> {
  const dataDb = tenantDataDb({ workspaceId: params.workspaceId });

  const voucher = dataDb
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.id, params.voucherId))
    .get();
  if (!voucher || !voucher.partyPhoneE164) {
    markSendGuardOutcome({
      workspaceId: params.workspaceId,
      idempotencyKey: params.dailyGuardKey,
      state: "failed",
    });
    return false;
  }

  const balancePaise = Math.max(0, voucher.amountPaise - voucher.paidAmountPaise);
  const dueStr = voucher.dueDate
    ? new Date(voucher.dueDate + 5.5 * 3600_000).toISOString().slice(0, 10)
    : "due";

  const nativePdf = getNativeTallyVoucherPdf(params.workspaceId, voucher.id);
  const signedPdfUrl = nativePdf
    ? buildSignedTallyVoucherPdfUrl({
        workspaceId: params.workspaceId,
        voucherId: voucher.id,
        filename: nativePdf.filename,
      })
    : null;

  const sendRes = await executeWhatsAppTemplateSend({
    workspaceId: params.workspaceId,
    templateIdOrName: params.templateName,
    recipientPhone: voucher.partyPhoneE164,
    recipientName: voucher.partyName,
    variables: {
      partyName: voucher.partyName,
      voucherNumber: voucher.voucherNumber,
      amountFormatted: formatInr(voucher.amountPaise),
      balanceFormatted: formatInr(balancePaise),
      dueDateFormatted: dueStr,
      voucherDateFormatted: formatHumanDate(voucher.voucherDate),
      "1": voucher.partyName,
      "2": voucher.voucherNumber,
      "3": formatInr(balancePaise),
      "4": dueStr,
    },
    idempotencyKey: params.guardKey,
    actorId: params.actorId,
    linkedVoucherGuid: voucher.guid,
    serviceKey: "tally.invoicing",
    correlationId: params.correlationId,
    pdfDocument:
      nativePdf && signedPdfUrl
        ? {
            url: signedPdfUrl,
            filename: nativePdf.filename,
            caption: `Payment reminder — Bill #${voucher.voucherNumber}`,
            sizeBytes: nativePdf.byteSize,
          }
        : undefined,
  });

  if (!sendRes.sent) {
    if (!sendRes.deduplicated) {
      markSendGuardOutcome({
        workspaceId: params.workspaceId,
        idempotencyKey: params.dailyGuardKey,
        state: "failed",
      });
      appendActionLog({
        workspaceId: params.workspaceId,
        actorType: params.actorId.startsWith("wrk") || params.actorId === "system" ? "system" : "user",
        actorId: params.actorId,
        source: "worker",
        action: "tally.reminders.swept",
        outcome: "skipped",
        requestId: params.correlationId,
        correlationId: params.correlationId,
        durationMs: 10,
        summary: `Overdue reminder skipped for Bill #${voucher.voucherNumber} (${sendRes.skippedReason || "provider error"}) — ₹0.00 deducted`,
      });
    }
    return false;
  }

  const now = Date.now();
  dataDb
    .update(tenantDataSchema.tallyVouchers)
    .set({
      remindersSentCount: Math.max(voucher.remindersSentCount + 1, params.nextSeq),
      updatedAt: now,
    })
    .where(eq(tenantDataSchema.tallyVouchers.id, voucher.id))
    .run();

  markSendGuardOutcome({
    workspaceId: params.workspaceId,
    idempotencyKey: params.dailyGuardKey,
    state: "confirmed",
    externalId: sendRes.externalMessageId,
  });

  return true;
}

registerJobProcessor("tally.reminder.dispatch", async (envelope) => {
  const p = envelope.payload as {
    voucherId: string;
    voucherGuid: string;
    ruleId: string;
    ruleName: string;
    templateName: string;
    nextSeq: number;
    dailyGuardKey: string;
    guardKey: string;
  };
  if (!p.voucherId || !p.dailyGuardKey || !p.guardKey) return;
  await executeQueuedTallyReminderJob({
    workspaceId: envelope.tenantId,
    voucherId: p.voucherId,
    voucherGuid: p.voucherGuid,
    ruleId: p.ruleId,
    ruleName: p.ruleName,
    templateName: p.templateName,
    nextSeq: Number(p.nextSeq || 1),
    dailyGuardKey: p.dailyGuardKey,
    guardKey: p.guardKey,
    actorId: envelope.actor.id,
    correlationId: envelope.correlationId,
  });
});

export async function sweepDueTallyPaymentReminders(params: {
  workspaceId: string;
  actorId: string;
  ignoreQuietHours?: boolean;
}): Promise<{
  sentCount: number;
  skippedQuietHours: boolean;
  evaluatedCount: number;
}> {
  const dataDb = tenantDataDb({ workspaceId: params.workspaceId });
  const logsDb = tenantLogsDb({ workspaceId: params.workspaceId });

  const activeRules = dataDb
    .select()
    .from(tenantDataSchema.reminderRules)
    .where(eq(tenantDataSchema.reminderRules.active, true))
    .all();

  if (activeRules.length === 0) {
    return { sentCount: 0, skippedQuietHours: false, evaluatedCount: 0 };
  }

  const now = Date.now();
  const istNow = new Date(now + 5.5 * 3600_000);
  const istHour = istNow.getUTCHours();
  const todayIstIso = istNow.toISOString().slice(0, 10);

  const openVouchers = dataDb
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.voucherType, "Sales"))
    .all()
    .filter(
      (v) =>
        (v.paymentStatus === "unpaid" || v.paymentStatus === "partial") &&
        v.amountPaise > v.paidAmountPaise &&
        Boolean(v.partyPhoneE164) &&
        v.dueDate !== null
    );

  // Never lock daily guards or dispatch reminders when WhatsApp Business Account is disconnected
  const wabaConn = controlDb()
    .select()
    .from(controlSchema.connections)
    .where(
      and(
        eq(controlSchema.connections.workspaceId, params.workspaceId),
        eq(controlSchema.connections.provider, "whatsapp")
      )
    )
    .get();
  if (!wabaConn || wabaConn.status !== "healthy") {
    return {
      sentCount: 0,
      skippedQuietHours: false,
      evaluatedCount: openVouchers.length,
    };
  }
  const wabaToken = extractWabaTokenFromEncrypted(wabaConn.encryptedTokens);
  if (!wabaToken) {
    return {
      sentCount: 0,
      skippedQuietHours: false,
      evaluatedCount: openVouchers.length,
    };
  }
  const isSandboxWaba = /^(rsl_sandbox_|sandbox_|test_)/i.test(wabaToken);

  const allTemplates = dataDb.select().from(tenantDataSchema.whatsappTemplates).all();
  const approvedTemplateByName = new Map(
    allTemplates
      .filter((t) => t.approvalStatus === "APPROVED" && (isSandboxWaba || Boolean(t.metaTemplateId)))
      .map((t) => [t.name, t])
  );

  const suppressions = new Set(
    logsDb
      .select()
      .from(tenantLogsSchema.suppressions)
      .where(eq(tenantLogsSchema.suppressions.channel, "whatsapp"))
      .all()
      .map((s) => s.identifier)
  );

  let enqueuedCount = 0;
  let skippedQuietHours = false;
  let projectedSpendPaise = 0;
  const enqueuedTargets: Array<{ voucherId: string; expectedSeq: number }> = [];

  for (const rule of activeRules) {
    const approvedTmpl = approvedTemplateByName.get(rule.templateName);
    if (!approvedTmpl) {
      continue;
    }
    const unitCostPaise = approvedTmpl.category === "marketing" ? 95 : 85;

    const inQuietHours =
      rule.quietHoursStart > rule.quietHoursEnd
        ? istHour >= rule.quietHoursStart || istHour < rule.quietHoursEnd
        : istHour >= rule.quietHoursStart && istHour < rule.quietHoursEnd;

    if (!params.ignoreQuietHours && inQuietHours) {
      skippedQuietHours = true;
      continue;
    }

    for (const voucher of openVouchers) {
      const phone = voucher.partyPhoneE164!;
      if (suppressions.has(phone)) continue;
      if (voucher.remindersSentCount >= rule.maxRemindersPerBill) continue;

      const daysPastDue = Math.floor((now - (voucher.dueDate ?? now)) / 86_400_000);
      if (daysPastDue < rule.triggerDaysOffset) continue;

      if (!canDebitWalletUsage(getWalletBalancePaise(params.workspaceId) - projectedSpendPaise, unitCostPaise)) {
        break;
      }

      const nextSeq = voucher.remindersSentCount + 1;
      const dailyGuardKey = `${params.workspaceId}:${voucher.guid}:remday:${todayIstIso}`;
      const dailyGuard = reserveSendGuard({
        workspaceId: params.workspaceId,
        idempotencyKey: dailyGuardKey,
        channel: "whatsapp",
        recipient: phone,
      });
      if (!dailyGuard.allowed) continue;

      const guardKey = `${params.workspaceId}:${voucher.guid}:rule:${rule.id}:seq:${nextSeq}`;
      const corr = newEntityId("req", params.workspaceId, now);

      await enqueueJob({
        queue: "reminders",
        jobType: "tally.reminder.dispatch",
        tenantId: params.workspaceId,
        correlationId: corr,
        requestId: corr,
        actorType: params.actorId.startsWith("wrk") || params.actorId === "system" ? "system" : "user",
        actorId: params.actorId,
        idempotencyKey: `rem_outbox:${guardKey}`,
        payload: {
          voucherId: voucher.id,
          voucherGuid: voucher.guid,
          ruleId: rule.id,
          ruleName: rule.name,
          templateName: approvedTmpl.name,
          nextSeq,
          dailyGuardKey,
          guardKey,
        },
      });

      projectedSpendPaise += unitCostPaise;
      enqueuedCount++;
      enqueuedTargets.push({ voucherId: voucher.id, expectedSeq: nextSeq });
    }
  }

  let confirmedSentCount = enqueuedCount;
  if (enqueuedCount > 0 && !isRedisConfigured()) {
    await processDueSqliteOutboxForTenant(params.workspaceId);
    confirmedSentCount = 0;
    for (const target of enqueuedTargets) {
      const updatedVoucher = dataDb
        .select({ remindersSentCount: tenantDataSchema.tallyVouchers.remindersSentCount })
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.id, target.voucherId))
        .get();
      if (updatedVoucher && updatedVoucher.remindersSentCount >= target.expectedSeq) {
        confirmedSentCount++;
      }
    }
  }

  return {
    sentCount: confirmedSentCount,
    skippedQuietHours,
    evaluatedCount: openVouchers.length,
  };
}

export const runDueTallyReminders = defineAction({
  key: "tally.reminders.swept",
  permission: "tally:invoice.send",
  service: "tally.invoicing",
  input: z.object({
    ignoreQuietHours: z.boolean().default(false),
  }),
  summarize: (_in, out?: { sentCount: number }) =>
    `Ran due-date payment reminder check (${out?.sentCount ?? 0} reminder(s) sent)`,
  handler: async (ctx, input) => {
    return sweepDueTallyPaymentReminders({
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId,
      ignoreQuietHours: input.ignoreQuietHours,
    });
  },
});

export const sendTallyBillOnWhatsApp = defineAction({
  key: "tally.invoice.sent",
  permission: "tally:invoice.send",
  input: z.object({
    voucherId: z.string().min(10),
    sendKind: z.enum(["invoice", "reminder"]).default("reminder"),
    templateName: z.string().optional(),
  }),
  summarize: (input) => `Sent Tally ${input.sendKind} on WhatsApp`,
  handler: async (ctx, input) => {
    const dataDb = tenantDataDb(ctx);
    const logsDb = tenantLogsDb(ctx);
    const ctrl = controlDb();

    const voucher = dataDb
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, input.voucherId))
      .get();

    if (!voucher) {
      throw new RslError("RSL-VAL-1001", "Bill not found.");
    }
    if (voucher.paymentStatus === "cancelled") {
      throw new RslError("RSL-VAL-1001", "Cancelled Tally bills cannot be sent as payment demands.");
    }
    if (!voucher.partyPhoneE164) {
      throw new RslError("RSL-VAL-1001", "Add the customer's WhatsApp phone number to this bill first.");
    }

    const suppressed = logsDb
      .select()
      .from(tenantLogsSchema.suppressions)
      .where(
        and(
          eq(tenantLogsSchema.suppressions.channel, "whatsapp"),
          eq(tenantLogsSchema.suppressions.identifier, voucher.partyPhoneE164)
        )
      )
      .get();

    if (suppressed) {
      throw new RslError("RSL-WA-1002");
    }

    const wabaConn = ctrl
      .select()
      .from(controlSchema.connections)
      .where(
        and(
          eq(controlSchema.connections.workspaceId, ctx.workspaceId),
          eq(controlSchema.connections.provider, "whatsapp")
        )
      )
      .get();

    if (!wabaConn || wabaConn.status !== "healthy") {
      throw new RslError(
        "RSL-VAL-1001",
        "Connect your WhatsApp Business Account under Connected Channels before sending Tally bills on WhatsApp (₹0.00 deducted)."
      );
    }

    const wabaToken = extractWabaTokenFromEncrypted(wabaConn.encryptedTokens);
    const isSandboxWaba = /^(rsl_sandbox_|sandbox_|test_)/i.test(wabaToken);

    const allTemplates = dataDb.select().from(tenantDataSchema.whatsappTemplates).all();
    let selectedTemplate: typeof tenantDataSchema.whatsappTemplates.$inferSelect | undefined;

    if (input.templateName?.trim()) {
      const target = input.templateName.trim();
      selectedTemplate = allTemplates.find((t) => t.name === target || t.id === target);
      assertTemplateIsMetaApproved(ctx.workspaceId, selectedTemplate, target);
    } else {
      const preferredNames =
        input.sendKind === "invoice"
          ? ["tally_tax_invoice_pdf", "tally_sales_bill_created"]
          : ["tally_overdue_bill_reminder", "tally_sales_bill_created"];

      const validApproved = allTemplates.filter(
        (t) => t.approvalStatus === "APPROVED" && (isSandboxWaba || Boolean(t.metaTemplateId))
      );

      for (const pref of preferredNames) {
        const match = validApproved.find((t) => t.name === pref);
        if (match) {
          selectedTemplate = match;
          break;
        }
      }
      if (!selectedTemplate) {
        selectedTemplate = validApproved[0];
      }
      if (!selectedTemplate) {
        throw new RslError(
          "RSL-VAL-1001",
          "An approved Meta WhatsApp template is required before sending bills or reminders. Submit and approve a template under WhatsApp & Templates first (₹0.00 deducted)."
        );
      }
    }

    const unitCostPaise = selectedTemplate.category === "marketing" ? 95 : 85;
    const currentBal = getWalletBalancePaise(ctx.workspaceId);
    if (!canDebitWalletUsage(currentBal, unitCostPaise)) {
      throw new RslError(
        "RSL-BILL-1003",
        `Your prepaid wallet balance is ${formatInr(currentBal, { showDecimals: true })} (overdraft allowed down to -₹200.00). Please add funds to your wallet to send this WhatsApp ${input.sendKind}.`
      );
    }

    // Section 17 idempotency key: tenantId + voucherGuid + sendKind (+ reminder sequence)
    const seq = input.sendKind === "invoice" ? 0 : voucher.remindersSentCount + 1;
    const guardKey = `${ctx.workspaceId}:${voucher.guid}:${input.sendKind}:${seq}`;

    const nativePdf = getNativeTallyVoucherPdf(ctx.workspaceId, voucher.id);
    const signedPdfUrl = nativePdf
      ? buildSignedTallyVoucherPdfUrl({
          workspaceId: ctx.workspaceId,
          voucherId: voucher.id,
          filename: nativePdf.filename,
        })
      : null;

    const balancePaise = Math.max(0, voucher.amountPaise - voucher.paidAmountPaise);
    const dueStr = voucher.dueDate ? formatHumanDate(voucher.dueDate) : "due";

    const sendRes = await executeWhatsAppTemplateSend({
      workspaceId: ctx.workspaceId,
      templateIdOrName: selectedTemplate.id,
      recipientPhone: voucher.partyPhoneE164,
      recipientName: voucher.partyName,
      variables: {
        partyName: voucher.partyName,
        voucherNumber: voucher.voucherNumber,
        amountFormatted: formatInr(voucher.amountPaise),
        balanceFormatted: formatInr(balancePaise),
        dueDateFormatted: dueStr,
        voucherDateFormatted: formatHumanDate(voucher.voucherDate),
        "1": voucher.partyName,
        "2": voucher.voucherNumber,
        "3": input.sendKind === "invoice" ? formatInr(voucher.amountPaise) : formatInr(balancePaise),
        "4": dueStr,
      },
      idempotencyKey: guardKey,
      actorId: ctx.actorId,
      linkedVoucherGuid: voucher.guid,
      serviceKey: "tally.invoicing",
      correlationId: ctx.correlationId,
      pdfDocument:
        nativePdf && signedPdfUrl
          ? {
              url: signedPdfUrl,
              filename: nativePdf.filename,
              caption: `Tally ${voucher.voucherType} #${voucher.voucherNumber} (${formatInr(voucher.amountPaise)})`,
              sizeBytes: nativePdf.byteSize,
            }
          : undefined,
    });

    if (sendRes.deduplicated) {
      return { deduplicated: true, attachedTallyPdf: false, pdfFilename: null as string | null };
    }

    if (!sendRes.sent) {
      throw new RslError(
        "RSL-VAL-1001",
        sendRes.skippedReason || "WhatsApp Cloud API could not deliver this bill (₹0.00 deducted)."
      );
    }

    const now = Date.now();
    dataDb
      .update(tenantDataSchema.tallyVouchers)
      .set({
        whatsappInvoiceSentAt: input.sendKind === "invoice" ? now : voucher.whatsappInvoiceSentAt ?? now,
        remindersSentCount:
          input.sendKind === "reminder" ? voucher.remindersSentCount + 1 : voucher.remindersSentCount,
        updatedAt: now,
      })
      .where(eq(tenantDataSchema.tallyVouchers.id, voucher.id))
      .run();

    return {
      deduplicated: false,
      attachedTallyPdf: Boolean(nativePdf),
      pdfFilename: nativePdf?.filename ?? null,
    };
  },
});

function formatTallyXmlDate(ts: number): string {
  // Format strictly in Asia/Kolkata (IST = UTC + 05:30) so early-morning Indian bills never shift to prior day (P1-21)
  const ist = new Date(ts + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatIstIsoDate(ts: number): string {
  return new Date(ts + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function sanitizeCsvField(val: string): string {
  const safe = /^[=+\-@]/.test(val.trimStart()) ? `'${val}` : val;
  return `"${safe.replace(/"/g, '""')}"`;
}

function parseTallyXmlDate(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00Z`;
    return new Date(iso).getTime();
  }
  const monthNames: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  // Handle Tally UniversalDate strings such as "1-Nov-26" or "15-Apr-2026"
  const alphaMatch = trimmed.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (alphaMatch) {
    const day = Number(alphaMatch[1]);
    const monKey = alphaMatch[2]!.slice(0, 3).toLowerCase();
    const rawYear = Number(alphaMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const monIdx = monthNames[monKey];
    if (monIdx !== undefined && day >= 1 && day <= 31) {
      return Date.UTC(year, monIdx, day);
    }
  }
  // Handle Indian DD-MM-YYYY / DD/MM/YYYY strings
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Date.UTC(year, month - 1, day);
    }
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Exports workspace Tally vouchers as a balanced double-entry Tally Prime XML Envelope
 * ready for `Import Data -> Vouchers` in Tally Prime (P0-05, ACT-1.1..3.3).
 */
export function exportTallyVouchersAsXml(workspaceId: string): string {
  const db = tenantDataDb({ workspaceId });
  const vouchers = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .orderBy(desc(tenantDataSchema.tallyVouchers.voucherDate))
    .all();

  const messagesXml = vouchers
    .map((v) => {
      const amountRupees = (Math.abs(v.amountPaise) / 100).toFixed(2);
      const paidRupees = (Math.abs(v.paidAmountPaise) / 100).toFixed(2);
      const dateStr = formatTallyXmlDate(v.voucherDate);
      const tallyVoucherType =
        v.voucherType === "CreditNote"
          ? "Credit Note"
          : v.voucherType === "DebitNote"
            ? "Debit Note"
            : v.voucherType;

      // Tally XML double-entry invariant:
      //   Debit  -> ISDEEMEDPOSITIVE=Yes, AMOUNT = -X.XX
      //   Credit -> ISDEEMEDPOSITIVE=No,  AMOUNT =  X.XX
      //   Sum of AMOUNT across ALLLEDGERENTRIES.LIST = 0.00
      const partyIsDebit =
        v.voucherType === "Sales" || v.voucherType === "Payment" || v.voucherType === "DebitNote";
      const contraLedgerName =
        v.ledgerAccountName?.trim() ||
        (v.voucherType === "Sales"
          ? "Sales Account"
          : v.voucherType === "Receipt" || v.voucherType === "Payment"
            ? "Cash"
            : v.voucherType === "CreditNote"
              ? "Sales Returns"
              : v.voucherType === "DebitNote"
                ? "Purchase Returns"
                : "Purchase Account");

      const partyDeemedPositive = partyIsDebit ? "Yes" : "No";
      const partySignedAmount = partyIsDebit ? `-${amountRupees}` : amountRupees;
      const contraDeemedPositive = partyIsDebit ? "No" : "Yes";
      const contraSignedAmount = partyIsDebit ? amountRupees : `-${amountRupees}`;

      const parsedAllocs = parseBillAllocationsJson(v.billAllocationsJson);
      const billAllocXml =
        parsedAllocs.length > 0
          ? "\n" +
            parsedAllocs
              .map((a) => {
                const aRupees = ((a.amountPaise > 0 ? a.amountPaise : Math.abs(v.amountPaise)) / 100).toFixed(2);
                const signedAllocAmt = partyIsDebit ? `-${aRupees}` : aRupees;
                return `            <BILLALLOCATIONS.LIST>\n              <NAME>${escapeXml(a.billName)}</NAME>\n              <BILLTYPE>${escapeXml(a.billType)}</BILLTYPE>\n              <AMOUNT>${signedAllocAmt}</AMOUNT>\n            </BILLALLOCATIONS.LIST>`;
              })
              .join("\n")
          : "";

      const narrationParts = [`RSL Sync #${v.voucherNumber}`];
      if (v.narration) narrationParts.push(v.narration);
      if (v.partyPhoneE164) narrationParts.push(`Phone: ${v.partyPhoneE164}`);
      if (v.paidAmountPaise > 0) narrationParts.push(`Paid: INR ${paidRupees}`);
      if (v.originalCurrency && v.originalCurrency !== "INR" && v.originalAmountMinor) {
        narrationParts.push(`Forex: ${v.originalCurrency} ${(v.originalAmountMinor / 100).toFixed(2)}`);
      }

      const phoneXml = v.partyPhoneE164
        ? `\n          <PARTYMOBILENO>${escapeXml(v.partyPhoneE164)}</PARTYMOBILENO>`
        : "";

      return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="${escapeXml(v.guid)}" VCHTYPE="${escapeXml(tallyVoucherType)}" ACTION="Create">
          <GUID>${escapeXml(v.guid)}</GUID>
          <DATE>${dateStr}</DATE>
          <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
          <VOUCHERTYPENAME>${escapeXml(tallyVoucherType)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(v.voucherNumber)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>${escapeXml(v.partyName)}</PARTYLEDGERNAME>${phoneXml}
          <NARRATION>${escapeXml(narrationParts.join(" | "))}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(v.partyName)}</LEDGERNAME>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <ISDEEMEDPOSITIVE>${partyDeemedPositive}</ISDEEMEDPOSITIVE>
            <AMOUNT>${partySignedAmount}</AMOUNT>${billAllocXml}
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(contraLedgerName)}</LEDGERNAME>
            <ISPARTYLEDGER>No</ISPARTYLEDGER>
            <ISDEEMEDPOSITIVE>${contraDeemedPositive}</ISDEEMEDPOSITIVE>
            <AMOUNT>${contraSignedAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${messagesXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

export function exportTallyVouchersAsCsv(workspaceId: string): string {
  const db = tenantDataDb({ workspaceId });
  const vouchers = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .orderBy(desc(tenantDataSchema.tallyVouchers.voucherDate))
    .all();

  const header =
    "Id,Guid,VoucherNumber,VoucherType,PartyName,PartyPhone,AmountRupees,PaidAmountRupees,OriginalCurrency,PaymentStatus,VoucherDate,DueDate";
  const lines = vouchers.map((v) => {
    const signedAmt =
      v.voucherType === "CreditNote" ? -(Math.abs(v.amountPaise) / 100) : v.amountPaise / 100;
    return [
      sanitizeCsvField(v.id),
      sanitizeCsvField(v.guid),
      sanitizeCsvField(v.voucherNumber),
      sanitizeCsvField(v.voucherType),
      sanitizeCsvField(v.partyName),
      sanitizeCsvField(v.partyPhoneE164 ?? ""),
      signedAmt.toFixed(2),
      (v.paidAmountPaise / 100).toFixed(2),
      sanitizeCsvField(v.originalCurrency || "INR"),
      sanitizeCsvField(v.paymentStatus),
      formatIstIsoDate(v.voucherDate),
      v.dueDate ? formatIstIsoDate(v.dueDate) : "",
    ].join(",");
  });

  return [header, ...lines].join("\n");
}

function unescapeXml(str: string): string {
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractXmlTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return unescapeXml(m?.[1] ?? "");
}

const DEFAULT_FOREX_RATES_TO_INR: Record<string, number> = {
  USD: 84.5,
  EUR: 91.0,
  GBP: 108.0,
  AED: 23.0,
  SGD: 63.0,
  CAD: 61.0,
  AUD: 55.0,
};

export interface ParsedTallyAmountInfo {
  inrRupees: number;
  originalCurrency: string;
  originalAmountMinor: number | null;
  exchangeRateMicros: number | null;
}

export function parseTallyCurrencyAndAmount(
  raw: string,
  explicitRateRaw?: string
): ParsedTallyAmountInfo {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) {
    return {
      inrRupees: 0,
      originalCurrency: "INR",
      originalAmountMinor: null,
      exchangeRateMicros: null,
    };
  }

  let detectedCurrency = "INR";
  if (/\bUSD\b|US\$|\$/i.test(cleaned)) detectedCurrency = "USD";
  else if (/\bEUR\b|€/i.test(cleaned)) detectedCurrency = "EUR";
  else if (/\bGBP\b|£/i.test(cleaned)) detectedCurrency = "GBP";
  else if (/\bAED\b/i.test(cleaned)) detectedCurrency = "AED";
  else if (/\bSGD\b/i.test(cleaned)) detectedCurrency = "SGD";
  else if (/\bCAD\b/i.test(cleaned)) detectedCurrency = "CAD";
  else if (/\bAUD\b/i.test(cleaned)) detectedCurrency = "AUD";

  // Case 1: Tally multi-currency expression e.g. "-$1500.00 @ ₹84.50/$ = -₹126750.00"
  if (cleaned.includes("=")) {
    const [lhs, rhs] = cleaned.split("=");
    const baseMatch = (rhs ?? "").match(/-?\d+(?:\.\d+)?/);
    const origMatch = (lhs ?? "").split("@")[0]?.match(/-?\d+(?:\.\d+)?/);
    const ratePart = (lhs ?? "").includes("@") ? (lhs ?? "").split("@")[1] : "";
    const rateMatch = (ratePart || explicitRateRaw || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);

    const baseInr = baseMatch ? Math.abs(Number(baseMatch[0])) : 0;
    const origVal = origMatch ? Math.abs(Number(origMatch[0])) : 0;
    const rateVal = rateMatch
      ? Number(rateMatch[0])
      : origVal > 0 && baseInr > 0
        ? baseInr / origVal
        : 0;

    if (baseInr > 0) {
      const currency = detectedCurrency === "INR" && origVal > 0 && Math.abs(baseInr - origVal) > 1 ? "USD" : detectedCurrency;
      return {
        inrRupees: baseInr,
        originalCurrency: currency,
        originalAmountMinor: currency !== "INR" && origVal > 0 ? Math.round(origVal * 100) : null,
        exchangeRateMicros:
          currency !== "INR" && rateVal > 0 ? Math.round(rateVal * 1_000_000) : null,
      };
    }
  }

  // Case 2: Foreign currency with "@ rate" or standalone symbol (e.g. "$1,500.00" or "USD 1500 @ 85.20")
  const primaryMatch = cleaned.split("@")[0]?.match(/-?\d+(?:\.\d+)?/);
  const primaryVal = primaryMatch ? Math.abs(Number(primaryMatch[0])) : 0;
  if (!Number.isFinite(primaryVal) || primaryVal <= 0) {
    return {
      inrRupees: 0,
      originalCurrency: "INR",
      originalAmountMinor: null,
      exchangeRateMicros: null,
    };
  }

  if (detectedCurrency !== "INR") {
    const inlineRatePart = cleaned.includes("@") ? cleaned.split("@")[1] : "";
    const rateMatch = (inlineRatePart || explicitRateRaw || "")
      .replace(/,/g, "")
      .match(/\d+(?:\.\d+)?/);
    const rate =
      rateMatch && Number(rateMatch[0]) > 0
        ? Number(rateMatch[0])
        : DEFAULT_FOREX_RATES_TO_INR[detectedCurrency] ?? 1;
    const inrRupees = Math.round(primaryVal * rate * 100) / 100;
    return {
      inrRupees,
      originalCurrency: detectedCurrency,
      originalAmountMinor: Math.round(primaryVal * 100),
      exchangeRateMicros: Math.round(rate * 1_000_000),
    };
  }

  return {
    inrRupees: primaryVal,
    originalCurrency: "INR",
    originalAmountMinor: null,
    exchangeRateMicros: null,
  };
}

function parseTallyNumericAmount(raw: string, explicitRateRaw?: string): number {
  return parseTallyCurrencyAndAmount(raw, explicitRateRaw).inrRupees;
}

function extractPartyAmountInfoFromVoucherXml(
  block: string,
  partyName: string
): ParsedTallyAmountInfo {
  const explicitRate =
    extractXmlTag(block, "CURRENCYRATE") || extractXmlTag(block, "EXCHANGERATE") || undefined;
  const ledgerBlocks = [
    ...(block.match(/<ALLLEDGERENTRIES\.LIST[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/gi) ?? []),
    ...(block.match(/<LEDGERENTRIES\.LIST[\s\S]*?<\/LEDGERENTRIES\.LIST>/gi) ?? []),
  ];

  if (ledgerBlocks.length > 0) {
    const normalizedParty = partyName.trim().toLowerCase();
    let partyFlagInfo: ParsedTallyAmountInfo | null = null;
    let partyNameMatchInfo: ParsedTallyAmountInfo | null = null;
    let maxLedgerInfo: ParsedTallyAmountInfo | null = null;

    for (const lb of ledgerBlocks) {
      const info = parseTallyCurrencyAndAmount(extractXmlTag(lb, "AMOUNT"), explicitRate);
      if (info.inrRupees <= 0) continue;
      if (!maxLedgerInfo || info.inrRupees > maxLedgerInfo.inrRupees) {
        maxLedgerInfo = info;
      }

      const isParty = /^yes$/i.test(extractXmlTag(lb, "ISPARTYLEDGER"));
      if (isParty && (!partyFlagInfo || info.inrRupees > partyFlagInfo.inrRupees)) {
        partyFlagInfo = info;
      }

      const ledgerName = extractXmlTag(lb, "LEDGERNAME").toLowerCase();
      if (
        normalizedParty &&
        ledgerName === normalizedParty &&
        (!partyNameMatchInfo || info.inrRupees > partyNameMatchInfo.inrRupees)
      ) {
        partyNameMatchInfo = info;
      }
    }

    if (partyFlagInfo) return partyFlagInfo;
    if (partyNameMatchInfo) return partyNameMatchInfo;
    if (maxLedgerInfo) return maxLedgerInfo;
  }

  return parseTallyCurrencyAndAmount(extractXmlTag(block, "AMOUNT"), explicitRate);
}

function parseTallyDueDateOrCreditDays(rawDue: string, voucherDateTs: number): number {
  const trimmed = rawDue.trim();
  if (!trimmed) return voucherDateTs + 15 * 86400_000;
  const daysMatch = trimmed.match(/^(\d{1,4})\s*days?$/i);
  if (daysMatch) {
    return voucherDateTs + Number(daysMatch[1]) * 86400_000;
  }
  if (/^\d{8}$/.test(trimmed)) {
    return parseTallyXmlDate(trimmed);
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : voucherDateTs + 15 * 86400_000;
}

export interface ParsedTallyXmlVoucher {
  guid?: string;
  masterId?: string;
  companyName?: string;
  voucherNumber: string;
  voucherType: TallySuiteVoucherType;
  partyName: string;
  partyParentGroup?: string;
  partyPhone?: string;
  amountRupees: number;
  paidAmountRupees: number;
  hasExplicitPaidAmount?: boolean;
  narration?: string;
  ledgerAccountName?: string;
  billAllocations?: ParsedTallyBillAllocation[];
  originalCurrency?: string;
  originalAmountMinor?: number | null;
  exchangeRateMicros?: number | null;
  voucherDate: number;
  dueDate: number | null;
  alterId?: number;
  isCancelled: boolean;
  isDeleted?: boolean;
  lineItems?: ParsedTallyVoucherLineItem[];
}

function normalizeLedgerParentGroup(
  rawGroup: string | undefined,
  voucherType: TallySuiteVoucherType
): string {
  const trimmed = (rawGroup ?? "").trim();
  if (/creditor/i.test(trimmed)) return "Sundry Creditors";
  if (/debtor/i.test(trimmed)) return "Sundry Debtors";
  if (trimmed) return trimmed;
  return voucherType === "Purchase" || voucherType === "Payment" || voucherType === "DebitNote"
    ? "Sundry Creditors"
    : "Sundry Debtors";
}

function upsertWorkspaceTallyParty(params: {
  db: ReturnType<typeof tenantDataDb>;
  workspaceId: string;
  companyId: string;
  partyName: string;
  voucherType: TallySuiteVoucherType;
  parentGroup?: string;
  phoneE164?: string | null;
  now: number;
}): void {
  const cleanName = params.partyName.trim();
  if (!cleanName || cleanName === "Customer" || cleanName === "Deleted") return;
  if (isCashOrBankPartyName(cleanName)) return;
  const partyGuid = `pty_${params.companyId}_${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60)}`;
  const parentGroup = normalizeLedgerParentGroup(params.parentGroup, params.voucherType);

  params.db
    .insert(tenantDataSchema.tallyParties)
    .values({
      id: newEntityId("tpt", params.workspaceId, params.now),
      partyGuid,
      companyId: params.companyId,
      name: cleanName,
      parentGroup,
      phoneE164: params.phoneE164 ?? null,
      closingBalancePaise: 0,
      updatedAt: params.now,
    })
    .onConflictDoUpdate({
      target: tenantDataSchema.tallyParties.partyGuid,
      set: {
        name: cleanName,
        parentGroup,
        ...(params.phoneE164 ? { phoneE164: params.phoneE164 } : {}),
        updatedAt: params.now,
      },
    })
    .run();

  // Recompute signed closing balance from company vouchers (Sales/Payment/DebitNote +, Receipt/CreditNote/Purchase -)
  const partyVouchers = params.db
    .select({
      voucherType: tenantDataSchema.tallyVouchers.voucherType,
      amountPaise: tenantDataSchema.tallyVouchers.amountPaise,
      paymentStatus: tenantDataSchema.tallyVouchers.paymentStatus,
    })
    .from(tenantDataSchema.tallyVouchers)
    .where(
      and(
        eq(tenantDataSchema.tallyVouchers.companyId, params.companyId),
        eq(tenantDataSchema.tallyVouchers.partyName, cleanName)
      )
    )
    .all();

  let signedBalancePaise = 0;
  for (const pv of partyVouchers) {
    if (pv.paymentStatus === "cancelled") continue;
    if (pv.voucherType === "Sales" || pv.voucherType === "Payment" || pv.voucherType === "DebitNote") {
      signedBalancePaise += pv.amountPaise;
    } else if (
      pv.voucherType === "Receipt" ||
      pv.voucherType === "CreditNote" ||
      pv.voucherType === "Purchase"
    ) {
      signedBalancePaise -= pv.amountPaise;
    }
  }

  params.db
    .update(tenantDataSchema.tallyParties)
    .set({ closingBalancePaise: signedBalancePaise, updatedAt: params.now })
    .where(eq(tenantDataSchema.tallyParties.partyGuid, partyGuid))
    .run();
}

export function parseTallyXmlEnvelope(
  rawXml: string,
  fallbackCompanyName?: string
): {
  vouchers: ParsedTallyXmlVoucher[];
  optionalItems: Array<{ guid: string; companyName?: string }>;
  skippedOptionalCount: number;
  detectedCompanyName: string | null;
  maxAlterId: number;
  hasExplicitDateSpan: boolean;
} {
  const envelopeCompany =
    extractXmlTag(rawXml, "SVCURRENTCOMPANY") ||
    extractXmlTag(rawXml, "COMPANYNAME") ||
    null;
  const hasExplicitDateSpan = /<SVFROMDATE(?:\s|>)/i.test(rawXml);

  // Build Ledger Master phone & parent group lookup (<LEDGER NAME="..."><PARENT>Sundry Debtors</PARENT>...)
  const ledgerPhones = new Map<string, string>();
  const ledgerParents = new Map<string, string>();
  const ledgerBlocks = rawXml.match(/<LEDGER(?:\s[^>]*)?>[\s\S]*?<\/LEDGER>/gi) ?? [];
  for (const lBlock of ledgerBlocks) {
    const attrNameMatch = lBlock.match(/<LEDGER[^>]*\bNAME="([^"]+)"/i);
    const lName = unescapeXml(attrNameMatch?.[1] ?? extractXmlTag(lBlock, "NAME")).toLowerCase();
    const lMobile =
      extractXmlTag(lBlock, "LEDGERMOBILE") ||
      extractXmlTag(lBlock, "LEDGERPHONE") ||
      extractXmlTag(lBlock, "EMAILCC");
    const lParent = extractXmlTag(lBlock, "PARENT");
    if (lName && lMobile) {
      ledgerPhones.set(lName, lMobile);
    }
    if (lName && lParent) {
      ledgerParents.set(lName, lParent);
    }
  }

  const vouchers: ParsedTallyXmlVoucher[] = [];
  const optionalItems: Array<{ guid: string; companyName?: string }> = [];
  let skippedOptionalCount = 0;
  let maxAlterId = 0;

  const voucherBlocks = rawXml.match(/<VOUCHER(?:\s[^>]*)?>[\s\S]*?<\/VOUCHER>/gi) ?? [];
  for (const block of voucherBlocks) {
    // Strip nested Ledger/Inventory sub-lists so voucher-level tags (GUID, MASTERID, VOUCHERNUMBER, DATE)
    // can never be shadowed by inner allocation tags.
    const headerOnlyBlock = block
      .replace(/<ALLLEDGERENTRIES\.LIST[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/gi, "")
      .replace(/<LEDGERENTRIES\.LIST[\s\S]*?<\/LEDGERENTRIES\.LIST>/gi, "")
      .replace(/<ALLINVENTORYENTRIES\.LIST[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi, "")
      .replace(/<INVENTORYENTRIES\.LIST[\s\S]*?<\/INVENTORYENTRIES\.LIST>/gi, "");

    const vchCompany =
      extractXmlTag(headerOnlyBlock, "SVCURRENTCOMPANY") ||
      extractXmlTag(headerOnlyBlock, "COMPANYNAME") ||
      envelopeCompany ||
      fallbackCompanyName;
    const remoteIdAttrMatch = headerOnlyBlock.match(/<VOUCHER[^>]*\bREMOTEID="([^"]+)"/i);
    const rawGuid =
      extractXmlTag(headerOnlyBlock, "GUID") || unescapeXml(remoteIdAttrMatch?.[1] ?? "");

    const isOptional = /^yes$/i.test(extractXmlTag(headerOnlyBlock, "ISOPTIONAL"));
    if (isOptional) {
      skippedOptionalCount++;
      if (rawGuid) {
        optionalItems.push({ guid: rawGuid, companyName: vchCompany || undefined });
      }
      continue;
    }

    const actionAttrMatch = headerOnlyBlock.match(/<VOUCHER[^>]*\bACTION="([^"]+)"/i);
    const vchTypeAttrMatch = headerOnlyBlock.match(/<VOUCHER[^>]*\bVCHTYPE="([^"]+)"/i);
    const isDeleted =
      /^yes$/i.test(extractXmlTag(headerOnlyBlock, "ISDELETED")) ||
      /^delete$/i.test(actionAttrMatch?.[1] ?? "");
    const isCancelled = !isDeleted && /^yes$/i.test(extractXmlTag(headerOnlyBlock, "ISCANCELLED"));

    const rawMasterId = extractXmlTag(headerOnlyBlock, "MASTERID").replace(/\D/g, "");
    const cleanMasterId = rawMasterId.replace(/^0+$/, "");
    const rawVchNoTag = extractXmlTag(headerOnlyBlock, "VOUCHERNUMBER");
    const vchNo =
      rawVchNoTag ||
      (cleanMasterId
        ? `VCH-${cleanMasterId}`
        : rawGuid
          ? `VCH-${rawGuid.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`
          : `VCH-${vouchers.length + 1}`);
    const rawBaseType =
      extractXmlTag(headerOnlyBlock, "RSLBASEVCHTYPE") || extractXmlTag(headerOnlyBlock, "PARENT");
    const rawTypeName =
      extractXmlTag(headerOnlyBlock, "VOUCHERTYPENAME") ||
      unescapeXml(vchTypeAttrMatch?.[1] ?? "Sales");
    const rawType = rawBaseType || rawTypeName;
    if (
      /^(contra|journal|memorandum|reversing\s*journal|stock\s*journal|physical\s*stock|sales\s*order|purchase\s*order|delivery\s*note|receipt\s*note|rejections\s*in|rejections\s*out)$/i.test(
        rawType.trim()
      )
    ) {
      continue;
    }
    const voucherType = normalizeVoucherType(rawTypeName, rawBaseType);

    const rawExtractedParty =
      extractXmlTag(headerOnlyBlock, "PARTYLEDGERNAME") ||
      extractXmlTag(headerOnlyBlock, "PARTYNAME") ||
      extractXmlTag(headerOnlyBlock, "BASICBUYERNAME");
    const partyName = rawExtractedParty || "Customer";

    const narration = extractXmlTag(headerOnlyBlock, "NARRATION");
    const narrationPhoneMatch = narration.match(/Phone:\s*(\+?\d[\d\s-]{8,15})/i);
    const narrationPaidMatch = narration.match(/Paid:\s*(?:INR|Rs\.?|₹)?\s*([\d,.]+)/i);

    const partyPhone =
      extractXmlTag(headerOnlyBlock, "RSLPARTYPHONE") ||
      extractXmlTag(headerOnlyBlock, "LEDGERMOBILE") ||
      extractXmlTag(headerOnlyBlock, "PARTYMOBILENO") ||
      extractXmlTag(headerOnlyBlock, "PARTYPHONE") ||
      narrationPhoneMatch?.[1]?.trim() ||
      ledgerPhones.get(partyName.toLowerCase()) ||
      "";

    const lineItems = extractInventoryLineItemsFromVoucherXml(block);
    const amountInfo = extractPartyAmountInfoFromVoucherXml(block, partyName);
    const inventorySumRupees =
      lineItems.length > 0
        ? Math.round(lineItems.reduce((acc, li) => acc + li.amountRupees, 0) * 100) / 100
        : 0;
    const amountRupees = amountInfo.inrRupees > 0 ? amountInfo.inrRupees : inventorySumRupees;
    if (amountRupees <= 0 && !isCancelled && !isDeleted) continue;

    const { allocations: xmlBillAllocations, contraLedgerName } =
      extractBillAllocationsFromVoucherXml(block, partyName);
    const rslAgstBill = extractXmlTag(headerOnlyBlock, "RSLAGSTBILL").trim();
    if (
      rslAgstBill &&
      !xmlBillAllocations.some((a) => a.billName.toLowerCase() === rslAgstBill.toLowerCase())
    ) {
      xmlBillAllocations.push({
        billName: rslAgstBill,
        billType: "Agst Ref",
        amountPaise: rupeesToPaise(amountRupees),
      });
    }

    const rawPaidTag =
      extractXmlTag(headerOnlyBlock, "RSLPAIDAMOUNT") || narrationPaidMatch?.[1]?.trim() || "";
    const rawPaid = parseTallyNumericAmount(rawPaidTag);
    const isCashCounter = isCashOrBankPartyName(partyName);
    const isSettlementVoucher =
      voucherType === "Receipt" ||
      voucherType === "Payment" ||
      voucherType === "CreditNote" ||
      voucherType === "DebitNote";
    const paidAmountRupees = isSettlementVoucher
      ? amountRupees
      : isCashCounter
        ? amountRupees
        : rawPaid > 0
          ? Math.min(amountRupees, rawPaid)
          : 0;

    const rawDate =
      extractXmlTag(headerOnlyBlock, "DATE") || extractXmlTag(headerOnlyBlock, "EFFECTIVEDATE");
    const vDate = rawDate ? parseTallyXmlDate(rawDate) : Date.now();
    const rawDue =
      extractXmlTag(headerOnlyBlock, "BASICDUEDATEOFPYMT") ||
      extractXmlTag(headerOnlyBlock, "DUEDATE");
    const dueDate =
      voucherType === "Sales" || voucherType === "Purchase"
        ? parseTallyDueDateOrCreditDays(rawDue, vDate)
        : null;

    const alterIdNum = Number(extractXmlTag(headerOnlyBlock, "ALTERID").replace(/\D/g, "") || 0);
    if (Number.isFinite(alterIdNum) && alterIdNum > maxAlterId) {
      maxAlterId = alterIdNum;
    }
    const rawParentGroup =
      extractXmlTag(headerOnlyBlock, "RSLPARTYGROUP") || ledgerParents.get(partyName.toLowerCase());

    vouchers.push({
      guid: rawGuid || undefined,
      masterId: cleanMasterId || undefined,
      companyName: vchCompany || undefined,
      voucherNumber: vchNo,
      voucherType,
      partyName,
      partyParentGroup: rawParentGroup || undefined,
      partyPhone: partyPhone || undefined,
      amountRupees,
      paidAmountRupees,
      hasExplicitPaidAmount: rawPaid > 0 || isCashCounter,
      narration: narration || undefined,
      ledgerAccountName: contraLedgerName || undefined,
      billAllocations: xmlBillAllocations.length > 0 ? xmlBillAllocations : undefined,
      originalCurrency: amountInfo.originalCurrency,
      originalAmountMinor: amountInfo.originalAmountMinor,
      exchangeRateMicros: amountInfo.exchangeRateMicros,
      voucherDate: vDate,
      dueDate,
      alterId: alterIdNum > 0 ? alterIdNum : undefined,
      isCancelled,
      isDeleted,
      lineItems: lineItems.length > 0 ? lineItems : undefined,
    });
  }

  return {
    vouchers,
    optionalItems,
    skippedOptionalCount,
    detectedCompanyName: envelopeCompany,
    maxAlterId,
    hasExplicitDateSpan,
  };
}

/**
 * Bulk Import Tally Bills, Receipts, Payments & Inventory Masters from either Tally Prime XML (<ENVELOPE>/<VOUCHER>/<STOCKITEM>)
 * or Accounting CSV!
 */
export const bulkImportTallyData = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    companyName: z.string().min(2).max(120).default("Primary Tally Company"),
    format: z.enum(["tally_xml", "csv"]),
    rawContent: z.string().min(10),
  }),
  summarize: (input, out?: { importedCount: number }) =>
    `Imported ${out?.importedCount ?? 0} Tally vouchers via ${input.format.toUpperCase()}`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();

    interface ParsedVoucher {
      guid?: string;
      masterId?: string;
      voucherNumber: string;
      voucherType: TallySuiteVoucherType;
      partyName: string;
      partyParentGroup?: string;
      partyPhone?: string;
      amountPaise: number;
      paidAmountPaise: number;
      directPaidPaise: number;
      narration?: string | null;
      ledgerAccountName?: string | null;
      billAllocationsJson?: string;
      originalCurrency: string;
      originalAmountMinor: number | null;
      exchangeRateMicros: number | null;
      voucherDate: number;
      dueDate: number | null;
      alterId?: number;
      isCancelled?: boolean;
      lineItems?: ParsedTallyVoucherLineItem[];
    }

    const parsedItems: ParsedVoucher[] = [];
    let resolvedCompanyName = input.companyName.trim();
    let mastersImportedTotal = 0;
    let stockItemsUpserted = 0;

    if (input.format === "tally_xml") {
      if (/<(?:STOCKITEM|GODOWN|LEDGER|BILL)(?:\s|>)/i.test(input.rawContent)) {
        const routing = getTallyCompanyRoutingConfig(ctx.workspaceId);
        const mastersOut = ingestTallyMastersXmlForWorkspace({
          workspaceId: ctx.workspaceId,
          rawXml: input.rawContent,
          fallbackCompanyName: resolvedCompanyName,
          isCompanyAllowed: (c) => isTallyCompanyAllowed(c, routing),
        });
        stockItemsUpserted = mastersOut.stockItemsUpserted;
        mastersImportedTotal =
          mastersOut.stockItemsUpserted +
          mastersOut.godownsUpserted +
          mastersOut.partiesUpserted +
          mastersOut.billClearancesApplied;
      }

      const xmlResult = parseTallyXmlEnvelope(input.rawContent, resolvedCompanyName);
      if (
        xmlResult.detectedCompanyName &&
        resolvedCompanyName === "Primary Tally Company"
      ) {
        resolvedCompanyName = xmlResult.detectedCompanyName;
      }
      for (const v of xmlResult.vouchers) {
        const amtPaise = Math.max(0, rupeesToPaise(v.amountRupees));
        const paidPaise = Math.max(0, rupeesToPaise(v.paidAmountRupees));
        parsedItems.push({
          guid: v.guid,
          masterId: v.masterId,
          voucherNumber: v.voucherNumber,
          voucherType: v.voucherType,
          partyName: v.partyName,
          partyParentGroup: v.partyParentGroup,
          partyPhone: normalizePhoneOrNull(v.partyPhone) ?? v.partyPhone,
          amountPaise: amtPaise,
          paidAmountPaise: paidPaise,
          directPaidPaise: paidPaise,
          narration: v.narration ?? null,
          ledgerAccountName: v.ledgerAccountName ?? null,
          billAllocationsJson: serializeBillAllocationsJson(v.billAllocations ?? []),
          originalCurrency: v.originalCurrency ?? "INR",
          originalAmountMinor: v.originalAmountMinor ?? null,
          exchangeRateMicros: v.exchangeRateMicros ?? null,
          voucherDate: v.voucherDate,
          dueDate: v.dueDate,
          alterId: v.alterId,
          isCancelled: v.isCancelled,
          lineItems: v.lineItems,
        });
      }
    } else {
      const lines = input.rawContent
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        throw new RslError("RSL-VAL-1001", "CSV must contain a header row and at least one bill row.");
      }

      const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
      const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

      const iNo = idx(["vouchernumber", "billno", "invoice", "number"]);
      const iType = idx(["vouchertype", "type"]);
      const iParty = idx(["party", "customer", "client", "name"]);
      const iPhone = idx(["phone", "mobile", "whatsapp"]);
      const iAmt = idx(["amount", "total", "billamount"]);
      const iPaid = idx(["paid", "received"]);
      const iDate = idx(["voucherdate", "billdate", "date"]);
      const iDue = idx(["duedate", "due"]);
      const iAgst = idx(["againstbill", "agstref", "refbill", "against"]);
      const iNarr = idx(["narration", "remarks", "notes"]);
      const iAcct = idx(["ledgeraccount", "bank", "cashledger", "account"]);

      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r]!
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());

        const voucherNumber = (iNo >= 0 ? cols[iNo] : undefined) || `ROW-${r}`;
        const rawType = (iType >= 0 ? cols[iType] : undefined) || "Sales";
        const voucherType = normalizeVoucherType(rawType);
        const partyName = (iParty >= 0 ? cols[iParty] : undefined) || "Customer";
        const rawPhone = iPhone >= 0 ? cols[iPhone] : undefined;
        const partyPhone = normalizePhoneOrNull(rawPhone) ?? rawPhone;
        const amtInfo = parseTallyCurrencyAndAmount((iAmt >= 0 ? cols[iAmt] : "0") || "0");
        const amountPaise = rupeesToPaise(amtInfo.inrRupees);
        if (amountPaise <= 0) continue;

        const paidRaw = iPaid >= 0 ? parseTallyNumericAmount(cols[iPaid] || "0") : 0;
        const isSettlementVch =
          voucherType === "Receipt" ||
          voucherType === "Payment" ||
          voucherType === "CreditNote" ||
          voucherType === "DebitNote";
        const paidAmountPaise = isSettlementVch
          ? amountPaise
          : isCashOrBankPartyName(partyName)
            ? amountPaise
            : Math.min(amountPaise, rupeesToPaise(paidRaw));

        const vDate = iDate >= 0 && cols[iDate] ? new Date(cols[iDate]!).getTime() || now : now;
        const dDate =
          iDue >= 0 && cols[iDue]
            ? new Date(cols[iDue]!).getTime() || vDate + 15 * 86400_000
            : vDate + 15 * 86400_000;
        const agstBill = iAgst >= 0 && cols[iAgst] ? cols[iAgst]!.trim() : "";
        const narration = iNarr >= 0 && cols[iNarr] ? cols[iNarr]!.trim() : null;
        const ledgerAccountName = iAcct >= 0 && cols[iAcct] ? cols[iAcct]!.trim() : null;

        parsedItems.push({
          voucherNumber,
          voucherType,
          partyName,
          partyPhone: partyPhone || undefined,
          amountPaise,
          paidAmountPaise,
          directPaidPaise: paidAmountPaise,
          narration,
          ledgerAccountName,
          billAllocationsJson: agstBill
            ? serializeBillAllocationsJson([
                { billName: agstBill, billType: "Agst Ref", amountPaise },
              ])
            : "[]",
          originalCurrency: amtInfo.originalCurrency,
          originalAmountMinor: amtInfo.originalAmountMinor,
          exchangeRateMicros: amtInfo.exchangeRateMicros,
          voucherDate: vDate,
          dueDate: voucherType === "Sales" || voucherType === "Purchase" ? dDate : null,
        });
      }
    }

    if (parsedItems.length === 0) {
      if (mastersImportedTotal > 0) {
        return { importedCount: mastersImportedTotal, stockItemsUpserted };
      }
      throw new RslError(
        "RSL-VAL-1001",
        `No valid bills or receipts were found in the uploaded ${input.format === "tally_xml" ? "Tally XML" : "CSV"}.`
      );
    }

    const companyGuid = `comp_${resolvedCompanyName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    let company = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();

    if (!company) {
      const compId = newId("tco", ctx.workspaceId);
      db.insert(tenantDataSchema.tallyCompanies)
        .values({
          id: compId,
          companyGuid,
          name: resolvedCompanyName,
          financialYearFrom: "2026-04-01",
          lastAlterId: 1,
          lastSyncedAt: now,
          createdAt: now,
        })
        .run();
      company = db
        .select()
        .from(tenantDataSchema.tallyCompanies)
        .where(eq(tenantDataSchema.tallyCompanies.id, compId))
        .get()!;
    }

    const tx = db.$client.transaction(() => {
      for (const item of parsedItems) {
        const { guid, collidedWithDifferentBillNumber } = resolveCanonicalVoucherGuid(
          db,
          company.id,
          companyGuid,
          item.guid,
          item.masterId,
          item.voucherType,
          item.voucherNumber,
          item.partyName,
          { isAuthoritativeSource: true }
        );
        const effectiveMasterId = collidedWithDifferentBillNumber ? null : (item.masterId ?? null);
        const paymentStatus = item.isCancelled
          ? "cancelled"
          : item.voucherType === "Receipt" ||
              item.voucherType === "Payment" ||
              item.voucherType === "CreditNote" ||
              item.voucherType === "DebitNote" ||
              item.paidAmountPaise >= item.amountPaise
            ? "paid"
            : item.paidAmountPaise > 0
              ? "partial"
              : "unpaid";
        const contentHash = crypto
          .createHash("sha256")
          .update(`${guid}|${item.voucherNumber}|${item.partyName}|${item.amountPaise}|${item.paidAmountPaise}|${paymentStatus}`)
          .digest("hex")
          .slice(0, 32);

        db.insert(tenantDataSchema.tallyVouchers)
          .values({
            id: newId("tvch", ctx.workspaceId),
            guid,
            masterId: effectiveMasterId,
            companyId: company.id,
            voucherNumber: item.voucherNumber,
            voucherType: item.voucherType,
            partyName: item.partyName,
            partyPhoneE164: item.partyPhone || null,
            amountPaise: item.amountPaise,
            paidAmountPaise: item.paidAmountPaise,
            directPaidPaise: item.directPaidPaise,
            narration: item.narration ?? null,
            ledgerAccountName: item.ledgerAccountName ?? null,
            billAllocationsJson: item.billAllocationsJson ?? "[]",
            originalCurrency: item.originalCurrency,
            originalAmountMinor: item.originalAmountMinor,
            exchangeRateMicros: item.exchangeRateMicros,
            voucherDate: item.voucherDate,
            dueDate: item.dueDate,
            paymentStatus,
            alterId: item.alterId ?? 1,
            contentHash,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: tenantDataSchema.tallyVouchers.guid,
            set: {
              ...(effectiveMasterId ? { masterId: effectiveMasterId } : {}),
              voucherNumber: item.voucherNumber,
              voucherType: item.voucherType,
              partyName: item.partyName,
              amountPaise: item.amountPaise,
              paidAmountPaise: item.paidAmountPaise,
              directPaidPaise: item.directPaidPaise,
              narration: item.narration ?? null,
              ledgerAccountName: item.ledgerAccountName ?? null,
              billAllocationsJson: item.billAllocationsJson ?? "[]",
              originalCurrency: item.originalCurrency,
              originalAmountMinor: item.originalAmountMinor,
              exchangeRateMicros: item.exchangeRateMicros,
              voucherDate: item.voucherDate,
              dueDate: item.dueDate,
              paymentStatus,
              partyPhoneE164: item.partyPhone || null,
              alterId: item.alterId ?? 1,
              contentHash,
              updatedAt: now,
            },
          })
          .run();

        upsertWorkspaceTallyParty({
          db,
          workspaceId: ctx.workspaceId,
          companyId: company.id,
          partyName: item.partyName,
          voucherType: item.voucherType,
          parentGroup: item.partyParentGroup,
          phoneE164: normalizePhoneOrNull(item.partyPhone),
          now,
        });

        if (item.lineItems && item.lineItems.length > 0) {
          const savedRow = db
            .select()
            .from(tenantDataSchema.tallyVouchers)
            .where(eq(tenantDataSchema.tallyVouchers.guid, guid))
            .get();
          if (savedRow) {
            syncVoucherInventoryLineItems({
              db,
              workspaceId: ctx.workspaceId,
              companyId: company.id,
              voucher: savedRow,
              lineItems: item.lineItems,
              now,
            });
          }
        }
      }

      reconcileCompanyBillSettlementsAndPartyBalances({
        db,
        workspaceId: ctx.workspaceId,
        companyId: company.id,
        now,
        cancelPaidVoucherOutbox: (v) => cancelPendingOutboxJobsForVoucher(ctx.workspaceId, v),
      });

      db.insert(tenantDataSchema.syncRuns)
        .values({
          id: newId("sync", ctx.workspaceId),
          companyId: company.id,
          source: input.format,
          vouchersUpserted: parsedItems.length,
          durationMs: 12,
          status: "success",
          createdAt: now,
        })
        .run();
    });

    tx.immediate();
    return { importedCount: parsedItems.length, stockItemsUpserted };
  },
});

// =========================================================================
// Tally-to-WhatsApp Webhook, TDL Add-On & Worker Automation Engine
// =========================================================================

function formatHumanDate(ts: number | null): string {
  if (!ts) return "On Receipt";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function enqueueMatchingAutomationsForVoucher(params: {
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  correlationId: string;
  companyName: string;
  voucher: typeof tenantDataSchema.tallyVouchers.$inferSelect;
}): Promise<number> {
  if (!params.voucher.partyPhoneE164) return 0;

  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const activeRules = db
    .select()
    .from(tenantDataSchema.tallyAutomationRules)
    .where(eq(tenantDataSchema.tallyAutomationRules.active, true))
    .all();

  let queued = 0;
  const balancePaise = Math.max(0, params.voucher.amountPaise - params.voucher.paidAmountPaise);
  const variables: Record<string, string> = {
    partyName: params.voucher.partyName,
    voucherNumber: params.voucher.voucherNumber,
    amountFormatted: formatInr(params.voucher.amountPaise),
    balanceFormatted: formatInr(balancePaise),
    dueDateFormatted: formatHumanDate(params.voucher.dueDate),
    voucherDateFormatted: formatHumanDate(params.voucher.voucherDate),
    companyName: params.companyName,
    "1": params.voucher.partyName,
    "2": params.voucher.voucherNumber,
    "3": formatInr(params.voucher.amountPaise),
    "4":
      params.voucher.voucherType === "Sales"
        ? formatHumanDate(params.voucher.dueDate)
        : formatHumanDate(params.voucher.voucherDate),
  };

  for (const rule of activeRules) {
    const matchesEvent = rule.triggerEvent === "All" || rule.triggerEvent === params.voucher.voucherType;
    const matchesAmount = params.voucher.amountPaise >= rule.minAmountPaise;
    if (!matchesEvent || !matchesAmount) continue;

    await enqueueJob({
      queue: "outbound.whatsapp",
      jobType: "tally.whatsapp.automation",
      tenantId: params.workspaceId,
      correlationId: params.correlationId,
      requestId: params.correlationId,
      actorType: params.actorType,
      actorId: params.actorId,
      idempotencyKey: `tally_auto:${params.workspaceId}:${rule.id}:${params.voucher.guid}:${params.voucher.contentHash}`,
      delayMs: Math.max(0, rule.delaySeconds * 1000),
      payload: {
        voucherId: params.voucher.id,
        voucherGuid: params.voucher.guid,
        ruleId: rule.id,
        templateId: rule.templateId,
        templateName: rule.templateName,
        recipientPhone: params.voucher.partyPhoneE164,
        recipientName: params.voucher.partyName,
        variables,
      },
    });
    queued++;
  }

  return queued;
}

export const rotateTallyWebhookToken = defineAction({
  key: "tally.webhook.rotated",
  permission: "tally:sync.manage",
  input: z.object({}),
  summarize: () => "Generated a fresh Tally Prime webhook token",
  handler: (ctx) => {
    const endpoint = getOrCreateTallyWebhookEndpoint(ctx.workspaceId);
    const nextToken = `tlwh_${crypto.randomBytes(18).toString("hex")}`;
    const now = Date.now();

    controlDb()
      .update(controlSchema.tallyWebhookEndpoints)
      .set({
        webhookToken: nextToken,
        updatedAt: now,
      })
      .where(eq(controlSchema.tallyWebhookEndpoints.id, endpoint.id))
      .run();

    return { webhookToken: nextToken };
  },
});

export const createTallyAutomationRule = defineAction({
  key: "tally.rule.created",
  permission: "tally:sync.manage",
  input: z.object({
    name: z.string().min(2).max(120),
    triggerEvent: z.enum([
      "Sales",
      "Receipt",
      "Payment",
      "CreditNote",
      "DebitNote",
      "Purchase",
      "All",
    ]),
    templateId: z.string().min(6),
    minAmountRupees: z.coerce.number().min(0).default(0),
    delaySeconds: z.coerce.number().int().min(0).max(3600).default(0),
  }),
  summarize: (input) => `Enabled automatic WhatsApp rule '${input.name}' for Tally ${input.triggerEvent} bills`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const tmpl = db
      .select()
      .from(tenantDataSchema.whatsappTemplates)
      .where(eq(tenantDataSchema.whatsappTemplates.id, input.templateId))
      .get();

    assertTemplateIsMetaApproved(ctx.workspaceId, tmpl);

    const now = Date.now();
    const id = newEntityId("taut", ctx.workspaceId, now);
    db.insert(tenantDataSchema.tallyAutomationRules)
      .values({
        id,
        name: input.name.trim(),
        triggerEvent: input.triggerEvent,
        templateId: tmpl.id,
        templateName: tmpl.name,
        minAmountPaise: rupeesToPaise(input.minAmountRupees),
        delaySeconds: input.delaySeconds,
        active: true,
        triggeredCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { ruleId: id };
  },
});

export const toggleTallyAutomationRule = defineAction({
  key: "tally.rule.created",
  permission: "tally:sync.manage",
  input: z.object({
    ruleId: z.string().min(6),
    active: z.boolean(),
  }),
  summarize: (input) => `${input.active ? "Turned on" : "Paused"} Tally WhatsApp automation rule`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    if (input.active) {
      const rule = db
        .select()
        .from(tenantDataSchema.tallyAutomationRules)
        .where(eq(tenantDataSchema.tallyAutomationRules.id, input.ruleId))
        .get();
      if (!rule) {
        throw new RslError("RSL-VAL-1001", "Automation rule not found.");
      }
      const tmpl = db
        .select()
        .from(tenantDataSchema.whatsappTemplates)
        .where(eq(tenantDataSchema.whatsappTemplates.id, rule.templateId))
        .get();
      assertTemplateIsMetaApproved(ctx.workspaceId, tmpl, rule.templateName);
    }
    db.update(tenantDataSchema.tallyAutomationRules)
      .set({
        active: input.active,
        updatedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.tallyAutomationRules.id, input.ruleId))
      .run();
    return { updated: true };
  },
});

export const deleteTallyAutomationRule = defineAction({
  key: "tally.rule.created",
  permission: "tally:sync.manage",
  input: z.object({
    ruleId: z.string().min(6),
  }),
  summarize: () => "Removed Tally WhatsApp automation rule",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .delete(tenantDataSchema.tallyAutomationRules)
      .where(eq(tenantDataSchema.tallyAutomationRules.id, input.ruleId))
      .run();
    return { deleted: true };
  },
});

export function generateTallyPrimeTdlAddOn(params: {
  workspaceName: string;
  webhookUrl: string;
  webhookToken?: string;
  allowedCompanyNames?: string[];
  namespaceTag?: string;
}): string {
  // Support clean endpoint URL + X-Tally-Webhook-Token header, while preserving query fallback.
  // Also normalize http://localhost -> http://127.0.0.1 so tally.exe WinHTTP never hits Windows IPv6 [::1] issues.
  let cleanEndpoint = params.webhookUrl.trim();
  let extractedToken = params.webhookToken?.trim() ?? "";

  try {
    const parsedUrl = new URL(cleanEndpoint);
    if (!extractedToken && parsedUrl.searchParams.get("token")) {
      extractedToken = parsedUrl.searchParams.get("token")!.trim();
    }
    if (parsedUrl.hostname.toLowerCase() === "localhost") {
      parsedUrl.hostname = "127.0.0.1";
    }
    parsedUrl.searchParams.delete("token");
    parsedUrl.searchParams.delete("mode");
    cleanEndpoint = parsedUrl.toString().replace(/\/$/, "");
  } catch {
    // Keep raw URL if non-standard
  }

  const postUrl = extractedToken
    ? `${cleanEndpoint}?token=${encodeURIComponent(extractedToken)}`
    : cleanEndpoint;
  const pingUrl = extractedToken
    ? `${cleanEndpoint}?mode=ping&token=${encodeURIComponent(extractedToken)}`
    : `${cleanEndpoint}?mode=ping`;
  const reconcileUrl = extractedToken
    ? `${cleanEndpoint}?mode=reconcile&token=${encodeURIComponent(extractedToken)}`
    : `${cleanEndpoint}?mode=reconcile`;
  const mastersUrl = extractedToken
    ? `${cleanEndpoint}?mode=masters&token=${encodeURIComponent(extractedToken)}`
    : `${cleanEndpoint}?mode=masters`;

  const tokenHeaderLine = extractedToken
    ? `\n    Header          : "X-Tally-Webhook-Token: ${extractedToken}"`
    : "";

  const safeBizName =
    params.workspaceName.replace(/[^\x20-\x7E]/g, "").replace(/["\r\n]/g, "").trim() ||
    "Business Workspace";
  const cleanNs = (params.namespaceTag ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
  const p = cleanNs ? `RSL_${cleanNs}_` : "RSL";
  const brandSyncTitle = buildTallyDisplayBrandTitle(params.workspaceName);
  const tdlFilename = buildWorkspaceTdlFilename(params.workspaceName, {
    isolatedSlug: cleanNs ? params.namespaceTag : undefined,
  });

  const cleanedAllowedCompanies = (params.allowedCompanyNames ?? [])
    .map((c) => c.replace(/[^\x20-\x7E]/g, "").replace(/["\r\n]/g, "").trim())
    .filter((c) => c.length > 0);

  const activeCompanyFilterExpr =
    cleanedAllowedCompanies.length > 0
      ? cleanedAllowedCompanies.map((c) => `(##SVCurrentCompany = "${c}")`).join(" Or ")
      : "Yes";
  const collectionCompanyFilterExpr =
    cleanedAllowedCompanies.length > 0
      ? cleanedAllowedCompanies.map((c) => `($Name = "${c}")`).join(" Or ")
      : "Yes";
  const companyScopeComment =
    cleanedAllowedCompanies.length > 0
      ? `Selected Companies Only (${cleanedAllowedCompanies.join(", ")})`
      : "All Open Tally Companies (Automatic Multi-Company Sync)";

  const menuTestTitle = cleanNs
    ? `${brandSyncTitle} - Test`
    : `${brandSyncTitle} - Connection Test`;
  const menuSyncTitle = cleanNs
    ? `${brandSyncTitle} - Sync All`
    : `${brandSyncTitle} - Sync All Now`;

  const isLocalEndpoint = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(cleanEndpoint);
  const unreachableMsg = isLocalEndpoint
    ? `Could not reach ${cleanEndpoint}. Ensure your local RapidShift Labs server is running on port 4500.`
    : `Could not reach ${cleanEndpoint}. Ensure *.tally.rapidshiftlabs.in HTTPS is reachable and tally.exe is allowed through Windows Firewall.`;

  const voucherDeleteCancelFormLines = cleanNs
    ? ""
    : `\n    Replace : Key : BottomToolBarBtn3_Delete : ${p}VchDeleteKey\n    Replace : Key : BottomToolBarBtn4_Cancel : ${p}VchCancelKey`;

  const voucherDeleteCancelDefinitions = cleanNs
    ? ""
    : `
[Key: ${p}VchDeleteKey]
    Key      : Alt+D
    Title    : "Delete"
    Inactive : Not $$InAlterMode
    Action   : Call : ${p}HandleVoucherDelete

[Key: ${p}VchCancelKey]
    Key      : Alt+X
    Title    : "Cancel"
    Inactive : (Not $$InAlterMode) Or $IsCancelled
    Action   : Call : ${p}HandleVoucherCancel

[Function: ${p}HandleVoucherDelete]
    Variable : DGuid       : String  : ""
    Variable : DMasterId   : String  : ""
    Variable : DCompany    : String  : ""
    Variable : DVchNo      : String  : ""
    Variable : DVchType    : String  : ""
    Variable : DBaseType   : String  : ""
    Variable : DShouldSync : Logical : No
    Variable : DProgSub    : String  : ""
    Variable : DRespStatus : String  : ""
    01 : Set : DGuid       : $GUID
    02 : Set : DMasterId   : @@${p}FormMasterIdStr
    03 : Set : DCompany    : ##SVCurrentCompany
    04 : Set : DVchNo      : $VoucherNumber
    05 : Set : DVchType    : $VoucherTypeName
    06 : Set : DBaseType   : @@${p}FormBaseTypeStr
    07 : Set : DShouldSync : @@${p}IsTargetVch And @@${p}IsAllowedActiveComp
    08 : Query Box : "Delete ?" : Yes : No
    09 : If : $$LastResult
    10 :     Delete Target
    11 :     If : ##DShouldSync And (Not (##DGuid = ""))
    12 :         Set : ${p}VGuid       : ##DGuid
    13 :         Set : ${p}VMasterId   : ##DMasterId
    14 :         Set : ${p}VAlterId    : "0"
    15 :         Set : ${p}VCompany    : ##DCompany
    16 :         Set : ${p}VVchNo      : ##DVchNo
    17 :         Set : ${p}VVchType    : ##DVchType
    18 :         Set : ${p}VBaseType   : ##DBaseType
    19 :         Set : ${p}VParty      : "Deleted"
    20 :         Set : ${p}VPartyGroup : ""
    21 :         Set : ${p}VPhone      : ""
    22 :         Set : ${p}VAmount     : "0"
    23 :         Set : ${p}VDate       : ""
    24 :         Set : ${p}VDueDate    : ""
    25 :         Set : ${p}VAgstBill   : ""
    26 :         Set : ${p}VNarration  : ""
    27 :         Set : ${p}VCancelled  : "No"
    28 :         Set : ${p}VDeleted     : "Yes"
    29 :         Set : ${p}VOptional    : "No"
    30 :         Set : ${p}VInAlter     : "No"
    31 :         Set : ${p}VSyncBatch   : ""
    32 :         Set : ${p}VItemsPacked : ""
    33 :         Set : ${p}VBillsPacked : ""
    34 :         Set : DProgSub : "Removing deleted " + ##DVchType + " #" + ##DVchNo
    35 :         Start Progress : 1 : "${brandSyncTitle}" : ##DCompany : ##DProgSub
    36 :         Show Progress  : 0
    37 :         Walk Collection : ${p}CloudVoucherPost
    38 :             Set : DRespStatus : $RSLOkStatus
    39 :         End Walk
    40 :         Show Progress  : 1
    41 :         End Progress
    42 :     End If
    43 : End If
    44 : Return

[Function: ${p}HandleVoucherCancel]
    Variable : CGuid       : String  : ""
    Variable : CMasterId   : String  : ""
    Variable : CAlterId    : String  : ""
    Variable : CCompany    : String  : ""
    Variable : CVchNo      : String  : ""
    Variable : CVchType    : String  : ""
    Variable : CBaseType   : String  : ""
    Variable : CParty      : String  : ""
    Variable : CPhone      : String  : ""
    Variable : CAmount     : String  : "0"
    Variable : CDate       : String  : ""
    Variable : CShouldSync : Logical : No
    Variable : CProgSub    : String  : ""
    Variable : CRespStatus : String  : ""
    01 : Set : CGuid       : $GUID
    02 : Set : CMasterId   : @@${p}FormMasterIdStr
    03 : Set : CAlterId    : @@${p}FormAlterIdStr
    04 : Set : CCompany    : ##SVCurrentCompany
    05 : Set : CVchNo      : $VoucherNumber
    06 : Set : CVchType    : $VoucherTypeName
    07 : Set : CBaseType   : @@${p}FormBaseTypeStr
    08 : Set : CParty      : $PartyLedgerName
    09 : Set : CPhone      : @@${p}PartyPhoneExpr
    10 : Set : CAmount     : @@${p}FormAmountStr
    11 : Set : CDate       : @@${p}FormDateStr
    12 : Set : CShouldSync : @@${p}IsTargetVch And @@${p}IsAllowedActiveComp
    13 : Query Box : "Cancel ?" : Yes : No
    14 : If : $$LastResult
    15 :     Cancel Object
    16 :     If : ##CShouldSync And (Not (##CGuid = ""))
    17 :         Set : ${p}VGuid        : ##CGuid
    18 :         Set : ${p}VMasterId    : ##CMasterId
    19 :         Set : ${p}VAlterId     : ##CAlterId
    20 :         Set : ${p}VCompany     : ##CCompany
    21 :         Set : ${p}VVchNo       : ##CVchNo
    22 :         Set : ${p}VVchType     : ##CVchType
    23 :         Set : ${p}VBaseType    : ##CBaseType
    24 :         Set : ${p}VParty       : ##CParty
    25 :         Set : ${p}VPartyGroup  : ""
    26 :         Set : ${p}VPhone       : ##CPhone
    27 :         Set : ${p}VAmount      : ##CAmount
    28 :         Set : ${p}VDate        : ##CDate
    29 :         Set : ${p}VDueDate     : ""
    30 :         Set : ${p}VAgstBill    : ""
    31 :         Set : ${p}VNarration   : ""
    32 :         Set : ${p}VCancelled   : "Yes"
    33 :         Set : ${p}VDeleted     : "No"
    34 :         Set : ${p}VOptional    : "No"
    35 :         Set : ${p}VInAlter     : "No"
    36 :         Set : ${p}VSyncBatch   : ""
    37 :         Set : ${p}VItemsPacked : ""
    38 :         Set : ${p}VBillsPacked : ""
    39 :         Set : CProgSub : "Syncing cancelled " + ##CVchType + " #" + ##CVchNo
    40 :         Start Progress : 1 : "${brandSyncTitle}" : ##CCompany : ##CProgSub
    41 :         Show Progress  : 0
    42 :         Walk Collection : ${p}CloudVoucherPost
    43 :             Set : CRespStatus : $RSLOkStatus
    44 :         End Walk
    45 :         Show Progress  : 1
    46 :         End Progress
    47 :     End If
    48 : End If
    49 : Return
`;

  return `;; ============================================================================
;; ${brandSyncTitle} - Tally Prime All-in-One Cloud Sync Add-On (v2.9)
;; Business Workspace : ${safeBizName}
;; Recommended File   : ${tdlFilename}
;; Cloud Endpoint     : ${cleanEndpoint}
;; Company Scope      : ${companyScopeComment}
;;
;; ALL-IN-ONE TALLY SUITE COVERAGE (v2.9):
;;   - Bills & Vouchers (Ctrl+A) -> Sales, Purchase, Receipt, Payment, Credit Note, Debit Note
;;                                  + Itemized Line Items + Bill-Wise Settlements (Zero Overwrite!)
;;   - Products / Stock Items    -> Instant real-time import on Create/Alter Stock Item or Alt+C
;;   - Client & Supplier Ledgers -> Instant real-time import on Create/Alter Sundry Debtor/Creditor
;;   - Multi-Company Detection   -> Detects & syncs ALL open Tally companies (even 0-bill companies)
;;   - Delete (Alt+D) / Cancel   -> Instantly removes or cancels bill & restores stock/settlements
;;   - OTA Manifest              -> ${cleanEndpoint}?mode=tdl-manifest
;;
;; SETUP IN TALLY PRIME (Release 2.0 / 3.0 / 4.0 / 5.0+):
;;   1. Copy/overwrite this file to your TDL folder
;;      (for example C:\\RSL\\${tdlFilename}).
;;   2. Press F1 (Help) -> TDLs & Add-Ons -> F4 (Manage Local TDLs)
;;   3. Set "Load selected TDL files on startup" = Yes
;;   4. Select ${tdlFilename} and press Ctrl+A to reload (or restart Tally)
;;   5. On Gateway of Tally:
;;        - Click "${menuTestTitle}" to verify & register open companies
;;        - Click "${menuSyncTitle}" to sync all Companies, Products, Ledgers & Bills!
;; ============================================================================

[#Menu: Gateway of Tally]
    Add : Key Item : Before : @@locQuit : "${menuTestTitle}" : ${cleanNs ? "T" : "Y"} : Call : ${p}TestCloudHandshake
    Add : Key Item : Before : @@locQuit : "${menuSyncTitle}" : ${cleanNs ? "S" : "Z"} : Call : ${p}SyncExistingVouchers

[Variable: ${p}OpenCompsPipe]
    Type        : String
    Persistent  : No

[Variable: ${p}VPendingPost]
    Type        : Logical
    Persistent  : No

[Variable: ${p}VGuid]
    Type        : String
    Persistent  : No

[Variable: ${p}VMasterId]
    Type        : String
    Persistent  : No

[Variable: ${p}VAlterId]
    Type        : String
    Persistent  : No

[Variable: ${p}VCompany]
    Type        : String
    Persistent  : No

[Variable: ${p}VVchNo]
    Type        : String
    Persistent  : No

[Variable: ${p}VVchType]
    Type        : String
    Persistent  : No

[Variable: ${p}VBaseType]
    Type        : String
    Persistent  : No

[Variable: ${p}VParty]
    Type        : String
    Persistent  : No

[Variable: ${p}VPartyGroup]
    Type        : String
    Persistent  : No

[Variable: ${p}VPhone]
    Type        : String
    Persistent  : No

[Variable: ${p}VAmount]
    Type        : String
    Persistent  : No

[Variable: ${p}VDate]
    Type        : String
    Persistent  : No

[Variable: ${p}VDueDate]
    Type        : String
    Persistent  : No

[Variable: ${p}VAgstBill]
    Type        : String
    Persistent  : No

[Variable: ${p}VNarration]
    Type        : String
    Persistent  : No

[Variable: ${p}VCancelled]
    Type        : String
    Persistent  : No

[Variable: ${p}VDeleted]
    Type        : String
    Persistent  : No

[Variable: ${p}VOptional]
    Type        : String
    Persistent  : No

[Variable: ${p}VInAlter]
    Type        : String
    Persistent  : No

[Variable: ${p}VSyncBatch]
    Type        : String
    Persistent  : No

[Variable: ${p}VItemsPacked]
    Type        : String
    Persistent  : No

[Variable: ${p}VBillsPacked]
    Type        : String
    Persistent  : No

[Variable: ${p}SPendingPost]
    Type        : Logical
    Persistent  : No

[Variable: ${p}SGuid]
    Type        : String
    Persistent  : No

[Variable: ${p}SMasterId]
    Type        : String
    Persistent  : No

[Variable: ${p}SAlterId]
    Type        : String
    Persistent  : No

[Variable: ${p}SCompany]
    Type        : String
    Persistent  : No

[Variable: ${p}SName]
    Type        : String
    Persistent  : No

[Variable: ${p}SGroup]
    Type        : String
    Persistent  : No

[Variable: ${p}SCategory]
    Type        : String
    Persistent  : No

[Variable: ${p}SUom]
    Type        : String
    Persistent  : No

[Variable: ${p}SPartNo]
    Type        : String
    Persistent  : No

[Variable: ${p}SHsn]
    Type        : String
    Persistent  : No

[Variable: ${p}SGstRate]
    Type        : String
    Persistent  : No

[Variable: ${p}SSellPrice]
    Type        : String
    Persistent  : No

[Variable: ${p}SCostPrice]
    Type        : String
    Persistent  : No

[Variable: ${p}SOpenQty]
    Type        : String
    Persistent  : No

[Variable: ${p}SOpenVal]
    Type        : String
    Persistent  : No

[Variable: ${p}SCloseQty]
    Type        : String
    Persistent  : No

[Variable: ${p}SCloseRate]
    Type        : String
    Persistent  : No

[Variable: ${p}SCloseVal]
    Type        : String
    Persistent  : No

[Variable: ${p}SReorder]
    Type        : String
    Persistent  : No

[Variable: ${p}LPendingPost]
    Type        : Logical
    Persistent  : No

[Variable: ${p}LGuid]
    Type        : String
    Persistent  : No

[Variable: ${p}LCompany]
    Type        : String
    Persistent  : No

[Variable: ${p}LName]
    Type        : String
    Persistent  : No

[Variable: ${p}LGroup]
    Type        : String
    Persistent  : No

[Variable: ${p}LPhone]
    Type        : String
    Persistent  : No

[Variable: ${p}LEmail]
    Type        : String
    Persistent  : No

[Variable: ${p}LGstin]
    Type        : String
    Persistent  : No

[Variable: ${p}LPan]
    Type        : String
    Persistent  : No

[Variable: ${p}LContact]
    Type        : String
    Persistent  : No

[Variable: ${p}LState]
    Type        : String
    Persistent  : No

[Variable: ${p}LPincode]
    Type        : String
    Persistent  : No

[Variable: ${p}LCreditLimit]
    Type        : String
    Persistent  : No

[Variable: ${p}LCreditDays]
    Type        : String
    Persistent  : No

[Variable: ${p}LOpenBal]
    Type        : String
    Persistent  : No

[Variable: ${p}LCloseBal]
    Type        : String
    Persistent  : No

[System: Variable]
    ${p}OpenCompsPipe : ""
    ${p}VPendingPost  : No
    ${p}VGuid         : ""
    ${p}VMasterId     : ""
    ${p}VAlterId      : ""
    ${p}VCompany      : ""
    ${p}VVchNo        : ""
    ${p}VVchType      : ""
    ${p}VBaseType     : ""
    ${p}VParty        : ""
    ${p}VPartyGroup   : ""
    ${p}VPhone        : ""
    ${p}VAmount       : "0"
    ${p}VDate         : ""
    ${p}VDueDate      : ""
    ${p}VAgstBill     : ""
    ${p}VNarration    : ""
    ${p}VCancelled    : "No"
    ${p}VDeleted      : "No"
    ${p}VOptional     : "No"
    ${p}VInAlter      : "No"
    ${p}VSyncBatch    : ""
    ${p}VItemsPacked  : ""
    ${p}VBillsPacked  : ""
    ${p}SPendingPost  : No
    ${p}SGuid         : ""
    ${p}SMasterId     : ""
    ${p}SAlterId      : ""
    ${p}SCompany      : ""
    ${p}SName         : ""
    ${p}SGroup        : ""
    ${p}SCategory     : ""
    ${p}SUom          : ""
    ${p}SPartNo       : ""
    ${p}SHsn          : ""
    ${p}SGstRate      : ""
    ${p}SSellPrice    : ""
    ${p}SCostPrice    : ""
    ${p}SOpenQty      : ""
    ${p}SOpenVal      : ""
    ${p}SCloseQty     : ""
    ${p}SCloseRate    : ""
    ${p}SCloseVal     : ""
    ${p}SReorder      : ""
    ${p}LPendingPost  : No
    ${p}LGuid         : ""
    ${p}LCompany      : ""
    ${p}LName         : ""
    ${p}LGroup        : ""
    ${p}LPhone        : ""
    ${p}LEmail        : ""
    ${p}LGstin        : ""
    ${p}LPan          : ""
    ${p}LContact      : ""
    ${p}LState        : ""
    ${p}LPincode      : ""
    ${p}LCreditLimit  : ""
    ${p}LCreditDays   : ""
    ${p}LOpenBal      : ""
    ${p}LCloseBal     : ""

[System: Formula]
    ${p}FromDateFormula           : $$Date:"1-Apr-2000"
    ${p}ToDateFormula             : $$Date:"31-Mar-2099"
    ${p}BaseTypeName              : $Parent:VoucherType:$VoucherTypeName
    ${p}IsTargetVch               : ($VoucherTypeName = "Sales") Or ($VoucherTypeName = "Receipt") Or ($VoucherTypeName = "Payment") Or ($VoucherTypeName = "Credit Note") Or ($VoucherTypeName = "Debit Note") Or ($VoucherTypeName = "Purchase") Or (@@${p}BaseTypeName = "Sales") Or (@@${p}BaseTypeName = "Receipt") Or (@@${p}BaseTypeName = "Payment") Or (@@${p}BaseTypeName = "Credit Note") Or (@@${p}BaseTypeName = "Debit Note") Or (@@${p}BaseTypeName = "Purchase")
    ${p}IsAllowedActiveComp       : ${activeCompanyFilterExpr}
    ${p}IsAllowedCompObj          : ${collectionCompanyFilterExpr}
    ${p}ShouldPostOnSave          : (($$InCreateMode And (Not $IsOptional) And (Not $$IsEmpty:$PartyLedgerName)) Or $$InAlterMode) And @@${p}IsTargetVch And @@${p}IsAllowedActiveComp
    ${p}SyncableSavedVoucher      : (Not $IsOptional) And ((Not $$IsEmpty:$PartyLedgerName) Or $IsCancelled) And @@${p}IsTargetVch
    ${p}MatchesJustSavedVch       : ($VoucherTypeName = ##${p}VVchType) And ($PartyLedgerName = ##${p}VParty) And (Not $IsOptional)
    ${p}CurMasterNumFormula       : $$Number:$MasterID
    ${p}HasNonEmptyVchNo          : Not ($$IsEmpty:$VoucherNumber)
    ${p}IsExactVchNoMatch         : (Not (##${p}VVchNo = "")) And ($VoucherNumber = ##${p}VVchNo)
    ${p}MatchesCurrentPostVch     : (##${p}VDeleted = "No") And (##${p}VCancelled = "No") And (Not (##${p}VGuid = "")) And ($GUID = ##${p}VGuid)
    ${p}HasNonEmptyItemName       : Not ($$IsEmpty:$RSLItemName)
    ${p}HasNonEmptyBillName       : Not ($$IsEmpty:$RSLBillName)
    ${p}PartyPhoneExpr            : If Not $$IsEmpty:($LedgerMobile:Ledger:$PartyLedgerName) Then $LedgerMobile:Ledger:$PartyLedgerName Else (If Not $$IsEmpty:$PartyMobileNo Then $PartyMobileNo Else $LedgerPhone:Ledger:$PartyLedgerName)
    ${p}PartyGroupExpr            : $Parent:Ledger:$PartyLedgerName
    ${p}AgstBillLed1              : $LedgerEntries[1].BillAllocations[1].Name
    ${p}AgstBillAll1              : $AllLedgerEntries[1].BillAllocations[1].Name
    ${p}FormAgstBillStr           : If Not $$IsEmpty:@@${p}AgstBillLed1 Then @@${p}AgstBillLed1 Else @@${p}AgstBillAll1
    ${p}FormNarrationStr          : $Narration
    ${p}IsPartyLedLine            : $IsPartyLedger Or ($LedgerName = $PartyLedgerName)
    ${p}AmtFilteredParty          : $$Number:($$Abs:($$FilterValue:$Amount:AllLedgerEntries:1:${p}IsPartyLedLine))
    ${p}AmtPartyLed               : $$Number:($$Abs:$LedgerEntries[1].Amount)
    ${p}AmtAllLed                 : $$Number:($$Abs:$AllLedgerEntries[1].Amount)
    ${p}AmtRoot                   : $$Number:($$Abs:$Amount)
    ${p}AmtInventory              : $$Number:($$Abs:($$CollAmtTotal:InventoryEntries:$Amount))
    ${p}BestAmountNum             : If @@${p}AmtFilteredParty > 0 Then @@${p}AmtFilteredParty Else (If @@${p}AmtPartyLed > 0 Then @@${p}AmtPartyLed Else (If @@${p}AmtAllLed > 0 Then @@${p}AmtAllLed Else (If @@${p}AmtRoot > 0 Then @@${p}AmtRoot Else @@${p}AmtInventory)))
    ${p}FormMasterIdStr           : $$String:$MasterID
    ${p}FormAlterIdStr            : $$String:$AlterID
    ${p}FormBaseTypeStr           : $Parent:VoucherType:$VoucherTypeName
    ${p}FormAmountStr             : $$String:@@${p}BestAmountNum
    ${p}FormDateStr               : $$String:$Date:UniversalDate
    ${p}FormDueDateStr            : $$String:$BasicDueDateOfPymt
    ${p}FormCancelledStr          : If $IsCancelled Then "Yes" Else "No"
    ${p}FormOptionalStr           : If $IsOptional Then "Yes" Else "No"
    ${p}FormInAlterStr            : If $$InAlterMode Then "Yes" Else "No"
    ${p}CompStartDateStr          : $$String:$StartingFrom:UniversalDate
    ${p}ShouldPostStockOnSave     : (Not $$IsEmpty:$Name) And @@${p}IsAllowedActiveComp
    ${p}StockHsnStr               : If Not $$IsEmpty:($HSNDetails[Last].HSNCode) Then $HSNDetails[Last].HSNCode Else $GSTDetails[Last].HSNCode
    ${p}StockGstRateStr           : $$String:($GSTDetails[Last].StatewiseDetails[1].RateDetails[3].GSTRate)
    ${p}StockSellPriceStr         : If Not $$IsEmpty:($StandardPriceList[Last].Rate) Then ($$String:($StandardPriceList[Last].Rate)) Else ($$String:$StandardPrice)
    ${p}StockCostPriceStr         : If Not $$IsEmpty:($StandardCostList[Last].Rate) Then ($$String:($StandardCostList[Last].Rate)) Else ($$String:$StandardCost)
    ${p}StockOpenQtyStr           : $$String:$OpeningBalance
    ${p}StockOpenValStr           : $$String:($$Abs:$OpeningValue)
    ${p}StockCloseQtyStr          : $$String:$ClosingBalance
    ${p}StockCloseRateStr         : $$String:$ClosingRate
    ${p}StockCloseValStr          : $$String:($$Abs:$ClosingValue)
    ${p}StockReorderStr           : $$String:$ReorderBase
    ${p}SavedStockGuidFormula     : $GUID:StockItem:##${p}SName
    ${p}SavedStockMasterIdFormula : $$String:($MasterID:StockItem:##${p}SName)
    ${p}SavedStockAlterIdFormula  : $$String:($AlterID:StockItem:##${p}SName)
    ${p}SavedStockCloseQtyFormula : $$String:($ClosingBalance:StockItem:##${p}SName)
    ${p}SavedStockCloseValFormula : $$String:($$Abs:($ClosingValue:StockItem:##${p}SName))
    ${p}IsCreditorGroupExpr       : ($Parent = $$GroupSundryCreditors) Or ($$IsBelongsTo:$$GroupSundryCreditors) Or ($Parent:Group:$Parent = $$GroupSundryCreditors)
    ${p}IsDebtorGroupExpr         : ($Parent = $$GroupSundryDebtors) Or ($$IsBelongsTo:$$GroupSundryDebtors) Or ($Parent:Group:$Parent = $$GroupSundryDebtors)
    ${p}IsPartyParentGroup        : @@${p}IsDebtorGroupExpr Or @@${p}IsCreditorGroupExpr
    ${p}ShouldPostLedgerOnSave    : (Not $$IsEmpty:$Name) And @@${p}IsPartyParentGroup And @@${p}IsAllowedActiveComp
    ${p}LedgerRoleGroupStr        : If @@${p}IsCreditorGroupExpr Then "Sundry Creditors" Else "Sundry Debtors"
    ${p}LedgerPhoneDirectStr      : If Not $$IsEmpty:$LedgerMobile Then $LedgerMobile Else $LedgerPhone
    ${p}LedgerGstinStr            : If Not $$IsEmpty:$PartyGSTIN Then $PartyGSTIN Else $GSTIN
    ${p}LedgerStateStr            : If Not $$IsEmpty:$LedStateName Then $LedStateName Else $StateName
    ${p}LedgerCreditLimitStr      : $$String:($$Abs:$CreditLimit)
    ${p}LedgerCreditDaysStr       : $$String:$BillCreditPeriod
    ${p}LedOpenSignedNum          : If $$IsDr:$OpeningBalance Then ($$Number:($$Abs:$OpeningBalance)) Else (0 - ($$Number:($$Abs:$OpeningBalance)))
    ${p}LedCloseSignedNum         : If $$IsDr:$ClosingBalance Then ($$Number:($$Abs:$ClosingBalance)) Else (0 - ($$Number:($$Abs:$ClosingBalance)))
    ${p}LedgerOpenSignedStr       : $$String:@@${p}LedOpenSignedNum
    ${p}LedgerCloseSignedStr      : $$String:@@${p}LedCloseSignedNum
    ${p}SavedLedgerGuidFormula    : $GUID:Ledger:##${p}LName
    ${p}SavedLedCloseSignedNum    : If $$IsDr:($ClosingBalance:Ledger:##${p}LName) Then ($$Number:($$Abs:($ClosingBalance:Ledger:##${p}LName))) Else (0 - ($$Number:($$Abs:($ClosingBalance:Ledger:##${p}LName))))
    ${p}SavedLedgerCloseSignedStr : $$String:@@${p}SavedLedCloseSignedNum
    ${p}OpenCompCountFormula      : $$NumItems:${p}OpenCompaniesColl
    ${p}CompVchTotalFormula       : $$NumItems:${p}ExistingVouchersColl
    ${p}CompStockTotalFormula     : $$NumItems:${p}ExistingStockItemsColl
    ${p}CompLedTotalFormula       : $$NumItems:${p}ExistingPartyLedgersColl
    ${p}CompGodownTotalFormula    : $$NumItems:${p}ExistingGodownsColl
    ${p}CompIdxStrFormula         : $$String:##RSLCompIdx
    ${p}SyncBatchFormula          : "b_" + ##RSLCompIdxStr + "_" + ($$String:$$MachineDate:UniversalDate) + "_" + ($$String:$$MachineTime)
    ${p}RecDeletedNumFormula      : ##RSLDeletedTotal + ($$Number:##RSLRecDeletedStr)
    ${p}SyncedCountFormula        : $$String:##RSLSyncedCount
    ${p}SyncedStockCountFormula   : $$String:##RSLStockSyncedTotal
    ${p}SyncedLedCountFormula     : $$String:##RSLLedSyncedTotal
    ${p}FailedCountFormula        : $$String:##RSLFailedCount
    ${p}DeletedTotalFormula       : $$String:##RSLDeletedTotal

[#Form: Voucher]
    Add : On : Form Accept : @@${p}ShouldPostOnSave : Call : ${p}CaptureVoucherBeforeAccept
    Add : On : Form Accept : Yes : Form Accept
    Add : On : Form Accept : ##${p}VPendingPost : Call : ${p}PostCapturedVoucherAfterAccept${voucherDeleteCancelFormLines}
${voucherDeleteCancelDefinitions}
[Function: ${p}CaptureVoucherBeforeAccept]
    01 : Set : ${p}VGuid        : $GUID
    02 : Set : ${p}VMasterId    : @@${p}FormMasterIdStr
    03 : Set : ${p}VAlterId     : @@${p}FormAlterIdStr
    04 : Set : ${p}VCompany     : ##SVCurrentCompany
    05 : Set : ${p}VVchNo       : $VoucherNumber
    06 : Set : ${p}VVchType     : $VoucherTypeName
    07 : Set : ${p}VBaseType    : @@${p}FormBaseTypeStr
    08 : Set : ${p}VParty       : $PartyLedgerName
    09 : Set : ${p}VPartyGroup  : @@${p}PartyGroupExpr
    10 : Set : ${p}VPhone       : @@${p}PartyPhoneExpr
    11 : Set : ${p}VAmount      : @@${p}FormAmountStr
    12 : Set : ${p}VDate        : @@${p}FormDateStr
    13 : Set : ${p}VDueDate     : @@${p}FormDueDateStr
    14 : Set : ${p}VAgstBill    : @@${p}FormAgstBillStr
    15 : Set : ${p}VNarration   : @@${p}FormNarrationStr
    16 : Set : ${p}VCancelled   : @@${p}FormCancelledStr
    17 : Set : ${p}VDeleted     : "No"
    18 : Set : ${p}VOptional    : @@${p}FormOptionalStr
    19 : Set : ${p}VInAlter     : @@${p}FormInAlterStr
    20 : Set : ${p}VSyncBatch   : ""
    21 : Set : ${p}VItemsPacked : ""
    22 : Set : ${p}VBillsPacked : ""
    23 : Set : ${p}VPendingPost : Yes
    24 : Return

[Function: ${p}PackSavedVoucherSubLines]
    01 : Set : ${p}VItemsPacked : ""
    02 : Set : ${p}VBillsPacked : ""
    03 : If  : (##${p}VDeleted = "No") And (##${p}VCancelled = "No") And (Not (##${p}VGuid = ""))
    04 :     Walk Collection : ${p}CurrentVoucherInvLinesColl
    05 :         Set : ${p}VItemsPacked : ##${p}VItemsPacked + "^^" + $RSLItemName + "~~" + $RSLBilledQty + "~~" + $RSLActualQty + "~~" + $RSLRate + "~~" + $RSLDiscount + "~~" + $RSLAmount + "~~" + $RSLGodown + "~~" + $RSLBatch
    06 :     End Walk
    07 :     Walk Collection : ${p}CurrentVoucherBillAllocColl
    08 :         Set : ${p}VBillsPacked : ##${p}VBillsPacked + "^^" + $RSLBillName + "~~" + $RSLBillType + "~~" + $RSLBillAmount
    09 :     End Walk
    10 : End If
    11 : Return

[Function: ${p}PackOpenCompaniesPipe]
    01 : Set : ${p}OpenCompsPipe : ""
    02 : Walk Collection : ${p}OpenCompaniesColl
    03 :     Set : ${p}OpenCompsPipe : ##${p}OpenCompsPipe + "^^" + $Name + "~~" + $GUID + "~~" + @@${p}CompStartDateStr
    04 : End Walk
    05 : Return

[Function: ${p}PostCapturedVoucherAfterAccept]
    Variable  : RSLProgressSub   : String : ""
    Variable  : RSLRespStatus    : String : ""
    Variable  : RSLBestMasterNum : Number : 0
    Variable  : RSLCurMasterNum  : Number : 0
    01 : Set : ${p}VPendingPost : No
    02 : If  : ##${p}VGuid = ""
    03 :     Walk Collection : ${p}JustSavedVoucherColl
    04 :         Set : RSLCurMasterNum : @@${p}CurMasterNumFormula
    05 :         If  : @@${p}IsExactVchNoMatch And (##RSLCurMasterNum > ##RSLBestMasterNum)
    06 :             Set : RSLBestMasterNum : ##RSLCurMasterNum
    07 :             Set : ${p}VGuid        : $GUID
    08 :             Set : ${p}VMasterId    : @@${p}FormMasterIdStr
    09 :             Set : ${p}VAlterId     : @@${p}FormAlterIdStr
    10 :             If  : @@${p}HasNonEmptyVchNo
    11 :                 Set : ${p}VVchNo   : $VoucherNumber
    12 :             End If
    13 :         End If
    14 :     End Walk
    15 :     If  : ##RSLBestMasterNum = 0
    16 :         Walk Collection : ${p}JustSavedVoucherColl
    17 :             Set : RSLCurMasterNum : @@${p}CurMasterNumFormula
    18 :             If  : ##RSLCurMasterNum > ##RSLBestMasterNum
    19 :                 Set : RSLBestMasterNum : ##RSLCurMasterNum
    20 :                 Set : ${p}VGuid        : $GUID
    21 :                 Set : ${p}VMasterId    : @@${p}FormMasterIdStr
    22 :                 Set : ${p}VAlterId     : @@${p}FormAlterIdStr
    23 :                 If  : @@${p}HasNonEmptyVchNo
    24 :                     Set : ${p}VVchNo   : $VoucherNumber
    25 :                 End If
    26 :             End If
    27 :         End Walk
    28 :     End If
    29 : End If
    30 : Call : ${p}PackSavedVoucherSubLines
    31 : Set : RSLProgressSub  : "Syncing " + ##${p}VVchType + " #" + ##${p}VVchNo
    32 : Start Progress : 1 : "${brandSyncTitle}" : ##${p}VCompany : ##RSLProgressSub
    33 : Show Progress  : 0
    34 : Walk Collection : ${p}CloudVoucherPost
    35 :     Set : RSLRespStatus : $RSLOkStatus
    36 : End Walk
    37 : Show Progress  : 1
    38 : End Progress
    39 : Return

[#Form: Stock Item]
    Add : On : Form Accept : @@${p}ShouldPostStockOnSave : Call : ${p}CaptureStockItemBeforeAccept
    Add : On : Form Accept : Yes : Form Accept
    Add : On : Form Accept : ##${p}SPendingPost : Call : ${p}PostStockItemAfterAccept

[Function: ${p}CaptureStockItemBeforeAccept]
    01 : Set : ${p}SGuid        : $GUID
    02 : Set : ${p}SMasterId    : @@${p}FormMasterIdStr
    03 : Set : ${p}SAlterId     : @@${p}FormAlterIdStr
    04 : Set : ${p}SCompany     : ##SVCurrentCompany
    05 : Set : ${p}SName        : $Name
    06 : Set : ${p}SGroup       : $Parent
    07 : Set : ${p}SCategory    : $Category
    08 : Set : ${p}SUom         : $BaseUnits
    09 : Set : ${p}SPartNo      : $PartNo
    10 : Set : ${p}SHsn         : @@${p}StockHsnStr
    11 : Set : ${p}SGstRate     : @@${p}StockGstRateStr
    12 : Set : ${p}SSellPrice   : @@${p}StockSellPriceStr
    13 : Set : ${p}SCostPrice   : @@${p}StockCostPriceStr
    14 : Set : ${p}SOpenQty     : @@${p}StockOpenQtyStr
    15 : Set : ${p}SOpenVal     : @@${p}StockOpenValStr
    16 : Set : ${p}SCloseQty    : @@${p}StockCloseQtyStr
    17 : Set : ${p}SCloseRate   : @@${p}StockCloseRateStr
    18 : Set : ${p}SCloseVal    : @@${p}StockCloseValStr
    19 : Set : ${p}SReorder     : @@${p}StockReorderStr
    20 : Set : ${p}SPendingPost : Yes
    21 : Return

[Function: ${p}PostStockItemAfterAccept]
    Variable : RSLProgressSub : String : ""
    Variable : RSLRespStatus  : String : ""
    01 : Set : ${p}SPendingPost : No
    02 : If  : ##${p}SGuid = ""
    03 :     Set : ${p}SGuid     : @@${p}SavedStockGuidFormula
    04 :     Set : ${p}SMasterId : @@${p}SavedStockMasterIdFormula
    05 :     Set : ${p}SAlterId  : @@${p}SavedStockAlterIdFormula
    06 :     Set : ${p}SCloseQty : @@${p}SavedStockCloseQtyFormula
    07 :     Set : ${p}SCloseVal : @@${p}SavedStockCloseValFormula
    08 : End If
    09 : Set : RSLProgressSub  : "Syncing Product " + ##${p}SName
    10 : Start Progress : 1 : "${brandSyncTitle}" : ##${p}SCompany : ##RSLProgressSub
    11 : Show Progress  : 0
    12 : Walk Collection : ${p}CloudSingleStockPost
    13 :     Set : RSLRespStatus : $RSLOkStatus
    14 : End Walk
    15 : Show Progress  : 1
    16 : End Progress
    17 : Return

[#Form: Ledger]
    Add : On : Form Accept : @@${p}ShouldPostLedgerOnSave : Call : ${p}CaptureLedgerBeforeAccept
    Add : On : Form Accept : Yes : Form Accept
    Add : On : Form Accept : ##${p}LPendingPost : Call : ${p}PostLedgerAfterAccept

[Function: ${p}CaptureLedgerBeforeAccept]
    01 : Set : ${p}LGuid        : $GUID
    02 : Set : ${p}LCompany     : ##SVCurrentCompany
    03 : Set : ${p}LName        : $Name
    04 : Set : ${p}LGroup       : @@${p}LedgerRoleGroupStr
    05 : Set : ${p}LPhone       : @@${p}LedgerPhoneDirectStr
    06 : Set : ${p}LEmail       : $EMail
    07 : Set : ${p}LGstin       : @@${p}LedgerGstinStr
    08 : Set : ${p}LPan         : $IncomeTaxNumber
    09 : Set : ${p}LContact     : $LedgerContact
    10 : Set : ${p}LState       : @@${p}LedgerStateStr
    11 : Set : ${p}LPincode     : $PinCode
    12 : Set : ${p}LCreditLimit : @@${p}LedgerCreditLimitStr
    13 : Set : ${p}LCreditDays  : @@${p}LedgerCreditDaysStr
    14 : Set : ${p}LOpenBal     : @@${p}LedgerOpenSignedStr
    15 : Set : ${p}LCloseBal    : @@${p}LedgerCloseSignedStr
    16 : Set : ${p}LPendingPost : Yes
    17 : Return

[Function: ${p}PostLedgerAfterAccept]
    Variable : RSLProgressSub : String : ""
    Variable : RSLRespStatus  : String : ""
    01 : Set : ${p}LPendingPost : No
    02 : If  : ##${p}LGuid = ""
    03 :     Set : ${p}LGuid     : @@${p}SavedLedgerGuidFormula
    04 :     Set : ${p}LCloseBal : @@${p}SavedLedgerCloseSignedStr
    05 : End If
    06 : Set : RSLProgressSub  : "Syncing Party Ledger " + ##${p}LName
    07 : Start Progress : 1 : "${brandSyncTitle}" : ##${p}LCompany : ##RSLProgressSub
    08 : Show Progress  : 0
    09 : Walk Collection : ${p}CloudSingleLedgerPost
    10 :     Set : RSLRespStatus : $RSLOkStatus
    11 : End Walk
    12 : Show Progress  : 1
    13 : End Progress
    14 : Return

[Collection: ${p}JustSavedVoucherColl]
    Type        : Voucher
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Parm Var    : SVFromDate       : Date   : @@${p}FromDateFormula
    Parm Var    : SVToDate         : Date   : @@${p}ToDateFormula
    Fetch       : MasterID, GUID, AlterID, VoucherNumber, VoucherTypeName, PartyLedgerName, IsOptional
    Filter      : ${p}MatchesJustSavedVch

[Collection: ${p}CurrentVoucherObjColl]
    Type        : Voucher
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Parm Var    : SVFromDate       : Date   : @@${p}FromDateFormula
    Parm Var    : SVToDate         : Date   : @@${p}ToDateFormula
    Fetch       : GUID, MasterID, AllInventoryEntries.*, InventoryEntries.*, AllLedgerEntries.*, LedgerEntries.*
    Filter      : ${p}MatchesCurrentPostVch

[Collection: ${p}CurrentVoucherInvLinesColl]
    Source Collection : ${p}CurrentVoucherObjColl
    Walk              : AllInventoryEntries
    Compute           : RSLItemName   : $StockItemName
    Compute           : RSLBilledQty  : $$String:$BilledQty
    Compute           : RSLActualQty  : $$String:$ActualQty
    Compute           : RSLRate       : $$String:$Rate
    Compute           : RSLDiscount   : $$String:$Discount
    Compute           : RSLAmount     : $$String:($$Abs:$Amount)
    Compute           : RSLGodown     : If Not $$IsEmpty:($BatchAllocations[1].GodownName) Then $BatchAllocations[1].GodownName Else $GodownName
    Compute           : RSLBatch      : $BatchAllocations[1].BatchName
    Filter            : ${p}HasNonEmptyItemName

[Collection: ${p}CurrentVoucherBillAllocColl]
    Source Collection : ${p}CurrentVoucherObjColl
    Walk              : AllLedgerEntries, BillAllocations
    Compute           : RSLBillName   : $Name
    Compute           : RSLBillType   : $BillType
    Compute           : RSLBillAmount : $$String:($$Abs:$Amount)
    Filter            : ${p}HasNonEmptyBillName

[Function: ${p}SyncExistingVouchers]
    Variable : SVCurrentCompany    : String
    Variable : RSLOrigCompany      : String : ""
    Variable : RSLOpenCompCount    : Number : 0
    Variable : RSLCompIdx          : Number : 0
    Variable : RSLCompIdxStr       : String : ""
    Variable : RSLCompGodownCount  : Number : 0
    Variable : RSLCompStockCount   : Number : 0
    Variable : RSLCompLedCount     : Number : 0
    Variable : RSLCompVchTotal     : Number : 0
    Variable : RSLCompFailed       : Number : 0
    Variable : RSLStepIdx          : Number : 0
    Variable : RSLSyncedCount      : Number : 0
    Variable : RSLStockSyncedTotal : Number : 0
    Variable : RSLLedSyncedTotal   : Number : 0
    Variable : RSLFailedCount      : Number : 0
    Variable : RSLDeletedTotal     : Number : 0
    Variable : RSLRecDeletedStr    : String : ""
    Variable : RSLSyncedStr        : String : ""
    Variable : RSLStockSyncedStr   : String : ""
    Variable : RSLLedSyncedStr     : String : ""
    Variable : RSLFailedStr        : String : ""
    Variable : RSLDeletedStr       : String : ""
    Variable : RSLCompCountStr     : String : ""
    Variable : RSLStepStatus       : String : ""
    Variable : RSLStepMsg          : String : ""
    Variable : RSLDisplayMsg       : String : ""
    01 : Set : RSLOrigCompany   : ##SVCurrentCompany
    02 : Set : RSLOpenCompCount : @@${p}OpenCompCountFormula
    03 : If  : ##RSLOpenCompCount = 0
    04 :     Msg Box : "${brandSyncTitle}" : "No allowed Tally company is currently open. Open your company(ies) in Tally Prime (F3) and try again."
    05 :     Return
    06 : End If
    07 : Call : ${p}PackOpenCompaniesPipe
    08 : Walk Collection : ${p}CloudPingCheck
    09 :     Set : RSLStepStatus : $RSLOkStatus
    10 : End Walk
    11 : Walk Collection : ${p}OpenCompaniesColl
    12 :     Increment : RSLCompIdx
    13 :     Set : RSLCompIdxStr      : @@${p}CompIdxStrFormula
    14 :     Set : SVCurrentCompany   : $Name
    15 :     Set : ${p}VCompany       : $Name
    16 :     Set : ${p}VSyncBatch     : @@${p}SyncBatchFormula
    17 :     Set : RSLCompGodownCount : @@${p}CompGodownTotalFormula
    18 :     Set : RSLCompStockCount  : @@${p}CompStockTotalFormula
    19 :     Set : RSLCompLedCount    : @@${p}CompLedTotalFormula
    20 :     If  : ##RSLCompGodownCount > 0
    21 :         Start Progress : 1 : "${brandSyncTitle} - Godowns" : ##SVCurrentCompany : "Syncing Warehouses & Godowns..."
    22 :         Show Progress  : 0
    23 :         Walk Collection : ${p}CloudBulkGodownsPost
    24 :             Set : RSLStepStatus : $RSLOkStatus
    25 :         End Walk
    26 :         Show Progress  : 1
    27 :         End Progress
    28 :     End If
    29 :     If  : ##RSLCompStockCount > 0
    30 :         Start Progress : 1 : "${brandSyncTitle} - Products" : ##SVCurrentCompany : "Syncing Stock Items, HSN, GST & Opening/Closing Stock..."
    31 :         Show Progress  : 0
    32 :         Set : RSLStepStatus : ""
    33 :         Walk Collection : ${p}CloudBulkStockPost
    34 :             Set : RSLStepStatus : $RSLOkStatus
    35 :             Set : RSLStepMsg    : $RSLMessage
    36 :         End Walk
    37 :         If : ##RSLStepStatus = "Connected"
    38 :             Set : RSLStockSyncedTotal : ##RSLStockSyncedTotal + ##RSLCompStockCount
    39 :         End If
    40 :         Show Progress  : 1
    41 :         End Progress
    42 :     End If
    43 :     If  : ##RSLCompLedCount > 0
    44 :         Start Progress : 1 : "${brandSyncTitle} - Party Ledgers" : ##SVCurrentCompany : "Syncing Client & Supplier Ledgers..."
    45 :         Show Progress  : 0
    46 :         Set : RSLStepStatus : ""
    47 :         Walk Collection : ${p}CloudBulkLedgersPost
    48 :             Set : RSLStepStatus : $RSLOkStatus
    49 :             Set : RSLStepMsg    : $RSLMessage
    50 :         End Walk
    51 :         If : ##RSLStepStatus = "Connected"
    52 :             Set : RSLLedSyncedTotal : ##RSLLedSyncedTotal + ##RSLCompLedCount
    53 :         End If
    54 :         Show Progress  : 1
    55 :         End Progress
    56 :     End If
    57 :     Set : RSLCompVchTotal : @@${p}CompVchTotalFormula
    58 :     Set : RSLCompFailed   : 0
    59 :     Set : RSLStepIdx      : 0
    60 :     If  : ##RSLCompVchTotal > 0
    61 :         Start Progress : ##RSLCompVchTotal : "${brandSyncTitle} - Vouchers" : ##SVCurrentCompany : "Syncing bills, line items, receipts & settlements..."
    62 :         Walk Collection : ${p}ExistingVouchersColl
    63 :             Set : ${p}VGuid       : $GUID
    64 :             Set : ${p}VMasterId   : @@${p}FormMasterIdStr
    65 :             Set : ${p}VAlterId    : @@${p}FormAlterIdStr
    66 :             Set : ${p}VCompany    : ##SVCurrentCompany
    67 :             Set : ${p}VVchNo      : $VoucherNumber
    68 :             Set : ${p}VVchType    : $VoucherTypeName
    69 :             Set : ${p}VBaseType   : @@${p}FormBaseTypeStr
    70 :             Set : ${p}VParty      : $PartyLedgerName
    71 :             Set : ${p}VPartyGroup : @@${p}PartyGroupExpr
    72 :             Set : ${p}VPhone      : @@${p}PartyPhoneExpr
    73 :             Set : ${p}VAmount     : @@${p}FormAmountStr
    74 :             Set : ${p}VDate       : @@${p}FormDateStr
    75 :             Set : ${p}VDueDate    : @@${p}FormDueDateStr
    76 :             Set : ${p}VAgstBill   : @@${p}FormAgstBillStr
    77 :             Set : ${p}VNarration  : @@${p}FormNarrationStr
    78 :             Set : ${p}VCancelled  : @@${p}FormCancelledStr
    79 :             Set : ${p}VDeleted    : "No"
    80 :             Set : ${p}VOptional   : "No"
    81 :             Set : ${p}VInAlter    : "No"
    82 :             Call : ${p}PackSavedVoucherSubLines
    83 :             Set : RSLStepStatus   : ""
    84 :             Walk Collection : ${p}CloudVoucherPost
    85 :                 Set : RSLStepStatus : $RSLOkStatus
    86 :                 Set : RSLStepMsg    : $RSLMessage
    87 :             End Walk
    88 :             If : ##RSLStepStatus = "Connected"
    89 :                 Increment : RSLSyncedCount
    90 :             Else
    91 :                 Increment : RSLFailedCount
    92 :                 Increment : RSLCompFailed
    93 :             End If
    94 :             Increment : RSLStepIdx
    95 :             Show Progress : ##RSLStepIdx
    96 :         End Walk
    97 :         End Progress
    98 :     End If
    99 :     If  : ##RSLCompFailed = 0
   100 :         Start Progress : 1 : "${brandSyncTitle} - Reconciling" : ##SVCurrentCompany : "Reconciling companies, deleted bills & paid settlements..."
   101 :         Show Progress  : 0
   102 :         Set : RSLRecDeletedStr : "0"
   103 :         Walk Collection : ${p}CloudReconcilePost
   104 :             Set : RSLStepStatus    : $RSLOkStatus
   105 :             Set : RSLRecDeletedStr : $RSLDeletedCount
   106 :         End Walk
   107 :         If : Not (##RSLRecDeletedStr = "")
   108 :             Set : RSLDeletedTotal : @@${p}RecDeletedNumFormula
   109 :         End If
   110 :         Show Progress  : 1
   111 :         End Progress
   112 :     End If
   113 : End Walk
   114 : Set : SVCurrentCompany  : ##RSLOrigCompany
   115 : Set : ${p}VSyncBatch    : ""
   116 : Set : RSLSyncedStr      : @@${p}SyncedCountFormula
   117 : Set : RSLStockSyncedStr : @@${p}SyncedStockCountFormula
   118 : Set : RSLLedSyncedStr   : @@${p}SyncedLedCountFormula
   119 : Set : RSLFailedStr      : @@${p}FailedCountFormula
   120 : Set : RSLDeletedStr     : @@${p}DeletedTotalFormula
   121 : Set : RSLCompCountStr   : @@${p}CompIdxStrFormula
   122 : If  : ##RSLFailedCount > 0
   123 :     If : ##RSLStepMsg = ""
   124 :         Set : RSLDisplayMsg : "Synced " + ##RSLSyncedStr + " voucher(s), " + ##RSLStockSyncedStr + " product(s); " + ##RSLFailedStr + " failed. Run '${menuTestTitle}' to verify connectivity."
   125 :     Else
   126 :         Set : RSLDisplayMsg : "Synced " + ##RSLSyncedStr + " voucher(s), " + ##RSLStockSyncedStr + " product(s); " + ##RSLFailedStr + " failed - " + ##RSLStepMsg
   127 :     End If
   128 :     Msg Box : "${brandSyncTitle} - Action Needed" : ##RSLDisplayMsg
   129 : Else
   130 :     If : ##RSLDeletedTotal > 0
   131 :         Set : RSLDisplayMsg : "Synced " + ##RSLSyncedStr + " voucher(s), " + ##RSLStockSyncedStr + " product(s), " + ##RSLLedSyncedStr + " ledger(s), and removed " + ##RSLDeletedStr + " deleted bill(s) across " + ##RSLCompCountStr + " Tally company(ies)!"
   132 :     Else
   133 :         Set : RSLDisplayMsg : "Successfully synced " + ##RSLSyncedStr + " voucher(s), " + ##RSLStockSyncedStr + " product(s), and " + ##RSLLedSyncedStr + " party ledger(s) across " + ##RSLCompCountStr + " Tally company(ies)!"
   134 :     End If
   135 :     Msg Box : "${brandSyncTitle} - Complete" : ##RSLDisplayMsg
   136 : End If
   137 : Return

[Collection: ${p}OpenCompaniesColl]
    Type        : Company
    Fetch       : Name, GUID, StartingFrom
    Filter      : ${p}IsAllowedCompObj

[Collection: ${p}ExistingGodownsColl]
    Type        : Godown
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Fetch       : Name, GUID, Parent, Address

[Collection: ${p}ExistingStockItemsColl]
    Type        : StockItem
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Fetch       : MasterID, GUID, AlterID, Name, Parent, Category, BaseUnits, PartNo
    Fetch       : OpeningBalance, OpeningValue, ClosingBalance, ClosingRate, ClosingValue, ReorderBase
    Fetch       : StandardPrice, StandardCost, StandardPriceList.Rate, StandardCostList.Rate
    Fetch       : HSNDetails.HSNCode, GSTDetails.HSNCode, GSTDetails.StatewiseDetails.RateDetails.GSTRate

[Collection: ${p}ExistingPartyLedgersColl]
    Type        : Ledger
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Fetch       : GUID, Name, Parent, LedgerMobile, LedgerPhone, EMail, PartyGSTIN, GSTIN, IncomeTaxNumber, LedgerContact, LedStateName, StateName, PinCode, CreditLimit, BillCreditPeriod, OpeningBalance, ClosingBalance
    Filter      : ${p}IsPartyParentGroup

[Collection: ${p}ExistingVouchersColl]
    Type        : Voucher
    Parm Var    : SVCurrentCompany : String : ##${p}VCompany
    Parm Var    : SVFromDate       : Date   : @@${p}FromDateFormula
    Parm Var    : SVToDate         : Date   : @@${p}ToDateFormula
    Fetch       : MasterID, GUID, AlterID, Date, VoucherNumber, VoucherTypeName, PartyLedgerName, PartyMobileNo, Amount, BasicDueDateOfPymt, Narration, IsCancelled, IsOptional
    Fetch       : LedgerEntries.Amount, AllLedgerEntries.Amount, AllLedgerEntries.IsPartyLedger, AllLedgerEntries.LedgerName, InventoryEntries.Amount, AllInventoryEntries.Amount
    Fetch       : LedgerEntries.BillAllocations.Name, AllLedgerEntries.BillAllocations.Name
    Filter      : ${p}SyncableSavedVoucher

[Function: ${p}TestCloudHandshake]
    Variable : RSLPingStatus : String : ""
    Variable : RSLPingMsg    : String : ""
    Variable : RSLDisplayMsg : String : ""
    01 : Call : ${p}PackOpenCompaniesPipe
    02 : Start Progress : 1 : "${brandSyncTitle}" : ##SVCurrentCompany : "Verifying cloud connection & open companies..."
    03 : Show Progress  : 0
    04 : Walk Collection : ${p}CloudPingCheck
    05 :     Set : RSLPingStatus : $RSLOkStatus
    06 :     Set : RSLPingMsg    : $RSLMessage
    07 : End Walk
    08 : Show Progress  : 1
    09 : End Progress
    10 : If  : ##RSLPingStatus = ""
    11 :     Set : RSLDisplayMsg : "${unreachableMsg}"
    12 :     Msg Box : "${brandSyncTitle}" : ##RSLDisplayMsg
    13 : Else
    14 :     If : ##RSLPingStatus = "Error"
    15 :         Set : RSLDisplayMsg : ##RSLPingMsg
    16 :         Msg Box : "${brandSyncTitle} - Action Needed" : ##RSLDisplayMsg
    17 :     Else
    18 :         If : ##RSLPingMsg = ""
    19 :             Set : RSLDisplayMsg : "Connected via ${brandSyncTitle}! Live voucher, product & multi-company sync is active."
    20 :         Else
    21 :             Set : RSLDisplayMsg : ##RSLPingMsg
    22 :         End If
    23 :         Msg Box : "${brandSyncTitle} - Connected" : ##RSLDisplayMsg
    24 :     End If
    25 : End If
    26 : Return

[Collection: ${p}CloudVoucherPost]
    Data Source     : HTTP JSON : "${postUrl}"
    RemoteRequest   : ${p}VoucherJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudSingleStockPost]
    Data Source     : HTTP JSON : "${mastersUrl}"
    RemoteRequest   : ${p}SingleStockJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudSingleLedgerPost]
    Data Source     : HTTP JSON : "${mastersUrl}"
    RemoteRequest   : ${p}SingleLedgerJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudBulkGodownsPost]
    Data Source     : HTTP JSON : "${mastersUrl}"
    RemoteRequest   : ${p}BulkGodownsJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudBulkStockPost]
    Data Source     : HTTP JSON : "${mastersUrl}"
    RemoteRequest   : ${p}BulkStockItemsJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudBulkLedgersPost]
    Data Source     : HTTP JSON : "${mastersUrl}"
    RemoteRequest   : ${p}BulkPartyLedgersJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Collection: ${p}CloudReconcilePost]
    Data Source     : HTTP JSON : "${reconcileUrl}"
    RemoteRequest   : ${p}ReconcileJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage, RSLDeletedCount

[Collection: ${p}CloudPingCheck]
    Data Source     : HTTP JSON : "${pingUrl}"
    RemoteRequest   : ${p}PingJsonReport : UTF-8
    JSON Object Path: "tallyResult:1"
    Header          : "Content-Type: application/json; charset=utf-8"
    Header          : "User-Agent: TallyPrime-RSL-TDL/2.9"${tokenHeaderLine}
    Fetch           : RSLOkStatus, RSLMessage

[Report: ${p}PingJsonReport]
    Form                : ${p}PingJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}PingJsonForm]
    Parts       : ${p}PingJsonPart

[Part: ${p}PingJsonPart]
    Lines       : ${p}PingJsonLine
    Scroll      : Vertical

[Line: ${p}PingJsonLine]
    Fields      : ${p}PingMode, ${p}PingCompany, ${p}PingOpenCompsPipe

[Field: ${p}PingMode]
    Set As      : "ping"
    JSONTag     : "mode"

[Field: ${p}PingCompany]
    Set As      : ##SVCurrentCompany
    JSONTag     : "companyName"

[Field: ${p}PingOpenCompsPipe]
    Set As      : ##${p}OpenCompsPipe
    JSONTag     : "openCompaniesPipe"

[Report: ${p}ReconcileJsonReport]
    Form                : ${p}ReconcileJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}ReconcileJsonForm]
    Parts       : ${p}ReconcileJsonPart

[Part: ${p}ReconcileJsonPart]
    Lines       : ${p}ReconcileJsonLine
    Scroll      : Vertical

[Line: ${p}ReconcileJsonLine]
    Fields      : ${p}RecMode, ${p}RecCompany, ${p}RecBatch

[Field: ${p}RecMode]
    Set As      : "reconcile"
    JSONTag     : "mode"

[Field: ${p}RecCompany]
    Set As      : ##${p}VCompany
    JSONTag     : "companyName"

[Field: ${p}RecBatch]
    Set As      : ##${p}VSyncBatch
    JSONTag     : "syncBatchId"

[Report: ${p}SingleStockJsonReport]
    Form                : ${p}SingleStockJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}SingleStockJsonForm]
    Parts       : ${p}SingleStockJsonPart

[Part: ${p}SingleStockJsonPart]
    Lines       : ${p}SingleStockBodyLine
    Scroll      : Vertical

[Line: ${p}SingleStockBodyLine]
    Fields      : ${p}SMMode, ${p}SMKind, ${p}SMCompany, ${p}SMGuid, ${p}SMMasterId, ${p}SMAlterId, ${p}SMName, ${p}SMGroup, ${p}SMCat, ${p}SMUom, ${p}SMPartNo, ${p}SMHsn, ${p}SMGst, ${p}SMSell, ${p}SMCost, ${p}SMOpenQty, ${p}SMOpenVal, ${p}SMCloseQty, ${p}SMCloseRate, ${p}SMCloseVal, ${p}SMReorder

[Field: ${p}SMMode]
    Set As      : "masters"
    JSONTag     : "mode"

[Field: ${p}SMKind]
    Set As      : "stockItem"
    JSONTag     : "masterKind"

[Field: ${p}SMCompany]
    Set As      : ##${p}SCompany
    JSONTag     : "companyName"

[Field: ${p}SMGuid]
    Set As      : ##${p}SGuid
    JSONTag     : "guid"

[Field: ${p}SMMasterId]
    Set As      : ##${p}SMasterId
    JSONTag     : "masterId"

[Field: ${p}SMAlterId]
    Set As      : ##${p}SAlterId
    JSONTag     : "alterId"

[Field: ${p}SMName]
    Set As      : ##${p}SName
    JSONTag     : "name"

[Field: ${p}SMGroup]
    Set As      : ##${p}SGroup
    JSONTag     : "stockGroup"

[Field: ${p}SMCat]
    Set As      : ##${p}SCategory
    JSONTag     : "stockCategory"

[Field: ${p}SMUom]
    Set As      : ##${p}SUom
    JSONTag     : "uom"

[Field: ${p}SMPartNo]
    Set As      : ##${p}SPartNo
    JSONTag     : "partNumber"

[Field: ${p}SMHsn]
    Set As      : ##${p}SHsn
    JSONTag     : "hsnCode"

[Field: ${p}SMGst]
    Set As      : ##${p}SGstRate
    JSONTag     : "gstRatePct"

[Field: ${p}SMSell]
    Set As      : ##${p}SSellPrice
    JSONTag     : "sellingPriceRupees"

[Field: ${p}SMCost]
    Set As      : ##${p}SCostPrice
    JSONTag     : "costPriceRupees"

[Field: ${p}SMOpenQty]
    Set As      : ##${p}SOpenQty
    JSONTag     : "openingQty"

[Field: ${p}SMOpenVal]
    Set As      : ##${p}SOpenVal
    JSONTag     : "openingValueRupees"

[Field: ${p}SMCloseQty]
    Set As      : ##${p}SCloseQty
    JSONTag     : "closingQty"

[Field: ${p}SMCloseRate]
    Set As      : ##${p}SCloseRate
    JSONTag     : "closingRateRupees"

[Field: ${p}SMCloseVal]
    Set As      : ##${p}SCloseVal
    JSONTag     : "closingValueRupees"

[Field: ${p}SMReorder]
    Set As      : ##${p}SReorder
    JSONTag     : "reorderLevelQty"

[Report: ${p}SingleLedgerJsonReport]
    Form                : ${p}SingleLedgerJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}SingleLedgerJsonForm]
    Parts       : ${p}SingleLedgerJsonPart

[Part: ${p}SingleLedgerJsonPart]
    Lines       : ${p}SingleLedgerBodyLine
    Scroll      : Vertical

[Line: ${p}SingleLedgerBodyLine]
    Fields      : ${p}LMMode, ${p}LMKind, ${p}LMCompany, ${p}LMGuid, ${p}LMName, ${p}LMGroup, ${p}LMPhone, ${p}LMEmail, ${p}LMGstin, ${p}LMPan, ${p}LMContact, ${p}LMState, ${p}LMPincode, ${p}LMCreditLim, ${p}LMCreditDays, ${p}LMOpenBal, ${p}LMCloseBal

[Field: ${p}LMMode]
    Set As      : "masters"
    JSONTag     : "mode"

[Field: ${p}LMKind]
    Set As      : "partyLedger"
    JSONTag     : "masterKind"

[Field: ${p}LMCompany]
    Set As      : ##${p}LCompany
    JSONTag     : "companyName"

[Field: ${p}LMGuid]
    Set As      : ##${p}LGuid
    JSONTag     : "guid"

[Field: ${p}LMName]
    Set As      : ##${p}LName
    JSONTag     : "name"

[Field: ${p}LMGroup]
    Set As      : ##${p}LGroup
    JSONTag     : "parentGroup"

[Field: ${p}LMPhone]
    Set As      : ##${p}LPhone
    JSONTag     : "phone"

[Field: ${p}LMEmail]
    Set As      : ##${p}LEmail
    JSONTag     : "email"

[Field: ${p}LMGstin]
    Set As      : ##${p}LGstin
    JSONTag     : "gstin"

[Field: ${p}LMPan]
    Set As      : ##${p}LPan
    JSONTag     : "pan"

[Field: ${p}LMContact]
    Set As      : ##${p}LContact
    JSONTag     : "contactPerson"

[Field: ${p}LMState]
    Set As      : ##${p}LState
    JSONTag     : "stateName"

[Field: ${p}LMPincode]
    Set As      : ##${p}LPincode
    JSONTag     : "pincode"

[Field: ${p}LMCreditLim]
    Set As      : ##${p}LCreditLimit
    JSONTag     : "creditLimitRupees"

[Field: ${p}LMCreditDays]
    Set As      : ##${p}LCreditDays
    JSONTag     : "creditDays"

[Field: ${p}LMOpenBal]
    Set As      : ##${p}LOpenBal
    JSONTag     : "openingBalanceRupees"

[Field: ${p}LMCloseBal]
    Set As      : ##${p}LCloseBal
    JSONTag     : "closingBalanceRupees"

[Report: ${p}BulkGodownsJsonReport]
    Form                : ${p}BulkGodownsJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}BulkGodownsJsonForm]
    Parts       : ${p}BulkGodownsPart

[Part: ${p}BulkGodownsPart]
    Lines       : ${p}BulkGodownLine
    Repeat      : ${p}BulkGodownLine : ${p}ExistingGodownsColl
    Scroll      : Vertical

[Line: ${p}BulkGodownLine]
    Fields      : ${p}BGCompany, ${p}BGGuid, ${p}BGName, ${p}BGParent
    JSONTag     : "godowns"

[Field: ${p}BGCompany]
    Set As      : ##${p}VCompany
    JSONTag     : "companyName"

[Field: ${p}BGGuid]
    Set As      : $GUID
    JSONTag     : "guid"

[Field: ${p}BGName]
    Set As      : $Name
    JSONTag     : "name"

[Field: ${p}BGParent]
    Set As      : $Parent
    JSONTag     : "parentName"

[Report: ${p}BulkStockItemsJsonReport]
    Form                : ${p}BulkStockItemsJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}BulkStockItemsJsonForm]
    Parts       : ${p}BulkStockItemsPart

[Part: ${p}BulkStockItemsPart]
    Lines       : ${p}BulkStockItemLine
    Repeat      : ${p}BulkStockItemLine : ${p}ExistingStockItemsColl
    Scroll      : Vertical

[Line: ${p}BulkStockItemLine]
    Fields      : ${p}BSCompany, ${p}BSGuid, ${p}BSMasterId, ${p}BSAlterId, ${p}BSName, ${p}BSGroup, ${p}BSCat, ${p}BSUom, ${p}BSPartNo, ${p}BSHsn, ${p}BSGst, ${p}BSSell, ${p}BSCost, ${p}BSOpenQty, ${p}BSOpenVal, ${p}BSCloseQty, ${p}BSCloseRate, ${p}BSCloseVal, ${p}BSReorder
    JSONTag     : "stockItems"

[Field: ${p}BSCompany]
    Set As      : ##${p}VCompany
    JSONTag     : "companyName"

[Field: ${p}BSGuid]
    Set As      : $GUID
    JSONTag     : "guid"

[Field: ${p}BSMasterId]
    Set As      : @@${p}FormMasterIdStr
    JSONTag     : "masterId"

[Field: ${p}BSAlterId]
    Set As      : @@${p}FormAlterIdStr
    JSONTag     : "alterId"

[Field: ${p}BSName]
    Set As      : $Name
    JSONTag     : "name"

[Field: ${p}BSGroup]
    Set As      : $Parent
    JSONTag     : "stockGroup"

[Field: ${p}BSCat]
    Set As      : $Category
    JSONTag     : "stockCategory"

[Field: ${p}BSUom]
    Set As      : $BaseUnits
    JSONTag     : "uom"

[Field: ${p}BSPartNo]
    Set As      : $PartNo
    JSONTag     : "partNumber"

[Field: ${p}BSHsn]
    Set As      : @@${p}StockHsnStr
    JSONTag     : "hsnCode"

[Field: ${p}BSGst]
    Set As      : @@${p}StockGstRateStr
    JSONTag     : "gstRatePct"

[Field: ${p}BSSell]
    Set As      : @@${p}StockSellPriceStr
    JSONTag     : "sellingPriceRupees"

[Field: ${p}BSCost]
    Set As      : @@${p}StockCostPriceStr
    JSONTag     : "costPriceRupees"

[Field: ${p}BSOpenQty]
    Set As      : @@${p}StockOpenQtyStr
    JSONTag     : "openingQty"

[Field: ${p}BSOpenVal]
    Set As      : @@${p}StockOpenValStr
    JSONTag     : "openingValueRupees"

[Field: ${p}BSCloseQty]
    Set As      : @@${p}StockCloseQtyStr
    JSONTag     : "closingQty"

[Field: ${p}BSCloseRate]
    Set As      : @@${p}StockCloseRateStr
    JSONTag     : "closingRateRupees"

[Field: ${p}BSCloseVal]
    Set As      : @@${p}StockCloseValStr
    JSONTag     : "closingValueRupees"

[Field: ${p}BSReorder]
    Set As      : @@${p}StockReorderStr
    JSONTag     : "reorderLevelQty"

[Report: ${p}BulkPartyLedgersJsonReport]
    Form                : ${p}BulkPartyLedgersJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}BulkPartyLedgersJsonForm]
    Parts       : ${p}BulkPartyLedgersPart

[Part: ${p}BulkPartyLedgersPart]
    Lines       : ${p}BulkPartyLedgerLine
    Repeat      : ${p}BulkPartyLedgerLine : ${p}ExistingPartyLedgersColl
    Scroll      : Vertical

[Line: ${p}BulkPartyLedgerLine]
    Fields      : ${p}BLCompany, ${p}BLGuid, ${p}BLName, ${p}BLGroup, ${p}BLPhone, ${p}BLEmail, ${p}BLGstin, ${p}BLPan, ${p}BLContact, ${p}BLState, ${p}BLPincode, ${p}BLCreditLim, ${p}BLCreditDays, ${p}BLOpenBal, ${p}BLCloseBal
    JSONTag     : "partyLedgers"

[Field: ${p}BLCompany]
    Set As      : ##${p}VCompany
    JSONTag     : "companyName"

[Field: ${p}BLGuid]
    Set As      : $GUID
    JSONTag     : "guid"

[Field: ${p}BLName]
    Set As      : $Name
    JSONTag     : "name"

[Field: ${p}BLGroup]
    Set As      : @@${p}LedgerRoleGroupStr
    JSONTag     : "parentGroup"

[Field: ${p}BLPhone]
    Set As      : @@${p}LedgerPhoneDirectStr
    JSONTag     : "phone"

[Field: ${p}BLEmail]
    Set As      : $EMail
    JSONTag     : "email"

[Field: ${p}BLGstin]
    Set As      : @@${p}LedgerGstinStr
    JSONTag     : "gstin"

[Field: ${p}BLPan]
    Set As      : $IncomeTaxNumber
    JSONTag     : "pan"

[Field: ${p}BLContact]
    Set As      : $LedgerContact
    JSONTag     : "contactPerson"

[Field: ${p}BLState]
    Set As      : @@${p}LedgerStateStr
    JSONTag     : "stateName"

[Field: ${p}BLPincode]
    Set As      : $PinCode
    JSONTag     : "pincode"

[Field: ${p}BLCreditLim]
    Set As      : @@${p}LedgerCreditLimitStr
    JSONTag     : "creditLimitRupees"

[Field: ${p}BLCreditDays]
    Set As      : @@${p}LedgerCreditDaysStr
    JSONTag     : "creditDays"

[Field: ${p}BLOpenBal]
    Set As      : @@${p}LedgerOpenSignedStr
    JSONTag     : "openingBalanceRupees"

[Field: ${p}BLCloseBal]
    Set As      : @@${p}LedgerCloseSignedStr
    JSONTag     : "closingBalanceRupees"

[Report: ${p}VoucherJsonReport]
    Form                : ${p}VoucherJsonForm
    Plain JSON          : Yes
    Export Empty Fields : Yes

[Form: ${p}VoucherJsonForm]
    Parts       : ${p}VoucherJsonPart
    JSONTag     : "bill"

[Part: ${p}VoucherJsonPart]
    Lines       : ${p}VoucherJsonLine
    Scroll      : Vertical

[Line: ${p}VoucherJsonLine]
    Fields      : ${p}Guid, ${p}MasterId, ${p}AlterId, ${p}Company, ${p}VchNo, ${p}VchType, ${p}BaseType, ${p}Party, ${p}PartyGroup, ${p}Phone, ${p}Amount, ${p}Date, ${p}DueDate, ${p}AgstBill, ${p}NarrationField, ${p}Cancelled, ${p}Deleted, ${p}Optional, ${p}InAlterField, ${p}SyncBatch, ${p}ItemsPackedField, ${p}BillsPackedField

[Field: ${p}Guid]
    Set As      : ##${p}VGuid
    JSONTag     : "guid"

[Field: ${p}MasterId]
    Set As      : ##${p}VMasterId
    JSONTag     : "masterId"

[Field: ${p}AlterId]
    Set As      : ##${p}VAlterId
    JSONTag     : "alterId"

[Field: ${p}Company]
    Set As      : ##${p}VCompany
    JSONTag     : "companyName"

[Field: ${p}VchNo]
    Set As      : ##${p}VVchNo
    JSONTag     : "voucherNumber"

[Field: ${p}VchType]
    Set As      : ##${p}VVchType
    JSONTag     : "voucherType"

[Field: ${p}BaseType]
    Set As      : ##${p}VBaseType
    JSONTag     : "baseVoucherType"

[Field: ${p}Party]
    Set As      : ##${p}VParty
    JSONTag     : "partyName"

[Field: ${p}PartyGroup]
    Set As      : ##${p}VPartyGroup
    JSONTag     : "partyParentGroup"

[Field: ${p}Phone]
    Set As      : ##${p}VPhone
    JSONTag     : "partyPhone"

[Field: ${p}Amount]
    Set As      : ##${p}VAmount
    JSONTag     : "amountRupees"

[Field: ${p}Date]
    Set As      : ##${p}VDate
    JSONTag     : "voucherDate"

[Field: ${p}DueDate]
    Set As      : ##${p}VDueDate
    JSONTag     : "dueDate"

[Field: ${p}AgstBill]
    Set As      : ##${p}VAgstBill
    JSONTag     : "againstBillNumber"

[Field: ${p}NarrationField]
    Set As      : ##${p}VNarration
    JSONTag     : "narration"

[Field: ${p}Cancelled]
    Set As      : ##${p}VCancelled
    JSONTag     : "isCancelled"

[Field: ${p}Deleted]
    Set As      : ##${p}VDeleted
    JSONTag     : "isDeleted"

[Field: ${p}Optional]
    Set As      : ##${p}VOptional
    JSONTag     : "isOptional"

[Field: ${p}InAlterField]
    Set As      : ##${p}VInAlter
    JSONTag     : "inAlterMode"

[Field: ${p}SyncBatch]
    Set As      : ##${p}VSyncBatch
    JSONTag     : "syncBatchId"

[Field: ${p}ItemsPackedField]
    Set As      : ##${p}VItemsPacked
    JSONTag     : "lineItemsPacked"

[Field: ${p}BillsPackedField]
    Set As      : ##${p}VBillsPacked
    JSONTag     : "billAllocationsPacked"
`;
}

export function generateStandaloneTallyConnectorMjs(params: {
  serverUrl: string;
  workspaceName: string;
}): string {
  const defaultServer = params.serverUrl.replace(/\/+$/, "");
  const safeName = params.workspaceName.replace(/[\r\n"']/g, "").trim() || "Business Workspace";
  const tdlFilename = buildWorkspaceTdlFilename(params.workspaceName);
  const brandTitle = buildTallyDisplayBrandTitle(params.workspaceName);

  return `#!/usr/bin/env node
/**
 * ${brandTitle} — Standalone Windows Tally Prime Connector (Zero Dependencies)
 * Workspace     : ${safeName}
 * Cloud Ingress : ${defaultServer}
 *
 * Features:
 *   - Multi-Company Live Sync (Sales, Receipt, Payment, Credit Note, Debit Note, Purchase + Paid-in-Tally Settlements)
 *   - Client & Supplier Ledgers + Inventory & Godown Masters Sync
 *   - Exact Native Tally-Printed PDF Capture (%PDF-1.x via Tally Voucher Print Engine — zero design modifications!)
 *   - Automatic Over-The-Air .tdl Self-Updater (never manually re-download .tdl files!)
 *
 * Commands:
 *   1. Pair PC (one-time):
 *      node rsl-tally-connector.mjs --pair RSL-XXXX-XXXX --device "Accounts Office PC"
 *   2. Check local Tally Port 9000 + Cloud HTTPS:
 *      node rsl-tally-connector.mjs --doctor
 *   3. Start live background sync (30s heartbeat + native Tally PDF capture + .tdl auto-update):
 *      node rsl-tally-connector.mjs
 *   4. Optional: keep local .tdl file auto-updated in place:
 *      node rsl-tally-connector.mjs --tdl-path "C:\\\\RSL\\\\${tdlFilename}" --webhook-token tlwh_...
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const AGENT_VERSION = "2.6.0";
const DEFAULT_SERVER_URL = ${JSON.stringify(defaultServer)};

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

const statePath = path.join(os.homedir(), ".rsl-tally-agent", "state.json");

function restrictWindowsFileAcl(filePath) {
  if (process.platform !== "win32") return;
  try {
    const currentUser = os.userInfo().username;
    if (currentUser) {
      execFileSync(
        "icacls",
        [filePath, "/inheritance:r", "/grant:r", \`\${currentUser}:(R,W)\`],
        { stdio: "ignore", windowsHide: true }
      );
    }
  } catch {
    // Non-fatal if corporate domain GPO restricts icacls
  }
}

function loadState() {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  restrictWindowsFileAcl(statePath);
}

function signRequest(secret, ts, rawBody) {
  return crypto.createHmac("sha256", secret).update(\`\${ts}.\${rawBody}\`).digest("hex");
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(str) {
  return String(str)
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractXmlTag(block, tag) {
  const m = block.match(new RegExp(\`<\${tag}(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)<\\\\/\${tag}>\`, "i"));
  return xmlUnescape((m && m[1]) || "");
}

async function signedPost(state, endpointPath, body) {
  const rawBody = JSON.stringify(body);
  const ts = Date.now();
  const sig = signRequest(state.signingSecret, ts, rawBody);
  const res = await fetch(\`\${state.serverUrl}\${endpointPath}\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RSL-Device-Id": state.deviceId,
      "X-RSL-Timestamp": String(ts),
      "X-RSL-Signature": sig,
    },
    body: rawBody,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(\`Cloud API \${endpointPath} returned HTTP \${res.status}: \${txt}\`);
  }
  return res.json();
}

function buildOpenCompaniesXmlQuery() {
  return \`<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLOpenCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLOpenCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <NATIVEMETHOD>Name, GUID, StartingFrom</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>\`;
}

function buildTallyXmlQuery(sinceAlterId = 0, companyName = "") {
  const companyTag = companyName
    ? \`\\n        <SVCURRENTCOMPANY>\${xmlEscape(companyName)}</SVCURRENTCOMPANY>\`
    : "";
  return \`<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLSyncVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>20000401</SVFROMDATE>
        <SVTODATE>20990331</SVTODATE>\${companyTag}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLSyncVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Date, VoucherNumber, VoucherTypeName, PartyLedgerName, PartyMobileNo, Amount, BasicDueDateOfPymt, Narration, IsCancelled, IsOptional</NATIVEMETHOD>
            <NATIVEMETHOD>LedgerEntries.LedgerName, LedgerEntries.IsPartyLedger, LedgerEntries.Amount, LedgerEntries.BillAllocations.Name, LedgerEntries.BillAllocations.BillType, LedgerEntries.BillAllocations.Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllLedgerEntries.LedgerName, AllLedgerEntries.IsPartyLedger, AllLedgerEntries.Amount, AllLedgerEntries.BillAllocations.Name, AllLedgerEntries.BillAllocations.BillType, AllLedgerEntries.BillAllocations.Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllInventoryEntries.StockItemName, AllInventoryEntries.BilledQty, AllInventoryEntries.ActualQty, AllInventoryEntries.Rate, AllInventoryEntries.Discount, AllInventoryEntries.Amount, AllInventoryEntries.GodownName</NATIVEMETHOD>
            <NATIVEMETHOD>AllInventoryEntries.BatchAllocations.GodownName, AllInventoryEntries.BatchAllocations.BatchName, AllInventoryEntries.BatchAllocations.MfdOn, AllInventoryEntries.BatchAllocations.ExpiryPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>InventoryEntries.StockItemName, InventoryEntries.BilledQty, InventoryEntries.ActualQty, InventoryEntries.Rate, InventoryEntries.Discount, InventoryEntries.Amount, InventoryEntries.GodownName</NATIVEMETHOD>
            <COMPUTE>RSLPartyPhone : $LedgerMobile:Ledger:$PartyLedgerName</COMPUTE>
            <COMPUTE>RSLPartyGroup : $Parent:Ledger:$PartyLedgerName</COMPUTE>
            <COMPUTE>RSLBaseVchType : $Parent:VoucherType:$VoucherTypeName</COMPUTE>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
            <FILTER>RSLAlterFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="RSLAlterFilter">$AlterID > \${Math.max(0, Math.trunc(sinceAlterId))}</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>\`;
}

function buildTallyStockItemsXmlQuery(companyName = "") {
  const companyTag = companyName
    ? \`\\n        <SVCURRENTCOMPANY>\${xmlEscape(companyName)}</SVCURRENTCOMPANY>\`
    : "";
  return \`<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLSyncInventoryMasters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>20000401</SVFROMDATE>
        <SVTODATE>20990331</SVTODATE>\${companyTag}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLSyncInventoryMasters" ISMODIFY="No">
            <COLLECTION>RSLStockItemsColl, RSLGodownsColl, RSLPartyLedgersColl, RSLSupplierLedgersColl, RSLBillsColl</COLLECTION>
          </COLLECTION>
          <COLLECTION NAME="RSLStockItemsColl" ISMODIFY="No">
            <TYPE>StockItem</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Name, Parent, Category, BaseUnits, MailingName, PartNo, GSTIGSTRate, HSNCode, OpeningBalance, OpeningValue, ClosingBalance, ClosingRate, ClosingValue, ReorderBase, MinOrderBase, StandardPrice, StandardCost</NATIVEMETHOD>
            <NATIVEMETHOD>BatchAllocations.GodownName, BatchAllocations.BatchName, BatchAllocations.ClosingBalance, BatchAllocations.ClosingValue, BatchAllocations.MfdOn, BatchAllocations.ExpiryPeriod</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
          <COLLECTION NAME="RSLGodownsColl" ISMODIFY="No">
            <TYPE>Godown</TYPE>
            <NATIVEMETHOD>GUID, Name, Parent, Address</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
          <COLLECTION NAME="RSLPartyLedgersColl" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>$$GroupSundryDebtors</CHILDOF>
            <BELONGSTO>Yes</BELONGSTO>
            <NATIVEMETHOD>GUID, Name, Parent, LedgerMobile, LedgerPhone, LedgerContact, Email, PartyGSTIN, IncomeTaxNumber, LedStateName, Pincode, CreditLimit, BillCreditPeriod, OpeningBalance, ClosingBalance, Address</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
          <COLLECTION NAME="RSLSupplierLedgersColl" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>$$GroupSundryCreditors</CHILDOF>
            <BELONGSTO>Yes</BELONGSTO>
            <NATIVEMETHOD>GUID, Name, Parent, LedgerMobile, LedgerPhone, LedgerContact, Email, PartyGSTIN, IncomeTaxNumber, LedStateName, Pincode, CreditLimit, BillCreditPeriod, OpeningBalance, ClosingBalance, Address</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
          <COLLECTION NAME="RSLBillsColl" ISMODIFY="No">
            <TYPE>Bill</TYPE>
            <NATIVEMETHOD>Name, Parent, OpeningBalance, ClosingBalance, BillDate, BillCreditPeriod</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>\`;
}

function buildNativeVoucherPdfXml(masterId, companyName = "") {
  const cleanMasterId = String(masterId || "").replace(/[^0-9]/g, "");
  const companyTag = companyName
    ? \`\\n        <SVCURRENTCOMPANY>\${xmlEscape(companyName)}</SVCURRENTCOMPANY>\`
    : "";
  return \`<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>RSLNativeVoucherPrint</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:PDF</SVEXPORTFORMAT>
        <SVPRINTMODE>$$SysName:NormalPrint</SVPRINTMODE>\${companyTag}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="RSLNativeVoucherPrint" ISMODIFY="No">
            <USE>Voucher</USE>
            <OBJECT>Voucher : "ID:\${cleanMasterId}"</OBJECT>
          </REPORT>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>\`;
}

function exportNativeVoucherPdfFromTally(host, port, companyName, masterId) {
  const cleanMasterId = String(masterId || "").replace(/[^0-9]/g, "");
  if (!cleanMasterId) return Promise.resolve(null);
  const xmlBody = buildNativeVoucherPdfXml(cleanMasterId, companyName);
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      resolve(val);
    };
    const req = http.request(
      {
        hostname: host,
        port,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(xmlBody),
          "Accept-Encoding": "identity",
        },
        timeout: 3000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            let buf = Buffer.concat(chunks);
            if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
              buf = zlib.gunzipSync(buf);
            }
            if (buf.length >= 16 && buf.subarray(0, 5).toString("ascii") === "%PDF-") {
              finish(buf.toString("base64"));
              return;
            }
            finish(null);
          } catch {
            finish(null);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
    req.write(xmlBody);
    req.end();
  });
}

async function autoUpdateLocalTdlIfConfigured(state) {
  if (!state.tdlPath || !state.webhookToken) return;
  try {
    const devParam = state.deviceId ? \`&deviceId=\${encodeURIComponent(state.deviceId)}\` : "";
    const manifestUrl = \`\${state.serverUrl}/api/webhooks/tally?mode=tdl-manifest&token=\${encodeURIComponent(state.webhookToken)}\${devParam}\`;
    const mRes = await fetch(manifestUrl);
    if (!mRes.ok) return;
    const manifest = await mRes.json();
    const versionLabel = manifest.version || manifest.tdlVersion || manifest.latestTdlVersion || "latest";
    if (!manifest.ok || !manifest.sha256) return;

    let currentSha = "";
    if (fs.existsSync(state.tdlPath)) {
      currentSha = crypto.createHash("sha256").update(fs.readFileSync(state.tdlPath)).digest("hex");
    }
    if (currentSha === manifest.sha256) return;

    const latestUrl = \`\${state.serverUrl}/api/webhooks/tally?mode=tdl-latest&token=\${encodeURIComponent(state.webhookToken)}\`;
    const dlRes = await fetch(latestUrl);
    if (!dlRes.ok) return;
    const tdlContent = await dlRes.text();
    if (!tdlContent.includes("[#Menu: Gateway of Tally]")) return;

    // Cryptographic SHA-256 + HMAC verification BEFORE touching disk (P1-03 / SEC-05)
    const downloadedSha = crypto.createHash("sha256").update(tdlContent, "utf8").digest("hex");
    if (downloadedSha !== String(manifest.sha256).toLowerCase()) {
      console.error("[RSL Connector] Security block: downloaded .tdl SHA-256 did not match signed manifest; refusing update.");
      return;
    }
    if (!manifest.manifestHmac) {
      console.error("[RSL Connector] Security block: .tdl manifest missing cryptographic HMAC signature; refusing update.");
      return;
    }
    const expectedTokenHmac = crypto
      .createHmac("sha256", state.webhookToken)
      .update(\`\${versionLabel}:\${downloadedSha}\`)
      .digest("hex");
    if (expectedTokenHmac !== manifest.manifestHmac) {
      console.error("[RSL Connector] Security block: .tdl manifest HMAC verification failed; refusing update.");
      return;
    }
    if (manifest.deviceHmac && state.signingSecret) {
      const expectedDeviceHmac = crypto
        .createHmac("sha256", state.signingSecret)
        .update(\`\${versionLabel}:\${downloadedSha}\`)
        .digest("hex");
      if (expectedDeviceHmac !== manifest.deviceHmac) {
        console.error("[RSL Connector] Security block: .tdl device HMAC verification failed; refusing update.");
        return;
      }
    }

    fs.mkdirSync(path.dirname(state.tdlPath), { recursive: true });
    fs.writeFileSync(state.tdlPath, tdlContent, "utf8");
    console.log(\`[RSL Connector] Verified SHA-256 & HMAC -> auto-updated local Tally .tdl add-on to v\${versionLabel} at \${state.tdlPath}\`);
  } catch {
    // Non-fatal background check
  }
}

async function listOpenTallyCompanies(host, port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(\`http://\${host}:\${port}\`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildOpenCompaniesXmlQuery(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, companies: [], error: \`Tally HTTP status \${res.status}\` };
    }
    const xml = await res.text();
    const blocks = xml.match(/<COMPANY(?:\\s[^>]*)?>[\\s\\S]*?<\\/COMPANY>/gi) || [];
    const companies = [];
    for (const b of blocks) {
      const nameMatch = b.match(/<NAME[^>]*>([\\s\\S]*?)<\\/NAME>/i);
      const attrMatch = b.match(/<COMPANY[^>]*\\bNAME="([^"]+)"/i);
      const name = xmlUnescape((nameMatch && nameMatch[1]) || (attrMatch && attrMatch[1]) || "");
      if (name) companies.push(name);
    }
    return { ok: true, companies: Array.from(new Set(companies)), error: null };
  } catch (err) {
    return {
      ok: false,
      companies: [],
      error: err instanceof Error ? err.message : "Connection refused on local Tally port",
    };
  }
}

async function queryTallyCompanyVouchers(host, port, companyName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(\`http://\${host}:\${port}\`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildTallyXmlQuery(0, companyName),
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(\`Tally HTTP status \${res.status} for company \${companyName}\`);
  }
  return res.text();
}

async function queryTallyCompanyStockItems(host, port, companyName) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(\`http://\${host}:\${port}\`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildTallyStockItemsXmlQuery(companyName),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function extractMaxAlterId(xml) {
  let maxId = 0;
  const matches = xml.matchAll(/<ALTERID[^>]*>\\s*(\\d+)\\s*<\\/ALTERID>/gi);
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  return maxId;
}

async function collectUpdatedNativeVoucherPdfs(host, port, companyName, xml, exportedPdfAlterIds) {
  const voucherPdfs = [];
  const blocks = xml.match(/<VOUCHER(?:\\s[^>]*)?>[\\s\\S]*?<\\/VOUCHER>/gi) || [];
  for (const block of blocks) {
    const isOptional = /^yes$/i.test(extractXmlTag(block, "ISOPTIONAL"));
    const isCancelled = /^yes$/i.test(extractXmlTag(block, "ISCANCELLED"));
    if (isOptional || isCancelled) continue;

    const guid = extractXmlTag(block, "GUID");
    const masterId = extractXmlTag(block, "MASTERID").replace(/\\D/g, "");
    const alterId = Number(extractXmlTag(block, "ALTERID").replace(/\\D/g, "") || 0);
    const vchNo = extractXmlTag(block, "VOUCHERNUMBER");
    const vchType = extractXmlTag(block, "RSLBASEVCHTYPE") || extractXmlTag(block, "VOUCHERTYPENAME") || "Sales";
    if (!guid || !masterId) continue;
    if (!/sales|receipt|payment|credit|debit/i.test(vchType)) continue;

    const cacheKey = \`\${companyName}::\${guid}\`;
    if (exportedPdfAlterIds[cacheKey] === alterId && alterId > 0) continue;

    const pdfBase64 = await exportNativeVoucherPdfFromTally(host, port, companyName, masterId);
    if (pdfBase64) {
      voucherPdfs.push({
        guid,
        masterId,
        alterId,
        voucherNumber: vchNo,
        voucherType: vchType,
        companyName,
        pdfBase64,
      });
      exportedPdfAlterIds[cacheKey] = alterId;
    }
  }
  return voucherPdfs;
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));
  const serverUrl = (flags.server || process.env.RSL_SERVER_URL || DEFAULT_SERVER_URL).replace(/\\/+$/, "");
  const tallyHost = flags["tally-host"] || process.env.TALLY_HOST || "127.0.0.1";
  const tallyPort = Number(flags["tally-port"] || process.env.TALLY_PORT || 9000);
  const pairCode = flags.pair || flags.code;

  if (flags.doctor) {
    console.log(\`[RSL Doctor] Checking Cloud (\${serverUrl}) & Local Tally (http://\${tallyHost}:\${tallyPort})...\`);
    const tally = await listOpenTallyCompanies(tallyHost, tallyPort);
    console.log(
      tally.ok
        ? \`  [OK] Tally Prime XML Server reachable on \${tallyHost}:\${tallyPort} (Open Companies: \${tally.companies.join(", ") || "None"})\`
        : \`  [WARN] Tally Prime NOT reachable on \${tallyHost}:\${tallyPort} -> \${tally.error}\`
    );
    const cloudRes = await fetch(\`\${serverUrl}/api/health\`).catch((e) => ({ ok: false, statusText: e.message }));
    console.log(
      cloudRes.ok
        ? \`  [OK] RapidShift Labs Cloud reachable (\${serverUrl})\`
        : \`  [ERR] RapidShift Labs Cloud unreachable (\${serverUrl})\`
    );
    process.exit(tally.ok && cloudRes.ok ? 0 : 1);
  }

  if (pairCode) {
    const deviceName = flags.device || os.hostname();
    console.log(\`[RSL Connector] Pairing '\${deviceName}' with \${serverUrl}...\`);
    const res = await fetch(\`\${serverUrl}/api/agent/pair\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairingCode: pairCode,
        deviceName,
        osVersion: \`\${os.platform()} \${os.release()}\`,
        agentVersion: AGENT_VERSION,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error("[RSL Connector] Pairing failed:", data.message ?? data);
      process.exit(1);
    }
    saveState({
      deviceId: data.deviceId,
      signingSecret: data.signingSecret,
      workspaceId: data.workspaceId,
      serverUrl,
      tallyHost,
      tallyPort,
      lastAlterId: 0,
      companyAlterIds: {},
      exportedPdfAlterIds: {},
      tdlPath: flags["tdl-path"] || null,
      webhookToken: flags["webhook-token"] || null,
    });
    console.log(\`[RSL Connector] Paired! Device ID: \${data.deviceId}\`);
    console.log(\`[RSL Connector] Run 'node rsl-tally-connector.mjs' to start continuous background sync.\`);
    return;
  }

  const state = loadState();
  if (!state) {
    console.error("\\n==========================================================");
    console.error(" RapidShift Labs Tally Connector — First-Time PC Pairing");
    console.error("==========================================================");
    console.error("1. Open RapidShift Labs -> Tally Prime -> Connect Your Office PC");
    console.error("2. Click 'Generate Pairing Code' (or download the 1-Click .bat Installer)");
    console.error("3. Run: node rsl-tally-connector.mjs --pair RSL-XXXX-XXXX --device \\"Accounts Office PC\\"\\n");
    process.exit(1);
  }
  if (flags.server) state.serverUrl = serverUrl;
  if (flags["tally-host"]) state.tallyHost = tallyHost;
  if (flags["tally-port"]) state.tallyPort = tallyPort;
  if (flags["tdl-path"]) state.tdlPath = flags["tdl-path"];
  if (flags["webhook-token"]) state.webhookToken = flags["webhook-token"];
  if (!state.companyAlterIds) state.companyAlterIds = {};
  if (!state.exportedPdfAlterIds) state.exportedPdfAlterIds = {};
  saveState(state);

  console.log(\`[RSL Connector] Active for workspace \${state.workspaceId} -> \${state.serverUrl}\`);
  console.log(\`[RSL Connector] Watching Tally Prime XML Server on http://\${state.tallyHost}:\${state.tallyPort}\`);

  const tick = async () => {
    try {
      await autoUpdateLocalTdlIfConfigured(state);
      const openInfo = await listOpenTallyCompanies(state.tallyHost, state.tallyPort);
      await signedPost(state, "/api/agent/heartbeat", {
        tallyReachable: openInfo.ok,
        tallyHost: state.tallyHost,
        tallyPort: state.tallyPort,
        activeCompanyName: openInfo.companies.join(", ") || null,
        openCompanies: openInfo.companies,
        lastAlterId: state.lastAlterId || 0,
        lastErrorMessage: openInfo.error,
        agentVersion: AGENT_VERSION,
        osVersion: \`\${os.platform()} \${os.release()}\`,
      });

      if (openInfo.ok && openInfo.companies.length > 0) {
        for (const companyName of openInfo.companies) {
          const [xml, mastersXml] = await Promise.all([
            queryTallyCompanyVouchers(state.tallyHost, state.tallyPort, companyName),
            queryTallyCompanyStockItems(state.tallyHost, state.tallyPort, companyName),
          ]);
          const hasVouchers = /<VOUCHER(?:\\s|>)/i.test(xml);
          const hasMasters = /<(?:STOCKITEM|GODOWN|LEDGER|BILL)(?:\\s|>)/i.test(mastersXml);
          if (!hasVouchers && !hasMasters) {
            continue;
          }
          const voucherPdfs = hasVouchers
            ? await collectUpdatedNativeVoucherPdfs(
                state.tallyHost,
                state.tallyPort,
                companyName,
                xml,
                state.exportedPdfAlterIds
              )
            : [];
          const syncRes = await signedPost(state, "/api/agent/ingest", {
            rawXml: hasVouchers ? xml : undefined,
            mastersXml: hasMasters ? mastersXml : undefined,
            companyName,
            fullSnapshot: Boolean(companyName) && hasVouchers,
            hasExplicitDateSpan: true,
            voucherPdfs,
          });
          const maxAlter = extractMaxAlterId(xml);
          const prevCompAlter = Number(state.companyAlterIds[companyName] || 0);
          if (maxAlter > prevCompAlter || maxAlter > (state.lastAlterId || 0) || voucherPdfs.length > 0) {
            if (maxAlter > prevCompAlter) state.companyAlterIds[companyName] = maxAlter;
            if (maxAlter > (state.lastAlterId || 0)) state.lastAlterId = maxAlter;
            saveState(state);
          }
          if (
            (syncRes.upserted ?? 0) > 0 ||
            (syncRes.deletedCount ?? 0) > 0 ||
            (syncRes.stockItemsUpserted ?? 0) > 0 ||
            (syncRes.partiesUpserted ?? 0) > 0
          ) {
            console.log(
              \`[RSL Connector] [\${companyName}] Synced \${syncRes.upserted ?? 0} bill(s), \${syncRes.stockItemsUpserted ?? 0} product(s), \${syncRes.partiesUpserted ?? 0} party ledger(s), \${voucherPdfs.length} native Tally PDF(s), removed \${syncRes.deletedCount ?? 0} deleted bill(s)\`
            );
          }
        }
      }
    } catch (err) {
      console.error("[RSL Connector] Sync cycle warning:", err instanceof Error ? err.message : err);
    }
  };

  await tick();
  if (flags.once) return;
  setInterval(tick, 30_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

/**
 * Generates a 1-Click Windows Setup & Auto-Start Launcher (.bat) for non-technical
 * accountants so they never need to type PowerShell commands or open taskschd.msc (P1-14 / LAY-05).
 */
export function generateWindowsTallyInstallerBat(params: {
  serverUrl: string;
  workspaceName: string;
  webhookToken?: string;
  pairingCode?: string;
}): string {
  const cleanServer = params.serverUrl.trim().replace(/\/+$/, "");
  const cleanBrandTitle = buildTallyDisplayBrandTitle(params.workspaceName)
    .replace(/[!%"|<>^\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const escapedBatBrand = cleanBrandTitle.replace(/&/g, "^&");
  const tdlFilename = buildWorkspaceTdlFilename(params.workspaceName);
  const whToken = (params.webhookToken ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const presetCode = (params.pairingCode ?? "").replace(/[^A-Za-z0-9-]/g, "");

  const lines = [
    "@echo off",
    `rem ${cleanBrandTitle} - 1-Click Tally Prime Sync Setup`,
    "setlocal EnableDelayedExpansion",
    `title ${escapedBatBrand} - 1-Click Tally Prime Sync Setup`,
    "color 0A",
    "echo ======================================================================",
    `echo   ${escapedBatBrand} - 1-Click Tally Prime Setup`,
    "echo ======================================================================",
    "echo.",
    'set "RSL_DIR=%LOCALAPPDATA%\\RapidShiftLabs"',
    'if not exist "%RSL_DIR%" mkdir "%RSL_DIR%"',
    "",
    "where node >nul 2>nul",
    "if %ERRORLEVEL% NEQ 0 (",
    "  echo [Step 1/4] Installing Node.js LTS runtime via Windows Winget...",
    "  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent",
    '  set "PATH=%ProgramFiles%\\nodejs;%PATH%"',
    ")",
    "where node >nul 2>nul",
    "if %ERRORLEVEL% NEQ 0 (",
    "  echo.",
    "  echo [Action Needed] Please install Node.js LTS from https://nodejs.org and double-click this file again.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "echo [Step 1/4] Downloading verified Tally Connector and TDL Add-On...",
    whToken
      ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '${cleanServer}/api/webhooks/tally?mode=tdl-latest&token=${whToken}' -OutFile '%RSL_DIR%\\${tdlFilename}'"`
      : "rem TDL file can also be downloaded from the Connect Tally screen",
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '${cleanServer}/api/agent/connector-script' -OutFile '%RSL_DIR%\\rsl-tally-connector.mjs'" 2>nul`,
    "",
    presetCode ? `set "PAIR_CODE=${presetCode}"` : 'set "PAIR_CODE="',
    'if "%PAIR_CODE%"=="" (',
    "  if not exist \"%USERPROFILE%\\.rsl-tally-agent\\state.json\" (",
    "    echo.",
    "    echo Copy the 1-time Pairing Code shown on your RapidShift Labs Tally page (example: RSL-4829-1042).",
    '    set /p PAIR_CODE="Paste Pairing Code and press Enter: "',
    "  )",
    ")",
    "",
    'if not "%PAIR_CODE%"=="" (',
    "  echo [Step 2/4] Pairing this Windows PC with RapidShift Labs...",
    whToken
      ? `  node "%RSL_DIR%\\rsl-tally-connector.mjs" --server "${cleanServer}" --pair "%PAIR_CODE%" --device "%COMPUTERNAME%" --tdl-path "%RSL_DIR%\\${tdlFilename}" --webhook-token "${whToken}"`
      : `  node "%RSL_DIR%\\rsl-tally-connector.mjs" --server "${cleanServer}" --pair "%PAIR_CODE%" --device "%COMPUTERNAME%"`,
    "  if %ERRORLEVEL% NEQ 0 (",
    "    echo.",
    "    echo Pairing did not complete. Please generate a fresh Pairing Code in RapidShift Labs and run again.",
    "    pause",
    "    exit /b 1",
    "  )",
    ")",
    "",
    "echo [Step 3/4] Registering automatic background startup when Windows signs in...",
    'set "STARTUP_VBS=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\RSL-Tally-Background-Sync.vbs"',
    '> "%STARTUP_VBS%" echo Set WshShell = CreateObject("WScript.Shell")',
    '>> "%STARTUP_VBS%" echo WshShell.Run "cmd /c node ""%LOCALAPPDATA%\\RapidShiftLabs\\rsl-tally-connector.mjs""", 0, False',
    "",
    "echo [Step 4/4] Starting live Tally Prime sync in the background now...",
    'wscript.exe "%STARTUP_VBS%"',
    "echo.",
    "echo ======================================================================",
    `echo   SUCCESS: ${escapedBatBrand} is now running in the background.`,
    "echo   TDL File Path (for Tally F1 - TDLs ^& Add-Ons):",
    `echo   %RSL_DIR%\\${tdlFilename}`,
    "echo ======================================================================",
    "echo.",
    "pause",
  ];

  return lines.join("\r\n");
}

export interface IncomingTallyBillItem {
  guid?: string;
  masterId?: string;
  companyName?: string;
  voucherNumber: string;
  voucherType: TallySuiteVoucherType;
  partyName: string;
  partyParentGroup?: string;
  partyPhone?: string;
  amountRupees: number;
  paidAmountRupees?: number;
  hasExplicitPaidAmount?: boolean;
  narration?: string;
  ledgerAccountName?: string;
  billAllocations?: ParsedTallyBillAllocation[];
  originalCurrency?: string;
  originalAmountMinor?: number | null;
  exchangeRateMicros?: number | null;
  voucherDate?: string;
  dueDate?: string;
  alterId?: number;
  inAlterMode?: boolean;
  isCancelled?: boolean;
  isDeleted?: boolean;
  syncBatchId?: string;
  nativePdfBase64?: string;
  lineItems?: ParsedTallyVoucherLineItem[];
}

function normalizePhoneOrNull(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+") && digits.length >= 11) return digits;
  const onlyNums = digits.replace(/\D/g, "");
  if (onlyNums.length === 10) return `+91${onlyNums}`;
  if (onlyNums.length === 11 && onlyNums.startsWith("0")) return `+91${onlyNums.slice(1)}`;
  if (onlyNums.length >= 11 && onlyNums.length <= 15) return `+${onlyNums}`;
  return null;
}

function normalizeVoucherType(
  raw?: string,
  baseRaw?: string
): TallySuiteVoucherType {
  const combined = `${baseRaw || ""} ${raw || "Sales"}`.trim();
  if (/receipt/i.test(combined)) return "Receipt";
  if (/payment/i.test(combined)) return "Payment";
  if (/credit\s*note|creditnote/i.test(combined)) return "CreditNote";
  if (/debit\s*note|debitnote/i.test(combined)) return "DebitNote";
  if (/purchase/i.test(combined)) return "Purchase";
  return "Sales";
}

function toCompanySlugGuid(companyName: string): string {
  return `comp_${companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function isAutoGeneratedVoucherNumberPlaceholder(vchNo: string): boolean {
  return /(?:-AUTO$|^VCH-\d+$|^(?:SALES|RECEIPT|PAYMENT|PURCHASE|CREDITNOTE|DEBITNOTE)-\d+$)/i.test(
    vchNo.trim()
  );
}

function resolveCanonicalVoucherGuid(
  db: ReturnType<typeof tenantDataDb>,
  companyId: string,
  companyGuid: string,
  rawGuid: string | undefined,
  rawMasterId: string | undefined,
  voucherType: string,
  voucherNumber: string,
  partyName?: string,
  opts?: {
    inAlterMode?: boolean;
    isAuthoritativeSource?: boolean;
    isMutationFlag?: boolean;
  }
): { guid: string; collidedWithDifferentBillNumber: boolean } {
  const trimmed = rawGuid?.trim() ?? "";
  const cleanMasterId = (rawMasterId?.replace(/\D/g, "") ?? "").replace(/^0+$/, "");
  const normIncomingVchNo = voucherNumber.trim().toLowerCase();
  const canReassignVoucherNumber = Boolean(
    opts?.inAlterMode || opts?.isAuthoritativeSource || opts?.isMutationFlag
  );

  let collidedWithDifferentBillNumber = false;

  if (trimmed) {
    const scoped = `${companyGuid}::${trimmed}`;
    const existingScoped = db
      .select({
        id: tenantDataSchema.tallyVouchers.id,
        voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
      })
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, scoped))
      .get();
    if (existingScoped) {
      const existingNormNo = existingScoped.voucherNumber.trim().toLowerCase();
      if (
        existingNormNo === normIncomingVchNo ||
        canReassignVoucherNumber ||
        isAutoGeneratedVoucherNumberPlaceholder(existingScoped.voucherNumber)
      ) {
        return { guid: scoped, collidedWithDifferentBillNumber: false };
      }
      // Non-Destructive Bill Number Collision Shield:
      // An older .tdl (<= v2.7) in Create Mode accidentally sent an earlier bill's GUID (e.g. Bill #8)
      // when creating Bill #9. NEVER overwrite Bill #8 — allocate a separate canonical key for Bill #9!
      collidedWithDifferentBillNumber = true;
    }

    if (!collidedWithDifferentBillNumber) {
      const existingRaw = db
        .select({
          id: tenantDataSchema.tallyVouchers.id,
          companyId: tenantDataSchema.tallyVouchers.companyId,
          voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
        })
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.guid, trimmed))
        .get();
      if (existingRaw) {
        if (existingRaw.companyId !== companyId) {
          return { guid: scoped, collidedWithDifferentBillNumber: false };
        }
        const existingNormNo = existingRaw.voucherNumber.trim().toLowerCase();
        if (
          existingNormNo === normIncomingVchNo ||
          canReassignVoucherNumber ||
          isAutoGeneratedVoucherNumberPlaceholder(existingRaw.voucherNumber)
        ) {
          return { guid: trimmed, collidedWithDifferentBillNumber: false };
        }
        collidedWithDifferentBillNumber = true;
      }
    }

    if (!collidedWithDifferentBillNumber) {
      // Check if trimmed GUID is already used by another company (to decide trimmed vs scoped on upgrade)
      const targetUpgradeGuid = db
        .select({ id: tenantDataSchema.tallyVouchers.id })
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.guid, trimmed))
        .get()
        ? scoped
        : trimmed;

      // Upgrade 1: If this voucher was previously saved without GUID under its MasterID, upgrade its GUID in place!
      if (cleanMasterId) {
        const prevByMaster = db
          .select({
            id: tenantDataSchema.tallyVouchers.id,
            guid: tenantDataSchema.tallyVouchers.guid,
            voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
          })
          .from(tenantDataSchema.tallyVouchers)
          .where(
            and(
              eq(tenantDataSchema.tallyVouchers.companyId, companyId),
              eq(tenantDataSchema.tallyVouchers.masterId, cleanMasterId)
            )
          )
          .get();
        if (
          prevByMaster &&
          (prevByMaster.guid.startsWith("mid_") || prevByMaster.guid.startsWith("vch_")) &&
          (prevByMaster.voucherNumber.trim().toLowerCase() === normIncomingVchNo ||
            canReassignVoucherNumber ||
            isAutoGeneratedVoucherNumberPlaceholder(prevByMaster.voucherNumber))
        ) {
          db.update(tenantDataSchema.tallyVouchers)
            .set({ guid: targetUpgradeGuid })
            .where(eq(tenantDataSchema.tallyVouchers.id, prevByMaster.id))
            .run();
          return { guid: targetUpgradeGuid, collidedWithDifferentBillNumber: false };
        }
      }

      // Upgrade 2: If this voucher was previously saved under a fallback vch_ key (e.g. protected by Collision Shield
      // or created before GUID arrived), seamlessly upgrade its GUID in place so zero duplicates occur on Sync All Now!
      const fallbackVchKey = `vch_${companyId}_${voucherType}_${voucherNumber}`;
      const prevByFallbackVch = db
        .select({ id: tenantDataSchema.tallyVouchers.id })
        .from(tenantDataSchema.tallyVouchers)
        .where(
          and(
            eq(tenantDataSchema.tallyVouchers.companyId, companyId),
            eq(tenantDataSchema.tallyVouchers.guid, fallbackVchKey)
          )
        )
        .get();
      if (prevByFallbackVch) {
        db.update(tenantDataSchema.tallyVouchers)
          .set({ guid: targetUpgradeGuid })
          .where(eq(tenantDataSchema.tallyVouchers.id, prevByFallbackVch.id))
          .run();
        return { guid: targetUpgradeGuid, collidedWithDifferentBillNumber: false };
      }

      return { guid: targetUpgradeGuid, collidedWithDifferentBillNumber: false };
    }
  }

  // Fallback 1: Tally MasterID is strictly unique per voucher within a company (unless collidedWithDifferentBillNumber)
  if (!collidedWithDifferentBillNumber && cleanMasterId) {
    const existingByMaster = db
      .select({
        guid: tenantDataSchema.tallyVouchers.guid,
        voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
      })
      .from(tenantDataSchema.tallyVouchers)
      .where(
        and(
          eq(tenantDataSchema.tallyVouchers.companyId, companyId),
          eq(tenantDataSchema.tallyVouchers.masterId, cleanMasterId)
        )
      )
      .get();
    if (existingByMaster) {
      const existingNormNo = existingByMaster.voucherNumber.trim().toLowerCase();
      if (
        existingNormNo === normIncomingVchNo ||
        canReassignVoucherNumber ||
        isAutoGeneratedVoucherNumberPlaceholder(existingByMaster.voucherNumber)
      ) {
        return { guid: existingByMaster.guid, collidedWithDifferentBillNumber: false };
      }
      collidedWithDifferentBillNumber = true;
    } else {
      return {
        guid: `mid_${companyId}_${cleanMasterId}`,
        collidedWithDifferentBillNumber: false,
      };
    }
  }

  // Fallback 2: No GUID / collided stale GUID — never let unnumbered or cross-party bills overwrite an existing saved bill!
  const baseKey = `vch_${companyId}_${voucherType}_${voucherNumber}`;
  const existingBase = db
    .select({
      id: tenantDataSchema.tallyVouchers.id,
      partyName: tenantDataSchema.tallyVouchers.partyName,
      masterId: tenantDataSchema.tallyVouchers.masterId,
    })
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.guid, baseKey))
    .get();

  if (!existingBase) {
    return { guid: baseKey, collidedWithDifferentBillNumber };
  }

  const isAutoPlaceholder = /(?:-AUTO$|^VCH-\d+$)/i.test(voucherNumber.trim());
  const cleanParty = (partyName ?? "").trim().toLowerCase();
  const sameParty =
    !cleanParty ||
    cleanParty === "customer" ||
    existingBase.partyName.trim().toLowerCase() === cleanParty;

  if (isAutoPlaceholder) {
    return { guid: `${baseKey}_${newId().slice(-6)}`, collidedWithDifferentBillNumber };
  }

  if (!sameParty) {
    const partySlug = cleanParty.replace(/[^a-z0-9]+/g, "_").slice(0, 24) || "party";
    const partyKey = `${baseKey}_${partySlug}`;
    const existingPartyRow = db
      .select({
        id: tenantDataSchema.tallyVouchers.id,
        partyName: tenantDataSchema.tallyVouchers.partyName,
      })
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, partyKey))
      .get();
    if (!existingPartyRow || existingPartyRow.partyName.trim().toLowerCase() === cleanParty) {
      return { guid: partyKey, collidedWithDifferentBillNumber };
    }
    return { guid: `${partyKey}_${newId().slice(-6)}`, collidedWithDifferentBillNumber };
  }

  return { guid: baseKey, collidedWithDifferentBillNumber };
}

function findExistingVoucherForMutation(
  db: ReturnType<typeof tenantDataDb>,
  companyId: string,
  companyGuid: string,
  rawGuid?: string,
  voucherNumber?: string,
  voucherType?: string,
  rawMasterId?: string
) {
  const trimmed = rawGuid?.trim() ?? "";
  if (trimmed) {
    const scoped = `${companyGuid}::${trimmed}`;
    const byScoped = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, scoped))
      .get();
    if (byScoped) return byScoped;

    const byRaw = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(
        and(
          eq(tenantDataSchema.tallyVouchers.guid, trimmed),
          eq(tenantDataSchema.tallyVouchers.companyId, companyId)
        )
      )
      .get();
    if (byRaw) return byRaw;
  }

  const cleanMasterId = (rawMasterId?.replace(/\D/g, "") ?? "").replace(/^0+$/, "");
  if (cleanMasterId) {
    const byMaster = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(
        and(
          eq(tenantDataSchema.tallyVouchers.companyId, companyId),
          eq(tenantDataSchema.tallyVouchers.masterId, cleanMasterId)
        )
      )
      .get();
    if (byMaster) return byMaster;
  }

  if (voucherNumber && voucherType) {
    const fallbackGuid = `vch_${companyId}_${voucherType}_${voucherNumber}`;
    const byFallback = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, fallbackGuid))
      .get();
    if (byFallback) return byFallback;
  }

  return null;
}

function appendGuidsToSyncBatch(
  db: ReturnType<typeof tenantDataDb>,
  syncBatchId: string,
  guids: string[]
) {
  if (!syncBatchId || guids.length === 0) return;
  const safeKey = `${TALLY_BATCH_PREFIX}${syncBatchId.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 80)}`;
  const now = Date.now();
  const existing = db
    .select()
    .from(tenantDataSchema.settings)
    .where(eq(tenantDataSchema.settings.key, safeKey))
    .get();

  let list: string[] = [];
  if (existing?.valueJson) {
    try {
      const parsed = JSON.parse(existing.valueJson) as { guids?: string[] };
      if (Array.isArray(parsed.guids)) list = parsed.guids;
    } catch {
      list = [];
    }
  }
  const merged = Array.from(new Set([...list, ...guids]));
  const valueJson = JSON.stringify({ guids: merged, updatedAt: now });
  db.insert(tenantDataSchema.settings)
    .values({ key: safeKey, valueJson, updatedAt: now })
    .onConflictDoUpdate({
      target: tenantDataSchema.settings.key,
      set: { valueJson, updatedAt: now },
    })
    .run();
}

export function reconcileTallyCompanySnapshot(params: {
  workspaceId: string;
  companyName: string;
  activeCanonicalGuids: Iterable<string>;
  actorType: ActorType;
  actorId: string;
  sourceLabel?: "webhook" | "api" | "agent";
  sourceIp?: string | null;
  userAgent?: string | null;
  allowEmptyCompanyPurge?: boolean;
  hasExplicitDateSpan?: boolean;
}): {
  deletedCount: number;
  ignoredCompany: boolean;
  deletedVoucherNumbers: string[];
} {
  const routing = getTallyCompanyRoutingConfig(params.workspaceId);
  if (!isTallyCompanyAllowed(params.companyName, routing)) {
    return { deletedCount: 0, ignoredCompany: true, deletedVoucherNumbers: [] };
  }

  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const companyGuid = toCompanySlugGuid(params.companyName);
  let company = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
    .get();

  if (!company && params.companyName.trim() && params.companyName.trim() !== "Primary Tally Company") {
    registerTallyCompaniesForWorkspace({
      workspaceId: params.workspaceId,
      companies: [params.companyName.trim()],
      updateLastSyncedAt: true,
    });
    company = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();
  }

  if (!company) {
    return { deletedCount: 0, ignoredCompany: false, deletedVoucherNumbers: [] };
  }

  const activeSet = new Set(params.activeCanonicalGuids);
  const existingRows = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.companyId, company.id))
    .all();

  const syncableRows = existingRows.filter(
    (row) => !row.guid.startsWith("vch_") && !row.voucherNumber.startsWith("SIM-")
  );

  // Catastrophic empty-snapshot circuit breaker (P0-01 / LOGIC-CRIT-01):
  // Never wipe synced company vouchers when Tally returns an empty 0-voucher snapshot
  // (e.g. during Tally company reload, F1 menu lock, or transient XML export error).
  if (activeSet.size === 0 && syncableRows.length > 0 && !params.allowEmptyCompanyPurge) {
    throw new RslError(
      "RSL-SYNC-CIRCUIT-BREAKER",
      `Safety circuit breaker prevented deleting ${syncableRows.length} synced Tally bill(s) for '${company.name}' because the incoming snapshot contained 0 vouchers.`
    );
  }

  // Single-Day SVCurrentDate Snapshot Guard:
  // In Tally Prime, an XML <TYPE>Voucher</TYPE> export WITHOUT <SVFROMDATE> only returns bills
  // dated on Tally's SVCurrentDate (the date of the newest bill). Never allow an un-spanned
  // single-day payload from an older connector to delete saved bills on earlier dates!
  let singleDayGuardBucket: number | null = null;
  if (params.hasExplicitDateSpan === false && activeSet.size > 0) {
    const activeDayBuckets = new Set<number>();
    for (const row of existingRows) {
      if (activeSet.has(row.guid)) {
        activeDayBuckets.add(Math.floor(row.voucherDate / 86_400_000));
      }
    }
    if (activeDayBuckets.size === 1) {
      singleDayGuardBucket = Array.from(activeDayBuckets)[0]!;
    }
  }

  const deletedVoucherNumbers: string[] = [];
  const affectedInventoryItemIds = new Set<string>();
  const now = Date.now();

  for (const row of existingRows) {
    // Only reconcile Tally-originated GUIDs (do not wipe manual portal-only entries or SIM- sandbox bills)
    if (row.guid.startsWith("vch_") || row.voucherNumber.startsWith("SIM-")) {
      continue;
    }
    if (activeSet.has(row.guid)) {
      continue;
    }
    if (
      singleDayGuardBucket !== null &&
      Math.floor(row.voucherDate / 86_400_000) !== singleDayGuardBucket
    ) {
      continue;
    }

    for (const itemId of collectVoucherStockItemIdsBeforeDelete(db, row.id)) {
      affectedInventoryItemIds.add(itemId);
    }
    cancelPendingOutboxJobsForVoucher(params.workspaceId, row);
    removeStoredTallyVoucherPdf(params.workspaceId, row);
    db.delete(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, row.id))
      .run();
    deletedVoucherNumbers.push(row.voucherNumber);

    void dispatchWorkspaceWebhookEvent(params.workspaceId, "tally.bill.cancelled", {
      voucherId: row.id,
      voucherNumber: row.voucherNumber,
      voucherType: row.voucherType,
      partyName: row.partyName,
      companyName: company.name,
      paymentStatus: "deleted",
      deletedInTally: true,
    }).catch(() => 0);
  }

  if (affectedInventoryItemIds.size > 0) {
    recalculateCompanyInventoryMovements({
      db,
      workspaceId: params.workspaceId,
      companyId: company.id,
      itemIds: Array.from(affectedInventoryItemIds),
      now,
    });
  }

  if (deletedVoucherNumbers.length === 0) {
    db.update(tenantDataSchema.tallyCompanies)
      .set({ lastSyncedAt: now })
      .where(eq(tenantDataSchema.tallyCompanies.id, company.id))
      .run();
  }

  if (deletedVoucherNumbers.length > 0) {
    reconcileCompanyBillSettlementsAndPartyBalances({
      db,
      workspaceId: params.workspaceId,
      companyId: company.id,
      now,
      cancelPaidVoucherOutbox: (v) => cancelPendingOutboxJobsForVoucher(params.workspaceId, v),
    });

    db.update(tenantDataSchema.tallyCompanies)
      .set({ lastSyncedAt: now })
      .where(eq(tenantDataSchema.tallyCompanies.id, company.id))
      .run();

    if (params.sourceLabel !== "agent") {
      const endpoint = getOrCreateTallyWebhookEndpoint(params.workspaceId);
      controlDb()
        .update(controlSchema.tallyWebhookEndpoints)
        .set({
          eventsReceivedCount: endpoint.eventsReceivedCount + deletedVoucherNumbers.length,
          lastEventAt: now,
          ...(params.sourceIp ? { lastSourceIp: params.sourceIp.slice(0, 120) } : {}),
          ...(params.userAgent ? { lastUserAgent: params.userAgent.slice(0, 180) } : {}),
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(controlSchema.tallyWebhookEndpoints.id, endpoint.id))
        .run();
    }

    const corr = newEntityId("req", params.workspaceId, now);
    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: params.actorType,
      actorId: params.actorId,
      source: params.sourceLabel === "api" ? "api" : params.sourceLabel === "agent" ? "agent" : "webhook",
      action: "tally.vouchers.synced",
      outcome: "success",
      requestId: corr,
      correlationId: corr,
      durationMs: 4,
      summary: `Removed ${deletedVoucherNumbers.length} deleted Tally bill(s) from '${company.name}' (#${deletedVoucherNumbers.join(", #")})`,
    });
  }

  return {
    deletedCount: deletedVoucherNumbers.length,
    ignoredCompany: false,
    deletedVoucherNumbers,
  };
}

export function reconcileTallySyncBatch(params: {
  workspaceId: string;
  companyName: string;
  syncBatchId: string;
  actorType: ActorType;
  actorId: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  allowEmptyCompanyPurge?: boolean;
}): {
  deletedCount: number;
  ignoredCompany: boolean;
  deletedVoucherNumbers: string[];
} {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const safeKey = `${TALLY_BATCH_PREFIX}${params.syncBatchId.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 80)}`;
  const batchRow = db
    .select()
    .from(tenantDataSchema.settings)
    .where(eq(tenantDataSchema.settings.key, safeKey))
    .get();

  let seenGuids: string[] = [];
  if (batchRow?.valueJson) {
    try {
      const parsed = JSON.parse(batchRow.valueJson) as { guids?: string[] };
      if (Array.isArray(parsed.guids)) seenGuids = parsed.guids;
    } catch {
      seenGuids = [];
    }
  }

  // Interactive Day Book menu sync allows deleting the single last bill of a branch,
  // while still blocking accidental mass-deletion of 2+ bills unless explicitly confirmed.
  const companyGuid = toCompanySlugGuid(params.companyName);
  const compRow = db
    .select({ id: tenantDataSchema.tallyCompanies.id })
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
    .get();
  const existingSyncableCount = compRow
    ? db
        .select({ guid: tenantDataSchema.tallyVouchers.guid, voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber })
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.companyId, compRow.id))
        .all()
        .filter((r) => !r.guid.startsWith("vch_") && !r.voucherNumber.startsWith("SIM-")).length
    : 0;

  const res = reconcileTallyCompanySnapshot({
    workspaceId: params.workspaceId,
    companyName: params.companyName,
    activeCanonicalGuids: seenGuids,
    actorType: params.actorType,
    actorId: params.actorId,
    sourceLabel: "webhook",
    sourceIp: params.sourceIp,
    userAgent: params.userAgent,
    allowEmptyCompanyPurge: Boolean(params.allowEmptyCompanyPurge) || existingSyncableCount <= 1,
  });

  // Clean up batch state key & any expired batch keys older than 1 hour
  const cutoff = Date.now() - 3600_000;
  const allBatchRows = db
    .select()
    .from(tenantDataSchema.settings)
    .all()
    .filter((r) => r.key.startsWith(TALLY_BATCH_PREFIX));
  for (const r of allBatchRows) {
    if (r.key === safeKey || r.updatedAt < cutoff) {
      db.delete(tenantDataSchema.settings).where(eq(tenantDataSchema.settings.key, r.key)).run();
    }
  }

  return res;
}

export async function ingestTallyBillEventAndEnqueueAutomation(params: {
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  rawPayload: string | Record<string, unknown>;
  modeHint?: string;
  sourceLabel?: "webhook" | "api" | "agent";
  correlationId?: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  fullCompanySnapshot?: {
    companyName: string;
    hasExplicitDateSpan?: boolean;
  };
}): Promise<{
  upserted: number;
  deletedCount: number;
  stockItemsUpserted: number;
  godownsUpserted: number;
  partiesUpserted: number;
  ignoredCompanyCount: number;
  queuedJobs: number;
  skippedOptionalCount: number;
  detectedCompanyName: string | null;
  maxAlterId: number;
  vouchers: Array<{
    id: string;
    guid: string;
    voucherNumber: string;
    voucherType: string;
    partyName: string;
    paymentStatus: string;
    companyName: string;
    alterId: number;
    masterId: string | null;
  }>;
}> {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const ctrl = controlDb();
  const now = Date.now();
  const correlationId = params.correlationId || newEntityId("req", params.workspaceId, now);
  const routing = getTallyCompanyRoutingConfig(params.workspaceId);

  const wsRow = ctrl
    .select({
      name: controlSchema.workspaces.name,
      defaultTallyCompany: controlSchema.workspaces.defaultTallyCompany,
    })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  const existingCompanies = db
    .select({ name: tenantDataSchema.tallyCompanies.name })
    .from(tenantDataSchema.tallyCompanies)
    .all();
  const defaultCompanyName =
    wsRow?.defaultTallyCompany?.trim() ||
    (existingCompanies.length === 1 ? existingCompanies[0]!.name : "Primary Tally Company");

  const items: IncomingTallyBillItem[] = [];
  const incomingPdfPayloads: Array<{
    guid?: string;
    voucherNumber?: string;
    voucherType?: string;
    companyName?: string;
    alterId?: number;
    masterId?: string;
    pdfBase64: string;
  }> = [];
  const convertedToOptionalRefs: Array<{ guid: string; companyName: string }> = [];
  let skippedOptionalCount = 0;
  let skippedNonTargetOrZeroCount = 0;
  let ignoredCompanyCount = 0;
  let stockItemsUpserted = 0;
  let godownsUpserted = 0;
  let partiesUpserted = 0;
  let isMastersModePayload = false;
  let detectedCompanyName: string | null = params.fullCompanySnapshot?.companyName?.trim() || null;
  let maxAlterId = 0;
  let xmlHasExplicitDateSpan: boolean | undefined = params.fullCompanySnapshot?.hasExplicitDateSpan;
  const isXmlPayload = typeof params.rawPayload === "string" && params.rawPayload.trim().startsWith("<");

  if (isXmlPayload) {
    const rawXmlStr = params.rawPayload as string;
    if (/<(?:STOCKITEM|GODOWN|LEDGER|BILL)(?:\s|>)/i.test(rawXmlStr)) {
      const mOut = ingestTallyMastersXmlForWorkspace({
        workspaceId: params.workspaceId,
        rawXml: rawXmlStr,
        fallbackCompanyName: params.fullCompanySnapshot?.companyName || defaultCompanyName,
        isCompanyAllowed: (c) => isTallyCompanyAllowed(c, routing),
      });
      stockItemsUpserted += mOut.stockItemsUpserted;
      godownsUpserted += mOut.godownsUpserted;
      partiesUpserted += mOut.partiesUpserted;
    }

    const parsedXml = parseTallyXmlEnvelope(
      rawXmlStr,
      params.fullCompanySnapshot?.companyName || defaultCompanyName
    );
    skippedOptionalCount = parsedXml.skippedOptionalCount;
    if (parsedXml.detectedCompanyName) {
      detectedCompanyName = parsedXml.detectedCompanyName;
    }
    maxAlterId = parsedXml.maxAlterId;
    if (xmlHasExplicitDateSpan === undefined) {
      xmlHasExplicitDateSpan = parsedXml.hasExplicitDateSpan;
    }

    for (const opt of parsedXml.optionalItems) {
      const cName = (opt.companyName || detectedCompanyName || defaultCompanyName).trim();
      if (isTallyCompanyAllowed(cName, routing)) {
        convertedToOptionalRefs.push({ guid: opt.guid, companyName: cName });
      }
    }

    for (const v of parsedXml.vouchers) {
      const resolvedComp = (v.companyName || detectedCompanyName || defaultCompanyName).trim();
      if (!isTallyCompanyAllowed(resolvedComp, routing)) {
        ignoredCompanyCount++;
        continue;
      }
      items.push({
        guid: v.guid,
        masterId: v.masterId,
        companyName: resolvedComp,
        voucherNumber: v.voucherNumber,
        voucherType: v.voucherType,
        partyName: v.partyName,
        partyParentGroup: v.partyParentGroup,
        partyPhone: v.partyPhone,
        amountRupees: v.amountRupees,
        paidAmountRupees: v.paidAmountRupees,
        hasExplicitPaidAmount: Boolean(v.hasExplicitPaidAmount),
        narration: v.narration,
        ledgerAccountName: v.ledgerAccountName,
        billAllocations: v.billAllocations,
        originalCurrency: v.originalCurrency,
        originalAmountMinor: v.originalAmountMinor,
        exchangeRateMicros: v.exchangeRateMicros,
        voucherDate: new Date(v.voucherDate).toISOString(),
        dueDate: v.dueDate ? new Date(v.dueDate).toISOString() : undefined,
        alterId: v.alterId,
        isCancelled: v.isCancelled,
        isDeleted: v.isDeleted,
        lineItems: v.lineItems,
      });
    }
  } else {
    const rawParsedObj =
      typeof params.rawPayload === "string"
        ? (JSON.parse(params.rawPayload) as unknown)
        : params.rawPayload;
    const obj = unwrapTallyMultiPartJson(rawParsedObj);

    const parsedOpenComps = parseTallyOpenCompaniesInput(obj.openCompanies, obj.openCompaniesPipe);
    if (parsedOpenComps.length > 0) {
      registerTallyCompaniesForWorkspace({
        workspaceId: params.workspaceId,
        companies: parsedOpenComps,
        updateLastSyncedAt: true,
      });
    }

    const objMode = (
      typeof obj.mode === "string" && obj.mode.trim()
        ? obj.mode
        : params.modeHint ?? ""
    )
      .trim()
      .toLowerCase();
    if (objMode === "masters") {
      isMastersModePayload = true;
      const topComp = typeof obj.companyName === "string" ? obj.companyName.replace(/[\x00-\x1F]+/g, "").trim() : "";
      if (topComp && topComp !== "Primary Tally Company") {
        if (!detectedCompanyName) detectedCompanyName = topComp;
        registerTallyCompaniesForWorkspace({
          workspaceId: params.workspaceId,
          companies: [topComp],
          updateLastSyncedAt: true,
        });
      }
    }

    if (typeof obj.mastersXml === "string" && obj.mastersXml.trim().startsWith("<")) {
      const mOut = ingestTallyMastersXmlForWorkspace({
        workspaceId: params.workspaceId,
        rawXml: obj.mastersXml,
        fallbackCompanyName:
          (typeof obj.companyName === "string" && obj.companyName.trim()) ||
          params.fullCompanySnapshot?.companyName ||
          defaultCompanyName,
        isCompanyAllowed: (c) => isTallyCompanyAllowed(c, routing),
      });
      stockItemsUpserted += mOut.stockItemsUpserted;
      godownsUpserted += mOut.godownsUpserted;
      partiesUpserted += mOut.partiesUpserted;
    }

    if (
      isMastersModePayload ||
      obj.masterKind !== undefined ||
      obj.stockItems !== undefined ||
      obj.stockItem !== undefined ||
      obj.godowns !== undefined ||
      obj.godown !== undefined ||
      obj.partyLedgers !== undefined ||
      obj.partyLedger !== undefined ||
      obj.billClearances !== undefined
    ) {
      const jmOut = ingestTallyMastersJsonForWorkspace({
        workspaceId: params.workspaceId,
        payload: obj,
        fallbackCompanyName:
          (typeof obj.companyName === "string" && obj.companyName.replace(/[\x00-\x1F]+/g, "").trim()) ||
          params.fullCompanySnapshot?.companyName ||
          defaultCompanyName,
        isCompanyAllowed: (c) => isTallyCompanyAllowed(c, routing),
      });
      stockItemsUpserted += jmOut.stockItemsUpserted;
      godownsUpserted += jmOut.godownsUpserted;
      partiesUpserted += jmOut.partiesUpserted;
      if (jmOut.detectedCompanyName && !detectedCompanyName) {
        detectedCompanyName = jmOut.detectedCompanyName;
      }
    }

    const rawVoucherPdfs = toTallyJsonObjectArray(obj.voucherPdfs);
    for (const p of rawVoucherPdfs) {
      const pdfB64 = typeof p.pdfBase64 === "string" ? p.pdfBase64.trim() : "";
      if (!pdfB64) continue;
      incomingPdfPayloads.push({
        guid: p.guid ? String(p.guid).trim() : undefined,
        voucherNumber: p.voucherNumber ? String(p.voucherNumber).trim() : undefined,
        voucherType: p.voucherType ? String(p.voucherType).trim() : undefined,
        companyName: p.companyName ? String(p.companyName).trim() : undefined,
        alterId: p.alterId !== undefined ? Number(String(p.alterId).replace(/\D/g, "") || 0) : undefined,
        masterId: p.masterId ? String(p.masterId).replace(/\D/g, "") : undefined,
        pdfBase64: pdfB64,
      });
    }

    const hasInlineVoucherFields =
      !isMastersModePayload &&
      Boolean(
        obj.voucherNumber ||
          obj.billNumber ||
          obj.invoiceNumber ||
          obj.partyName ||
          obj.customerName ||
          obj.amountRupees !== undefined ||
          obj.amount !== undefined ||
          obj.guid
      );

    const rawBillsArr = toTallyJsonObjectArray(obj.bills);
    const rawVouchersArr = toTallyJsonObjectArray(obj.vouchers);
    const rawSingleBillArr = toTallyJsonObjectArray(obj.bill);

    const rawList: Array<Record<string, unknown>> =
      rawBillsArr.length > 0
        ? rawBillsArr
        : rawVouchersArr.length > 0
          ? rawVouchersArr
          : rawSingleBillArr.length > 0
            ? rawSingleBillArr
            : hasInlineVoucherFields
              ? [obj]
              : [];

    for (const entry of rawList) {
      const compName = entry.companyName
        ? String(entry.companyName).replace(/[\x00-\x1F]+/g, "").trim()
        : "";
      const effectiveComp = compName || defaultCompanyName;
      if (compName && !detectedCompanyName) detectedCompanyName = compName;

      if (!isTallyCompanyAllowed(effectiveComp, routing)) {
        ignoredCompanyCount++;
        continue;
      }

      const rawGuidStr = entry.guid ? String(entry.guid).trim() : "";
      if (/^(yes|true|1)$/i.test(String(entry.isOptional ?? ""))) {
        skippedOptionalCount++;
        if (rawGuidStr) {
          convertedToOptionalRefs.push({ guid: rawGuidStr, companyName: effectiveComp });
        }
        continue;
      }

      const inAlterMode = /^(yes|true|1)$/i.test(String(entry.inAlterMode ?? ""));
      const isDeleted =
        /^(yes|true|1|deleted|delete)$/i.test(String(entry.isDeleted ?? "")) ||
        /^delete$/i.test(String(entry.action ?? ""));
      const isCancelled =
        !isDeleted && /^(yes|true|1|cancelled)$/i.test(String(entry.isCancelled ?? ""));

      const rawTypeCandidate = String(
        entry.baseVoucherType ?? entry.voucherType ?? entry.type ?? "Sales"
      )
        .replace(/[\x00-\x1F]+/g, "")
        .trim();
      if (
        /^(contra|journal|memorandum|reversing\s*journal|stock\s*journal|physical\s*stock|sales\s*order|purchase\s*order|delivery\s*note|receipt\s*note|rejections\s*in|rejections\s*out)$/i.test(
          rawTypeCandidate
        )
      ) {
        skippedNonTargetOrZeroCount++;
        continue;
      }

      const explicitCurrencyRate = entry.exchangeRate
        ? String(entry.exchangeRate)
        : entry.currencyRate
          ? String(entry.currencyRate)
          : undefined;
      const candidateAmounts = [
        entry.amountRupees,
        entry.amount,
        entry.partyLedgerAmount,
        entry.firstAllLedgerAmount,
        entry.inventoryTotalAmount,
      ];
      let amountRupees = 0;
      let originalCurrency = entry.currency ? String(entry.currency).trim().toUpperCase() : "INR";
      let originalAmountMinor: number | null = null;
      let exchangeRateMicros: number | null = null;
      for (const cand of candidateAmounts) {
        if (cand !== undefined && cand !== null) {
          const parsedInfo = parseTallyCurrencyAndAmount(String(cand), explicitCurrencyRate);
          if (parsedInfo.inrRupees > 0) {
            amountRupees = parsedInfo.inrRupees;
            if (parsedInfo.originalCurrency !== "INR") {
              originalCurrency = parsedInfo.originalCurrency;
              originalAmountMinor = parsedInfo.originalAmountMinor;
              exchangeRateMicros = parsedInfo.exchangeRateMicros;
            }
            break;
          }
        }
      }

      const parsedJsonLineItems = parseJsonVoucherLineItems(
        entry.lineItems ?? entry.items,
        entry.lineItemsPacked
      );

      if (amountRupees <= 0 && parsedJsonLineItems.length > 0) {
        amountRupees =
          Math.round(parsedJsonLineItems.reduce((acc, l) => acc + l.amountRupees, 0) * 100) / 100;
      }

      const alterIdVal = Number(String(entry.alterId ?? "0").replace(/\D/g, "") || 0);
      const rawMasterIdStr = entry.masterId
        ? String(entry.masterId).replace(/\D/g, "").replace(/^0+$/, "")
        : "";
      const rawPartyName = String(entry.partyName ?? entry.customerName ?? "")
        .replace(/[\x00-\x1F]+/g, "")
        .trim();
      let voucherNumber = String(
        entry.voucherNumber ?? entry.billNumber ?? entry.invoiceNumber ?? ""
      ).trim();

      // Support unnumbered Tally vouchers or deleted/cancelled vouchers WITHOUT static "SALES-AUTO" collisions!
      if (
        !voucherNumber &&
        (rawPartyName || rawGuidStr || rawMasterIdStr) &&
        (amountRupees > 0 || isCancelled || isDeleted)
      ) {
        const guidSuffix = rawGuidStr
          ? rawGuidStr.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()
          : "";
        const normType = normalizeVoucherType(
          String(entry.voucherType ?? entry.type ?? "Sales"),
          entry.baseVoucherType ? String(entry.baseVoucherType) : undefined
        );
        const uniqueSuffix =
          rawMasterIdStr || alterIdVal || guidSuffix || `${newId().slice(-6).toUpperCase()}-AUTO`;
        voucherNumber = `${normType.toUpperCase()}-${uniqueSuffix}`;
      }

      if (
        !voucherNumber ||
        (!isCancelled && !isDeleted && (!Number.isFinite(amountRupees) || amountRupees <= 0))
      ) {
        if ((rawGuidStr || voucherNumber) && rawPartyName && amountRupees === 0) {
          skippedNonTargetOrZeroCount++;
        }
        continue;
      }

      if (alterIdVal > maxAlterId) maxAlterId = alterIdVal;

      const hasExplicitPaidAmount = entry.paidAmountRupees !== undefined;
      const parsedPaidRupees = hasExplicitPaidAmount
        ? parseTallyNumericAmount(String(entry.paidAmountRupees))
        : 0;

      const parsedBillAllocations: ParsedTallyBillAllocation[] = [];
      const rawBillAllocObjects = toTallyJsonObjectArray(entry.billAllocations);
      if (typeof entry.billAllocationsPacked === "string" && entry.billAllocationsPacked.trim()) {
        const chunks = entry.billAllocationsPacked
          .split("^^")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const chunk of chunks) {
          const [bName = "", bType = "Agst Ref", bAmt = ""] = chunk.split("~~");
          if (bName.trim()) {
            rawBillAllocObjects.push({
              billName: bName.trim(),
              billType: bType.trim() || "Agst Ref",
              amountRupees: bAmt.trim(),
            });
          }
        }
      }
      for (const ba of rawBillAllocObjects) {
        const bName = String(ba.billName ?? ba.name ?? "")
          .replace(/[\x00-\x1F]+/g, "")
          .trim();
        if (!bName || /^not\s*applicable$/i.test(bName)) continue;
        const rawBillAmtRupees =
          ba.amountRupees !== undefined || ba.amount !== undefined
            ? parseTallyNumericAmount(String(ba.amountRupees ?? ba.amount ?? ""))
            : amountRupees;
        const bAmtPaise =
          ba.amountPaise !== undefined
            ? Math.max(0, Math.round(Number(ba.amountPaise) || 0))
            : rupeesToPaise(Math.max(0, rawBillAmtRupees));
        if (bAmtPaise <= 0) continue;
        const normBillType = normalizeBillAllocationType(String(ba.billType ?? "Agst Ref"));
        if (
          parsedBillAllocations.some(
            (existingBa) =>
              existingBa.billName.toLowerCase() === bName.toLowerCase() &&
              existingBa.billType === normBillType &&
              existingBa.amountPaise === bAmtPaise
          )
        ) {
          continue;
        }
        parsedBillAllocations.push({
          billName: bName,
          billType: normBillType,
          amountPaise: bAmtPaise,
        });
      }
      const explicitAgstBill = String(
        entry.againstBillNumber ?? entry.agstRef ?? entry.refBillNumber ?? ""
      ).trim();
      if (
        explicitAgstBill &&
        !parsedBillAllocations.some(
          (a) => a.billName.toLowerCase() === explicitAgstBill.toLowerCase()
        )
      ) {
        parsedBillAllocations.push({
          billName: explicitAgstBill,
          billType: "Agst Ref",
          amountPaise: Math.max(0, rupeesToPaise(amountRupees)),
        });
      }

      const rawNarrationStr = entry.narration
        ? String(entry.narration).trim()
        : entry.remarks
          ? String(entry.remarks).trim()
          : undefined;
      const cleanedLedgerAcct = entry.ledgerAccountName
        ? String(entry.ledgerAccountName).replace(/[\x00-\x1F]+/g, "").trim()
        : entry.bankOrCashLedger
          ? String(entry.bankOrCashLedger).replace(/[\x00-\x1F]+/g, "").trim()
          : "";
      const rawLedgerAcctStr =
        cleanedLedgerAcct && !/^not\s*applicable$/i.test(cleanedLedgerAcct)
          ? cleanedLedgerAcct
          : undefined;
      const cleanedParentGroup = entry.partyParentGroup
        ? String(entry.partyParentGroup).replace(/[\x00-\x1F]+/g, "").trim()
        : entry.ledgerGroup
          ? String(entry.ledgerGroup).replace(/[\x00-\x1F]+/g, "").trim()
          : "";

      const syncBatchId = entry.syncBatchId ? String(entry.syncBatchId).trim() : undefined;
      const inlinePdfB64 =
        typeof entry.nativePdfBase64 === "string" && entry.nativePdfBase64.trim()
          ? entry.nativePdfBase64.trim()
          : typeof entry.pdfBase64 === "string" && entry.pdfBase64.trim()
            ? entry.pdfBase64.trim()
            : undefined;

      items.push({
        guid: rawGuidStr || undefined,
        masterId: rawMasterIdStr || undefined,
        companyName: effectiveComp,
        voucherNumber,
        voucherType: normalizeVoucherType(
          String(entry.voucherType ?? entry.type ?? "Sales"),
          entry.baseVoucherType ? String(entry.baseVoucherType) : undefined
        ),
        partyName: rawPartyName || "Customer",
        partyParentGroup:
          cleanedParentGroup && !/^not\s*applicable$/i.test(cleanedParentGroup)
            ? cleanedParentGroup
            : undefined,
        partyPhone: entry.partyPhone
          ? String(entry.partyPhone)
          : entry.customerPhone
            ? String(entry.customerPhone)
            : undefined,
        amountRupees: Number.isFinite(amountRupees) && amountRupees > 0 ? amountRupees : 0,
        paidAmountRupees: parsedPaidRupees,
        hasExplicitPaidAmount,
        narration: rawNarrationStr,
        ledgerAccountName: rawLedgerAcctStr,
        billAllocations: parsedBillAllocations.length > 0 ? parsedBillAllocations : undefined,
        originalCurrency,
        originalAmountMinor,
        exchangeRateMicros,
        voucherDate: entry.voucherDate ? String(entry.voucherDate) : undefined,
        dueDate: entry.dueDate ? String(entry.dueDate) : undefined,
        alterId: alterIdVal > 0 ? alterIdVal : undefined,
        inAlterMode,
        isCancelled,
        isDeleted,
        syncBatchId: syncBatchId || undefined,
        nativePdfBase64: inlinePdfB64,
        lineItems: parsedJsonLineItems.length > 0 ? parsedJsonLineItems : undefined,
      });
    }
  }

  let deletedCount = 0;
  const touchedCompanyIds = new Set<string>();

  // If a previously synced voucher was edited in Tally and marked Optional, remove it cleanly
  for (const optRef of convertedToOptionalRefs) {
    const cGuid = toCompanySlugGuid(optRef.companyName);
    const comp = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, cGuid))
      .get();
    if (!comp) continue;
    const existingOpt = findExistingVoucherForMutation(db, comp.id, cGuid, optRef.guid);
    if (existingOpt) {
      const optAffectedItems = collectVoucherStockItemIdsBeforeDelete(db, existingOpt.id);
      cancelPendingOutboxJobsForVoucher(params.workspaceId, existingOpt);
      removeStoredTallyVoucherPdf(params.workspaceId, existingOpt);
      db.delete(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.id, existingOpt.id))
        .run();
      if (optAffectedItems.length > 0) {
        recalculateCompanyInventoryMovements({
          db,
          workspaceId: params.workspaceId,
          companyId: comp.id,
          itemIds: optAffectedItems,
          now,
        });
      }
      touchedCompanyIds.add(comp.id);
      deletedCount++;
    }
  }

  if (
    items.length === 0 &&
    deletedCount === 0 &&
    stockItemsUpserted === 0 &&
    godownsUpserted === 0 &&
    partiesUpserted === 0 &&
    !isMastersModePayload &&
    incomingPdfPayloads.length === 0 &&
    !params.fullCompanySnapshot
  ) {
    if (
      skippedOptionalCount > 0 ||
      ignoredCompanyCount > 0 ||
      skippedNonTargetOrZeroCount > 0
    ) {
      return {
        upserted: 0,
        deletedCount: 0,
        stockItemsUpserted: 0,
        godownsUpserted: 0,
        partiesUpserted: 0,
        ignoredCompanyCount,
        queuedJobs: 0,
        skippedOptionalCount,
        detectedCompanyName,
        maxAlterId,
        vouchers: [],
      };
    }
    const outdatedCheck = detectOutdatedTdlVersion(params.userAgent);
    if (outdatedCheck.isOutdated) {
      const expectedTdlFile = buildWorkspaceTdlFilename(wsRow?.name ?? "business");
      const expectedBrandTitle = buildTallyDisplayBrandTitle(wsRow?.name ?? "Business");
      throw new RslError(
        "RSL-VAL-1001",
        `Tally Prime is still running an older .tdl add-on (v${outdatedCheck.detectedVersion}) that sent empty voucher fields. Download ${expectedTdlFile} v${outdatedCheck.latestVersion} from Connect Tally Prime, overwrite your existing .tdl file, reload it in Tally Prime (F1 -> TDLs & Add-Ons -> F4 -> Ctrl+A), and click '${expectedBrandTitle} - Sync All Now'.`
      );
    }
    throw new RslError(
      "RSL-VAL-1001",
      "No valid Tally bill or receipt found in request payload. Provide voucherNumber, partyName, and amountRupees."
    );
  }

  const savedVouchers: Array<{
    row: typeof tenantDataSchema.tallyVouchers.$inferSelect;
    companyName: string;
    masterId: string | null;
  }> = [];
  const batchGuidsMap = new Map<string, string[]>();
  const activeSnapshotGuids: string[] = [];

  for (const item of items) {
    const companyName = (item.companyName || defaultCompanyName).trim();
    const companyGuid = toCompanySlugGuid(companyName);

    let company = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();

    if (item.isDeleted) {
      if (company) {
        const existingToDel = findExistingVoucherForMutation(
          db,
          company.id,
          companyGuid,
          item.guid,
          item.voucherNumber,
          item.voucherType,
          item.masterId
        );
        if (existingToDel) {
          const delAffectedItems = collectVoucherStockItemIdsBeforeDelete(db, existingToDel.id);
          cancelPendingOutboxJobsForVoucher(params.workspaceId, existingToDel);
          removeStoredTallyVoucherPdf(params.workspaceId, existingToDel);
          db.delete(tenantDataSchema.tallyVouchers)
            .where(eq(tenantDataSchema.tallyVouchers.id, existingToDel.id))
            .run();
          if (delAffectedItems.length > 0) {
            recalculateCompanyInventoryMovements({
              db,
              workspaceId: params.workspaceId,
              companyId: company.id,
              itemIds: delAffectedItems,
              now,
            });
          }
          touchedCompanyIds.add(company.id);
          deletedCount++;
          void dispatchWorkspaceWebhookEvent(params.workspaceId, "tally.bill.cancelled", {
            voucherId: existingToDel.id,
            voucherNumber: existingToDel.voucherNumber,
            voucherType: existingToDel.voucherType,
            partyName: existingToDel.partyName,
            companyName: company.name,
            paymentStatus: "deleted",
            deletedInTally: true,
          }).catch(() => 0);
        }
      }
      continue;
    }

    if (!company) {
      const compId = newEntityId("tco", params.workspaceId, now);
      db.insert(tenantDataSchema.tallyCompanies)
        .values({
          id: compId,
          companyGuid,
          name: companyName,
          financialYearFrom: "2026-04-01",
          lastAlterId: item.alterId ?? 1,
          lastSyncedAt: now,
          createdAt: now,
        })
        .run();
      company = db
        .select()
        .from(tenantDataSchema.tallyCompanies)
        .where(eq(tenantDataSchema.tallyCompanies.id, compId))
        .get()!;
    } else {
      const nextAlter = Math.max(company.lastAlterId, item.alterId ?? company.lastAlterId + 1);
      db.update(tenantDataSchema.tallyCompanies)
        .set({ lastAlterId: nextAlter, lastSyncedAt: now })
        .where(eq(tenantDataSchema.tallyCompanies.id, company.id))
        .run();
    }

    touchedCompanyIds.add(company.id);

    const { guid, collidedWithDifferentBillNumber } = resolveCanonicalVoucherGuid(
      db,
      company.id,
      companyGuid,
      item.guid,
      item.masterId,
      item.voucherType,
      item.voucherNumber,
      item.partyName,
      {
        inAlterMode: item.inAlterMode,
        isAuthoritativeSource:
          isXmlPayload || Boolean(item.syncBatchId || params.fullCompanySnapshot),
        isMutationFlag: Boolean(item.isCancelled || item.isDeleted),
      }
    );

    const existingRow = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, guid))
      .get();

    // When Tally cancels a voucher (Alt+X), Tally blanks PartyLedgerName and Amount=0.
    // Preserve previously synced partyName / phone / amountPaise when cancelling an existing voucher!
    const effectivePartyName =
      item.isCancelled &&
      existingRow &&
      (!item.partyName || item.partyName === "Customer" || item.partyName === "Deleted")
        ? existingRow.partyName
        : item.partyName;

    const parsedPhoneE164 = normalizePhoneOrNull(item.partyPhone);
    const phoneE164 =
      parsedPhoneE164 ?? (item.isCancelled && existingRow ? existingRow.partyPhoneE164 : null);

    const rawAmountPaise = rupeesToPaise(item.amountRupees);
    const amountPaise =
      item.isCancelled && existingRow && rawAmountPaise === 0
        ? existingRow.amountPaise
        : rawAmountPaise;

    const isSettlementVoucher =
      item.voucherType === "Receipt" ||
      item.voucherType === "Payment" ||
      item.voucherType === "CreditNote" ||
      item.voucherType === "DebitNote";
    const directPaidPaise = isSettlementVoucher
      ? amountPaise
      : isCashOrBankPartyName(effectivePartyName)
        ? amountPaise
        : item.hasExplicitPaidAmount
          ? Math.min(amountPaise, rupeesToPaise(item.paidAmountRupees ?? 0))
          : existingRow
            ? Math.min(amountPaise, existingRow.directPaidPaise)
            : 0;
    const paidAmountPaise = isSettlementVoucher
      ? amountPaise
      : Math.max(
          directPaidPaise,
          existingRow && !item.isCancelled ? Math.min(amountPaise, existingRow.paidAmountPaise) : 0
        );

    const paymentStatus = item.isCancelled
      ? "cancelled"
      : isSettlementVoucher || (amountPaise > 0 && paidAmountPaise >= amountPaise)
        ? "paid"
        : paidAmountPaise > 0
          ? "partial"
          : "unpaid";

    const vDate = item.voucherDate ? parseTallyXmlDate(item.voucherDate) : existingRow?.voucherDate ?? now;
    const dueDate =
      item.voucherType === "Sales" || item.voucherType === "Purchase"
        ? item.dueDate
          ? parseTallyDueDateOrCreditDays(item.dueDate, vDate)
          : vDate + 15 * 86400_000
        : null;

    const resolvedMasterId = collidedWithDifferentBillNumber
      ? null
      : item.masterId || existingRow?.masterId || null;
    const resolvedCurrency = item.originalCurrency || existingRow?.originalCurrency || "INR";
    const resolvedOrigMinor =
      item.originalAmountMinor !== undefined
        ? item.originalAmountMinor
        : existingRow?.originalAmountMinor ?? null;
    const resolvedExRateMicros =
      item.exchangeRateMicros !== undefined
        ? item.exchangeRateMicros
        : existingRow?.exchangeRateMicros ?? null;
    const resolvedNarration =
      item.narration !== undefined && item.narration !== ""
        ? item.narration
        : existingRow?.narration ?? null;
    const resolvedLedgerAcct =
      item.ledgerAccountName !== undefined && item.ledgerAccountName !== ""
        ? item.ledgerAccountName
        : existingRow?.ledgerAccountName ?? null;
    const resolvedBillAllocationsJson =
      item.billAllocations && item.billAllocations.length > 0
        ? serializeBillAllocationsJson(item.billAllocations)
        : existingRow?.billAllocationsJson ?? "[]";

    const contentHash = crypto
      .createHash("sha256")
      .update(
        `${guid}|${item.voucherNumber}|${effectivePartyName}|${amountPaise}|${directPaidPaise}|${paymentStatus}|${vDate}|${dueDate ?? 0}|${resolvedCurrency}|${resolvedBillAllocationsJson}`
      )
      .digest("hex")
      .slice(0, 32);

    if (phoneE164) {
      db.insert(tenantDataSchema.contacts)
        .values({
          id: newEntityId("cnt", params.workspaceId, now),
          name: effectivePartyName,
          phoneE164,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    const rowAlterId = item.alterId ?? company.lastAlterId + 1;
    db.insert(tenantDataSchema.tallyVouchers)
      .values({
        id: newEntityId("tvch", params.workspaceId, now),
        guid,
        masterId: resolvedMasterId,
        companyId: company.id,
        voucherNumber: item.voucherNumber,
        voucherType: item.voucherType,
        partyName: effectivePartyName,
        partyPhoneE164: phoneE164,
        amountPaise,
        paidAmountPaise,
        directPaidPaise,
        narration: resolvedNarration,
        ledgerAccountName: resolvedLedgerAcct,
        billAllocationsJson: resolvedBillAllocationsJson,
        originalCurrency: resolvedCurrency,
        originalAmountMinor: resolvedOrigMinor,
        exchangeRateMicros: resolvedExRateMicros,
        voucherDate: vDate,
        dueDate,
        paymentStatus,
        alterId: rowAlterId,
        contentHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.tallyVouchers.guid,
        set: {
          masterId: resolvedMasterId,
          companyId: company.id,
          voucherNumber: item.voucherNumber,
          voucherType: item.voucherType,
          partyName: effectivePartyName,
          partyPhoneE164: phoneE164,
          amountPaise,
          paidAmountPaise,
          directPaidPaise,
          narration: resolvedNarration,
          ledgerAccountName: resolvedLedgerAcct,
          billAllocationsJson: resolvedBillAllocationsJson,
          originalCurrency: resolvedCurrency,
          originalAmountMinor: resolvedOrigMinor,
          exchangeRateMicros: resolvedExRateMicros,
          voucherDate: vDate,
          dueDate,
          paymentStatus,
          alterId: rowAlterId,
          contentHash,
          updatedAt: now,
        },
      })
      .run();

    upsertWorkspaceTallyParty({
      db,
      workspaceId: params.workspaceId,
      companyId: company.id,
      partyName: effectivePartyName,
      voucherType: item.voucherType,
      parentGroup: item.partyParentGroup,
      phoneE164,
      now,
    });

    const row = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.guid, guid))
      .get();

    if (row) {
      if (item.isCancelled) {
        const cancelledItemIds = collectVoucherStockItemIdsBeforeDelete(db, row.id);
        cancelPendingOutboxJobsForVoucher(params.workspaceId, row);
        removeStoredTallyVoucherPdf(params.workspaceId, row);
        if (cancelledItemIds.length > 0) {
          recalculateCompanyInventoryMovements({
            db,
            workspaceId: params.workspaceId,
            companyId: company.id,
            itemIds: cancelledItemIds,
            now,
          });
        }
      } else {
        if (item.lineItems && item.lineItems.length > 0) {
          syncVoucherInventoryLineItems({
            db,
            workspaceId: params.workspaceId,
            companyId: company.id,
            voucher: row,
            lineItems: item.lineItems,
            now,
          });
        }

        // Link any pre-staged native Tally PDF or save inline native PDF BEFORE automation enqueue!
        linkPendingTallyPdfToSavedVoucher(params.workspaceId, row, item.guid);
        const matchingPdfEntry = incomingPdfPayloads.find(
          (p) =>
            (p.guid && (p.guid === item.guid || p.guid === row.guid)) ||
            (!p.guid && p.voucherNumber === row.voucherNumber)
        );
        const b64ToSave = item.nativePdfBase64 || matchingPdfEntry?.pdfBase64;
        if (b64ToSave) {
          try {
            saveNativeTallyVoucherPdf({
              workspaceId: params.workspaceId,
              voucherId: row.id,
              voucherGuid: row.guid,
              voucherNumber: row.voucherNumber,
              voucherType: row.voucherType,
              companyName: company.name,
              alterId: row.alterId,
              masterId: item.masterId ?? matchingPdfEntry?.masterId ?? null,
              pdfBuffer: Buffer.from(b64ToSave, "base64"),
              capturedFrom: `${params.sourceLabel ?? "webhook"}_native`,
            });
          } catch {
            // Non-blocking if invalid PDF bytes
          }
        }
      }
      savedVouchers.push({ row, companyName: company.name, masterId: item.masterId ?? null });
      activeSnapshotGuids.push(row.guid);
      if (item.syncBatchId) {
        const list = batchGuidsMap.get(item.syncBatchId) ?? [];
        list.push(row.guid);
        batchGuidsMap.set(item.syncBatchId, list);
      }
    }
  }

  // Also persist any standalone native PDFs sent in voucherPdfs for already-synced vouchers
  for (const pdfEntry of incomingPdfPayloads) {
    try {
      saveNativeTallyVoucherPdf({
        workspaceId: params.workspaceId,
        voucherGuid: pdfEntry.guid,
        voucherNumber: pdfEntry.voucherNumber,
        voucherType: pdfEntry.voucherType,
        companyName: pdfEntry.companyName || detectedCompanyName || defaultCompanyName,
        alterId: pdfEntry.alterId,
        masterId: pdfEntry.masterId ?? null,
        pdfBuffer: Buffer.from(pdfEntry.pdfBase64, "base64"),
        capturedFrom: `${params.sourceLabel ?? "webhook"}_native`,
      });
    } catch {
      // Non-blocking
    }
  }

  for (const [batchId, guids] of batchGuidsMap.entries()) {
    appendGuidsToSyncBatch(db, batchId, guids);
  }

  if (params.fullCompanySnapshot?.companyName) {
    const snapRes = reconcileTallyCompanySnapshot({
      workspaceId: params.workspaceId,
      companyName: params.fullCompanySnapshot.companyName,
      activeCanonicalGuids: activeSnapshotGuids,
      actorType: params.actorType,
      actorId: params.actorId,
      sourceLabel: params.sourceLabel,
      sourceIp: params.sourceIp,
      userAgent: params.userAgent,
      hasExplicitDateSpan: xmlHasExplicitDateSpan,
    });
    deletedCount += snapRes.deletedCount;
  }

  // Reconcile Bill-Wise settlements (Paid in Tally: Cash Counter, Agst Ref, Credit/Debit Note, FIFO)
  // and recompute Client/Supplier Ledger closing balances across all touched companies!
  for (const compId of touchedCompanyIds) {
    reconcileCompanyBillSettlementsAndPartyBalances({
      db,
      workspaceId: params.workspaceId,
      companyId: compId,
      now,
      cancelPaidVoucherOutbox: (v) => cancelPendingOutboxJobsForVoucher(params.workspaceId, v),
    });
  }

  // Refresh savedVouchers rows after settlement reconciliation so returned paymentStatus/paidAmountPaise are 100% current
  for (const sv of savedVouchers) {
    const refreshed = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, sv.row.id))
      .get();
    if (refreshed) {
      sv.row = refreshed;
    }
  }

  const totalMutated =
    savedVouchers.length + deletedCount + stockItemsUpserted + godownsUpserted + partiesUpserted;
  if (totalMutated > 0 || isMastersModePayload) {
    db.insert(tenantDataSchema.syncRuns)
      .values({
        id: newEntityId("sync", params.workspaceId, now),
        companyId: null,
        source: params.sourceLabel ?? "webhook",
        vouchersUpserted: savedVouchers.length,
        durationMs: 8,
        status: "success",
        createdAt: now,
      })
      .run();

    if (params.sourceLabel !== "agent") {
      const endpoint = getOrCreateTallyWebhookEndpoint(params.workspaceId);
      const addedEvents = Math.max(
        1,
        savedVouchers.length + deletedCount + (stockItemsUpserted + partiesUpserted + godownsUpserted > 0 ? 1 : 0)
      );
      ctrl
        .update(controlSchema.tallyWebhookEndpoints)
        .set({
          eventsReceivedCount: endpoint.eventsReceivedCount + addedEvents,
          lastEventAt: now,
          ...(params.sourceIp ? { lastSourceIp: params.sourceIp.slice(0, 120) } : {}),
          ...(params.userAgent ? { lastUserAgent: params.userAgent.slice(0, 180) } : {}),
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(eq(controlSchema.tallyWebhookEndpoints.id, endpoint.id))
        .run();
    }
  }

  let queuedJobs = 0;
  for (const entry of savedVouchers) {
    if (entry.row.paymentStatus !== "cancelled") {
      queuedJobs += await enqueueMatchingAutomationsForVoucher({
        workspaceId: params.workspaceId,
        actorType: params.actorType,
        actorId: params.actorId,
        correlationId,
        companyName: entry.companyName,
        voucher: entry.row,
      });
    }

    const eventName =
      entry.row.paymentStatus === "cancelled"
        ? "tally.bill.cancelled"
        : entry.row.voucherType === "Receipt" || entry.row.voucherType === "Payment"
          ? "tally.payment.received"
          : "tally.bill.created";
    void dispatchWorkspaceWebhookEvent(params.workspaceId, eventName, {
      voucherId: entry.row.id,
      voucherNumber: entry.row.voucherNumber,
      voucherType: entry.row.voucherType,
      partyName: entry.row.partyName,
      partyPhoneE164: entry.row.partyPhoneE164,
      amountPaise: entry.row.amountPaise,
      paidAmountPaise: entry.row.paidAmountPaise,
      paymentStatus: entry.row.paymentStatus,
    }).catch(() => 0);
  }

  if (totalMutated > 0) {
    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: params.actorType,
      actorId: params.actorId,
      source: params.sourceLabel === "api" ? "api" : params.sourceLabel === "agent" ? "agent" : "webhook",
      action: "tally.vouchers.synced",
      outcome: "success",
      requestId: correlationId,
      correlationId,
      durationMs: 9,
      summary: `Synced ${savedVouchers.length} Tally bill(s)${
        stockItemsUpserted > 0 ? `, ${stockItemsUpserted} product(s)` : ""
      }${
        partiesUpserted > 0 ? `, ${partiesUpserted} party ledger(s)` : ""
      }${
        godownsUpserted > 0 ? `, ${godownsUpserted} godown(s)` : ""
      }${
        deletedCount > 0 ? `, removed ${deletedCount} deleted bill(s)` : ""
      } via ${params.sourceLabel ?? "webhook"} (${queuedJobs} WhatsApp message(s) queued)`,
    });
  }

  return {
    upserted: savedVouchers.length,
    deletedCount,
    stockItemsUpserted,
    godownsUpserted,
    partiesUpserted,
    ignoredCompanyCount,
    queuedJobs,
    skippedOptionalCount,
    detectedCompanyName,
    maxAlterId,
    vouchers: savedVouchers.map(({ row, companyName, masterId }) => ({
      id: row.id,
      guid: row.guid,
      voucherNumber: row.voucherNumber,
      voucherType: row.voucherType,
      partyName: row.partyName,
      paymentStatus: row.paymentStatus,
      companyName,
      alterId: row.alterId,
      masterId,
    })),
  };
}

export function listAllPlatformTallyWebhooks() {
  const ctrl = controlDb();
  const endpoints = ctrl
    .select()
    .from(controlSchema.tallyWebhookEndpoints)
    .orderBy(desc(controlSchema.tallyWebhookEndpoints.updatedAt))
    .all();

  const workspaces = ctrl.select().from(controlSchema.workspaces).all();
  const wsMap = new Map(workspaces.map((w) => [w.id, w]));

  return endpoints.map((ep) => {
    let activeRulesCount = 0;
    try {
      const rules = tenantDataDb({ workspaceId: ep.workspaceId })
        .select()
        .from(tenantDataSchema.tallyAutomationRules)
        .where(eq(tenantDataSchema.tallyAutomationRules.active, true))
        .all();
      activeRulesCount = rules.length;
    } catch {
      // Ignore inaccessible workspace
    }

    const ws = wsMap.get(ep.workspaceId);
    return {
      ...ep,
      workspaceName: ws?.name ?? ep.workspaceId,
      workspaceSlug: ws?.slug ?? "app",
      activeRulesCount,
      liveStatus: computeTallyWebhookLiveStatus(ep),
    };
  });
}

export interface LocalTallyPortProbe {
  reachable: boolean;
  port: number;
  activeCompanyName: string | null;
  openCompanies: string[];
  voucherCount: number;
  errorMessage: string | null;
}

export function buildLocalTallyOpenCompaniesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLOpenCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLOpenCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <NATIVEMETHOD>Name, GUID, StartingFrom</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function buildLocalTallyExportXml(sinceAlterId = 0, companyName?: string): string {
  const companyStatic = companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXml(companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLSyncVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE>20000401</SVFROMDATE>
        <SVTODATE>20990331</SVTODATE>${companyStatic}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLSyncVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Date, VoucherNumber, VoucherTypeName, PartyLedgerName, PartyMobileNo, Amount, BasicDueDateOfPymt, Narration, IsCancelled, IsOptional</NATIVEMETHOD>
            <NATIVEMETHOD>LedgerEntries.LedgerName, LedgerEntries.IsPartyLedger, LedgerEntries.Amount, LedgerEntries.BillAllocations.Name, LedgerEntries.BillAllocations.BillType, LedgerEntries.BillAllocations.Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllLedgerEntries.LedgerName, AllLedgerEntries.IsPartyLedger, AllLedgerEntries.Amount, AllLedgerEntries.BillAllocations.Name, AllLedgerEntries.BillAllocations.BillType, AllLedgerEntries.BillAllocations.Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllInventoryEntries.StockItemName, AllInventoryEntries.ActualQty, AllInventoryEntries.BilledQty, AllInventoryEntries.Rate, AllInventoryEntries.Discount, AllInventoryEntries.Amount, AllInventoryEntries.IsDeemedPositive, AllInventoryEntries.BatchAllocations.GodownName, AllInventoryEntries.BatchAllocations.BatchName, AllInventoryEntries.BatchAllocations.ExpiryPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>InventoryEntries.StockItemName, InventoryEntries.ActualQty, InventoryEntries.BilledQty, InventoryEntries.Rate, InventoryEntries.Discount, InventoryEntries.Amount, InventoryEntries.IsDeemedPositive, InventoryEntries.BatchAllocations.GodownName, InventoryEntries.BatchAllocations.BatchName</NATIVEMETHOD>
            <COMPUTE>RSLPartyPhone : $LedgerMobile:Ledger:$PartyLedgerName</COMPUTE>
            <COMPUTE>RSLPartyGroup : $Parent:Ledger:$PartyLedgerName</COMPUTE>
            <COMPUTE>RSLBaseVchType : $Parent:VoucherType:$VoucherTypeName</COMPUTE>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
            <FILTER>RSLAlterFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="RSLAlterFilter">$AlterID > ${Math.max(0, Math.trunc(sinceAlterId))}</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Exports exact native Tally Prime printed PDFs (%PDF-1.x) from local Port 9000
 * for newly created or altered vouchers without modifying the client's invoice format.
 */
export async function captureNativePdfsForVouchersFromLocalPort9000(params: {
  workspaceId: string;
  vouchers: Array<{
    id: string;
    guid: string;
    voucherNumber: string;
    voucherType: string;
    companyName: string;
    alterId: number;
    masterId: string | null;
    paymentStatus?: string;
  }>;
  port?: number;
}): Promise<{ capturedCount: number }> {
  const safePort =
    params.port && Number.isInteger(params.port) && params.port >= 1024 && params.port <= 65535
      ? params.port
      : 9000;
  const pdfMap = listWorkspaceVoucherPdfStatusMap(params.workspaceId);
  let capturedCount = 0;

  for (const v of params.vouchers.slice(0, 15)) {
    if (!v.masterId || v.paymentStatus === "cancelled" || v.voucherType === "Purchase") {
      continue;
    }
    const existingPdf = pdfMap.get(v.id);
    if (existingPdf && existingPdf.alterId >= v.alterId) {
      continue;
    }

    const pdfBuf = await exportNativeVoucherPdfFromLocalTally({
      port: safePort,
      masterId: v.masterId,
      companyName: v.companyName,
      timeoutMs: 2200,
    });
    if (pdfBuf) {
      try {
        saveNativeTallyVoucherPdf({
          workspaceId: params.workspaceId,
          voucherId: v.id,
          voucherGuid: v.guid,
          voucherNumber: v.voucherNumber,
          voucherType: v.voucherType,
          companyName: v.companyName,
          alterId: v.alterId,
          masterId: v.masterId,
          pdfBuffer: pdfBuf,
          capturedFrom: "local_port9000_native",
        });
        capturedCount++;
      } catch {
        // Non-blocking
      }
    }
  }

  return { capturedCount };
}

function parseOpenCompaniesFromXml(rawXml: string): string[] {
  const blocks = rawXml.match(/<COMPANY(?:\s[^>]*)?>[\s\S]*?<\/COMPANY>/gi) ?? [];
  const names: string[] = [];
  for (const b of blocks) {
    const byTag = extractXmlTag(b, "NAME");
    const attrMatch = b.match(/<COMPANY[^>]*\bNAME="([^"]+)"/i);
    const name = byTag || unescapeXml(attrMatch?.[1] ?? "");
    if (name) names.push(name);
  }
  return Array.from(new Set(names));
}

/**
 * Read-only loopback probe against local Tally Prime XML Server (`127.0.0.1:9000`).
 * Discovers all open Tally companies and counts syncable vouchers across them.
 */
export async function probeLocalTallyPort9000(port = 9000): Promise<LocalTallyPortProbe> {
  const safePort = Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 9000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1400);
    const compRes = await fetch(`http://127.0.0.1:${safePort}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildLocalTallyOpenCompaniesXml(),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!compRes.ok) {
      return {
        reachable: false,
        port: safePort,
        activeCompanyName: null,
        openCompanies: [],
        voucherCount: 0,
        errorMessage: `Local Tally port ${safePort} returned HTTP ${compRes.status}`,
      };
    }

    const compXml = await compRes.text();
    const openCompanies = parseOpenCompaniesFromXml(compXml);

    let totalVouchers = 0;
    let firstDetectedCompany: string | null = openCompanies[0] ?? null;

    if (openCompanies.length === 0) {
      const vRes = await fetch(`http://127.0.0.1:${safePort}`, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: buildLocalTallyExportXml(0),
        cache: "no-store",
      });
      if (vRes.ok) {
        const parsed = parseTallyXmlEnvelope(await vRes.text());
        totalVouchers = parsed.vouchers.length;
        firstDetectedCompany = parsed.detectedCompanyName;
        if (firstDetectedCompany) openCompanies.push(firstDetectedCompany);
      }
    } else {
      for (const cName of openCompanies) {
        const vRes = await fetch(`http://127.0.0.1:${safePort}`, {
          method: "POST",
          headers: { "Content-Type": "text/xml; charset=utf-8" },
          body: buildLocalTallyExportXml(0, cName),
          cache: "no-store",
        });
        if (vRes.ok) {
          const parsed = parseTallyXmlEnvelope(await vRes.text(), cName);
          totalVouchers += parsed.vouchers.length;
        }
      }
    }

    return {
      reachable: true,
      port: safePort,
      activeCompanyName:
        openCompanies.length > 1
          ? `${openCompanies[0]} (+${openCompanies.length - 1} more)`
          : firstDetectedCompany,
      openCompanies,
      voucherCount: totalVouchers,
      errorMessage: null,
    };
  } catch (err) {
    return {
      reachable: false,
      port: safePort,
      activeCompanyName: null,
      openCompanies: [],
      voucherCount: 0,
      errorMessage: err instanceof Error ? err.message : "Local Tally port 9000 not reachable",
    };
  }
}

export async function syncLocalTallyPort9000ForWorkspace(params: {
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  port?: number;
}): Promise<{
  upserted: number;
  deletedCount: number;
  queuedJobs: number;
  companyName: string | null;
  syncedCompanies: string[];
}> {
  const safePort =
    params.port && Number.isInteger(params.port) && params.port >= 1024 && params.port <= 65535
      ? params.port
      : 9000;

  let openCompanies: string[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const compRes = await fetch(`http://127.0.0.1:${safePort}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildLocalTallyOpenCompaniesXml(),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!compRes.ok) {
      throw new RslError(
        "RSL-VAL-1001",
        `Tally Prime on 127.0.0.1:${safePort} returned HTTP ${compRes.status}. Ensure a company is open in Tally Prime.`
      );
    }
    openCompanies = parseOpenCompaniesFromXml(await compRes.text());
  } catch (err) {
    if (err instanceof RslError) throw err;
    throw new RslError(
      "RSL-VAL-1001",
      `Could not connect to Tally Prime on 127.0.0.1:${safePort}. In Tally Prime, press F1 -> Settings -> Connectivity -> Client/Server Configuration -> set TallyPrime acts as 'Both' and Port '9000'.`
    );
  }

  const routing = getTallyCompanyRoutingConfig(params.workspaceId);
  const allowedOpenCompanies = openCompanies.filter((c) => isTallyCompanyAllowed(c, routing));

  if (allowedOpenCompanies.length > 0) {
    registerTallyCompaniesForWorkspace({
      workspaceId: params.workspaceId,
      companies: allowedOpenCompanies,
      updateLastSyncedAt: true,
    });
  }

  await syncLocalTallyInventoryMastersFromPort9000({
    workspaceId: params.workspaceId,
    actorType: params.actorType,
    actorId: params.actorId,
    openCompanies: allowedOpenCompanies,
    port: safePort,
    isCompanyAllowed: (c) => isTallyCompanyAllowed(c, routing),
  });

  let totalUpserted = 0;
  let totalDeleted = 0;
  let totalQueued = 0;

  for (const companyName of allowedOpenCompanies) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const vRes = await fetch(`http://127.0.0.1:${safePort}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildLocalTallyExportXml(0, companyName),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!vRes.ok) continue;

    const rawXml = await vRes.text();
    const preParsed = parseTallyXmlEnvelope(rawXml, companyName);
    const existingPdfMap = listWorkspaceVoucherPdfStatusMap(params.workspaceId);
    const existingPdfByGuid = new Map<string, TallyVoucherPdfMeta>();
    for (const meta of existingPdfMap.values()) {
      existingPdfByGuid.set(meta.voucherGuid, meta);
    }

    let exportedInBatch = 0;
    for (const v of preParsed.vouchers) {
      if (exportedInBatch >= 15) break;
      if (!v.masterId || v.isCancelled || v.isDeleted || v.voucherType === "Purchase") continue;
      const compSlug = toCompanySlugGuid(companyName);
      const existingMeta =
        (v.guid ? existingPdfByGuid.get(`${compSlug}::${v.guid}`) ?? existingPdfByGuid.get(v.guid) : undefined);
      if (existingMeta && existingMeta.alterId >= (v.alterId ?? 0)) {
        continue;
      }
      const pdfBuf = await exportNativeVoucherPdfFromLocalTally({
        port: safePort,
        masterId: v.masterId,
        companyName,
        timeoutMs: 2200,
      });
      if (pdfBuf) {
        try {
          saveNativeTallyVoucherPdf({
            workspaceId: params.workspaceId,
            voucherGuid: v.guid,
            voucherNumber: v.voucherNumber,
            voucherType: v.voucherType,
            companyName,
            alterId: v.alterId,
            masterId: v.masterId,
            pdfBuffer: pdfBuf,
            capturedFrom: "local_port9000_native",
          });
          exportedInBatch++;
        } catch {
          // Non-blocking
        }
      }
    }

    const result = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: params.workspaceId,
      actorType: params.actorType,
      actorId: params.actorId,
      rawPayload: rawXml,
      sourceLabel: "webhook",
      sourceIp: "127.0.0.1",
      userAgent: `TallyPrime-LocalPort9000/${LATEST_TALLY_TDL_VERSION}`,
      fullCompanySnapshot: { companyName, hasExplicitDateSpan: true },
    });

    totalUpserted += result.upserted;
    totalDeleted += result.deletedCount;
    totalQueued += result.queuedJobs;
  }

  return {
    upserted: totalUpserted,
    deletedCount: totalDeleted,
    queuedJobs: totalQueued,
    companyName: allowedOpenCompanies.join(", ") || null,
    syncedCompanies: allowedOpenCompanies,
  };
}

const localAutoSyncTimestamps = new Map<string, number>();

/**
 * Throttled background Port-9000 reconciliation when running locally on the Tally PC
 * AND the workspace has already paired/synced at least one Tally company in its DB.
 */
export async function autoReconcileLocalTallyPort9000IfActive(
  workspaceId: string
): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;
  if (!resolvePublicEndpoints().isLocalDev) return;
  const now = Date.now();
  const lastAt = localAutoSyncTimestamps.get(workspaceId) ?? 0;
  if (now - lastAt < 6000) return;
  localAutoSyncTimestamps.set(workspaceId, now);

  try {
    const existingCompanies = tenantDataDb({ workspaceId })
      .select({ id: tenantDataSchema.tallyCompanies.id })
      .from(tenantDataSchema.tallyCompanies)
      .limit(1)
      .all();
    if (existingCompanies.length === 0) return;

    // Only auto-reconcile if Port 9000 responds within 700ms
    const probe = await probeLocalTallyPort9000(9000);
    if (!probe.reachable || probe.openCompanies.length === 0) return;

    await syncLocalTallyPort9000ForWorkspace({
      workspaceId,
      actorType: "system",
      actorId: "local_port9000_autosync",
      port: 9000,
    });
  } catch {
    // Silent non-blocking background check
  }
}

export const fetchAndSyncLocalTallyPort9000 = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    port: z.coerce.number().int().min(1024).max(65535).default(9000),
  }),
  summarize: (
    _in,
    out?: { upserted: number; deletedCount: number; companyName: string | null }
  ) =>
    `Synced ${out?.upserted ?? 0} bill(s)${
      (out?.deletedCount ?? 0) > 0 ? ` and removed ${out?.deletedCount} deleted bill(s)` : ""
    } from local Tally Prime${out?.companyName ? ` (${out.companyName})` : ""} on Port 9000`,
  handler: async (ctx, input) => {
    return syncLocalTallyPort9000ForWorkspace({
      workspaceId: ctx.workspaceId,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      port: input.port,
    });
  },
});
