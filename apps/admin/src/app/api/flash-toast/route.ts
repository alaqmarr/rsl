import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { verifySignedFlashToast } from "@rsl/core";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { cookieName?: string };
  const cookieName =
    body.cookieName === "rsl_admin_toast" ? "rsl_admin_toast" : "rsl_admin_toast";
  const jar = await cookies();
  const raw = jar.get(cookieName)?.value;
  jar.delete(cookieName);
  const verified = verifySignedFlashToast(raw);
  return NextResponse.json(
    {
      ok: true,
      toast: verified
        ? { id: verified.id, type: verified.type, message: verified.message }
        : null,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
