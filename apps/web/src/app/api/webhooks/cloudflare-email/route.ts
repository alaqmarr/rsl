import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { controlSchema } from "@rsl/database";
import { ingestInboundSupplierEmailBill } from "@rsl/tally";
import { controlDb, getPlatformCloudflareEmailConfig } from "@rsl/tenancy";

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractWorkspaceSlugFromAddress(recipient: string): string | null {
  const cleaned = recipient.trim().toLowerCase();
  const plusMatch = cleaned.match(/(?:bills|tally|invoices)\+([a-z0-9_-]+)@/i);
  if (plusMatch?.[1]) {
    return plusMatch[1];
  }
  const localPart = cleaned.split("@")[0]?.replace(/[<>"]/g, "").trim() || "";
  if (localPart && !["bills", "invoices", "tally", "support", "info"].includes(localPart)) {
    return localPart;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const cfEmail = getPlatformCloudflareEmailConfig();
  if (!cfEmail.isReady || !cfEmail.webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "Cloudflare Email Routing webhook is not configured yet." },
      { status: 503 }
    );
  }

  const incomingSecret = (req.headers.get("x-rsl-email-secret") || "").trim();
  if (!timingSafeEqualString(incomingSecret, cfEmail.webhookSecret)) {
    return NextResponse.json({ ok: false, error: "Invalid email webhook secret" }, { status: 401 });
  }

  let body: {
    from?: string;
    senderName?: string;
    to?: string;
    subject?: string;
    rawEmail?: string;
    bodyText?: string;
    workspaceSlug?: string;
    workspaceId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const ctrl = controlDb();
  let workspaceId = body.workspaceId?.trim() || null;

  if (!workspaceId) {
    const slug =
      body.workspaceSlug?.trim().toLowerCase() ||
      extractWorkspaceSlugFromAddress(body.to || "");
    if (slug) {
      const ws = ctrl
        .select({ id: controlSchema.workspaces.id })
        .from(controlSchema.workspaces)
        .where(eq(controlSchema.workspaces.slug, slug))
        .get();
      workspaceId = ws?.id ?? null;
    }
  }

  if (!workspaceId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not resolve target business workspace. Send supplier bills to bills+<workspace-slug>@<domain>.",
      },
      { status: 404 }
    );
  }

  const rawText = (body.bodyText || body.rawEmail || "").trim();
  const subjectHeaderMatch = rawText.match(/^Subject:\s*(.+)$/im);
  const fromHeaderMatch = rawText.match(/^From:\s*(.+)$/im);
  const subject = (body.subject || subjectHeaderMatch?.[1] || "Supplier Invoice").trim();
  const rawFrom = (body.from || fromHeaderMatch?.[1] || "vendor@supplier.in").trim();
  const emailMatch = rawFrom.match(/<([^>]+)>/) ?? [null, rawFrom];
  const senderEmail = (emailMatch[1] || rawFrom).trim();
  const senderName =
    body.senderName?.trim() ||
    (rawFrom.includes("<") ? rawFrom.split("<")[0]?.replace(/"/g, "").trim() : null);

  const created = await ingestInboundSupplierEmailBill({
    workspaceId,
    senderEmail,
    senderName,
    recipientEmail: body.to ?? null,
    subject,
    bodyText: rawText,
  });

  return NextResponse.json({
    ok: true,
    draftId: created.draftId,
    billNumber: created.billNumber,
    supplierName: created.supplierName,
    totalAmountPaise: created.totalAmountPaise,
  });
}
