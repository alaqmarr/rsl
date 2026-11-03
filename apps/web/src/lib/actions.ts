"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  createOutboundWebhookEndpoint,
  deleteOutboundWebhookEndpoint,
  issueApiKey,
  revokeApiKey,
  rotateApiKey,
  testOutboundWebhookEndpoint,
} from "@rsl/api-keys";
import {
  acceptWorkspaceInvitation,
  addOrInviteTeamMember,
  changeAuthenticatedUserPassword,
  createAdditionalWorkspace,
  DEFAULT_STARTER_TRIAL_DAYS,
  regenerateWorkspaceInvitationToken,
  registerUserWithWorkspace,
  removeWorkspaceMember,
  revokeAllOtherUserSessions,
  revokeUserSessionById,
  revokeWorkspaceInvitation,
  signInUser,
  signOutSession,
  switchActiveWorkspace,
  updateAuthenticatedUserProfile,
  updateWorkspaceBusinessSettings,
  updateWorkspaceMemberRole,
  WEB_SESSION_COOKIE,
} from "@rsl/auth";
import {
  bulkImportContactsCsv,
  createSignedEncryptedBackup,
  optimizeTenantDatabase,
  requestCustomBackupProvider,
  restoreSignedEncryptedBackup,
} from "@rsl/backup";
import {
  activatePlanOrBundleFromWallet,
  BILLING_CYCLE_META,
  createRazorpayOrderForWallet,
  hasActiveEntitlement,
  normalizeBillingCycle,
  requireEntitlement,
  submitBundlePlanRequest,
  submitServicePlanRequest,
  submitWalletRechargeRequest,
} from "@rsl/billing";
import {
  disconnectExternalConnection,
  linkExternalConnection,
  rotateWorkspaceWebhookVerifyToken,
  updateExternalConnection,
  uploadFileToWorkspaceGoogleDrive,
  verifyExternalConnectionHealth,
  type ConnectionChannelKind,
} from "@rsl/connections";
import {
  formatInr,
  getEnv,
  resolveEndpointsFromHeaders,
  RslError,
  rupeesToPaise,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { recordDocsFeedback } from "@rsl/docs";
import { generateSmartReviewDraft, recordGoogleReview, replyToGoogleReview } from "@rsl/google";
import {
  addConversationInternalNote,
  assignConversationToMember,
  attachConversationLabel,
  createContact,
  deleteCannedReply,
  removeConversationLabel,
  replyToConversation,
  saveCannedReply,
  startOrLogConversation,
  updateConversationStatus,
} from "@rsl/inbox";
import { appendActionLog } from "@rsl/logging";
import { enqueueWorkspaceSslProvisioning } from "@rsl/queue";
import { authorize, authorizeAny } from "@rsl/rbac";
import {
  createAdCampaign,
  deleteScheduledPost,
  publishScheduledPost,
  recordCampaignDailySnapshot,
  recordWebsiteSalesEvent,
  scheduleSocialPost,
  toggleCampaignStatus,
} from "@rsl/meta";
import {
  completePasswordReset,
  confirmEmailVerificationCode,
  requestPasswordResetEmail,
  sendBillingNotification,
  sendEmailVerificationCode,
  sendStorageAndBackupNotification,
  sendTeamInviteNotification,
} from "@rsl/notifications";
import { configureAndMigrateStorage, putWorkspaceObject } from "@rsl/storage";
import {
  bulkImportTallyData,
  bulkImportTallyInventory,
  computeTallyWebhookLiveStatus,
  createTallyAutomationRule,
  deleteTallyAutomationRule,
  deleteTallyReminderRule,
  deleteTallyStockItem,
  fetchAndSyncLocalTallyPort9000,
  generateTallyPairingCode,
  getOrCreateTallyWebhookEndpoint,
  ingestTallyBillEventAndEnqueueAutomation,
  recordTallyVoucher,
  revokeTallyAgentDevice,
  rotateTallyWebhookToken,
  runDueTallyReminders,
  saveTallyCompanyRouting,
  saveTallyReminderRule,
  sendTallyBillOnWhatsApp,
  toggleTallyAutomationRule,
  toggleTallyWebhookEndpoint,
  upsertTallyStockItem,
} from "@rsl/tally";
import { controlDb } from "@rsl/tenancy";
import {
  addWhatsAppUnsubscribedNumber,
  createWhatsAppTemplate,
  deleteWhatsAppTemplate,
  installStarterTallyTemplates,
  launchWhatsAppBroadcast,
  removeWhatsAppUnsubscribedNumber,
  syncWhatsAppTemplatesWithMeta,
  updateWhatsAppTemplate,
  type WhatsAppTemplateButton,
} from "@rsl/whatsapp";
import { clearWebSessionCookie, requireWebSession, setWebSessionCookie } from "./session";
import { flushInlineTallyOutboxIfNoRedis } from "./tally-outbox-runner";

function friendlyMessage(err: unknown): string {
  if (err instanceof RslError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Could not complete that action. Please try again.";
}

async function setWebFlashToastCookie(type: "success" | "error", message: string): Promise<void> {
  const payload = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
  };
  const encoded = `b64_${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const jar = await cookies();
  jar.set("rsl_toast", encoded, {
    path: "/",
    maxAge: 30,
    httpOnly: false,
    sameSite: "lax",
  });
}

async function goWithNotice(basePath: string, notice: string): Promise<void> {
  await setWebFlashToastCookie("success", notice);
  redirect(basePath);
}

async function goWithError(basePath: string, error: string): Promise<void> {
  await setWebFlashToastCookie("error", error);
  redirect(basePath);
}

async function enforceFeaturePaidEntitlement(
  workspaceId: string,
  serviceKey: string,
  returnPath: string
): Promise<void> {
  try {
    requireEntitlement(workspaceId, serviceKey);
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }
}

// ==========================================
// Authentication & Business Switching
// ==========================================

export interface WebAuthFormState {
  error: string | null;
  fields: Record<string, string>;
}

export async function registerFormStateAction(
  _prevState: WebAuthFormState,
  formData: FormData
): Promise<WebAuthFormState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const businessName = String(formData.get("businessName") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const stateCode = String(formData.get("stateCode") || "27").trim();
  const gstin = String(formData.get("gstin") || "").trim().toUpperCase();
  const fields = { name, email, businessName, industry, stateCode, gstin };

  if (name.length < 2) {
    return { error: "Please enter your full name.", fields };
  }
  if (!email.includes("@")) {
    return { error: "Please enter a valid business email address.", fields };
  }
  if (businessName.length < 2) {
    return { error: "Please enter your firm or business name.", fields };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters long.", fields };
  }

  let reg: { rawSessionToken: string; userId: string; workspaceId: string };
  try {
    reg = registerUserWithWorkspace({
      name,
      email,
      password,
      businessName,
      industry,
      stateCode,
      gstin,
      grantStarterTrialDays: DEFAULT_STARTER_TRIAL_DAYS,
    });
  } catch (err) {
    return { error: friendlyMessage(err), fields };
  }

  await setWebSessionCookie(reg.rawSessionToken);

  try {
    await enqueueWorkspaceSslProvisioning({
      workspaceId: reg.workspaceId,
      actorType: "user",
      actorId: reg.userId,
    });
  } catch {
    // Non-blocking SSL subdomain warm-up
  }

  try {
    await sendEmailVerificationCode({
      userId: reg.userId,
      email,
      recipientName: name,
      workspaceId: reg.workspaceId,
    });
  } catch {
    // Non-blocking welcome verification email
  }

  await setWebFlashToastCookie(
    "success",
    `Welcome to RSL Marketing! Your ${DEFAULT_STARTER_TRIAL_DAYS}-day all-tools starter trial for ${businessName} is now active.`
  );
  redirect("/");
}

export async function loginFormStateAction(
  _prevState: WebAuthFormState,
  formData: FormData
): Promise<WebAuthFormState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const fields = { email };

  let res: { rawSessionToken: string };
  try {
    res = signInUser({ email, password });
  } catch (err) {
    return { error: friendlyMessage(err), fields };
  }

  await setWebSessionCookie(res.rawSessionToken);
  redirect("/");
}

export async function registerAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const businessName = String(formData.get("businessName") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const stateCode = String(formData.get("stateCode") || "27").trim();
  const gstin = String(formData.get("gstin") || "").trim();

  if (password.length < 8) {
    return goWithError("/register", "Password must be at least 8 characters long.");
  }

  let reg: { rawSessionToken: string; userId: string; workspaceId: string };
  try {
    reg = registerUserWithWorkspace({
      name,
      email,
      password,
      businessName,
      industry,
      stateCode,
      gstin,
      grantStarterTrialDays: DEFAULT_STARTER_TRIAL_DAYS,
    });
  } catch (err) {
    return goWithError("/register", friendlyMessage(err));
  }

  await setWebSessionCookie(reg.rawSessionToken);

  try {
    await enqueueWorkspaceSslProvisioning({
      workspaceId: reg.workspaceId,
      actorType: "user",
      actorId: reg.userId,
    });
  } catch {
    // Non-blocking SSL subdomain warm-up
  }

  try {
    await sendEmailVerificationCode({
      userId: reg.userId,
      email,
      recipientName: name,
      workspaceId: reg.workspaceId,
    });
  } catch {
    // Non-blocking welcome verification email
  }

  return goWithNotice(
    "/",
    `Welcome to RSL Marketing! Your ${DEFAULT_STARTER_TRIAL_DAYS}-day all-tools starter trial for ${businessName} is active.`
  );
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  let res: { rawSessionToken: string };
  try {
    res = signInUser({ email, password });
  } catch (err) {
    return goWithError("/login", friendlyMessage(err));
  }

  await setWebSessionCookie(res.rawSessionToken);
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  const raw = jar.get(WEB_SESSION_COOKIE)?.value;
  if (raw) {
    signOutSession(raw);
  }
  await clearWebSessionCookie();
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  try {
    await requestPasswordResetEmail({ email });
  } catch (err) {
    return goWithError("/forgot-password", friendlyMessage(err));
  }
  return goWithNotice(
    "/forgot-password",
    "If an account exists for that email, we have sent a password reset link."
  );
}

export async function resetPasswordAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const token = String(formData.get("token") || "").trim();
  const newPassword = String(formData.get("newPassword") || "");

  if (newPassword.length < 8) {
    return goWithError(
      `/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
      "New password must be at least 8 characters."
    );
  }

  try {
    completePasswordReset({ email, rawToken: token, newPassword });
  } catch (err) {
    return goWithError(
      `/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
      friendlyMessage(err)
    );
  }
  return goWithNotice("/login", "Your password has been updated. Please sign in.");
}

export async function verifyEmailCodeAction(formData: FormData) {
  const session = await requireWebSession();
  const code = String(formData.get("code") || "").trim();
  const ok = confirmEmailVerificationCode(session.user.email, code);
  if (!ok) {
    return goWithError("/settings/team", "Invalid or expired 6-digit verification code.");
  }
  return goWithNotice("/settings/team", "Email address verified.");
}

export async function resendVerificationEmailAction() {
  const session = await requireWebSession();
  await sendEmailVerificationCode({
    userId: session.user.id,
    email: session.user.email,
    recipientName: session.user.name,
    workspaceId: session.workspace.id,
  });
  return goWithNotice("/settings/team", `Sent a 6-digit verification code to ${session.user.email}.`);
}

export async function switchWorkspaceAction(formData: FormData) {
  const session = await requireWebSession();
  const targetWorkspaceId = String(formData.get("workspaceId") || "").trim();
  try {
    switchActiveWorkspace(session.sessionId, session.user.id, targetWorkspaceId);
  } catch (err) {
    return goWithError("/", friendlyMessage(err));
  }
  return goWithNotice("/", "Switched active business.");
}

export async function createNewBusinessAction(formData: FormData) {
  const session = await requireWebSession();
  const businessName = String(formData.get("businessName") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const stateCode = String(formData.get("stateCode") || "27").trim();
  const gstin = String(formData.get("gstin") || "").trim();

  if (businessName.length < 2) {
    return goWithError("/settings/business", "Enter a valid business name.");
  }

  try {
    authorize(session.ctx, "workspace:manage");
    const newWsId = createAdditionalWorkspace({
      sessionId: session.sessionId,
      userId: session.user.id,
      businessName,
      industry,
      stateCode,
      gstin,
    });
    await enqueueWorkspaceSslProvisioning({
      workspaceId: newWsId,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
    }).catch(() => undefined);
  } catch (err) {
    return goWithError("/settings/business", friendlyMessage(err));
  }
  return goWithNotice("/", `Created and switched to ${businessName}.`);
}

// ==========================================
// Plans, Prepaid Wallet & Verified Recharges
// ==========================================

/**
 * Security: Customers CANNOT directly add balance to their own wallet!
 * Submitting a UPI / Bank Transfer recharge records status = 'pending_verification' (₹0 credited)
 * until verified by Platform Operations or confirmed by Razorpay webhook signature.
 */
export async function submitRechargeRequestAction(formData: FormData) {
  const session = await requireWebSession();
  const rupees = Number(formData.get("amountRupees") || 0);
  const paymentMethod = (String(formData.get("paymentMethod") || "upi") === "bank_transfer"
    ? "bank_transfer"
    : "upi") as "upi" | "bank_transfer";
  const utrOrReference = String(formData.get("utrOrReference") || "").trim();
  const paise = rupeesToPaise(rupees);

  try {
    authorize(session.ctx, "billing:manage");
    submitWalletRechargeRequest({
      workspaceId: session.workspace.id,
      amountPaise: paise,
      utrOrReference,
      paymentMethod,
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
      durationMs: 5,
      summary: `Submitted ${formatInr(paise)} recharge for verification (${paymentMethod.toUpperCase()} Ref: ${utrOrReference})`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Recharge Request Received (${formatInr(paise)})`,
      bodyText: `We have received your ${paymentMethod.toUpperCase()} reference (${utrOrReference}). Your wallet will be credited and your GST tax invoice issued as soon as our billing desk verifies the payment.`,
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

export async function createOnlineRazorpayOrderAction(formData: FormData) {
  const session = await requireWebSession();
  const rupees = Number(formData.get("amountRupees") || 0);
  const paise = rupeesToPaise(rupees);

  let orderOut: { orderId: string };
  try {
    authorize(session.ctx, "billing:manage");
    orderOut = await createRazorpayOrderForWallet({
      workspaceId: session.workspace.id,
      amountPaise: paise,
    });
  } catch (err) {
    return goWithError("/billing", friendlyMessage(err));
  }

  return goWithNotice(
    `/billing?orderId=${encodeURIComponent(orderOut.orderId)}`,
    "Online payment order created. Complete payment to credit your wallet."
  );
}

/**
 * Security: Customers CANNOT activate or cancel plans themselves!
 * They view full plan details and submit a request. The feature unlocks ONLY after Staff records payment.
 */
export async function requestServicePlanAction(formData: FormData) {
  const session = await requireWebSession();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const customerPaymentRef = String(formData.get("customerPaymentRef") || "").trim() || undefined;
  const customerNote = String(formData.get("customerNote") || "").trim() || undefined;
  const rawReturnPath = String(formData.get("returnPath") || "/billing").trim();
  const returnPath = rawReturnPath.startsWith("/") ? rawReturnPath : "/billing";

  let out: { requestId: string; serviceName: string; alreadyPending: boolean };
  try {
    authorize(session.ctx, "billing:manage");
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
      durationMs: 4,
      summary: `Requested ${BILLING_CYCLE_META[billingCycle].label} activation of '${out.serviceName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Request Received — ${out.serviceName} (${BILLING_CYCLE_META[billingCycle].label})`,
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
      : `Activation request submitted — '${out.serviceName}' (${BILLING_CYCLE_META[billingCycle].label}) will unlock once payment is verified.`
  );
}

export async function requestBundlePlanAction(formData: FormData) {
  const session = await requireWebSession();
  const bundleKey = String(formData.get("bundleKey") || "").trim();
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const customerPaymentRef = String(formData.get("customerPaymentRef") || "").trim() || undefined;
  const customerNote = String(formData.get("customerNote") || "").trim() || undefined;
  const rawReturnPath = String(formData.get("returnPath") || "/billing").trim();
  const returnPath = rawReturnPath.startsWith("/") ? rawReturnPath : "/billing";

  let out: { requestId: string; bundleName: string; alreadyPending: boolean };
  try {
    authorize(session.ctx, "billing:manage");
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
      durationMs: 4,
      summary: `Requested ${BILLING_CYCLE_META[billingCycle].label} bundle '${out.bundleName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Bundle Request Received — ${out.bundleName}`,
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
      : `Bundle activation requested — '${out.bundleName}' will unlock once payment is verified.`
  );
}

/**
 * Modal-friendly Server Action invoked by `<PlanActivationModal />`.
 * Submits either a single service plan or a multi-tool bundle request without URL param redirects,
 * returning `{ ok, message }` so Sileo fires immediately and the trigger button disables cleanly.
 */
export async function submitActivationModalAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
    const targetType = String(formData.get("targetType") || "service") === "bundle" ? "bundle" : "service";
    const targetKey = String(formData.get("targetKey") || "").trim();
    const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
    const customerPaymentRef = String(formData.get("customerPaymentRef") || "").trim() || undefined;
    const customerNote = String(formData.get("customerNote") || "").trim() || undefined;
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
        durationMs: 4,
        summary: `Requested ${cycleLabel} bundle '${out.bundleName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
      });

      await sendBillingNotification({
        workspaceId: session.workspace.id,
        businessName: session.workspace.name,
        recipientEmail: session.user.email,
        headline: `Bundle Request Received — ${out.bundleName}`,
        bodyText: `We have received your ${cycleLabel.toLowerCase()} activation request for '${out.bundleName}'${customerPaymentRef ? ` (Payment Ref: ${customerPaymentRef})` : ""}. Our billing desk will verify payment, issue your GST tax invoice, and unlock all included tools.`,
        walletBalanceFormatted: "Pending Payment Verification",
      }).catch(() => undefined);

      return {
        ok: true,
        message: `Activation requested — '${out.bundleName}' (${cycleLabel}) is queued for verification.`,
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
      durationMs: 4,
      summary: `Requested ${cycleLabel} activation of '${out.serviceName}'${customerPaymentRef ? ` (Ref: ${customerPaymentRef})` : ""}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Request Received — ${out.serviceName}`,
      bodyText: `We have received your ${cycleLabel.toLowerCase()} activation request for '${out.serviceName}'${customerPaymentRef ? ` (Payment Ref: ${customerPaymentRef})` : ""}. Our billing desk will verify payment, issue your GST tax invoice, and unlock this feature on your account.`,
      walletBalanceFormatted: "Pending Payment Verification",
    }).catch(() => undefined);

    return {
      ok: true,
      message: `Activation requested — '${out.serviceName}' (${cycleLabel}) will unlock once payment is verified.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: friendlyMessage(err),
    };
  }
}

export async function instantActivateFromWalletAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  invoiceNumber?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "billing:manage");
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
      durationMs: 6,
      summary: `Instantly activated '${out.activatedName}' (${cycleLabel}) from Prepaid Wallet — GST Invoice ${out.invoiceNumber}`,
    });

    await sendBillingNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      recipientEmail: session.user.email,
      headline: `Plan Unlocked — ${out.activatedName} (${out.invoiceNumber})`,
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

// ==========================================
// Customer Messages (Shared Inbox)
// ==========================================

export async function createContactAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const res = await createContact(session.ctx, {
    name: String(formData.get("name") || ""),
    phoneE164: String(formData.get("phoneE164") || ""),
    email: String(formData.get("email") || ""),
    companyName: String(formData.get("companyName") || ""),
    recordWhatsAppConsent: formData.get("recordWhatsAppConsent") === "on",
    consentSource: "direct_customer_entry",
  });
  if (!res.ok) return goWithError("/inbox", res.error.message);
  return goWithNotice("/inbox", "Customer contact saved.");
}

export async function startConversationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const res = await startOrLogConversation(session.ctx, {
    contactId: String(formData.get("contactId") || ""),
    channel: (String(formData.get("channel") || "whatsapp") as "whatsapp" | "instagram" | "facebook" | "google_review"),
    direction: (String(formData.get("direction") || "inbound") as "inbound" | "outbound"),
    body: String(formData.get("body") || ""),
    slaTargetMinutes: Number(formData.get("slaTargetMinutes") || 30),
  });
  if (!res.ok) return goWithError("/inbox", res.error.message);
  return goWithNotice(`/inbox?conv=${encodeURIComponent(res.data.conversationId)}`, "Conversation logged.");
}

export async function replyConversationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const res = await replyToConversation(session.ctx, {
    conversationId: convId,
    body: String(formData.get("body") || ""),
    templateName: String(formData.get("templateName") || "") || undefined,
  });
  if (!res.ok) {
    return goWithError(`/inbox?conv=${encodeURIComponent(convId)}`, res.error.message);
  }
  return goWithNotice(`/inbox?conv=${encodeURIComponent(convId)}`, "Reply sent.");
}

export async function changeConversationStatusAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const status = String(formData.get("status") || "resolved") as "open" | "pending" | "resolved" | "snoozed";
  const res = await updateConversationStatus(session.ctx, { conversationId: convId, status });
  if (!res.ok) {
    return goWithError(`/inbox?conv=${encodeURIComponent(convId)}`, res.error.message);
  }
  return goWithNotice(`/inbox?conv=${encodeURIComponent(convId)}`, `Marked conversation as ${status}.`);
}

export async function addInternalNoteAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "");
  const res = await addConversationInternalNote(session.ctx, {
    conversationId: convId,
    authorName: session.user.name,
    body: String(formData.get("body") || ""),
  });
  if (!res.ok) {
    return goWithError(`/inbox?conv=${encodeURIComponent(convId)}`, res.error.message);
  }
  return goWithNotice(`/inbox?conv=${encodeURIComponent(convId)}`, "Private team note saved.");
}

export async function saveCannedReplyAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await saveCannedReply(session.ctx, {
    shortcut: String(formData.get("shortcut") || "").trim().toLowerCase(),
    title: String(formData.get("title") || "").trim(),
    body: String(formData.get("body") || "").trim(),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, `Saved quick reply "/${res.data.shortcut}".`);
}

export async function deleteCannedReplyAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await deleteCannedReply(session.ctx, {
    replyId: String(formData.get("replyId") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, "Quick reply removed.");
}

export async function assignConversationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const assignedUserId = String(formData.get("assignedUserId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await assignConversationToMember(session.ctx, {
    conversationId: convId,
    assignedUserId,
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    res.data.assignedUserId ? "Assigned thread to team member." : "Unassigned conversation thread."
  );
}

export async function attachConversationLabelAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await attachConversationLabel(session.ctx, {
    conversationId: convId,
    labelName: String(formData.get("labelName") || "").trim(),
    colorHex: String(formData.get("colorHex") || "#0E8A56").trim(),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, `Added label "${res.data.name}".`);
}

export async function removeConversationLabelAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "inbox", "/inbox");
  const convId = String(formData.get("conversationId") || "").trim();
  const returnPath = convId ? `/inbox?conv=${encodeURIComponent(convId)}` : "/inbox";
  const res = await removeConversationLabel(session.ctx, {
    conversationId: convId,
    labelId: String(formData.get("labelId") || "").trim(),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, "Removed label from thread.");
}

// ==========================================
// Tally Prime Sync, Webhooks & WhatsApp Automation
// ==========================================

export async function generatePairingCodeAction() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const res = await generateTallyPairingCode(session.ctx, {});
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice(`/tally?pairingCode=${encodeURIComponent(res.data.pairingCode)}`, "Generated 15-minute PC pairing code.");
}

export async function rotateTallyWebhookTokenAction() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const res = await rotateTallyWebhookToken(session.ctx, {});
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", "Generated a fresh Tally webhook URL token.");
}

export async function createTallyAutomationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const res = await createTallyAutomationRule(session.ctx, {
    name: String(formData.get("name") || "").trim(),
    triggerEvent: String(formData.get("triggerEvent") || "Sales") as
      | "Sales"
      | "Receipt"
      | "CreditNote"
      | "Purchase"
      | "All",
    templateId: String(formData.get("templateId") || "").trim(),
    minAmountRupees: Number(formData.get("minAmountRupees") || 0),
    delaySeconds: Number(formData.get("delaySeconds") || 0),
  });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice(
    "/tally",
    "Tally-to-WhatsApp automation rule saved. New bills matching this rule will automatically go out."
  );
}

export async function toggleTallyAutomationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const ruleId = String(formData.get("ruleId") || "");
  const active = formData.get("active") === "true";
  const res = await toggleTallyAutomationRule(session.ctx, { ruleId, active });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", active ? "Automation rule turned on." : "Automation rule paused.");
}

export async function deleteTallyAutomationAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally");
  const ruleId = String(formData.get("ruleId") || "");
  const res = await deleteTallyAutomationRule(session.ctx, { ruleId });
  if (!res.ok) return goWithError("/tally", res.error.message);
  return goWithNotice("/tally", "Automation rule removed.");
}

export async function sendTestTallyBillWebhookAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const partyName = String(formData.get("partyName") || "Test Customer").trim();
  const partyPhone = String(formData.get("partyPhone") || "").trim();
  const voucherType = String(formData.get("voucherType") || "Sales");
  const amountRupees = Number(formData.get("amountRupees") || 1500);
  const voucherNumber = `TEST-${String(Date.now()).slice(-4)}`;

  try {
    authorize(session.ctx, "tally:sync.manage");
    const out = await ingestTallyBillEventAndEnqueueAutomation({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      sourceLabel: "webhook",
      correlationId: session.ctx.correlationId,
      rawPayload: {
        companyName: session.workspace.name,
        voucherNumber,
        voucherType,
        partyName,
        partyPhone,
        amountRupees,
        voucherDate: new Date().toISOString().slice(0, 10),
      },
    });
    await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
    return goWithNotice(
      "/tally",
      out.queuedJobs > 0
        ? `Recorded test ${voucherType} #${voucherNumber} and queued ${out.queuedJobs} WhatsApp message(s) for delivery!`
        : `Recorded test ${voucherType} #${voucherNumber}. Add an active Automation Rule + customer phone number to auto-send on WhatsApp.`
    );
  } catch (err) {
    return goWithError("/tally", friendlyMessage(err));
  }
}

export async function recordTallyVoucherAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");

  const lineItemName = String(formData.get("lineItemName") || "").trim();
  const lineItemQty = Number(formData.get("lineItemQty") || 0);
  const lineItemRate = Number(formData.get("lineItemRate") || 0);
  const lineItemUom = String(formData.get("lineItemUom") || "PCS").trim().toUpperCase();
  const lineItemGstPct = Number(formData.get("lineItemGstPct") || 18);
  const lineItemGodown = String(formData.get("lineItemGodown") || "Main Location").trim();

  const lineItems =
    lineItemName && Number.isFinite(lineItemQty) && lineItemQty > 0
      ? [
          {
            itemName: lineItemName,
            billedQty: lineItemQty,
            uom: lineItemUom || "PCS",
            rateRupees: Number.isFinite(lineItemRate) && lineItemRate >= 0 ? lineItemRate : 0,
            gstRatePct: Number.isFinite(lineItemGstPct) ? lineItemGstPct : 18,
            godownName: lineItemGodown || "Main Location",
          },
        ]
      : undefined;

  const explicitAmount = Number(formData.get("amountRupees") || 0);
  const computedLineTotal =
    lineItems && lineItems[0]
      ? Math.round(
          lineItems[0].billedQty *
            lineItems[0].rateRupees *
            (1 + (lineItems[0].gstRatePct ?? 0) / 100) *
            100
        ) / 100
      : 0;
  const effectiveAmountRupees = explicitAmount > 0 ? explicitAmount : computedLineTotal;

  const res = await recordTallyVoucher(session.ctx, {
    voucherId: String(formData.get("voucherId") || "").trim() || undefined,
    preventOverwrite: formData.get("preventOverwrite") === "true",
    companyName: String(formData.get("companyName") || session.workspace.name),
    voucherNumber: String(formData.get("voucherNumber") || ""),
    voucherType: String(formData.get("voucherType") || "Sales") as
      | "Sales"
      | "Receipt"
      | "CreditNote"
      | "Purchase",
    partyName: String(formData.get("partyName") || ""),
    partyPhoneE164: String(formData.get("partyPhoneE164") || "") || undefined,
    amountRupees: effectiveAmountRupees,
    paidAmountRupees: Number(formData.get("paidAmountRupees") || 0),
    voucherDateIso: String(
      formData.get("voucherDateIso") || new Date().toISOString().slice(0, 10)
    ),
    dueDateIso: String(formData.get("dueDateIso") || "") || undefined,
    lineItems,
  });
  if (!res.ok) return goWithError("/tally?tab=import", res.error.message);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
  const stockSuffix = lineItems ? ` Stock updated for '${lineItems[0]!.itemName}'.` : "";
  return goWithNotice(
    "/tally",
    res.data.queuedJobs && res.data.queuedJobs > 0
      ? `Bill saved${stockSuffix} ${res.data.queuedJobs} automated WhatsApp message(s) queued for delivery.`
      : `Bill saved to your Tally register.${stockSuffix}`
  );
}

export async function importTallyFileAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally");
  const format = String(formData.get("format") || "tally_xml") as "tally_xml" | "csv";
  const companyName = String(formData.get("companyName") || session.workspace.name);
  let rawContent = String(formData.get("rawContent") || "").trim();

  const uploaded = formData.get("uploadFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    rawContent = await uploaded.text();
  }

  const res = await bulkImportTallyData(session.ctx, {
    companyName,
    format,
    rawContent,
  });
  if (!res.ok) return goWithError("/tally?tab=import", res.error.message);
  const stockNote =
    res.data.stockItemsUpserted && res.data.stockItemsUpserted > 0
      ? ` & ${res.data.stockItemsUpserted} stock item(s)`
      : "";
  return goWithNotice("/tally", `Imported ${res.data.importedCount} bills/receipts${stockNote}.`);
}

export async function upsertStockItemAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const res = await upsertTallyStockItem(session.ctx, {
    itemId: String(formData.get("itemId") || "").trim() || undefined,
    companyName: String(formData.get("companyName") || session.workspace.name),
    name: String(formData.get("name") || "").trim(),
    skuCode: String(formData.get("skuCode") || "").trim() || undefined,
    partNumber: String(formData.get("partNumber") || "").trim() || undefined,
    stockGroup: String(formData.get("stockGroup") || "Primary").trim() || "Primary",
    stockCategory: String(formData.get("stockCategory") || "").trim() || undefined,
    uom: String(formData.get("uom") || "PCS").trim().toUpperCase() || "PCS",
    hsnCode: String(formData.get("hsnCode") || "").trim() || undefined,
    gstRatePct: Number(formData.get("gstRatePct") || 18),
    sellingPriceRupees: Number(formData.get("sellingPriceRupees") || 0),
    costPriceRupees: Number(formData.get("costPriceRupees") || 0),
    openingQty: Number(formData.get("openingQty") || 0),
    reorderLevelQty: Number(formData.get("reorderLevelQty") || 0),
    minOrderQty: Number(formData.get("minOrderQty") || 0),
    godownName: String(formData.get("godownName") || "Main Location").trim() || "Main Location",
    batchName: String(formData.get("batchName") || "Primary Batch").trim() || "Primary Batch",
    expiryDateIso: String(formData.get("expiryDateIso") || "").trim() || undefined,
  });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  return goWithNotice("/inventory", `Saved stock item '${String(formData.get("name") || "").trim()}'.`);
}

export async function deleteStockItemAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const res = await deleteTallyStockItem(session.ctx, {
    itemId: String(formData.get("itemId") || ""),
  });
  if (!res.ok) return goWithError("/inventory", res.error.message);
  return goWithNotice("/inventory", `Removed stock item '${res.data.name}'.`);
}

export async function importTallyInventoryFileAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const format = String(formData.get("format") || "tally_xml") as "tally_xml" | "csv";
  const companyName = String(formData.get("companyName") || session.workspace.name);
  let rawContent = String(formData.get("rawContent") || "").trim();

  const uploaded = formData.get("uploadFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    rawContent = await uploaded.text();
  }

  const res = await bulkImportTallyInventory(session.ctx, {
    companyName,
    format,
    rawContent,
  });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  return goWithNotice(
    "/inventory",
    `Imported ${res.data.stockItemsUpserted} stock item(s)${res.data.godownsUpserted ? ` & ${res.data.godownsUpserted} godown(s)` : ""} into your live inventory register.`
  );
}

export async function syncLocalTallyInventoryAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/inventory");
  const port = Number(formData.get("port") || 9000);
  const res = await fetchAndSyncLocalTallyPort9000(session.ctx, { port });
  if (!res.ok) return goWithError("/inventory?tab=manage", res.error.message);
  await flushInlineTallyOutboxIfNoRedis(session.workspace.id);
  return goWithNotice(
    "/inventory",
    `Synced ${res.data.upserted} voucher(s) & stock masters from Tally Prime Port ${port}.`
  );
}

export async function sendBillWhatsAppAction(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/tally");
  const returnPath = rawReturn.startsWith("/tally") ? rawReturn : "/tally";
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", returnPath);
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", returnPath);
  const sendKind = String(formData.get("sendKind") || "reminder") === "invoice" ? "invoice" : "reminder";
  const res = await sendTallyBillOnWhatsApp(session.ctx, {
    voucherId: String(formData.get("voucherId") || ""),
    sendKind,
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  const pdfSuffix = res.data.attachedTallyPdf ? " with exact native Tally PDF attached" : "";
  return goWithNotice(
    returnPath,
    res.data.deduplicated
      ? sendKind === "invoice"
        ? "This sales bill was already sent recently — duplicate message skipped."
        : "This reminder was already sent recently — duplicate message skipped."
      : sendKind === "invoice"
        ? `Sales bill sent on WhatsApp${pdfSuffix}.`
        : `Payment reminder sent on WhatsApp${pdfSuffix}.`
  );
}

export async function saveReminderRuleAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const res = await saveTallyReminderRule(session.ctx, {
    name: String(formData.get("name") || ""),
    triggerDaysOffset: Number(formData.get("triggerDaysOffset") || 3),
    templateName: String(formData.get("templateName") || "tally_overdue_bill_reminder"),
    maxRemindersPerBill: Number(formData.get("maxRemindersPerBill") || 3),
  });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);
  return goWithNotice("/tally?tab=rules", "Saved overdue payment reminder schedule.");
}

export async function deleteReminderRuleAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const res = await deleteTallyReminderRule(session.ctx, {
    ruleId: String(formData.get("ruleId") || ""),
  });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);
  return goWithNotice("/tally?tab=rules", "Removed overdue payment reminder schedule.");
}

export async function runDueTallyRemindersAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.sync", "/tally?tab=rules");
  await enforceFeaturePaidEntitlement(session.workspace.id, "tally.invoicing", "/tally?tab=rules");
  const ignoreQuietHours = formData.get("ignoreQuietHours") === "true";
  const res = await runDueTallyReminders(session.ctx, { ignoreQuietHours });
  if (!res.ok) return goWithError("/tally?tab=rules", res.error.message);

  if (res.data.skippedQuietHours && res.data.sentCount === 0) {
    return goWithNotice(
      "/tally?tab=rules",
      "Outside daytime hours (9 AM – 8 PM IST) — reminders are paused overnight unless sent manually."
    );
  }
  return goWithNotice(
    "/tally?tab=rules",
    res.data.sentCount > 0
      ? `Sent ${res.data.sentCount} due-date payment reminder(s) across ${res.data.evaluatedCount} open bill(s).`
      : `Checked ${res.data.evaluatedCount} open bill(s) — no new reminders are due right now.`
  );
}

// ==========================================
// WhatsApp Business API Template Manager & Broadcasts
// ==========================================

export async function createTemplateAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");

  const variableMappings: Record<string, string> = {};
  for (let i = 1; i <= 6; i++) {
    const val = String(formData.get(`varMap_${i}`) || "").trim();
    if (val) variableMappings[String(i)] = val;
  }

  const buttons: WhatsAppTemplateButton[] = [];
  const btn1Text = String(formData.get("button1Text") || "").trim();
  const btn1Type = String(formData.get("button1Type") || "QUICK_REPLY") as WhatsAppTemplateButton["type"];
  const btn1Target = String(formData.get("button1Target") || "").trim();
  if (btn1Text) {
    buttons.push({
      type: btn1Type,
      text: btn1Text,
      ...(btn1Type === "URL" ? { url: btn1Target } : {}),
      ...(btn1Type === "PHONE_NUMBER" ? { phoneNumber: btn1Target } : {}),
    });
  }

  const res = await createWhatsAppTemplate(session.ctx, {
    name: String(formData.get("name") || "").trim().toLowerCase(),
    category: String(formData.get("category") || "utility") as "utility" | "marketing" | "authentication",
    language: String(formData.get("language") || "en_IN"),
    headerType: String(formData.get("headerType") || "NONE") as "NONE" | "TEXT" | "DOCUMENT" | "IMAGE",
    headerText: String(formData.get("headerText") || "").trim() || undefined,
    bodyText: String(formData.get("bodyText") || ""),
    footerText: String(formData.get("footerText") || "").trim() || undefined,
    variableMappings,
    buttons,
    submitToMeta: formData.get("submitToMeta") !== "off",
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    `Template saved (${res.data.approvalStatus === "APPROVED" ? "Ready to send" : "Submitted for WhatsApp approval"}).`
  );
}

export async function updateTemplateAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await updateWhatsAppTemplate(session.ctx, {
    templateId: String(formData.get("templateId") || ""),
    headerType: String(formData.get("headerType") || "NONE") as "NONE" | "TEXT" | "DOCUMENT" | "IMAGE",
    headerText: String(formData.get("headerText") || ""),
    bodyText: String(formData.get("bodyText") || ""),
    footerText: String(formData.get("footerText") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "WhatsApp template updated.");
}

export async function deleteTemplateAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await deleteWhatsAppTemplate(session.ctx, {
    templateId: String(formData.get("templateId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "WhatsApp template deleted.");
}

export async function installStarterTemplatesAction() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await installStarterTallyTemplates(session.ctx, {});
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    res.data.installed > 0
      ? `Added ${res.data.installed} ready-to-use Tally bill, receipt & reminder templates.`
      : "All starter Tally templates are already in your template library."
  );
}

export async function syncMetaTemplatesAction() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await syncWhatsAppTemplatesWithMeta(session.ctx, {});
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", `Synced ${res.data.syncedCount} templates from your WhatsApp Business Account.`);
}

export async function launchBroadcastAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.broadcast", "/whatsapp");
  const res = await launchWhatsAppBroadcast(session.ctx, {
    name: String(formData.get("name") || ""),
    templateId: String(formData.get("templateId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice(
    "/whatsapp",
    `Broadcast sent to ${res.data.recipientCount} opted-in contacts (${formatInr(res.data.costPaise, { showDecimals: true })}).`
  );
}

export async function addSuppressionAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await addWhatsAppUnsubscribedNumber(session.ctx, {
    phoneE164: String(formData.get("phoneE164") || ""),
    reason: String(formData.get("reason") || "Customer requested STOP"),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "Phone number added to opt-out list.");
}

export async function removeSuppressionAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "whatsapp.messaging", "/whatsapp");
  const res = await removeWhatsAppUnsubscribedNumber(session.ctx, {
    suppressionId: String(formData.get("suppressionId") || ""),
  });
  if (!res.ok) return goWithError("/whatsapp", res.error.message);
  return goWithNotice("/whatsapp", "Number removed from opt-out list after customer re-consent.");
}

// ==========================================
// Campaigns, Social Posts, Pixel & Reviews
// ==========================================

export async function createCampaignAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  const res = await createAdCampaign(session.ctx, {
    name: String(formData.get("name") || ""),
    channel: String(formData.get("channel") || "meta_ads") as "meta_ads" | "instagram" | "facebook",
    objective: String(formData.get("objective") || "messages") as "messages" | "website_sales" | "lead_generation" | "awareness",
    dailyBudgetRupees: Number(formData.get("dailyBudgetRupees") || 0),
    startDateIso: String(formData.get("startDateIso") || new Date().toISOString().slice(0, 10)),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Ad campaign created.");
}

export async function toggleCampaignAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  const res = await toggleCampaignStatus(session.ctx, {
    campaignId: String(formData.get("campaignId") || ""),
    status: String(formData.get("status") || "paused") as "active" | "paused" | "completed",
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Updated campaign status.");
}

export async function recordCampaignSnapshotAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "meta.ads", "/campaigns");
  const res = await recordCampaignDailySnapshot(session.ctx, {
    campaignId: String(formData.get("campaignId") || ""),
    dayKey: String(formData.get("dayKey") || new Date().toISOString().slice(0, 10)),
    spendRupees: Number(formData.get("spendRupees") || 0),
    revenueRupees: Number(formData.get("revenueRupees") || 0),
    impressions: Number(formData.get("impressions") || 0),
    clicks: Number(formData.get("clicks") || 0),
    conversions: Number(formData.get("conversions") || 0),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Daily campaign results saved.");
}

export async function schedulePostAction(formData: FormData) {
  const session = await requireWebSession();
  const channel = String(formData.get("channel") || "instagram_feed") as
    | "instagram_feed"
    | "instagram_reel"
    | "facebook_page"
    | "google_post";
  const requiredKey =
    channel === "facebook_page"
      ? "meta.pages"
      : channel === "google_post"
        ? "google.reviews"
        : "meta.instagram";
  await enforceFeaturePaidEntitlement(session.workspace.id, requiredKey, "/campaigns");
  const res = await scheduleSocialPost(session.ctx, {
    channel,
    caption: String(formData.get("caption") || ""),
    scheduledForIso: String(formData.get("scheduledForIso") || new Date().toISOString()),
    publishNow: formData.get("publishNow") === "on",
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Social post saved.");
}

export async function publishScheduledPostAction(formData: FormData) {
  const session = await requireWebSession();
  const res = await publishScheduledPost(session.ctx, {
    postId: String(formData.get("postId") || ""),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Scheduled post published immediately.");
}

export async function deleteScheduledPostAction(formData: FormData) {
  const session = await requireWebSession();
  const res = await deleteScheduledPost(session.ctx, {
    postId: String(formData.get("postId") || ""),
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice("/campaigns", "Scheduled post removed.");
}

export async function recordPixelEventAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "meta.pixel", "/campaigns");
  const res = await recordWebsiteSalesEvent(session.ctx, {
    eventId: String(formData.get("eventId") || ""),
    eventName: String(formData.get("eventName") || "Purchase") as "Purchase" | "Lead" | "AddToCart" | "ViewContent",
    valueRupees: Number(formData.get("valueRupees") || 0),
    customerIdentifier: String(formData.get("customerIdentifier") || "") || undefined,
  });
  if (!res.ok) return goWithError("/campaigns", res.error.message);
  return goWithNotice(
    "/campaigns",
    res.data.deduplicated
      ? "Order ID already recorded — duplicate entry skipped."
      : "Website order event recorded."
  );
}

export async function recordReviewAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", "/reviews");
  const res = await recordGoogleReview(session.ctx, {
    locationName: String(formData.get("locationName") || session.workspace.name),
    reviewerName: String(formData.get("reviewerName") || ""),
    rating: Number(formData.get("rating") || 5),
    comment: String(formData.get("comment") || ""),
  });
  if (!res.ok) return goWithError("/reviews", res.error.message);
  return goWithNotice("/reviews", "Google Business review saved.");
}

export async function replyReviewAction(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/reviews");
  const returnPath = rawReturn.startsWith("/reviews") ? rawReturn : "/reviews";
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", returnPath);
  const res = await replyToGoogleReview(session.ctx, {
    reviewId: String(formData.get("reviewId") || ""),
    replyText: String(formData.get("replyText") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, "Published owner reply to Google review.");
}

export async function generateReviewDraftAction(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/reviews");
  const returnPath = rawReturn.startsWith("/reviews") ? rawReturn : "/reviews";
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.reviews", returnPath);
  await enforceFeaturePaidEntitlement(session.workspace.id, "google.autoreply", returnPath);
  const res = await generateSmartReviewDraft(session.ctx, {
    reviewId: String(formData.get("reviewId") || ""),
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(
    returnPath,
    "Smart reply draft is ready below — review or edit the text and click Approve & Publish Reply."
  );
}

// ==========================================
// Connected Accounts
// ==========================================

export async function connectAccountAction(formData: FormData) {
  const session = await requireWebSession();
  const provider = String(formData.get("provider") || "whatsapp") as "meta" | "whatsapp" | "google" | "gdrive";
  const assetTypeRaw = String(formData.get("assetType") || "");
  const res = await linkExternalConnection(session.ctx, {
    provider,
    displayName: String(formData.get("displayName") || ""),
    externalAccountId: String(formData.get("externalAccountId") || ""),
    accessToken: String(formData.get("accessToken") || ""),
    scopesGranted: ["messages", "insights"],
    assetType: assetTypeRaw
      ? (assetTypeRaw as "fb_page" | "ig_account" | "ad_account" | "pixel" | "waba_phone" | "gbp_location")
      : undefined,
    assetName: String(formData.get("assetName") || "") || undefined,
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  return goWithNotice("/connections", "Account connected securely.");
}

export async function disconnectAccountAction(formData: FormData) {
  const session = await requireWebSession();
  const res = await disconnectExternalConnection(session.ctx, {
    connectionId: String(formData.get("connectionId") || ""),
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  return goWithNotice("/connections", "Account disconnected.");
}

export async function verifyConnectionHealthAction(formData: FormData) {
  const session = await requireWebSession();
  const res = await verifyExternalConnectionHealth(session.ctx, {
    connectionId: String(formData.get("connectionId") || ""),
  });
  if (!res.ok) return goWithError("/connections", res.error.message);
  const statusMsg =
    res.data.status === "healthy"
      ? `Connection "${res.data.displayName}" verified healthy.`
      : res.data.status === "expiring"
        ? `Connection "${res.data.displayName}" is expiring soon — please renew its token.`
        : `Connection "${res.data.displayName}" requires re-authentication.`;
  return goWithNotice("/connections", statusMsg);
}

// ==========================================
// Cloud Storage & Data Backups
// ==========================================

export async function switchStorageModeAction(formData: FormData) {
  const session = await requireWebSession();
  const targetMode = String(formData.get("targetMode") || "rsl_managed") as "rsl_managed" | "client_r2" | "client_s3";
  if (targetMode === "rsl_managed") {
    await enforceFeaturePaidEntitlement(session.workspace.id, "storage.managed", "/backups");
  }
  const res = await configureAndMigrateStorage(session.ctx, {
    targetMode,
    displayLabel: String(formData.get("displayLabel") || "") || undefined,
    r2AccountId: String(formData.get("r2AccountId") || "") || undefined,
    customEndpointUrl: String(formData.get("customEndpointUrl") || "") || undefined,
    bucketName: String(formData.get("bucketName") || "") || undefined,
    region: String(formData.get("region") || "auto"),
    accessKeyId: String(formData.get("accessKeyId") || "") || undefined,
    secretAccessKey: String(formData.get("secretAccessKey") || "") || undefined,
    migrateExistingFiles: formData.get("migrateExistingFiles") === "on",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);

  await sendStorageAndBackupNotification({
    workspaceId: session.workspace.id,
    businessName: session.workspace.name,
    recipientEmail: session.user.email,
    operationTitle: `Storage updated`,
    summaryLine: `Verified storage settings and copied ${res.data.migratedCount} files (${Math.round(res.data.bytesTransferred / 1024)} KB).`,
    checksumOrDetails: `Active Storage: ${res.data.mode}`,
  }).catch(() => undefined);

  return goWithNotice(
    "/backups",
    `Storage updated (${res.data.migratedCount} existing files moved smoothly).`
  );
}

export async function optimizeDatabaseAction() {
  const session = await requireWebSession();
  const res = await optimizeTenantDatabase(session.ctx, {});
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Workspace optimization completed.");
}

export async function createEncryptedBackupAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");
  const label = String(formData.get("destinationLabel") || "Cloud Storage");
  const res = await createSignedEncryptedBackup(session.ctx, { destinationLabel: label });
  if (!res.ok) return goWithError("/backups", res.error.message);

  const bundleBytes = Buffer.from(res.data.bundleBufferBase64, "base64");
  const fileName = `${res.data.backupId}.rslbackup`;

  try {
    await putWorkspaceObject({
      workspaceId: session.workspace.id,
      category: "backup_archive",
      fileName,
      mimeType: "application/json",
      bytes: bundleBytes,
      actorId: session.user.id,
    });
  } catch {
    // Local backup copy already saved
  }

  const driveSync = await uploadFileToWorkspaceGoogleDrive({
    workspaceId: session.workspace.id,
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
  }).catch((err) => ({
    uploaded: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));

  await sendStorageAndBackupNotification({
    workspaceId: session.workspace.id,
    businessName: session.workspace.name,
    recipientEmail: session.user.email,
    operationTitle: "Business Backup Created",
    summaryLine: driveSync.uploaded
      ? `Backup (${Math.max(1, Math.round(res.data.sizeBytes / 1024))} KB) is ready for download and synced automatically to Google Drive (${driveSync.driveEmail || "connected account"}).`
      : `Backup (${Math.max(1, Math.round(res.data.sizeBytes / 1024))} KB) is ready for download.`,
    checksumOrDetails: `Backup ID: ${res.data.backupId}`,
  }).catch(() => undefined);

  if (driveSync.uploaded) {
    return goWithNotice(
      "/backups",
      `Backup created, ready to download, and uploaded automatically to Google Drive (${driveSync.driveEmail || "connected account"} → ${driveSync.folderName || "RapidShift Labs Backups"}).`
    );
  }

  if ("error" in driveSync && driveSync.error) {
    return goWithError(
      "/backups",
      `Local backup saved, but Google Drive upload failed: ${driveSync.error}`
    );
  }

  return goWithNotice("/backups", "Backup created and ready to download.");
}

export async function syncBackupToGoogleDriveNowAction() {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");

  const res = await createSignedEncryptedBackup(session.ctx, {
    destinationLabel: "Google Drive Off-Site Vault",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);

  const bundleBytes = Buffer.from(res.data.bundleBufferBase64, "base64");
  const fileName = `${res.data.backupId}.rslbackup`;

  try {
    await putWorkspaceObject({
      workspaceId: session.workspace.id,
      category: "backup_archive",
      fileName,
      mimeType: "application/json",
      bytes: bundleBytes,
      actorId: session.user.id,
    });
  } catch {
    // Local archive already persisted
  }

  const driveSync = await uploadFileToWorkspaceGoogleDrive({
    workspaceId: session.workspace.id,
    fileName,
    mimeType: "application/json",
    bytes: bundleBytes,
  });

  if (!driveSync.uploaded) {
    return goWithError(
      "/backups",
      driveSync.error ||
        "Google Drive is not connected yet or requires re-authentication. Click 'Connect to Google Drive' first."
    );
  }

  return goWithNotice(
    "/backups",
    `Encrypted backup (${fileName}) created and uploaded directly to Google Drive (${driveSync.driveEmail || "connected account"} → folder '${driveSync.folderName || "RapidShift Labs Backups"}')!`
  );
}

export async function disconnectGoogleDriveFromBackupsAction(formData: FormData) {
  const session = await requireWebSession();
  const connectionId = String(formData.get("connectionId") || "").trim();
  if (!connectionId) {
    return goWithError("/backups", "Missing Google Drive connection ID.");
  }
  const res = await disconnectExternalConnection(session.ctx, { connectionId });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Google Drive automatic backup connection disconnected.");
}

export async function restoreBackupAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "backup.export", "/backups");
  const confirmPhrase = String(formData.get("confirmPhrase") || "").trim();
  if (confirmPhrase !== "RESTORE") {
    return goWithError("/backups", "Type RESTORE in uppercase to confirm replacing your workspace records.");
  }

  let bundleJsonText = String(formData.get("bundleJsonText") || "").trim();
  const uploaded = formData.get("backupFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    bundleJsonText = await uploaded.text();
  }

  const res = await restoreSignedEncryptedBackup(session.ctx, {
    bundleJsonText,
    confirmPhrase: "RESTORE",
  });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice(
    "/backups",
    "Backup restored. Your wallet balance, GST invoices, and opt-out list remained untouched."
  );
}

export async function importContactsCsvAction(formData: FormData) {
  const session = await requireWebSession();
  const rawReturn = String(formData.get("returnPath") || "/backups");
  const returnPath =
    rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/backups";
  let csvContent = String(formData.get("csvContent") || "").trim();
  const uploaded = formData.get("csvFile");
  if (uploaded instanceof File && uploaded.size > 0) {
    csvContent = await uploaded.text();
  }

  const res = await bulkImportContactsCsv(session.ctx, {
    csvContent,
    recordWhatsAppConsent: formData.get("recordWhatsAppConsent") === "on",
  });
  if (!res.ok) return goWithError(returnPath, res.error.message);
  return goWithNotice(returnPath, `Imported ${res.data.importedCount} customer contacts from CSV.`);
}

export async function requestCustomAdapterAction(formData: FormData) {
  const session = await requireWebSession();
  const res = await requestCustomBackupProvider(session.ctx, {
    providerName: String(formData.get("providerName") || ""),
    providerUrl: String(formData.get("providerUrl") || "") || undefined,
    urgency: String(formData.get("urgency") || "normal") as "normal" | "high" | "urgent",
    contactEmail: String(formData.get("contactEmail") || session.user.email),
  });
  if (!res.ok) return goWithError("/backups", res.error.message);
  return goWithNotice("/backups", "Your storage integration request has been sent to our team.");
}

// ==========================================
// Developer API Keys
// ==========================================

export async function issueApiKeyAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const scopes = formData.getAll("scopes").map(String).filter(Boolean);
  const res = await issueApiKey(session.ctx, {
    name: String(formData.get("name") || ""),
    mode: String(formData.get("mode") || "live") as "live" | "test",
    scopes:
      scopes.length > 0
        ? scopes
        : ["contacts:read", "vouchers:read", "vouchers:write", "whatsapp:write"],
    rateLimitPerMin: Number(formData.get("rateLimitPerMin") || 120),
    expiresInDays: Number(formData.get("expiresInDays") || 0),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    `/developers?createdKey=${encodeURIComponent(res.data.rawKey)}`,
    "Copy your new API key now — it is shown only once."
  );
}

export async function revokeApiKeyAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await revokeApiKey(session.ctx, {
    keyId: String(formData.get("keyId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "API key revoked immediately.");
}

export async function rotateApiKeyAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await rotateApiKey(session.ctx, {
    keyId: String(formData.get("keyId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    `/developers?createdKey=${encodeURIComponent(res.data.rawKey)}`,
    `API key "${res.data.name}" rotated — previous key revoked and new key shown below once.`
  );
}

export async function createOutboundWebhookAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const events = formData.getAll("events").map(String).filter(Boolean);
  const res = await createOutboundWebhookEndpoint(session.ctx, {
    name: String(formData.get("name") || ""),
    targetUrl: String(formData.get("targetUrl") || ""),
    events: events.length > 0 ? events : ["tally.bill.created", "whatsapp.message.received"],
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "Outbound webhook saved with signing secret.");
}

export async function deleteOutboundWebhookAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await deleteOutboundWebhookEndpoint(session.ctx, {
    endpointId: String(formData.get("endpointId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice("/developers", "Outbound webhook endpoint removed.");
}

export async function testOutboundWebhookAction(formData: FormData) {
  const session = await requireWebSession();
  await enforceFeaturePaidEntitlement(session.workspace.id, "api.access", "/developers");
  const res = await testOutboundWebhookEndpoint(session.ctx, {
    endpointId: String(formData.get("endpointId") || ""),
  });
  if (!res.ok) return goWithError("/developers", res.error.message);
  return goWithNotice(
    "/developers",
    `Test webhook dispatched (${res.data.deliveryStatus}). Signed with X-RSL-Signature.`
  );
}

// ==========================================
// Business Profile, Team & Help Feedback
// ==========================================

export async function updateBusinessProfileAction(formData: FormData) {
  const session = await requireWebSession();
  const returnPathRaw = String(formData.get("returnPath") || "/settings/business").trim();
  const returnPath = returnPathRaw.startsWith("/") ? returnPathRaw : "/settings/business";

  try {
    authorize(session.ctx, "workspace:manage");
    const out = updateWorkspaceBusinessSettings({
      workspaceId: session.workspace.id,
      name: String(formData.get("name") || session.workspace.name),
      industry: String(formData.get("industry") || ""),
      businessPhone: String(formData.get("businessPhone") || ""),
      billingEmail: String(formData.get("billingEmail") || ""),
      website: String(formData.get("website") || ""),
      addressLine: String(formData.get("addressLine") || ""),
      city: String(formData.get("city") || ""),
      pincode: String(formData.get("pincode") || ""),
      defaultTallyCompany: String(formData.get("defaultTallyCompany") || ""),
      stateCode: String(formData.get("stateCode") || "27"),
      gstin: String(formData.get("gstin") || ""),
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "workspace.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Updated business profile & GST state (${out.stateCode})`,
    });
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }

  return goWithNotice(returnPath, "Saved business profile and GST billing details.");
}

export async function inviteTeamMemberAction(formData: FormData) {
  const session = await requireWebSession();
  const email = String(formData.get("email") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const roleSlug = String(formData.get("roleSlug") || "agent");
  const initialPassword = String(formData.get("initialPassword") || "");

  let inviteLink: string | undefined;
  try {
    authorize(session.ctx, "members:invite");
    const out = addOrInviteTeamMember({
      workspaceId: session.workspace.id,
      email,
      name: name || undefined,
      roleSlug,
      invitedByUserId: session.user.id,
      initialPassword: initialPassword.length >= 8 ? initialPassword : undefined,
      actorRoleSlug: session.roleSlug,
    });

    if (out.rawInviteToken) {
      inviteLink = `${getEnv().APP_URL.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(out.rawInviteToken)}`;
    }

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "team.member.invited",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 5,
      summary: `Invited team member ${out.email} as ${roleSlug}`,
    });

    await sendTeamInviteNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      inviterName: session.user.name,
      recipientEmail: out.email,
      roleLabel: roleSlug,
      rawInviteToken: out.rawInviteToken,
    }).catch(() => undefined);
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }

  if (inviteLink) {
    return goWithNotice(
      `/settings/team?inviteLink=${encodeURIComponent(inviteLink)}`,
      `Invitation sent to ${email}. You can also copy the direct invite link below.`
    );
  }

  return goWithNotice("/settings/team", `Team member ${email} added and notified by email.`);
}

export async function resendInvitationAction(formData: FormData) {
  const session = await requireWebSession();
  const invitationId = String(formData.get("invitationId") || "");
  let inviteLink = "";
  let targetEmail = "";

  try {
    authorize(session.ctx, "members:invite");
    const out = regenerateWorkspaceInvitationToken({
      workspaceId: session.workspace.id,
      invitationId,
      actorRoleSlug: session.roleSlug,
    });
    targetEmail = out.email;
    inviteLink = `${getEnv().APP_URL.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(out.rawInviteToken)}`;

    await sendTeamInviteNotification({
      workspaceId: session.workspace.id,
      businessName: session.workspace.name,
      inviterName: session.user.name,
      recipientEmail: out.email,
      roleLabel: out.roleSlug,
      rawInviteToken: out.rawInviteToken,
    }).catch(() => undefined);
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }

  return goWithNotice(
    `/settings/team?inviteLink=${encodeURIComponent(inviteLink)}`,
    `Generated a fresh invitation link for ${targetEmail}.`
  );
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const returnBase = `/accept-invite?token=${encodeURIComponent(token)}`;

  let accepted: { rawSessionToken: string; workspaceName: string };
  try {
    accepted = acceptWorkspaceInvitation({
      rawToken: token,
      name: name || undefined,
      password,
    });
  } catch (err) {
    return goWithError(returnBase, friendlyMessage(err));
  }

  await setWebSessionCookie(accepted.rawSessionToken);
  return goWithNotice("/", `Welcome! You have joined ${accepted.workspaceName}.`);
}

export async function updateTeamMemberRoleAction(formData: FormData) {
  const session = await requireWebSession();
  const membershipId = String(formData.get("membershipId") || "");
  const roleSlug = String(formData.get("roleSlug") || "agent");
  try {
    authorizeAny(session.ctx, ["roles:manage", "members:invite"]);
    const out = updateWorkspaceMemberRole({
      workspaceId: session.workspace.id,
      membershipId,
      roleSlug,
      actorRoleSlug: session.roleSlug,
    });
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "team.member.role_updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Updated role for ${out.email} to ${out.roleSlug}`,
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Updated team member role.");
}

export async function removeTeamMemberAction(formData: FormData) {
  const session = await requireWebSession();
  const membershipId = String(formData.get("membershipId") || "");
  try {
    authorize(session.ctx, "members:remove");
    const out = removeWorkspaceMember({
      workspaceId: session.workspace.id,
      membershipId,
      actorRoleSlug: session.roleSlug,
    });
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "team.member.removed",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Removed team member ${out.email} from workspace`,
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Team member access removed.");
}

export async function revokeInvitationAction(formData: FormData) {
  const session = await requireWebSession();
  const invitationId = String(formData.get("invitationId") || "");
  try {
    authorize(session.ctx, "members:remove");
    revokeWorkspaceInvitation({
      workspaceId: session.workspace.id,
      invitationId,
      actorRoleSlug: session.roleSlug,
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Pending invitation cancelled.");
}

export async function changePasswordAction(formData: FormData) {
  const session = await requireWebSession();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword !== confirmPassword) {
    return goWithError("/settings/team", "New password and confirmation password did not match.");
  }

  try {
    changeAuthenticatedUserPassword({
      userId: session.user.id,
      currentPassword,
      newPassword,
      preserveSessionId: session.sessionId,
    });
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.password.changed",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 6,
      summary: "Changed account login password",
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Your account password has been updated.");
}

export async function submitHelpFeedbackAction(formData: FormData) {
  const session = await requireWebSession();
  const slug = String(formData.get("slug") || "help-index");
  const helpful = formData.get("helpful") === "yes";
  const comment = String(formData.get("comment") || "");
  recordDocsFeedback({
    slug,
    helpful,
    comment,
    workspaceId: session.workspace.id,
  });
  return goWithNotice("/help", "Thank you — your feedback was saved.");
}

// ==========================================
// Phase 14: Sileo JSON Actions (Profile, Business, Connections & Unified Tokens)
// ==========================================

export async function saveUserProfileJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  emailChanged?: boolean;
}> {
  try {
    const session = await requireWebSession();
    const out = updateAuthenticatedUserProfile({
      userId: session.user.id,
      name: String(formData.get("name") || ""),
      phone: String(formData.get("phone") || ""),
      jobTitle: String(formData.get("jobTitle") || ""),
      email: String(formData.get("email") || session.user.email),
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.profile.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Updated personal profile (${out.name}${out.jobTitle ? ` • ${out.jobTitle}` : ""})`,
    });

    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");

    return {
      ok: true,
      emailChanged: out.emailChanged,
      message: out.emailChanged
        ? "Profile saved. Because your login email changed, please verify your new email address."
        : "Your personal profile details have been saved.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function changePasswordJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const currentPassword = String(formData.get("currentPassword") || "");
    const newPassword = String(formData.get("newPassword") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (newPassword !== confirmPassword) {
      return {
        ok: false,
        message: "New password and confirmation password did not match.",
      };
    }

    changeAuthenticatedUserPassword({
      userId: session.user.id,
      currentPassword,
      newPassword,
      preserveSessionId: session.sessionId,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.password.changed",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 6,
      summary: "Changed account login password",
    });

    revalidatePath("/settings/profile");
    return { ok: true, message: "Your account password has been updated securely." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function sendVerificationEmailJsonAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    await sendEmailVerificationCode({
      userId: session.user.id,
      email: session.user.email,
      recipientName: session.user.name,
      workspaceId: session.workspace.id,
    });
    revalidatePath("/settings/profile");
    return {
      ok: true,
      message: `Sent a 6-digit verification code to ${session.user.email}.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function verifyEmailCodeJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const code = String(formData.get("code") || "").trim();
    const verified = confirmEmailVerificationCode(session.user.email, code);
    if (!verified) {
      return {
        ok: false,
        message: "Invalid or expired 6-digit verification code. Request a fresh code and try again.",
      };
    }
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return { ok: true, message: "Your work email address is now verified." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeSessionJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const targetSessionId = String(formData.get("targetSessionId") || "").trim();
    const out = revokeUserSessionById({
      userId: session.user.id,
      targetSessionId,
      currentSessionId: session.sessionId,
    });
    if (!out.revoked) {
      return { ok: false, message: "That browser session was already signed out." };
    }

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.session.revoked",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 3,
      summary: "Signed out an active browser/device session",
    });

    revalidatePath("/settings/profile");
    return { ok: true, message: "Device session signed out immediately." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeOtherSessionsJsonAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const out = revokeAllOtherUserSessions({
      userId: session.user.id,
      currentSessionId: session.sessionId,
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.session.revoked",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Signed out ${out.revokedCount} other browser session(s)`,
    });

    revalidatePath("/settings/profile");
    return {
      ok: true,
      message:
        out.revokedCount > 0
          ? `Signed out ${out.revokedCount} other device session${out.revokedCount === 1 ? "" : "s"}.`
          : "No other active device sessions were signed in.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function saveBusinessSettingsJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "workspace:manage");

    const out = updateWorkspaceBusinessSettings({
      workspaceId: session.workspace.id,
      name: String(formData.get("name") || session.workspace.name),
      industry: String(formData.get("industry") || ""),
      businessPhone: String(formData.get("businessPhone") || ""),
      billingEmail: String(formData.get("billingEmail") || ""),
      website: String(formData.get("website") || ""),
      addressLine: String(formData.get("addressLine") || ""),
      city: String(formData.get("city") || ""),
      pincode: String(formData.get("pincode") || ""),
      defaultTallyCompany: String(formData.get("defaultTallyCompany") || ""),
      stateCode: String(formData.get("stateCode") || "27"),
      gstin: String(formData.get("gstin") || ""),
    });

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "workspace.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 4,
      summary: `Updated business settings (${out.name} • GST State ${out.stateCode})`,
    });

    revalidatePath("/settings/business");
    revalidatePath("/billing");
    revalidatePath("/", "layout");

    return {
      ok: true,
      message: `Saved business profile & GST tax settings for ${out.name}.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function createNewBusinessJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  workspaceId?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "workspace:manage");
    const businessName = String(formData.get("businessName") || "").trim();
    const industry = String(formData.get("industry") || "").trim();
    const stateCode = String(formData.get("stateCode") || "27").trim();
    const gstin = String(formData.get("gstin") || "").trim();

    if (businessName.length < 2) {
      return { ok: false, message: "Enter a valid business name (at least 2 characters)." };
    }

    const out = createAdditionalWorkspace({
      sessionId: session.sessionId,
      userId: session.user.id,
      businessName,
      industry,
      stateCode,
      gstin,
    });

    await enqueueWorkspaceSslProvisioning({
      workspaceId: out,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
    }).catch(() => undefined);

    revalidatePath("/", "layout");
    revalidatePath("/settings/business");
    revalidatePath("/settings/profile");

    return {
      ok: true,
      workspaceId: out,
      message: `Created and switched active workspace to '${businessName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function switchWorkspaceJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const targetWorkspaceId = String(formData.get("workspaceId") || "").trim();
    switchActiveWorkspace(session.sessionId, session.user.id, targetWorkspaceId);
    revalidatePath("/", "layout");
    return { ok: true, message: "Switched active business workspace." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

const CHANNEL_DEFAULTS: Record<
  ConnectionChannelKind,
  {
    provider: "whatsapp" | "meta" | "google" | "gdrive";
    assetType?:
      | "fb_page"
      | "ig_account"
      | "ad_account"
      | "pixel"
      | "waba_phone"
      | "gbp_location";
    scopes: string[];
  }
> = {
  whatsapp_cloud: {
    provider: "whatsapp",
    assetType: "waba_phone",
    scopes: [
      "whatsapp_business_messaging",
      "whatsapp_business_management",
      "business_management",
    ],
  },
  instagram_business: {
    provider: "meta",
    assetType: "ig_account",
    scopes: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "instagram_content_publish",
      "pages_show_list",
    ],
  },
  facebook_page: {
    provider: "meta",
    assetType: "fb_page",
    scopes: [
      "pages_show_list",
      "pages_messaging",
      "pages_manage_posts",
      "pages_read_engagement",
      "pages_manage_metadata",
    ],
  },
  meta_ads_pixel: {
    provider: "meta",
    assetType: "ad_account",
    scopes: ["ads_read", "ads_management", "business_management"],
  },
  google_business: {
    provider: "google",
    assetType: "gbp_location",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
  },
  google_drive: {
    provider: "gdrive",
    assetType: undefined,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  },
};

export async function connectChannelJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  connectionId?: string;
  liveStatus?: "healthy" | "expiring" | "needs_reauth";
  liveMessage?: string;
}> {
  try {
    const session = await requireWebSession();
    const channelKindRaw = String(formData.get("channelKind") || "whatsapp_cloud").trim();
    const channelKind = (
      channelKindRaw in CHANNEL_DEFAULTS ? channelKindRaw : "whatsapp_cloud"
    ) as ConnectionChannelKind;
    const cfg = CHANNEL_DEFAULTS[channelKind];

    const displayName = String(formData.get("displayName") || "").trim();
    const accessToken = String(formData.get("accessToken") || "").trim();
    const refreshToken = String(formData.get("refreshToken") || "").trim() || undefined;

    const wabaId = String(formData.get("wabaId") || "").trim() || undefined;
    const phoneNumberId = String(formData.get("phoneNumberId") || "").trim() || undefined;
    const displayPhone = String(formData.get("displayPhone") || "").trim() || undefined;
    const metaAppId = String(formData.get("metaAppId") || "").trim() || undefined;
    const pageId = String(formData.get("pageId") || "").trim() || undefined;
    const pageName = String(formData.get("pageName") || "").trim() || undefined;
    const igUserId = String(formData.get("igUserId") || "").trim() || undefined;
    const linkedPageId = String(formData.get("linkedPageId") || "").trim() || undefined;
    const igHandle = String(formData.get("igHandle") || "").trim() || undefined;
    const adAccountId = String(formData.get("adAccountId") || "").trim() || undefined;
    const pixelId = String(formData.get("pixelId") || "").trim() || undefined;
    const locationId = String(formData.get("locationId") || "").trim() || undefined;
    const accountId = String(formData.get("accountId") || "").trim() || undefined;
    const storeName = String(formData.get("storeName") || "").trim() || undefined;
    const folderId = String(formData.get("folderId") || "").trim() || undefined;
    const driveEmail = String(formData.get("driveEmail") || "").trim() || undefined;

    const externalAccountId =
      String(formData.get("externalAccountId") || "").trim() ||
      phoneNumberId ||
      wabaId ||
      igUserId ||
      pageId ||
      adAccountId ||
      pixelId ||
      locationId ||
      folderId ||
      "";

    const assetName =
      displayPhone || igHandle || pageName || storeName || driveEmail || displayName;

    const linked = await linkExternalConnection(session.ctx, {
      provider: cfg.provider,
      displayName,
      externalAccountId,
      accessToken,
      refreshToken,
      scopesGranted: cfg.scopes,
      assetType: cfg.assetType,
      assetName,
      metadata: {
        channelKind,
        wabaId,
        phoneNumberId,
        displayPhone,
        metaAppId,
        pageId,
        pageName,
        igUserId,
        linkedPageId,
        igHandle,
        adAccountId,
        pixelId,
        locationId,
        accountId,
        storeName,
        folderId,
        driveEmail,
      },
    });

    if (!linked.ok) {
      return { ok: false, message: linked.error.message };
    }

    let liveStatus: "healthy" | "expiring" | "needs_reauth" = "healthy";
    let liveMessage = "Encrypted in workspace vault.";

    if (String(formData.get("testLiveAfterSave") || "1") !== "0") {
      const check = await verifyExternalConnectionHealth(session.ctx, {
        connectionId: linked.data.connectionId,
        checkLiveProvider: true,
      });
      if (check.ok) {
        liveStatus = check.data.status;
        liveMessage = check.data.liveMessage;
      }
    }

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/", "layout");

    return {
      ok: true,
      connectionId: linked.data.connectionId,
      liveStatus,
      liveMessage,
      message:
        liveStatus === "needs_reauth"
          ? `Saved '${displayName}', but live provider check reported an issue: ${liveMessage}`
          : `Connected '${displayName}' (${liveMessage})`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function updateConnectionJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  maskedTokenHint?: string;
  liveStatus?: "healthy" | "expiring" | "needs_reauth";
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const displayName = String(formData.get("displayName") || "").trim() || undefined;
    const externalAccountId = String(formData.get("externalAccountId") || "").trim() || undefined;
    const accessToken = String(formData.get("accessToken") || "").trim() || undefined;
    const refreshToken = String(formData.get("refreshToken") || "").trim() || undefined;

    const metadataPatch: Record<string, string> = {};
    for (const key of [
      "wabaId",
      "phoneNumberId",
      "displayPhone",
      "metaAppId",
      "pageId",
      "pageName",
      "igUserId",
      "linkedPageId",
      "igHandle",
      "adAccountId",
      "pixelId",
      "locationId",
      "accountId",
      "storeName",
      "folderId",
      "driveEmail",
    ]) {
      const val = formData.get(key);
      if (val !== null && String(val).trim().length > 0) {
        metadataPatch[key] = String(val).trim();
      }
    }

    const updated = await updateExternalConnection(session.ctx, {
      connectionId,
      displayName,
      externalAccountId,
      accessToken,
      refreshToken,
      metadata: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
    });

    if (!updated.ok) {
      return { ok: false, message: updated.error.message };
    }

    let liveStatus: "healthy" | "expiring" | "needs_reauth" | undefined;
    let extraNote = "";
    if (accessToken && String(formData.get("testLiveAfterSave") || "1") !== "0") {
      const check = await verifyExternalConnectionHealth(session.ctx, {
        connectionId,
        checkLiveProvider: true,
      });
      if (check.ok) {
        liveStatus = check.data.status;
        extraNote = ` ${check.data.liveMessage}`;
      }
    }

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      maskedTokenHint: updated.data.maskedTokenHint,
      liveStatus,
      message: updated.data.rotatedToken
        ? `Access token rotated for '${updated.data.displayName}'.${extraNote}`
        : `Updated settings for '${updated.data.displayName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function verifyConnectionLiveJsonAction(formData: FormData): Promise<{
  ok: boolean;
  status?: "healthy" | "expiring" | "needs_reauth";
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const res = await verifyExternalConnectionHealth(session.ctx, {
      connectionId,
      checkLiveProvider: true,
    });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: res.data.status !== "needs_reauth",
      status: res.data.status,
      message: res.data.liveMessage,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function disconnectConnectionJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const connectionId = String(formData.get("connectionId") || "").trim();
    const res = await disconnectExternalConnection(session.ctx, { connectionId });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/", "layout");
    return { ok: true, message: "Channel disconnected and encrypted tokens purged." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function rotateTallyTokenJsonAction(): Promise<{
  ok: boolean;
  message: string;
  webhookToken?: string;
  webhookUrl?: string;
  cleanEndpointUrl?: string;
}> {
  try {
    const session = await requireWebSession();
    const res = await rotateTallyWebhookToken(session.ctx, {});
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }
    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    const cleanEndpointUrl = endpoints.tallyWebhookUrl;
    const webhookUrl = `${cleanEndpointUrl}?token=${res.data.webhookToken}`;

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    revalidatePath("/tally");

    return {
      ok: true,
      webhookToken: res.data.webhookToken,
      webhookUrl,
      cleanEndpointUrl,
      message:
        "Tally Prime webhook token rotated. Re-download the .tdl add-on or update X-Tally-Webhook-Token in your ERP.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function testTallyEndpointHandshakeJsonAction(): Promise<{
  ok: boolean;
  message: string;
  latencyMs?: number;
  status?: string;
  statusLabel?: string;
  pingsReceivedCount?: number;
  eventsReceivedCount?: number;
  publicEndpointUrl?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return {
        ok: false,
        message: "Tally Prime Live Sync plan is required before verifying live Tally endpoints.",
      };
    }

    const endpoint = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    if (!endpoint.enabled) {
      return {
        ok: false,
        status: "paused",
        statusLabel: "Paused",
        message: "Your Tally webhook endpoint is currently paused. Click 'Resume Webhook' first.",
      };
    }

    const hdrs = await headers();
    const publicEndpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    // Execute genuine HTTP round-trip against the local runtime when running locally, or public cloud URL in production
    const probeBase =
      publicEndpoints.localBaseUrl ??
      getEnv().APP_URL.replace(/\/$/, "") ??
      publicEndpoints.effectiveTallyBaseUrl;

    const startedAt = Date.now();
    const probeRes = await fetch(`${probeBase}/api/webhooks/tally?mode=ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tally-Webhook-Token": endpoint.webhookToken,
        "User-Agent": "RSL-Dashboard-HandshakeCheck/2.0",
      },
      body: JSON.stringify({
        mode: "ping",
        companyName: session.workspace.defaultTallyCompany || session.workspace.name,
      }),
      cache: "no-store",
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    const data = (await probeRes.json().catch(() => ({}))) as {
      ok?: boolean;
      pingsReceivedCount?: number;
      error?: string | { message?: string };
    };

    if (!probeRes.ok || !data.ok) {
      const errMsg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || `HTTP ${probeRes.status}`;
      return {
        ok: false,
        latencyMs,
        message: `Endpoint check failed (${errMsg}).`,
      };
    }

    const refreshed = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    const live = computeTallyWebhookLiveStatus(refreshed);

    revalidatePath("/tally");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      latencyMs,
      status: live.state,
      statusLabel: live.label,
      pingsReceivedCount: refreshed.pingsReceivedCount,
      eventsReceivedCount: refreshed.eventsReceivedCount,
      publicEndpointUrl: publicEndpoints.tallyWebhookUrl,
      message: `Handshake verified in ${latencyMs}ms! ${publicEndpoints.tallyWebhookUrl} authenticated cleanly without creating test bills.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function toggleTallyWebhookJsonAction(formData: FormData): Promise<{
  ok: boolean;
  enabled?: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const enabled = formData.get("enabled") === "true";
    const res = await toggleTallyWebhookEndpoint(session.ctx, { enabled });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      enabled,
      message: enabled
        ? "Incoming Tally Prime webhook endpoint resumed."
        : "Incoming Tally Prime webhook endpoint paused.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function generatePairingCodeJsonAction(): Promise<{
  ok: boolean;
  pairingCode?: string;
  expiresAt?: number;
  cloudServerUrl?: string;
  localServerUrl?: string | null;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return { ok: false, message: "Tally Prime Live Sync plan is required to pair an office PC." };
    }
    const res = await generateTallyPairingCode(session.ctx, {});
    if (!res.ok) return { ok: false, message: res.error.message };

    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });

    revalidatePath("/tally");
    return {
      ok: true,
      pairingCode: res.data.pairingCode,
      expiresAt: res.data.expiresAt,
      cloudServerUrl: endpoints.effectiveTallyBaseUrl,
      localServerUrl: endpoints.localBaseUrl,
      message: "Generated one-time 15-minute Windows PC pairing code.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeTallyDeviceJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const deviceId = String(formData.get("deviceId") || "").trim();
    const res = await revokeTallyAgentDevice(session.ctx, { deviceId });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    revalidatePath("/connections");
    return {
      ok: true,
      message: `Unpaired Windows PC '${res.data.deviceName}'.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function simulateSampleTallyBillJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  queuedJobs?: number;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return { ok: false, message: "Tally Prime Live Sync plan is required." };
    }

    const endpoint = getOrCreateTallyWebhookEndpoint(session.workspace.id);
    if (!endpoint.enabled) {
      return {
        ok: false,
        message: "Resume your Tally webhook endpoint before simulating an inbound voucher.",
      };
    }

    const partyName = String(formData.get("partyName") || "Sample Customer").trim();
    const partyPhone = String(formData.get("partyPhone") || "").trim();
    const voucherType = String(formData.get("voucherType") || "Sales");
    const amountRupees = Number(formData.get("amountRupees") || 1850);
    const voucherNumber = `SIM-${String(Date.now()).slice(-4)}`;

    const hdrs = await headers();
    const endpoints = resolveEndpointsFromHeaders(hdrs, {
      workspaceSlug: session.workspace.slug,
    });
    const probeBase =
      endpoints.localBaseUrl ??
      getEnv().APP_URL.replace(/\/$/, "") ??
      endpoints.effectiveTallyBaseUrl;

    const res = await fetch(`${probeBase}/api/webhooks/tally`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tally-Webhook-Token": endpoint.webhookToken,
        "User-Agent": "RSL-Dashboard-VoucherSimulator/2.0",
      },
      body: JSON.stringify({
        bill: {
          companyName: session.workspace.defaultTallyCompany || session.workspace.name,
          voucherNumber,
          voucherType,
          partyName,
          partyPhone,
          amountRupees,
          voucherDate: new Date().toISOString().slice(0, 10),
        },
      }),
      cache: "no-store",
    });

    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      queuedWhatsAppJobs?: number;
      error?: string | { message?: string };
    };

    if (!res.ok || !payload.ok) {
      const errMsg =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message || `HTTP ${res.status}`;
      return { ok: false, message: errMsg };
    }

    revalidatePath("/tally");
    const queued = payload.queuedWhatsAppJobs ?? 0;
    return {
      ok: true,
      queuedJobs: queued,
      message:
        queued > 0
          ? `Simulated ${voucherType} #${voucherNumber} via HTTP webhook and queued ${queued} WhatsApp message(s)!`
          : `Simulated ${voucherType} #${voucherNumber} via HTTP webhook. Add an active Automation Rule + customer phone to auto-queue WhatsApp.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function syncLocalTallyPort9000JsonAction(port = 9000): Promise<{
  ok: boolean;
  upserted?: number;
  queuedJobs?: number;
  companyName?: string | null;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
      return {
        ok: false,
        message: "Tally Prime Live Sync plan is required before fetching bills from Tally.",
      };
    }

    const res = await fetchAndSyncLocalTallyPort9000(session.ctx, { port });
    if (!res.ok) {
      return { ok: false, message: res.error.message };
    }

    await flushInlineTallyOutboxIfNoRedis(session.workspace.id);

    revalidatePath("/tally");
    revalidatePath("/");

    const { upserted, deletedCount, queuedJobs, companyName } = res.data;
    if (upserted === 0 && deletedCount === 0) {
      return {
        ok: true,
        upserted: 0,
        queuedJobs: 0,
        companyName,
        message: companyName
          ? `Connected to Tally Prime company '${companyName}' on Port ${port}, and all bills match your portal.`
          : `Connected to Tally Prime on Port ${port}, but no saved bills or receipts were found in the open company.`,
      };
    }

    return {
      ok: true,
      upserted,
      queuedJobs,
      companyName,
      message: `Fetched and synced ${upserted} bill(s)/receipt(s)${
        deletedCount > 0 ? ` and removed ${deletedCount} deleted bill(s)` : ""
      } from Tally Prime${companyName ? ` ('${companyName}')` : ""} on Port ${port}${
        queuedJobs > 0 ? ` (${queuedJobs} WhatsApp message(s) queued with native Tally PDF)` : ""
      }!`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function rotateMetaVerifyTokenJsonAction(): Promise<{
  ok: boolean;
  message: string;
  verifyToken?: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "connections:manage");
    const verifyToken = rotateWorkspaceWebhookVerifyToken(session.workspace.id);

    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "connections.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 3,
      summary: "Rotated Meta & WhatsApp inbound webhook verify token",
    });

    revalidatePath("/connections");
    revalidatePath("/settings/tokens");
    revalidatePath("/developers");

    return {
      ok: true,
      verifyToken,
      message:
        "Webhook Verify Token rotated. Paste the new token in Meta App Dashboard → Webhooks when re-verifying.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function issueApiKeyJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  rawKey?: string;
  keyName?: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to issue platform API keys.",
      };
    }
    const scopes = formData.getAll("scopes").map(String).filter(Boolean);
    const res = await issueApiKey(session.ctx, {
      name: String(formData.get("name") || ""),
      mode: String(formData.get("mode") || "live") as "live" | "test",
      scopes:
        scopes.length > 0
          ? scopes
          : ["contacts:read", "vouchers:read", "vouchers:write", "whatsapp:write"],
      rateLimitPerMin: Number(formData.get("rateLimitPerMin") || 120),
      expiresInDays: Number(formData.get("expiresInDays") || 0),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      rawKey: res.data.rawKey,
      keyName: String(formData.get("name") || "API Key"),
      message: "New API key created — copy it from the reveal box now (shown only once).",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function rotateApiKeyJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  rawKey?: string;
  keyName?: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to rotate API keys.",
      };
    }
    const res = await rotateApiKey(session.ctx, {
      keyId: String(formData.get("keyId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      rawKey: res.data.rawKey,
      keyName: res.data.name,
      message: `Rotated '${res.data.name}' — previous key revoked and replacement key revealed once.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeApiKeyJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to manage API keys.",
      };
    }
    const res = await revokeApiKey(session.ctx, {
      keyId: String(formData.get("keyId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "API key revoked immediately." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function createOutboundWebhookJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return {
        ok: false,
        message: "Developer REST API & Webhooks plan is required to configure outbound webhooks.",
      };
    }
    const events = formData.getAll("events").map(String).filter(Boolean);
    const res = await createOutboundWebhookEndpoint(session.ctx, {
      name: String(formData.get("name") || ""),
      targetUrl: String(formData.get("targetUrl") || ""),
      events: events.length > 0 ? events : ["tally.bill.created", "whatsapp.message.received"],
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "Outbound webhook endpoint saved with HMAC signing secret." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function testOutboundWebhookJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return { ok: false, message: "Developer REST API & Webhooks plan is required." };
    }
    const res = await testOutboundWebhookEndpoint(session.ctx, {
      endpointId: String(formData.get("endpointId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return {
      ok: true,
      message: `Test event dispatched (${res.data.deliveryStatus}) with X-RSL-Signature.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function deleteOutboundWebhookJsonAction(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    if (!hasActiveEntitlement(session.workspace.id, "api.access")) {
      return { ok: false, message: "Developer REST API & Webhooks plan is required." };
    }
    const res = await deleteOutboundWebhookEndpoint(session.ctx, {
      endpointId: String(formData.get("endpointId") || ""),
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/settings/tokens");
    revalidatePath("/developers");
    return { ok: true, message: "Outbound webhook endpoint removed." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function saveTallyCompanyRoutingJsonAction(formData: FormData): Promise<{
  ok: boolean;
  mode?: "all" | "selected";
  allowedCompanyNames?: string[];
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorize(session.ctx, "tally:sync.manage");
    const mode = String(formData.get("mode") || "all") === "selected" ? "selected" : "all";
    const rawNames = String(formData.get("allowedCompanyNames") || "");
    const checkboxNames = formData.getAll("selectedCompany").map(String);
    const parsedNames = Array.from(
      new Set(
        [
          ...checkboxNames,
          ...rawNames.split(/[\r\n,]+/),
        ]
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
      )
    );

    const res = await saveTallyCompanyRouting(session.ctx, {
      mode,
      allowedCompanyNames: parsedNames,
    });
    if (!res.ok) return { ok: false, message: res.error.message };

    revalidatePath("/tally");
    return {
      ok: true,
      mode: res.data.mode,
      allowedCompanyNames: res.data.allowedCompanyNames,
      message:
        res.data.mode === "selected" && res.data.allowedCompanyNames.length > 0
          ? `Restricted Tally sync to ${res.data.allowedCompanyNames.length} selected company(ies): ${res.data.allowedCompanyNames.join(", ")}.`
          : "Tally sync configured to accept vouchers from all open Tally companies.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function provisionWorkspaceSslJsonAction(): Promise<{
  ok: boolean;
  queuedJobs?: number;
  activeCount?: number;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    authorizeAny(session.ctx, ["workspace:manage", "tally:sync.manage", "apikeys:manage"]);

    const out = await enqueueWorkspaceSslProvisioning({
      workspaceId: session.workspace.id,
      workspaceSlug: session.workspace.slug,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      forceRenew: true,
      processInlineIfLocal: true,
    });

    const activeCount = out.certificates.filter((c) => c.status === "active").length;
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "workspace.updated",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 6,
      summary: `Queued & verified client SSL certificates for ${session.workspace.slug}.tally.${getEnv().PRIMARY_DOMAIN} and ${session.workspace.slug}.api.${getEnv().PRIMARY_DOMAIN}`,
    });

    revalidatePath("/tally");
    revalidatePath("/settings/business");
    revalidatePath("/developers");
    revalidatePath("/settings/tokens");

    return {
      ok: true,
      queuedJobs: out.queuedJobs,
      activeCount,
      message:
        activeCount >= 2
          ? `SSL certificates verified & active for ${out.certificates.map((c) => c.hostname).join(" and ")}.`
          : `Queued SSL certificate provisioning (${out.queuedJobs} subdomain job(s)) on ssl.provision queue.`,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}


