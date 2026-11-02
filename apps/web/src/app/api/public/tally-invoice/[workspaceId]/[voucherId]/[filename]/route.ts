import { NextRequest, NextResponse } from "next/server";
import {
  getNativeTallyVoucherPdf,
  verifySignedTallyVoucherPdfToken,
} from "@rsl/tally";

export async function GET(
  req: NextRequest,
  context: {
    params: Promise<{
      workspaceId: string;
      voucherId: string;
      filename: string;
    }>;
  }
) {
  const { workspaceId, voucherId } = await context.params;
  const exp = Number(req.nextUrl.searchParams.get("exp") ?? "0");
  const sig = (req.nextUrl.searchParams.get("sig") ?? "").trim();

  if (
    !verifySignedTallyVoucherPdfToken({
      workspaceId,
      voucherId,
      expiresAt: exp,
      sig,
    })
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired Tally invoice PDF signature." },
      { status: 403 }
    );
  }

  const doc = getNativeTallyVoucherPdf(workspaceId, voucherId);
  if (!doc) {
    return NextResponse.json(
      { ok: false, error: "Native Tally Prime PDF not found for this voucher." },
      { status: 404 }
    );
  }

  // Serve exact untouched native %PDF-1.x bytes exported from Tally Prime's Voucher print engine
  return new NextResponse(new Uint8Array(doc.pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(doc.byteSize),
      "Content-Disposition": `inline; filename="${doc.filename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-RSL-Tally-PDF-SHA256": doc.sha256,
    },
  });
}
