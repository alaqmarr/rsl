import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  reconcileRazorpayCapturedPayment,
  verifyRazorpaySignature,
} from "@rsl/billing";
import { newId, RslError } from "@rsl/core";
import { ingressSchema } from "@rsl/database";
import { ingressDb } from "@rsl/tenancy";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";

  const valid = verifyRazorpaySignature(rawBody, sig);
  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid Razorpay signature" }, { status: 401 });
  }

  let parsed: {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          notes?: {
            workspaceId?: string;
            walletCreditPaise?: string;
            purpose?: string;
          };
        };
      };
    };
  };

  try {
    parsed = JSON.parse(rawBody) as typeof parsed;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON payload" }, { status: 400 });
  }

  const providerPaymentId = parsed.payload?.payment?.entity?.id?.trim();
  const eventId =
    req.headers.get("x-razorpay-event-id")?.trim() ||
    (parsed.event && providerPaymentId ? `rzp_${parsed.event}_${providerPaymentId}` : "") ||
    `rzp_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;

  const inboxId = newId();
  const inserted = ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: inboxId,
      provider: "razorpay",
      eventId,
      rawBody: rawBody.slice(0, 65536),
      headersJson: JSON.stringify({ sigPresent: Boolean(sig) }),
      signatureValid: true,
      status: "received",
      receivedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  if (inserted.changes === 0) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  try {
    if (parsed.event === "payment.captured") {
      const entity = parsed.payload?.payment?.entity;
      const paymentId = entity?.id?.trim() || "";
      const capturedAmountPaise = Number(entity?.amount);
      const rawNoteCredit =
        entity?.notes?.walletCreditPaise !== undefined && entity.notes.walletCreditPaise !== ""
          ? Number(entity.notes.walletCreditPaise)
          : null;

      const reconciled = reconcileRazorpayCapturedPayment({
        paymentId,
        orderId: entity?.order_id ?? null,
        capturedAmountPaise,
        notesWorkspaceId: entity?.notes?.workspaceId ?? null,
        notesWalletCreditPaise: rawNoteCredit,
        notesPurpose: entity?.notes?.purpose ?? null,
      });

      ingressDb()
        .update(ingressSchema.webhookInbox)
        .set({
          routedTenantId: reconciled.workspaceId,
          status: "processed",
          processedAt: Date.now(),
        })
        .where(eq(ingressSchema.webhookInbox.id, inboxId))
        .run();

      return NextResponse.json({
        ok: true,
        invoiceNumber: reconciled.invoiceNumber,
        creditedPaise: reconciled.creditedPaise,
      });
    }

    ingressDb()
      .update(ingressSchema.webhookInbox)
      .set({
        status: "processed",
        processedAt: Date.now(),
      })
      .where(eq(ingressSchema.webhookInbox.id, inboxId))
      .run();

    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped =
      err instanceof RslError
        ? err
        : new RslError("RSL-VAL-1001", err instanceof Error ? err.message : "Razorpay webhook processing failed");
    ingressDb()
      .update(ingressSchema.webhookInbox)
      .set({
        status: "failed",
        errorMessage: mapped.message.slice(0, 300),
        processedAt: Date.now(),
      })
      .where(eq(ingressSchema.webhookInbox.id, inboxId))
      .run();
    return NextResponse.json(
      { ok: false, error: mapped.toPublicObject("razorpay_webhook") },
      { status: mapped.httpStatus }
    );
  }
}
