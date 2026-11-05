"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import {
  createRazorpayCheckoutOrderJsonAction,
  verifyRazorpayPaymentJsonAction,
} from "@/lib/actions";

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (response: RazorpayHandlerResponse) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (event: string, callback: (resp: { error?: { description?: string } }) => void) => void;
    };
  }
}

let razorpayScriptPromise: Promise<boolean> | null = null;

function ensureRazorpaySdkLoaded(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)));
      existing.addEventListener("error", () => resolve(false));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      razorpayScriptPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return razorpayScriptPromise;
}

export function RazorpayCheckoutButton({
  purpose = "wallet_topup",
  defaultRupees = 2500,
  minRupees = 100,
  buttonLabel = "Pay Online Now",
}: {
  purpose?: "wallet_topup" | "ad_spend_topup";
  defaultRupees?: number;
  minRupees?: number;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [amountRupees, setAmountRupees] = useState<string>(String(defaultRupees));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function handleLaunchCheckout(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const parsedRupees = Number(amountRupees || 0);
    if (!Number.isFinite(parsedRupees) || parsedRupees < minRupees) {
      setFeedback({
        kind: "err",
        text: `Minimum online deposit is ₹${minRupees}.`,
      });
      return;
    }

    setBusy(true);
    try {
      const [sdkReady, orderRes] = await Promise.all([
        ensureRazorpaySdkLoaded(),
        createRazorpayCheckoutOrderJsonAction({
          amountRupees: parsedRupees,
          purpose,
        }),
      ]);

      if (!orderRes.ok) {
        setFeedback({ kind: "err", text: orderRes.error });
        setBusy(false);
        return;
      }

      if (!sdkReady || !window.Razorpay) {
        setFeedback({
          kind: "err",
          text: "Could not load Razorpay checkout script. Check your internet connection or use UPI QR / UTR above.",
        });
        setBusy(false);
        return;
      }

      const instance = new window.Razorpay({
        key: orderRes.keyId,
        amount: orderRes.amountWithGstPaise,
        currency: "INR",
        name: "RapidShift Labs",
        description:
          purpose === "ad_spend_topup"
            ? `Managed Ad Spend Vault Deposit — ${orderRes.businessName}`
            : `Prepaid Wallet Recharge — ${orderRes.businessName}`,
        order_id: orderRes.orderId,
        prefill: {
          name: orderRes.prefill.name,
          email: orderRes.prefill.email,
          contact: orderRes.prefill.contact,
        },
        theme: { color: "#059669" },
        modal: {
          ondismiss: () => {
            setBusy(false);
          },
        },
        handler: async (resp) => {
          const verified = await verifyRazorpayPaymentJsonAction({
            orderId: resp.razorpay_order_id,
            paymentId: resp.razorpay_payment_id,
            signatureHex: resp.razorpay_signature,
          });
          setBusy(false);
          if (!verified.ok) {
            setFeedback({ kind: "err", text: verified.error });
            return;
          }
          setFeedback({ kind: "ok", text: verified.message });
          router.refresh();
        },
      });

      instance.on("payment.failed", (failEvt) => {
        setBusy(false);
        setFeedback({
          kind: "err",
          text:
            failEvt?.error?.description ||
            "Payment was declined or cancelled in the gateway window.",
        });
      });

      instance.open();
    } catch (err) {
      setBusy(false);
      setFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not open Razorpay checkout.",
      });
    }
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleLaunchCheckout}
        className="flex flex-wrap items-center justify-between gap-3 text-[13px]"
      >
        <div>
          <div className="font-semibold text-slate-900">
            Instant Online Payment (UPI / Cards / NetBanking)
          </div>
          <div className="text-xs text-zinc-500">
            {purpose === "ad_spend_topup"
              ? "Opens Razorpay Checkout and credits your 0-overdraft Ad Spend Vault immediately."
              : "Opens Razorpay Checkout and credits your Prepaid Wallet immediately upon payment."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            name="amountRupees"
            type="number"
            min={minRupees}
            step="1"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            disabled={busy}
            className="rsl-input w-32 tabular-nums"
            style={{ width: "8rem" }}
          />
          <button
            type="submit"
            disabled={busy}
            className="rsl-btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                <span>Opening Gateway...</span>
              </>
            ) : (
              <>
                <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                <span>{buttonLabel}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
            feedback.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {feedback.kind === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}
