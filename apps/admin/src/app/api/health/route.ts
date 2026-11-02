import { NextResponse } from "next/server";
import { controlDb } from "@rsl/tenancy";

export async function GET() {
  const row = controlDb().$client.prepare("SELECT 1 AS ok").get() as { ok: number };
  return NextResponse.json({ ok: row?.ok === 1, service: "rsl-admin" });
}
