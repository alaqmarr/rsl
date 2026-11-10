import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { newEntityId, RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { appendActionLog, defineAction } from "@rsl/logging";
import { controlDb, tenantDataDb } from "@rsl/tenancy";

export const WORKSPACE_CONFIDENTIALITY_SETTING_KEY = "workspace.confidentiality_policy";
export const UNMASK_OTP_EXPIRY_MS = 10 * 60 * 1000;
export const UNMASK_GRANT_DURATION_MS = 15 * 60 * 1000;
const MAX_UNMASK_OTP_ATTEMPTS = 5;

export interface WorkspaceConfidentialityPolicy {
  /**
   * When false, the workspace runs in Zero-Persistence Ephemeral Mode:
   * outbound WhatsApp / webhook automations execute in-flight and saved bills,
   * PDFs, and party ledgers are purged immediately after dispatch.
   */
  saveBillsAndDetails: boolean;
  /**
   * Custom automatic deletion timer in hours.
   * - `null`: Keep saved data until manual deletion
   * - `0`: Delete immediately after outbound automation dispatch
   * - `1..8760`: Automatically purge bills, PDFs, and party records older than N hours
   */
  autoDeleteRetentionHours: number | null;
  /**
   * When true, buyer/supplier company names, GSTINs, PANs, phone numbers, and emails
   * are masked across the web portal unless unlocked with a 6-digit OTP.
   */
  maskCompanyAndContactDetails: boolean;
  /**
   * When true, only authenticated REST API requests (`/api/v1/*` with `Bearer rsl_live_...`)
   * receive unmasked cleartext company & contact records, while the web portal stays masked
   * (unless temporarily unlocked via owner OTP).
   */
  allowApiUnmaskedAccessOnly: boolean;
  /**
   * Require a 6-digit OTP challenge to temporarily reveal masked company and contact names in the portal.
   */
  requireOtpToUnmask: boolean;
  lastRetentionSweepAt: number | null;
  lastPurgedVouchersCount: number;
  lastPurgedPartiesCount: number;
  updatedAt: number;
}

export const DEFAULT_CONFIDENTIALITY_POLICY: WorkspaceConfidentialityPolicy = {
  saveBillsAndDetails: true,
  autoDeleteRetentionHours: null,
  maskCompanyAndContactDetails: false,
  allowApiUnmaskedAccessOnly: false,
  requireOtpToUnmask: true,
  lastRetentionSweepAt: null,
  lastPurgedVouchersCount: 0,
  lastPurgedPartiesCount: 0,
  updatedAt: 0,
};

export function getWorkspaceConfidentialityPolicy(
  workspaceId: string
): WorkspaceConfidentialityPolicy {
  try {
    const row = tenantDataDb({ workspaceId })
      .select()
      .from(tenantDataSchema.settings)
      .where(eq(tenantDataSchema.settings.key, WORKSPACE_CONFIDENTIALITY_SETTING_KEY))
      .get();

    if (!row?.valueJson) {
      return { ...DEFAULT_CONFIDENTIALITY_POLICY };
    }

    const parsed = JSON.parse(row.valueJson) as Partial<WorkspaceConfidentialityPolicy>;
    const rawHours = parsed.autoDeleteRetentionHours;
    const normalizedHours =
      rawHours === null || rawHours === undefined
        ? null
        : Number.isFinite(Number(rawHours)) && Number(rawHours) >= 0
          ? Math.min(8760, Math.max(0, Math.trunc(Number(rawHours))))
          : null;

    return {
      saveBillsAndDetails:
        typeof parsed.saveBillsAndDetails === "boolean" ? parsed.saveBillsAndDetails : true,
      autoDeleteRetentionHours: normalizedHours,
      maskCompanyAndContactDetails: Boolean(parsed.maskCompanyAndContactDetails),
      allowApiUnmaskedAccessOnly: Boolean(parsed.allowApiUnmaskedAccessOnly),
      requireOtpToUnmask:
        typeof parsed.requireOtpToUnmask === "boolean" ? parsed.requireOtpToUnmask : true,
      lastRetentionSweepAt:
        typeof parsed.lastRetentionSweepAt === "number" ? parsed.lastRetentionSweepAt : null,
      lastPurgedVouchersCount:
        typeof parsed.lastPurgedVouchersCount === "number" ? parsed.lastPurgedVouchersCount : 0,
      lastPurgedPartiesCount:
        typeof parsed.lastPurgedPartiesCount === "number" ? parsed.lastPurgedPartiesCount : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : row.updatedAt,
    };
  } catch {
    return { ...DEFAULT_CONFIDENTIALITY_POLICY };
  }
}

export function writeWorkspaceConfidentialityPolicy(
  workspaceId: string,
  patch: Partial<WorkspaceConfidentialityPolicy>
): WorkspaceConfidentialityPolicy {
  const current = getWorkspaceConfidentialityPolicy(workspaceId);
  const now = Date.now();
  const nextHours =
    patch.autoDeleteRetentionHours !== undefined
      ? patch.autoDeleteRetentionHours === null
        ? null
        : Math.min(8760, Math.max(0, Math.trunc(Number(patch.autoDeleteRetentionHours))))
      : current.autoDeleteRetentionHours;

  const next: WorkspaceConfidentialityPolicy = {
    saveBillsAndDetails:
      patch.saveBillsAndDetails !== undefined
        ? Boolean(patch.saveBillsAndDetails)
        : current.saveBillsAndDetails,
    autoDeleteRetentionHours: nextHours,
    maskCompanyAndContactDetails:
      patch.maskCompanyAndContactDetails !== undefined
        ? Boolean(patch.maskCompanyAndContactDetails)
        : current.maskCompanyAndContactDetails,
    allowApiUnmaskedAccessOnly:
      patch.allowApiUnmaskedAccessOnly !== undefined
        ? Boolean(patch.allowApiUnmaskedAccessOnly)
        : current.allowApiUnmaskedAccessOnly,
    requireOtpToUnmask:
      patch.requireOtpToUnmask !== undefined
        ? Boolean(patch.requireOtpToUnmask)
        : current.requireOtpToUnmask,
    lastRetentionSweepAt:
      patch.lastRetentionSweepAt !== undefined
        ? patch.lastRetentionSweepAt
        : current.lastRetentionSweepAt,
    lastPurgedVouchersCount:
      patch.lastPurgedVouchersCount !== undefined
        ? patch.lastPurgedVouchersCount
        : current.lastPurgedVouchersCount,
    lastPurgedPartiesCount:
      patch.lastPurgedPartiesCount !== undefined
        ? patch.lastPurgedPartiesCount
        : current.lastPurgedPartiesCount,
    updatedAt: now,
  };

  const valueJson = JSON.stringify(next);
  tenantDataDb({ workspaceId })
    .insert(tenantDataSchema.settings)
    .values({
      key: WORKSPACE_CONFIDENTIALITY_SETTING_KEY,
      valueJson,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tenantDataSchema.settings.key,
      set: { valueJson, updatedAt: now },
    })
    .run();

  return next;
}

/* ============================================================================
 * Masking Functions for Buyer / Supplier Companies, GSTIN, PAN, Phone & Email
 * ============================================================================ */

export function maskConfidentialCompanyName(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  if (lower === "cash" || lower === "bank" || lower === "deleted" || lower === "customer") {
    return clean;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  return words
    .map((word) => {
      if (word.length <= 2) {
        return `${word[0] ?? "•"}•`;
      }
      const visiblePrefix = word.slice(0, 2);
      const maskedLen = Math.min(6, Math.max(3, word.length - 2));
      return `${visiblePrefix}${"•".repeat(maskedLen)}`;
    })
    .join(" ");
}

export function maskConfidentialGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const clean = gstin.trim();
  if (!clean) return null;
  if (clean.length <= 6) return "••••••";
  return `${clean.slice(0, 4)}${"•".repeat(Math.max(5, clean.length - 7))}${clean.slice(-3)}`;
}

export function maskConfidentialPan(pan: string | null | undefined): string | null {
  if (!pan) return null;
  const clean = pan.trim();
  if (!clean) return null;
  if (clean.length <= 4) return "••••";
  return `${clean.slice(0, 3)}${"•".repeat(Math.max(4, clean.length - 5))}${clean.slice(-2)}`;
}

export function maskConfidentialPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const clean = phone.trim();
  if (!clean) return null;
  const digits = clean.replace(/\D/g, "");
  if (digits.length < 4) return "••••••";
  const lastThree = digits.slice(-3);
  const countryPrefix = clean.startsWith("+91") || digits.length === 12 ? "+91 " : "";
  return `${countryPrefix}••••• ••${lastThree}`;
}

export function maskConfidentialEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const clean = email.trim();
  if (!clean) return null;
  const atIdx = clean.indexOf("@");
  if (atIdx <= 0) return "••••@••••";
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf(".");
  const tld = dotIdx > 0 ? domain.slice(dotIdx) : "";
  const localPrefix = local.slice(0, Math.min(2, local.length));
  const domainPrefix = domain.slice(0, Math.min(2, domain.length));
  return `${localPrefix}••••@${domainPrefix}••••${tld}`;
}

/* ============================================================================
 * Portal OTP Unmask Challenge & Session Grant
 * ============================================================================ */

function getUnmaskOtpIdentifier(workspaceId: string, userId: string): string {
  return `unmask_otp:${workspaceId}:${userId}`;
}

function getUnmaskGrantIdentifier(workspaceId: string, userId: string): string {
  return `unmask_grant:${workspaceId}:${userId}`;
}

export function isConfidentialityUnmaskActive(
  workspaceId: string,
  userId?: string | null,
  now = Date.now()
): { active: boolean; expiresAt: number | null } {
  if (!userId) return { active: false, expiresAt: null };
  try {
    const grantRow = controlDb()
      .select()
      .from(controlSchema.verifications)
      .where(eq(controlSchema.verifications.identifier, getUnmaskGrantIdentifier(workspaceId, userId)))
      .get();

    if (!grantRow) return { active: false, expiresAt: null };
    if (grantRow.expiresAt <= now) {
      controlDb()
        .delete(controlSchema.verifications)
        .where(eq(controlSchema.verifications.id, grantRow.id))
        .run();
      return { active: false, expiresAt: null };
    }
    return { active: true, expiresAt: grantRow.expiresAt };
  } catch {
    return { active: false, expiresAt: null };
  }
}

export function shouldMaskWorkspacePortalData(
  workspaceId: string,
  opts?: {
    forPublicApi?: boolean;
    userId?: string | null;
    unmaskSessionActive?: boolean;
    policy?: WorkspaceConfidentialityPolicy;
  }
): boolean {
  // Public REST API (/api/v1/*) receives unmasked cleartext when authenticated via API key
  if (opts?.forPublicApi === true) {
    return false;
  }

  const policy = opts?.policy ?? getWorkspaceConfidentialityPolicy(workspaceId);
  const maskingConfigured =
    policy.maskCompanyAndContactDetails || policy.allowApiUnmaskedAccessOnly;

  if (!maskingConfigured) {
    return false;
  }

  if (opts?.unmaskSessionActive === true) {
    return false;
  }

  if (opts?.userId) {
    const grant = isConfidentialityUnmaskActive(workspaceId, opts.userId);
    if (grant.active) {
      return false;
    }
  }

  return true;
}

export function requestConfidentialityUnmaskOtp(params: {
  workspaceId: string;
  userId: string;
  recipientEmail?: string | null;
  recipientName?: string | null;
}): {
  otpSent: boolean;
  maskedDestination: string;
  expiresAt: number;
  devOtpCode?: string;
} {
  const ctrl = controlDb();
  const now = Date.now();
  const userRow = ctrl
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, params.userId))
    .get();

  const targetEmail = (params.recipientEmail || userRow?.email || "").trim().toLowerCase();
  if (!targetEmail) {
    throw new RslError(
      "RSL-VAL-1001",
      "No verified email address found for your account to deliver the confidentiality OTP."
    );
  }

  const otpCode = String(crypto.randomInt(100000, 999999));
  const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
  const identifier = getUnmaskOtpIdentifier(params.workspaceId, params.userId);
  const expiresAt = now + UNMASK_OTP_EXPIRY_MS;

  ctrl
    .delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, identifier))
    .run();

  ctrl
    .insert(controlSchema.verifications)
    .values({
      id: newEntityId("opt", params.workspaceId, now),
      identifier,
      valueHash: otpHash,
      failedAttempts: 0,
      expiresAt,
      createdAt: now,
    })
    .run();

  const subject = `${otpCode} is your OTP to reveal masked company & contact details`;
  const renderedHtml = `<div style="font-family:sans-serif;padding:24px;background:#F4EAD5;color:#090A10;">
    <h2 style="margin:0 0 12px;color:#1E3B2F;">Confidential Data Reveal OTP</h2>
    <p style="margin:0 0 16px;">Use the 6-digit verification code below to temporarily unmask buyer, supplier, and contact details in your workspace for 15 minutes:</p>
    <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:14px 20px;background:#F6F4EE;border:1px solid #1E3B2F;display:inline-block;border-radius:8px;">${otpCode}</div>
    <p style="margin:16px 0 0;font-size:12px;">If you did not request this reveal code, keep your workspace locked and rotate your password immediately.</p>
  </div>`;

  ctrl
    .insert(controlSchema.emailDeliveries)
    .values({
      id: newEntityId("eml", params.workspaceId, now),
      workspaceId: params.workspaceId,
      recipientEmail: targetEmail,
      templateKey: "confidentiality_unmask_otp",
      subject,
      renderedHtml,
      transportMode: "local_outbox",
      status: "sent",
      createdAt: now,
    })
    .run();

  const corr = newEntityId("req", params.workspaceId, now);
  appendActionLog({
    workspaceId: params.workspaceId,
    actorType: "user",
    actorId: params.userId,
    source: "web",
    action: "security.confidentiality.otp_requested",
    outcome: "success",
    requestId: corr,
    correlationId: corr,
    durationMs: 3,
    summary: `Issued 6-digit OTP to ${maskConfidentialEmail(targetEmail)} to unmask confidential company & contact records`,
  });

  const isDevOrTest = process.env.NODE_ENV !== "production";
  return {
    otpSent: true,
    maskedDestination: maskConfidentialEmail(targetEmail) ?? "••••@••••",
    expiresAt,
    ...(isDevOrTest ? { devOtpCode: otpCode } : {}),
  };
}

export function verifyConfidentialityUnmaskOtp(params: {
  workspaceId: string;
  userId: string;
  code: string;
}): {
  unmasked: boolean;
  expiresAt: number;
} {
  const cleanCode = String(params.code ?? "").trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new RslError("RSL-VAL-1001", "Enter a valid 6-digit numeric OTP code.");
  }

  const ctrl = controlDb();
  const now = Date.now();
  const otpIdentifier = getUnmaskOtpIdentifier(params.workspaceId, params.userId);
  const row = ctrl
    .select()
    .from(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, otpIdentifier))
    .get();

  if (!row || row.expiresAt <= now) {
    if (row) {
      ctrl
        .delete(controlSchema.verifications)
        .where(eq(controlSchema.verifications.id, row.id))
        .run();
    }
    throw new RslError(
      "RSL-AUTH-1001",
      "Your 6-digit unmask OTP has expired or was not requested yet. Request a fresh OTP code."
    );
  }

  const currentAttempts = row.failedAttempts ?? 0;
  if (currentAttempts >= MAX_UNMASK_OTP_ATTEMPTS) {
    ctrl
      .delete(controlSchema.verifications)
      .where(eq(controlSchema.verifications.id, row.id))
      .run();
    throw new RslError(
      "RSL-AUTH-1004",
      "Too many incorrect OTP attempts. Please request a new 6-digit OTP code."
    );
  }

  const candidateHash = crypto.createHash("sha256").update(cleanCode).digest("hex");
  const expectedBuf = Buffer.from(row.valueHash, "hex");
  const candidateBuf = Buffer.from(candidateHash, "hex");
  const matches =
    expectedBuf.length === candidateBuf.length &&
    crypto.timingSafeEqual(expectedBuf, candidateBuf);

  if (!matches) {
    const nextAttempts = currentAttempts + 1;
    if (nextAttempts >= MAX_UNMASK_OTP_ATTEMPTS) {
      ctrl
        .delete(controlSchema.verifications)
        .where(eq(controlSchema.verifications.id, row.id))
        .run();
    } else {
      ctrl
        .update(controlSchema.verifications)
        .set({ failedAttempts: nextAttempts })
        .where(eq(controlSchema.verifications.id, row.id))
        .run();
    }
    throw new RslError("RSL-AUTH-1001", "Invalid 6-digit OTP code. Please check and try again.");
  }

  ctrl
    .delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.id, row.id))
    .run();

  const grantIdentifier = getUnmaskGrantIdentifier(params.workspaceId, params.userId);
  const expiresAt = now + UNMASK_GRANT_DURATION_MS;
  ctrl
    .delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, grantIdentifier))
    .run();

  ctrl
    .insert(controlSchema.verifications)
    .values({
      id: newEntityId("ses", params.workspaceId, now),
      identifier: grantIdentifier,
      valueHash: candidateHash,
      failedAttempts: 0,
      expiresAt,
      createdAt: now,
    })
    .run();

  const corr = newEntityId("req", params.workspaceId, now);
  appendActionLog({
    workspaceId: params.workspaceId,
    actorType: "user",
    actorId: params.userId,
    source: "web",
    action: "security.confidentiality.unmasked",
    outcome: "success",
    requestId: corr,
    correlationId: corr,
    durationMs: 3,
    summary: "Verified 6-digit OTP and unlocked confidential company & contact names for 15 minutes",
  });

  return { unmasked: true, expiresAt };
}

export function revokeConfidentialityUnmaskGrant(params: {
  workspaceId: string;
  userId: string;
}): { locked: boolean } {
  const grantIdentifier = getUnmaskGrantIdentifier(params.workspaceId, params.userId);
  controlDb()
    .delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, grantIdentifier))
    .run();
  return { locked: true };
}

/* ============================================================================
 * Automatic Retention & Zero-Persistence Sweep
 * ============================================================================ */

export function runWorkspaceDataRetentionSweep(
  workspaceId: string,
  opts?: {
    forceImmediate?: boolean;
    now?: number;
  }
): {
  purgedVouchersCount: number;
  purgedPartiesCount: number;
  purgedPdfsCount: number;
  purgedContactsCount: number;
  mode: "disabled" | "ephemeral_immediate" | "retention_window" | "manual_purge";
} {
  const now = opts?.now ?? Date.now();
  const policy = getWorkspaceConfidentialityPolicy(workspaceId);
  const db = tenantDataDb({ workspaceId });

  const isEphemeralImmediate =
    !policy.saveBillsAndDetails || policy.autoDeleteRetentionHours === 0;
  const hasRetentionWindow =
    policy.saveBillsAndDetails &&
    policy.autoDeleteRetentionHours !== null &&
    policy.autoDeleteRetentionHours > 0;

  if (!opts?.forceImmediate && !isEphemeralImmediate && !hasRetentionWindow) {
    return {
      purgedVouchersCount: 0,
      purgedPartiesCount: 0,
      purgedPdfsCount: 0,
      purgedContactsCount: 0,
      mode: "disabled",
    };
  }

  const cutoffMs =
    opts?.forceImmediate || isEphemeralImmediate
      ? now + 1000
      : now - (policy.autoDeleteRetentionHours ?? 24) * 3600_000;

  const expiredVouchers = db
    .select({
      id: tenantDataSchema.tallyVouchers.id,
      guid: tenantDataSchema.tallyVouchers.guid,
    })
    .from(tenantDataSchema.tallyVouchers)
    .where(lt(tenantDataSchema.tallyVouchers.createdAt, cutoffMs))
    .all();

  let purgedVouchersCount = 0;
  let purgedPdfsCount = 0;

  for (const v of expiredVouchers) {
    const pdfDel = db
      .delete(tenantDataSchema.tallyVoucherPdfs)
      .where(eq(tenantDataSchema.tallyVoucherPdfs.voucherId, v.id))
      .run();
    purgedPdfsCount += pdfDel.changes;

    db.delete(tenantDataSchema.tallyVoucherItems)
      .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, v.id))
      .run();

    db.delete(tenantDataSchema.tallyBillSettlements)
      .where(eq(tenantDataSchema.tallyBillSettlements.billVoucherId, v.id))
      .run();

    db.delete(tenantDataSchema.tallyBillSettlements)
      .where(eq(tenantDataSchema.tallyBillSettlements.settlementVoucherId, v.id))
      .run();

    const vDel = db
      .delete(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, v.id))
      .run();
    purgedVouchersCount += vDel.changes;
  }

  // Also purge any orphan staged PDFs older than cutoff
  const orphanPdfs = db
    .delete(tenantDataSchema.tallyVoucherPdfs)
    .where(lt(tenantDataSchema.tallyVoucherPdfs.updatedAt, cutoffMs))
    .run();
  purgedPdfsCount += orphanPdfs.changes;

  // Purge party ledgers when ephemeral/manual or when party updatedAt < cutoff and no active bills remain
  let purgedPartiesCount = 0;
  let purgedContactsCount = 0;

  if (opts?.forceImmediate || isEphemeralImmediate) {
    const pDel = db.delete(tenantDataSchema.tallyParties).run();
    purgedPartiesCount += pDel.changes;
  } else {
    const remainingVouchers = db
      .select({
        companyId: tenantDataSchema.tallyVouchers.companyId,
        partyName: tenantDataSchema.tallyVouchers.partyName,
      })
      .from(tenantDataSchema.tallyVouchers)
      .all();
    const activePartyKeys = new Set(
      remainingVouchers.map((rv) => `${rv.companyId}::${rv.partyName.trim().toLowerCase()}`)
    );
    const oldParties = db
      .select({
        id: tenantDataSchema.tallyParties.id,
        companyId: tenantDataSchema.tallyParties.companyId,
        name: tenantDataSchema.tallyParties.name,
      })
      .from(tenantDataSchema.tallyParties)
      .where(lt(tenantDataSchema.tallyParties.updatedAt, cutoffMs))
      .all();

    for (const p of oldParties) {
      if (!activePartyKeys.has(`${p.companyId}::${p.name.trim().toLowerCase()}`)) {
        const del = db
          .delete(tenantDataSchema.tallyParties)
          .where(eq(tenantDataSchema.tallyParties.id, p.id))
          .run();
        purgedPartiesCount += del.changes;
      }
    }

    const oldContactsDel = db
      .delete(tenantDataSchema.contacts)
      .where(lt(tenantDataSchema.contacts.createdAt, cutoffMs))
      .run();
    purgedContactsCount += oldContactsDel.changes;
  }

  if (purgedVouchersCount > 0 || purgedPartiesCount > 0 || opts?.forceImmediate) {
    writeWorkspaceConfidentialityPolicy(workspaceId, {
      lastRetentionSweepAt: now,
      lastPurgedVouchersCount: policy.lastPurgedVouchersCount + purgedVouchersCount,
      lastPurgedPartiesCount: policy.lastPurgedPartiesCount + purgedPartiesCount,
    });
  }

  return {
    purgedVouchersCount,
    purgedPartiesCount,
    purgedPdfsCount,
    purgedContactsCount,
    mode: opts?.forceImmediate
      ? "manual_purge"
      : isEphemeralImmediate
        ? "ephemeral_immediate"
        : "retention_window",
  };
}

export const saveWorkspaceConfidentialityPolicyAction = defineAction({
  key: "security.confidentiality.updated",
  permission: "workspace:manage",
  input: z.object({
    saveBillsAndDetails: z.boolean(),
    autoDeleteRetentionHours: z.number().int().min(0).max(8760).nullable(),
    maskCompanyAndContactDetails: z.boolean(),
    allowApiUnmaskedAccessOnly: z.boolean(),
    requireOtpToUnmask: z.boolean().default(true),
  }),
  summarize: (input) =>
    `Updated confidentiality policy (Save bills: ${input.saveBillsAndDetails ? "Yes" : "No / Ephemeral"}, Auto-delete: ${
      input.autoDeleteRetentionHours === null
        ? "Manual"
        : input.autoDeleteRetentionHours === 0
          ? "Immediate"
          : `${input.autoDeleteRetentionHours}h`
    }, Mask companies: ${input.maskCompanyAndContactDetails || input.allowApiUnmaskedAccessOnly ? "Enabled" : "Off"}, API-only cleartext: ${
      input.allowApiUnmaskedAccessOnly ? "Yes" : "No"
    })`,
  handler: (ctx, input) => {
    const policy = writeWorkspaceConfidentialityPolicy(ctx.workspaceId, {
      saveBillsAndDetails: input.saveBillsAndDetails,
      autoDeleteRetentionHours: input.autoDeleteRetentionHours,
      maskCompanyAndContactDetails: input.maskCompanyAndContactDetails,
      allowApiUnmaskedAccessOnly: input.allowApiUnmaskedAccessOnly,
      requireOtpToUnmask: input.requireOtpToUnmask,
    });

    // If customer disabled saving bills or set retention window, run an immediate sweep
    if (!policy.saveBillsAndDetails || policy.autoDeleteRetentionHours !== null) {
      runWorkspaceDataRetentionSweep(ctx.workspaceId);
    }

    return policy;
  },
});

export const purgeWorkspaceConfidentialDataNow = defineAction({
  key: "security.confidentiality.purged",
  permission: "workspace:manage",
  input: z.object({}),
  summarize: (
    _in,
    out?: { purgedVouchersCount: number; purgedPartiesCount: number; purgedPdfsCount: number }
  ) =>
    `Purged ${out?.purgedVouchersCount ?? 0} saved bill(s), ${out?.purgedPartiesCount ?? 0} party ledger(s), and ${out?.purgedPdfsCount ?? 0} PDF(s) immediately`,
  handler: (ctx) => {
    return runWorkspaceDataRetentionSweep(ctx.workspaceId, { forceImmediate: true });
  },
});
