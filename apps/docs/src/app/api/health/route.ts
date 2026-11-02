import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "rsl-docs",
    ts: new Date().toISOString(),
  });
}
