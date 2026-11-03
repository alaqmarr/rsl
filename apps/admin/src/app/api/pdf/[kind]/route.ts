import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { canStaffPerform } from "@rsl/auth";
import {
  generateGstInvoicePdfBytes,
  generateWalletStatementPdfBytes,
  getInvoiceDetailById,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  listLedgerEntries,
} from "@rsl/billing";
import { controlSchema } from "@rsl/database";
import { controlDb } from "@rsl/tenancy";
import { getOptionalStaffSession } from "@/lib/session";

function pdfResponse(bytes: Uint8Array, filename: string): NextResponse {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> }
) {
  const staffSess = await getOptionalStaffSession();
  if (!staffSess) {
    return NextResponse.json({ error: "Staff authentication required" }, { status: 401 });
  }
  if (!canStaffPerform(staffSess.staff.staffRole, "staff:billing.view")) {
    return NextResponse.json(
      { error: "Finance or Super Admin permission required to download billing PDFs" },
      { status: 403 }
    );
  }

  const { kind } = await context.params;
  const url = new URL(request.url);

  if (kind === "invoice") {
    const invoiceId = url.searchParams.get("id")?.trim() || "";
    const detail = getInvoiceDetailById(invoiceId);
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

  if (kind === "client-statement") {
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || "";
    const ws = controlDb()
      .select()
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, workspaceId))
      .get();
    if (!ws) {
      return NextResponse.json({ error: "Client workspace not found" }, { status: 404 });
    }

    const balancePaise = getWalletBalancePaise(ws.id);
    const freeAccess = getWorkspaceFreeAccessStatus(ws.id);
    const entries = listLedgerEntries(ws.id, 60);
    const invoices = controlDb()
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.workspaceId, ws.id))
      .orderBy(desc(controlSchema.invoices.issuedAt))
      .limit(40)
      .all();

    const pdfBytes = await generateWalletStatementPdfBytes({
      workspaceName: ws.name,
      workspaceGstin: ws.gstin,
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

    return pdfResponse(pdfBytes, `Client-Statement-${ws.slug}.pdf`);
  }

  return NextResponse.json({ error: "Unsupported PDF report kind" }, { status: 404 });
}
