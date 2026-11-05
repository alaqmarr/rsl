import { NextRequest, NextResponse } from "next/server";
import { getEnv, verifyHmac } from "@rsl/core";
import { readWorkspaceObjectBytes } from "@rsl/storage";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; objectId: string }> }
) {
  try {
    const { workspaceId, objectId } = await context.params;
    const sig = req.nextUrl.searchParams.get("sig") || "";
    if (!workspaceId || !objectId || !sig) {
      return NextResponse.json({ ok: false, error: "Missing signature." }, { status: 403 });
    }

    const valid = verifyHmac(
      `media:${workspaceId}:${objectId}`,
      sig,
      getEnv().KMS_MASTER_KEY
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
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Media file not found." }, { status: 404 });
  }
}
