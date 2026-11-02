import { NextRequest, NextResponse } from "next/server";
import { authenticatePublicApiKey } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { getTallyWorkspaceSummary, recordTallyVoucher } from "@rsl/tally";

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "vouchers:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const summary = getTallyWorkspaceSummary(auth.workspaceId);
    return NextResponse.json({
      ok: true,
      workspaceId: auth.workspaceId,
      totals: summary.totals,
      vouchers: summary.vouchers,
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "vouchers:write",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const body = (await req.json()) as Record<string, unknown>;
    const out = await recordTallyVoucher(auth.ctx, {
      companyName: String(body.companyName || "Primary Tally Company"),
      voucherNumber: String(body.voucherNumber || ""),
      voucherType: (String(body.voucherType || "Sales") as "Sales" | "Receipt" | "CreditNote" | "Purchase"),
      partyName: String(body.partyName || ""),
      partyPhoneE164: body.partyPhoneE164 ? String(body.partyPhoneE164) : undefined,
      amountRupees: Number(body.amountRupees || 0),
      paidAmountRupees: Number(body.paidAmountRupees || 0),
      voucherDateIso: String(body.voucherDateIso || new Date().toISOString().slice(0, 10)),
      dueDateIso: body.dueDateIso ? String(body.dueDateIso) : undefined,
    });
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, voucherId: out.data.voucherId }, { status: 201 });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
