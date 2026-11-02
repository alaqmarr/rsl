import crypto from "node:crypto";

const CROCKFORD_LOWER = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Validates any RSL identifier:
 * Supports both meaningful typed client IDs (e.g. `biz_shreegan_01k9x8m4q2r7`, `tvch_shreegan_01k9x8...`)
 * and legacy 26-char Crockford ULIDs, while strictly forbidding path traversal characters (`.`, `/`, `\`).
 */
export const SAFE_ENTITY_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;

export type EntityTypePrefix =
  | "biz"   // Business / Workspace
  | "usr"   // Customer User
  | "stf"   // Platform Staff
  | "ses"   // Auth Session
  | "rol"   // Role
  | "mem"   // Team Membership
  | "invt"  // Team Invitation
  | "ent"   // Plan Entitlement
  | "prc"   // Service Price
  | "inv"   // GST Invoice
  | "pay"   // Payment
  | "ldg"   // Wallet Ledger Entry
  | "usg"   // Usage Event
  | "con"   // External Connection
  | "ast"   // Connected Asset
  | "key"   // Developer API Key
  | "pair"  // Tally Pairing Code
  | "dev"   // Tally Agent Device
  | "dst"   // Backup / Storage Destination
  | "mig"   // Storage Migration Run
  | "cnt"   // Customer Contact
  | "cnv"   // Conversation Thread
  | "msg"   // Chat Message
  | "not"   // Internal Note
  | "lbl"   // Conversation Label
  | "rev"   // Google Review
  | "cmp"   // Ad Campaign
  | "snp"   // Campaign Daily Snapshot
  | "pst"   // Scheduled Social Post
  | "pxl"   // Website Pixel Event
  | "tpl"   // WhatsApp Template
  | "tmpl"  // WhatsApp Template (alias)
  | "bcs"   // WhatsApp Broadcast
  | "bcst"  // WhatsApp Broadcast (alias)
  | "opt"   // Customer Consent / Opt-In
  | "rmd"   // Tally Reminder Rule
  | "tlwh"  // Tally Webhook Endpoint
  | "taut"  // Tally Automation Rule
  | "tco"   // Tally Company
  | "tpt"   // Tally Party Ledger
  | "tvch"  // Tally Voucher / Bill
  | "sync"  // Tally Sync Run
  | "obx"   // Queue Outbox Item
  | "act"   // Action Log Row
  | "prv"   // Provider Call Log
  | "job"   // Background Job Run
  | "evt"   // Webhook Event
  | "sup"   // Unsubscribed / Suppression
  | "bkp"   // Backup / Restore Run
  | "eml"   // Outbound Email Record
  | "req"   // Request / Correlation ID
  | "anc";  // Log Hash Anchor

let lastTime = 0;
let monotonicCounter = 0;

function encodeSortableTimestamp(ms: number): string {
  let time = Math.max(0, Math.floor(ms));
  let out = "";
  for (let i = 0; i < 9; i++) {
    out = CROCKFORD_LOWER[time % 32]! + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandomSuffix(length = 7): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CROCKFORD_LOWER[bytes[i]! % 32]!;
  }
  return out;
}

/**
 * Extracts a clean, readable 3–10 character lowercase ASCII client/entity tag
 * from a business name,workspace ID, or user name.
 * Examples:
 *  - "Shree Ganesh Traders" -> "shreegan"
 *  - "biz_shreegan_01k9..." -> "shreegan"
 *  - "Rapid Shift Labs"     -> "rapidshi"
 */
export function sanitizeClientTag(clientHint?: string | null): string {
  if (!clientHint) return "rsl";
  const trimmed = clientHint.trim();

  // If passed an existing meaningful workspace ID like `biz_shreegan_01k9...`, extract `shreegan`!
  const parts = trimmed.split("_");
  if (parts.length >= 3 && parts[0] === "biz" && /^[a-z0-9]{2,12}$/.test(parts[1]!)) {
    return parts[1]!;
  }

  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);

  return cleaned.length >= 2 ? cleaned : "client";
}

let activeContextClientResolver: (() => string | undefined) | null = null;

export function registerContextClientTagResolver(fn: () => string | undefined): void {
  activeContextClientResolver = fn;
}

/**
 * Generates a meaningful, human-readable, time-sortable ID based on client name and data type:
 * Format: `<dataType>_<clientTag>_<time9><rand7>`
 * Example: `tvch_shreegan_069r8x2m4k9p1q7z`
 */
export function newEntityId(
  dataType: EntityTypePrefix,
  clientNameOrWorkspaceId?: string | null,
  timestampMs: number = Date.now()
): string {
  if (timestampMs === lastTime) {
    monotonicCounter = (monotonicCounter + 1) % 32;
  } else {
    lastTime = timestampMs;
    monotonicCounter = 0;
  }

  const resolvedHint = clientNameOrWorkspaceId ?? activeContextClientResolver?.() ?? "rsl";
  const clientTag = sanitizeClientTag(resolvedHint);
  const timePart = encodeSortableTimestamp(timestampMs);
  const counterChar = CROCKFORD_LOWER[monotonicCounter]!;
  const randPart = encodeRandomSuffix(6);

  return `${dataType}_${clientTag}_${timePart}${counterChar}${randPart}`;
}

/**
 * Default ID helper — automatically uses active client context tag if available.
 */
export function newId(
  dataType: EntityTypePrefix = "req",
  clientNameOrWorkspaceId?: string | null
): string {
  return newEntityId(dataType, clientNameOrWorkspaceId);
}

/**
 * Strictly validates that an identifier is safe for SQLite filenames and path joins
 * (prevents `.` `..` `/` `\` null bytes or shell metacharacters).
 */
export function isValidUlid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_ENTITY_ID_REGEX.test(value) &&
    !value.includes("..")
  );
}

export function assertValidUlid(value: unknown, label = "identifier"): string {
  if (!isValidUlid(value)) {
    throw new Error(`Invalid ${label}: unsafe or malformed RSL identifier`);
  }
  return value;
}
