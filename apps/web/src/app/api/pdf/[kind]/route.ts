import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getWorkspaceAnalytics, type AnalyticsDateRange } from "@rsl/analytics";
import {
  generateAnalyticsReportPdfBytes,
  generateGstInvoicePdfBytes,
  generatePartyLedgerStatementPdfBytes,
  generateTallyReceivablesPdfBytes,
  generateTallyVoucherDetailPdfBytes,
  generateWalletStatementPdfBytes,
  getInvoiceDetailById,
  getWorkspaceFreeAccessStatus,
  getWalletBalancePaise,
  listLedgerEntries,
} from "@rsl/billing";
import { RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { authorizeAny, type Permission } from "@rsl/rbac";
import {
  getNativeTallyVoucherPdf,
  getTallyWorkspaceSummary,
  getWorkspacePartyLedgerDetail,
  getWorkspaceVoucherDetail,
} from "@rsl/tally";
import { controlDb, tenantDataDb } from "@rsl/tenancy";
import { getOptionalWebSession } from "@/lib/session";

const PDF_PERMISSION_MAP: Record<string, Permission[]> = {
  invoice: ["billing:view", "billing:manage"],
  "wallet-statement": ["billing:view", "billing:manage"],
  "tally-receivables": ["tally:view"],
  "party-ledger": ["tally:view"],
  "tally-voucher": ["tally:view"],
  "tally-voucher-native": ["tally:view"],
  "analytics-report": ["tally:view", "ads:view", "pixel:view", "billing:view"],
};

function pdfResponse(bytes: Uint8Array, filename: string, inline = false): NextResponse {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> }
) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { kind } = await context.params;
  const requiredPerms = PDF_PERMISSION_MAP[kind];
  if (!requiredPerms) {
    return NextResponse.json({ error: "Unsupported PDF report kind" }, { status: 404 });
  }

  try {
    authorizeAny(session.ctx, requiredPerms);
  } catch (err) {
    const msg = err instanceof RslError ? err.message : "Permission denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const url = new URL(request.url);
  const wsId = session.workspace.id;

  // Serve exact untouched native Tally Prime printed invoice PDF (%PDF-1.x)
  if (kind === "tally-voucher-native") {
    const voucherId = url.searchParams.get("voucherId")?.trim() || "";
    const nativePdf = getNativeTallyVoucherPdf(wsId, voucherId);
    if (!nativePdf) {
      return NextResponse.json(
        { error: "Native Tally Prime PDF has not been captured for this voucher yet." },
        { status: 404 }
      );
    }
    const inline = url.searchParams.get("download") !== "1";
    return pdfResponse(nativePdf.pdfBuffer, nativePdf.filename, inline);
  }

  if (kind === "party-ledger") {
    const partyId = url.searchParams.get("partyId")?.trim() || "";
    if (!partyId) {
      return NextResponse.json({ error: "Missing partyId parameter" }, { status: 400 });
    }
    let detail;
    try {
      detail = getWorkspacePartyLedgerDetail(wsId, partyId);
    } catch {
      return NextResponse.json({ error: "Party ledger not found" }, { status: 404 });
    }

    const nowMs = Date.now();
    const pdfBytes = await generatePartyLedgerStatementPdfBytes({
      workspaceName: session.workspace.name,
      companyName: detail.companyName,
      partyName: detail.party.name,
      parentGroup: detail.party.parentGroup,
      gstin: detail.party.gstin,
      pan: detail.party.pan,
      phoneE164: detail.party.phoneE164,
      email: detail.party.email,
      stateName: detail.party.stateName,
      address: detail.party.address,
      creditLimitPaise: detail.party.creditLimitPaise,
      creditDays: detail.party.creditDays,
      openingBalancePaise: detail.party.openingBalancePaise,
      closingBalancePaise: detail.party.closingBalancePaise,
      totalDebitsPaise: detail.totals.totalDebitsPaise,
      totalCreditsPaise: detail.totals.totalCreditsPaise,
      statementEntries: detail.statementRows.map((r) => ({
        voucherNumber: r.voucherNumber,
        voucherType: r.voucherType,
        voucherDate: r.date,
        particulars: r.particulars,
        debitPaise: r.debitPaise,
        creditPaise: r.creditPaise,
        runningBalancePaise: r.runningBalancePaise,
        runningBalanceDrCr: r.runningDrCr,
      })),
      openBills: detail.openBills.map((b) => ({
        voucherNumber: b.voucherNumber,
        voucherType: b.voucherType,
        voucherDate: b.voucherDate,
        dueDate: b.dueDate,
        amountPaise: b.amountPaise,
        paidAmountPaise: b.paidAmountPaise,
        balancePaise: b.pendingPaise,
        daysOverdue:
          b.dueDate !== null && b.dueDate < nowMs
            ? Math.max(1, Math.floor((nowMs - b.dueDate) / 86_400_000))
            : 0,
      })),
    });

    const inline = url.searchParams.get("inline") === "1";
    return pdfResponse(
      pdfBytes,
      `Party-Ledger-${detail.party.name.slice(0, 40)}-${session.workspace.slug}.pdf`,
      inline
    );
  }

  if (kind === "tally-voucher") {
    const voucherId = url.searchParams.get("voucherId")?.trim() || "";
    if (!voucherId) {
      return NextResponse.json({ error: "Missing voucherId parameter" }, { status: 400 });
    }
    const forceGenerated = url.searchParams.get("format") === "generated";
    const inline = url.searchParams.get("download") !== "1";

    if (!forceGenerated) {
      const nativePdf = getNativeTallyVoucherPdf(wsId, voucherId);
      if (nativePdf) {
        return pdfResponse(nativePdf.pdfBuffer, nativePdf.filename, inline);
      }
    }

    let detail;
    try {
      detail = getWorkspaceVoucherDetail(wsId, voucherId);
    } catch {
      return NextResponse.json({ error: "Tally voucher not found" }, { status: 404 });
    }

    const pdfBytes = await generateTallyVoucherDetailPdfBytes({
      workspaceName: session.workspace.name,
      workspaceGstin: session.workspace.gstin,
      companyName: detail.companyName,
      voucherNumber: detail.voucher.voucherNumber,
      voucherType: detail.voucher.voucherType,
      voucherDate: detail.voucher.voucherDate,
      dueDate: detail.voucher.dueDate,
      partyName: detail.voucher.partyName,
      partyGstin: detail.party?.gstin ?? null,
      partyPhone: detail.voucher.partyPhoneE164 ?? detail.party?.phoneE164 ?? null,
      partyState: detail.party?.stateName ?? null,
      partyAddress: detail.party?.address ?? null,
      amountPaise: detail.voucher.amountPaise,
      paidAmountPaise: detail.voucher.paidAmountPaise,
      balancePaise: detail.pendingPaise,
      paymentStatus: detail.voucher.paymentStatus,
      narration: detail.voucher.narration ?? null,
      ledgerAccountName: detail.voucher.ledgerAccountName ?? null,
      lineItems: detail.lineItems.map((li) => ({
        itemName: li.itemName,
        hsnCode: li.hsnCode,
        billedQty: li.billedQty,
        uom: li.uom,
        ratePaise: li.ratePaise,
        discountPct: li.discountBps / 100,
        gstRatePct: li.gstRateBps / 100,
        amountPaise: li.amountPaise,
      })),
      settlements: detail.settlementsAgainstBill.map((s) => ({
        settlementVoucherNumber: s.settlementVoucherNumber || "Direct / Counter",
        settlementVoucherType: s.settlementVoucherType || "Receipt",
        settlementMethod: s.allocationType,
        settledAt: s.settledAt,
        amountPaise: s.amountPaise,
      })),
    });

    return pdfResponse(
      pdfBytes,
      `${detail.voucher.voucherType}-${detail.voucher.voucherNumber.replace(/[^a-zA-Z0-9._-]+/g, "-")}.pdf`,
      inline
    );
  }

  if (kind === "invoice") {
    const invoiceId = url.searchParams.get("id")?.trim() || "";
    const detail = getInvoiceDetailById(invoiceId, { workspaceId: wsId });
    if (!detail) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const rawInv = controlDb()
      .select({ financialYear: controlSchema.invoices.financialYear })
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.id, detail.id))
      .get();

    const pdfBytes = await generateGstInvoicePdfBytes({
      invoiceNumber: detail.invoiceNumber,
      docType: detail.docType,
      linkedInvoiceNumber: detail.linkedInvoiceNumber,
      financialYear: rawInv?.financialYear || "26-27",
      description: detail.description,
      subtotalPaise: detail.subtotalPaise,
      cgstPaise: detail.cgstPaise,
      sgstPaise: detail.sgstPaise,
      igstPaise: detail.igstPaise,
      totalPaise: detail.totalPaise,
      hsnSac: detail.sacCode,
      status: detail.status,
      issuedAt: detail.issuedAt,
      paidAt: detail.paidAt,
      buyerName: detail.buyerName,
      buyerGstin: detail.buyerGstin,
      buyerStateCode: detail.buyerStateCode,
      buyerStateName: detail.buyerStateName,
      paymentMethod: detail.paymentMethod,
      paymentReference: detail.paymentReference,
      seller: {
        payeeName: detail.supplierName,
        gstin: detail.supplierGstin,
        stateCode: detail.supplierStateCode,
        stateName: detail.supplierStateName,
        billingEmail: detail.supplierEmail,
        supportPhone: detail.supplierPhone,
        bankName: detail.bankName,
        accountNumber: detail.accountNumber,
        ifscCode: detail.ifscCode,
        upiId: detail.upiId,
      },
    });

    return pdfResponse(pdfBytes, `GST-Invoice-${detail.invoiceNumber.replace(/\//g, "-")}.pdf`);
  }

  if (kind === "wallet-statement") {
    const balancePaise = getWalletBalancePaise(wsId);
    const freeAccess = getWorkspaceFreeAccessStatus(wsId);
    const entries = listLedgerEntries(wsId, 50);
    const invoices = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.workspaceId, wsId))
      .orderBy(desc(controlSchema.invoices.issuedAt))
      .limit(30)
      .all();

    const pdfBytes = await generateWalletStatementPdfBytes({
      workspaceName: session.workspace.name,
      workspaceGstin: session.workspace.gstin,
      balancePaise,
      freeAccessUntil: freeAccess.isActive ? freeAccess.untilMs : null,
      entries: entries.map((e) => ({
        createdAt: e.createdAt,
        entryType: e.entryType,
        description: e.description,
        amountPaise: e.amountPaise,
      })),
      invoices: invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        issuedAt: inv.issuedAt,
        status: inv.status,
        totalPaise: inv.totalPaise,
        description: inv.description,
      })),
    });

    return pdfResponse(pdfBytes, `Wallet-Statement-${session.workspace.slug}.pdf`);
  }

  if (kind === "tally-receivables") {
    const tally = getTallyWorkspaceSummary(wsId);
    const activeVouchers = tally.vouchers.filter((v) => v.paymentStatus !== "cancelled");
    const totalBilledPaise = activeVouchers.reduce((acc, v) => acc + v.amountPaise, 0);
    const totalCollectedPaise = activeVouchers.reduce((acc, v) => acc + v.paidAmountPaise, 0);
    const totalPendingPaise = activeVouchers.reduce(
      (acc, v) => acc + Math.max(0, v.amountPaise - v.paidAmountPaise),
      0
    );

    const pdfBytes = await generateTallyReceivablesPdfBytes({
      workspaceName: session.workspace.name,
      companyName:
        session.workspace.defaultTallyCompany ||
        tally.companies[0]?.name ||
        session.workspace.name,
      totalBilledPaise,
      totalCollectedPaise,
      totalPendingPaise,
      vouchers: tally.vouchers.map((v) => ({
        voucherNumber: v.voucherNumber,
        voucherType: v.voucherType,
        partyName: v.partyName,
        voucherDate: v.voucherDate,
        dueDate: v.dueDate,
        amountPaise: v.amountPaise,
        paidAmountPaise: v.paidAmountPaise,
        paymentStatus: v.paymentStatus,
      })),
    });

    return pdfResponse(pdfBytes, `Tally-Receivables-${session.workspace.slug}.pdf`);
  }

  if (kind === "analytics-report") {
    const rawRange = url.searchParams.get("range") as AnalyticsDateRange | null;
    const range: AnalyticsDateRange =
      rawRange && ["7d", "30d", "90d", "365d", "all"].includes(rawRange) ? rawRange : "30d";
    const report = getWorkspaceAnalytics(wsId, range);

    const tdb = tenantDataDb({ workspaceId: wsId });
    const campRows = tdb
      .select()
      .from(tenantDataSchema.campaigns)
      .orderBy(desc(tenantDataSchema.campaigns.createdAt))
      .limit(20)
      .all();

    const pdfBytes = await generateAnalyticsReportPdfBytes({
      workspaceName: session.workspace.name,
      rangeLabel: report.range === "all" ? "All Time" : `Last ${report.daysCount} Days`,
      moneyCollectedPaise: report.kpis.moneyCollectedPaise,
      overdueReceivablesPaise: report.kpis.overdueReceivablesPaise,
      marketingSpendPaise: report.kpis.marketingSpendPaise,
      salesLinkedPaise: report.kpis.salesLinkedPaise,
      returnPerRupeeSpent: report.kpis.returnPerRupeeSpent,
      replyRatePct: report.kpis.replyRatePct,
      avgReplyMinutes: report.kpis.avgReplyMinutes,
      walletBalancePaise: report.kpis.walletBalancePaise,
      contactsTotalCount: report.kpis.contactsTotalCount,
      optedInCount: report.kpis.optedInCount,
      campaigns: campRows.map((c) => ({
        name: c.name,
        channel: c.channel,
        status: c.status,
        spendPaise: c.totalSpendPaise,
        revenuePaise: c.attributedRevenuePaise,
        conversions: c.conversions,
      })),
    });

    return pdfResponse(pdfBytes, `Executive-Analytics-${session.workspace.slug}-${range}.pdf`);
  }

  return NextResponse.json({ error: "Unsupported PDF report kind" }, { status: 404 });
}
