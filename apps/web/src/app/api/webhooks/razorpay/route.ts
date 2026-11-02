import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { createGstInvoice, creditWallet, verifyRazorpaySignature } from "@rsl/billing";
import { newId } from "@rsl/core";
import { controlSchema, ingressSchema } from "@rsl/database";
import { controlDb, ingressDb } from "@rsl/tenancy";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-razorpay-signature") || "";
  const valid = verifyRazorpaySignature(rawBody, sig);
  const eventId =
    req.headers.get("x-razorpay-event-id") ||
    `rzp_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;

  ingressDb()
    .insert(ingressSchema.webhookInbox)
    .values({
      id: newId(),
      provider: "razorpay",
      eventId,
      rawBody: rawBody.slice(0, 65536),
      headersJson: JSON.stringify({ sigPresent: Boolean(sig) }),
      signatureValid: valid,
      status: valid ? "processed" : "ignored",
      receivedAt: Date.now(),
      processedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid Razorpay signature" }, { status: 401 });
  }

  const parsed = JSON.parse(rawBody) as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          notes?: { workspaceId?: string; walletCreditPaise?: string };
        };
      };
    };
  };

  if (parsed.event === "payment.captured") {
    const entity = parsed.payload?.payment?.entity;
    const workspaceId = entity?.notes?.workspaceId;
    const paymentId = entity?.id;
    const creditPaise = Number(entity?.notes?.walletCreditPaise || 0);

    if (workspaceId && paymentId && creditPaise > 0) {
      const inv = createGstInvoice({
        workspaceId,
        description: `Online Wallet Recharge (${paymentId})`,
        subtotalPaise: creditPaise,
        status: "paid",
      });

      creditWallet({
        workspaceId,
        amountPaise: creditPaise,
        description: `Verified Razorpay Wallet Recharge (${paymentId})`,
        idempotencyKey: `rzp_webhook:${paymentId}`,
        actorId: "razorpay_webhook",
        entryType: "credit",
        createInvoice: false,
      });

      if (entity?.order_id) {
        controlDb()
          .update(controlSchema.payments)
          .set({
            status: "captured",
            externalPaymentId: paymentId,
            invoiceId: inv.id,
          })
          .where(eq(controlSchema.payments.externalOrderId, entity.order_id))
          .run();
      }
    }
  }

  return NextResponse.json({ ok: true });
}
