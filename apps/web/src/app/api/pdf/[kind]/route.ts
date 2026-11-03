import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getWorkspaceAnalytics, type AnalyticsDateRange } from "@rsl/analytics";
import {
  generateAnalyticsReportPdfBytes,
  generateGstInvoicePdfBytes,
  generateTallyReceivablesPdfBytes,
  generateWalletStatementPdfBytes,
  getInvoiceDetailById,
  getWorkspaceFreeAccessStatus,
  getWalletBalancePaise,
  listLedgerEntries,
} from "@rsl/billing";
import { RslError } from "@rsl/core";
import { controlSchema, tenantDataSchema } from "@rsl/database";
import { authorizeAny, type Permission } from "@rsl/rbac";
import { getNativeTallyVoucherPdf, getTallyWorkspaceSummary } from "@rsl/tally";
import { controlDb, tenantDataDb } from "@rsl/tenancy";
import { getOptionalWebSession } from "@/lib/session";

const PDF_PERMISSION_MAP: Record<string, Permission[]> = {
  invoice: ["billing:view", "billing:manage"],
  "wallet-statement": ["billing:view", "billing:manage"],
  "tally-receivables": ["tally:view"],
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
