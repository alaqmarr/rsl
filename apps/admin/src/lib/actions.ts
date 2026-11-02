"use server";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  bootstrapFirstPlatformStaff,
  canStaffPerform,
  countPlatformStaff,
  createImpersonationSession,
  formatStaffRoleLabel,
  registerUserWithWorkspace,
  signInPlatformStaff,
  STAFF_PERMISSION_CATALOG,
  staffCreatePlatformMember,
  staffResetClientUserPassword,
  staffUpdateClientWorkspace,
  staffUpdatePlatformMember,
  staffVerifyClientUserEmail,
  type StaffPermission,
} from "@rsl/auth";
import {
  approveWalletRechargeRequest,
  BILLING_CYCLE_META,
  creditWallet,
  debitWallet,
  ensureServiceCatalogSeeded,
  getWalletBalancePaise,
  normalizeBillingCycle,
  type PlanBundleKey,
  rejectWalletRechargeRequest,
  savePlatformBillingSettings,
  sendManualBillingReminder,
  staffBulkUnlockBundle,
  staffCreateClientCustomBundle,
  staffCreateCustomInvoice,
  staffDeclinePlanRequest,
  staffGrantFreeAllToolsAccess,
  staffRecordPlanPaymentAndActivate,
  staffRevokeFreeAllToolsAccess,
  staffRevokeServiceEntitlement,
  staffSetClientBundleOverride,
  staffSetClientPlanOverride,
  staffToggleAutoBillingReminders,
  staffUpdateGlobalBundleCatalog,
  staffUpdateInvoiceStatus,
  staffUpdateServiceCatalogPrices,
  sweepAutomaticBillingReminders,
} from "@rsl/billing";
import { formatInr, getEnv, newEntityId, rupeesToPaise } from "@rsl/core";
import { controlSchema, platformLogsSchema, tenantDataSchema } from "@rsl/database";
import { sendBillingNotification } from "@rsl/notifications";
import {
  enqueueWorkspaceSslProvisioning,
  rehydrateFromSqlite,
  replayDeadLetterJob,
} from "@rsl/queue";
import { controlDb, platformLogsDb, tenantDataDb } from "@rsl/tenancy";
import {
  extractTemplateVariables,
  staffUpdateWhatsAppTemplateStatus,
  TALLY_TEMPLATE_VARIABLE_FIELDS,
} from "@rsl/whatsapp";
import { clearStaffCookie, requireStaffSession, setStaffCookie } from "./session";

function safeReturnTo(raw: FormDataEntryValue | null, fallback = "/"): string {
  const s = String(raw || "").trim();
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return fallback;
}

async function flashAdminRedirect(
  targetPath: string,
  kind: "notice" | "error",
  message: string
): Promise<never> {
  const payload = {
    id: `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: kind === "error" ? ("error" as const) : ("success" as const),
    message,
  };
  const encoded = `b64_${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
  const jar = await cookies();
  jar.set("rsl_admin_toast", encoded, {
    path: "/",
    maxAge: 30,
    httpOnly: false,
    sameSite: "lax",
  });
  redirect(targetPath);
}

async function requireStaffWithPermission(
  required: StaffPermission | StaffPermission[],
  returnTo = "/"
) {
  const { staff } = await requireStaffSession();
  const list = Array.isArray(required) ? required : [required];
  const allowed = list.some((perm) => canStaffPerform(staff.staffRole, perm));
  if (!allowed) {
    const label = STAFF_PERMISSION_CATALOG[list[0]!]?.label ?? list[0]!;
    return flashAdminRedirect(
      returnTo,
      "error",
      `Access restricted: your ${formatStaffRoleLabel(staff.staffRole)} role cannot perform "${label}".`
    );
  }
  return staff;
}

export async function staffBootstrapOrLoginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (countPlatformStaff() === 0) {
    return flashAdminRedirect(
      "/login",
      "error",
      "Platform is not initialized yet. Complete first-time Super Admin creation on the Setup portal first."
    );
  }

  try {
    const out = signInPlatformStaff({ email, password });
    await setStaffCookie(out.rawToken);
  } catch (err) {
    return flashAdminRedirect(
      "/login",
      "error",
      err instanceof Error ? err.message : "Login failed"
    );
  }
  redirect("/");
}

export async function completeInitialPlatformSetupAction(formData: FormData) {
  if (countPlatformStaff() > 0) {
    return flashAdminRedirect(
      "/setup",
      "error",
      "Initial Super Admin has already been created and bootstrap is permanently locked."
    );
  }

  const env = getEnv();
  let expectedToken = (env.SETUP_BOOTSTRAP_TOKEN || "").trim();
  if (!expectedToken) {
    try {
      const envFile = path.join(env.REPO_ROOT, ".env");
      if (fs.existsSync(envFile)) {
        const m = fs.readFileSync(envFile, "utf8").match(/^SETUP_BOOTSTRAP_TOKEN=(.+)$/m);
        if (m?.[1]) expectedToken = m[1].trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Ignore disk fallback error
    }
  }
  const providedToken = String(formData.get("setupKey") || "").trim();

  if (expectedToken.length > 0) {
    const a = Buffer.from(providedToken, "utf8");
    const b = Buffer.from(expectedToken, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return flashAdminRedirect(
        "/setup",
        "error",
        "Invalid Server Setup Key. Copy the SETUP_BOOTSTRAP_TOKEN printed by setup.sh (or in your server .env)."
      );
    }
  } else if (env.NODE_ENV === "production") {
    return flashAdminRedirect(
      "/setup",
      "error",
      "SETUP_BOOTSTRAP_TOKEN is not configured in your server .env. Run bash setup.sh on the server first."
    );
  }

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (name.length < 2) {
    return flashAdminRedirect("/setup", "error", "Please enter your full name.");
  }
  if (!email.includes("@")) {
    return flashAdminRedirect("/setup", "error", "Please enter a valid Super Admin email address.");
  }
  if (password.length < 8) {
    return flashAdminRedirect("/setup", "error", "Password must be at least 8 characters long.");
  }
  if (password !== confirmPassword) {
    return flashAdminRedirect("/setup", "error", "Password and Confirm Password do not match.");
  }

  try {
    const out = bootstrapFirstPlatformStaff({ name, email, password });
    await setStaffCookie(out.rawToken);
  } catch (err) {
    return flashAdminRedirect(
      "/setup",
      "error",
      err instanceof Error ? err.message : "Failed to initialize Super Admin account."
    );
  }

  return flashAdminRedirect(
    "/setup",
    "notice",
    "Primary Super Admin created and bootstrap locked! Your platform is ready."
  );
}

export async function staffLogoutAction() {
  await clearStaffCookie();
  redirect("/login");
}

export async function staffRecordPlanPaymentAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const requestId = String(formData.get("requestId") || "").trim() || undefined;
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const billingCycleRaw = String(formData.get("billingCycle") || "").trim();
  const billingCycle = billingCycleRaw ? normalizeBillingCycle(billingCycleRaw) : undefined;
  const amountRupees = Number(formData.get("amountRupees") || 0);
  const paymentMethodRaw = String(formData.get("paymentMethod") || "upi");
  const paymentMethod = (
    ["upi", "bank_transfer", "razorpay", "cash", "cheque"].includes(paymentMethodRaw)
      ? paymentMethodRaw
      : "upi"
  ) as "upi" | "bank_transfer" | "razorpay" | "cash" | "cheque";
  const paymentReference = String(formData.get("paymentReference") || "").trim();
  const staffNotes = String(formData.get("staffNotes") || "").trim() || undefined;
  const includePrerequisites = formData.get("includePrerequisites") !== "off";

  if (!workspaceId || !serviceKey) {
    return flashAdminRedirect(returnTo, "error", "Select a client and feature plan to unlock.");
  }
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return flashAdminRedirect(
      returnTo,
      "error",
      "Enter the verified payment amount in Rupees before unlocking."
    );
  }
  if (paymentReference.length < 3) {
    return flashAdminRedirect(
      returnTo,
      "error",
      "Payment UTR or receipt number is required to unlock a plan."
    );
  }

  let out: {
    entitlementId: string;
    paymentId: string;
    invoiceNumber: string;
    serviceName: string;
    activatedKeys: string[];
    billingCycle: "monthly" | "quarterly" | "yearly";
    expiresAt: number;
  };
  const amountPaidPaise = rupeesToPaise(amountRupees);

  try {
    out = staffRecordPlanPaymentAndActivate({
      requestId,
      workspaceId,
      serviceKey,
      billingCycle,
      amountPaidPaise,
      paymentMethod,
      paymentReference,
      staffId: staff.id,
      staffNotes,
      includePrerequisites,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Failed to record payment and unlock plan"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.payment_activated",
      targetTenantId: workspaceId,
      ticketReference: paymentReference,
      summary: `Recorded ${formatInr(amountPaidPaise)} (${BILLING_CYCLE_META[out.billingCycle].label}, ${paymentMethod.toUpperCase()} Ref: ${paymentReference}), unlocked [${out.activatedKeys.join(", ")}], issued GST Invoice ${out.invoiceNumber}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Payment verified — Unlocked '${out.serviceName}' (${BILLING_CYCLE_META[out.billingCycle].label}) & issued GST Invoice ${out.invoiceNumber}`
  );
}

export async function staffBulkUnlockBundleAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/clients");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const bundleKey = String(formData.get("bundleKey") || "tally_whatsapp_pack") as PlanBundleKey;
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const amountRupees = Number(formData.get("amountRupees") || 0);
  const paymentMethodRaw = String(formData.get("paymentMethod") || "upi");
  const paymentMethod = (
    ["upi", "bank_transfer", "razorpay", "cash", "cheque"].includes(paymentMethodRaw)
      ? paymentMethodRaw
      : "upi"
  ) as "upi" | "bank_transfer" | "razorpay" | "cash" | "cheque";
  const paymentReference = String(formData.get("paymentReference") || "").trim();

  if (!workspaceId) {
    return flashAdminRedirect(returnTo, "error", "Missing client account.");
  }

  let out: { invoiceNumber: string; bundleLabel: string; unlockedCount: number; expiresAt: number };
  try {
    out = staffBulkUnlockBundle({
      workspaceId,
      bundleKey,
      billingCycle,
      amountPaidPaise: rupeesToPaise(amountRupees),
      paymentMethod,
      paymentReference,
      staffId: staff.id,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not unlock bundle"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.bundle_activated",
      targetTenantId: workspaceId,
      ticketReference: paymentReference,
      summary: `Unlocked ${out.bundleLabel} (${out.unlockedCount} plans, ${BILLING_CYCLE_META[billingCycle].label}) for ${workspaceId} — GST Invoice ${out.invoiceNumber}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Bundle unlocked — ${out.bundleLabel} (${out.unlockedCount} tools, ${BILLING_CYCLE_META[billingCycle].label}) & GST Invoice ${out.invoiceNumber}`
  );
}

export async function staffDeclinePlanRequestAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const requestId = String(formData.get("requestId") || "").trim();
  const staffNotes = String(formData.get("staffNotes") || "").trim() || undefined;

  let out: { workspaceId: string; serviceKey: string };
  try {
    out = staffDeclinePlanRequest({
      requestId,
      staffId: staff.id,
      staffNotes,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not decline plan request"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", out.workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.request_declined",
      targetTenantId: out.workspaceId,
      summary: `Declined plan activation request for '${out.serviceKey}' (${requestId})`,
      correlationId: newEntityId("req", out.workspaceId),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", "Declined feature activation request.");
}

export async function staffRevokePlanAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const serviceKey = String(formData.get("serviceKey") || "").trim();

  if (!workspaceId || !serviceKey) {
    return flashAdminRedirect(returnTo, "error", "Missing client or plan key.");
  }

  staffRevokeServiceEntitlement({ workspaceId, serviceKey });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.revoked",
      targetTenantId: workspaceId,
      summary: `Locked plan '${serviceKey}' for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", `Locked '${serviceKey}' for this client.`);
}

export async function staffSetClientCustomPriceAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const mode = String(formData.get("mode") || "set");
  const rawMonthly = String(formData.get("customMonthlyRupees") || "").trim();
  const rawQuarterly = String(formData.get("customQuarterlyRupees") || "").trim();
  const rawYearly = String(formData.get("customYearlyRupees") || "").trim();

  const customMonthlyPaise =
    mode === "clear" || rawMonthly === ""
      ? null
      : rupeesToPaise(Math.max(0, Number(rawMonthly)));
  const customQuarterlyPaise =
    mode === "clear" || rawQuarterly === ""
      ? null
      : rupeesToPaise(Math.max(0, Number(rawQuarterly)));
  const customYearlyPaise =
    mode === "clear" || rawYearly === ""
      ? null
      : rupeesToPaise(Math.max(0, Number(rawYearly)));

  try {
    staffSetClientPlanOverride({
      workspaceId,
      serviceKey,
      customMonthlyPaise,
      customQuarterlyPaise,
      customYearlyPaise,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not update custom client rate"
    );
  }

  const isReset =
    customMonthlyPaise === null && customQuarterlyPaise === null && customYearlyPaise === null;

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "pricing.client_override",
      targetTenantId: workspaceId,
      summary: isReset
        ? `Reset '${serviceKey}' back to standard catalog rates for ${workspaceId}`
        : `Set custom client rates on '${serviceKey}' for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    isReset
      ? `Reset '${serviceKey}' to standard catalog rates.`
      : `Saved custom client rates for '${serviceKey}'.`
  );
}

export async function staffSetClientBundleOverrideAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const bundleKey = String(formData.get("bundleKey") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const mode = String(formData.get("mode") || "set");

  if (mode === "clear") {
    staffSetClientBundleOverride({
      workspaceId,
      bundleKey,
      monthlyOverridePaise: null,
      resetAll: true,
    });

    platformLogsDb()
      .insert(platformLogsSchema.staffActionLogs)
      .values({
        id: newEntityId("act", workspaceId),
        ts: Date.now(),
        staffId: staff.id,
        action: "pricing.client_bundle_reset",
        targetTenantId: workspaceId,
        summary: `Reset bundle '${bundleKey}' overrides back to catalog default for ${workspaceId}`,
        correlationId: newEntityId("req", workspaceId),
      })
      .run();

    return flashAdminRedirect(returnTo, "notice", `Reset bundle '${bundleKey}' to catalog default.`);
  }

  const customName = String(formData.get("customName") || "").trim() || null;
  const rawMonthly = String(formData.get("monthlyOverrideRupees") || "").trim();
  const rawQuarterly = String(formData.get("quarterlyOverrideRupees") || "").trim();
  const rawYearly = String(formData.get("yearlyOverrideRupees") || "").trim();
  const includedKeys = formData.getAll("includedKeys").map(String).filter(Boolean);

  try {
    staffSetClientBundleOverride({
      workspaceId,
      bundleKey,
      customName,
      includedKeys: includedKeys.length > 0 ? includedKeys : null,
      monthlyOverridePaise: rawMonthly === "" ? null : rupeesToPaise(Math.max(0, Number(rawMonthly))),
      quarterlyOverridePaise:
        rawQuarterly === "" ? null : rupeesToPaise(Math.max(0, Number(rawQuarterly))),
      yearlyOverridePaise: rawYearly === "" ? null : rupeesToPaise(Math.max(0, Number(rawYearly))),
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not customize client bundle"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "pricing.client_bundle_override",
      targetTenantId: workspaceId,
      summary: `Customized bundle '${bundleKey}' for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Saved custom client bundle configuration for '${bundleKey}'.`
  );
}

export async function staffCreateClientCustomBundleAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const name = String(formData.get("name") || "").trim();
  const tagline = String(formData.get("tagline") || "").trim() || undefined;
  const includedKeys = formData.getAll("includedKeys").map(String).filter(Boolean);
  const monthlyRupees = Number(formData.get("monthlyRupees") || 0);
  const rawQuarterly = String(formData.get("quarterlyRupees") || "").trim();
  const rawYearly = String(formData.get("yearlyRupees") || "").trim();

  let created: { bundleKey: string };
  try {
    created = staffCreateClientCustomBundle({
      workspaceId,
      name,
      tagline,
      includedKeys,
      monthlyAmountPaise: rupeesToPaise(monthlyRupees),
      quarterlyAmountPaise: rawQuarterly ? rupeesToPaise(Number(rawQuarterly)) : undefined,
      yearlyAmountPaise: rawYearly ? rupeesToPaise(Number(rawYearly)) : undefined,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not create custom client bundle"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "pricing.client_bundle_created",
      targetTenantId: workspaceId,
      summary: `Created bespoke client bundle '${name}' (${includedKeys.length} tools) for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Created bespoke bundle '${name}' (${includedKeys.length} tools, key: ${created.bundleKey}).`
  );
}

export async function staffGrantFreeAllToolsAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const durationDays = Number(formData.get("durationDays") || 14);
  const customUntilDate = String(formData.get("customUntilDate") || "").trim();
  const note = String(formData.get("note") || "").trim() || undefined;

  let customUntilMs: number | undefined;
  if (customUntilDate) {
    const parsed = Date.parse(`${customUntilDate}T23:59:59+05:30`);
    if (Number.isFinite(parsed)) {
      customUntilMs = parsed;
    }
  }

  let out: { untilMs: number; remainingDays: number };
  try {
    out = staffGrantFreeAllToolsAccess({
      workspaceId,
      durationDays,
      customUntilMs,
      note,
      staffId: staff.id,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not grant complimentary access"
    );
  }

  const untilLabel = new Date(out.untilMs).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.free_access_granted",
      targetTenantId: workspaceId,
      summary: `Granted complimentary full-platform access (all 15 tools) until ${untilLabel} (${out.remainingDays} days)`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Free access activated — All 15 tools unlocked until ${untilLabel} (${out.remainingDays} days).`
  );
}

export async function staffRevokeFreeAllToolsAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);

  staffRevokeFreeAllToolsAccess({ workspaceId, staffId: staff.id });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "plan.free_access_revoked",
      targetTenantId: workspaceId,
      summary: `Ended complimentary full-platform access for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    "Ended complimentary free access — standard paid plan locks now apply."
  );
}

export async function staffToggleAutoBillingRemindersAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const enabled = formData.get("enabled") === "true";
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);

  staffToggleAutoBillingReminders({ workspaceId, enabled });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "billing.auto_reminders_toggled",
      targetTenantId: workspaceId,
      summary: `${enabled ? "Enabled" : "Paused"} automatic renewal reminders for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    enabled
      ? "Automatic Monthly / Quarterly / Yearly renewal reminders enabled."
      : "Automatic renewal reminders paused for this client."
  );
}

export async function staffSendBillingReminderNowAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const billingCycle = normalizeBillingCycle(String(formData.get("billingCycle") || "monthly"));
  const rawCustomAmount = String(formData.get("customAmountRupees") || "").trim();
  const customLabel = String(formData.get("customLabel") || "").trim() || undefined;
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);

  let sent: { recipientEmail: string; amountWithGstPaise: number; summary: string };
  try {
    sent = await sendManualBillingReminder({
      workspaceId,
      staffId: staff.id,
      billingCycle,
      customAmountPaise: rawCustomAmount ? rupeesToPaise(Number(rawCustomAmount)) : undefined,
      customLabel,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not send billing reminder"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "billing.reminder_sent",
      targetTenantId: workspaceId,
      summary: `Sent ${BILLING_CYCLE_META[billingCycle].label} billing reminder (${formatInr(sent.amountWithGstPaise, { showDecimals: true })}) to ${sent.recipientEmail}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Reminder sent to ${sent.recipientEmail} (${formatInr(sent.amountWithGstPaise, { showDecimals: true })} incl. GST).`
  );
}

export async function staffRunBillingReminderSweepAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);

  const res = await sweepAutomaticBillingReminders();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "billing.reminder_sweep",
      summary: `Ran renewal reminder sweep across ${res.checkedWorkspaces} client(s) — dispatched ${res.sentCount} reminder(s)`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    res.sentCount > 0
      ? `Renewal sweep completed — Sent ${res.sentCount} upcoming/due reminder(s) across ${res.checkedWorkspaces} client(s).`
      : `Checked ${res.checkedWorkspaces} client account(s) — all renewals are up to date.`
  );
}

export async function staffApproveRechargeAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const paymentId = String(formData.get("paymentId") || "").trim();

  let out: { workspaceId: string; amountPaise: number; invoiceNumber?: string };
  try {
    out = approveWalletRechargeRequest({
      paymentId,
      staffId: staff.id,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not approve recharge"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", out.workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "wallet.recharge.approved",
      targetTenantId: out.workspaceId,
      summary: `Approved ${formatInr(out.amountPaise)} recharge (${paymentId}) -> Invoice ${out.invoiceNumber ?? ""}`,
      correlationId: newEntityId("req", out.workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Approved ${formatInr(out.amountPaise)} wallet recharge and issued GST Invoice ${out.invoiceNumber ?? ""}`
  );
}

export async function staffRejectRechargeAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const paymentId = String(formData.get("paymentId") || "").trim();

  let out: { workspaceId: string };
  try {
    out = rejectWalletRechargeRequest({ paymentId });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not decline recharge"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", out.workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "wallet.recharge.rejected",
      targetTenantId: out.workspaceId,
      summary: `Declined unverified recharge request ${paymentId}`,
      correlationId: newEntityId("req", out.workspaceId),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", "Declined wallet top-up request.");
}

export async function staffAdjustWalletAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const direction = String(formData.get("direction") || "credit");
  const rupees = Number(formData.get("amountRupees") || 0);
  const reason = String(formData.get("reason") || "").trim();

  if (reason.length < 5 || rupees <= 0) {
    return flashAdminRedirect(
      returnTo,
      "error",
      "Enter a positive Rupee amount and a reason (min 5 characters)."
    );
  }

  const paise = rupeesToPaise(rupees);
  const idemp = `staff_adj:${workspaceId}:${Date.now()}`;

  try {
    if (direction === "debit") {
      debitWallet({
        workspaceId,
        amountPaise: paise,
        description: `Staff adjustment: ${reason}`,
        idempotencyKey: idemp,
        actorId: staff.id,
        entryType: "staff_adjustment",
      });
    } else {
      creditWallet({
        workspaceId,
        amountPaise: paise,
        description: `Staff credit: ${reason}`,
        idempotencyKey: idemp,
        actorId: staff.id,
        entryType: "staff_adjustment",
      });
    }
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not apply wallet adjustment"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: `wallet.${direction}`,
      targetTenantId: workspaceId,
      ticketReference: reason,
      summary: `${direction.toUpperCase()} ${formatInr(paise)} for ${workspaceId}: ${reason}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Updated wallet (${direction === "debit" ? "-" : "+"}${formatInr(paise)}) for client.`
  );
}

export async function staffCreateNewClientAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:clients.manage", "/clients");
  const businessName = String(formData.get("businessName") || "").trim();
  const ownerName = String(formData.get("ownerName") || "").trim();
  const ownerEmail = String(formData.get("ownerEmail") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const stateCode = String(formData.get("stateCode") || "27").trim();
  const gstin = String(formData.get("gstin") || "").trim();

  if (!businessName || !ownerName || !ownerEmail || password.length < 6) {
    return flashAdminRedirect(
      "/clients",
      "error",
      "Provide business name, owner name, email, and password (min 6 chars)."
    );
  }

  let created: { workspaceId: string };
  try {
    created = registerUserWithWorkspace({
      name: ownerName,
      email: ownerEmail,
      password,
      businessName,
      industry,
      stateCode,
      gstin,
    });
  } catch (err) {
    return flashAdminRedirect(
      "/clients",
      "error",
      err instanceof Error ? err.message : "Could not create client account"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", created.workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "client.created",
      targetTenantId: created.workspaceId,
      summary: `Onboarded new client '${businessName}' (${ownerEmail})`,
      correlationId: newEntityId("req", created.workspaceId),
    })
    .run();

  return flashAdminRedirect(
    `/clients/${encodeURIComponent(created.workspaceId)}`,
    "notice",
    `Created client account '${businessName}'. You can now unlock plans, grant free access, or customize pricing below.`
  );
}

export async function staffUpdateClientProfileAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:clients.manage", returnTo);
  const name = String(formData.get("name") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const gstin = String(formData.get("gstin") || "").trim();
  const stateCode = String(formData.get("stateCode") || "27").trim();
  const billingStatusRaw = String(formData.get("billingStatus") || "active");
  const billingStatus = billingStatusRaw === "suspended" ? "suspended" : "active";

  try {
    staffUpdateClientWorkspace({
      workspaceId,
      name,
      industry,
      gstin,
      stateCode,
      billingStatus,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not update client details"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "client.updated",
      targetTenantId: workspaceId,
      summary: `Updated client '${name}' (Status: ${billingStatus}, State: ${stateCode}, GSTIN: ${gstin || "None"})`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", `Saved business profile & status (${billingStatus}).`);
}

export async function staffResetClientPasswordAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const userId = String(formData.get("userId") || "").trim();
  const newPassword = String(formData.get("newPassword") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:clients.manage", returnTo);

  let res: { email: string };
  try {
    res = staffResetClientUserPassword({ userId, newPassword });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Password reset failed"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId || "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "client.password_reset",
      targetTenantId: workspaceId || null,
      summary: `Reset password & verified email for client user ${res.email}`,
      correlationId: newEntityId("req", workspaceId || "rsl"),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", `Password updated for ${res.email}.`);
}

export async function staffVerifyClientEmailAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const userId = String(formData.get("userId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}`);
  const staff = await requireStaffWithPermission("staff:clients.manage", returnTo);

  let res: { email: string };
  try {
    res = staffVerifyClientUserEmail({ userId });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Verification failed"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId || "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "client.email_verified",
      targetTenantId: workspaceId || null,
      summary: `Marked email verified for ${res.email}`,
      correlationId: newEntityId("req", workspaceId || "rsl"),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", `Verified email address ${res.email}.`);
}

export async function staffCreateCustomInvoiceAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/invoices");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);
  const description = String(formData.get("description") || "").trim();
  const subtotalRupees = Number(formData.get("subtotalRupees") || 0);
  const status = String(formData.get("status") || "paid") === "issued" ? "issued" : "paid";
  const paymentMethod = String(formData.get("paymentMethod") || "bank_transfer");
  const paymentReference = String(formData.get("paymentReference") || "").trim();

  let inv: { invoiceNumber: string; totalPaise: number };
  try {
    inv = staffCreateCustomInvoice({
      workspaceId,
      description,
      subtotalPaise: rupeesToPaise(subtotalRupees),
      status,
      paymentMethod,
      paymentReference,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not issue invoice"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "invoice.issued",
      targetTenantId: workspaceId,
      ticketReference: paymentReference || inv.invoiceNumber,
      summary: `Issued GST Invoice ${inv.invoiceNumber} (${formatInr(inv.totalPaise)} incl. GST, status: ${status}) — ${description}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Issued GST Invoice ${inv.invoiceNumber} (${formatInr(inv.totalPaise)} incl. 18% GST).`
  );
}

export async function staffUpdateInvoiceStatusAction(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") || "").trim();
  const status = String(formData.get("status") || "paid") === "void" ? "void" : "paid";
  const paymentReference = String(formData.get("paymentReference") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/invoices");
  const staff = await requireStaffWithPermission("staff:billing.manage", returnTo);

  let inv: { invoiceNumber: string; workspaceId: string };
  try {
    inv = staffUpdateInvoiceStatus({
      invoiceId,
      status,
      paymentReference,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not update invoice"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", inv.workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: `invoice.${status}`,
      targetTenantId: inv.workspaceId,
      ticketReference: paymentReference || inv.invoiceNumber,
      summary: `Marked GST Invoice ${inv.invoiceNumber} as ${status.toUpperCase()}`,
      correlationId: newEntityId("req", inv.workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Updated Invoice ${inv.invoiceNumber} to ${status.toUpperCase()}.`
  );
}

export async function staffUpdatePriceAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/pricing");
  const staff = await requireStaffWithPermission("staff:pricing.manage", returnTo);
  ensureServiceCatalogSeeded();
  const serviceKey = String(formData.get("serviceKey") || "").trim();
  const monthlyRupees = Number(formData.get("monthlyRupees") || 0);
  const rawQuarterly = String(formData.get("quarterlyRupees") || "").trim();
  const rawYearly = String(formData.get("yearlyRupees") || "").trim();
  const unitRupees = Number(formData.get("unitRupees") || 0);

  staffUpdateServiceCatalogPrices({
    serviceKey,
    monthlyAmountPaise: rupeesToPaise(monthlyRupees),
    quarterlyAmountPaise: rawQuarterly === "" ? null : rupeesToPaise(Number(rawQuarterly)),
    yearlyAmountPaise: rawYearly === "" ? null : rupeesToPaise(Number(rawYearly)),
    unitAmountPaise: rupeesToPaise(unitRupees),
  });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "pricing.updated",
      summary: `Updated catalog prices for ${serviceKey} (₹${monthlyRupees}/mo)`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Updated Monthly / Quarterly / Yearly catalog pricing for '${serviceKey}'.`
  );
}

export async function staffUpdateGlobalBundleAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/pricing");
  const staff = await requireStaffWithPermission("staff:pricing.manage", returnTo);
  const bundleKey = String(formData.get("bundleKey") || "").trim();
  const name = String(formData.get("name") || "").trim() || undefined;
  const monthlyRupees = Number(formData.get("monthlyRupees") || 0);
  const quarterlyRupees = Number(formData.get("quarterlyRupees") || 0);
  const yearlyRupees = Number(formData.get("yearlyRupees") || 0);

  try {
    staffUpdateGlobalBundleCatalog({
      bundleKey,
      name,
      monthlyAmountPaise: rupeesToPaise(monthlyRupees),
      quarterlyAmountPaise: rupeesToPaise(quarterlyRupees),
      yearlyAmountPaise: rupeesToPaise(yearlyRupees),
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not update global bundle"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "pricing.bundle_updated",
      summary: `Updated global bundle '${bundleKey}' (₹${monthlyRupees}/mo, ₹${quarterlyRupees}/qtr, ₹${yearlyRupees}/yr)`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Updated global bundle pricing for '${bundleKey}'.`
  );
}

export async function staffSaveBillingSettingsAction(formData: FormData) {
  const returnTo = safeReturnTo(formData.get("returnTo"), "/pricing");
  const staff = await requireStaffWithPermission("staff:pricing.manage", returnTo);

  const rawMode = String(formData.get("upiQrMode") || "").trim();
  const upiQrMode =
    rawMode === "upi_id"
      ? "upi_id"
      : rawMode === "bank_account"
        ? "bank_account"
        : undefined;

  let updated;
  try {
    updated = savePlatformBillingSettings({
      upiQrMode,
      upiId: String(formData.get("upiId") || ""),
      payeeName: String(formData.get("payeeName") || ""),
      bankName: String(formData.get("bankName") || ""),
      accountNumber: String(formData.get("accountNumber") || ""),
      ifscCode: String(formData.get("ifscCode") || ""),
      gstin: String(formData.get("gstin") || ""),
      billingEmail: String(formData.get("billingEmail") || ""),
      supportPhone: String(formData.get("supportPhone") || ""),
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not save UPI & Bank receiving settings"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "billing.settings_updated",
      summary: `Updated Bank & UPI QR Receiving Details (Mode: ${updated.upiQrMode}, UPI: ${updated.upiId || "none"}, Bank: ${updated.bankName} A/C ${updated.accountNumber})`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    `Saved UPI & Bank receiving details (${updated.upiQrMode === "upi_id" ? `VPA: ${updated.upiId}` : `Bank A/C: ${updated.accountNumber}`}) — scan the ₹1 Test QR below to verify your Banking Name.`
  );
}

export async function staffReviewTemplateAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:templates.manage", "/templates");
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const templateId = String(formData.get("templateId") || "").trim();
  const approvalStatus = String(formData.get("approvalStatus") || "APPROVED") as
    | "APPROVED"
    | "PENDING"
    | "REJECTED"
    | "PAUSED";
  const rejectionReason = String(formData.get("rejectionReason") || "").trim() || undefined;

  staffUpdateWhatsAppTemplateStatus({
    workspaceId,
    templateId,
    approvalStatus,
    rejectionReason,
  });

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "whatsapp.template.reviewed",
      targetTenantId: workspaceId,
      summary: `Set WhatsApp template ${templateId} status to ${approvalStatus}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect("/templates", "notice", `Updated template status to ${approvalStatus}.`);
}

export async function staffCreateWorkspaceTemplateAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:templates.manage", "/templates");
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const name = String(formData.get("name") || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  const category = String(formData.get("category") || "utility");
  const headerType = String(formData.get("headerType") || "NONE");
  const headerText = String(formData.get("headerText") || "").trim() || null;
  const bodyText = String(formData.get("bodyText") || "").trim();
  const footerText = String(formData.get("footerText") || "").trim() || null;

  if (!workspaceId || name.length < 2 || bodyText.length < 5) {
    return flashAdminRedirect(
      "/templates",
      "error",
      "Provide client, valid template name, and body text."
    );
  }

  const vars = extractTemplateVariables([headerText, bodyText]);
  const mappings: Record<string, string> = {};
  const samples: Record<string, string> = {};
  vars.forEach((v, idx) => {
    const slot = v.replace(/[{}]/g, "");
    const preset = TALLY_TEMPLATE_VARIABLE_FIELDS[idx];
    mappings[slot] = preset?.key || "custom";
    samples[slot] = preset?.sample || `Value ${slot}`;
  });

  const now = Date.now();
  const id = newEntityId("tmpl", workspaceId, now);
  tenantDataDb({ workspaceId })
    .insert(tenantDataSchema.whatsappTemplates)
    .values({
      id,
      name,
      language: "en_IN",
      category,
      headerType,
      headerText,
      bodyText,
      footerText,
      variablesJson: JSON.stringify(vars),
      variableMappingsJson: JSON.stringify(mappings),
      sampleValuesJson: JSON.stringify(samples),
      approvalStatus: "APPROVED",
      qualityScore: "GREEN",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: now,
      staffId: staff.id,
      action: "whatsapp.template.created",
      targetTenantId: workspaceId,
      summary: `Added approved WhatsApp template '${name}' for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect("/templates", "notice", `Added approved template '${name}' for client.`);
}

export async function staffSeedStarterTemplatesAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/templates");
  const staff = await requireStaffWithPermission("staff:templates.manage", returnTo);

  if (!workspaceId) {
    return flashAdminRedirect(returnTo, "error", "Select a client account.");
  }

  const starterTemplates = [
    {
      name: "tally_sales_bill_created",
      category: "utility",
      headerType: "TEXT",
      headerText: "New Tax Invoice Generated",
      bodyText:
        "Namaste {{1}}, your invoice #{{2}} for {{3}} has been generated. Payment due date is {{4}}. Thank you for your business!",
      footerText: "Reply STOP to opt out",
    },
    {
      name: "tally_payment_receipt_thankyou",
      category: "utility",
      headerType: "TEXT",
      headerText: "Payment Received — Thank You",
      bodyText:
        "Namaste {{1}}, we have received your payment of {{3}} against receipt #{{2}}. Remaining balance: {{4}}.",
      footerText: "Reply STOP to opt out",
    },
    {
      name: "tally_overdue_payment_reminder",
      category: "utility",
      headerType: "TEXT",
      headerText: "Friendly Payment Reminder",
      bodyText:
        "Namaste {{1}}, a gentle reminder that invoice #{{2}} with balance {{3}} was due on {{4}}. Kindly share payment details once transferred.",
      footerText: "Reply STOP to opt out",
    },
  ];

  const db = tenantDataDb({ workspaceId });
  const existingNames = new Set(
    db
      .select({ name: tenantDataSchema.whatsappTemplates.name })
      .from(tenantDataSchema.whatsappTemplates)
      .all()
      .map((r) => r.name)
  );

  let added = 0;
  for (const st of starterTemplates) {
    if (existingNames.has(st.name)) continue;
    const now = Date.now() + added;
    const vars = extractTemplateVariables([st.headerText, st.bodyText]);
    const mappings: Record<string, string> = {
      "1": "partyName",
      "2": "voucherNumber",
      "3": "amountFormatted",
      "4": "dueDateFormatted",
    };
    const samples: Record<string, string> = {
      "1": "Shree Ganesh Traders",
      "2": "GST/26-27/0108",
      "3": "₹18,450",
      "4": "15 Nov 2026",
    };
    db.insert(tenantDataSchema.whatsappTemplates)
      .values({
        id: newEntityId("tmpl", workspaceId, now),
        name: st.name,
        language: "en_IN",
        category: st.category,
        headerType: st.headerType,
        headerText: st.headerText,
        bodyText: st.bodyText,
        footerText: st.footerText,
        variablesJson: JSON.stringify(vars),
        variableMappingsJson: JSON.stringify(mappings),
        sampleValuesJson: JSON.stringify(samples),
        approvalStatus: "APPROVED",
        qualityScore: "GREEN",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    added++;
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId),
      ts: Date.now(),
      staffId: staff.id,
      action: "whatsapp.template.seeded",
      targetTenantId: workspaceId,
      summary: `Seeded ${added} approved Tally WhatsApp starter templates for ${workspaceId}`,
      correlationId: newEntityId("req", workspaceId),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    added > 0
      ? `Added ${added} ready-to-use Tally WhatsApp templates (Approved).`
      : "All starter Tally templates are already present in this client's account."
  );
}

export async function staffCreateStaffMemberAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:team.manage", "/staff");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const roleRaw = String(formData.get("staffRole") || "support");
  const staffRole = (
    ["super_admin", "finance", "support"].includes(roleRaw) ? roleRaw : "support"
  ) as "super_admin" | "finance" | "support";

  let out: { email: string };
  try {
    out = staffCreatePlatformMember({ name, email, password, staffRole });
  } catch (err) {
    return flashAdminRedirect(
      "/staff",
      "error",
      err instanceof Error ? err.message : "Could not add staff member"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "staff.member_created",
      summary: `Added staff member ${out.email} (${staffRole})`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect(
    "/staff",
    "notice",
    `Added staff account ${out.email} (${staffRole}).`
  );
}

export async function staffUpdateStaffMemberAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:team.manage", "/staff");
  const targetStaffId = String(formData.get("targetStaffId") || "").trim();
  const roleRaw = String(formData.get("staffRole") || "").trim();
  const activeRaw = formData.get("active");
  const newPassword = String(formData.get("newPassword") || "").trim() || undefined;

  const staffRole = ["super_admin", "finance", "support"].includes(roleRaw)
    ? (roleRaw as "super_admin" | "finance" | "support")
    : undefined;
  const active =
    activeRaw === "true" ? true : activeRaw === "false" ? false : undefined;

  let out: { email: string };
  try {
    out = staffUpdatePlatformMember({
      targetStaffId,
      staffRole,
      active,
      newPassword,
    });
  } catch (err) {
    return flashAdminRedirect(
      "/staff",
      "error",
      err instanceof Error ? err.message : "Could not update staff account"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "staff.member_updated",
      summary: `Updated staff account ${out.email}`,
      correlationId: newEntityId("req", "rsl"),
    })
    .run();

  return flashAdminRedirect("/staff", "notice", `Updated staff account ${out.email}.`);
}

export async function staffSendClientEmailAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const recipientEmail = String(formData.get("recipientEmail") || "").trim();
  const headline = String(formData.get("headline") || "").trim();
  const bodyText = String(formData.get("bodyText") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/queues");
  const staff = await requireStaffWithPermission(
    ["staff:ops.manage", "staff:billing.manage"],
    returnTo
  );

  if (!recipientEmail || !headline || !bodyText) {
    return flashAdminRedirect(
      returnTo,
      "error",
      "Provide recipient email, subject headline, and message."
    );
  }

  const ws = workspaceId
    ? controlDb()
        .select()
        .from(controlSchema.workspaces)
        .where(eq(controlSchema.workspaces.id, workspaceId))
        .get()
    : null;
  const walletFormatted = workspaceId
    ? formatInr(getWalletBalancePaise(workspaceId), { showDecimals: true })
    : "₹0.00";

  try {
    await sendBillingNotification({
      workspaceId: workspaceId || "rsl",
      businessName: ws?.name || "RSL Marketing Client",
      recipientEmail,
      headline,
      bodyText,
      walletBalanceFormatted: walletFormatted,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not send email"
    );
  }

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", workspaceId || "rsl"),
      ts: Date.now(),
      staffId: staff.id,
      action: "email.sent",
      targetTenantId: workspaceId || null,
      summary: `Sent account notification '${headline}' to ${recipientEmail}`,
      correlationId: newEntityId("req", workspaceId || "rsl"),
    })
    .run();

  return flashAdminRedirect(returnTo, "notice", `Sent email '${headline}' to ${recipientEmail}.`);
}

export async function staffStartImpersonationAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), "/");
  const staff = await requireStaffWithPermission("staff:impersonate", returnTo);

  let tokenOut: { rawCustomerSessionToken: string };
  try {
    tokenOut = createImpersonationSession({
      staffId: staff.id,
      workspaceId,
      reason,
    });
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Could not start support session"
    );
  }

  const webUrl = `${getEnv().APP_URL}/api/auth/impersonate?token=${encodeURIComponent(tokenOut.rawCustomerSessionToken)}`;
  redirect(webUrl);
}

export async function staffReplayDeadLetterAction(formData: FormData) {
  await requireStaffWithPermission("staff:ops.manage", "/queues");
  const tenantId = String(formData.get("tenantId") || "");
  const outboxId = String(formData.get("outboxId") || "");
  await replayDeadLetterJob(tenantId, outboxId);
  return flashAdminRedirect("/queues", "notice", "Retried failed task.");
}

export async function staffRehydrateQueuesAction() {
  await requireStaffWithPermission("staff:ops.manage", "/queues");
  const res = await rehydrateFromSqlite();
  return flashAdminRedirect(
    "/queues",
    "notice",
    `Checked ${res.scannedTenants} client accounts and queued ${res.reEnqueued} pending tasks.`
  );
}

export async function staffUpdateProviderRequestAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:ops.manage", "/queues");
  const requestId = String(formData.get("requestId") || "").trim();
  const rawStatus = String(formData.get("status") || "reviewing").trim();
  const allowedStatuses = new Set(["submitted", "reviewing", "custom_quoted", "enabled"]);
  const nextStatus = allowedStatuses.has(rawStatus) ? rawStatus : "reviewing";

  if (!requestId) {
    return flashAdminRedirect("/queues", "error", "Missing storage request ID.");
  }

  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.providerRequests)
    .where(eq(controlSchema.providerRequests.id, requestId))
    .get();

  if (!existing) {
    return flashAdminRedirect("/queues", "error", "Storage connector request not found.");
  }

  db.update(controlSchema.providerRequests)
    .set({ status: nextStatus })
    .where(eq(controlSchema.providerRequests.id, requestId))
    .run();

  const now = Date.now();
  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", existing.providerName),
      ts: now,
      staffId: staff.id,
      action: "storage.provider_request.updated",
      targetTenantId: existing.workspaceId,
      summary: `Updated custom storage request '${existing.providerName}' to ${nextStatus}`,
      correlationId: `stf_${now}`,
    })
    .run();

  const statusLabel =
    nextStatus === "custom_quoted"
      ? "Quote Sent"
      : nextStatus === "enabled"
        ? "Enabled"
        : nextStatus === "reviewing"
          ? "In Review"
          : "Submitted";

  return flashAdminRedirect(
    "/queues",
    "notice",
    `Updated '${existing.providerName}' request status to ${statusLabel}.`
  );
}

export async function staffSaveFeatureFlagAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:flags.manage", "/runbooks");
  const rawKey = String(formData.get("key") || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const description = String(formData.get("description") || "").trim();
  const enabledGlobal =
    formData.get("enabledGlobal") === "on" || formData.get("enabledGlobal") === "true";

  if (!rawKey || !description) {
    return flashAdminRedirect(
      "/runbooks",
      "error",
      "Please enter both a toggle key and a plain-English description."
    );
  }

  const now = Date.now();
  controlDb()
    .insert(controlSchema.featureFlags)
    .values({
      key: rawKey,
      description,
      enabledGlobal,
      workspaceAllowlistJson: "[]",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.featureFlags.key,
      set: {
        description,
        enabledGlobal,
        updatedAt: now,
      },
    })
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", rawKey),
      ts: now,
      staffId: staff.id,
      action: "platform.feature_toggle.saved",
      summary: `Saved platform rollout toggle '${rawKey}' (${enabledGlobal ? "enabled" : "paused"})`,
      correlationId: `stf_${now}`,
    })
    .run();

  return flashAdminRedirect(
    "/runbooks",
    "notice",
    `Saved platform toggle '${rawKey}' (${enabledGlobal ? "Enabled" : "Paused"}).`
  );
}

export async function staffToggleFeatureFlagAction(formData: FormData) {
  const staff = await requireStaffWithPermission("staff:flags.manage", "/runbooks");
  const key = String(formData.get("key") || "").trim();
  const mode = String(formData.get("mode") || "enable").trim();

  if (!key) {
    return flashAdminRedirect("/runbooks", "error", "Missing toggle key.");
  }

  const now = Date.now();
  const db = controlDb();

  if (mode === "delete") {
    db.delete(controlSchema.featureFlags).where(eq(controlSchema.featureFlags.key, key)).run();
    platformLogsDb()
      .insert(platformLogsSchema.staffActionLogs)
      .values({
        id: newEntityId("act", key),
        ts: now,
        staffId: staff.id,
        action: "platform.feature_toggle.deleted",
        summary: `Removed platform rollout toggle '${key}'`,
        correlationId: `stf_${now}`,
      })
      .run();
    return flashAdminRedirect("/runbooks", "notice", `Removed platform toggle '${key}'.`);
  }

  const enabledGlobal = mode === "enable";
  db.update(controlSchema.featureFlags)
    .set({ enabledGlobal, updatedAt: now })
    .where(eq(controlSchema.featureFlags.key, key))
    .run();

  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", key),
      ts: now,
      staffId: staff.id,
      action: "platform.feature_toggle.updated",
      summary: `${enabledGlobal ? "Enabled" : "Paused"} platform rollout toggle '${key}'`,
      correlationId: `stf_${now}`,
    })
    .run();

  return flashAdminRedirect(
    "/runbooks",
    "notice",
    `Platform toggle '${key}' is now ${enabledGlobal ? "Enabled" : "Paused"}.`
  );
}

export async function staffProvisionClientSslAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") || "").trim();
  const returnTo = safeReturnTo(formData.get("returnTo"), `/clients/${workspaceId}?tab=profile`);
  const staff = await requireStaffWithPermission(
    ["staff:clients.manage", "staff:ops.manage"],
    returnTo
  );

  if (!workspaceId) {
    return flashAdminRedirect(returnTo, "error", "Missing client account ID.");
  }

  const ws = controlDb()
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  if (!ws) {
    return flashAdminRedirect(returnTo, "error", "Client account not found.");
  }

  let provisionedCount = 0;
  try {
    const res = await enqueueWorkspaceSslProvisioning({
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      actorType: "staff",
      actorId: staff.id,
      forceRenew: true,
      processInlineIfLocal: true,
    });
    provisionedCount = res.certificates.filter((c) => c.status === "active").length;
  } catch (err) {
    return flashAdminRedirect(
      returnTo,
      "error",
      err instanceof Error ? err.message : "Failed to verify client SSL certificates"
    );
  }

  const now = Date.now();
  platformLogsDb()
    .insert(platformLogsSchema.staffActionLogs)
    .values({
      id: newEntityId("act", ws.id),
      ts: now,
      staffId: staff.id,
      action: "ssl.client_provisioned",
      targetTenantId: ws.id,
      summary: `Verified & queued SSL certificates for ${ws.slug}.tally.rapidshiftlabs.in & ${ws.slug}.api.rapidshiftlabs.in`,
      correlationId: newEntityId("req", ws.id),
    })
    .run();

  return flashAdminRedirect(
    returnTo,
    "notice",
    provisionedCount >= 2
      ? `Verified active HTTPS certificates for ${ws.slug}.tally.rapidshiftlabs.in & ${ws.slug}.api.rapidshiftlabs.in.`
      : `Queued backend SSL certificate provisioning for ${ws.slug}.tally.rapidshiftlabs.in & ${ws.slug}.api.rapidshiftlabs.in.`
  );
}
