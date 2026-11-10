import { NextRequest, NextResponse } from "next/server";
import { verifyPurposeHmac } from "@rsl/core";
import { readWorkspaceObjectBytes } from "@rsl/storage";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; objectId: string }> }
) {
  try {
    const { workspaceId, objectId } = await context.params;
    const sig = req.nextUrl.searchParams.get("sig") || "";
    const exp = Number(req.nextUrl.searchParams.get("exp") || 0);
    if (!workspaceId || !objectId || !sig || !Number.isFinite(exp) || exp <= Date.now()) {
      return NextResponse.json({ ok: false, error: "Expired or missing media signature." }, { status: 403 });
    }

    const valid = verifyPurposeHmac(
      "public-media-link:v1",
      `media:${workspaceId}:${objectId}:${Math.trunc(exp)}`,
      sig
    );
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Invalid media signature." }, { status: 403 });
    }

    const { meta, bytes } = await readWorkspaceObjectBytes(workspaceId, objectId);
    if (meta.category !== "media") {
      return NextResponse.json({ ok: false, error: "Asset is not public media." }, { status: 403 });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": meta.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Media file not found." }, { status: 404 });
  }
}
