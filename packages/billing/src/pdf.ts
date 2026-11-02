import fs from "node:fs";
import path from "node:path";
import {
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

export interface GstInvoicePdfInput {
  invoiceNumber: string;
  financialYear: string;
  description: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  hsnSac: string;
  status: string;
  issuedAt: number;
  paidAt: number | null;
  buyerName: string;
  buyerGstin: string | null;
  buyerStateCode: string;
  buyerStateName?: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  seller: {
    payeeName: string;
    gstin: string;
    stateCode?: string;
    stateName?: string;
    billingEmail: string;
    supportPhone: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    upiId: string;
  };
}

export interface WalletStatementPdfInput {
  workspaceName: string;
  workspaceGstin?: string | null;
  balancePaise: number;
  freeAccessUntil?: number | null;
  entries: Array<{
    createdAt: number;
    entryType: string;
    description: string;
    amountPaise: number;
  }>;
  invoices: Array<{
    invoiceNumber: string;
    issuedAt: number;
    status: string;
    totalPaise: number;
    description: string;
  }>;
}

export interface TallyReceivablesPdfInput {
  workspaceName: string;
  companyName?: string | null;
  totalBilledPaise: number;
  totalCollectedPaise: number;
  totalPendingPaise: number;
  vouchers: Array<{
    voucherNumber: string;
    voucherType: string;
    partyName: string;
    voucherDate: number;
    dueDate: number | null;
    amountPaise: number;
    paidAmountPaise: number;
    paymentStatus: string;
  }>;
}

export interface AnalyticsReportPdfInput {
  workspaceName: string;
  rangeLabel: string;
  moneyCollectedPaise: number;
  overdueReceivablesPaise: number;
  marketingSpendPaise: number;
  salesLinkedPaise: number;
  returnPerRupeeSpent: number;
  replyRatePct: number;
  avgReplyMinutes: number;
  walletBalancePaise: number;
  contactsTotalCount: number;
  optedInCount: number;
  campaigns: Array<{
    name: string;
    channel: string;
    status: string;
    spendPaise: number;
    revenuePaise: number;
    conversions: number;
  }>;
}

/**
 * Ensures text contains only WinAnsi-encodable characters so `pdf-lib` StandardFonts never throw.
 */
function safePdfText(input: unknown, maxLen = 140): string {
  const s = String(input ?? "")
    .replace(/₹/g, "Rs. ")
    .replace(/[•·]/g, " | ")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}...` : s;
}

function pdfInr(paise: number, showDecimals = true): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise) / 100;
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${sign}Rs. ${formatted}`;
}

function pdfDate(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function indianRupeesInWords(paise: number): string {
  const rupees = Math.round(Math.max(0, paise) / 100);
  if (rupees === 0) return "Rupees Zero Only";

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const underThousand = (n: number): string => {
    if (n === 0) return "";
    if (n < 20) return ones[n]!;
    if (n < 100) {
      return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`;
    }
    return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
  };

  let rem = rupees;
  const parts: string[] = [];
  const crore = Math.floor(rem / 10_000_000);
  if (crore > 0) {
    parts.push(`${underThousand(crore)} Crore`);
    rem %= 10_000_000;
  }
  const lakh = Math.floor(rem / 100_000);
  if (lakh > 0) {
    parts.push(`${underThousand(lakh)} Lakh`);
    rem %= 100_000;
  }
  const thousand = Math.floor(rem / 1000);
  if (thousand > 0) {
    parts.push(`${underThousand(thousand)} Thousand`);
    rem %= 1000;
  }
  if (rem > 0) {
    parts.push(underThousand(rem));
  }
  return `Rupees ${parts.join(" ")} Only`;
}

// Cool Studio Neutral Corporate Stationery Palette
const SLATE_900 = rgb(0.06, 0.09, 0.16);
const SLATE_700 = rgb(0.2, 0.25, 0.33);
const SLATE_600 = rgb(0.32, 0.36, 0.42);
const ZINC_400 = rgb(0.45, 0.45, 0.5);
const ZINC_200 = rgb(0.89, 0.89, 0.91);
const ZINC_100 = rgb(0.95, 0.96, 0.97);
const ZINC_50 = rgb(0.973, 0.976, 0.984);
const WHITE = rgb(1, 1, 1);
const EMERALD_600 = rgb(0.02, 0.59, 0.41);
const EMERALD_700 = rgb(0.02, 0.47, 0.34);
const EMERALD_200 = rgb(0.65, 0.95, 0.82);
const EMERALD_50 = rgb(0.93, 0.99, 0.96);
const AMBER_700 = rgb(0.71, 0.33, 0.04);
const AMBER_200 = rgb(0.99, 0.9, 0.54);
const AMBER_50 = rgb(1, 0.98, 0.92);
const RUBY_700 = rgb(0.73, 0.11, 0.11);

interface CachedBrandAssets {
  loaded: boolean;
  longPng: Uint8Array | null;
  longJpg: Uint8Array | null;
  markPng: Uint8Array | null;
}

const brandAssetCache: CachedBrandAssets = {
  loaded: false,
  longPng: null,
  longJpg: null,
  markPng: null,
};

function findPublicAssetBytes(fileName: string): Uint8Array | null {
  const relDirs = [
    "public",
    path.join("..", "public"),
    path.join("..", "..", "public"),
    path.join("..", "..", "..", "public"),
  ];
  for (const rel of relDirs) {
    const candidate = path.resolve(/*turbopackIgnore: true*/ process.cwd(), rel, fileName);
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return new Uint8Array(fs.readFileSync(/*turbopackIgnore: true*/ candidate));
    }
  }
  return null;
}

function getBrandAssetBytes(): CachedBrandAssets {
  if (!brandAssetCache.loaded) {
    brandAssetCache.longPng = findPublicAssetBytes("long-logo-nobg.png");
    brandAssetCache.markPng = findPublicAssetBytes("logo-nobg.png");
    if (!brandAssetCache.longPng) {
      brandAssetCache.longJpg = findPublicAssetBytes("long-logo.jpeg");
    }
    brandAssetCache.loaded = true;
  }
  return brandAssetCache;
}

interface StationeryContext {
  fontRegular: PDFFont;
  fontBold: PDFFont;
  longLogo: PDFImage | null;
  markLogo: PDFImage | null;
}

async function createStationeryContext(doc: PDFDocument): Promise<StationeryContext> {
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const raw = getBrandAssetBytes();

  let longLogo: PDFImage | null = null;
  let markLogo: PDFImage | null = null;

  try {
    if (raw.longPng) {
      longLogo = await doc.embedPng(raw.longPng);
    } else if (raw.longJpg) {
      longLogo = await doc.embedJpg(raw.longJpg);
    }
  } catch {
    longLogo = null;
  }

  try {
    if (raw.markPng) {
      markLogo = await doc.embedPng(raw.markPng);
    }
  } catch {
    markLogo = null;
  }

  return { fontRegular, fontBold, longLogo, markLogo };
}

type BadgeTone = "emerald" | "amber" | "slate";

function drawRightText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color = SLATE_900,
  maxLen = 74
) {
  const clean = safePdfText(text, maxLen);
  const w = font.widthOfTextAtSize(clean, size);
  page.drawText(clean, { x: rightX - w, y, size, font, color });
}

function fitPdfTextToWidth(
  text: unknown,
  font: PDFFont,
  size: number,
  maxWidthPt: number
): string {
  const clean = safePdfText(text, 160);
  if (font.widthOfTextAtSize(clean, size) <= maxWidthPt) {
    return clean;
  }
  const ellipsis = "...";
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${clean.slice(0, mid).trimEnd()}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidthPt) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${clean.slice(0, Math.max(1, lo)).trimEnd()}${ellipsis}`;
}

function wrapPdfLines(
  text: unknown,
  font: PDFFont,
  size: number,
  maxWidthPt: number,
  maxLines = 2
): string[] {
  const clean = safePdfText(text, 220);
  if (!clean) return [""];
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidthPt) {
      current = next;
    } else {
      if (lines.length + 1 >= maxLines) {
        const rest = [current, ...words.slice(i)].filter(Boolean).join(" ");
        lines.push(fitPdfTextToWidth(rest, font, size, maxWidthPt));
        return lines;
      }
      if (current) {
        lines.push(current);
        current = word;
      } else {
        lines.push(fitPdfTextToWidth(word, font, size, maxWidthPt));
        current = "";
      }
    }
  }
  if (current) {
    lines.push(fitPdfTextToWidth(current, font, size, maxWidthPt));
  }
  return lines.slice(0, maxLines);
}

/**
 * Draws the executive RapidShift Labs corporate letterhead at the top of Page 1.
 * Returns the recommended initial vertical Y cursor for page body content.
 */
function drawStationeryHeader(
  page: PDFPage,
  ctx: StationeryContext,
  opts: {
    docTitle: string;
    primaryMeta: string;
    secondaryMeta: string;
    badgeLabel: string;
    badgeTone?: BadgeTone;
    brandTagline?: string;
    brandSubline?: string;
  }
): number {
  const { width, height } = page.getSize();
  const rightX = width - 40;

  // 1. Clean White Letterhead Band
  page.drawRectangle({
    x: 0,
    y: height - 106,
    width,
    height: 106,
    color: WHITE,
  });

  // 2. Full-Bleed Dual-Tone Top Brand Rule (74% Deep Slate + 26% Emerald)
  const splitX = Math.round(width * 0.74);
  page.drawRectangle({
    x: 0,
    y: height - 6,
    width: splitX,
    height: 6,
    color: SLATE_900,
  });
  page.drawRectangle({
    x: splitX,
    y: height - 6,
    width: width - splitX,
    height: 6,
    color: EMERALD_600,
  });

  // 3. Subtle Architectural Hairline Divider Under Letterhead
  page.drawRectangle({
    x: 0,
    y: height - 105,
    width,
    height: 2,
    color: ZINC_100,
  });
  page.drawLine({
    start: { x: 40, y: height - 106 },
    end: { x: rightX, y: height - 106 },
    thickness: 1,
    color: ZINC_200,
  });

  // 4. Left Column: Official RapidShift Labs Horizontal Lockup + Suite Caption
  if (ctx.longLogo) {
    const logoH = 34;
    const logoW = logoH * (ctx.longLogo.width / ctx.longLogo.height);
    page.drawImage(ctx.longLogo, {
      x: 40,
      y: height - 56,
      width: logoW,
      height: logoH,
    });
  } else {
    page.drawText("RapidShift LABS", {
      x: 40,
      y: height - 42,
      size: 16,
      font: ctx.fontBold,
      color: SLATE_900,
    });
  }

  page.drawText(
    safePdfText(opts.brandTagline || "RSL Marketing & Tally Automation Suite", 54),
    {
      x: 40,
      y: height - 74,
      size: 8.5,
      font: ctx.fontBold,
      color: SLATE_900,
    }
  );
  page.drawText(
    safePdfText(opts.brandSubline || "RapidShift Labs  |  Official Business Record", 60),
    {
      x: 40,
      y: height - 87,
      size: 7.5,
      font: ctx.fontRegular,
      color: SLATE_600,
    }
  );

  // 5. Right Column: Tinted Status Pill + Document Title + Reference Metadata
  const tone = opts.badgeTone || "emerald";
  const badgeText = safePdfText(opts.badgeLabel, 32);
  const badgeW = ctx.fontBold.widthOfTextAtSize(badgeText, 8) + 18;
  const badgeFill = tone === "emerald" ? EMERALD_50 : tone === "amber" ? AMBER_50 : ZINC_100;
  const badgeBorder = tone === "emerald" ? EMERALD_200 : tone === "amber" ? AMBER_200 : ZINC_200;
  const badgeInk = tone === "emerald" ? EMERALD_700 : tone === "amber" ? AMBER_700 : SLATE_900;

  page.drawRectangle({
    x: rightX - badgeW,
    y: height - 42,
    width: badgeW,
    height: 18,
    color: badgeFill,
    borderColor: badgeBorder,
    borderWidth: 1,
  });
  page.drawText(badgeText, {
    x: rightX - badgeW + 9,
    y: height - 36,
    size: 8,
    font: ctx.fontBold,
    color: badgeInk,
  });

  drawRightText(page, opts.docTitle, rightX, height - 63, 13.5, ctx.fontBold, SLATE_900, 44);
  drawRightText(page, opts.primaryMeta, rightX, height - 78, 8, ctx.fontBold, SLATE_700, 62);
  drawRightText(page, opts.secondaryMeta, rightX, height - 90, 7.5, ctx.fontRegular, ZINC_400, 68);

  return height - 122;
}

/**
 * Adds a continuation A4 page with a compact branded RapidShift Labs letterhead strip.
 */
function addContinuationPage(
  doc: PDFDocument,
  ctx: StationeryContext,
  docTitle: string,
  referenceMeta: string
): { page: PDFPage; y: number } {
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const rightX = width - 40;

  const splitX = Math.round(width * 0.74);
  page.drawRectangle({ x: 0, y: height - 4, width: splitX, height: 4, color: SLATE_900 });
  page.drawRectangle({
    x: splitX,
    y: height - 4,
    width: width - splitX,
    height: 4,
    color: EMERALD_600,
  });

  if (ctx.longLogo) {
    const logoH = 22;
    const logoW = logoH * (ctx.longLogo.width / ctx.longLogo.height);
    page.drawImage(ctx.longLogo, {
      x: 40,
      y: height - 40,
      width: logoW,
      height: logoH,
    });
  } else {
    page.drawText("RapidShift LABS", {
      x: 40,
      y: height - 32,
      size: 11,
      font: ctx.fontBold,
      color: SLATE_900,
    });
  }

  drawRightText(
    page,
    `${docTitle} (Continued)`,
    rightX,
    height - 28,
    9.5,
    ctx.fontBold,
    SLATE_900,
    52
  );
  drawRightText(page, referenceMeta, rightX, height - 41, 7.5, ctx.fontRegular, SLATE_600, 64);

  page.drawLine({
    start: { x: 40, y: height - 54 },
    end: { x: rightX, y: height - 54 },
    thickness: 0.8,
    color: ZINC_200,
  });

  return { page, y: height - 72 };
}

/**
 * Stamps every page in the PDF document with a unified branded footer containing
 * the RapidShift Labs monogram mark, statutory/confidentiality note, date, and Page X of Y.
 */
function stampStationeryFooters(
  doc: PDFDocument,
  ctx: StationeryContext,
  footerNote: string
) {
  const pages = doc.getPages();
  const totalPages = pages.length;
  const generatedLabel = `Generated ${pdfDate(Date.now())}`;

  for (let idx = 0; idx < totalPages; idx++) {
    const p = pages[idx]!;
    const { width } = p.getSize();
    const rightX = width - 40;

    p.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: 46,
      color: ZINC_50,
    });
    p.drawLine({
      start: { x: 40, y: 46 },
      end: { x: rightX, y: 46 },
      thickness: 0.8,
      color: ZINC_200,
    });

    let textStartX = 40;
    if (ctx.markLogo) {
      p.drawImage(ctx.markLogo, {
        x: 40,
        y: 15,
        width: 16,
        height: 16,
      });
      textStartX = 63;
    }

    p.drawText("RapidShift Labs  |  RSL Marketing & Tally Suite", {
      x: textStartX,
      y: 25,
      size: 7.5,
      font: ctx.fontBold,
      color: SLATE_900,
    });
    p.drawText(safePdfText(footerNote, 92), {
      x: textStartX,
      y: 13.5,
      size: 7,
      font: ctx.fontRegular,
      color: SLATE_600,
    });

    drawRightText(
      p,
      `Page ${idx + 1} of ${totalPages}`,
      rightX,
      25,
      7.5,
      ctx.fontBold,
      SLATE_900,
      24
    );
    drawRightText(p, generatedLabel, rightX, 13.5, 7, ctx.fontRegular, ZINC_400, 32);
  }
}

/**
 * 1. Official GST Tax Invoice PDF Generator (SAC 998314)
 */
export async function generateGstInvoicePdfBytes(inv: GstInvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`GST Tax Invoice ${inv.invoiceNumber}`);
  doc.setAuthor(safePdfText(inv.seller.payeeName));
  doc.setCreator("RapidShift Labs — RSL Marketing & Tally Suite");
  doc.setSubject(`GST Tax Invoice for ${safePdfText(inv.buyerName)}`);

  const ctx = await createStationeryContext(doc);
  const { fontRegular, fontBold } = ctx;

  const page = doc.addPage([595.28, 841.89]);
  const { width } = page.getSize();

  const statusUpper = inv.status.toUpperCase();
  const statusTone: BadgeTone =
    inv.status === "paid" ? "emerald" : inv.status === "void" ? "slate" : "amber";

  let y = drawStationeryHeader(page, ctx, {
    docTitle: "GST TAX INVOICE",
    primaryMeta: `Invoice # ${inv.invoiceNumber}  |  FY ${inv.financialYear}`,
    secondaryMeta: `Original for Recipient  |  SAC ${inv.hsnSac || "998314"}`,
    badgeLabel: statusUpper === "PAID" ? "PAID IN FULL" : statusUpper,
    badgeTone: statusTone,
    brandTagline: inv.seller.payeeName,
    brandSubline: "Cloud Marketing, WhatsApp Business & Tally Automation Suite",
  });

  // Seller & Buyer 2-column box
  page.drawRectangle({
    x: 40,
    y: y - 108,
    width: width - 80,
    height: 112,
    color: ZINC_50,
    borderColor: ZINC_200,
    borderWidth: 1,
  });
  page.drawLine({
    start: { x: 304, y: y - 98 },
    end: { x: 304, y: y - 8 },
    thickness: 0.75,
    color: ZINC_200,
  });

  // Left: Issued By
  page.drawText("ISSUED BY (SUPPLIER)", {
    x: 54,
    y: y - 16,
    size: 8,
    font: fontBold,
    color: SLATE_600,
  });
  page.drawText(safePdfText(inv.seller.payeeName, 42), {
    x: 54,
    y: y - 32,
    size: 10.5,
    font: fontBold,
    color: SLATE_900,
  });
  page.drawText(`GSTIN: ${safePdfText(inv.seller.gstin || "27AABCR0000A1Z5", 30)}`, {
    x: 54,
    y: y - 48,
    size: 8.8,
    font: fontRegular,
    color: SLATE_600,
  });
  page.drawText(
    `State: ${safePdfText(inv.seller.stateCode || "27")} - ${safePdfText(inv.seller.stateName || "Maharashtra")}`,
    {
      x: 54,
      y: y - 62,
      size: 8.8,
      font: fontRegular,
      color: SLATE_600,
    }
  );
  page.drawText(`Billing Desk: ${safePdfText(inv.seller.billingEmail, 40)}`, {
    x: 54,
    y: y - 76,
    size: 8.8,
    font: fontRegular,
    color: SLATE_600,
  });
  page.drawText(`Support: ${safePdfText(inv.seller.supportPhone, 32)}`, {
    x: 54,
    y: y - 90,
    size: 8.8,
    font: fontRegular,
    color: SLATE_600,
  });

  // Right: Billed To
  const rightColX = 318;
  page.drawText("BILLED TO (RECIPIENT)", {
    x: rightColX,
    y: y - 16,
    size: 8,
    font: fontBold,
    color: SLATE_600,
  });
  page.drawText(safePdfText(inv.buyerName, 38), {
    x: rightColX,
    y: y - 32,
    size: 10.5,
    font: fontBold,
    color: SLATE_900,
  });
  page.drawText(
    `GSTIN: ${safePdfText(inv.buyerGstin || "Unregistered Business (B2C)", 34)}`,
    {
      x: rightColX,
      y: y - 48,
      size: 8.8,
      font: fontRegular,
      color: SLATE_600,
    }
  );
  page.drawText(
    `Place of Supply: ${safePdfText(inv.buyerStateCode)}${inv.buyerStateName ? ` - ${safePdfText(inv.buyerStateName)}` : ""}`,
    {
      x: rightColX,
      y: y - 62,
      size: 8.8,
      font: fontRegular,
      color: SLATE_600,
    }
  );
  page.drawText(`Invoice No: ${safePdfText(inv.invoiceNumber, 32)}`, {
    x: rightColX,
    y: y - 76,
    size: 8.8,
    font: fontBold,
    color: SLATE_900,
  });
  page.drawText(
    `Issued: ${pdfDate(inv.issuedAt)}${inv.paidAt ? `  |  Paid: ${pdfDate(inv.paidAt)}` : ""}`,
    {
      x: rightColX,
      y: y - 90,
      size: 8.8,
      font: fontRegular,
      color: SLATE_600,
    }
  );

  y -= 130;

  // Line Item Table Header
  page.drawRectangle({
    x: 40,
    y: y - 24,
    width: width - 80,
    height: 24,
    color: SLATE_900,
  });
  page.drawText("SERVICE DESCRIPTION", { x: 52, y: y - 15.5, size: 8.2, font: fontBold, color: WHITE });
  page.drawText("SAC", { x: 300, y: y - 15.5, size: 8.2, font: fontBold, color: WHITE });
  drawRightText(page, "TAXABLE VALUE", 435, y - 15.5, 8.2, fontBold, WHITE);
  drawRightText(page, "TOTAL (INR)", width - 52, y - 15.5, 8.2, fontBold, WHITE);

  y -= 24;

  // Line Item Row (width-wrapped service description with crisp column gutter)
  const descLines = wrapPdfLines(inv.description, fontBold, 9.5, 234, 2);
  const rowHeight = descLines.length > 1 ? 62 : 52;

  page.drawRectangle({
    x: 40,
    y: y - rowHeight,
    width: width - 80,
    height: rowHeight,
    color: WHITE,
    borderColor: ZINC_200,
    borderWidth: 1,
  });
  descLines.forEach((line, idx) => {
    page.drawText(line, {
      x: 52,
      y: y - 19 - idx * 12.5,
      size: 9.5,
      font: fontBold,
      color: SLATE_900,
    });
  });
  page.drawText("Cloud Marketing, Tally Sync & Messaging Software Subscription", {
    x: 52,
    y: y - (descLines.length > 1 ? 48 : 35),
    size: 8,
    font: fontRegular,
    color: SLATE_600,
  });
  page.drawText(safePdfText(inv.hsnSac || "998314", 12), {
    x: 300,
    y: y - 26,
    size: 9,
    font: fontRegular,
    color: SLATE_900,
  });
  drawRightText(page, pdfInr(inv.subtotalPaise), 435, y - 26, 9.5, fontRegular, SLATE_900);
  drawRightText(page, pdfInr(inv.totalPaise), width - 52, y - 26, 9.5, fontBold, SLATE_900);

  y -= rowHeight + 18;

  // Tax Breakdown Summary Box (Right Aligned)
  const boxX = 305;
  const boxW = width - 40 - boxX;
  page.drawRectangle({
    x: boxX,
    y: y - 110,
    width: boxW,
    height: 110,
    color: ZINC_50,
    borderColor: ZINC_200,
    borderWidth: 1,
  });

  page.drawText("Subtotal (Before Tax)", { x: boxX + 12, y: y - 20, size: 9, font: fontRegular, color: SLATE_600 });
  drawRightText(page, pdfInr(inv.subtotalPaise), width - 52, y - 20, 9, fontBold, SLATE_900);

  if (inv.igstPaise > 0) {
    page.drawText("IGST (18% Inter-State)", { x: boxX + 12, y: y - 40, size: 9, font: fontRegular, color: SLATE_600 });
    drawRightText(page, pdfInr(inv.igstPaise), width - 52, y - 40, 9, fontRegular, SLATE_900);
  } else {
    page.drawText("CGST (9% Central Tax)", { x: boxX + 12, y: y - 38, size: 9, font: fontRegular, color: SLATE_600 });
    drawRightText(page, pdfInr(inv.cgstPaise), width - 52, y - 38, 9, fontRegular, SLATE_900);
    page.drawText("SGST (9% State Tax)", { x: boxX + 12, y: y - 55, size: 9, font: fontRegular, color: SLATE_600 });
    drawRightText(page, pdfInr(inv.sgstPaise), width - 52, y - 55, 9, fontRegular, SLATE_900);
  }

  page.drawLine({
    start: { x: boxX + 12, y: y - 72 },
    end: { x: width - 52, y: y - 72 },
    thickness: 1,
    color: ZINC_200,
  });

  page.drawText("TOTAL PAYABLE (INR)", {
    x: boxX + 12,
    y: y - 92,
    size: 10,
    font: fontBold,
    color: SLATE_900,
  });
  drawRightText(page, pdfInr(inv.totalPaise), width - 52, y - 92, 11, fontBold, EMERALD_700);

  // Left side next to totals: Amount in words & Payment Reference
  page.drawText("AMOUNT IN WORDS", { x: 40, y: y - 16, size: 8, font: fontBold, color: SLATE_600 });
  page.drawText(safePdfText(indianRupeesInWords(inv.totalPaise), 60), {
    x: 40,
    y: y - 32,
    size: 9.5,
    font: fontBold,
    color: SLATE_900,
  });

  if (inv.paymentReference || inv.paymentMethod) {
    page.drawRectangle({
      x: 40,
      y: y - 98,
      width: 248,
      height: 50,
      color: EMERALD_50,
      borderColor: EMERALD_200,
      borderWidth: 1,
    });
    page.drawText("VERIFIED PAYMENT RECEIPT", {
      x: 50,
      y: y - 64,
      size: 8,
      font: fontBold,
      color: EMERALD_700,
    });
    page.drawText(
      `Method: ${safePdfText((inv.paymentMethod || "UPI").toUpperCase(), 18)}  |  Ref: ${safePdfText(inv.paymentReference || "Recorded", 28)}`,
      {
        x: 50,
        y: y - 82,
        size: 8.5,
        font: fontRegular,
        color: SLATE_900,
      }
    );
  }

  y -= 132;

  // Bank & UPI Remittance Box
  page.drawRectangle({
    x: 40,
    y: y - 74,
    width: width - 80,
    height: 74,
    color: ZINC_50,
    borderColor: ZINC_200,
    borderWidth: 1,
  });
  page.drawText("OFFICIAL BANK & UPI REMITTANCE DETAILS", {
    x: 52,
    y: y - 18,
    size: 8,
    font: fontBold,
    color: SLATE_600,
  });
  page.drawText(
    `Beneficiary: ${safePdfText(inv.seller.payeeName, 44)}   |   Bank: ${safePdfText(inv.seller.bankName, 36)}`,
    { x: 52, y: y - 36, size: 9, font: fontBold, color: SLATE_900 }
  );
  const upiSuffix =
    inv.seller.upiId && !inv.seller.upiId.endsWith(".ifsc.npci")
      ? `   |   UPI: ${safePdfText(inv.seller.upiId, 32)}`
      : "   |   UPI Bank Transfer Enabled";
  page.drawText(
    `A/c No: ${safePdfText(inv.seller.accountNumber, 28)}   |   IFSC: ${safePdfText(inv.seller.ifscCode, 18)}${upiSuffix}`,
    { x: 52, y: y - 54, size: 8.5, font: fontRegular, color: SLATE_600 }
  );

  // Authorized Signatory Line
  drawRightText(
    page,
    `For ${inv.seller.payeeName} (Authorized Digital Record)`,
    width - 40,
    y - 96,
    8.2,
    fontBold,
    SLATE_700,
    60
  );

  stampStationeryFooters(
    doc,
    ctx,
    "Computer-generated GST Tax Invoice under Rule 46 of CGST Rules, 2017. Physical signature is not required."
  );

  return doc.save();
}

/**
 * 2. Prepaid Wallet & Billing Account Statement PDF Generator
 */
export async function generateWalletStatementPdfBytes(
  data: WalletStatementPdfInput
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Wallet & Billing Statement - ${safePdfText(data.workspaceName)}`);
  doc.setCreator("RapidShift Labs — RSL Marketing & Tally Suite");

  const ctx = await createStationeryContext(doc);
  const { fontRegular, fontBold } = ctx;

  let page = doc.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  const refMeta = `${data.workspaceName}${data.workspaceGstin ? `  |  GSTIN ${data.workspaceGstin}` : ""}`;

  let y = drawStationeryHeader(page, ctx, {
    docTitle: "WALLET & BILLING STATEMENT",
    primaryMeta: refMeta,
    secondaryMeta: `Statement Date: ${pdfDate(Date.now())}  |  All amounts in INR`,
    badgeLabel: `BAL: ${pdfInr(data.balancePaise, false)}`,
    badgeTone: "emerald",
  });

  const totalCredits = data.entries
    .filter((e) => e.amountPaise > 0)
    .reduce((acc, e) => acc + e.amountPaise, 0);
  const totalDebits = data.entries
    .filter((e) => e.amountPaise < 0)
    .reduce((acc, e) => acc + Math.abs(e.amountPaise), 0);

  page.drawRectangle({
    x: 40,
    y: y - 58,
    width: width - 80,
    height: 58,
    color: ZINC_50,
    borderColor: ZINC_200,
    borderWidth: 1,
  });

  page.drawText("AVAILABLE WALLET", { x: 54, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(data.balancePaise), { x: 54, y: y - 38, size: 12, font: fontBold, color: EMERALD_700 });

  page.drawText("TOTAL CREDITED", { x: 220, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(totalCredits), { x: 220, y: y - 38, size: 11, font: fontBold, color: SLATE_900 });

  page.drawText("TOTAL USAGE / DEBITS", { x: 390, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(totalDebits), { x: 390, y: y - 38, size: 11, font: fontBold, color: SLATE_900 });

  y -= 76;

  if (data.freeAccessUntil && data.freeAccessUntil > Date.now()) {
    page.drawRectangle({
      x: 40,
      y: y - 28,
      width: width - 80,
      height: 28,
      color: EMERALD_50,
      borderColor: EMERALD_200,
      borderWidth: 1,
    });
    page.drawText(
      `Complimentary Full-Platform Free Access Active Until ${pdfDate(data.freeAccessUntil)} (All 15 Tools Unlocked)`,
      { x: 52, y: y - 18, size: 8.5, font: fontBold, color: EMERALD_700 }
    );
    y -= 42;
  }

  // Recent GST Invoices section
  page.drawText(`GST TAX INVOICES (${data.invoices.length})`, {
    x: 40,
    y: y - 10,
    size: 9.5,
    font: fontBold,
    color: SLATE_900,
  });
  y -= 20;

  page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: SLATE_900 });
  page.drawText("INVOICE #", { x: 50, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("DATE", { x: 150, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("DESCRIPTION", { x: 225, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("STATUS", { x: 420, y: y - 13, size: 8, font: fontBold, color: WHITE });
  drawRightText(page, "TOTAL", width - 50, y - 13, 8, fontBold, WHITE);
  y -= 20;

  if (data.invoices.length === 0) {
    page.drawText("No GST tax invoices issued yet.", {
      x: 50,
      y: y - 16,
      size: 8.5,
      font: fontRegular,
      color: SLATE_600,
    });
    y -= 28;
  } else {
    const slicedInvoices = data.invoices.slice(0, 14);
    for (let i = 0; i < slicedInvoices.length; i++) {
      const inv = slicedInvoices[i]!;
      if (y < 82) {
        const next = addContinuationPage(doc, ctx, "WALLET & BILLING STATEMENT", refMeta);
        page = next.page;
        y = next.y;
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: ZINC_50 });
      }
      page.drawLine({
        start: { x: 40, y: y - 20 },
        end: { x: width - 40, y: y - 20 },
        thickness: 0.5,
        color: ZINC_200,
      });
      page.drawText(fitPdfTextToWidth(inv.invoiceNumber, fontBold, 8.5, 92), { x: 50, y: y - 14, size: 8.5, font: fontBold, color: SLATE_900 });
      page.drawText(pdfDate(inv.issuedAt), { x: 150, y: y - 14, size: 8.5, font: fontRegular, color: SLATE_600 });
      page.drawText(fitPdfTextToWidth(inv.description, fontRegular, 8.5, 184), { x: 225, y: y - 14, size: 8.5, font: fontRegular, color: SLATE_900 });
      page.drawText(safePdfText(inv.status.toUpperCase(), 10), {
        x: 420,
        y: y - 14,
        size: 8,
        font: fontBold,
        color: inv.status === "paid" ? EMERALD_700 : AMBER_700,
      });
      drawRightText(page, pdfInr(inv.totalPaise), width - 50, y - 14, 8.5, fontBold, SLATE_900);
      y -= 20;
    }
    y -= 16;
  }

  // Wallet Passbook section
  if (y < 130) {
    const next = addContinuationPage(doc, ctx, "WALLET & BILLING STATEMENT", refMeta);
    page = next.page;
    y = next.y;
  }

  page.drawText(`WALLET PASSBOOK TRANSACTIONS (${data.entries.length})`, {
    x: 40,
    y: y - 10,
    size: 9.5,
    font: fontBold,
    color: SLATE_900,
  });
  y -= 20;

  page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: SLATE_900 });
  page.drawText("DATE", { x: 50, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("TYPE", { x: 140, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("PARTICULARS", { x: 225, y: y - 13, size: 8, font: fontBold, color: WHITE });
  drawRightText(page, "AMOUNT", width - 50, y - 13, 8, fontBold, WHITE);
  y -= 20;

  if (data.entries.length === 0) {
    page.drawText("No wallet passbook transactions recorded yet.", {
      x: 50,
      y: y - 16,
      size: 8.5,
      font: fontRegular,
      color: SLATE_600,
    });
  } else {
    const slicedEntries = data.entries.slice(0, 50);
    for (let i = 0; i < slicedEntries.length; i++) {
      const entry = slicedEntries[i]!;
      if (y < 76) {
        const next = addContinuationPage(doc, ctx, "WALLET & BILLING STATEMENT", refMeta);
        page = next.page;
        y = next.y;
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: ZINC_50 });
      }
      page.drawLine({
        start: { x: 40, y: y - 20 },
        end: { x: width - 40, y: y - 20 },
        thickness: 0.5,
        color: ZINC_200,
      });
      page.drawText(pdfDate(entry.createdAt), { x: 50, y: y - 14, size: 8, font: fontRegular, color: SLATE_600 });
      page.drawText(safePdfText(entry.entryType.replace(/_/g, " ").toUpperCase(), 16), {
        x: 140,
        y: y - 14,
        size: 7.5,
        font: fontBold,
        color: SLATE_600,
      });
      page.drawText(fitPdfTextToWidth(entry.description, fontRegular, 8.5, 236), {
        x: 225,
        y: y - 14,
        size: 8.5,
        font: fontRegular,
        color: SLATE_900,
      });
      const prefix = entry.amountPaise >= 0 ? "+" : "";
      drawRightText(
        page,
        `${prefix}${pdfInr(entry.amountPaise)}`,
        width - 50,
        y - 14,
        8.5,
        fontBold,
        entry.amountPaise >= 0 ? EMERALD_700 : SLATE_900
      );
      y -= 20;
    }
  }

  stampStationeryFooters(
    doc,
    ctx,
    `Official Prepaid Wallet & GST Billing Ledger Statement for ${data.workspaceName}.`
  );

  return doc.save();
}

/**
 * 3. Tally Prime Bills & Overdue Receivables Aging PDF Generator
 */
export async function generateTallyReceivablesPdfBytes(
  data: TallyReceivablesPdfInput
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Tally Prime Receivables Report - ${safePdfText(data.workspaceName)}`);
  doc.setCreator("RapidShift Labs — RSL Marketing & Tally Suite");

  const ctx = await createStationeryContext(doc);
  const { fontRegular, fontBold } = ctx;

  let page = doc.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  const refMeta = `${data.workspaceName}${data.companyName ? `  |  Tally Co: ${data.companyName}` : ""}`;

  let y = drawStationeryHeader(page, ctx, {
    docTitle: "TALLY RECEIVABLES REPORT",
    primaryMeta: refMeta,
    secondaryMeta: `Aging Snapshot as of ${pdfDate(Date.now())}  |  Synced Sales Vouchers`,
    badgeLabel: `${data.vouchers.length} BILLS`,
    badgeTone: data.totalPendingPaise > 0 ? "amber" : "emerald",
  });

  page.drawRectangle({
    x: 40,
    y: y - 58,
    width: width - 80,
    height: 58,
    color: ZINC_50,
    borderColor: ZINC_200,
    borderWidth: 1,
  });

  page.drawText("TOTAL SALES BILLED", { x: 54, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(data.totalBilledPaise, false), { x: 54, y: y - 38, size: 11.5, font: fontBold, color: SLATE_900 });

  page.drawText("TOTAL COLLECTED", { x: 225, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(data.totalCollectedPaise, false), { x: 225, y: y - 38, size: 11.5, font: fontBold, color: EMERALD_700 });

  page.drawText("PENDING CUSTOMER BALANCE", { x: 385, y: y - 18, size: 7.5, font: fontBold, color: SLATE_600 });
  page.drawText(pdfInr(data.totalPendingPaise, false), {
    x: 385,
    y: y - 38,
    size: 11.5,
    font: fontBold,
    color: data.totalPendingPaise > 0 ? RUBY_700 : EMERALD_700,
  });

  y -= 76;

  page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: SLATE_900 });
  page.drawText("BILL NO", { x: 48, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("PARTY NAME", { x: 132, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("DUE DATE", { x: 300, y: y - 13, size: 8, font: fontBold, color: WHITE });
  drawRightText(page, "BILLED", 448, y - 13, 8, fontBold, WHITE);
  drawRightText(page, "BALANCE DUE", width - 48, y - 13, 8, fontBold, WHITE);
  y -= 20;

  const nowMs = Date.now();
  if (data.vouchers.length === 0) {
    page.drawText("No Tally Prime vouchers synced yet.", {
      x: 50,
      y: y - 18,
      size: 9,
      font: fontRegular,
      color: SLATE_600,
    });
  } else {
    const slicedVouchers = data.vouchers.slice(0, 80);
    for (let i = 0; i < slicedVouchers.length; i++) {
      const v = slicedVouchers[i]!;
      if (y < 76) {
        const next = addContinuationPage(doc, ctx, "TALLY RECEIVABLES REPORT", refMeta);
        page = next.page;
        y = next.y;
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: ZINC_50 });
      }
      const balance = Math.max(0, v.amountPaise - v.paidAmountPaise);
      const isOverdue = balance > 0 && v.dueDate !== null && v.dueDate < nowMs;
      page.drawLine({
        start: { x: 40, y: y - 20 },
        end: { x: width - 40, y: y - 20 },
        thickness: 0.5,
        color: ZINC_200,
      });
      page.drawText(fitPdfTextToWidth(v.voucherNumber, fontBold, 8, 76), { x: 48, y: y - 14, size: 8, font: fontBold, color: SLATE_900 });
      page.drawText(fitPdfTextToWidth(v.partyName, fontRegular, 8.5, 158), { x: 132, y: y - 14, size: 8.5, font: fontRegular, color: SLATE_900 });
      page.drawText(
        v.dueDate ? `${pdfDate(v.dueDate)}${isOverdue ? " (OD)" : ""}` : pdfDate(v.voucherDate),
        {
          x: 300,
          y: y - 14,
          size: 8,
          font: isOverdue ? fontBold : fontRegular,
          color: isOverdue ? RUBY_700 : SLATE_600,
        }
      );
      drawRightText(page, pdfInr(v.amountPaise, false), 448, y - 14, 8.5, fontRegular, SLATE_900);
      drawRightText(
        page,
        balance > 0 ? pdfInr(balance, false) : "PAID",
        width - 48,
        y - 14,
        8.5,
        fontBold,
        balance > 0 ? (isOverdue ? RUBY_700 : AMBER_700) : EMERALD_700
      );
      y -= 20;
    }
  }

  stampStationeryFooters(
    doc,
    ctx,
    `Tally Prime Party Receivables & Overdue Aging Report for ${data.workspaceName}.`
  );

  return doc.save();
}

/**
 * 4. Business Performance & Marketing Executive Summary PDF Generator
 */
export async function generateAnalyticsReportPdfBytes(
  data: AnalyticsReportPdfInput
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Business Performance Report - ${safePdfText(data.workspaceName)}`);
  doc.setCreator("RapidShift Labs — RSL Marketing & Tally Suite");

  const ctx = await createStationeryContext(doc);
  const { fontRegular, fontBold } = ctx;

  let page = doc.addPage([595.28, 841.89]);
  const { width } = page.getSize();
  const refMeta = `${data.workspaceName}  |  Window: ${data.rangeLabel}`;

  let y = drawStationeryHeader(page, ctx, {
    docTitle: "PERFORMANCE REPORT",
    primaryMeta: refMeta,
    secondaryMeta: `Collections, Campaign ROI & Team Inbox SLA  |  ${pdfDate(Date.now())}`,
    badgeLabel: `ROI: Rs. ${data.returnPerRupeeSpent.toFixed(2)}/Re 1`,
    badgeTone: "emerald",
  });

  // 2x4 Executive KPI Grid
  const kpis = [
    { label: "MONEY COLLECTED", value: pdfInr(data.moneyCollectedPaise, false), color: EMERALD_700 },
    { label: "OVERDUE RECEIVABLES", value: pdfInr(data.overdueReceivablesPaise, false), color: data.overdueReceivablesPaise > 0 ? RUBY_700 : SLATE_900 },
    { label: "MARKETING SPEND", value: pdfInr(data.marketingSpendPaise, true), color: SLATE_900 },
    { label: "LINKED CAMPAIGN SALES", value: pdfInr(data.salesLinkedPaise, false), color: EMERALD_700 },
    { label: "TEAM REPLY RATE", value: `${data.replyRatePct}%`, color: SLATE_900 },
    { label: "AVERAGE REPLY TIME", value: `${data.avgReplyMinutes} min`, color: SLATE_900 },
    { label: "WALLET BALANCE", value: pdfInr(data.walletBalancePaise, true), color: SLATE_900 },
    { label: "CUSTOMER CONTACTS", value: `${data.contactsTotalCount} (${data.optedInCount} opted-in)`, color: SLATE_900 },
  ];

  const cardW = (width - 80 - 12) / 2;
  for (let i = 0; i < kpis.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = 40 + col * (cardW + 12);
    const cy = y - (row + 1) * 48 - row * 8;
    const kpi = kpis[i]!;
    page.drawRectangle({
      x: cx,
      y: cy,
      width: cardW,
      height: 48,
      color: ZINC_50,
      borderColor: ZINC_200,
      borderWidth: 1,
    });
    page.drawText(kpi.label, { x: cx + 12, y: cy + 31, size: 7.5, font: fontBold, color: SLATE_600 });
    page.drawText(safePdfText(kpi.value, 34), {
      x: cx + 12,
      y: cy + 12,
      size: 11,
      font: fontBold,
      color: kpi.color,
    });
  }

  y -= 4 * 56 + 22;

  page.drawText(`CAMPAIGN PERFORMANCE BREAKDOWN (${data.campaigns.length})`, {
    x: 40,
    y: y - 10,
    size: 9.5,
    font: fontBold,
    color: SLATE_900,
  });
  y -= 20;

  page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: SLATE_900 });
  page.drawText("CAMPAIGN NAME", { x: 48, y: y - 13, size: 8, font: fontBold, color: WHITE });
  page.drawText("CHANNEL", { x: 245, y: y - 13, size: 8, font: fontBold, color: WHITE });
  drawRightText(page, "SPEND", 405, y - 13, 8, fontBold, WHITE);
  drawRightText(page, "LINKED SALES", 500, y - 13, 8, fontBold, WHITE);
  drawRightText(page, "CONV", width - 48, y - 13, 8, fontBold, WHITE);
  y -= 20;

  if (data.campaigns.length === 0) {
    page.drawText("No campaigns recorded in this reporting window.", {
      x: 50,
      y: y - 16,
      size: 8.5,
      font: fontRegular,
      color: SLATE_600,
    });
  } else {
    const slicedCampaigns = data.campaigns.slice(0, 30);
    for (let i = 0; i < slicedCampaigns.length; i++) {
      const c = slicedCampaigns[i]!;
      if (y < 76) {
        const next = addContinuationPage(doc, ctx, "PERFORMANCE REPORT", refMeta);
        page = next.page;
        y = next.y;
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 20, color: ZINC_50 });
      }
      page.drawLine({
        start: { x: 40, y: y - 20 },
        end: { x: width - 40, y: y - 20 },
        thickness: 0.5,
        color: ZINC_200,
      });
      page.drawText(fitPdfTextToWidth(c.name, fontBold, 8.5, 186), { x: 48, y: y - 14, size: 8.5, font: fontBold, color: SLATE_900 });
      page.drawText(safePdfText(c.channel.replace(/_/g, " ").toUpperCase(), 16), {
        x: 245,
        y: y - 14,
        size: 8,
        font: fontRegular,
        color: SLATE_600,
      });
      drawRightText(page, pdfInr(c.spendPaise, false), 405, y - 14, 8.5, fontRegular, SLATE_900);
      drawRightText(page, pdfInr(c.revenuePaise, false), 500, y - 14, 8.5, fontBold, EMERALD_700);
      drawRightText(page, String(c.conversions), width - 48, y - 14, 8.5, fontRegular, SLATE_900);
      y -= 20;
    }
  }

  stampStationeryFooters(
    doc,
    ctx,
    `Executive Business & Marketing Performance Summary for ${data.workspaceName} (${data.rangeLabel}).`
  );

  return doc.save();
}

export async function getPdfPageCount(bytes: Uint8Array): Promise<number> {
  const loaded = await PDFDocument.load(bytes);
  return loaded.getPageCount();
}
