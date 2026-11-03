import crypto from "node:crypto";
import React from "react";
import { and, desc, eq, gt } from "drizzle-orm";
import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import { getEnv, hashPassword, newEntityId, RslError } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, getPlatformSmtpConfig } from "@rsl/tenancy";
import {
  BillingAndWalletAlertTemplate,
  EmailVerificationTemplate,
  PasswordResetTemplate,
  StorageAndBackupReportTemplate,
  TeamInvitationTemplate,
} from "./templates";

export * from "./templates";

export interface CustomSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

async function dispatchHtmlEmail(params: {
  workspaceId?: string | null;
  to: string;
  templateKey: string;
  subject: string;
  reactElement: React.ReactElement;
  customSmtp?: CustomSmtpConfig | null;
}): Promise<{ emailId: string; status: "sent" | "queued_local"; transportMode: string }> {
  const renderedHtml = await render(params.reactElement);
  const renderedText = await render(params.reactElement, { plainText: true });
  const emailId = newEntityId("eml", params.workspaceId ?? "rsl");

  const useCustom = Boolean(params.customSmtp?.user && params.customSmtp?.pass);
  const platformSmtp = getPlatformSmtpConfig();
  const usePlatformGmail = platformSmtp.isReady;

  if (useCustom || usePlatformGmail) {
    const transportMode = useCustom ? "client_smtp" : "gmail_smtp";
    const transporter = nodemailer.createTransport({
      host: useCustom ? params.customSmtp!.host : platformSmtp.host,
      port: useCustom ? params.customSmtp!.port : platformSmtp.port,
      secure: useCustom ? params.customSmtp!.secure : platformSmtp.secure,
      auth: {
        user: useCustom ? params.customSmtp!.user : platformSmtp.user,
        pass: useCustom ? params.customSmtp!.pass : platformSmtp.password,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: useCustom ? params.customSmtp!.from : platformSmtp.from || platformSmtp.user,
        to: params.to,
        subject: params.subject,
        html: renderedHtml,
        text: renderedText,
      });

      controlDb()
        .insert(controlSchema.emailDeliveries)
        .values({
          id: emailId,
          workspaceId: params.workspaceId ?? null,
          recipientEmail: params.to,
          templateKey: params.templateKey,
          subject: params.subject,
          renderedHtml,
          transportMode,
          status: "sent",
          messageId: info.messageId ?? null,
          createdAt: Date.now(),
        })
        .run();

      return { emailId, status: "sent", transportMode };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      controlDb()
        .insert(controlSchema.emailDeliveries)
        .values({
          id: emailId,
          workspaceId: params.workspaceId ?? null,
          recipientEmail: params.to,
          templateKey: params.templateKey,
          subject: params.subject,
          renderedHtml,
          transportMode,
          status: "failed",
          errorMessage: errMsg,
          createdAt: Date.now(),
        })
        .run();
      throw error;
    }
  }

  // When GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD is not yet configured in .env,
  // persist rendered React Email HTML to control.db so local verification & reset flows remain 100% functional!
  controlDb()
    .insert(controlSchema.emailDeliveries)
    .values({
      id: emailId,
      workspaceId: params.workspaceId ?? null,
      recipientEmail: params.to,
      templateKey: params.templateKey,
      subject: params.subject,
      renderedHtml,
      transportMode: "local_outbox",
      status: "queued_local",
      createdAt: Date.now(),
    })
    .run();

  return { emailId, status: "queued_local", transportMode: "local_outbox" };
}

export async function sendEmailVerificationCode(params: {
  userId: string;
  email: string;
  recipientName: string;
  workspaceId?: string;
}): Promise<{ verificationId: string; emailId: string; status: string }> {
  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const verificationId = newEntityId("req", params.workspaceId ?? params.recipientName);
  const now = Date.now();

  controlDb()
    .insert(controlSchema.verifications)
    .values({
      id: verificationId,
      identifier: `verify:${params.email.trim().toLowerCase()}`,
      valueHash: codeHash,
      expiresAt: now + 30 * 60 * 1000,
      createdAt: now,
    })
    .run();

  const verifyUrl = `${getEnv().APP_URL}/login?verifyEmail=${encodeURIComponent(params.email)}&code=${code}`;
  const res = await dispatchHtmlEmail({
    workspaceId: params.workspaceId,
    to: params.email,
    templateKey: "email_verification",
    subject: `${code} is your RSL Marketing verification code`,
    reactElement: React.createElement(EmailVerificationTemplate, {
      recipientName: params.recipientName,
      verificationCode: code,
      verifyUrl,
      expiresMinutes: 30,
    }),
  });

  return { verificationId, emailId: res.emailId, status: res.status };
}

export function confirmEmailVerificationCode(email: string, code: string): boolean {
  const db = controlDb();
  const identifier = `verify:${email.trim().toLowerCase()}`;
  const codeHash = crypto.createHash("sha256").update(code.trim()).digest("hex");
  const now = Date.now();

  const match = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, identifier),
        eq(controlSchema.verifications.valueHash, codeHash),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  if (!match) return false;

  db.update(controlSchema.users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(controlSchema.users.email, email.trim().toLowerCase()))
    .run();

  db.delete(controlSchema.verifications).where(eq(controlSchema.verifications.id, match.id)).run();
  return true;
}

export async function requestPasswordResetEmail(params: {
  email: string;
  requestedFromIp?: string;
}): Promise<{ dispatched: boolean }> {
  const db = controlDb();
  const normalized = params.email.trim().toLowerCase();
  const user = db.select().from(controlSchema.users).where(eq(controlSchema.users.email, normalized)).get();
  if (!user) {
    // Do not reveal account existence
    return { dispatched: true };
  }

  const rawResetToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
  const now = Date.now();

  db.insert(controlSchema.verifications)
    .values({
      id: newEntityId("req", user.name),
      identifier: `reset:${normalized}`,
      valueHash: tokenHash,
      expiresAt: now + 30 * 60 * 1000,
      createdAt: now,
    })
    .run();

  const resetUrl = `${getEnv().APP_URL}/reset-password?email=${encodeURIComponent(normalized)}&token=${rawResetToken}`;
  await dispatchHtmlEmail({
    workspaceId: user.activeWorkspaceId,
    to: normalized,
    templateKey: "password_reset",
    subject: "Reset your RSL Marketing password",
    reactElement: React.createElement(PasswordResetTemplate, {
      recipientName: user.name,
      resetUrl,
      requestedFromIp: params.requestedFromIp,
    }),
  });

  return { dispatched: true };
}

export function completePasswordReset(params: {
  email: string;
  rawToken: string;
  newPassword: string;
}): void {
  const db = controlDb();
  const normalized = params.email.trim().toLowerCase();
  const tokenHash = crypto.createHash("sha256").update(params.rawToken.trim()).digest("hex");
  const now = Date.now();

  const row = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, `reset:${normalized}`),
        eq(controlSchema.verifications.valueHash, tokenHash),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .get();

  if (!row) {
    throw new RslError("RSL-AUTH-1001", "This password reset link is invalid or has expired.");
  }

  db.update(controlSchema.users)
    .set({ passwordHash: hashPassword(params.newPassword), updatedAt: now })
    .where(eq(controlSchema.users.email, normalized))
    .run();

  db.delete(controlSchema.verifications).where(eq(controlSchema.verifications.id, row.id)).run();
}

export async function sendTeamInviteNotification(params: {
  workspaceId: string;
  businessName: string;
  inviterName: string;
  recipientEmail: string;
  roleLabel: string;
  rawInviteToken?: string;
}) {
  const acceptUrl = params.rawInviteToken
    ? `${getEnv().APP_URL}/accept-invite?token=${encodeURIComponent(params.rawInviteToken)}`
    : `${getEnv().APP_URL}/login`;
  return dispatchHtmlEmail({
    workspaceId: params.workspaceId,
    to: params.recipientEmail,
    templateKey: "team_invite",
    subject: `${params.inviterName} invited you to ${params.businessName} on RSL Marketing`,
    reactElement: React.createElement(TeamInvitationTemplate, {
      inviterName: params.inviterName,
      businessName: params.businessName,
      roleLabel: params.roleLabel,
      acceptUrl,
    }),
  });
}

export async function sendBillingNotification(params: {
  workspaceId: string;
  businessName: string;
  recipientEmail: string;
  headline: string;
  bodyText: string;
  walletBalanceFormatted: string;
  invoiceNumber?: string;
}) {
  return dispatchHtmlEmail({
    workspaceId: params.workspaceId,
    to: params.recipientEmail,
    templateKey: "billing_alert",
    subject: `${params.headline} — ${params.businessName}`,
    reactElement: React.createElement(BillingAndWalletAlertTemplate, {
      businessName: params.businessName,
      headline: params.headline,
      bodyText: params.bodyText,
      walletBalanceFormatted: params.walletBalanceFormatted,
      invoiceNumber: params.invoiceNumber,
      billingUrl: `${getEnv().APP_URL}/billing`,
    }),
  });
}

export async function sendStorageAndBackupNotification(params: {
  workspaceId: string;
  businessName: string;
  recipientEmail: string;
  operationTitle: string;
  summaryLine: string;
  checksumOrDetails: string;
}) {
  return dispatchHtmlEmail({
    workspaceId: params.workspaceId,
    to: params.recipientEmail,
    templateKey: "backup_report",
    subject: `${params.operationTitle} — ${params.businessName}`,
    reactElement: React.createElement(StorageAndBackupReportTemplate, {
      businessName: params.businessName,
      operationTitle: params.operationTitle,
      summaryLine: params.summaryLine,
      checksumOrDetails: params.checksumOrDetails,
      backupsUrl: `${getEnv().APP_URL}/backups`,
    }),
  });
}

export function listRecentEmails(workspaceId?: string, limit = 30) {
  const db = controlDb();
  if (workspaceId) {
    return db
      .select()
      .from(controlSchema.emailDeliveries)
      .where(eq(controlSchema.emailDeliveries.workspaceId, workspaceId))
      .orderBy(desc(controlSchema.emailDeliveries.createdAt))
      .limit(limit)
      .all();
  }
  return db
    .select()
    .from(controlSchema.emailDeliveries)
    .orderBy(desc(controlSchema.emailDeliveries.createdAt))
    .limit(limit)
    .all();
}

export async function sendPlatformSmtpTestEmail(recipientEmail: string): Promise<{
  emailId: string;
  status: "sent" | "queued_local";
  transportMode: string;
}> {
  const smtp = getPlatformSmtpConfig();
  if (!smtp.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Save your SMTP Username and App Password first before sending a live test email."
    );
  }
  return dispatchHtmlEmail({
    to: recipientEmail.trim(),
    templateKey: "smtp_test",
    subject: "RapidShift Labs — Live Database SMTP Verification",
    reactElement: React.createElement(StorageAndBackupReportTemplate, {
      businessName: "RapidShift Labs Staff Portal",
      operationTitle: "Outbound SMTP Transport Verified",
      summaryLine: `Delivered successfully via ${smtp.host}:${smtp.port} (${smtp.source} credentials).`,
      checksumOrDetails: `Sender: ${smtp.from} • Verified at ${new Date().toISOString()}`,
      backupsUrl: `${getEnv().ADMIN_URL}/credentials`,
    }),
  });
}
