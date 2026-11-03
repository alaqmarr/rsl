import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  formatInr,
  newEntityId,
  newId,
  RslError,
  rupeesToPaise,
} from "@rsl/core";
import { tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { tenantDataDb } from "@rsl/tenancy";

export type TallySuiteVoucherType =
  | "Sales"
  | "Receipt"
  | "Payment"
  | "CreditNote"
  | "DebitNote"
  | "Purchase";

export interface ParsedTallyBillAllocation {
  billName: string;
  billType: "Agst Ref" | "New Ref" | "Advance" | "On Account";
  amountPaise: number;
}

export interface ParsedTallyBillMasterClearance {
  billName: string;
  partyName: string;
  companyName?: string;
  openingBalanceRupees: number;
  closingBalanceRupees: number;
}

function unescapeXmlSimple(str: string): string {
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function extractXmlTagSimple(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return unescapeXmlSimple(m?.[1] ?? "");
}

function parseNumericRupeesAbs(raw: string): number {
  const cleaned = (raw || "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const rhs = cleaned.includes("=") ? cleaned.split("=")[1] ?? cleaned : cleaned;
  const m = rhs.match(/-?\d+(?:\.\d+)?/);
  const val = m ? Math.abs(Number(m[0])) : 0;
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
}

function toPartySlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "party"
  );
}

function toCompanySlugGuidSimple(companyName: string): string {
  return `comp_${companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function normalizePhoneE164Simple(raw?: string | null): string | null {
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

export function normalizeBillRefKey(billNumber: string): string {
  return billNumber.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Detects Cash-in-Hand / Counter Bank ledgers used as PartyLedgerName on Cash Counter invoices.
 */
export function isCashOrBankPartyName(partyName?: string | null): boolean {
  const clean = (partyName ?? "").trim();
  if (!clean) return false;
  if (/^(cash|petty\s*cash|cash-in-hand|cash\s*in\s*hand|counter\s*cash|pos\s*cash)$/i.test(clean)) {
    return true;
  }
  if (/^(upi|neft|rtgs|imps|card\s*settlement|pos\s*settlement)$/i.test(clean)) {
    return true;
  }
  if (/\b(bank\s*a\/?c|current\s*a\/?c|od\s*a\/?c|cc\s*a\/?c|savings\s*a\/?c)\b/i.test(clean)) {
    return true;
  }
  return false;
}

export function normalizeBillAllocationType(
  raw?: string | null
): "Agst Ref" | "New Ref" | "Advance" | "On Account" {
  const clean = (raw ?? "").trim();
  if (/^new\s*ref/i.test(clean)) return "New Ref";
  if (/^advance/i.test(clean)) return "Advance";
  if (/^on\s*account/i.test(clean)) return "On Account";
  return "Agst Ref";
}

export function parseBillAllocationsJson(raw?: string | null): ParsedTallyBillAllocation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ParsedTallyBillAllocation[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const billName = String(rec.billName ?? rec.name ?? "").trim();
      const billType = normalizeBillAllocationType(String(rec.billType ?? "Agst Ref"));
      const amountPaise = Math.max(0, Math.round(Number(rec.amountPaise ?? 0) || 0));
      if (!billName && billType === "Agst Ref") continue;
      out.push({ billName, billType, amountPaise });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeBillAllocationsJson(allocations: ParsedTallyBillAllocation[]): string {
  if (!allocations || allocations.length === 0) return "[]";
  return JSON.stringify(
    allocations.map((a) => ({
      billName: a.billName.trim(),
      billType: a.billType,
      amountPaise: Math.max(0, Math.round(a.amountPaise)),
    }))
  );
}

/**
 * Extracts `<BILLALLOCATIONS.LIST>` (Agst Ref / New Ref / Advance) and the non-party
 * contra account (`Cash`, `HDFC Bank`, `Sales`, etc.) from a `<VOUCHER>` XML block.
 */
export function extractBillAllocationsFromVoucherXml(
  voucherBlock: string,
  partyName: string
): {
  allocations: ParsedTallyBillAllocation[];
  contraLedgerName: string | null;
} {
  const useAllOnly = /<ALLLEDGERENTRIES\.LIST(?:\s|>)/i.test(voucherBlock)
    ? voucherBlock.match(/<ALLLEDGERENTRIES\.LIST(?:\s[^>]*)?>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/gi) ??
      []
    : voucherBlock.match(/<LEDGERENTRIES\.LIST(?:\s[^>]*)?>[\s\S]*?<\/LEDGERENTRIES\.LIST>/gi) ?? [];

  const allocations: ParsedTallyBillAllocation[] = [];
  const seenKeys = new Set<string>();
  let contraLedgerName: string | null = null;
  const normParty = partyName.trim().toLowerCase();

  for (const lb of useAllOnly) {
    const headerPart = lb.split(/<BILLALLOCATIONS\.LIST/i)[0] ?? lb;
    const ledgerName = extractXmlTagSimple(headerPart, "LEDGERNAME");
    const isParty = /^yes$/i.test(extractXmlTagSimple(headerPart, "ISPARTYLEDGER"));

    if (
      ledgerName &&
      !contraLedgerName &&
      !isParty &&
      ledgerName.trim().toLowerCase() !== normParty
    ) {
      contraLedgerName = ledgerName.trim();
    }

    const billBlocks =
      lb.match(/<BILLALLOCATIONS\.LIST(?:\s[^>]*)?>[\s\S]*?<\/BILLALLOCATIONS\.LIST>/gi) ?? [];
    for (const bb of billBlocks) {
      const billName = extractXmlTagSimple(bb, "NAME").trim();
      const billType = normalizeBillAllocationType(extractXmlTagSimple(bb, "BILLTYPE"));
      const amtRupees = parseNumericRupeesAbs(extractXmlTagSimple(bb, "AMOUNT"));
      const amountPaise = rupeesToPaise(amtRupees);
      if (!billName && billType !== "On Account" && billType !== "Advance") continue;
      const dedupeKey = `${billType}::${normalizeBillRefKey(billName)}::${amountPaise}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      allocations.push({
        billName,
        billType,
        amountPaise,
      });
    }
  }

  return { allocations, contraLedgerName };
}

/**
 * Matches open bill numbers explicitly referenced inside a Receipt/Payment narration
 * (e.g. "NEFT received against Inv GST/26-27/101 & GST/26-27/102").
 */
export function extractNarrationBillRefs(
  narration: string | null | undefined,
  candidateBillNumbers: string[]
): string[] {
  if (!narration || !narration.trim() || candidateBillNumbers.length === 0) return [];
  const hay = narration.toLowerCase();
  const matched: string[] = [];
  // Sort longest bill numbers first so "INV-101" doesn't shadow "INV-1010"
  const sortedCandidates = [...candidateBillNumbers].sort((a, b) => b.length - a.length);
  for (const billNo of sortedCandidates) {
    const clean = billNo.trim();
    if (clean.length < 3) continue;
    const escaped = clean.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i");
    if (rx.test(hay)) {
      matched.push(clean);
    }
  }
  return matched;
}

/**
 * Authoritative 4-Pass Bill-Wise Settlement & Party Ledger Reconciliation Engine:
 *
 *   Pass 1 (`cash_counter`): Cash / Bank counter Sales & Purchase invoices are settled immediately.
 *   Pass 2 (`agst_ref`): Explicit `<BILLALLOCATIONS.LIST>` (`Agst Ref`) & narration bill references
 *                        from active `Receipt`/`CreditNote` -> `Sales` and `Payment`/`DebitNote` -> `Purchase`.
 *   Pass 3 (`upfront_direct`): Upfront payment on the invoice (`directPaidPaise`) or Tally `<BILL>` master clearance.
 *   Pass 4 (`fifo_auto`): Chronological party-level FIFO auto-settlement of remaining unallocated
 *                         `Receipt`/`CreditNote` onto open `Sales` bills and `Payment`/`DebitNote` onto open `Purchase` bills.
 *
 * Also recomputes `tally_parties` totals (`totalInvoicedPaise`, `totalReceivedPaise`, `closingBalancePaise`,
 * `unpaidBillsCount`, `overdueBillsCount`, `lastVoucherAt`, `lastPaymentAt`) and cancels pending overdue
 * WhatsApp reminders in `outbox` whenever a `Sales` bill becomes `"paid"`.
 */
export function reconcileCompanyBillSettlementsAndPartyBalances(params: {
  db: ReturnType<typeof tenantDataDb>;
  workspaceId: string;
  companyId: string;
  now?: number;
  cancelPaidVoucherOutbox?: (voucher: { id: string; guid: string }) => void;
}): {
  settledBillsCount: number;
  partialBillsCount: number;
  unpaidBillsCount: number;
  settlementsRecorded: number;
} {
  const now = params.now ?? Date.now();
  const allVouchers = params.db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.companyId, params.companyId))
    .orderBy(
      asc(tenantDataSchema.tallyVouchers.voucherDate),
      asc(tenantDataSchema.tallyVouchers.createdAt)
    )
    .all();

  // Clear previous computed settlement rows for this company before deterministic rebuild
  params.db
    .delete(tenantDataSchema.tallyBillSettlements)
    .where(eq(tenantDataSchema.tallyBillSettlements.companyId, params.companyId))
    .run();

  const activeBills = allVouchers.filter(
    (v) =>
      v.paymentStatus !== "cancelled" &&
      (v.voucherType === "Sales" || v.voucherType === "Purchase")
  );
  const activeSettlementVouchers = allVouchers.filter(
    (v) =>
      v.paymentStatus !== "cancelled" &&
      (v.voucherType === "Receipt" ||
        v.voucherType === "CreditNote" ||
        v.voucherType === "Payment" ||
        v.voucherType === "DebitNote")
  );

  const billPaidSoFar = new Map<string, number>();
  const billUpfrontDirectApplied = new Map<string, number>();
  for (const b of activeBills) {
    billPaidSoFar.set(b.id, 0);
    billUpfrontDirectApplied.set(b.id, 0);
  }

  const settlementRemaining = new Map<string, number>();
  for (const s of activeSettlementVouchers) {
    settlementRemaining.set(s.id, Math.max(0, s.amountPaise));
  }

  const pendingSettlementInserts: Array<typeof tenantDataSchema.tallyBillSettlements.$inferInsert> = [];

  // Pass 1: Cash / Bank Counter Sales & Purchases
  for (const bill of activeBills) {
    if (isCashOrBankPartyName(bill.partyName) && bill.amountPaise > 0) {
      billPaidSoFar.set(bill.id, bill.amountPaise);
      billUpfrontDirectApplied.set(bill.id, bill.amountPaise);
      pendingSettlementInserts.push({
        id: newEntityId("tset", params.workspaceId, now),
        companyId: params.companyId,
        billVoucherId: bill.id,
        settlementVoucherId: null,
        billNumber: bill.voucherNumber,
        settlementVoucherNumber: bill.voucherNumber,
        settlementVoucherType: bill.voucherType,
        partyName: bill.partyName,
        allocationType: "cash_counter",
        amountPaise: bill.amountPaise,
        settledAt: bill.voucherDate,
      });
    }
  }

  // Helper to match target bill(s) for a settlement voucher
  const targetBillTypeForSettlement = (settlementType: string): "Sales" | "Purchase" =>
    settlementType === "Payment" || settlementType === "DebitNote" ? "Purchase" : "Sales";

  // Pass 2: Explicit `Agst Ref` allocations (`billAllocationsJson` + narration bill references)
  for (const sv of activeSettlementVouchers) {
    let rem = settlementRemaining.get(sv.id) ?? 0;
    if (rem <= 0) continue;

    const targetType = targetBillTypeForSettlement(sv.voucherType);
    const normParty = sv.partyName.trim().toLowerCase();
    const candidateBillsForType = activeBills.filter((b) => b.voucherType === targetType);
    const samePartyBills = candidateBillsForType.filter(
      (b) => b.partyName.trim().toLowerCase() === normParty
    );

    let explicitAllocs = parseBillAllocationsJson(sv.billAllocationsJson).filter(
      (a) => a.billName && (a.billType === "Agst Ref" || a.billType === "New Ref")
    );

    if (explicitAllocs.length === 0 && sv.narration) {
      const matchedNos = extractNarrationBillRefs(
        sv.narration,
        samePartyBills.map((b) => b.voucherNumber)
      );
      explicitAllocs = matchedNos.map((billName) => ({
        billName,
        billType: "Agst Ref",
        amountPaise: 0,
      }));
    }

    for (const alloc of explicitAllocs) {
      if (rem <= 0) break;
      const wantedKey = normalizeBillRefKey(alloc.billName);
      if (!wantedKey) continue;

      const matchedBill =
        samePartyBills.find((b) => normalizeBillRefKey(b.voucherNumber) === wantedKey) ??
        candidateBillsForType.find((b) => normalizeBillRefKey(b.voucherNumber) === wantedKey);
      if (!matchedBill) continue;

      const alreadyPaid = billPaidSoFar.get(matchedBill.id) ?? 0;
      const billOpen = Math.max(0, matchedBill.amountPaise - alreadyPaid);
      if (billOpen <= 0) continue;

      const capFromAlloc = alloc.amountPaise > 0 ? alloc.amountPaise : rem;
      const applyPaise = Math.min(rem, billOpen, capFromAlloc);
      if (applyPaise <= 0) continue;

      rem -= applyPaise;
      settlementRemaining.set(sv.id, rem);
      billPaidSoFar.set(matchedBill.id, alreadyPaid + applyPaise);

      pendingSettlementInserts.push({
        id: newEntityId("tset", params.workspaceId, now),
        companyId: params.companyId,
        billVoucherId: matchedBill.id,
        settlementVoucherId: sv.id,
        billNumber: matchedBill.voucherNumber,
        settlementVoucherNumber: sv.voucherNumber,
        settlementVoucherType: sv.voucherType,
        partyName: matchedBill.partyName,
        allocationType: "agst_ref",
        amountPaise: applyPaise,
        settledAt: sv.voucherDate,
      });
    }
  }

  // Pass 3: Upfront Direct Paid (`directPaidPaise` / Tally `<BILL>` Master clearance)
  for (const bill of activeBills) {
    if (bill.directPaidPaise <= 0) continue;
    const alreadyPaid = billPaidSoFar.get(bill.id) ?? 0;
    const billOpen = Math.max(0, bill.amountPaise - alreadyPaid);
    if (billOpen <= 0) continue;

    // Only apply whatever portion of directPaidPaise isn't already covered by explicit Agst Ref receipts
    const neededDirect = Math.max(0, Math.min(bill.amountPaise, bill.directPaidPaise) - alreadyPaid);
    const applyPaise = Math.min(billOpen, neededDirect);
    if (applyPaise <= 0) continue;

    billPaidSoFar.set(bill.id, alreadyPaid + applyPaise);
    billUpfrontDirectApplied.set(
      bill.id,
      (billUpfrontDirectApplied.get(bill.id) ?? 0) + applyPaise
    );

    pendingSettlementInserts.push({
      id: newEntityId("tset", params.workspaceId, now),
      companyId: params.companyId,
      billVoucherId: bill.id,
      settlementVoucherId: null,
      billNumber: bill.voucherNumber,
      settlementVoucherNumber: bill.voucherNumber,
      settlementVoucherType: bill.voucherType,
      partyName: bill.partyName,
      allocationType: "upfront_direct",
      amountPaise: applyPaise,
      settledAt: bill.voucherDate,
    });
  }

  // Pass 4: Chronological Party-Level FIFO Auto-Settlement ("On Account" Receipts / Payments / CN / DN)
  for (const sv of activeSettlementVouchers) {
    let rem = settlementRemaining.get(sv.id) ?? 0;
    if (rem <= 0) continue;
    if (isCashOrBankPartyName(sv.partyName)) continue;

    // Respect pure Advance receipts if every allocation on the voucher was explicitly tagged "Advance"
    const allocs = parseBillAllocationsJson(sv.billAllocationsJson);
    if (allocs.length > 0 && allocs.every((a) => a.billType === "Advance")) {
      continue;
    }

    const targetType = targetBillTypeForSettlement(sv.voucherType);
    const normParty = sv.partyName.trim().toLowerCase();
    if (!normParty || normParty === "customer" || normParty === "deleted") continue;

    const openPartyBills = activeBills.filter(
      (b) =>
        b.voucherType === targetType &&
        b.partyName.trim().toLowerCase() === normParty &&
        b.amountPaise - (billPaidSoFar.get(b.id) ?? 0) > 0
    );

    for (const openBill of openPartyBills) {
      if (rem <= 0) break;
      const alreadyPaid = billPaidSoFar.get(openBill.id) ?? 0;
      const billOpen = Math.max(0, openBill.amountPaise - alreadyPaid);
      if (billOpen <= 0) continue;

      const applyPaise = Math.min(rem, billOpen);
      rem -= applyPaise;
      settlementRemaining.set(sv.id, rem);
      billPaidSoFar.set(openBill.id, alreadyPaid + applyPaise);

      pendingSettlementInserts.push({
        id: newEntityId("tset", params.workspaceId, now),
        companyId: params.companyId,
        billVoucherId: openBill.id,
        settlementVoucherId: sv.id,
        billNumber: openBill.voucherNumber,
        settlementVoucherNumber: sv.voucherNumber,
        settlementVoucherType: sv.voucherType,
        partyName: openBill.partyName,
        allocationType: "fifo_auto",
        amountPaise: applyPaise,
        settledAt: sv.voucherDate,
      });
    }
  }

  for (const row of pendingSettlementInserts) {
    params.db.insert(tenantDataSchema.tallyBillSettlements).values(row).run();
  }

  let settledBillsCount = 0;
  let partialBillsCount = 0;
  let unpaidBillsCount = 0;

  for (const bill of activeBills) {
    const nextPaid = Math.min(bill.amountPaise, Math.max(0, billPaidSoFar.get(bill.id) ?? 0));
    const nextStatus =
      bill.amountPaise > 0 && nextPaid >= bill.amountPaise
        ? "paid"
        : nextPaid > 0
          ? "partial"
          : "unpaid";

    if (nextStatus === "paid") settledBillsCount++;
    else if (nextStatus === "partial") partialBillsCount++;
    else unpaidBillsCount++;

    if (bill.paidAmountPaise !== nextPaid || bill.paymentStatus !== nextStatus) {
      const nextHash = crypto
        .createHash("sha256")
        .update(
          `${bill.guid}|${bill.voucherNumber}|${bill.partyName}|${bill.amountPaise}|${nextPaid}|${nextStatus}|${bill.voucherDate}|${bill.dueDate ?? 0}|${bill.originalCurrency}`
        )
        .digest("hex")
        .slice(0, 32);

      params.db
        .update(tenantDataSchema.tallyVouchers)
        .set({
          paidAmountPaise: nextPaid,
          paymentStatus: nextStatus,
          contentHash: nextHash,
          updatedAt: now,
        })
        .where(eq(tenantDataSchema.tallyVouchers.id, bill.id))
        .run();
    }

    if (nextStatus === "paid" && bill.voucherType === "Sales" && params.cancelPaidVoucherOutbox) {
      params.cancelPaidVoucherOutbox({ id: bill.id, guid: bill.guid });
    }
  }

  // Ensure active settlement vouchers themselves stay marked paid
  for (const sv of activeSettlementVouchers) {
    if (sv.paidAmountPaise !== sv.amountPaise || sv.paymentStatus !== "paid") {
      params.db
        .update(tenantDataSchema.tallyVouchers)
        .set({
          paidAmountPaise: sv.amountPaise,
          paymentStatus: "paid",
          updatedAt: now,
        })
        .where(eq(tenantDataSchema.tallyVouchers.id, sv.id))
        .run();
    }
  }

  // Reconcile `tally_parties` rows for all parties in this company
  const existingParties = params.db
    .select()
    .from(tenantDataSchema.tallyParties)
    .where(eq(tenantDataSchema.tallyParties.companyId, params.companyId))
    .all();
  const partyByLowerName = new Map(
    existingParties.map((p) => [p.name.trim().toLowerCase(), p])
  );

  // Auto-register any non-cash party present in `tally_vouchers`
  for (const v of allVouchers) {
    const pName = v.partyName.trim();
    if (!pName || pName === "Customer" || pName === "Deleted" || isCashOrBankPartyName(pName)) {
      continue;
    }
    const lower = pName.toLowerCase();
    if (!partyByLowerName.has(lower)) {
      const partyGuid = `pty_${params.companyId}_${toPartySlug(pName)}`;
      const inferredGroup =
        v.voucherType === "Purchase" || v.voucherType === "Payment" || v.voucherType === "DebitNote"
          ? "Sundry Creditors"
          : "Sundry Debtors";
      const newPartyId = newEntityId("tpt", params.workspaceId, now);
      params.db
        .insert(tenantDataSchema.tallyParties)
        .values({
          id: newPartyId,
          partyGuid,
          companyId: params.companyId,
          name: pName,
          parentGroup: inferredGroup,
          phoneE164: v.partyPhoneE164 ?? null,
          closingBalancePaise: 0,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();

      const fetched = params.db
        .select()
        .from(tenantDataSchema.tallyParties)
        .where(eq(tenantDataSchema.tallyParties.partyGuid, partyGuid))
        .get();
      if (fetched) {
        partyByLowerName.set(lower, fetched);
      }
    }
  }

  // Reload refreshed vouchers for party aggregation
  const refreshedVouchers = params.db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.companyId, params.companyId))
    .all();

  for (const party of partyByLowerName.values()) {
    const lower = party.name.trim().toLowerCase();
    const partyActiveVouchers = refreshedVouchers.filter(
      (v) => v.paymentStatus !== "cancelled" && v.partyName.trim().toLowerCase() === lower
    );

    let salesPaise = 0;
    let purchasePaise = 0;
    let receiptPaise = 0;
    let paymentPaise = 0;
    let creditNotePaise = 0;
    let debitNotePaise = 0;
    let salesUpfrontDirectPaise = 0;
    let purchaseUpfrontDirectPaise = 0;
    let partyUnpaidCount = 0;
    let partyOverdueCount = 0;
    let lastVoucherAt: number | null = null;
    let lastPaymentAt: number | null = null;
    let latestPhone: string | null = party.phoneE164;

    for (const v of partyActiveVouchers) {
      if (!latestPhone && v.partyPhoneE164) latestPhone = v.partyPhoneE164;
      if (!lastVoucherAt || v.voucherDate > lastVoucherAt) lastVoucherAt = v.voucherDate;

      if (v.voucherType === "Sales") {
        salesPaise += v.amountPaise;
        salesUpfrontDirectPaise += billUpfrontDirectApplied.get(v.id) ?? 0;
        if (v.paymentStatus === "unpaid" || v.paymentStatus === "partial") {
          partyUnpaidCount++;
          if (v.dueDate !== null && v.dueDate < now) partyOverdueCount++;
        }
      } else if (v.voucherType === "Purchase") {
        purchasePaise += v.amountPaise;
        purchaseUpfrontDirectPaise += billUpfrontDirectApplied.get(v.id) ?? 0;
        if (v.paymentStatus === "unpaid" || v.paymentStatus === "partial") {
          partyUnpaidCount++;
          if (v.dueDate !== null && v.dueDate < now) partyOverdueCount++;
        }
      } else if (v.voucherType === "Receipt") {
        receiptPaise += v.amountPaise;
        if (!lastPaymentAt || v.voucherDate > lastPaymentAt) lastPaymentAt = v.voucherDate;
      } else if (v.voucherType === "Payment") {
        paymentPaise += v.amountPaise;
        if (!lastPaymentAt || v.voucherDate > lastPaymentAt) lastPaymentAt = v.voucherDate;
      } else if (v.voucherType === "CreditNote") {
        creditNotePaise += v.amountPaise;
      } else if (v.voucherType === "DebitNote") {
        debitNotePaise += v.amountPaise;
      }
    }

    const isCreditor = /creditor/i.test(party.parentGroup);
    const totalInvoicedPaise = isCreditor ? purchasePaise || salesPaise : salesPaise || purchasePaise;
    const totalReceivedPaise = isCreditor
      ? paymentPaise + debitNotePaise + purchaseUpfrontDirectPaise
      : receiptPaise + creditNotePaise + salesUpfrontDirectPaise;

    // Preserve Tally Master closing balance if synced from Tally Master and 0 vouchers exist in mirror yet
    const nextClosingBalancePaise =
      party.syncedFromTallyMaster && partyActiveVouchers.length === 0
        ? party.closingBalancePaise
        : party.openingBalancePaise +
          (salesPaise + paymentPaise + debitNotePaise + purchaseUpfrontDirectPaise) -
          (purchasePaise + receiptPaise + creditNotePaise + salesUpfrontDirectPaise);

    params.db
      .update(tenantDataSchema.tallyParties)
      .set({
        ...(latestPhone && !party.phoneE164 ? { phoneE164: latestPhone } : {}),
        totalInvoicedPaise,
        totalReceivedPaise,
        closingBalancePaise: nextClosingBalancePaise,
        unpaidBillsCount: partyUnpaidCount,
        overdueBillsCount: partyOverdueCount,
        lastVoucherAt,
        lastPaymentAt,
        updatedAt: now,
      })
      .where(eq(tenantDataSchema.tallyParties.id, party.id))
      .run();
  }

  return {
    settledBillsCount,
    partialBillsCount,
    unpaidBillsCount,
    settlementsRecorded: pendingSettlementInserts.length,
  };
}

export type AgeingBucketKey = "0_15" | "16_30" | "31_60" | "61_90" | "90_plus";

export interface TallyAgeingBucketSummary {
  key: AgeingBucketKey;
  label: string;
  billsCount: number;
  amountPaise: number;
}

export function getWorkspacePartiesLedgerSummary(
  workspaceId: string,
  companyIdFilter?: string
) {
  const db = tenantDataDb({ workspaceId });
  const now = Date.now();

  const companies = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .orderBy(desc(tenantDataSchema.tallyCompanies.lastSyncedAt))
    .all();
  const compNameMap = new Map(companies.map((c) => [c.id, c.name]));
  const activeCompanyFilter =
    companyIdFilter && companyIdFilter !== "all" && compNameMap.has(companyIdFilter)
      ? companyIdFilter
      : null;

  // Self-heal: if vouchers exist for parties not yet materialized in `tally_parties`, reconcile once
  const existingVouchers = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .all();
  const existingPartiesCount = db
    .select({ id: tenantDataSchema.tallyParties.id })
    .from(tenantDataSchema.tallyParties)
    .all().length;
  if (existingVouchers.length > 0 && existingPartiesCount === 0) {
    for (const c of companies) {
      reconcileCompanyBillSettlementsAndPartyBalances({
        db,
        workspaceId,
        companyId: c.id,
        now,
      });
    }
  }

  const rawParties = db
    .select()
    .from(tenantDataSchema.tallyParties)
    .orderBy(desc(tenantDataSchema.tallyParties.closingBalancePaise))
    .all();
  const parties = activeCompanyFilter
    ? rawParties.filter((p) => p.companyId === activeCompanyFilter)
    : rawParties;

  const rawAllVouchers = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .all();
  const allVouchers = activeCompanyFilter
    ? rawAllVouchers.filter((v) => v.companyId === activeCompanyFilter)
    : rawAllVouchers;

  const bucketDefs: Array<{ key: AgeingBucketKey; label: string; min: number; max: number }> = [
    { key: "0_15", label: "0–15 Days", min: 0, max: 15 },
    { key: "16_30", label: "16–30 Days", min: 16, max: 30 },
    { key: "31_60", label: "31–60 Days", min: 31, max: 60 },
    { key: "61_90", label: "61–90 Days", min: 61, max: 90 },
    { key: "90_plus", label: "90+ Days", min: 91, max: Number.POSITIVE_INFINITY },
  ];
  const ageingMap = new Map<AgeingBucketKey, TallyAgeingBucketSummary>(
    bucketDefs.map((b) => [b.key, { key: b.key, label: b.label, billsCount: 0, amountPaise: 0 }])
  );

  let totalOverdueReceivablePaise = 0;
  let openBillsCount = 0;
  let settledBillsCount = 0;

  // Map per-party oldest bill age & voucher counts
  const partyVoucherMeta = new Map<
    string,
    { vouchersCount: number; maxAgeDays: number; overduePaise: number }
  >();

  for (const v of allVouchers) {
    if (v.paymentStatus === "cancelled") continue;
    const pKey = `${v.companyId}::${v.partyName.trim().toLowerCase()}`;
    const meta = partyVoucherMeta.get(pKey) ?? {
      vouchersCount: 0,
      maxAgeDays: 0,
      overduePaise: 0,
    };
    meta.vouchersCount++;

    if (v.voucherType === "Sales") {
      if (v.paymentStatus === "paid") {
        settledBillsCount++;
      } else {
        openBillsCount++;
        const pendingPaise = Math.max(0, v.amountPaise - v.paidAmountPaise);
        const ageDays = Math.max(0, Math.floor((now - v.voucherDate) / 86_400_000));
        if (ageDays > meta.maxAgeDays) meta.maxAgeDays = ageDays;
        if (v.dueDate !== null && v.dueDate < now) {
          totalOverdueReceivablePaise += pendingPaise;
          meta.overduePaise += pendingPaise;
        }
        const matchedDef =
          bucketDefs.find((d) => ageDays >= d.min && ageDays <= d.max) ?? bucketDefs[4]!;
        const bucket = ageingMap.get(matchedDef.key)!;
        bucket.billsCount++;
        bucket.amountPaise += pendingPaise;
      }
    }
    partyVoucherMeta.set(pKey, meta);
  }

  let totalReceivablePaise = 0;
  let totalPayablePaise = 0;
  let debtorsCount = 0;
  let creditorsCount = 0;
  let creditLimitBreachCount = 0;

  const enrichedParties = parties.map((p) => {
    const isCreditor = /creditor/i.test(p.parentGroup);
    if (isCreditor) creditorsCount++;
    else debtorsCount++;

    if (p.closingBalancePaise > 0) totalReceivablePaise += p.closingBalancePaise;
    else if (p.closingBalancePaise < 0) totalPayablePaise += Math.abs(p.closingBalancePaise);

    const creditLimitBreached =
      p.creditLimitPaise > 0 && p.closingBalancePaise > p.creditLimitPaise;
    if (creditLimitBreached) creditLimitBreachCount++;

    const meta = partyVoucherMeta.get(`${p.companyId}::${p.name.trim().toLowerCase()}`);
    const maxAgeDays = meta?.maxAgeDays ?? 0;
    const ageingBucketKey: AgeingBucketKey | null =
      p.unpaidBillsCount > 0
        ? (bucketDefs.find((d) => maxAgeDays >= d.min && maxAgeDays <= d.max)?.key ?? "90_plus")
        : null;

    return {
      ...p,
      companyName: compNameMap.get(p.companyId) ?? "Primary Tally Company",
      isCreditor,
      creditLimitBreached,
      vouchersCount: meta?.vouchersCount ?? 0,
      maxOpenBillAgeDays: maxAgeDays,
      overdueReceivablePaise: meta?.overduePaise ?? 0,
      ageingBucketKey,
    };
  });

  return {
    companies,
    kpis: {
      totalPartiesCount: enrichedParties.length,
      debtorsCount,
      creditorsCount,
      totalReceivablePaise,
      totalPayablePaise,
      netPositionPaise: totalReceivablePaise - totalPayablePaise,
      totalOverdueReceivablePaise,
      creditLimitBreachCount,
      openBillsCount,
      settledBillsCount,
    },
    ageingBuckets: Array.from(ageingMap.values()),
    parties: enrichedParties,
  };
}

export interface PartyStatementRow {
  id: string;
  voucherId: string | null;
  date: number;
  particulars: string;
  voucherType: string;
  voucherNumber: string;
  narration: string | null;
  paymentStatus: string;
  debitPaise: number;
  creditPaise: number;
  runningBalancePaise: number;
  runningDrCr: "Dr" | "Cr" | "Nil";
  isCancelled: boolean;
  settlementSummary: string | null;
}

export function getWorkspacePartyLedgerDetail(workspaceId: string, partyId: string) {
  const db = tenantDataDb({ workspaceId });
  const party = db
    .select()
    .from(tenantDataSchema.tallyParties)
    .where(eq(tenantDataSchema.tallyParties.id, partyId))
    .get();

  if (!party) {
    throw new RslError("RSL-VAL-1001", "Client or supplier ledger account not found.");
  }

  const company = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.id, party.companyId))
    .get();

  const lowerName = party.name.trim().toLowerCase();
  const allCompanyVouchers = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.companyId, party.companyId))
    .orderBy(
      asc(tenantDataSchema.tallyVouchers.voucherDate),
      asc(tenantDataSchema.tallyVouchers.createdAt)
    )
    .all();

  const partyVouchers = allCompanyVouchers.filter(
    (v) => v.partyName.trim().toLowerCase() === lowerName
  );

  const companySettlements = db
    .select()
    .from(tenantDataSchema.tallyBillSettlements)
    .where(eq(tenantDataSchema.tallyBillSettlements.companyId, party.companyId))
    .orderBy(asc(tenantDataSchema.tallyBillSettlements.settledAt))
    .all();

  const settlementsByBillId = new Map<
    string,
    Array<typeof tenantDataSchema.tallyBillSettlements.$inferSelect>
  >();
  const settlementsBySourceId = new Map<
    string,
    Array<typeof tenantDataSchema.tallyBillSettlements.$inferSelect>
  >();

  for (const s of companySettlements) {
    const byBill = settlementsByBillId.get(s.billVoucherId) ?? [];
    byBill.push(s);
    settlementsByBillId.set(s.billVoucherId, byBill);

    if (s.settlementVoucherId) {
      const bySrc = settlementsBySourceId.get(s.settlementVoucherId) ?? [];
      bySrc.push(s);
      settlementsBySourceId.set(s.settlementVoucherId, bySrc);
    }
  }

  const statementRows: PartyStatementRow[] = [];
  let runningSigned = party.openingBalancePaise;

  const toDrCr = (signed: number): "Dr" | "Cr" | "Nil" =>
    signed > 0 ? "Dr" : signed < 0 ? "Cr" : "Nil";

  const earliestDate =
    partyVouchers[0]?.voucherDate ??
    (company ? new Date(`${company.financialYearFrom}T00:00:00Z`).getTime() : Date.now());

  statementRows.push({
    id: `open_${party.id}`,
    voucherId: null,
    date: earliestDate,
    particulars:
      party.openingBalancePaise >= 0 ? "To Opening Balance b/f" : "By Opening Balance b/f",
    voucherType: "Opening",
    voucherNumber: "OPENING",
    narration: "Brought forward ledger balance",
    paymentStatus: "paid",
    debitPaise: party.openingBalancePaise > 0 ? party.openingBalancePaise : 0,
    creditPaise: party.openingBalancePaise < 0 ? Math.abs(party.openingBalancePaise) : 0,
    runningBalancePaise: Math.abs(runningSigned),
    runningDrCr: toDrCr(runningSigned),
    isCancelled: false,
    settlementSummary: null,
  });

  let totalDebitsPaise = party.openingBalancePaise > 0 ? party.openingBalancePaise : 0;
  let totalCreditsPaise =
    party.openingBalancePaise < 0 ? Math.abs(party.openingBalancePaise) : 0;

  for (const v of partyVouchers) {
    const isCancelled = v.paymentStatus === "cancelled";
    const isDebitType =
      v.voucherType === "Sales" || v.voucherType === "Payment" || v.voucherType === "DebitNote";

    const debitPaise = !isCancelled && isDebitType ? v.amountPaise : 0;
    const creditPaise = !isCancelled && !isDebitType ? v.amountPaise : 0;

    if (!isCancelled) {
      runningSigned += debitPaise - creditPaise;
      totalDebitsPaise += debitPaise;
      totalCreditsPaise += creditPaise;
    }

    const contraLabel = v.ledgerAccountName?.trim();
    const particulars =
      v.voucherType === "Sales"
        ? `To ${contraLabel || "Sales A/c"}`
        : v.voucherType === "Purchase"
          ? `By ${contraLabel || "Purchase A/c"}`
          : v.voucherType === "Receipt"
            ? `By ${contraLabel || "Cash / Bank Receipt"}`
            : v.voucherType === "Payment"
              ? `To ${contraLabel || "Cash / Bank Payment"}`
              : v.voucherType === "CreditNote"
                ? `By ${contraLabel || "Sales Return / Credit Note"}`
                : `To ${contraLabel || "Purchase Return / Debit Note"}`;

    const inboundSettle = settlementsByBillId.get(v.id) ?? [];
    const outboundSettle = settlementsBySourceId.get(v.id) ?? [];
    let settlementSummary: string | null = null;
    if (inboundSettle.length > 0) {
      settlementSummary = inboundSettle
        .map((s) =>
          s.settlementVoucherNumber && s.settlementVoucherId
            ? `${s.settlementVoucherType} #${s.settlementVoucherNumber} (${formatInr(s.amountPaise)})`
            : `Direct Paid (${formatInr(s.amountPaise)})`
        )
        .join(", ");
    } else if (outboundSettle.length > 0) {
      settlementSummary = `Agst Bill ${outboundSettle
        .map((s) => `#${s.billNumber} (${formatInr(s.amountPaise)})`)
        .join(", ")}`;
    }

    statementRows.push({
      id: v.id,
      voucherId: v.id,
      date: v.voucherDate,
      particulars,
      voucherType: v.voucherType,
      voucherNumber: v.voucherNumber,
      narration: v.narration ?? null,
      paymentStatus: v.paymentStatus,
      debitPaise,
      creditPaise,
      runningBalancePaise: Math.abs(runningSigned),
      runningDrCr: toDrCr(runningSigned),
      isCancelled,
      settlementSummary,
    });

    // If a Sales/Purchase bill had an inline `upfront_direct` payment without a separate Receipt/Payment row,
    // reflect that inline credit/debit so the T-account running balance matches closingBalancePaise cleanly!
    if (!isCancelled && (v.voucherType === "Sales" || v.voucherType === "Purchase")) {
      const inlineDirect = inboundSettle.filter((s) => !s.settlementVoucherId);
      const inlineSum = inlineDirect.reduce((acc, s) => acc + s.amountPaise, 0);
      if (inlineSum > 0) {
        if (v.voucherType === "Sales") {
          runningSigned -= inlineSum;
          totalCreditsPaise += inlineSum;
          statementRows.push({
            id: `${v.id}_upfront`,
            voucherId: v.id,
            date: v.voucherDate,
            particulars: "By Upfront / Counter Payment Received",
            voucherType: "Receipt (Inline)",
            voucherNumber: v.voucherNumber,
            narration: `Recorded directly on Invoice #${v.voucherNumber}`,
            paymentStatus: "paid",
            debitPaise: 0,
            creditPaise: inlineSum,
            runningBalancePaise: Math.abs(runningSigned),
            runningDrCr: toDrCr(runningSigned),
            isCancelled: false,
            settlementSummary: `Settled against #${v.voucherNumber}`,
          });
        } else {
          runningSigned += inlineSum;
          totalDebitsPaise += inlineSum;
          statementRows.push({
            id: `${v.id}_upfront`,
            voucherId: v.id,
            date: v.voucherDate,
            particulars: "To Upfront / Counter Payment Made",
            voucherType: "Payment (Inline)",
            voucherNumber: v.voucherNumber,
            narration: `Recorded directly on Purchase #${v.voucherNumber}`,
            paymentStatus: "paid",
            debitPaise: inlineSum,
            creditPaise: 0,
            runningBalancePaise: Math.abs(runningSigned),
            runningDrCr: toDrCr(runningSigned),
            isCancelled: false,
            settlementSummary: `Settled against #${v.voucherNumber}`,
          });
        }
      }
    }
  }

  // Enrich bills with settlements & native PDF availability
  const pdfRows = db
    .select({
      voucherId: tenantDataSchema.tallyVoucherPdfs.voucherId,
      filename: tenantDataSchema.tallyVoucherPdfs.filename,
    })
    .from(tenantDataSchema.tallyVoucherPdfs)
    .all();
  const pdfMap = new Map(pdfRows.map((p) => [p.voucherId, p.filename]));

  const bills = partyVouchers
    .filter(
      (v) =>
        v.paymentStatus !== "cancelled" &&
        (v.voucherType === "Sales" || v.voucherType === "Purchase")
    )
    .slice()
    .reverse()
    .map((b) => ({
      ...b,
      pendingPaise: Math.max(0, b.amountPaise - b.paidAmountPaise),
      hasNativePdf: pdfMap.has(b.id),
      nativePdfFilename: pdfMap.get(b.id) ?? null,
      settlements: settlementsByBillId.get(b.id) ?? [],
    }));

  // Item-wise purchase/supply history for this party
  const voucherIdSet = new Set(
    partyVouchers.filter((v) => v.paymentStatus !== "cancelled").map((v) => v.id)
  );
  const rawLines = db
    .select()
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.companyId, party.companyId))
    .all()
    .filter((l) => voucherIdSet.has(l.voucherId));

  const itemAggMap = new Map<
    string,
    {
      stockItemId: string | null;
      itemName: string;
      uom: string;
      hsnCode: string | null;
      totalQty: number;
      totalAmountPaise: number;
      lastRatePaise: number;
      lastDate: number;
      vouchersCount: number;
    }
  >();

  for (const l of rawLines) {
    const key = l.itemName.trim().toLowerCase();
    const cur = itemAggMap.get(key) ?? {
      stockItemId: l.stockItemId,
      itemName: l.itemName,
      uom: l.uom,
      hsnCode: l.hsnCode,
      totalQty: 0,
      totalAmountPaise: 0,
      lastRatePaise: l.ratePaise,
      lastDate: l.voucherDate,
      vouchersCount: 0,
    };
    cur.totalQty = Math.round((cur.totalQty + l.billedQty) * 10000) / 10000;
    cur.totalAmountPaise += l.amountPaise;
    cur.vouchersCount += 1;
    if (l.voucherDate >= cur.lastDate) {
      cur.lastDate = l.voucherDate;
      cur.lastRatePaise = l.ratePaise;
    }
    itemAggMap.set(key, cur);
  }

  const itemHistory = Array.from(itemAggMap.values()).sort(
    (a, b) => b.totalAmountPaise - a.totalAmountPaise
  );

  return {
    party,
    companyName: company?.name ?? "Primary Tally Company",
    financialYearFrom: company?.financialYearFrom ?? "2026-04-01",
    isCreditor: /creditor/i.test(party.parentGroup),
    totals: {
      totalDebitsPaise,
      totalCreditsPaise,
      closingSignedPaise: party.closingBalancePaise,
      closingAbsPaise: Math.abs(party.closingBalancePaise),
      closingDrCr: toDrCr(party.closingBalancePaise),
    },
    statementRows,
    openBills: bills.filter((b) => b.paymentStatus !== "paid"),
    settledBills: bills.filter((b) => b.paymentStatus === "paid"),
    allBills: bills,
    itemHistory,
  };
}

export function getWorkspaceVoucherDetail(workspaceId: string, voucherId: string) {
  const db = tenantDataDb({ workspaceId });
  const voucher = db
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.id, voucherId))
    .get();

  if (!voucher) {
    throw new RslError("RSL-VAL-1001", "Tally voucher not found.");
  }

  const company = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.id, voucher.companyId))
    .get();

  const party = db
    .select()
    .from(tenantDataSchema.tallyParties)
    .where(eq(tenantDataSchema.tallyParties.companyId, voucher.companyId))
    .all()
    .find((p) => p.name.trim().toLowerCase() === voucher.partyName.trim().toLowerCase()) ?? null;

  const lineItems = db
    .select()
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, voucher.id))
    .all();

  const settlementsAgainstBill = db
    .select()
    .from(tenantDataSchema.tallyBillSettlements)
    .where(eq(tenantDataSchema.tallyBillSettlements.billVoucherId, voucher.id))
    .orderBy(asc(tenantDataSchema.tallyBillSettlements.settledAt))
    .all();

  const billsSettledByVoucher = db
    .select()
    .from(tenantDataSchema.tallyBillSettlements)
    .where(eq(tenantDataSchema.tallyBillSettlements.settlementVoucherId, voucher.id))
    .orderBy(asc(tenantDataSchema.tallyBillSettlements.settledAt))
    .all();

  const nativePdfRow = db
    .select({
      voucherId: tenantDataSchema.tallyVoucherPdfs.voucherId,
      filename: tenantDataSchema.tallyVoucherPdfs.filename,
      byteSize: tenantDataSchema.tallyVoucherPdfs.byteSize,
      capturedFrom: tenantDataSchema.tallyVoucherPdfs.capturedFrom,
      updatedAt: tenantDataSchema.tallyVoucherPdfs.updatedAt,
    })
    .from(tenantDataSchema.tallyVoucherPdfs)
    .where(eq(tenantDataSchema.tallyVoucherPdfs.voucherId, voucher.id))
    .get() ?? null;

  // Fetch WhatsApp messages dispatched for this voucher if any
  const linkedConvs = db
    .select()
    .from(tenantDataSchema.conversations)
    .where(eq(tenantDataSchema.conversations.linkedVoucherGuid, voucher.guid))
    .all();

  const whatsappHistory: Array<{
    id: string;
    body: string;
    deliveryStatus: string;
    createdAt: number;
  }> = [];
  for (const c of linkedConvs) {
    const msgs = db
      .select()
      .from(tenantDataSchema.messages)
      .where(eq(tenantDataSchema.messages.conversationId, c.id))
      .orderBy(desc(tenantDataSchema.messages.createdAt))
      .limit(10)
      .all();
    for (const m of msgs) {
      if (m.direction === "outbound" && m.body.includes(voucher.voucherNumber)) {
        whatsappHistory.push({
          id: m.id,
          body: m.body,
          deliveryStatus: m.deliveryStatus,
          createdAt: m.createdAt,
        });
      }
    }
  }

  return {
    voucher,
    companyName: company?.name ?? "Primary Tally Company",
    party,
    lineItems,
    pendingPaise:
      voucher.voucherType === "Sales" || voucher.voucherType === "Purchase"
        ? Math.max(0, voucher.amountPaise - voucher.paidAmountPaise)
        : 0,
    settlementsAgainstBill,
    billsSettledByVoucher,
    nativePdf: nativePdfRow,
    whatsappHistory,
  };
}

export const upsertWorkspacePartyLedger = defineAction({
  key: "tally.voucher.recorded",
  permission: "tally:sync.manage",
  input: z.object({
    partyId: z.string().optional(),
    companyName: z.string().min(2).max(120).default("Primary Tally Company"),
    name: z.string().min(2).max(160),
    parentGroup: z.enum(["Sundry Debtors", "Sundry Creditors"]).default("Sundry Debtors"),
    phoneE164: z.string().optional(),
    email: z.string().optional(),
    gstin: z.string().max(20).optional(),
    pan: z.string().max(16).optional(),
    contactPerson: z.string().max(120).optional(),
    stateName: z.string().max(80).optional(),
    pincode: z.string().max(12).optional(),
    address: z.string().max(400).optional(),
    creditLimitRupees: z.coerce.number().min(0).default(0),
    creditDays: z.coerce.number().int().min(0).max(365).default(15),
    openingBalanceRupees: z.coerce.number().min(0).default(0),
    openingBalanceType: z.enum(["Dr", "Cr"]).default("Dr"),
  }),
  summarize: (input) => `Saved ${input.parentGroup} ledger '${input.name.trim()}'`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();
    const cleanCompanyName = input.companyName.trim() || "Primary Tally Company";
    const companyGuid = toCompanySlugGuidSimple(cleanCompanyName);

    let company = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
      .get();
    if (!company) {
      const compId = newEntityId("tco", ctx.workspaceId, now);
      db.insert(tenantDataSchema.tallyCompanies)
        .values({
          id: compId,
          companyGuid,
          name: cleanCompanyName,
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

    const cleanName = input.name.trim();
    const phoneE164 = normalizePhoneE164Simple(input.phoneE164);
    const absOpenPaise = rupeesToPaise(Math.max(0, input.openingBalanceRupees));
    const signedOpeningPaise = input.openingBalanceType === "Cr" ? -absOpenPaise : absOpenPaise;
    const creditLimitPaise = rupeesToPaise(Math.max(0, input.creditLimitRupees));

    const existing = input.partyId?.trim()
      ? db
          .select()
          .from(tenantDataSchema.tallyParties)
          .where(eq(tenantDataSchema.tallyParties.id, input.partyId.trim()))
          .get()
      : db
          .select()
          .from(tenantDataSchema.tallyParties)
          .where(eq(tenantDataSchema.tallyParties.companyId, company.id))
          .all()
          .find((p) => p.name.trim().toLowerCase() === cleanName.toLowerCase());

    const partyId = existing?.id ?? newEntityId("tpt", ctx.workspaceId, now);
    const partyGuid = existing?.partyGuid ?? `pty_${company.id}_${toPartySlug(cleanName)}`;

    db.insert(tenantDataSchema.tallyParties)
      .values({
        id: partyId,
        partyGuid,
        companyId: company.id,
        name: cleanName,
        parentGroup: input.parentGroup,
        phoneE164,
        email: input.email?.trim() || null,
        gstin: input.gstin?.trim().toUpperCase() || null,
        pan: input.pan?.trim().toUpperCase() || null,
        contactPerson: input.contactPerson?.trim() || null,
        stateName: input.stateName?.trim() || null,
        pincode: input.pincode?.trim() || null,
        address: input.address?.trim() || null,
        creditLimitPaise,
        creditDays: input.creditDays,
        openingBalancePaise: signedOpeningPaise,
        closingBalancePaise: signedOpeningPaise,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.tallyParties.partyGuid,
        set: {
          name: cleanName,
          parentGroup: input.parentGroup,
          phoneE164,
          email: input.email?.trim() || null,
          gstin: input.gstin?.trim().toUpperCase() || null,
          pan: input.pan?.trim().toUpperCase() || null,
          contactPerson: input.contactPerson?.trim() || null,
          stateName: input.stateName?.trim() || null,
          pincode: input.pincode?.trim() || null,
          address: input.address?.trim() || null,
          creditLimitPaise,
          creditDays: input.creditDays,
          openingBalancePaise: signedOpeningPaise,
          syncedFromTallyMaster: false,
          updatedAt: now,
        },
      })
      .run();

    // Also backfill phone onto open bills for this party if newly added!
    if (phoneE164) {
      const partyBills = db
        .select()
        .from(tenantDataSchema.tallyVouchers)
        .where(eq(tenantDataSchema.tallyVouchers.companyId, company.id))
        .all()
        .filter((v) => v.partyName.trim().toLowerCase() === cleanName.toLowerCase() && !v.partyPhoneE164);
      for (const b of partyBills) {
        db.update(tenantDataSchema.tallyVouchers)
          .set({ partyPhoneE164: phoneE164, updatedAt: now })
          .where(eq(tenantDataSchema.tallyVouchers.id, b.id))
          .run();
      }

      const existingContact = db
        .select()
        .from(tenantDataSchema.contacts)
        .where(eq(tenantDataSchema.contacts.phoneE164, phoneE164))
        .get();
      if (existingContact) {
        db.update(tenantDataSchema.contacts)
          .set({
            name: cleanName,
            email: input.email?.trim() || existingContact.email,
            companyName: cleanName,
            tallyPartyGuid: partyGuid,
            updatedAt: now,
          })
          .where(eq(tenantDataSchema.contacts.id, existingContact.id))
          .run();
      } else {
        db.insert(tenantDataSchema.contacts)
          .values({
            id: newEntityId("cnt", ctx.workspaceId, now),
            name: cleanName,
            phoneE164,
            email: input.email?.trim() || null,
            companyName: cleanName,
            tallyPartyGuid: partyGuid,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    reconcileCompanyBillSettlementsAndPartyBalances({
      db,
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      now,
    });

    const saved = db
      .select()
      .from(tenantDataSchema.tallyParties)
      .where(eq(tenantDataSchema.tallyParties.partyGuid, partyGuid))
      .get();

    return { partyId: saved?.id ?? partyId, partyGuid };
  },
});

export const markTallyBillPaidViaReceipt = defineAction({
  key: "tally.voucher.recorded",
  permission: "tally:sync.manage",
  input: z.object({
    billVoucherId: z.string().min(6),
    amountRupees: z.coerce.number().positive().optional(),
    paymentModeLedger: z.string().max(120).default("Bank / UPI Receipt"),
    settlementVoucherNumber: z.string().max(64).optional(),
    settlementDateIso: z.string().optional(),
    narration: z.string().max(300).optional(),
  }),
  summarize: (_in, out?: { billNumber: string; settlementVoucherNumber: string; updatedStatus: string }) =>
    `Recorded payment ${out?.settlementVoucherNumber ?? ""} against Bill #${out?.billNumber ?? ""} (${out?.updatedStatus ?? "paid"})`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();
    const bill = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, input.billVoucherId))
      .get();

    if (!bill) {
      throw new RslError("RSL-VAL-1001", "Bill voucher not found.");
    }
    if (bill.paymentStatus === "cancelled") {
      throw new RslError("RSL-VAL-1001", "Cancelled bills cannot be marked paid.");
    }
    if (bill.voucherType !== "Sales" && bill.voucherType !== "Purchase") {
      throw new RslError("RSL-VAL-1001", "Only Sales or Purchase bills can be settled.");
    }

    const remainingBefore = Math.max(0, bill.amountPaise - bill.paidAmountPaise);
    if (remainingBefore <= 0) {
      return {
        settlementVoucherId: bill.id,
        settlementVoucherNumber: bill.voucherNumber,
        billNumber: bill.voucherNumber,
        settledAmountPaise: 0,
        updatedStatus: "paid",
        remainingBalancePaise: 0,
      };
    }

    const requestedPaise = input.amountRupees
      ? rupeesToPaise(input.amountRupees)
      : remainingBefore;
    const settlePaise = Math.min(remainingBefore, Math.max(1, requestedPaise));

    const settlementType: "Receipt" | "Payment" =
      bill.voucherType === "Purchase" ? "Payment" : "Receipt";
    const prefix = settlementType === "Payment" ? "PYMT" : "RCPT";

    const existingSameType = db
      .select({ voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber })
      .from(tenantDataSchema.tallyVouchers)
      .where(
        and(
          eq(tenantDataSchema.tallyVouchers.companyId, bill.companyId),
          eq(tenantDataSchema.tallyVouchers.voucherType, settlementType)
        )
      )
      .all();

    let maxSeq = 0;
    for (const r of existingSameType) {
      const m = r.voucherNumber.match(/(\d+)\s*$/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
      }
    }

    const vchNumber =
      input.settlementVoucherNumber?.trim() ||
      `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
    const vchDate = input.settlementDateIso
      ? new Date(input.settlementDateIso).getTime() || now
      : now;

    const settlementId = newEntityId("tvch", ctx.workspaceId, now);
    const guid = `vch_${bill.companyId}_${settlementType}_${vchNumber}_${newId().slice(-5)}`;
    const billAllocationsJson = serializeBillAllocationsJson([
      {
        billName: bill.voucherNumber,
        billType: "Agst Ref",
        amountPaise: settlePaise,
      },
    ]);
    const narration =
      input.narration?.trim() ||
      `Agst Ref Bill #${bill.voucherNumber} via ${input.paymentModeLedger.trim() || "Bank / UPI"}`;

    const contentHash = crypto
      .createHash("sha256")
      .update(`${guid}|${vchNumber}|${bill.partyName}|${settlePaise}|paid|${vchDate}`)
      .digest("hex")
      .slice(0, 32);

    db.insert(tenantDataSchema.tallyVouchers)
      .values({
        id: settlementId,
        guid,
        companyId: bill.companyId,
        voucherNumber: vchNumber,
        voucherType: settlementType,
        partyName: bill.partyName,
        partyPhoneE164: bill.partyPhoneE164,
        amountPaise: settlePaise,
        paidAmountPaise: settlePaise,
        directPaidPaise: settlePaise,
        narration,
        ledgerAccountName: input.paymentModeLedger.trim() || "Bank / UPI Receipt",
        billAllocationsJson,
        voucherDate: vchDate,
        dueDate: null,
        paymentStatus: "paid",
        alterId: bill.alterId + 1,
        contentHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Cancel pending WhatsApp outbox reminders if fully paid
    reconcileCompanyBillSettlementsAndPartyBalances({
      db,
      workspaceId: ctx.workspaceId,
      companyId: bill.companyId,
      now,
      cancelPaidVoucherOutbox: (paidVch) => {
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
        for (const r of pendingRows) {
          if (r.envelopeJson.includes(`"${paidVch.id}"`) || r.envelopeJson.includes(`"${paidVch.guid}"`)) {
            db.update(tenantDataSchema.outbox)
              .set({
                status: "completed",
                lastError: "Skipped: invoice marked paid",
                updatedAt: now,
              })
              .where(eq(tenantDataSchema.outbox.id, r.id))
              .run();
          }
        }
      },
    });

    const updatedBill = db
      .select()
      .from(tenantDataSchema.tallyVouchers)
      .where(eq(tenantDataSchema.tallyVouchers.id, bill.id))
      .get()!;

    return {
      settlementVoucherId: settlementId,
      settlementVoucherNumber: vchNumber,
      billNumber: bill.voucherNumber,
      settledAmountPaise: settlePaise,
      updatedStatus: updatedBill.paymentStatus,
      remainingBalancePaise: Math.max(0, updatedBill.amountPaise - updatedBill.paidAmountPaise),
    };
  },
});
