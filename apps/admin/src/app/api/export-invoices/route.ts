import { NextResponse } from "next/server";
import { canStaffPerform } from "@rsl/auth";
import { exportPlatformGstr1Csv } from "@rsl/billing";
import { formatIstDateIso } from "@rsl/core";
import { getOptionalStaffSession } from "@/lib/session";

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
  const fy = url.searchParams.get("fy") || undefined;

  const csv = exportPlatformGstr1Csv({
    financialYear: fy,
    status,
    q,
  });

  const filename = `rsl-gstr1-invoices-${formatIstDateIso(Date.now())}.csv`;
  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
