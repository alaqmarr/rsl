import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticatePublicApiKey, withApiIdempotency } from "@rsl/api-keys";
import { RslError } from "@rsl/core";
import { getTallyWorkspaceSummary, recordTallyVoucher } from "@rsl/tally";

const createVoucherSchema = z
  .object({
    companyName: z.string().trim().min(1).max(160).default("Primary Tally Company"),
    voucherNumber: z.string().trim().min(1, "voucherNumber is required").max(80),
    voucherType: z.enum(["Sales", "Receipt", "CreditNote", "Purchase"]).default("Sales"),
    partyName: z.string().trim().min(1, "partyName is required").max(160),
    partyPhoneE164: z.string().trim().max(32).optional(),
    amountPaise: z.number().int().positive().max(10_000_000_000).optional(),
    amountRupees: z
      .number()
      .finite("amountRupees must be a finite number")
      .positive("amountRupees must be greater than 0")
      .max(100_000_000)
      .optional(),
    paidAmountPaise: z.number().int().min(0).max(10_000_000_000).optional(),
    paidAmountRupees: z
      .number()
      .finite("paidAmountRupees must be a finite number")
      .min(0, "paidAmountRupees cannot be negative")
      .max(100_000_000)
      .optional(),
    voucherDateIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "voucherDateIso must be YYYY-MM-DD")
      .optional(),
    dueDateIso: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDateIso must be YYYY-MM-DD")
      .optional(),
  })
  .refine((v) => v.amountPaise !== undefined || v.amountRupees !== undefined, {
    message: "Provide amountPaise (integer) or amountRupees (finite positive number).",
  });

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticatePublicApiKey({
      authorizationHeader: req.headers.get("authorization"),
      requiredScope: "vouchers:read",
      clientIp: req.headers.get("x-forwarded-for"),
    });
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || "50") || 50));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || "0") || 0);
    const summary = getTallyWorkspaceSummary(auth.workspaceId, {
      voucherLimit: limit,
      voucherOffset: offset,
      forPublicApi: true,
    });
    return NextResponse.json(
      {
        ok: true,
        apiVersion: "v1",
        workspaceId: auth.workspaceId,
        totals: summary.totals,
        pagination: {
          limit: summary.voucherLimit,
          offset: summary.voucherOffset,
          totalCount: summary.vouchersTotalCount,
          hasMore: summary.voucherOffset + summary.vouchers.length < summary.vouchersTotalCount,
        },
        vouchers: summary.vouchers,
      },
      { headers: { "X-RateLimit-Remaining": String(auth.rateLimitRemaining) } }
    );
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
    const rawBody = await req.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      throw new RslError("RSL-VAL-1001", "Request body must be valid JSON.");
    }

    const parsed = createVoucherSchema.safeParse(jsonBody);
    if (!parsed.success) {
      throw new RslError(
        "RSL-VAL-1001",
        parsed.error.issues[0]?.message || "Invalid voucher payload."
      );
    }

    const idemResult = await withApiIdempotency<Record<string, unknown>>({
      workspaceId: auth.workspaceId,
      idempotencyKey: req.headers.get("idempotency-key"),
      method: "POST",
      path: "/api/v1/vouchers",
      rawRequestBody: rawBody,
      execute: async () => {
        const d = parsed.data;
        const amountRupees =
          d.amountPaise !== undefined ? d.amountPaise / 100 : (d.amountRupees as number);
        const paidAmountRupees =
          d.paidAmountPaise !== undefined ? d.paidAmountPaise / 100 : (d.paidAmountRupees ?? 0);

        const out = await recordTallyVoucher(auth.ctx, {
          companyName: d.companyName,
          voucherNumber: d.voucherNumber,
          voucherType: d.voucherType,
          partyName: d.partyName,
          partyPhoneE164: d.partyPhoneE164,
          amountRupees,
          paidAmountRupees,
          voucherDateIso: d.voucherDateIso ?? new Date().toISOString().slice(0, 10),
          dueDateIso: d.dueDateIso,
        });
        if (!out.ok) {
          return { statusCode: 400, body: { ok: false, error: out.error } };
        }
        return {
          statusCode: 201,
          body: { ok: true, apiVersion: "v1", voucherId: out.data.voucherId },
        };
      },
    });

    return NextResponse.json(idemResult.body, {
      status: idemResult.statusCode,
      headers: {
        "X-RateLimit-Remaining": String(auth.rateLimitRemaining),
        ...(idemResult.replayed ? { "X-Idempotent-Replayed": "true" } : {}),
      },
    });
  } catch (err) {
    const mapped = err instanceof RslError ? err : new RslError("RSL-SYS-1001");
    return NextResponse.json({ ok: false, error: mapped.toPublicObject("api") }, { status: mapped.httpStatus });
  }
}
