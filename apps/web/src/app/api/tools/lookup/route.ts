import { NextRequest, NextResponse } from "next/server";
import {
  lookupIndianIfsc,
  lookupIndianPincode,
  lookupLiveForexRate,
  searchHsnSacCatalog,
  validateIndianGstin,
} from "@rsl/core";
import { getOptionalWebSession } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  const session = await getOptionalWebSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const kind = (sp.get("kind") || "").trim().toLowerCase();
  const q = (sp.get("q") || "").trim();

  switch (kind) {
    case "gstin": {
      const result = validateIndianGstin(q, { strictChecksum: true });
      return NextResponse.json({ ok: true, result });
    }
    case "pincode": {
      const result = await lookupIndianPincode(q);
      return NextResponse.json({ ok: result.ok, result });
    }
    case "ifsc": {
      const result = await lookupIndianIfsc(q);
      return NextResponse.json({ ok: result.ok, result });
    }
    case "hsn": {
      const limit = Math.min(30, Math.max(1, Number(sp.get("limit") || "12")));
      const items = searchHsnSacCatalog(q, limit);
      return NextResponse.json({ ok: true, items });
    }
    case "forex": {
      const from = sp.get("from") || q || "USD";
      const to = sp.get("to") || "INR";
      const result = await lookupLiveForexRate(from, to);
      return NextResponse.json({ ok: true, result });
    }
    default:
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported lookup kind. Expected gstin, pincode, ifsc, hsn, or forex.",
        },
        { status: 400 }
      );
  }
}
