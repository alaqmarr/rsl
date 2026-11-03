import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  formatInr,
  newEntityId,
  newId,
  RslError,
  rupeesToPaise,
  type ActorType,
} from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { appendActionLog, defineAction } from "@rsl/logging";
import { controlDb, tenantDataDb } from "@rsl/tenancy";

export interface ParsedTallyVoucherLineItem {
  itemName: string;
  godownName?: string;
  batchName?: string;
  hsnCode?: string;
  uom?: string;
  billedQty: number;
  actualQty?: number;
  rateRupees: number;
  discountPct?: number;
  gstRatePct?: number;
  amountRupees: number;
}

export interface ParsedTallyStockBatchAllocation {
  godownName: string;
  batchName: string;
  mfgDate: number | null;
  expiryDate: number | null;
  closingQty: number;
  closingValueRupees: number;
}

export interface ParsedTallyStockItemMaster {
  guid?: string;
  masterId?: string;
  companyName?: string;
  name: string;
  skuCode?: string;
  partNumber?: string;
  stockGroup: string;
  stockCategory?: string;
  uom: string;
  hsnCode?: string;
  gstRatePct: number;
  sellingPriceRupees: number;
  costPriceRupees: number;
  openingQty: number;
  openingValueRupees: number;
  closingQty: number;
  closingRateRupees: number;
  closingValueRupees: number;
  reorderLevelQty: number;
  minOrderQty: number;
  alterId?: number;
  batches: ParsedTallyStockBatchAllocation[];
}

export interface ParsedTallyGodownMaster {
  guid?: string;
  companyName?: string;
  name: string;
  parentName: string;
  address?: string;
}

export interface ParsedTallyPartyLedgerMaster {
  guid?: string;
  companyName?: string;
  name: string;
  parentGroup: string;
  phone?: string;
  email?: string;
  gstin?: string;
  stateName?: string;
  address?: string;
  creditLimitRupees: number;
  creditDays: number;
  openingBalanceRupees: number;
  closingBalanceRupees: number;
}

function unescapeXmlLocal(str: string): string {
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function escapeXmlLocal(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractXmlTagLocal(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return unescapeXmlLocal(m?.[1] ?? "");
}

function toCompanySlugGuidLocal(companyName: string): string {
  return `comp_${companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function toSlugPart(raw: string, maxLen = 64): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen) || "item";
}

function roundQty(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 10000) / 10000;
}

function normalizePhoneOrNullLocal(raw?: string | null): string | null {
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

export function parseTallyDateNullable(raw?: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^not\s*applicable$/i.test(trimmed)) return null;
  if (/^\d{8}$/.test(trimmed)) {
    const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00Z`;
    const ts = new Date(iso).getTime();
    return Number.isFinite(ts) ? ts : null;
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
  const alphaMatch = trimmed.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (alphaMatch) {
    const day = Number(alphaMatch[1]);
    const monIdx = monthNames[alphaMatch[2]!.slice(0, 3).toLowerCase()];
    const rawYear = Number(alphaMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (monIdx !== undefined && day >= 1 && day <= 31) {
      return Date.UTC(year, monIdx, day);
    }
  }
  const myMatch = trimmed.match(/^([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (myMatch) {
    const monIdx = monthNames[myMatch[1]!.slice(0, 3).toLowerCase()];
    const rawYear = Number(myMatch[2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (monIdx !== undefined) {
      // End of expiry month
      return Date.UTC(year, monIdx + 1, 0);
    }
  }
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
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses Tally Prime quantity + UOM strings such as:
 *   " 120 PCS", "-5.50 KG", "10 BOX = 100 PCS", "25.00 Nos."
 */
export function parseTallyQuantityAndUom(
  raw: string,
  allowNegative = false
): { qty: number; uom: string } {
  const cleaned = (raw || "").replace(/,/g, "").trim();
  if (!cleaned) return { qty: 0, uom: "" };
  const primarySegment = cleaned.split("=")[0]?.trim() ?? cleaned;
  const m = primarySegment.match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z0-9./_-]{1,16})?/);
  if (!m) return { qty: 0, uom: "" };
  const parsedNum = Number(m[1]);
  if (!Number.isFinite(parsedNum)) return { qty: 0, uom: "" };
  const qty = allowNegative ? roundQty(parsedNum) : roundQty(Math.abs(parsedNum));
  const rawUom = (m[2] ?? "").replace(/\.$/, "").trim().toUpperCase();
  return { qty, uom: rawUom };
}

function parseTallyRateNumber(raw: string): number {
  const cleaned = (raw || "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  // Handle "1850.00/COIL" or "₹ 450.50/PCS"
  const lhs = cleaned.split("/")[0] ?? cleaned;
  const m = lhs.match(/-?\d+(?:\.\d+)?/);
  const val = m ? Math.abs(Number(m[0])) : 0;
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
}

function parseTallySignedRupees(raw: string): number {
  const cleaned = (raw || "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const rhs = cleaned.includes("=") ? cleaned.split("=")[1] ?? cleaned : cleaned;
  const m = rhs.match(/-?\d+(?:\.\d+)?/);
  const val = m ? Number(m[0]) : 0;
  return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
}

/**
 * Extracts `<ALLINVENTORYENTRIES.LIST>` or `<INVENTORYENTRIES.LIST>` line items from a `<VOUCHER>` XML block.
 */
export function extractInventoryLineItemsFromVoucherXml(
  voucherBlock: string
): ParsedTallyVoucherLineItem[] {
  const entryBlocks = [
    ...(voucherBlock.match(/<ALLINVENTORYENTRIES\.LIST(?:\s[^>]*)?>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi) ??
      []),
    ...(voucherBlock.match(/<INVENTORYENTRIES\.LIST(?:\s[^>]*)?>[\s\S]*?<\/INVENTORYENTRIES\.LIST>/gi) ?? []),
    ...(voucherBlock.match(/<INVENTORYENTRIESIN\.LIST(?:\s[^>]*)?>[\s\S]*?<\/INVENTORYENTRIESIN\.LIST>/gi) ??
      []),
    ...(voucherBlock.match(/<INVENTORYENTRIESOUT\.LIST(?:\s[^>]*)?>[\s\S]*?<\/INVENTORYENTRIESOUT\.LIST>/gi) ??
      []),
  ];

  // Deduplicate if a voucher contains both ALLINVENTORYENTRIES.LIST and INVENTORYENTRIES.LIST
  const useAllOnly =
    voucherBlock.match(/<ALLINVENTORYENTRIES\.LIST(?:\s[^>]*)?>/i) !== null
      ? voucherBlock.match(
          /<ALLINVENTORYENTRIES\.LIST(?:\s[^>]*)?>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi
        ) ?? []
      : entryBlocks;

  const lines: ParsedTallyVoucherLineItem[] = [];

  for (const ib of useAllOnly) {
    const headerScope = ib.split(/<BATCHALLOCATIONS\.LIST/i)[0] ?? ib;
    const itemName =
      extractXmlTagLocal(headerScope, "STOCKITEMNAME") ||
      extractXmlTagLocal(ib, "STOCKITEMNAME");
    if (!itemName) continue;

    const billedParsed = parseTallyQuantityAndUom(
      extractXmlTagLocal(headerScope, "BILLEDQTY") || extractXmlTagLocal(ib, "BILLEDQTY")
    );
    const actualParsed = parseTallyQuantityAndUom(
      extractXmlTagLocal(headerScope, "ACTUALQTY") || extractXmlTagLocal(ib, "ACTUALQTY")
    );
    const billedQty = billedParsed.qty > 0 ? billedParsed.qty : actualParsed.qty;
    const actualQty = actualParsed.qty > 0 ? actualParsed.qty : billedQty;
    const uom = billedParsed.uom || actualParsed.uom || extractXmlTagLocal(ib, "UOM") || "PCS";

    const rateRupees = parseTallyRateNumber(
      extractXmlTagLocal(headerScope, "RATE") || extractXmlTagLocal(ib, "RATE")
    );
    const discountPct = parseTallyRateNumber(
      extractXmlTagLocal(headerScope, "DISCOUNT") || extractXmlTagLocal(ib, "DISCOUNT")
    );
    const gstRatePct = parseTallyRateNumber(
      extractXmlTagLocal(ib, "GSTRATE") ||
        extractXmlTagLocal(ib, "IGSTRATE") ||
        extractXmlTagLocal(ib, "RATEOFINVOICETAX")
    );
    const hsnCode =
      extractXmlTagLocal(ib, "HSNCODE") ||
      extractXmlTagLocal(ib, "GSTHSNCODE") ||
      undefined;

    const rawAmountRupees = Math.abs(
      parseTallySignedRupees(
        extractXmlTagLocal(headerScope, "AMOUNT") || extractXmlTagLocal(ib, "AMOUNT")
      )
    );
    const computedAmount =
      rawAmountRupees > 0
        ? rawAmountRupees
        : Math.round(billedQty * rateRupees * (1 - Math.min(100, discountPct) / 100) * 100) / 100;

    if (billedQty <= 0 && computedAmount <= 0) continue;

    const batchBlocks =
      ib.match(/<BATCHALLOCATIONS\.LIST(?:\s[^>]*)?>[\s\S]*?<\/BATCHALLOCATIONS\.LIST>/gi) ?? [];

    if (batchBlocks.length > 0) {
      let pushedBatch = false;
      for (const bb of batchBlocks) {
        const godownName =
          extractXmlTagLocal(bb, "GODOWNNAME") ||
          extractXmlTagLocal(bb, "DESTINATIONGODOWNNAME") ||
          "Main Location";
        const batchName = extractXmlTagLocal(bb, "BATCHNAME") || "Primary Batch";
        const bQtyParsed = parseTallyQuantityAndUom(
          extractXmlTagLocal(bb, "BILLEDQTY") || extractXmlTagLocal(bb, "ACTUALQTY")
        );
        const bAmt = Math.abs(parseTallySignedRupees(extractXmlTagLocal(bb, "AMOUNT")));
        const effectiveBQty = bQtyParsed.qty > 0 ? bQtyParsed.qty : billedQty;
        const effectiveBAmt = bAmt > 0 ? bAmt : computedAmount;
        if (effectiveBQty <= 0 && effectiveBAmt <= 0) continue;

        lines.push({
          itemName,
          godownName,
          batchName,
          hsnCode,
          uom: bQtyParsed.uom || uom,
          billedQty: effectiveBQty,
          actualQty: effectiveBQty,
          rateRupees:
            rateRupees > 0
              ? rateRupees
              : effectiveBQty > 0
                ? Math.round((effectiveBAmt / effectiveBQty) * 100) / 100
                : 0,
          discountPct,
          gstRatePct,
          amountRupees: effectiveBAmt,
        });
        pushedBatch = true;
      }
      if (pushedBatch) continue;
    }

    const topGodown =
      extractXmlTagLocal(ib, "GODOWNNAME") || "Main Location";
    const topBatch = extractXmlTagLocal(ib, "BATCHNAME") || "Primary Batch";

    lines.push({
      itemName,
      godownName: topGodown,
      batchName: topBatch,
      hsnCode,
      uom,
      billedQty: billedQty > 0 ? billedQty : 1,
      actualQty: actualQty > 0 ? actualQty : billedQty > 0 ? billedQty : 1,
      rateRupees:
        rateRupees > 0
          ? rateRupees
          : billedQty > 0
            ? Math.round((computedAmount / billedQty) * 100) / 100
            : computedAmount,
      discountPct,
      gstRatePct,
      amountRupees: computedAmount,
    });
  }

  return lines;
}

/**
 * Parses `<STOCKITEM>`, `<GODOWN>`, and `<LEDGER>` master blocks from a Tally Prime XML envelope.
 */
export function parseTallyMastersXmlEnvelope(
  rawXml: string,
  fallbackCompanyName?: string
): {
  detectedCompanyName: string | null;
  stockItems: ParsedTallyStockItemMaster[];
  godowns: ParsedTallyGodownMaster[];
  partyLedgers: ParsedTallyPartyLedgerMaster[];
} {
  const envelopeCompany =
    extractXmlTagLocal(rawXml, "SVCURRENTCOMPANY") ||
    extractXmlTagLocal(rawXml, "COMPANYNAME") ||
    null;
  const effectiveDefaultComp = envelopeCompany || fallbackCompanyName;

  const godowns: ParsedTallyGodownMaster[] = [];
  const godownBlocks = rawXml.match(/<GODOWN(?:\s[^>]*)?>[\s\S]*?<\/GODOWN>/gi) ?? [];
  for (const gb of godownBlocks) {
    const attrNameMatch = gb.match(/<GODOWN[^>]*\bNAME="([^"]+)"/i);
    const name = unescapeXmlLocal(attrNameMatch?.[1] ?? extractXmlTagLocal(gb, "NAME"));
    if (!name) continue;
    const parentRaw = extractXmlTagLocal(gb, "PARENT").replace(/^\x04\s*/, "").trim();
    const addressBlocks = gb.match(/<ADDRESS(?:\s[^>]*)?>([\s\S]*?)<\/ADDRESS>/gi) ?? [];
    const addr = addressBlocks
      .map((a) => extractXmlTagLocal(a, "ADDRESS"))
      .filter(Boolean)
      .join(", ");
    godowns.push({
      guid: extractXmlTagLocal(gb, "GUID") || undefined,
      companyName: extractXmlTagLocal(gb, "SVCURRENTCOMPANY") || effectiveDefaultComp || undefined,
      name,
      parentName: parentRaw || "Primary",
      address: addr || undefined,
    });
  }

  const stockItems: ParsedTallyStockItemMaster[] = [];
  const stockBlocks = rawXml.match(/<STOCKITEM(?:\s[^>]*)?>[\s\S]*?<\/STOCKITEM>/gi) ?? [];
  for (const sb of stockBlocks) {
    const headerPart = sb.split(/<(?:BATCHALLOCATIONS|STANDARDCOSTLIST|STANDARDPRICELIST|GSTDETAILS)\.LIST/i)[0] ?? sb;
    const attrNameMatch = sb.match(/<STOCKITEM[^>]*\bNAME="([^"]+)"/i);
    const name = unescapeXmlLocal(attrNameMatch?.[1] ?? extractXmlTagLocal(headerPart, "NAME"));
    if (!name) continue;

    const guid = extractXmlTagLocal(headerPart, "GUID") || undefined;
    const masterId = extractXmlTagLocal(headerPart, "MASTERID").replace(/\D/g, "") || undefined;
    const alterIdNum = Number(extractXmlTagLocal(headerPart, "ALTERID").replace(/\D/g, "") || 0);
    const stockGroup =
      extractXmlTagLocal(headerPart, "PARENT").replace(/^\x04\s*/, "").trim() || "Primary";
    const stockCategory =
      extractXmlTagLocal(headerPart, "CATEGORY").replace(/^\x04\s*/, "").trim() || undefined;
    const baseUnits =
      extractXmlTagLocal(headerPart, "BASEUNITS").replace(/^\x04\s*/, "").trim().toUpperCase() || "";
    const partNumber =
      extractXmlTagLocal(headerPart, "PARTNO") ||
      extractXmlTagLocal(headerPart, "MAILINGNAME") ||
      undefined;
    const skuCode = extractXmlTagLocal(headerPart, "RSLSKUCODE") || partNumber || undefined;

    const rawOpeningTag = extractXmlTagLocal(headerPart, "OPENINGBALANCE");
    const openParsed = parseTallyQuantityAndUom(rawOpeningTag, true);
    const closeParsed = parseTallyQuantityAndUom(
      extractXmlTagLocal(headerPart, "CLOSINGBALANCE"),
      true
    );
    const uom = baseUnits || closeParsed.uom || openParsed.uom || "PCS";

    const openingQty = rawOpeningTag ? openParsed.qty : closeParsed.qty;
    const rawOpenVal = Math.abs(parseTallySignedRupees(extractXmlTagLocal(headerPart, "OPENINGVALUE")));
    const openingValueRupees = openingQty < 0 ? -rawOpenVal : rawOpenVal;

    const closingQty = closeParsed.qty;
    const closingRateRupees = parseTallyRateNumber(extractXmlTagLocal(headerPart, "CLOSINGRATE"));
    const rawCloseVal = Math.abs(parseTallySignedRupees(extractXmlTagLocal(headerPart, "CLOSINGVALUE")));
    const computedCloseVal =
      rawCloseVal > 0
        ? rawCloseVal
        : Math.round(Math.abs(closingQty) * closingRateRupees * 100) / 100;
    const closingValueRupees = closingQty < 0 ? -computedCloseVal : computedCloseVal;

    // Standard selling price & standard cost
    const stdPriceBlocks =
      sb.match(/<STANDARDPRICELIST\.LIST(?:\s[^>]*)?>[\s\S]*?<\/STANDARDPRICELIST\.LIST>/gi) ?? [];
    const lastStdPriceBlock = stdPriceBlocks[stdPriceBlocks.length - 1] ?? "";
    const sellingPriceRupees =
      parseTallyRateNumber(extractXmlTagLocal(headerPart, "RSLSTDPRICE")) ||
      parseTallyRateNumber(extractXmlTagLocal(lastStdPriceBlock, "RATE")) ||
      parseTallyRateNumber(extractXmlTagLocal(headerPart, "STANDARDPRICE")) ||
      0;

    const stdCostBlocks =
      sb.match(/<STANDARDCOSTLIST\.LIST(?:\s[^>]*)?>[\s\S]*?<\/STANDARDCOSTLIST\.LIST>/gi) ?? [];
    const lastStdCostBlock = stdCostBlocks[stdCostBlocks.length - 1] ?? "";
    const costPriceRupees =
      parseTallyRateNumber(extractXmlTagLocal(headerPart, "RSLSTDCOST")) ||
      parseTallyRateNumber(extractXmlTagLocal(lastStdCostBlock, "RATE")) ||
      parseTallyRateNumber(extractXmlTagLocal(headerPart, "STANDARDCOST")) ||
      closingRateRupees;

    const reorderParsed = parseTallyQuantityAndUom(
      extractXmlTagLocal(headerPart, "REORDERBASE") ||
        extractXmlTagLocal(headerPart, "REORDERLEVEL") ||
        extractXmlTagLocal(sb, "REORDERQTY")
    );
    const minOrderParsed = parseTallyQuantityAndUom(
      extractXmlTagLocal(headerPart, "MINIMUMORDERBASE") ||
        extractXmlTagLocal(sb, "MINORDERQTY")
    );

    const hsnCode =
      extractXmlTagLocal(sb, "HSNCODE") ||
      extractXmlTagLocal(sb, "HSNMASTERNAME") ||
      undefined;
    const gstRatePct =
      parseTallyRateNumber(extractXmlTagLocal(sb, "GSTRATE")) ||
      parseTallyRateNumber(extractXmlTagLocal(sb, "IGSTRATE")) ||
      parseTallyRateNumber(extractXmlTagLocal(sb, "TAXRATE")) ||
      18;

    const batches: ParsedTallyStockBatchAllocation[] = [];
    const batchBlocks =
      sb.match(/<BATCHALLOCATIONS\.LIST(?:\s[^>]*)?>[\s\S]*?<\/BATCHALLOCATIONS\.LIST>/gi) ?? [];
    for (const bb of batchBlocks) {
      const godownName = extractXmlTagLocal(bb, "GODOWNNAME") || "Main Location";
      const batchName = extractXmlTagLocal(bb, "BATCHNAME") || "Primary Batch";
      const bClose = parseTallyQuantityAndUom(
        extractXmlTagLocal(bb, "CLOSINGBALANCE") || extractXmlTagLocal(bb, "OPENINGBALANCE"),
        true
      );
      const bValAbs = Math.abs(
        parseTallySignedRupees(
          extractXmlTagLocal(bb, "CLOSINGVALUE") || extractXmlTagLocal(bb, "OPENINGVALUE")
        )
      );
      const mfgDate = parseTallyDateNullable(
        extractXmlTagLocal(bb, "MFDON") || extractXmlTagLocal(bb, "MFGDATE")
      );
      const expiryDate = parseTallyDateNullable(
        extractXmlTagLocal(bb, "EXPIRYPERIOD") || extractXmlTagLocal(bb, "EXPIRYDATE")
      );
      batches.push({
        godownName,
        batchName,
        mfgDate,
        expiryDate,
        closingQty: bClose.qty,
        closingValueRupees:
          bClose.qty < 0
            ? -(bValAbs || Math.abs(bClose.qty) * closingRateRupees)
            : bValAbs || bClose.qty * closingRateRupees,
      });
    }

    stockItems.push({
      guid,
      masterId,
      companyName:
        extractXmlTagLocal(headerPart, "SVCURRENTCOMPANY") || effectiveDefaultComp || undefined,
      name,
      skuCode,
      partNumber,
      stockGroup,
      stockCategory,
      uom,
      hsnCode,
      gstRatePct,
      sellingPriceRupees,
      costPriceRupees,
      openingQty,
      openingValueRupees,
      closingQty,
      closingRateRupees:
        closingRateRupees > 0
          ? closingRateRupees
          : closingQty !== 0
            ? Math.round((Math.abs(closingValueRupees) / Math.abs(closingQty)) * 100) / 100
            : costPriceRupees,
      closingValueRupees,
      reorderLevelQty: reorderParsed.qty,
      minOrderQty: minOrderParsed.qty,
      alterId: alterIdNum > 0 ? alterIdNum : undefined,
      batches,
    });
  }

  const partyLedgers: ParsedTallyPartyLedgerMaster[] = [];
  const ledgerBlocks = rawXml.match(/<LEDGER(?:\s[^>]*)?>[\s\S]*?<\/LEDGER>/gi) ?? [];
  for (const lb of ledgerBlocks) {
    const attrNameMatch = lb.match(/<LEDGER[^>]*\bNAME="([^"]+)"/i);
    const name = unescapeXmlLocal(attrNameMatch?.[1] ?? extractXmlTagLocal(lb, "NAME"));
    if (!name) continue;
    const parentGroup = extractXmlTagLocal(lb, "PARENT").replace(/^\x04\s*/, "").trim();
    if (!/debtor|creditor/i.test(parentGroup)) continue;

    const phone =
      extractXmlTagLocal(lb, "LEDGERMOBILE") ||
      extractXmlTagLocal(lb, "LEDGERPHONE") ||
      undefined;
    const email = extractXmlTagLocal(lb, "EMAIL") || undefined;
    const gstin =
      extractXmlTagLocal(lb, "PARTYGSTIN") ||
      extractXmlTagLocal(lb, "GSTIN") ||
      undefined;
    const stateName =
      extractXmlTagLocal(lb, "LEDSTATENAME") ||
      extractXmlTagLocal(lb, "STATENAME") ||
      undefined;
    const addrMatches = lb.match(/<ADDRESS(?:\s[^>]*)?>([\s\S]*?)<\/ADDRESS>/gi) ?? [];
    const address = addrMatches
      .map((a) => extractXmlTagLocal(a, "ADDRESS"))
      .filter(Boolean)
      .join(", ");

    const creditLimitRupees = Math.abs(
      parseTallySignedRupees(extractXmlTagLocal(lb, "CREDITLIMIT"))
    );
    const creditPeriodRaw = extractXmlTagLocal(lb, "BILLCREDITPERIOD");
    const creditDaysMatch = creditPeriodRaw.match(/(\d{1,4})/);
    const creditDays = creditDaysMatch ? Number(creditDaysMatch[1]) : 0;

    // In Tally Ledger XML, Debit (Receivable) is negative (-X), Credit (Payable) is positive (+X).
    // In RSL `tally_parties.closing_balance_paise`, Receivable (Sales) is positive (+), Payable is negative (-)!
    const rawOpen = parseTallySignedRupees(extractXmlTagLocal(lb, "OPENINGBALANCE"));
    const rawClose = parseTallySignedRupees(extractXmlTagLocal(lb, "CLOSINGBALANCE"));

    partyLedgers.push({
      guid: extractXmlTagLocal(lb, "GUID") || undefined,
      companyName: extractXmlTagLocal(lb, "SVCURRENTCOMPANY") || effectiveDefaultComp || undefined,
      name,
      parentGroup: /creditor/i.test(parentGroup) ? "Sundry Creditors" : "Sundry Debtors",
      phone,
      email,
      gstin,
      stateName,
      address: address || undefined,
      creditLimitRupees,
      creditDays,
      openingBalanceRupees: -rawOpen,
      closingBalanceRupees: -rawClose,
    });
  }

  return {
    detectedCompanyName: envelopeCompany,
    stockItems,
    godowns,
    partyLedgers,
  };
}

function ensureTallyCompanyRow(
  db: ReturnType<typeof tenantDataDb>,
  workspaceId: string,
  companyName: string,
  now: number
) {
  const cleanName = companyName.trim() || "Primary Tally Company";
  const companyGuid = toCompanySlugGuidLocal(cleanName);
  let company = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.companyGuid, companyGuid))
    .get();
  if (!company) {
    const compId = newEntityId("tco", workspaceId, now);
    db.insert(tenantDataSchema.tallyCompanies)
      .values({
        id: compId,
        companyGuid,
        name: cleanName,
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
  return company;
}

function ensureGodownRow(params: {
  db: ReturnType<typeof tenantDataDb>;
  workspaceId: string;
  companyId: string;
  godownName: string;
  parentName?: string;
  address?: string;
  rawGuid?: string;
  now: number;
}) {
  const cleanName = params.godownName.trim() || "Main Location";
  const godownGuid =
    params.rawGuid?.trim() || `gdn_${params.companyId}_${toSlugPart(cleanName, 56)}`;
  params.db
    .insert(tenantDataSchema.tallyGodowns)
    .values({
      id: newEntityId("tgdn", params.workspaceId, params.now),
      godownGuid,
      companyId: params.companyId,
      name: cleanName,
      parentName: params.parentName?.trim() || "Primary",
      address: params.address?.trim() || null,
      updatedAt: params.now,
    })
    .onConflictDoUpdate({
      target: tenantDataSchema.tallyGodowns.godownGuid,
      set: {
        name: cleanName,
        ...(params.parentName ? { parentName: params.parentName.trim() } : {}),
        ...(params.address ? { address: params.address.trim() } : {}),
        updatedAt: params.now,
      },
    })
    .run();
}

/**
 * Recomputes movement totals (`totalSoldQty`, `totalSoldPaise`, `totalPurchasedQty`, `totalPurchasedPaise`,
 * `lastSoldAt`, `lastPurchasedAt`) and live closing stock (`closingQty`, `closingValuePaise`, `tally_stock_balances`)
 * from all non-cancelled vouchers in the company!
 */
export function recalculateCompanyInventoryMovements(params: {
  db: ReturnType<typeof tenantDataDb>;
  workspaceId: string;
  companyId: string;
  itemIds?: string[];
  now?: number;
  preserveMasterClosingWhenNoVouchers?: boolean;
}): void {
  const now = params.now ?? Date.now();
  const targetItems =
    params.itemIds && params.itemIds.length > 0
      ? params.db
          .select()
          .from(tenantDataSchema.tallyStockItems)
          .where(
            and(
              eq(tenantDataSchema.tallyStockItems.companyId, params.companyId),
              inArray(tenantDataSchema.tallyStockItems.id, params.itemIds)
            )
          )
          .all()
      : params.db
          .select()
          .from(tenantDataSchema.tallyStockItems)
          .where(eq(tenantDataSchema.tallyStockItems.companyId, params.companyId))
          .all();

  if (targetItems.length === 0) return;

  const activeVouchers = params.db
    .select({
      id: tenantDataSchema.tallyVouchers.id,
      voucherType: tenantDataSchema.tallyVouchers.voucherType,
      paymentStatus: tenantDataSchema.tallyVouchers.paymentStatus,
      voucherDate: tenantDataSchema.tallyVouchers.voucherDate,
      updatedAt: tenantDataSchema.tallyVouchers.updatedAt,
    })
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.companyId, params.companyId))
    .all();

  const activeVoucherMap = new Map(
    activeVouchers
      .filter((v) => v.paymentStatus !== "cancelled")
      .map((v) => [v.id, v])
  );

  const itemIdSet = new Set(targetItems.map((i) => i.id));
  const allLineRows = params.db
    .select()
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.companyId, params.companyId))
    .all()
    .filter((l) => l.stockItemId && itemIdSet.has(l.stockItemId));

  for (const item of targetItems) {
    const allItemLinesCount = allLineRows.filter((l) => l.stockItemId === item.id).length;
    const itemLines = allLineRows.filter(
      (l) => l.stockItemId === item.id && activeVoucherMap.has(l.voucherId)
    );

    let soldQty = 0;
    let soldPaise = 0;
    let purchasedQty = 0;
    let purchasedPaise = 0;
    let creditNoteQty = 0;
    let creditNotePaise = 0;
    let lastSoldAt: number | null = null;
    let lastPurchasedAt: number | null = null;

    const locBatchDelta = new Map<string, { godownName: string; batchName: string; netQty: number }>();

    for (const line of itemLines) {
      const v = activeVoucherMap.get(line.voucherId)!;
      const qty = line.actualQty > 0 ? line.actualQty : line.billedQty;
      const gKey = `${line.godownName || "Main Location"}::${line.batchName || "Primary Batch"}`;
      const bucket = locBatchDelta.get(gKey) ?? {
        godownName: line.godownName || "Main Location",
        batchName: line.batchName || "Primary Batch",
        netQty: 0,
      };

      if (v.voucherType === "Sales") {
        soldQty += qty;
        soldPaise += line.amountPaise;
        bucket.netQty -= qty;
        if (!lastSoldAt || v.voucherDate > lastSoldAt) lastSoldAt = v.voucherDate;
      } else if (v.voucherType === "CreditNote") {
        creditNoteQty += qty;
        creditNotePaise += line.amountPaise;
        bucket.netQty += qty;
      } else if (v.voucherType === "Purchase") {
        purchasedQty += qty;
        purchasedPaise += line.amountPaise;
        bucket.netQty += qty;
        if (!lastPurchasedAt || v.voucherDate > lastPurchasedAt) lastPurchasedAt = v.voucherDate;
      }
      locBatchDelta.set(gKey, bucket);
    }

    const netSoldQty = Math.max(0, roundQty(soldQty - creditNoteQty));
    const netSoldPaise = Math.max(0, soldPaise - creditNotePaise);
    const cleanPurchasedQty = roundQty(purchasedQty);

    const unitValuationRatePaise =
      item.closingRatePaise > 0
        ? item.closingRatePaise
        : item.costPricePaise > 0
          ? item.costPricePaise
          : cleanPurchasedQty > 0
            ? Math.round(purchasedPaise / cleanPurchasedQty)
            : item.sellingPricePaise;

    let nextClosingQty = item.closingQty;
    let nextClosingValuePaise = item.closingValuePaise;

    const keepMasterSnapshotUntouched =
      Boolean(params.preserveMasterClosingWhenNoVouchers) &&
      item.syncedFromTallyMaster &&
      allItemLinesCount === 0;

    if (!keepMasterSnapshotUntouched) {
      nextClosingQty = roundQty(item.openingQty + cleanPurchasedQty - (soldQty - creditNoteQty));
      nextClosingValuePaise = Math.round(nextClosingQty * unitValuationRatePaise);

      const existingBalances = params.db
        .select()
        .from(tenantDataSchema.tallyStockBalances)
        .where(eq(tenantDataSchema.tallyStockBalances.itemId, item.id))
        .all();

      const allKeys = new Set<string>([
        ...existingBalances.map((b) => `${b.godownName}::${b.batchName}`),
        ...locBatchDelta.keys(),
      ]);

      if (allKeys.size <= 1) {
        const primaryGodown =
          existingBalances[0]?.godownName ??
          Array.from(locBatchDelta.values())[0]?.godownName ??
          "Main Location";
        const primaryBatch =
          existingBalances[0]?.batchName ??
          Array.from(locBatchDelta.values())[0]?.batchName ??
          "Primary Batch";
        ensureGodownRow({
          db: params.db,
          workspaceId: params.workspaceId,
          companyId: params.companyId,
          godownName: primaryGodown,
          now,
        });
        params.db
          .insert(tenantDataSchema.tallyStockBalances)
          .values({
            id: newEntityId("tsb", params.workspaceId, now),
            itemId: item.id,
            companyId: params.companyId,
            godownName: primaryGodown,
            batchName: primaryBatch,
            mfgDate: existingBalances[0]?.mfgDate ?? null,
            expiryDate: existingBalances[0]?.expiryDate ?? null,
            closingQty: nextClosingQty,
            closingValuePaise: nextClosingValuePaise,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              tenantDataSchema.tallyStockBalances.itemId,
              tenantDataSchema.tallyStockBalances.godownName,
              tenantDataSchema.tallyStockBalances.batchName,
            ],
            set: {
              closingQty: nextClosingQty,
              closingValuePaise: nextClosingValuePaise,
              updatedAt: now,
            },
          })
          .run();
      } else {
        // Multi-godown / batch movements: apply net delta onto primary batch + each moved bucket
        const allocatedOpening = item.openingQty;
        let idx = 0;
        for (const k of allKeys) {
          const [gName = "Main Location", bName = "Primary Batch"] = k.split("::");
          const existingB = existingBalances.find(
            (b) => b.godownName === gName && b.batchName === bName
          );
          const delta = locBatchDelta.get(k)?.netQty ?? 0;
          const baseOpen = idx === 0 ? allocatedOpening : 0;
          idx++;
          const cQty = roundQty(baseOpen + delta);
          const cVal = Math.round(cQty * unitValuationRatePaise);
          ensureGodownRow({
            db: params.db,
            workspaceId: params.workspaceId,
            companyId: params.companyId,
            godownName: gName,
            now,
          });
          params.db
            .insert(tenantDataSchema.tallyStockBalances)
            .values({
              id: newEntityId("tsb", params.workspaceId, now),
              itemId: item.id,
              companyId: params.companyId,
              godownName: gName,
              batchName: bName,
              mfgDate: existingB?.mfgDate ?? null,
              expiryDate: existingB?.expiryDate ?? null,
              closingQty: cQty,
              closingValuePaise: cVal,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                tenantDataSchema.tallyStockBalances.itemId,
                tenantDataSchema.tallyStockBalances.godownName,
                tenantDataSchema.tallyStockBalances.batchName,
              ],
              set: {
                closingQty: cQty,
                closingValuePaise: cVal,
                updatedAt: now,
              },
            })
            .run();
        }
      }
    }

    params.db
      .update(tenantDataSchema.tallyStockItems)
      .set({
        totalSoldQty: netSoldQty,
        totalSoldPaise: netSoldPaise,
        totalPurchasedQty: cleanPurchasedQty,
        totalPurchasedPaise: purchasedPaise,
        lastSoldAt,
        lastPurchasedAt,
        closingQty: nextClosingQty,
        closingRatePaise: unitValuationRatePaise,
        closingValuePaise: nextClosingValuePaise,
        updatedAt: now,
      })
      .where(eq(tenantDataSchema.tallyStockItems.id, item.id))
      .run();
  }
}

/**
 * Syncs inventory line items (`tally_voucher_items`) for a saved Tally voucher and
 * immediately recalculates stock quantities & sales/purchase movement analytics!
 */
export function syncVoucherInventoryLineItems(params: {
  db: ReturnType<typeof tenantDataDb>;
  workspaceId: string;
  companyId: string;
  voucher: typeof tenantDataSchema.tallyVouchers.$inferSelect;
  lineItems: ParsedTallyVoucherLineItem[];
  now: number;
}): { syncedLinesCount: number; affectedItemIds: string[] } {
  const existingLines = params.db
    .select({ stockItemId: tenantDataSchema.tallyVoucherItems.stockItemId })
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, params.voucher.id))
    .all();

  const affectedItemIds = new Set<string>(
    existingLines.map((l) => l.stockItemId).filter((id): id is string => Boolean(id))
  );

  // If no lineItems were provided on an update (e.g. a status-only or receipt update) and the voucher
  // wasn't cancelled, preserve existing lines unless lineItems were explicitly supplied or voucher cancelled!
  if (params.lineItems.length === 0 && params.voucher.paymentStatus !== "cancelled") {
    if (affectedItemIds.size > 0) {
      recalculateCompanyInventoryMovements({
        db: params.db,
        workspaceId: params.workspaceId,
        companyId: params.companyId,
        itemIds: Array.from(affectedItemIds),
        now: params.now,
      });
    }
    return { syncedLinesCount: 0, affectedItemIds: Array.from(affectedItemIds) };
  }

  params.db
    .delete(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, params.voucher.id))
    .run();

  if (params.voucher.paymentStatus === "cancelled") {
    if (affectedItemIds.size > 0) {
      recalculateCompanyInventoryMovements({
        db: params.db,
        workspaceId: params.workspaceId,
        companyId: params.companyId,
        itemIds: Array.from(affectedItemIds),
        now: params.now,
      });
    }
    return { syncedLinesCount: 0, affectedItemIds: Array.from(affectedItemIds) };
  }

  let insertedCount = 0;

  for (const line of params.lineItems) {
    const cleanItemName = line.itemName.trim();
    if (!cleanItemName) continue;

    const godownName = line.godownName?.trim() || "Main Location";
    const batchName = line.batchName?.trim() || "Primary Batch";
    const uom = line.uom?.trim().toUpperCase() || "PCS";
    const billedQty = roundQty(Math.max(0, line.billedQty));
    const actualQty = roundQty(Math.max(0, line.actualQty ?? billedQty));
    const ratePaise = rupeesToPaise(Math.max(0, line.rateRupees));
    const amountPaise =
      line.amountRupees > 0
        ? rupeesToPaise(line.amountRupees)
        : Math.round(billedQty * ratePaise * (1 - Math.min(100, line.discountPct ?? 0) / 100));
    const discountBps = Math.round(Math.max(0, Math.min(100, line.discountPct ?? 0)) * 100);
    const gstRateBps = Math.round(Math.max(0, Math.min(50, line.gstRatePct ?? 18)) * 100);

    ensureGodownRow({
      db: params.db,
      workspaceId: params.workspaceId,
      companyId: params.companyId,
      godownName,
      now: params.now,
    });

    // Lookup existing stock item by case-insensitive name in this company, or auto-create
    const existingItem = params.db
      .select()
      .from(tenantDataSchema.tallyStockItems)
      .where(eq(tenantDataSchema.tallyStockItems.companyId, params.companyId))
      .all()
      .find((i) => i.name.trim().toLowerCase() === cleanItemName.toLowerCase());

    let stockItemId: string;
    if (existingItem) {
      stockItemId = existingItem.id;
      // Backfill missing selling/cost rate or HSN if item had none yet
      const updates: Partial<typeof tenantDataSchema.tallyStockItems.$inferInsert> = {};
      if (!existingItem.hsnCode && line.hsnCode) updates.hsnCode = line.hsnCode.trim();
      if (
        params.voucher.voucherType === "Sales" &&
        existingItem.sellingPricePaise === 0 &&
        ratePaise > 0
      ) {
        updates.sellingPricePaise = ratePaise;
      }
      if (
        params.voucher.voucherType === "Purchase" &&
        existingItem.costPricePaise === 0 &&
        ratePaise > 0
      ) {
        updates.costPricePaise = ratePaise;
      }
      if (Object.keys(updates).length > 0) {
        params.db
          .update(tenantDataSchema.tallyStockItems)
          .set({ ...updates, updatedAt: params.now })
          .where(eq(tenantDataSchema.tallyStockItems.id, existingItem.id))
          .run();
      }
    } else {
      stockItemId = newEntityId("titem", params.workspaceId, params.now);
      const itemGuid = `itm_${params.companyId}_${toSlugPart(cleanItemName, 60)}`;
      params.db
        .insert(tenantDataSchema.tallyStockItems)
        .values({
          id: stockItemId,
          itemGuid,
          companyId: params.companyId,
          name: cleanItemName,
          stockGroup: "Primary",
          uom,
          hsnCode: line.hsnCode?.trim() || null,
          gstRateBps,
          sellingPricePaise: params.voucher.voucherType === "Sales" ? ratePaise : 0,
          costPricePaise: params.voucher.voucherType === "Purchase" ? ratePaise : ratePaise,
          openingQty: 0,
          openingValuePaise: 0,
          closingQty: 0,
          closingRatePaise: ratePaise,
          closingValuePaise: 0,
          reorderLevelQty: 0,
          minOrderQty: 0,
          syncedFromTallyMaster: false,
          alterId: 1,
          createdAt: params.now,
          updatedAt: params.now,
        })
        .onConflictDoNothing()
        .run();

      const resolved = params.db
        .select({ id: tenantDataSchema.tallyStockItems.id })
        .from(tenantDataSchema.tallyStockItems)
        .where(eq(tenantDataSchema.tallyStockItems.itemGuid, itemGuid))
        .get();
      if (resolved) stockItemId = resolved.id;
    }

    affectedItemIds.add(stockItemId);

    params.db
      .insert(tenantDataSchema.tallyVoucherItems)
      .values({
        id: newEntityId("tvli", params.workspaceId, params.now),
        voucherId: params.voucher.id,
        companyId: params.companyId,
        stockItemId,
        itemName: cleanItemName,
        godownName,
        batchName,
        hsnCode: line.hsnCode?.trim() || null,
        uom,
        billedQty,
        actualQty,
        ratePaise,
        discountBps,
        gstRateBps,
        amountPaise,
        voucherType: params.voucher.voucherType,
        voucherDate: params.voucher.voucherDate,
        partyName: params.voucher.partyName,
      })
      .run();

    insertedCount++;
  }

  if (affectedItemIds.size > 0) {
    recalculateCompanyInventoryMovements({
      db: params.db,
      workspaceId: params.workspaceId,
      companyId: params.companyId,
      itemIds: Array.from(affectedItemIds),
      now: params.now,
    });
  }

  return { syncedLinesCount: insertedCount, affectedItemIds: Array.from(affectedItemIds) };
}

/**
 * Called right BEFORE deleting a voucher (or when marking a voucher cancelled) so its
 * inventory movements are cleanly reversed on affected stock items!
 */
export function collectVoucherStockItemIdsBeforeDelete(
  db: ReturnType<typeof tenantDataDb>,
  voucherId: string
): string[] {
  const rows = db
    .select({ stockItemId: tenantDataSchema.tallyVoucherItems.stockItemId })
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, voucherId))
    .all();
  return Array.from(
    new Set(rows.map((r) => r.stockItemId).filter((id): id is string => Boolean(id)))
  );
}

/**
 * Ingests `<STOCKITEM>`, `<GODOWN>`, and `<LEDGER>` masters from Tally XML into the tenant DB.
 */
export function ingestTallyMastersXmlForWorkspace(params: {
  workspaceId: string;
  rawXml: string;
  fallbackCompanyName?: string;
  isCompanyAllowed?: (companyName: string) => boolean;
}): {
  stockItemsUpserted: number;
  godownsUpserted: number;
  partiesUpserted: number;
  detectedCompanyName: string | null;
} {
  const db = tenantDataDb({ workspaceId: params.workspaceId });
  const ctrl = controlDb();
  const ws = ctrl
    .select({ defaultTallyCompany: controlSchema.workspaces.defaultTallyCompany })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  const defaultCompany =
    params.fallbackCompanyName?.trim() ||
    ws?.defaultTallyCompany?.trim() ||
    "Primary Tally Company";

  const parsed = parseTallyMastersXmlEnvelope(params.rawXml, defaultCompany);
  if (
    parsed.stockItems.length === 0 &&
    parsed.godowns.length === 0 &&
    parsed.partyLedgers.length === 0
  ) {
    return {
      stockItemsUpserted: 0,
      godownsUpserted: 0,
      partiesUpserted: 0,
      detectedCompanyName: parsed.detectedCompanyName,
    };
  }

  const now = Date.now();
  let stockItemsUpserted = 0;
  let godownsUpserted = 0;
  let partiesUpserted = 0;
  const touchedCompanyItems = new Map<string, Set<string>>();

  const tx = db.$client.transaction(() => {
    for (const g of parsed.godowns) {
      const cName = (g.companyName || parsed.detectedCompanyName || defaultCompany).trim();
      if (params.isCompanyAllowed && !params.isCompanyAllowed(cName)) continue;
      const comp = ensureTallyCompanyRow(db, params.workspaceId, cName, now);
      ensureGodownRow({
        db,
        workspaceId: params.workspaceId,
        companyId: comp.id,
        godownName: g.name,
        parentName: g.parentName,
        address: g.address,
        rawGuid: g.guid ? `${comp.companyGuid}::${g.guid}` : undefined,
        now,
      });
      godownsUpserted++;
    }

    for (const p of parsed.partyLedgers) {
      const cName = (p.companyName || parsed.detectedCompanyName || defaultCompany).trim();
      if (params.isCompanyAllowed && !params.isCompanyAllowed(cName)) continue;
      const comp = ensureTallyCompanyRow(db, params.workspaceId, cName, now);
      const partyGuid = `pty_${comp.id}_${toSlugPart(p.name, 60)}`;
      const phoneE164 = normalizePhoneOrNullLocal(p.phone);

      db.insert(tenantDataSchema.tallyParties)
        .values({
          id: newEntityId("tpt", params.workspaceId, now),
          partyGuid,
          companyId: comp.id,
          name: p.name.trim(),
          parentGroup: p.parentGroup,
          phoneE164,
          email: p.email?.trim() || null,
          gstin: p.gstin?.trim().toUpperCase() || null,
          stateName: p.stateName?.trim() || null,
          address: p.address?.trim() || null,
          creditLimitPaise: rupeesToPaise(p.creditLimitRupees),
          creditDays: Math.max(0, Math.trunc(p.creditDays)),
          openingBalancePaise: Math.round(p.openingBalanceRupees * 100),
          closingBalancePaise: Math.round(p.closingBalanceRupees * 100),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantDataSchema.tallyParties.partyGuid,
          set: {
            name: p.name.trim(),
            parentGroup: p.parentGroup,
            ...(phoneE164 ? { phoneE164 } : {}),
            ...(p.email ? { email: p.email.trim() } : {}),
            ...(p.gstin ? { gstin: p.gstin.trim().toUpperCase() } : {}),
            ...(p.stateName ? { stateName: p.stateName.trim() } : {}),
            ...(p.address ? { address: p.address.trim() } : {}),
            creditLimitPaise: rupeesToPaise(p.creditLimitRupees),
            creditDays: Math.max(0, Math.trunc(p.creditDays)),
            openingBalancePaise: Math.round(p.openingBalanceRupees * 100),
            ...(p.closingBalanceRupees !== 0
              ? { closingBalancePaise: Math.round(p.closingBalanceRupees * 100) }
              : {}),
            updatedAt: now,
          },
        })
        .run();

      if (phoneE164) {
        db.insert(tenantDataSchema.contacts)
          .values({
            id: newEntityId("cnt", params.workspaceId, now),
            name: p.name.trim(),
            phoneE164,
            email: p.email?.trim() || null,
            companyName: p.name.trim(),
            tallyPartyGuid: partyGuid,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
      partiesUpserted++;
    }

    for (const si of parsed.stockItems) {
      const cName = (si.companyName || parsed.detectedCompanyName || defaultCompany).trim();
      if (params.isCompanyAllowed && !params.isCompanyAllowed(cName)) continue;
      const comp = ensureTallyCompanyRow(db, params.workspaceId, cName, now);

      // Match existing item by case-insensitive name in this company first so auto-created voucher items merge seamlessly!
      const existingByName = db
        .select()
        .from(tenantDataSchema.tallyStockItems)
        .where(eq(tenantDataSchema.tallyStockItems.companyId, comp.id))
        .all()
        .find((row) => row.name.trim().toLowerCase() === si.name.trim().toLowerCase());

      const canonicalItemGuid =
        existingByName?.itemGuid ||
        (si.guid ? `${comp.companyGuid}::${si.guid.trim()}` : `itm_${comp.id}_${toSlugPart(si.name, 60)}`);

      const gstRateBps = Math.round(Math.max(0, Math.min(50, si.gstRatePct)) * 100);
      const sellingPricePaise = rupeesToPaise(Math.max(0, si.sellingPriceRupees));
      const costPricePaise = rupeesToPaise(Math.max(0, si.costPriceRupees));
      const openingValuePaise = Math.round(si.openingValueRupees * 100);
      const closingRatePaise = rupeesToPaise(Math.max(0, si.closingRateRupees));
      const closingValuePaise = Math.round(si.closingValueRupees * 100);

      const newRowId = existingByName?.id ?? newEntityId("titem", params.workspaceId, now);

      db.insert(tenantDataSchema.tallyStockItems)
        .values({
          id: newRowId,
          itemGuid: canonicalItemGuid,
          masterId: si.masterId ?? null,
          companyId: comp.id,
          name: si.name.trim(),
          skuCode: si.skuCode?.trim() || null,
          partNumber: si.partNumber?.trim() || null,
          stockGroup: si.stockGroup || "Primary",
          stockCategory: si.stockCategory || null,
          uom: si.uom || "PCS",
          hsnCode: si.hsnCode?.trim() || null,
          gstRateBps,
          sellingPricePaise,
          costPricePaise,
          openingQty: si.openingQty,
          openingValuePaise,
          closingQty: si.closingQty,
          closingRatePaise,
          closingValuePaise,
          reorderLevelQty: si.reorderLevelQty,
          minOrderQty: si.minOrderQty,
          syncedFromTallyMaster: true,
          alterId: si.alterId ?? 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantDataSchema.tallyStockItems.itemGuid,
          set: {
            ...(si.masterId ? { masterId: si.masterId } : {}),
            name: si.name.trim(),
            ...(si.skuCode ? { skuCode: si.skuCode.trim() } : {}),
            ...(si.partNumber ? { partNumber: si.partNumber.trim() } : {}),
            stockGroup: si.stockGroup || "Primary",
            ...(si.stockCategory ? { stockCategory: si.stockCategory } : {}),
            uom: si.uom || "PCS",
            ...(si.hsnCode ? { hsnCode: si.hsnCode.trim() } : {}),
            gstRateBps,
            ...(sellingPricePaise > 0 ? { sellingPricePaise } : {}),
            ...(costPricePaise > 0 ? { costPricePaise } : {}),
            openingQty: si.openingQty,
            openingValuePaise,
            closingQty: si.closingQty,
            closingRatePaise,
            closingValuePaise,
            reorderLevelQty: si.reorderLevelQty,
            minOrderQty: si.minOrderQty,
            syncedFromTallyMaster: true,
            alterId: si.alterId ?? 1,
            updatedAt: now,
          },
        })
        .run();

      const savedItem = db
        .select()
        .from(tenantDataSchema.tallyStockItems)
        .where(eq(tenantDataSchema.tallyStockItems.itemGuid, canonicalItemGuid))
        .get();

      if (savedItem) {
        // Replace authoritative Tally batch/godown allocations for this item
        db.delete(tenantDataSchema.tallyStockBalances)
          .where(eq(tenantDataSchema.tallyStockBalances.itemId, savedItem.id))
          .run();

        const batchesToWrite: ParsedTallyStockBatchAllocation[] =
          si.batches.length > 0
            ? si.batches
            : [
                {
                  godownName: "Main Location",
                  batchName: "Primary Batch",
                  mfgDate: null,
                  expiryDate: null,
                  closingQty: si.closingQty,
                  closingValueRupees: si.closingValueRupees,
                },
              ];

        for (const b of batchesToWrite) {
          ensureGodownRow({
            db,
            workspaceId: params.workspaceId,
            companyId: comp.id,
            godownName: b.godownName,
            now,
          });
          db.insert(tenantDataSchema.tallyStockBalances)
            .values({
              id: newEntityId("tsb", params.workspaceId, now),
              itemId: savedItem.id,
              companyId: comp.id,
              godownName: b.godownName || "Main Location",
              batchName: b.batchName || "Primary Batch",
              mfgDate: b.mfgDate,
              expiryDate: b.expiryDate,
              closingQty: b.closingQty,
              closingValuePaise: Math.round(b.closingValueRupees * 100),
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                tenantDataSchema.tallyStockBalances.itemId,
                tenantDataSchema.tallyStockBalances.godownName,
                tenantDataSchema.tallyStockBalances.batchName,
              ],
              set: {
                mfgDate: b.mfgDate,
                expiryDate: b.expiryDate,
                closingQty: b.closingQty,
                closingValuePaise: Math.round(b.closingValueRupees * 100),
                updatedAt: now,
              },
            })
            .run();
        }

        const setForComp = touchedCompanyItems.get(comp.id) ?? new Set<string>();
        setForComp.add(savedItem.id);
        touchedCompanyItems.set(comp.id, setForComp);
        stockItemsUpserted++;
      }
    }

    for (const [compId, ids] of touchedCompanyItems.entries()) {
      recalculateCompanyInventoryMovements({
        db,
        workspaceId: params.workspaceId,
        companyId: compId,
        itemIds: Array.from(ids),
        now,
        preserveMasterClosingWhenNoVouchers: true,
      });
    }
  });

  tx.immediate();

  return {
    stockItemsUpserted,
    godownsUpserted,
    partiesUpserted,
    detectedCompanyName: parsed.detectedCompanyName,
  };
}

/**
 * Builds Tally Prime XML request to export Stock Items, Godowns, and Party Ledgers on Port 9000.
 */
export function buildLocalTallyMastersXml(companyName?: string): string {
  const companyStatic = companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXmlLocal(companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>RSLInventoryMastersReport</ID>
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
          <REPORT NAME="RSLInventoryMastersReport" ISMODIFY="No">
            <FORMS>RSLInventoryMastersForm</FORMS>
          </REPORT>
          <FORM NAME="RSLInventoryMastersForm" ISMODIFY="No">
            <PARTS>RSLStockItemsPart, RSLGodownsPart, RSLPartiesPart</PARTS>
          </FORM>
          <PART NAME="RSLStockItemsPart" ISMODIFY="No">
            <LINES>RSLStockItemLine</LINES>
            <REPEAT>RSLStockItemLine : RSLStockItemsColl</REPEAT>
            <SCROLLED>Vertical</SCROLLED>
          </PART>
          <LINE NAME="RSLStockItemLine" ISMODIFY="No">
            <FIELDS>RSLBlankField</FIELDS>
            <XMLTAG>STOCKITEM</XMLTAG>
          </LINE>
          <PART NAME="RSLGodownsPart" ISMODIFY="No">
            <LINES>RSLGodownLine</LINES>
            <REPEAT>RSLGodownLine : RSLGodownsColl</REPEAT>
            <SCROLLED>Vertical</SCROLLED>
          </PART>
          <LINE NAME="RSLGodownLine" ISMODIFY="No">
            <FIELDS>RSLBlankField</FIELDS>
            <XMLTAG>GODOWN</XMLTAG>
          </LINE>
          <PART NAME="RSLPartiesPart" ISMODIFY="No">
            <LINES>RSLPartyLine</LINES>
            <REPEAT>RSLPartyLine : RSLPartiesColl</REPEAT>
            <SCROLLED>Vertical</SCROLLED>
          </PART>
          <LINE NAME="RSLPartyLine" ISMODIFY="No">
            <FIELDS>RSLBlankField</FIELDS>
            <XMLTAG>LEDGER</XMLTAG>
          </LINE>
          <FIELD NAME="RSLBlankField" ISMODIFY="No">
            <SET>""</SET>
          </FIELD>
          <COLLECTION NAME="RSLStockItemsColl" ISMODIFY="No">
            <TYPE>StockItem</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Name, Parent, Category, BaseUnits, PartNo, OpeningBalance, OpeningValue, ClosingBalance, ClosingRate, ClosingValue, ReorderBase, MinimumOrderBase</NATIVEMETHOD>
            <NATIVEMETHOD>BatchAllocations.GodownName, BatchAllocations.BatchName, BatchAllocations.ClosingBalance, BatchAllocations.ClosingValue, BatchAllocations.MfdOn, BatchAllocations.ExpiryPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>StandardPriceList.Rate, StandardCostList.Rate</NATIVEMETHOD>
          </COLLECTION>
          <COLLECTION NAME="RSLGodownsColl" ISMODIFY="No">
            <TYPE>Godown</TYPE>
            <NATIVEMETHOD>GUID, Name, Parent, Address</NATIVEMETHOD>
          </COLLECTION>
          <COLLECTION NAME="RSLPartiesColl" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <NATIVEMETHOD>GUID, Name, Parent, LedgerMobile, LedgerPhone, Email, PartyGSTIN, LedStateName, CreditLimit, BillCreditPeriod, OpeningBalance, ClosingBalance, Address</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function buildLocalTallyStockCollectionXml(companyName?: string): string {
  const companyStatic = companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXmlLocal(companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLSyncStockItems</ID>
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
          <COLLECTION NAME="RSLSyncStockItems" ISMODIFY="No">
            <TYPE>StockItem</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Name, Parent, Category, BaseUnits, PartNo, OpeningBalance, OpeningValue, ClosingBalance, ClosingRate, ClosingValue, ReorderBase, MinimumOrderBase</NATIVEMETHOD>
            <NATIVEMETHOD>BatchAllocations.GodownName, BatchAllocations.BatchName, BatchAllocations.ClosingBalance, BatchAllocations.ClosingValue, BatchAllocations.MfdOn, BatchAllocations.ExpiryPeriod</NATIVEMETHOD>
            <NATIVEMETHOD>StandardPriceList.Rate, StandardCostList.Rate</NATIVEMETHOD>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Manual / Portal Action: Create or Update a Stock Item & Godown/Batch Balance
 */
export const upsertTallyStockItem = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    itemId: z.string().optional(),
    companyName: z.string().min(2).max(120).default("Primary Tally Company"),
    name: z.string().min(1).max(160),
    skuCode: z.string().max(60).optional(),
    partNumber: z.string().max(60).optional(),
    stockGroup: z.string().max(120).default("Primary"),
    stockCategory: z.string().max(120).optional(),
    uom: z.string().min(1).max(20).default("PCS"),
    hsnCode: z.string().max(20).optional(),
    gstRatePct: z.coerce.number().min(0).max(50).default(18),
    sellingPriceRupees: z.coerce.number().min(0).default(0),
    costPriceRupees: z.coerce.number().min(0).default(0),
    openingQty: z.coerce.number().default(0),
    reorderLevelQty: z.coerce.number().min(0).default(0),
    minOrderQty: z.coerce.number().min(0).default(0),
    godownName: z.string().max(120).default("Main Location"),
    batchName: z.string().max(120).default("Primary Batch"),
    expiryDateIso: z.string().optional(),
  }),
  summarize: (input) =>
    `Saved Tally Stock Item '${input.name}' (${input.openingQty} ${input.uom.toUpperCase()} @ ${formatInr(rupeesToPaise(input.sellingPriceRupees))})`,
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const now = Date.now();
    const company = ensureTallyCompanyRow(db, ctx.workspaceId, input.companyName, now);

    const uom = input.uom.trim().toUpperCase() || "PCS";
    const gstRateBps = Math.round(input.gstRatePct * 100);
    const sellingPricePaise = rupeesToPaise(input.sellingPriceRupees);
    const costPricePaise = rupeesToPaise(input.costPriceRupees);
    const openingQty = roundQty(input.openingQty);
    const unitValRate = costPricePaise > 0 ? costPricePaise : sellingPricePaise;
    const openingValuePaise = Math.round(openingQty * unitValRate);
    const godownName = input.godownName.trim() || "Main Location";
    const batchName = input.batchName.trim() || "Primary Batch";
    const expiryDate = parseTallyDateNullable(input.expiryDateIso);

    ensureGodownRow({
      db,
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      godownName,
      now,
    });

    const existing = input.itemId
      ? db
          .select()
          .from(tenantDataSchema.tallyStockItems)
          .where(eq(tenantDataSchema.tallyStockItems.id, input.itemId))
          .get()
      : db
          .select()
          .from(tenantDataSchema.tallyStockItems)
          .where(eq(tenantDataSchema.tallyStockItems.companyId, company.id))
          .all()
          .find((r) => r.name.trim().toLowerCase() === input.name.trim().toLowerCase());

    const itemGuid =
      existing?.itemGuid || `itm_${company.id}_${toSlugPart(input.name, 60)}`;
    const rowId = existing?.id || newEntityId("titem", ctx.workspaceId, now);

    db.insert(tenantDataSchema.tallyStockItems)
      .values({
        id: rowId,
        itemGuid,
        companyId: company.id,
        name: input.name.trim(),
        skuCode: input.skuCode?.trim() || null,
        partNumber: input.partNumber?.trim() || null,
        stockGroup: input.stockGroup.trim() || "Primary",
        stockCategory: input.stockCategory?.trim() || null,
        uom,
        hsnCode: input.hsnCode?.trim() || null,
        gstRateBps,
        sellingPricePaise,
        costPricePaise,
        openingQty,
        openingValuePaise,
        closingQty: openingQty,
        closingRatePaise: unitValRate,
        closingValuePaise: openingValuePaise,
        reorderLevelQty: roundQty(input.reorderLevelQty),
        minOrderQty: roundQty(input.minOrderQty),
        syncedFromTallyMaster: false,
        alterId: (existing?.alterId ?? 0) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tenantDataSchema.tallyStockItems.itemGuid,
        set: {
          name: input.name.trim(),
          skuCode: input.skuCode?.trim() || null,
          partNumber: input.partNumber?.trim() || null,
          stockGroup: input.stockGroup.trim() || "Primary",
          stockCategory: input.stockCategory?.trim() || null,
          uom,
          hsnCode: input.hsnCode?.trim() || null,
          gstRateBps,
          sellingPricePaise,
          costPricePaise,
          openingQty,
          openingValuePaise,
          closingRatePaise: unitValRate,
          reorderLevelQty: roundQty(input.reorderLevelQty),
          minOrderQty: roundQty(input.minOrderQty),
          syncedFromTallyMaster: false,
          alterId: (existing?.alterId ?? 0) + 1,
          updatedAt: now,
        },
      })
      .run();

    const saved = db
      .select()
      .from(tenantDataSchema.tallyStockItems)
      .where(eq(tenantDataSchema.tallyStockItems.itemGuid, itemGuid))
      .get()!;

    db.insert(tenantDataSchema.tallyStockBalances)
      .values({
        id: newEntityId("tsb", ctx.workspaceId, now),
        itemId: saved.id,
        companyId: company.id,
        godownName,
        batchName,
        expiryDate,
        closingQty: openingQty,
        closingValuePaise: openingValuePaise,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          tenantDataSchema.tallyStockBalances.itemId,
          tenantDataSchema.tallyStockBalances.godownName,
          tenantDataSchema.tallyStockBalances.batchName,
        ],
        set: {
          expiryDate,
          updatedAt: now,
        },
      })
      .run();

    recalculateCompanyInventoryMovements({
      db,
      workspaceId: ctx.workspaceId,
      companyId: company.id,
      itemIds: [saved.id],
      now,
    });

    return { itemId: saved.id, name: saved.name };
  },
});

export const deleteTallyStockItem = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    itemId: z.string().min(4),
  }),
  summarize: () => "Removed Stock Item from Tally Inventory mirror",
  handler: (ctx, input) => {
    const db = tenantDataDb(ctx);
    const existing = db
      .select()
      .from(tenantDataSchema.tallyStockItems)
      .where(eq(tenantDataSchema.tallyStockItems.id, input.itemId))
      .get();
    if (!existing) {
      throw new RslError("RSL-VAL-1001", "Stock item not found.");
    }
    db.delete(tenantDataSchema.tallyStockItems)
      .where(eq(tenantDataSchema.tallyStockItems.id, existing.id))
      .run();
    return { deleted: true, name: existing.name };
  },
});

/**
 * Bulk Import Tally Inventory Masters via Tally Prime XML (<STOCKITEM>/<GODOWN>/<LEDGER>) or Inventory CSV.
 */
export const bulkImportTallyInventory = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    companyName: z.string().min(2).max(120).default("Primary Tally Company"),
    format: z.enum(["tally_xml", "csv"]),
    rawContent: z.string().min(10),
  }),
  summarize: (input, out?: { stockItemsUpserted: number; godownsUpserted: number }) =>
    `Imported ${out?.stockItemsUpserted ?? 0} Tally stock item(s) via ${input.format.toUpperCase()}`,
  handler: (ctx, input) => {
    if (input.format === "tally_xml" || input.rawContent.trim().startsWith("<")) {
      const res = ingestTallyMastersXmlForWorkspace({
        workspaceId: ctx.workspaceId,
        rawXml: input.rawContent,
        fallbackCompanyName: input.companyName,
      });
      if (
        res.stockItemsUpserted === 0 &&
        res.godownsUpserted === 0 &&
        res.partiesUpserted === 0
      ) {
        throw new RslError(
          "RSL-VAL-1001",
          "No <STOCKITEM>, <GODOWN>, or Party <LEDGER> masters were found in the uploaded Tally XML."
        );
      }
      return res;
    }

    const lines = input.rawContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      throw new RslError(
        "RSL-VAL-1001",
        "Inventory CSV must contain a header row and at least one stock item row."
      );
    }

    const headers = lines[0]!
      .split(",")
      .map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
    const idx = (names: string[]) => headers.findIndex((h) => names.some((n) => h.includes(n)));

    const iName = idx(["itemname", "stockitem", "product", "name", "item"]);
    const iSku = idx(["sku", "partno", "partnumber", "code", "alias"]);
    const iGroup = idx(["stockgroup", "group", "category"]);
    const iUom = idx(["uom", "unit", "baseunit"]);
    const iHsn = idx(["hsn", "sac"]);
    const iGst = idx(["gst", "tax"]);
    const iSell = idx(["sellingprice", "mrp", "saleprice", "price", "rate"]);
    const iCost = idx(["costprice", "purchaseprice", "cost"]);
    const iOpen = idx(["openingqty", "closingqty", "qty", "stock", "quantity"]);
    const iReorder = idx(["reorder", "minstock"]);
    const iGodown = idx(["godown", "warehouse", "location"]);
    const iBatch = idx(["batch", "lot"]);
    const iExpiry = idx(["expiry", "expdate"]);

    const db = tenantDataDb(ctx);
    const now = Date.now();
    const company = ensureTallyCompanyRow(db, ctx.workspaceId, input.companyName, now);
    let upserted = 0;
    const itemIds: string[] = [];

    const tx = db.$client.transaction(() => {
      for (let r = 1; r < lines.length; r++) {
        const cols = lines[r]!
          .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
          .map((c) => c.replace(/^"|"$/g, "").trim());
        const name = (iName >= 0 ? cols[iName] : cols[0])?.trim();
        if (!name) continue;

        const skuCode = iSku >= 0 ? cols[iSku]?.trim() : undefined;
        const stockGroup = (iGroup >= 0 ? cols[iGroup]?.trim() : undefined) || "Primary";
        const uom = ((iUom >= 0 ? cols[iUom]?.trim() : undefined) || "PCS").toUpperCase();
        const hsnCode = iHsn >= 0 ? cols[iHsn]?.trim() : undefined;
        const gstRatePct = iGst >= 0 ? parseTallyRateNumber(cols[iGst] || "18") : 18;
        const sellingPricePaise = rupeesToPaise(
          iSell >= 0 ? parseTallyRateNumber(cols[iSell] || "0") : 0
        );
        const costPricePaise = rupeesToPaise(
          iCost >= 0 ? parseTallyRateNumber(cols[iCost] || "0") : 0
        );
        const openingQty =
          iOpen >= 0 ? parseTallyQuantityAndUom(cols[iOpen] || "0", true).qty : 0;
        const reorderLevelQty =
          iReorder >= 0 ? parseTallyQuantityAndUom(cols[iReorder] || "0").qty : 0;
        const godownName = (iGodown >= 0 ? cols[iGodown]?.trim() : undefined) || "Main Location";
        const batchName = (iBatch >= 0 ? cols[iBatch]?.trim() : undefined) || "Primary Batch";
        const expiryDate = iExpiry >= 0 ? parseTallyDateNullable(cols[iExpiry]) : null;

        const valRate = costPricePaise > 0 ? costPricePaise : sellingPricePaise;
        const openingValuePaise = Math.round(openingQty * valRate);

        ensureGodownRow({
          db,
          workspaceId: ctx.workspaceId,
          companyId: company.id,
          godownName,
          now,
        });

        const itemGuid = `itm_${company.id}_${toSlugPart(name, 60)}`;
        const rowId = newEntityId("titem", ctx.workspaceId, now);

        db.insert(tenantDataSchema.tallyStockItems)
          .values({
            id: rowId,
            itemGuid,
            companyId: company.id,
            name,
            skuCode: skuCode || null,
            partNumber: skuCode || null,
            stockGroup,
            uom,
            hsnCode: hsnCode || null,
            gstRateBps: Math.round(gstRatePct * 100),
            sellingPricePaise,
            costPricePaise,
            openingQty,
            openingValuePaise,
            closingQty: openingQty,
            closingRatePaise: valRate,
            closingValuePaise: openingValuePaise,
            reorderLevelQty,
            minOrderQty: 0,
            syncedFromTallyMaster: false,
            alterId: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: tenantDataSchema.tallyStockItems.itemGuid,
            set: {
              name,
              ...(skuCode ? { skuCode, partNumber: skuCode } : {}),
              stockGroup,
              uom,
              ...(hsnCode ? { hsnCode } : {}),
              gstRateBps: Math.round(gstRatePct * 100),
              sellingPricePaise,
              costPricePaise,
              openingQty,
              openingValuePaise,
              closingRatePaise: valRate,
              reorderLevelQty,
              syncedFromTallyMaster: false,
              updatedAt: now,
            },
          })
          .run();

        const saved = db
          .select({ id: tenantDataSchema.tallyStockItems.id })
          .from(tenantDataSchema.tallyStockItems)
          .where(eq(tenantDataSchema.tallyStockItems.itemGuid, itemGuid))
          .get();

        if (saved) {
          itemIds.push(saved.id);
          db.insert(tenantDataSchema.tallyStockBalances)
            .values({
              id: newEntityId("tsb", ctx.workspaceId, now),
              itemId: saved.id,
              companyId: company.id,
              godownName,
              batchName,
              expiryDate,
              closingQty: openingQty,
              closingValuePaise: openingValuePaise,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                tenantDataSchema.tallyStockBalances.itemId,
                tenantDataSchema.tallyStockBalances.godownName,
                tenantDataSchema.tallyStockBalances.batchName,
              ],
              set: {
                expiryDate,
                closingQty: openingQty,
                closingValuePaise: openingValuePaise,
                updatedAt: now,
              },
            })
            .run();
          upserted++;
        }
      }

      if (itemIds.length > 0) {
        recalculateCompanyInventoryMovements({
          db,
          workspaceId: ctx.workspaceId,
          companyId: company.id,
          itemIds,
          now,
        });
      }
    });

    tx.immediate();

    if (upserted === 0) {
      throw new RslError("RSL-VAL-1001", "No valid stock item rows found in CSV.");
    }

    return {
      stockItemsUpserted: upserted,
      godownsUpserted: 1,
      partiesUpserted: 0,
      detectedCompanyName: company.name,
    };
  },
});

function sanitizeCsvCell(val: string): string {
  const safe = /^[=+\-@]/.test(val.trimStart()) ? `'${val}` : val;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportTallyInventoryAsCsv(workspaceId: string): string {
  const db = tenantDataDb({ workspaceId });
  const companies = db.select().from(tenantDataSchema.tallyCompanies).all();
  const compMap = new Map(companies.map((c) => [c.id, c.name]));
  const items = db
    .select()
    .from(tenantDataSchema.tallyStockItems)
    .orderBy(desc(tenantDataSchema.tallyStockItems.closingValuePaise))
    .all();

  const header =
    "CompanyName,ItemName,SKU_PartNo,StockGroup,UOM,HSN,GSTRatePct,ClosingQty,ClosingValueRupees,SellingPriceRupees,CostPriceRupees,ReorderLevelQty,TotalSoldQty,TotalSoldRupees,LastSoldDate";

  const lines = items.map((i) =>
    [
      sanitizeCsvCell(compMap.get(i.companyId) ?? "Primary Tally Company"),
      sanitizeCsvCell(i.name),
      sanitizeCsvCell(i.partNumber || i.skuCode || ""),
      sanitizeCsvCell(i.stockGroup),
      sanitizeCsvCell(i.uom),
      sanitizeCsvCell(i.hsnCode || ""),
      (i.gstRateBps / 100).toFixed(2),
      i.closingQty.toString(),
      (i.closingValuePaise / 100).toFixed(2),
      (i.sellingPricePaise / 100).toFixed(2),
      (i.costPricePaise / 100).toFixed(2),
      i.reorderLevelQty.toString(),
      i.totalSoldQty.toString(),
      (i.totalSoldPaise / 100).toFixed(2),
      i.lastSoldAt ? new Date(i.lastSoldAt + 5.5 * 3600_000).toISOString().slice(0, 10) : "",
    ].join(",")
  );

  return [header, ...lines].join("\n");
}

export function exportTallyInventoryAsXml(workspaceId: string): string {
  const db = tenantDataDb({ workspaceId });
  const items = db
    .select()
    .from(tenantDataSchema.tallyStockItems)
    .orderBy(tenantDataSchema.tallyStockItems.name)
    .all();

  const messagesXml = items
    .map((item) => {
      const openVal = (Math.abs(item.openingValuePaise) / 100).toFixed(2);
      const signedOpenVal = item.openingQty >= 0 ? `-${openVal}` : openVal;
      return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <STOCKITEM NAME="${escapeXmlLocal(item.name)}" ACTION="Create">
          <GUID>${escapeXmlLocal(item.itemGuid)}</GUID>
          <NAME>${escapeXmlLocal(item.name)}</NAME>
          <PARENT>${escapeXmlLocal(item.stockGroup)}</PARENT>
          <BASEUNITS>${escapeXmlLocal(item.uom)}</BASEUNITS>
          ${item.partNumber ? `<PARTNO>${escapeXmlLocal(item.partNumber)}</PARTNO>` : ""}
          ${item.hsnCode ? `<HSNCODE>${escapeXmlLocal(item.hsnCode)}</HSNCODE>` : ""}
          <OPENINGBALANCE>${item.openingQty} ${escapeXmlLocal(item.uom)}</OPENINGBALANCE>
          <OPENINGVALUE>${signedOpenVal}</OPENINGVALUE>
          <REORDERBASE>${item.reorderLevelQty} ${escapeXmlLocal(item.uom)}</REORDERBASE>
        </STOCKITEM>
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
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${messagesXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * BizAnalyst & Livekeeping-Inspired Workspace Inventory & Stock Intelligence Summary
 */
export function getWorkspaceInventorySummary(workspaceId: string) {
  const db = tenantDataDb({ workspaceId });
  const now = Date.now();
  const dayMs = 86_400_000;

  const companies = db
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .orderBy(desc(tenantDataSchema.tallyCompanies.createdAt))
    .all();
  const companyMap = new Map(companies.map((c) => [c.id, c.name]));

  const godowns = db
    .select()
    .from(tenantDataSchema.tallyGodowns)
    .orderBy(tenantDataSchema.tallyGodowns.name)
    .all();

  const rawItems = db
    .select()
    .from(tenantDataSchema.tallyStockItems)
    .orderBy(desc(tenantDataSchema.tallyStockItems.closingValuePaise))
    .all();

  const rawBalances = db
    .select()
    .from(tenantDataSchema.tallyStockBalances)
    .orderBy(tenantDataSchema.tallyStockBalances.godownName)
    .all();

  const rawVouchers = db
    .select({
      id: tenantDataSchema.tallyVouchers.id,
      voucherNumber: tenantDataSchema.tallyVouchers.voucherNumber,
      paymentStatus: tenantDataSchema.tallyVouchers.paymentStatus,
    })
    .from(tenantDataSchema.tallyVouchers)
    .all();
  const voucherNoMap = new Map(rawVouchers.map((v) => [v.id, v]));

  const rawMovements = db
    .select()
    .from(tenantDataSchema.tallyVoucherItems)
    .orderBy(desc(tenantDataSchema.tallyVoucherItems.voucherDate))
    .limit(250)
    .all();

  const parties = db
    .select()
    .from(tenantDataSchema.tallyParties)
    .orderBy(desc(tenantDataSchema.tallyParties.closingBalancePaise))
    .limit(100)
    .all();

  const balancesByItem = new Map<string, typeof rawBalances>();
  for (const b of rawBalances) {
    const arr = balancesByItem.get(b.itemId) ?? [];
    arr.push(b);
    balancesByItem.set(b.itemId, arr);
  }

  let totalStockValuePaise = 0;
  let inStockSkusCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let negativeStockCount = 0;
  let fastMovingCount = 0;
  let inactive30dCount = 0;
  let inactive60dCount = 0;
  let inactive90dCount = 0;
  let inactive60dValuePaise = 0;
  let expiringSoonBatchCount = 0;
  let expiredBatchCount = 0;
  let totalItemSalesPaise = 0;
  let totalItemPurchasePaise = 0;

  const stockGroupSet = new Set<string>();
  const godownSummaryMap = new Map<
    string,
    { godownName: string; skuCount: number; totalQty: number; totalValuePaise: number }
  >();

  const enrichedBalances = rawBalances.map((b) => {
    const parentItem = rawItems.find((i) => i.id === b.itemId);
    const daysToExpiry =
      b.expiryDate !== null ? Math.ceil((b.expiryDate - now) / dayMs) : null;
    const expiryStatus: "expired" | "expiring_30d" | "ok" | "no_expiry" =
      daysToExpiry === null
        ? "no_expiry"
        : daysToExpiry < 0
          ? "expired"
          : daysToExpiry <= 30
            ? "expiring_30d"
            : "ok";

    if (b.closingQty > 0) {
      if (expiryStatus === "expired") expiredBatchCount++;
      else if (expiryStatus === "expiring_30d") expiringSoonBatchCount++;
    }

    const gEntry = godownSummaryMap.get(b.godownName) ?? {
      godownName: b.godownName,
      skuCount: 0,
      totalQty: 0,
      totalValuePaise: 0,
    };
    if (b.closingQty !== 0) gEntry.skuCount += 1;
    gEntry.totalQty = roundQty(gEntry.totalQty + b.closingQty);
    if (b.closingValuePaise > 0) gEntry.totalValuePaise += b.closingValuePaise;
    godownSummaryMap.set(b.godownName, gEntry);

    return {
      ...b,
      itemName: parentItem?.name ?? "Stock Item",
      uom: parentItem?.uom ?? "PCS",
      companyName: companyMap.get(b.companyId) ?? "Primary Tally Company",
      daysToExpiry,
      expiryStatus,
    };
  });

  const items = rawItems.map((item) => {
    stockGroupSet.add(item.stockGroup || "Primary");
    const itemBalances = balancesByItem.get(item.id) ?? [];

    const stockStatus: "negative_stock" | "out_of_stock" | "low_stock" | "healthy" =
      item.closingQty < 0
        ? "negative_stock"
        : item.closingQty === 0
          ? "out_of_stock"
          : item.reorderLevelQty > 0 && item.closingQty <= item.reorderLevelQty
            ? "low_stock"
            : "healthy";

    if (item.closingValuePaise > 0) {
      totalStockValuePaise += item.closingValuePaise;
    }
    if (item.closingQty > 0) inStockSkusCount++;
    if (stockStatus === "low_stock") lowStockCount++;
    if (stockStatus === "out_of_stock") outOfStockCount++;
    if (stockStatus === "negative_stock") negativeStockCount++;

    totalItemSalesPaise += item.totalSoldPaise;
    totalItemPurchasePaise += item.totalPurchasedPaise;

    const referenceAgeTs = item.lastSoldAt ?? item.createdAt;
    const daysSinceLastSale = item.lastSoldAt
      ? Math.max(0, Math.floor((now - item.lastSoldAt) / dayMs))
      : null;
    const inactiveAgeDays = Math.max(0, Math.floor((now - referenceAgeTs) / dayMs));

    const isFastMoving =
      item.totalSoldQty > 0 && daysSinceLastSale !== null && daysSinceLastSale <= 30;
    const isInactive30d =
      item.closingQty > 0 &&
      (item.lastSoldAt ? daysSinceLastSale! >= 30 : inactiveAgeDays >= 30);
    const isInactive60d =
      item.closingQty > 0 &&
      (item.lastSoldAt ? daysSinceLastSale! >= 60 : inactiveAgeDays >= 60);
    const isInactive90d =
      item.closingQty > 0 &&
      (item.lastSoldAt ? daysSinceLastSale! >= 90 : inactiveAgeDays >= 90);

    if (isFastMoving) fastMovingCount++;
    if (isInactive30d) inactive30dCount++;
    if (isInactive60d) {
      inactive60dCount++;
      if (item.closingValuePaise > 0) inactive60dValuePaise += item.closingValuePaise;
    }
    if (isInactive90d) inactive90dCount++;

    const effectiveCost = item.costPricePaise > 0 ? item.costPricePaise : item.closingRatePaise;
    const estimatedMarginBps =
      item.sellingPricePaise > 0 && effectiveCost > 0
        ? Math.round(((item.sellingPricePaise - effectiveCost) / item.sellingPricePaise) * 10000)
        : 0;

    const primaryGodown = itemBalances[0]?.godownName ?? "Main Location";
    const recommendedOrderQty =
      stockStatus === "low_stock" || stockStatus === "out_of_stock" || stockStatus === "negative_stock"
        ? roundQty(
            Math.max(
              item.minOrderQty > 0 ? item.minOrderQty : 1,
              (item.reorderLevelQty > 0 ? item.reorderLevelQty : 0) - item.closingQty
            )
          )
        : 0;

    return {
      ...item,
      gstRatePct: Math.round(item.gstRateBps) / 100,
      companyName: companyMap.get(item.companyId) ?? "Primary Tally Company",
      primaryGodown,
      godownCount: new Set(itemBalances.map((b) => b.godownName)).size || 1,
      stockStatus,
      daysSinceLastSale,
      inactiveAgeDays,
      isFastMoving,
      isInactive30d,
      isInactive60d,
      isInactive90d,
      estimatedMarginBps,
      recommendedOrderQty,
      estimatedOrderCostPaise: Math.round(recommendedOrderQty * effectiveCost),
    };
  });

  const reorderActionItems = items
    .filter(
      (i) =>
        i.stockStatus === "negative_stock" ||
        i.stockStatus === "low_stock" ||
        (i.stockStatus === "out_of_stock" && (i.reorderLevelQty > 0 || i.totalSoldQty > 0))
    )
    .sort((a, b) => a.closingQty - b.closingQty);

  const inactiveStockItems = items
    .filter((i) => i.isInactive30d)
    .sort((a, b) => b.closingValuePaise - a.closingValuePaise);

  const topSellingItems = [...items]
    .filter((i) => i.totalSoldPaise > 0 || i.totalSoldQty > 0)
    .sort((a, b) => b.totalSoldPaise - a.totalSoldPaise)
    .slice(0, 25);

  const recentMovements = rawMovements
    .filter((m) => {
      const v = voucherNoMap.get(m.voucherId);
      return !v || v.paymentStatus !== "cancelled";
    })
    .map((m) => {
      const baseQty = m.actualQty > 0 ? m.actualQty : m.billedQty;
      const signedQty = m.voucherType === "Sales" ? -roundQty(baseQty) : roundQty(baseQty);
      return {
        ...m,
        signedQty,
        voucherNumber: voucherNoMap.get(m.voucherId)?.voucherNumber ?? "—",
        companyName: companyMap.get(m.companyId) ?? "Primary Tally Company",
      };
    });

  return {
    companies,
    godowns,
    godownSummaries: Array.from(godownSummaryMap.values()).sort(
      (a, b) => b.totalValuePaise - a.totalValuePaise
    ),
    stockGroups: Array.from(stockGroupSet).sort(),
    items,
    balances: enrichedBalances,
    reorderActionItems,
    inactiveStockItems,
    topSellingItems,
    recentMovements,
    parties: parties.map((p) => ({
      ...p,
      companyName: companyMap.get(p.companyId) ?? "Primary Tally Company",
      creditExceeded:
        p.creditLimitPaise > 0 && p.closingBalancePaise > p.creditLimitPaise,
    })),
    kpis: {
      totalStockValuePaise,
      totalSkusCount: items.length,
      inStockSkusCount,
      lowStockCount,
      outOfStockCount,
      negativeStockCount,
      fastMovingCount,
      inactive30dCount,
      inactive60dCount,
      inactive90dCount,
      inactive60dValuePaise,
      expiringSoonBatchCount,
      expiredBatchCount,
      totalItemSalesPaise,
      totalItemPurchasePaise,
      godownCount: Math.max(godownSummaryMap.size, godowns.length),
    },
  };
}

/**
 * Lookup map of voucherId -> line items summary for the `/tally` Bills Register table!
 */
export function listVoucherLineItemsMap(workspaceId: string): Map<
  string,
  Array<{
    itemName: string;
    billedQty: number;
    uom: string;
    ratePaise: number;
    amountPaise: number;
    godownName: string;
    batchName: string;
  }>
> {
  const db = tenantDataDb({ workspaceId });
  const rows = db
    .select({
      voucherId: tenantDataSchema.tallyVoucherItems.voucherId,
      itemName: tenantDataSchema.tallyVoucherItems.itemName,
      billedQty: tenantDataSchema.tallyVoucherItems.billedQty,
      uom: tenantDataSchema.tallyVoucherItems.uom,
      ratePaise: tenantDataSchema.tallyVoucherItems.ratePaise,
      amountPaise: tenantDataSchema.tallyVoucherItems.amountPaise,
      godownName: tenantDataSchema.tallyVoucherItems.godownName,
      batchName: tenantDataSchema.tallyVoucherItems.batchName,
    })
    .from(tenantDataSchema.tallyVoucherItems)
    .all();

  const map = new Map<
    string,
    Array<{
      itemName: string;
      billedQty: number;
      uom: string;
      ratePaise: number;
      amountPaise: number;
      godownName: string;
      batchName: string;
    }>
  >();

  for (const r of rows) {
    const list = map.get(r.voucherId) ?? [];
    list.push({
      itemName: r.itemName,
      billedQty: r.billedQty,
      uom: r.uom,
      ratePaise: r.ratePaise,
      amountPaise: r.amountPaise,
      godownName: r.godownName,
      batchName: r.batchName,
    });
    map.set(r.voucherId, list);
  }
  return map;
}

export async function syncLocalTallyInventoryMastersFromPort9000(params: {
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  openCompanies: string[];
  port?: number;
  isCompanyAllowed?: (companyName: string) => boolean;
}): Promise<{
  stockItemsUpserted: number;
  godownsUpserted: number;
  partiesUpserted: number;
}> {
  const safePort =
    params.port && Number.isInteger(params.port) && params.port >= 1024 && params.port <= 65535
      ? params.port
      : 9000;

  let stockItemsUpserted = 0;
  let godownsUpserted = 0;
  let partiesUpserted = 0;

  for (const companyName of params.openCompanies) {
    if (params.isCompanyAllowed && !params.isCompanyAllowed(companyName)) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`http://127.0.0.1:${safePort}`, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: buildLocalTallyStockCollectionXml(companyName),
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (res.ok) {
        const xml = await res.text();
        const out = ingestTallyMastersXmlForWorkspace({
          workspaceId: params.workspaceId,
          rawXml: xml,
          fallbackCompanyName: companyName,
          isCompanyAllowed: params.isCompanyAllowed,
        });
        stockItemsUpserted += out.stockItemsUpserted;
        godownsUpserted += out.godownsUpserted;
        partiesUpserted += out.partiesUpserted;
      }
    } catch {
      // Non-blocking if Tally stock collection unavailable
    }
  }

  if (stockItemsUpserted > 0 || godownsUpserted > 0 || partiesUpserted > 0) {
    const corr = newId();
    appendActionLog({
      workspaceId: params.workspaceId,
      actorType: params.actorType,
      actorId: params.actorId,
      source: "webhook",
      action: "tally.vouchers.synced",
      outcome: "success",
      requestId: corr,
      correlationId: corr,
      durationMs: 7,
      summary: `Synced ${stockItemsUpserted} Tally Stock Item(s) & ${godownsUpserted} Godown(s) from Port ${safePort}`,
    });
  }

  return { stockItemsUpserted, godownsUpserted, partiesUpserted };
}
