import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUserEmailVerified } from "@rsl/auth";
import {
  activatePlanOrBundleFromWallet,
  BILLING_CYCLE_META,
  createRazorpayOrderForWallet,
  normalizeBillingCycle,
  submitAdSpendRechargeRequest,
  submitBundlePlanRequest,
  submitServicePlanRequest,
  submitWalletRechargeRequest,
  verifyRazorpayCheckoutAndCreditWallet,
} from "@rsl/billing";
import { formatInr, RslError, rupeesToPaise } from "@rsl/core";
import { appendActionLog } from "@rsl/logging";
import { sendBillingNotification } from "@rsl/notifications";
import { authorize } from "@rsl/rbac";
import { requireWebSession } from "../session";
import { elapsedMs, friendlyMessage, goWithError, goWithNotice } from "./shared";

const RechargeInputSchema = z.object({
  amountPaise: z.number().int().min(100_00, "Minimum recharge is ₹100.").max(50_00_000_00, "Maximum single recharge is ₹50,00,000."),
  paymentMethod: z.enum(["upi", "bank_transfer"]),
  utrOrReference: z
    .string()
    .trim()
    .min(6, "Enter a valid UTR / bank reference number (6–64 characters).")
    .max(64, "Payment reference must be 64 characters or fewer."),
});

function parseRupeesOrPaiseFromForm(formData: FormData): number {
  const explicitPaise = formData.get("amountPaise");
  if (explicitPaise !== null && String(explicitPaise).trim() !== "") {
    const parsed = Number(explicitPaise);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new RslError("RSL-VAL-1001", "Enter a valid positive integer amount.");
    }
    return parsed;
  }
  const rupees = Number(formData.get("amountRupees") || 0);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new RslError("RSL-VAL-1001", "Enter a valid positive amount in INR.");
  }
  return rupeesToPaise(rupees);
}

export async function submitRechargeRequestActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const paymentMethodRaw =
    String(formData.get("paymentMethod") || "upi") === "bank_transfer" ? "bank_transfer" : "upi";
  const utrOrReference = String(formData.get("utrOrReference") || "").trim();

  let paise = 0;
  try {
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "submitting wallet recharge requests");
    }
    paise = parseRupeesOrPaiseFromForm(formData);
    const parsed = RechargeInputSchema.safeParse({
      amountPaise: paise,
      paymentMethod: paymentMethodRaw,
      utrOrReference,
    });
    if (!parsed.success) {
      throw new RslError("RSL-VAL-1001", parsed.error.issues[0]?.message || "Invalid recharge details.");
    }

    submitWalletRechargeRequest({
      workspaceId: session.workspace.id,
      amountPaise: parsed.data.amountPaise,
      utrOrReference: parsed.data.utrOrReference,
      paymentMethod: parsed.data.paymentMethod,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "billing.wallet.topup",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Submitted ${formatInr(paise)} recharge for verification (${parsed.data.paymentMethod.toUpperCase()} Ref: ${parsed.data.utrOrReference})`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Recharge Request Received (${formatInr(paise)})`,
      bodyText: `We have received your ${parsed.data.paymentMethod.toUpperCase()} reference (${parsed.data.utrOrReference}). Your wallet will be credited and your GST tax invoice issued as soon as our billing desk verifies the payment.`,
      walletBalanceFormatted: "Pending Verification",
    }).catch(() => undefined);
  } catch (err) {
    return goWithError("/billing", friendlyMessage(err));
  }

  return goWithNotice(
    "/billing",
    `Recharge request for ${formatInr(paise)} submitted (Ref: ${utrOrReference}). Funds and your GST invoice will appear once verified.`
  );
}

export async function submitAdSpendRechargeRequestActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const paymentMethodRaw =
    String(formData.get("paymentMethod") || "upi") === "bank_transfer" ? "bank_transfer" : "upi";
  const utrOrReference = String(formData.get("utrOrReference") || "").trim();

  let paise = 0;
  try {
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "submitting Ad Spend Vault deposits");
    }
    paise = parseRupeesOrPaiseFromForm(formData);
    const parsed = RechargeInputSchema.safeParse({
      amountPaise: paise,
      paymentMethod: paymentMethodRaw,
      utrOrReference,
    });
    if (!parsed.success) {
      throw new RslError("RSL-VAL-1001", parsed.error.issues[0]?.message || "Invalid deposit details.");
    }

    submitAdSpendRechargeRequest({
      workspaceId: session.workspace.id,
      amountPaise: parsed.data.amountPaise,
      utrOrReference: parsed.data.utrOrReference,
      paymentMethod: parsed.data.paymentMethod,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "billing.ad_vault.topup",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Submitted ${formatInr(paise)} Managed Ad Spend Vault deposit (${parsed.data.paymentMethod.toUpperCase()} Ref: ${parsed.data.utrOrReference})`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Ad Spend Vault Deposit Received (${formatInr(paise)})`,
      bodyText: `We have received your ${parsed.data.paymentMethod.toUpperCase()} reference (${parsed.data.utrOrReference}) for your 0-overdraft Managed Ad Spend Vault. Your ad funds will unlock immediately once verified.`,
      walletBalanceFormatted: "Pending Verification",
    }).catch(() => undefined);
  } catch (err) {
    return goWithError("/billing?tab=wallet", friendlyMessage(err));
  }

  return goWithNotice(
    "/billing?tab=wallet",
    `Ad Spend Vault deposit request for ${formatInr(paise)} submitted (Ref: ${utrOrReference}). Funds unlock for Meta & Google Ads once verified.`
  );
}

export async function createOnlineRazorpayOrderActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const purpose =
    String(formData.get("purpose") || "wallet_topup") === "ad_spend_topup"
      ? ("ad_spend_topup" as const)
      : ("wallet_topup" as const);

  let orderOut: { orderId: string };
  try {
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "starting online payment checkout");
    }
    const paise = parseRupeesOrPaiseFromForm(formData);
    orderOut = await createRazorpayOrderForWallet({
      workspaceId: session.workspace.id,
      amountPaise: paise,
      purpose,
    });
  } catch (err) {
    return goWithError("/billing?tab=wallet", friendlyMessage(err));
  }

  return goWithNotice(
    `/billing?tab=wallet&orderId=${encodeURIComponent(orderOut.orderId)}`,
    "Online payment order created. Complete payment to credit your account."
  );
}

export async function createRazorpayCheckoutOrderJsonActionImpl(input: {
  amountRupees: number;
  amountPaise?: number;
  purpose?: "wallet_topup" | "ad_spend_topup";
}): Promise<
  | {
      ok: true;
      orderId: string;
      keyId: string;
      amountWithGstPaise: number;
      purpose: "wallet_topup" | "ad_spend_topup";
      businessName: string;
      prefill: { name: string; email: string; contact: string };
    }
  | { ok: false; error: string }
> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "starting online Razorpay checkout");
    }
    const purpose = input.purpose === "ad_spend_topup" ? "ad_spend_topup" : "wallet_topup";
    const paise =
      typeof input.amountPaise === "number" && Number.isSafeInteger(input.amountPaise)
        ? input.amountPaise
        : rupeesToPaise(Number(input.amountRupees || 0));
    if (!Number.isSafeInteger(paise) || paise < 100_00 || paise > 50_00_000_00) {
      throw new RslError("RSL-VAL-1001", "Checkout amount must be between ₹100 and ₹50,00,000.");
    }
    const order = await createRazorpayOrderForWallet({
      workspaceId: session.workspace.id,
      amountPaise: paise,
      purpose,
    });
    return {
      ok: true,
      orderId: order.orderId,
      keyId: order.keyId,
      amountWithGstPaise: order.amountWithGstPaise,
      purpose: order.purpose,
      businessName: session.workspace.name,
      prefill: {
        name: session.user.name || session.workspace.name,
        email: session.user.email || "",
        contact: session.workspace.businessPhone || "",
      },
    };
  } catch (err) {
    return { ok: false, error: friendlyMessage(err) };
  }
}

export async function verifyRazorpayPaymentJsonActionImpl(input: {
  orderId: string;
  paymentId: string;
  signatureHex: string;
}): Promise<
  | {
      ok: true;
      balancePaise: number;
      invoiceNumber?: string;
      purpose: "wallet_topup" | "ad_spend_topup";
      message: string;
    }
  | { ok: false; error: string }
> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
    const parsed = z
      .object({
        orderId: z.string().trim().min(4).max(120),
        paymentId: z.string().trim().min(4).max(120),
        signatureHex: z.string().trim().min(32).max(256),
      })
      .parse(input);

    const out = verifyRazorpayCheckoutAndCreditWallet({
      workspaceId: session.workspace.id,
      orderId: parsed.orderId,
      paymentId: parsed.paymentId,
      signatureHex: parsed.signatureHex,
      actorId: session.user.id,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action:
        out.purpose === "ad_spend_topup"
          ? "billing.ad_vault.razorpay_verified"
          : "billing.wallet.razorpay_verified",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Verified Razorpay payment ${parsed.paymentId} (${out.purpose}) - Voucher ${out.invoiceNumber || "issued"}`,
    });

    revalidatePath("/billing");
    revalidatePath("/campaigns");

    return {
      ok: true,
      balancePaise: out.balancePaise,
      invoiceNumber: out.invoiceNumber,
      purpose: out.purpose,
      message:
        out.purpose === "ad_spend_topup"
          ? `Ad Spend Vault credited! New available ad balance: ${formatInr(out.balancePaise, { showDecimals: true })}`
          : `Prepaid Wallet credited! New wallet balance: ${formatInr(out.balancePaise, { showDecimals: true })}`,
    };
  } catch (err) {
    return { ok: false, error: friendlyMessage(err) };
  }
}

export async function requestServicePlanActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const customerPaymentRef =
    String(formData.get("customerPaymentRef") || "").trim().slice(0, 64) || undefined;
  const customerNote =
    String(formData.get("customerNote") || "").trim().slice(0, 500) || undefined;
  const rawReturnPath = String(formData.get("returnPath") || "/billing").trim();
  const returnPath =
    rawReturnPath.startsWith("/") && !rawReturnPath.startsWith("//") ? rawReturnPath : "/billing";

  let out: { requestId: string; serviceName: string; alreadyPending: boolean };
  try {
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "requesting service plan activation");
    }
    out = submitServicePlanRequest({
      workspaceId: session.workspace.id,
      serviceKey,
      billingCycle,
      requestedByUserId: session.user.id,
      customerNote,
      customerPaymentRef,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "billing.service.requested",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Requested ${BILLING_CYCLE_META[billingCycle].label} activation of '${out.serviceName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Request Received - ${out.serviceName} (${BILLING_CYCLE_META[billingCycle].label})`,
      bodyText: `We have received your ${BILLING_CYCLE_META[billingCycle].label.toLowerCase()} activation request for '${out.serviceName}'. Our billing desk will verify payment, issue your GST tax invoice, and unlock this feature on your account.`,
      walletBalanceFormatted: "Pending Payment Verification",
    }).catch(() => undefined);
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }

  return goWithNotice(
    returnPath,
    out.alreadyPending
      ? `Updated your ${BILLING_CYCLE_META[billingCycle].label.toLowerCase()} request for '${out.serviceName}'.`
      : `Activation request submitted - '${out.serviceName}' (${BILLING_CYCLE_META[billingCycle].label}) will unlock once payment is verified.`
  );
}

export async function requestBundlePlanActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const bundleKey = String(formData.get("bundleKey") || "").trim();
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const customerPaymentRef =
    String(formData.get("customerPaymentRef") || "").trim().slice(0, 64) || undefined;
  const customerNote =
    String(formData.get("customerNote") || "").trim().slice(0, 500) || undefined;
  const rawReturnPath = String(formData.get("returnPath") || "/billing").trim();
  const returnPath =
    rawReturnPath.startsWith("/") && !rawReturnPath.startsWith("//") ? rawReturnPath : "/billing";

  let out: { requestId: string; bundleName: string; alreadyPending: boolean };
  try {
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "requesting bundle activation");
    }
    out = submitBundlePlanRequest({
      workspaceId: session.workspace.id,
      bundleKey,
      billingCycle,
      requestedByUserId: session.user.id,
      customerNote,
      customerPaymentRef,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "billing.bundle.requested",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Requested ${BILLING_CYCLE_META[billingCycle].label} bundle '${out.bundleName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Bundle Request Received - ${out.bundleName}`,
      bodyText: `We have received your ${BILLING_CYCLE_META[billingCycle].label.toLowerCase()} activation request for '${out.bundleName}'. Our billing desk will verify payment, issue your GST tax invoice, and unlock all included tools.`,
      walletBalanceFormatted: "Pending Payment Verification",
    }).catch(() => undefined);
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }

  return goWithNotice(
    returnPath,
    out.alreadyPending
      ? `Updated your request for '${out.bundleName}'.`
      : `Bundle activation requested - '${out.bundleName}' will unlock once payment is verified.`
  );
}

export async function submitActivationModalActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "requesting plan activation");
    }
    const targetType =
      String(formData.get("targetType") || "service") === "bundle" ? "bundle" : "service";
    const targetKey = String(formData.get("targetKey") || "").trim();
    const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
    const customerPaymentRef =
      String(formData.get("customerPaymentRef") || "").trim().slice(0, 64) || undefined;
    const customerNote =
      String(formData.get("customerNote") || "").trim().slice(0, 500) || undefined;
    const cycleLabel = BILLING_CYCLE_META[billingCycle].label;

    if (targetType === "bundle") {
      const out = submitBundlePlanRequest({
        workspaceId: session.workspace.id,
        bundleKey: targetKey,
        billingCycle,
        requestedByUserId: session.user.id,
        customerNote,
        customerPaymentRef,
      });

      appendActionLog({
        workspaceId: session.workspace.id,
        actorType: session.ctx.actorType,
        actorId: session.user.id,
        impersonatorId: session.impersonatorStaffId,
        source: "web",
        action: "billing.bundle.requested",
        outcome: "success",
        requestId: session.ctx.requestId,
        correlationId: session.ctx.correlationId,
        durationMs: elapsedMs(startedAt),
        summary: `Requested ${cycleLabel} bundle '${out.bundleName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
      });

      await sendBillingNotification({
        workspaceId: session.workspace.id,
        businessName: session.workspace.name,
        recipientEmail: session.user.email,
        headline: `Bundle Request Received - ${out.bundleName}`,
        bodyText: `We have received your ${cycleLabel.toLowerCase()} activation request for '${out.bundleName}'${customerPaymentRef ? ` (Payment Ref: ${customerPaymentRef})` : ""}. Our billing desk will verify payment, issue your GST tax invoice, and unlock all included tools.`,
        walletBalanceFormatted: "Pending Payment Verification",
      }).catch(() => undefined);

      return {
        ok: true,
        message: `Activation requested - '${out.bundleName}' (${cycleLabel}) is queued for verification.`,
      };
    }

    const out = submitServicePlanRequest({
      workspaceId: session.workspace.id,
      serviceKey: targetKey,
      billingCycle,
      requestedByUserId: session.user.id,
      customerNote,
      customerPaymentRef,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "billing.service.requested",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Requested ${cycleLabel} activation of '${out.serviceName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Request Received - ${out.serviceName}`,
      bodyText: `We have received your ${cycleLabel.toLowerCase()} activation request for '${out.serviceName}'${customerPaymentRef ? ` (Payment Ref: ${customerPaymentRef})` : ""}. Our billing desk will verify payment, issue your GST tax invoice, and unlock this feature on your account.`,
      walletBalanceFormatted: "Pending Payment Verification",
    }).catch(() => undefined);

    return {
      ok: true,
      message: `Activation requested - '${out.serviceName}' (${cycleLabel}) will unlock once payment is verified.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: friendlyMessage(err),
    };
  }
}

export async function instantActivateFromWalletActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  invoiceNumber?: string;
}> {
  const startedAt = Date.now();
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "activating subscriptions from Prepaid Wallet");
    }
    const targetType =
      String(formData.get("targetType") || "service") === "bundle" ? "bundle" : "service";
    const targetKey = String(formData.get("targetKey") || "").trim();
    const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
    const cycleLabel = BILLING_CYCLE_META[billingCycle].label;

    const out = activatePlanOrBundleFromWallet({
      workspaceId: session.workspace.id,
      actorId: session.user.id,
      targetType,
      targetKey,
      billingCycle,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: targetType === "bundle" ? "billing.bundle.activated" : "billing.service.activated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: elapsedMs(startedAt),
      summary: `Instantly activated '${out.activatedName}' (${cycleLabel}) from Prepaid Wallet - GST Invoice ${out.invoiceNumber}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Unlocked - ${out.activatedName} (${out.invoiceNumber})`,
      bodyText: `Your '${out.activatedName}' (${cycleLabel}) subscription is now active! ${formatInr(out.totalDebitedPaise, { showDecimals: true })} (incl. 18% GST) was settled from your Prepaid Wallet under Tax Invoice ${out.invoiceNumber}.`,
      walletBalanceFormatted: formatInr(out.remainingWalletPaise, { showDecimals: true }),
    }).catch(() => undefined);

    revalidatePath("/billing");
    revalidatePath("/");

    return {
      ok: true,
      invoiceNumber: out.invoiceNumber,
      message: `'${out.activatedName}' is now unlocked! Official GST Tax Invoice ${out.invoiceNumber} has been issued.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: friendlyMessage(err),
    };
  }
}
