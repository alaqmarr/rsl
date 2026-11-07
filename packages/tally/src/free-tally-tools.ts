import QRCode from "qrcode";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  formatInr,
  getEnv,
  newEntityId,
  paiseToRupees,
  resolvePublicEndpoints,
  RslError,
  rupeesToPaise,
  signHmac,
  validateIndianGstin,
  verifyHmac,
} from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { defineAction } from "@rsl/logging";
import { sendWorkspaceWebPushNotification } from "@rsl/notifications";
import {
  controlDb,
  getPlatformCloudflareEmailConfig,
  runCloudflareWorkersAiText,
  tenantDataDb,
} from "@rsl/tenancy";
import {
  buildSignedTallyVoucherPdfUrl,
  getNativeTallyVoucherPdf,
  recordTallyVoucher,
} from "./index";

export function buildSignedPublicTallyBillPayUrl(params: {
  workspaceId: string;
  voucherId: string;
  baseUrl?: string;
  ttlMs?: number;
}): string {
  const expiresAt = Date.now() + (params.ttlMs ?? 30 * 24 * 3600_000);
  const canonical = `pay.${params.workspaceId}.${params.voucherId}.${expiresAt}`;
  const sig = signHmac(canonical, getEnv().KMS_MASTER_KEY);

  let resolvedBase = params.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  if (!resolvedBase) {
    const ws = controlDb()
      .select({ slug: controlSchema.workspaces.slug })
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();
    const endpoints = resolvePublicEndpoints({ workspaceSlug: ws?.slug ?? null });
    resolvedBase = endpoints.effectiveAppBaseUrl || endpoints.cloudBaseUrl;
  }

  return `${resolvedBase}/pay/bill/${encodeURIComponent(params.workspaceId)}/${encodeURIComponent(params.voucherId)}?exp=${expiresAt}&sig=${sig}`;
}

export function verifySignedPublicTallyBillPayToken(params: {
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
  const canonical = `pay.${params.workspaceId}.${params.voucherId}.${Math.trunc(params.expiresAt)}`;
  return verifyHmac(canonical, params.sig, getEnv().KMS_MASTER_KEY);
}

/**
 * Generates an official NPCI-compliant `upi://pay` deep link (`0%` MDR fee).
 */
export function buildNpciUpiPayUri(params: {
  upiVpa: string;
  payeeName: string;
  amountPaise: number;
  voucherNumber: string;
  transactionRef?: string;
}): string {
  const vpa = params.upiVpa.trim();
  const payee = (params.payeeName || "Merchant").trim().slice(0, 60);
  const amountRupees = Math.max(0, paiseToRupees(params.amountPaise)).toFixed(2);
  const note = `Bill ${params.voucherNumber}`.slice(0, 50);
  const tr = (params.transactionRef || params.voucherNumber)
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 35);

  const search = new URLSearchParams({
    pa: vpa,
    pn: payee,
    am: amountRupees,
    cu: "INR",
    tn: note,
  });
  if (tr) {
    search.set("tr", tr);
  }
  return `upi://pay?${search.toString()}`;
}

export interface PublicTallyBillPaymentView {
  workspace: {
    id: string;
    name: string;
    legalName: string;
    gstin: string | null;
    addressLine: string | null;
    cityStatePin: string | null;
    phone: string | null;
    upiVpa: string | null;
    upiPayeeName: string;
    bankName: string | null;
    bankBranch: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
  };
  voucher: {
    id: string;
    voucherNumber: string;
    voucherType: string;
    companyName: string;
    partyName: string;
    voucherDate: number;
    dueDate: number | null;
    amountPaise: number;
    paidAmountPaise: number;
    balancePaise: number;
    paymentStatus: string;
    narration: string | null;
    lineItems: Array<{
      id: string;
      itemName: string;
      hsnCode: string | null;
      uom: string;
      billedQty: number;
      ratePaise: number;
      gstRateBps: number;
      amountPaise: number;
    }>;
  };
  upiUri: string | null;
  upiQrDataUrl: string | null;
  signedPdfUrl: string | null;
  nativePdfFilename: string | null;
}

export async function getPublicTallyBillPaymentView(params: {
  workspaceId: string;
  voucherId: string;
  expiresAt?: number;
  sig?: string;
  skipSignatureCheck?: boolean;
}): Promise<PublicTallyBillPaymentView | null> {
  if (!params.skipSignatureCheck) {
    const valid = verifySignedPublicTallyBillPayToken({
      workspaceId: params.workspaceId,
      voucherId: params.voucherId,
      expiresAt: Number(params.expiresAt || 0),
      sig: params.sig || "",
    });
    if (!valid) {
      return null;
    }
  }

  const ws = controlDb()
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) return null;

  const dataDb = tenantDataDb({ workspaceId: params.workspaceId });
  const voucher = dataDb
    .select()
    .from(tenantDataSchema.tallyVouchers)
    .where(eq(tenantDataSchema.tallyVouchers.id, params.voucherId))
    .get();
  if (!voucher) return null;

  const company = dataDb
    .select()
    .from(tenantDataSchema.tallyCompanies)
    .where(eq(tenantDataSchema.tallyCompanies.id, voucher.companyId))
    .get();

  const lineItems = dataDb
    .select()
    .from(tenantDataSchema.tallyVoucherItems)
    .where(eq(tenantDataSchema.tallyVoucherItems.voucherId, voucher.id))
    .all();

  const balancePaise =
    voucher.paymentStatus === "cancelled"
      ? 0
      : Math.max(0, voucher.amountPaise - voucher.paidAmountPaise);

  const upiPayeeName = (ws.upiPayeeName || ws.name).trim();
  const upiVpa = ws.upiVpa?.trim() || null;

  let upiUri: string | null = null;
  let upiQrDataUrl: string | null = null;
  if (upiVpa && balancePaise > 0) {
    upiUri = buildNpciUpiPayUri({
      upiVpa,
      payeeName: upiPayeeName,
      amountPaise: balancePaise,
      voucherNumber: voucher.voucherNumber,
      transactionRef: voucher.id,
    });
    upiQrDataUrl = await QRCode.toDataURL(upiUri, {
      margin: 1,
      width: 280,
      errorCorrectionLevel: "M",
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    });
  }

  const nativePdf = getNativeTallyVoucherPdf(params.workspaceId, voucher.id);
  const signedPdfUrl = nativePdf
    ? buildSignedTallyVoucherPdfUrl({
        workspaceId: params.workspaceId,
        voucherId: voucher.id,
        filename: nativePdf.filename,
      })
    : null;

  const cityStateParts = [ws.city, ws.stateCode ? `State ${ws.stateCode}` : null, ws.pincode]
    .filter(Boolean)
    .join(", ");

  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      legalName: ws.name,
      gstin: ws.gstin ?? null,
      addressLine: ws.addressLine ?? null,
      cityStatePin: cityStateParts || null,
      phone: ws.businessPhone ?? null,
      upiVpa,
      upiPayeeName,
      bankName: ws.bankName ?? null,
      bankBranch: ws.bankBranch ?? null,
      bankAccountNumber: ws.bankAccountNumber ?? null,
      bankIfsc: ws.bankIfsc ?? null,
    },
    voucher: {
      id: voucher.id,
      voucherNumber: voucher.voucherNumber,
      voucherType: voucher.voucherType,
      companyName: company?.name ?? ws.name,
      partyName: voucher.partyName,
      voucherDate: voucher.voucherDate,
      dueDate: voucher.dueDate,
      amountPaise: voucher.amountPaise,
      paidAmountPaise: voucher.paidAmountPaise,
      balancePaise,
      paymentStatus: voucher.paymentStatus,
      narration: voucher.narration,
      lineItems: lineItems.map((li) => ({
        id: li.id,
        itemName: li.itemName,
        hsnCode: li.hsnCode,
        uom: li.uom,
        billedQty: li.billedQty,
        ratePaise: li.ratePaise,
        gstRateBps: li.gstRateBps,
        amountPaise: li.amountPaise,
      })),
    },
    upiUri,
    upiQrDataUrl,
    signedPdfUrl,
    nativePdfFilename: nativePdf?.filename ?? null,
  };
}

export function buildWorkspaceSupplierBillInboxAddress(workspaceId: string): {
  emailAddress: string;
  configured: boolean;
  inboundDomain: string;
} {
  const ws = controlDb()
    .select({ slug: controlSchema.workspaces.slug })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  const cfEmail = getPlatformCloudflareEmailConfig();
  const inboundDomain = cfEmail.inboundDomain || "bills.rapidshiftlabs.in";
  const slug = ws?.slug || workspaceId.toLowerCase();
  return {
    emailAddress: `bills+${slug}@${inboundDomain}`,
    configured: cfEmail.isReady,
    inboundDomain,
  };
}

function parseInboundSupplierInvoiceHeuristics(params: {
  senderEmail: string;
  senderName?: string | null;
  subject: string;
  bodyText: string;
}) {
  const combined = `${params.subject}\n${params.bodyText}`;

  const gstinMatches = combined.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi) ?? [];
  let supplierGstin: string | null = null;
  for (const candidate of gstinMatches) {
    const check = validateIndianGstin(candidate);
    if (check.formatValid) {
      supplierGstin = check.normalized;
      break;
    }
  }

  const billMatch =
    combined.match(
      /(?:invoice|inv|bill|voucher)\s*(?:no\.?|number|#|:|-)\s*([A-Z0-9][A-Z0-9\/_-]{1,28})/i
    ) ?? combined.match(/#([A-Z]{2,6}-\d{2,10})/i);
  const billNumber = billMatch?.[1]?.trim() || `PUR-${Date.now().toString().slice(-6)}`;

  let billDateIso = new Date().toISOString().slice(0, 10);
  const isoDateMatch = combined.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const dmyMatch = combined.match(/\b(\d{2})[\/-](\d{2})[\/-](20\d{2})\b/);
  if (isoDateMatch?.[1]) {
    billDateIso = isoDateMatch[1];
  } else if (dmyMatch?.[1] && dmyMatch[2] && dmyMatch[3]) {
    billDateIso = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  let totalRupees = 0;
  const amountRegex =
    /(?:grand\s*total|net\s*payable|total\s*amount|invoice\s*total|bill\s*amount|amount\s*payable|total)\s*[:=-]?\s*(?:inr|rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = amountRegex.exec(combined)) !== null) {
    const val = Number((m[1] || "").replace(/,/g, ""));
    if (Number.isFinite(val) && val > totalRupees) {
      totalRupees = val;
    }
  }
  if (totalRupees <= 0) {
    const fallbackRupee = combined.match(/(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (fallbackRupee?.[1]) {
      const parsed = Number(fallbackRupee[1].replace(/,/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        totalRupees = parsed;
      }
    }
  }

  let supplierName = (params.senderName || "").replace(/["<>]/g, "").trim();
  const fromVendorMatch = combined.match(/(?:supplier|vendor|seller|from)\s*:\s*([^\r\n]{3,60})/i);
  if (!supplierName && fromVendorMatch?.[1]) {
    supplierName = fromVendorMatch[1].trim();
  }
  if (!supplierName) {
    const domainPart = params.senderEmail.split("@")[1]?.split(".")[0] || "Vendor";
    supplierName = domainPart.charAt(0).toUpperCase() + domainPart.slice(1) + " Suppliers";
  }

  const hsnMatch = combined.match(/\b(?:HSN|SAC)\s*[:#-]?\s*(\d{4,8})\b/i);
  const hsnCode = hsnMatch?.[1] ?? undefined;

  return {
    supplierName: supplierName.slice(0, 120),
    supplierGstin,
    billNumber: billNumber.slice(0, 50),
    billDateIso,
    totalRupees: totalRupees > 0 ? totalRupees : 0,
    hsnCode,
  };
}

export async function ingestInboundSupplierEmailBill(params: {
  workspaceId: string;
  senderEmail: string;
  senderName?: string | null;
  recipientEmail?: string | null;
  subject: string;
  bodyText: string;
}): Promise<{
  draftId: string;
  supplierName: string;
  supplierGstin: string | null;
  billNumber: string;
  billDateIso: string;
  totalAmountPaise: number;
}> {
  const heuristic = parseInboundSupplierInvoiceHeuristics({
    senderEmail: params.senderEmail,
    senderName: params.senderName,
    subject: params.subject,
    bodyText: params.bodyText,
  });

  let supplierName = heuristic.supplierName;
  let supplierGstin = heuristic.supplierGstin;
  let billNumber = heuristic.billNumber;
  let billDateIso = heuristic.billDateIso;
  let totalRupees = heuristic.totalRupees;
  let lineItems: Array<{
    itemName: string;
    billedQty: number;
    rateRupees: number;
    hsnCode?: string;
    gstRatePct?: number;
  }> = [];

  // Optional Cloudflare Workers AI refinement when configured (10,000 free Neurons/day)
  const aiRes = await runCloudflareWorkersAiText({
    systemPrompt:
      "Extract Indian GST supplier invoice fields strictly as compact JSON with keys: supplierName, supplierGstin, billNumber, billDateIso (YYYY-MM-DD), totalRupees (number), itemName, qty (number). Return JSON only.",
    userPrompt: `From: ${params.senderName || ""} <${params.senderEmail}>\nSubject: ${params.subject}\n\n${params.bodyText.slice(0, 3000)}`,
    maxTokens: 220,
    temperature: 0.1,
  });

  if (aiRes.ok && aiRes.text) {
    const jsonBlock = aiRes.text.match(/\{[\s\S]*\}/)?.[0];
    if (jsonBlock) {
      try {
        const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;
        if (typeof parsed.supplierName === "string" && parsed.supplierName.trim().length >= 2) {
          supplierName = parsed.supplierName.trim().slice(0, 120);
        }
        if (typeof parsed.supplierGstin === "string") {
          const check = validateIndianGstin(parsed.supplierGstin);
          if (check.formatValid) supplierGstin = check.normalized;
        }
        if (typeof parsed.billNumber === "string" && parsed.billNumber.trim()) {
          billNumber = parsed.billNumber.trim().slice(0, 50);
        }
        if (
          typeof parsed.billDateIso === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(parsed.billDateIso.trim())
        ) {
          billDateIso = parsed.billDateIso.trim();
        }
        const aiTotal = Number(parsed.totalRupees);
        if (Number.isFinite(aiTotal) && aiTotal > 0 && totalRupees <= 0) {
          totalRupees = aiTotal;
        }
        if (typeof parsed.itemName === "string" && parsed.itemName.trim() && totalRupees > 0) {
          const qty = Math.max(1, Number(parsed.qty) || 1);
          lineItems = [
            {
              itemName: parsed.itemName.trim().slice(0, 120),
              billedQty: qty,
              rateRupees: Math.round((totalRupees / qty) * 100) / 100,
              hsnCode: heuristic.hsnCode,
            },
          ];
        }
      } catch {
        // Keep deterministic regex parse
      }
    }
  }

  if (lineItems.length === 0 && totalRupees > 0) {
    lineItems = [
      {
        itemName: params.subject.trim().slice(0, 80) || "Supplier Purchase Item",
        billedQty: 1,
        rateRupees: totalRupees,
        hsnCode: heuristic.hsnCode,
      },
    ];
  }

  const totalAmountPaise = Math.max(0, rupeesToPaise(totalRupees));
  const draftId = newEntityId("sid", params.workspaceId);
  const now = Date.now();

  tenantDataDb({ workspaceId: params.workspaceId })
    .insert(tenantDataSchema.supplierBillDrafts)
    .values({
      id: draftId,
      senderEmail: params.senderEmail.trim().slice(0, 180),
      senderName: params.senderName?.trim().slice(0, 120) ?? null,
      subject: (params.subject || "Supplier Invoice").trim().slice(0, 240),
      supplierName,
      supplierGstin,
      invoiceNumber: billNumber,
      invoiceDateIso: billDateIso,
      amountPaise: totalAmountPaise,
      currency: "INR",
      hsnCode: heuristic.hsnCode ?? null,
      gstRateBps: 1800,
      rawExtractSummary: JSON.stringify({
        lineItems,
        bodySnippet: params.bodyText.slice(0, 1200),
      }),
      status: "pending_review",
      linkedVoucherId: null,
      receivedAt: now,
      importedAt: null,
    })
    .run();

  void sendWorkspaceWebPushNotification({
    workspaceId: params.workspaceId,
    payload: {
      title: `New Vendor Bill #${billNumber}`,
      body: `${supplierName} emailed a bill${totalAmountPaise > 0 ? ` for ${formatInr(totalAmountPaise)}` : ""}. Ready to import into Tally Prime.`,
      url: "/tally",
      tag: `supplier-bill-${draftId}`,
    },
  }).catch(() => undefined);

  return {
    draftId,
    supplierName,
    supplierGstin,
    billNumber,
    billDateIso,
    totalAmountPaise,
  };
}

export function listSupplierBillDrafts(workspaceId: string) {
  const rows = tenantDataDb({ workspaceId })
    .select()
    .from(tenantDataSchema.supplierBillDrafts)
    .orderBy(desc(tenantDataSchema.supplierBillDrafts.receivedAt))
    .limit(25)
    .all();

  return rows.map((r) => ({
    ...r,
    billNumber: r.invoiceNumber,
    billDateIso: r.invoiceDateIso,
    totalAmountPaise: r.amountPaise,
    createdAt: r.receivedAt,
  }));
}

export const importSupplierBillDraftToTally = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    draftId: z.string().min(6),
    companyName: z.string().min(2).max(120).optional(),
    overrideAmountRupees: z.coerce.number().positive().optional(),
  }),
  summarize: (_in, out?: { billNumber: string; supplierName: string }) =>
    `Imported inbound supplier bill #${out?.billNumber ?? ""} from ${out?.supplierName ?? "vendor"} as Tally Purchase voucher`,
  handler: async (ctx, input) => {
    const db = tenantDataDb(ctx);
    const draft = db
      .select()
      .from(tenantDataSchema.supplierBillDrafts)
      .where(eq(tenantDataSchema.supplierBillDrafts.id, input.draftId))
      .get();

    if (!draft) {
      throw new RslError("RSL-VAL-1001", "Supplier email bill draft not found.");
    }
    if (
      (draft.status === "imported" || draft.status === "imported_to_tally") &&
      draft.linkedVoucherId
    ) {
      return {
        alreadyImported: true,
        voucherId: draft.linkedVoucherId,
        billNumber: draft.invoiceNumber || "PUR-1",
        supplierName: draft.supplierName,
      };
    }

    const amountRupees =
      input.overrideAmountRupees && input.overrideAmountRupees > 0
        ? input.overrideAmountRupees
        : paiseToRupees(draft.amountPaise);
    if (amountRupees <= 0) {
      throw new RslError(
        "RSL-VAL-1001",
        "Invoice total could not be auto-detected from email text. Enter the bill amount in rupees before importing."
      );
    }

    const primaryCompany = db
      .select()
      .from(tenantDataSchema.tallyCompanies)
      .limit(1)
      .get();

    let parsedItems: Array<{
      itemName: string;
      billedQty: number;
      rateRupees: number;
      hsnCode?: string;
      gstRatePct?: number;
    }> = [];
    try {
      const parsedSummary = JSON.parse(draft.rawExtractSummary || "{}") as {
        lineItems?: typeof parsedItems;
      };
      if (Array.isArray(parsedSummary.lineItems)) {
        parsedItems = parsedSummary.lineItems;
      }
    } catch {
      parsedItems = [];
    }

    const billNumber = draft.invoiceNumber || `PUR-${Date.now().toString().slice(-5)}`;
    const res = await recordTallyVoucher(ctx, {
      companyName: input.companyName?.trim() || primaryCompany?.name || "Primary Tally Company",
      voucherNumber: billNumber,
      voucherType: "Purchase",
      partyName: draft.supplierName,
      amountRupees,
      paidAmountRupees: 0,
      narration: `Imported from vendor email (${draft.senderEmail})${draft.supplierGstin ? ` | GSTIN: ${draft.supplierGstin}` : ""}`,
      voucherDateIso: draft.invoiceDateIso || new Date().toISOString().slice(0, 10),
      preventOverwrite: false,
      lineItems:
        parsedItems.length > 0
          ? parsedItems.map((it) => ({
              itemName: it.itemName,
              billedQty: Math.max(1, Number(it.billedQty) || 1),
              rateRupees: Math.max(0, Number(it.rateRupees) || amountRupees),
              hsnCode: it.hsnCode,
              gstRatePct: it.gstRatePct,
            }))
          : undefined,
    });
    if (!res.ok) {
      throw res.error;
    }

    db.update(tenantDataSchema.supplierBillDrafts)
      .set({
        status: "imported_to_tally",
        linkedVoucherId: res.data.voucherId,
        amountPaise: rupeesToPaise(amountRupees),
        importedAt: Date.now(),
      })
      .where(eq(tenantDataSchema.supplierBillDrafts.id, draft.id))
      .run();

    return {
      alreadyImported: false,
      voucherId: res.data.voucherId,
      billNumber,
      supplierName: draft.supplierName,
    };
  },
});

export const dismissSupplierBillDraft = defineAction({
  key: "tally.vouchers.synced",
  permission: "tally:sync.manage",
  input: z.object({
    draftId: z.string().min(6),
  }),
  summarize: () => "Dismissed inbound supplier email bill draft",
  handler: (ctx, input) => {
    tenantDataDb(ctx)
      .update(tenantDataSchema.supplierBillDrafts)
      .set({
        status: "dismissed",
      })
      .where(eq(tenantDataSchema.supplierBillDrafts.id, input.draftId))
      .run();
    return { dismissed: true };
  },
});
