import { NextResponse } from "next/server";
import { canStaffPerform } from "@rsl/auth";
import { RslError } from "@rsl/core";
import { generateRedactedSupportBundle } from "@rsl/logging";
import { getOptionalStaffSession } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getOptionalStaffSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Staff sign-in required" }, { status: 401 });
  }
  if (!canStaffPerform(session.staff.staffRole, "staff:ops.view")) {
    return NextResponse.json(
      { ok: false, error: "Support or Super Admin permission required to export support bundles" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const workspaceId = (url.searchParams.get("tenantId") || "").trim();
  const ticketReference = (url.searchParams.get("ticket") || "").trim();

  if (!workspaceId || !ticketReference) {
    return NextResponse.json(
      { ok: false, error: "Select a client account and enter a support ticket or call note." },
      { status: 400 }
    );
  }

  try {
    const bundle = generateRedactedSupportBundle({
      workspaceId,
      staffId: session.staff.id,
      ticketReference,
    });
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `${bundle.workspace.slug}-support-bundle-${dateStamp}.json`;

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof RslError ? err.message : "Failed to generate support bundle";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
