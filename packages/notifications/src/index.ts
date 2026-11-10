import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { and, desc, eq, gt } from "drizzle-orm";
import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import {
  getEnv,
  hashPassword,
  hashPasswordAsync,
  newEntityId,
  RslError,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb, getPlatformSmtpConfig } from "@rsl/tenancy";
import {
  BillingAndWalletAlertTemplate,
  EMAIL_FOOTER_LOGO_CID,
  EMAIL_FOOTER_LOGO_PUBLIC_PATH,
  EMAIL_HEADER_LOGO_CID,
  EMAIL_HEADER_LOGO_PUBLIC_PATH,
  EmailVerificationTemplate,
  PasswordResetTemplate,
  SmtpDiagnosticTemplate,
  StorageAndBackupReportTemplate,
  TeamInvitationTemplate,
} from "./templates";

export * from "./templates";
export * from "./web-push";

export interface CustomSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface InlineEmailLogoAttachment {
  filename: string;
  path: string;
  cid: string;
  contentType: string;
  contentDisposition: "inline";
}

export function resolvePublicLogoAssetPath(filename: string): string | null {
  const cleanName = filename.replace(/^\/+/, "");
  const startDirs: string[] = [];

  try {
    startDirs.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Bundled runtime fallback uses process.cwd()
  }
  startDirs.push(process.cwd());

  const workspaceRootCandidates: string[] = [];
  const fallbackCandidates: string[] = [];

  for (const start of startDirs) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 7; depth += 1) {
      const candidate = path.join(current, "public", cleanName);
      if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
        workspaceRootCandidates.push(candidate);
      } else {
        fallbackCandidates.push(candidate);
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const candidate of [...workspaceRootCandidates, ...fallbackCandidates]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function prepareSmtpEmailPayload(renderedHtml: string): {
  html: string;
  attachments: InlineEmailLogoAttachment[];
} {
  let html = renderedHtml;
  const attachments: InlineEmailLogoAttachment[] = [];

  const headerLogoPath = resolvePublicLogoAssetPath(EMAIL_HEADER_LOGO_PUBLIC_PATH);
  if (headerLogoPath) {
    html = html.replace(
      /src=(["'])(?:https?:\/\/[^"']+)?\/email-logo\.png\1/gi,
      `src="cid:${EMAIL_HEADER_LOGO_CID}"`
    );
    attachments.push({
      filename: "email-logo.png",
      path: headerLogoPath,
      cid: EMAIL_HEADER_LOGO_CID,
      contentType: "image/png",
      contentDisposition: "inline",
    });
  }

  const footerLogoPath = resolvePublicLogoAssetPath(EMAIL_FOOTER_LOGO_PUBLIC_PATH);
  if (footerLogoPath) {
    html = html.replace(
      /src=(["'])(?:https?:\/\/[^"']+)?\/logo\.png\1/gi,
      `src="cid:${EMAIL_FOOTER_LOGO_CID}"`
    );
    attachments.push({
      filename: "logo.png",
      path: footerLogoPath,
      cid: EMAIL_FOOTER_LOGO_CID,
      contentType: "image/png",
      contentDisposition: "inline",
    });
  }

  return { html, attachments };
}

type SmtpTransporter = ReturnType<typeof nodemailer.createTransport>;
const smtpPoolCache = new Map<string, SmtpTransporter>();
const notificationThrottleWindows = new Map<string, number[]>();

function consumeNotificationRateLimit(bucket: string, key: string, maxAttempts: number, windowMs: number): void {
  const now = Date.now();
  const fullKey = `${bucket}:${key}`;
  const cutoff = now - windowMs;
  const recent = (notificationThrottleWindows.get(fullKey) ?? []).filter((ts) => ts > cutoff);
  if (recent.length >= maxAttempts) {
    notificationThrottleWindows.set(fullKey, recent);
    throw new RslError(
      "RSL-AUTH-1004",
      "Too many verification or password-reset requests. Please wait a few minutes before retrying."
    );
  }
  recent.push(now);
  notificationThrottleWindows.set(fullKey, recent);
}

export function resetNotificationRateLimitsForTests(): void {
  notificationThrottleWindows.clear();
}

function getOrCreatePooledTransporter(cfg: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}): SmtpTransporter {
  const passDigest = crypto.createHash("sha256").update(cfg.pass).digest("hex").slice(0, 16);
  const poolKey = `${cfg.host}:${cfg.port}:${cfg.secure ? "1" : "0"}:${cfg.user}:${passDigest}`;
  const existing = smtpPoolCache.get(poolKey);
  if (existing) return existing;

  const transporter = nodemailer.createTransport({
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  if (smtpPoolCache.size >= 16) {
    const oldestKey = smtpPoolCache.keys().next().value;
    if (oldestKey) {
      try {
        smtpPoolCache.get(oldestKey)?.close();
      } catch {
        // ignore close failure
      }
      smtpPoolCache.delete(oldestKey);
    }
  }
  smtpPoolCache.set(poolKey, transporter);
  return transporter;
}

export function closeAllSmtpPools(): void {
  for (const transporter of smtpPoolCache.values()) {
    try {
      transporter.close();
    } catch {
      // ignore close failure
    }
  }
  smtpPoolCache.clear();
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
    const smtpPayload = prepareSmtpEmailPayload(renderedHtml);
    const transporter = getOrCreatePooledTransporter({
      host: useCustom ? params.customSmtp!.host : platformSmtp.host,
      port: useCustom ? params.customSmtp!.port : platformSmtp.port,
      secure: useCustom ? params.customSmtp!.secure : platformSmtp.secure,
      user: useCustom ? params.customSmtp!.user : platformSmtp.user,
      pass: useCustom ? params.customSmtp!.pass : platformSmtp.password,
    });

    const sendOnce = () =>
      transporter.sendMail({
        from: useCustom ? params.customSmtp!.from : platformSmtp.from || platformSmtp.user,
        to: params.to,
        subject: params.subject,
        html: smtpPayload.html,
        text: renderedText,
        attachments: smtpPayload.attachments,
      });

    try {
      let info: Awaited<ReturnType<typeof sendOnce>>;
      try {
        info = await sendOnce();
      } catch {
        await new Promise((r) => setTimeout(r, 350));
        info = await sendOnce();
      }

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
  const normalizedEmail = params.email.trim().toLowerCase();
  consumeNotificationRateLimit("verify-send", normalizedEmail, 5, 10 * 60_000);

  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const verificationId = newEntityId("req", params.workspaceId ?? params.recipientName);
  const identifier = `verify:${normalizedEmail}`;
  const now = Date.now();

  const db = controlDb();
  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, identifier))
    .run();

  db.insert(controlSchema.verifications)
    .values({
      id: verificationId,
      identifier,
      valueHash: codeHash,
      failedAttempts: 0,
      expiresAt: now + 30 * 60 * 1000,
      createdAt: now,
    })
    .run();

  // Never include verification codes or email tokens in HTTP query parameters
  const verifyUrl = `${getEnv().APP_URL}/login?verify=1#verify`;
  const res = await dispatchHtmlEmail({
    workspaceId: params.workspaceId,
    to: params.email,
    templateKey: "email_verification",
    subject: `${code} is your RapidShift Labs verification code`,
    reactElement: React.createElement(EmailVerificationTemplate, {
      recipientName: params.recipientName,
      recipientEmail: params.email,
      verificationCode: code,
      verifyUrl,
      expiresMinutes: 30,
    }),
  });

  return { verificationId, emailId: res.emailId, status: res.status };
}

const MAX_EMAIL_VERIFICATION_ATTEMPTS = 5;

export function confirmEmailVerificationCode(email: string, code: string): boolean {
  const db = controlDb();
  const normalizedEmail = email.trim().toLowerCase();
  const identifier = `verify:${normalizedEmail}`;
  const codeHash = crypto.createHash("sha256").update(code.trim()).digest("hex");
  const now = Date.now();

  const activeRows = db
    .select()
    .from(controlSchema.verifications)
    .where(
      and(
        eq(controlSchema.verifications.identifier, identifier),
        gt(controlSchema.verifications.expiresAt, now)
      )
    )
    .all()
    .sort((a, b) => b.createdAt - a.createdAt);

  const candidate = activeRows[0];
  if (!candidate) return false;

  if (candidate.failedAttempts >= MAX_EMAIL_VERIFICATION_ATTEMPTS) {
    db.delete(controlSchema.verifications)
      .where(eq(controlSchema.verifications.identifier, identifier))
      .run();
    return false;
  }

  const expectedBuf = Buffer.from(candidate.valueHash, "hex");
  const actualBuf = Buffer.from(codeHash, "hex");
  const isMatch =
    expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

  if (!isMatch) {
    const nextAttempts = candidate.failedAttempts + 1;
    if (nextAttempts >= MAX_EMAIL_VERIFICATION_ATTEMPTS) {
      db.delete(controlSchema.verifications)
        .where(eq(controlSchema.verifications.identifier, identifier))
        .run();
    } else {
      db.update(controlSchema.verifications)
        .set({ failedAttempts: nextAttempts })
        .where(eq(controlSchema.verifications.id, candidate.id))
        .run();
    }
    return false;
  }

  db.update(controlSchema.users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(controlSchema.users.email, normalizedEmail))
    .run();

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, identifier))
    .run();
  return true;
}

export async function requestPasswordResetEmail(params: {
  email: string;
  requestedFromIp?: string;
}): Promise<{ dispatched: boolean }> {
  const normalized = params.email.trim().toLowerCase();
  if (params.requestedFromIp) {
    consumeNotificationRateLimit("pwreset-ip", params.requestedFromIp, 8, 15 * 60_000);
  }
  consumeNotificationRateLimit("pwreset-email", normalized, 3, 10 * 60_000);

  const db = controlDb();
  const user = db.select().from(controlSchema.users).where(eq(controlSchema.users.email, normalized)).get();
  if (!user) {
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

  const resetUrl = `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/reset-handoff?email=${encodeURIComponent(normalized)}&token=${encodeURIComponent(rawResetToken)}`;
  await dispatchHtmlEmail({
    workspaceId: user.activeWorkspaceId,
    to: normalized,
    templateKey: "password_reset",
    subject: "Password reset instructions for RapidShift Labs",
    reactElement: React.createElement(PasswordResetTemplate, {
      recipientName: user.name,
      recipientEmail: normalized,
      resetUrl,
      requestedFromIp: params.requestedFromIp,
    }),
  });

  return { dispatched: true };
}

function finalizePasswordResetWithHash(params: { email: string; rawToken: string }, nextPasswordHash: string): void {
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

  const user = db
    .select({ id: controlSchema.users.id })
    .from(controlSchema.users)
    .where(eq(controlSchema.users.email, normalized))
    .get();

  db.update(controlSchema.users)
    .set({
      passwordHash: nextPasswordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(controlSchema.users.email, normalized))
    .run();

  if (user) {
    db.delete(controlSchema.sessions)
      .where(eq(controlSchema.sessions.userId, user.id))
      .run();
  }

  db.delete(controlSchema.verifications)
    .where(eq(controlSchema.verifications.identifier, `reset:${normalized}`))
    .run();
}

export function completePasswordReset(params: {
  email: string;
  rawToken: string;
  newPassword: string;
}): void {
  if (params.newPassword.length < 8) {
    throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
  }
  finalizePasswordResetWithHash(params, hashPassword(params.newPassword));
}

export async function completePasswordResetAsync(params: {
  email: string;
  rawToken: string;
  newPassword: string;
}): Promise<void> {
  if (params.newPassword.length < 8) {
    throw new RslError("RSL-VAL-1001", "New password must be at least 8 characters long.");
  }
  const nextHash = await hashPasswordAsync(params.newPassword);
  finalizePasswordResetWithHash(params, nextHash);
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
    subject: `Invitation to join ${params.businessName} on RapidShift Labs`,
    reactElement: React.createElement(TeamInvitationTemplate, {
      inviterName: params.inviterName,
      businessName: params.businessName,
      roleLabel: params.roleLabel,
      recipientEmail: params.recipientEmail,
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
    subject: `${params.headline} (${params.businessName})`,
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
    subject: `${params.operationTitle} (${params.businessName})`,
    reactElement: React.createElement(StorageAndBackupReportTemplate, {
      businessName: params.businessName,
      operationTitle: params.operationTitle,
      summaryLine: params.summaryLine,
      checksumOrDetails: params.checksumOrDetails,
      backupsUrl: `${getEnv().APP_URL}/backups`,
    }),
  });
}

export async function renderEmailPreviewHtml(element: React.ReactElement): Promise<string> {
  return render(element);
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
  const cleanRecipient = recipientEmail.trim();
  return dispatchHtmlEmail({
    to: cleanRecipient,
    templateKey: "smtp_test",
    subject: `RapidShift Labs SMTP verification (${smtp.host}:${smtp.port})`,
    reactElement: React.createElement(SmtpDiagnosticTemplate, {
      recipientEmail: cleanRecipient,
      smtpHost: smtp.host,
      smtpPort: smtp.port,
      fromHeader: smtp.from || smtp.user,
      credentialSource: smtp.source,
      adminCredentialsUrl: `${getEnv().ADMIN_URL}/credentials`,
    }),
  });
}

export async function verifyPlatformSmtpTransport(): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
}> {
  const started = Date.now();
  const smtp = getPlatformSmtpConfig();
  if (!smtp.isReady) {
    return {
      ok: false,
      latencyMs: 1,
      message: "SMTP credentials are not configured or disabled.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.password,
    },
    connectionTimeout: 7500,
    greetingTimeout: 7500,
    socketTimeout: 8000,
  });

  try {
    await transporter.verify();
    const latencyMs = Math.max(1, Date.now() - started);
    return {
      ok: true,
      latencyMs,
      message: `Verified live SMTP handshake & login (${smtp.user} via ${smtp.host}:${smtp.port}, ${smtp.secure ? "SSL/TLS" : "STARTTLS"}, ${latencyMs}ms).`,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - started);
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      latencyMs,
      message: `SMTP handshake failed (${smtp.host}:${smtp.port}): ${errMsg.slice(0, 180)}`,
    };
  } finally {
    try {
      transporter.close();
    } catch {
      // ignore close errors
    }
  }
}
