import { NextResponse } from "next/server";
import { canStaffPerform } from "@rsl/auth";
import { listAllPlatformInvoices } from "@rsl/billing";
import { getOptionalStaffSession } from "@/lib/session";

function csvCell(val: string | number | null | undefined): string {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const session = await getOptionalStaffSession();
  if (!session) {
    return NextResponse.json({ error: "Staff sign-in required" }, { status: 401 });
  }
  if (!canStaffPerform(session.staff.staffRole, "staff:billing.view")) {
    return NextResponse.json(
      { error: "Finance or Super Admin permission required to export GST invoices" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const q = url.searchParams.get("q") || "";

  const rows = listAllPlatformInvoices({
    status,
    q,
    limit: 2000,
  });

  const headers = [
    "Invoice Number",
    "Financial Year",
    "Issued Date",
    "Client Name",
    "Client GSTIN",
    "State Code",
    "HSN/SAC",
    "Description",
    "Subtotal INR",
    "CGST INR",
    "SGST INR",
    "IGST INR",
    "Total INR",
    "Status",
    "Payment Method",
    "UTR / Payment Reference",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.invoiceNumber,
        r.financialYear,
        new Date(r.issuedAt).toISOString().slice(0, 10),
        r.workspaceName,
        r.workspaceGstin || "",
        r.workspaceStateCode,
        r.hsnSac,
        r.description,
        (r.subtotalPaise / 100).toFixed(2),
        (r.cgstPaise / 100).toFixed(2),
        (r.sgstPaise / 100).toFixed(2),
        (r.igstPaise / 100).toFixed(2),
        (r.totalPaise / 100).toFixed(2),
        r.status.toUpperCase(),
        r.paymentMethod ? r.paymentMethod.toUpperCase() : "",
        r.paymentReference || "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const filename = `rsl-gst-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
