import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  acceptWorkspaceInvitation,
  addOrInviteTeamMember,
  assertUserEmailVerified,
  beginUserTotpEnrollment,
  changeAuthenticatedUserPasswordAsync,
  confirmUserTotpEnrollment,
  createAdditionalWorkspace,
  DEFAULT_STARTER_TRIAL_DAYS,
  disableUserTotpMfa,
  regenerateWorkspaceInvitationToken,
  registerUserWithWorkspaceAsync,
  removeWorkspaceMember,
  revokeAllOtherUserSessions,
  revokeUserSessionById,
  revokeWorkspaceInvitation,
  signInUserAsync,
  signOutSession,
  switchActiveWorkspace,
  updateAuthenticatedUserProfile,
  updateWorkspaceBusinessSettings,
  updateWorkspaceMemberRole,
  WEB_SESSION_COOKIE,
} from "@rsl/auth";
import { decryptEnvelope, getEnv, RslError } from "@rsl/core";
import { recordDocsFeedback } from "@rsl/docs";
import { appendActionLog } from "@rsl/logging";
import {
  completePasswordResetAsync,
  confirmEmailVerificationCode,
  requestPasswordResetEmail,
  sendEmailVerificationCode,
  sendTeamInviteNotification,
} from "@rsl/notifications";
import { enqueueWorkspaceSslProvisioning } from "@rsl/queue";
import { authorize, authorizeAny } from "@rsl/rbac";
import { verifyCloudflareTurnstileToken } from "@rsl/tenancy";
import {
  clearWebSessionCookie,
  requireWebSession,
  setWebSessionCookie,
  WEB_LOCALE_COOKIE,
} from "../session";
import {
  elapsedMs,
  friendlyMessage,
  goWithError,
  goWithNotice,
  setWebFlashToastCookie,
} from "./shared";

const PASSWORD_RESET_HANDOFF_COOKIE = "rsl_pw_reset";

export interface WebAuthFormState {
  error: string | null;
  requiresTotp?: boolean;
  fields: Record<string, string>;
}

export async function readPasswordResetHandoffEmail(): Promise<{
  email: string;
  hasHandoffToken: boolean;
}> {
  const jar = await cookies();
  const raw = jar.get(PASSWORD_RESET_HANDOFF_COOKIE)?.value;
  if (!raw) {
    return { email: "", hasHandoffToken: false };
  }
  try {
    const parsed = JSON.parse(decryptEnvelope(raw)) as {
      email?: string;
      token?: string;
      issuedAt?: number;
    };
    if (
      !parsed.email ||
      !parsed.token ||
      typeof parsed.issuedAt !== "number" ||
      Date.now() - parsed.issuedAt > 30 * 60_000
    ) {
      return { email: "", hasHandoffToken: false };
    }
    return { email: parsed.email, hasHandoffToken: true };
  } catch {
    return { email: "", hasHandoffToken: false };
  }
}

export async function registerFormStateActionImpl(
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
  const confirmPasswordRaw = formData.get("confirmPassword");
  if (confirmPasswordRaw !== null && String(confirmPasswordRaw) !== password) {
    return { error: "Password and confirmation password did not match.", fields };
  }

  const tsReg = await verifyCloudflareTurnstileToken({
    token: String(formData.get("cf-turnstile-response") || "").trim(),
    surface: "register",
  });
  if (!tsReg.allowed) {
    return { error: tsReg.error || "Please complete the security check.", fields };
  }

  let reg: { rawSessionToken: string; userId: string; workspaceId: string };
  try {
    reg = await registerUserWithWorkspaceAsync({
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
    `Welcome to RSL Marketing! Verify the 6-digit code sent to ${email} to unlock outbound messaging and billing. Your ${DEFAULT_STARTER_TRIAL_DAYS}-day starter trial for ${businessName} is active.`
  );
  redirect("/");
}

export async function loginFormStateActionImpl(
  _prevState: WebAuthFormState,
  formData: FormData
): Promise<WebAuthFormState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const totpCode = String(formData.get("totpCode") || "").trim() || undefined;
  const fields = { email };

  const tsLogin = await verifyCloudflareTurnstileToken({
    token: String(formData.get("cf-turnstile-response") || "").trim(),
    surface: "login",
  });
  if (!tsLogin.allowed) {
    return { error: tsLogin.error || "Please complete the security check.", fields };
  }

  let res: { rawSessionToken: string };
  try {
    res = await signInUserAsync({
      email,
      password,
      totpCode,
      requireTotpIfEnrolled: true,
    });
  } catch (err) {
    const requiresTotp = err instanceof RslError && err.code === "RSL-AUTH-1006";
    return { error: friendlyMessage(err), requiresTotp, fields };
  }

  await setWebSessionCookie(res.rawSessionToken);
  redirect("/");
}

export async function logoutActionImpl() {
  const jar = await cookies();
  const raw = jar.get(WEB_SESSION_COOKIE)?.value;
  if (raw) {
    signOutSession(raw);
  }
  await clearWebSessionCookie();
  redirect("/login");
}

export async function forgotPasswordActionImpl(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const tsFp = await verifyCloudflareTurnstileToken({
    token: String(formData.get("cf-turnstile-response") || "").trim(),
    surface: "public_form",
  });
  if (!tsFp.allowed) {
    return goWithError("/forgot-password", tsFp.error || "Please complete the security check.");
  }
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

export async function resetPasswordActionImpl(formData: FormData) {
  const jar = await cookies();
  let handoffEmail = "";
  let handoffToken = "";
  const sealed = jar.get(PASSWORD_RESET_HANDOFF_COOKIE)?.value;
  if (sealed) {
    try {
      const parsed = JSON.parse(decryptEnvelope(sealed)) as {
        email?: string;
        token?: string;
        issuedAt?: number;
      };
      if (
        parsed.email &&
        parsed.token &&
        typeof parsed.issuedAt === "number" &&
        Date.now() - parsed.issuedAt <= 30 * 60_000
      ) {
        handoffEmail = parsed.email;
        handoffToken = parsed.token;
      }
    } catch {
      // Ignore malformed cookie
    }
  }

  const email = (String(formData.get("email") || "").trim() || handoffEmail).toLowerCase();
  const token = String(formData.get("token") || "").trim() || handoffToken;
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPasswordRaw = formData.get("confirmPassword");
  const confirmPassword = confirmPasswordRaw !== null ? String(confirmPasswordRaw) : newPassword;

  if (newPassword.length < 8) {
    return goWithError("/reset-password", "New password must be at least 8 characters.");
  }
  if (newPassword !== confirmPassword) {
    return goWithError("/reset-password", "New password and confirmation password did not match.");
  }
  if (!email || !token) {
    return goWithError(
      "/reset-password",
      "Reset link expired or missing. Please request a fresh password reset link."
    );
  }

  try {
    await completePasswordResetAsync({ email, rawToken: token, newPassword });
  } catch (err) {
    return goWithError("/reset-password", friendlyMessage(err));
  }

  jar.delete(PASSWORD_RESET_HANDOFF_COOKIE);
  return goWithNotice("/login", "Your password has been updated. Please sign in.");
}

export async function verifyEmailCodeActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const code = String(formData.get("code") || "").trim();
  const returnPathRaw = String(formData.get("returnPath") || "/settings/team").trim();
  const returnPath =
    returnPathRaw.startsWith("/") && !returnPathRaw.startsWith("//")
      ? returnPathRaw
      : "/settings/team";

  const ok = confirmEmailVerificationCode(session.user.email, code);
  if (!ok) {
    return goWithError(returnPath, "Invalid or expired 6-digit verification code.");
  }
  revalidatePath("/", "layout");
  return goWithNotice(returnPath, "Email address verified.");
}

export async function resendVerificationEmailActionImpl(formData?: FormData) {
  const session = await requireWebSession();
  const returnPathRaw = formData ? String(formData.get("returnPath") || "").trim() : "";
  const returnPath =
    returnPathRaw.startsWith("/") && !returnPathRaw.startsWith("//")
      ? returnPathRaw
      : "/settings/team";

  await sendEmailVerificationCode({
    userId: session.user.id,
    email: session.user.email,
    recipientName: session.user.name,
    workspaceId: session.workspace.id,
  });
  return goWithNotice(returnPath, `Sent a 6-digit verification code to ${session.user.email}.`);
}

export async function setWebLocaleActionImpl(formData: FormData) {
  const locale = String(formData.get("locale") || "en") === "hi" ? "hi" : "en";
  const returnPathRaw = String(formData.get("returnPath") || "/").trim();
  const returnPath =
    returnPathRaw.startsWith("/") && !returnPathRaw.startsWith("//") ? returnPathRaw : "/";

  const jar = await cookies();
  jar.set(WEB_LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  revalidatePath("/", "layout");
  redirect(returnPath);
}

export async function switchWorkspaceActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const targetWorkspaceId = String(formData.get("workspaceId") || "").trim();
  try {
    switchActiveWorkspace(session.sessionId, session.user.id, targetWorkspaceId);
  } catch (err) {
    return goWithError("/", friendlyMessage(err));
  }
  return goWithNotice("/", "Switched active business.");
}

export async function createNewBusinessActionImpl(formData: FormData) {
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

export async function updateBusinessProfileActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const returnPathRaw = String(formData.get("returnPath") || "/settings/business").trim();
  const returnPath =
    returnPathRaw.startsWith("/") && !returnPathRaw.startsWith("//")
      ? returnPathRaw
      : "/settings/business";

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
      upiVpa: formData.has("upiVpa") ? String(formData.get("upiVpa") || "") : undefined,
      upiPayeeName: formData.has("upiPayeeName")
        ? String(formData.get("upiPayeeName") || "")
        : undefined,
      bankName: formData.has("bankName") ? String(formData.get("bankName") || "") : undefined,
      bankBranch: formData.has("bankBranch")
        ? String(formData.get("bankBranch") || "")
        : undefined,
      bankAccountNumber: formData.has("bankAccountNumber")
        ? String(formData.get("bankAccountNumber") || "")
        : undefined,
      bankIfsc: formData.has("bankIfsc") ? String(formData.get("bankIfsc") || "") : undefined,
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
      durationMs: elapsedMs(startedAt),
      summary: `Updated business profile & GST state (${out.stateCode})`,
    });
  } catch (err) {
    return goWithError(returnPath, friendlyMessage(err));
  }

  return goWithNotice(returnPath, "Saved business profile and GST billing details.");
}

const RoleSlugSchema = z.enum([
  "owner",
  "admin",
  "manager",
  "accountant",
  "marketing",
  "agent",
  "analyst",
  "billing",
  "viewer",
]);

export async function inviteTeamMemberActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const email = String(formData.get("email") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const rawRole = String(formData.get("roleSlug") || "agent");
  const roleSlug = RoleSlugSchema.safeParse(rawRole).success ? rawRole : "agent";
  const initialPassword = String(formData.get("initialPassword") || "");

  let inviteLink: string | undefined;
  try {
    authorize(session.ctx, "members:invite");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "inviting team members");
    }
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
      durationMs: elapsedMs(startedAt),
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

export async function resendInvitationActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const invitationId = String(formData.get("invitationId") || "");
  let inviteLink = "";
  let targetEmail = "";

  try {
    authorize(session.ctx, "members:invite");
    if (!session.impersonatorStaffId) {
      assertUserEmailVerified(session.user.id, "resending team invitations");
    }
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

export async function acceptInvitationActionImpl(formData: FormData) {
  const token = String(formData.get("token") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");
  const returnBase = token
    ? `/accept-invite?token=${encodeURIComponent(token)}`
    : "/accept-invite";

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

export async function updateTeamMemberRoleActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const membershipId = String(formData.get("membershipId") || "");
  const rawRole = String(formData.get("roleSlug") || "agent");
  const roleSlug = RoleSlugSchema.safeParse(rawRole).success ? rawRole : "agent";
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
      durationMs: elapsedMs(startedAt),
      summary: `Updated role for ${out.email} to ${out.roleSlug}`,
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Updated team member role.");
}

export async function removeTeamMemberActionImpl(formData: FormData) {
  const startedAt = Date.now();
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
      durationMs: elapsedMs(startedAt),
      summary: `Removed team member ${out.email} from workspace`,
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Team member access removed.");
}

export async function revokeInvitationActionImpl(formData: FormData) {
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

export async function changePasswordActionImpl(formData: FormData) {
  const startedAt = Date.now();
  const session = await requireWebSession();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (newPassword !== confirmPassword) {
    return goWithError("/settings/team", "New password and confirmation password did not match.");
  }

  try {
    await changeAuthenticatedUserPasswordAsync({
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
      durationMs: elapsedMs(startedAt),
      summary: "Changed account login password",
    });
  } catch (err) {
    return goWithError("/settings/team", friendlyMessage(err));
  }
  return goWithNotice("/settings/team", "Your account password has been updated.");
}

export async function submitHelpFeedbackActionImpl(formData: FormData) {
  const session = await requireWebSession();
  const slug = String(formData.get("slug") || "help-index").slice(0, 120);
  const helpful = formData.get("helpful") === "yes";
  const comment = String(formData.get("comment") || "").slice(0, 1500);
  recordDocsFeedback({
    slug,
    helpful,
    comment,
    workspaceId: session.workspace.id,
  });
  return goWithNotice("/help", "Thank you - your feedback was saved.");
}

export async function saveUserProfileJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  emailChanged?: boolean;
}> {
  const startedAt = Date.now();
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
      durationMs: elapsedMs(startedAt),
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

export async function changePasswordJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  const startedAt = Date.now();
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

    await changeAuthenticatedUserPasswordAsync({
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
      durationMs: elapsedMs(startedAt),
      summary: "Changed account login password",
    });

    revalidatePath("/settings/profile");
    return { ok: true, message: "Your account password has been updated securely." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function sendVerificationEmailJsonActionImpl(): Promise<{
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

export async function verifyEmailCodeJsonActionImpl(formData: FormData): Promise<{
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
        message:
          "Invalid or expired 6-digit verification code. Request a fresh code and try again.",
      };
    }
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return { ok: true, message: "Your work email address is now verified." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeSessionJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  const startedAt = Date.now();
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
      durationMs: elapsedMs(startedAt),
      summary: "Signed out an active browser/device session",
    });

    revalidatePath("/settings/profile");
    return { ok: true, message: "Device session signed out immediately." };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function revokeOtherSessionsJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
}> {
  const startedAt = Date.now();
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
      durationMs: elapsedMs(startedAt),
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

export async function saveBusinessSettingsJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  const startedAt = Date.now();
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
      upiVpa: formData.has("upiVpa") ? String(formData.get("upiVpa") || "") : undefined,
      upiPayeeName: formData.has("upiPayeeName")
        ? String(formData.get("upiPayeeName") || "")
        : undefined,
      bankName: formData.has("bankName") ? String(formData.get("bankName") || "") : undefined,
      bankBranch: formData.has("bankBranch")
        ? String(formData.get("bankBranch") || "")
        : undefined,
      bankAccountNumber: formData.has("bankAccountNumber")
        ? String(formData.get("bankAccountNumber") || "")
        : undefined,
      bankIfsc: formData.has("bankIfsc") ? String(formData.get("bankIfsc") || "") : undefined,
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
      durationMs: elapsedMs(startedAt),
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

export async function createNewBusinessJsonActionImpl(formData: FormData): Promise<{
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

export async function switchWorkspaceJsonActionImpl(formData: FormData): Promise<{
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

export async function beginUserTotpEnrollmentJsonActionImpl(): Promise<{
  ok: boolean;
  message: string;
  enrollment?: {
    secret: string;
    otpauthUri: string;
    qrCodeDataUri: string;
    accountEmail: string;
    issuer: string;
  };
}> {
  try {
    const session = await requireWebSession();
    const enrollment = beginUserTotpEnrollment(session.user.id);
    return {
      ok: true,
      message: "Scan the QR code in your authenticator app and enter the 6-digit code to activate 2FA.",
      enrollment,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function confirmUserTotpEnrollmentJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  backupCodes?: string[];
}> {
  try {
    const session = await requireWebSession();
    const code = String(formData.get("code") || "").trim();
    const out = confirmUserTotpEnrollment({
      userId: session.user.id,
      code,
      sessionId: session.sessionId,
    });
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.mfa.enrolled",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 1,
      summary: `Enabled TOTP Authenticator 2FA for ${session.user.email}`,
    });
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        "Authenticator 2FA enabled! Save these 8 one-time recovery codes in a safe place now.",
      backupCodes: out.backupCodes,
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}

export async function disableUserTotpMfaJsonActionImpl(formData: FormData): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const session = await requireWebSession();
    const codeOrPassword = String(formData.get("codeOrPassword") || "").trim();
    disableUserTotpMfa({
      userId: session.user.id,
      codeOrPassword,
    });
    appendActionLog({
      workspaceId: session.workspace.id,
      actorType: session.ctx.actorType,
      actorId: session.user.id,
      impersonatorId: session.impersonatorStaffId,
      source: "web",
      action: "user.mfa.disabled",
      outcome: "success",
      requestId: session.ctx.requestId,
      correlationId: session.ctx.correlationId,
      durationMs: 1,
      summary: `Disabled TOTP Authenticator 2FA for ${session.user.email}`,
    });
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: "Authenticator 2FA has been disabled for your account.",
    };
  } catch (err) {
    return { ok: false, message: friendlyMessage(err) };
  }
}
