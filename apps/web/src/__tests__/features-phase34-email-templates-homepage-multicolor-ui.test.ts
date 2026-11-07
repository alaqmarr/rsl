import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { registerUserWithWorkspace } from "@rsl/auth";
import { getPlatformBillingSettings } from "@rsl/billing";
import { getEnv } from "@rsl/core";
import {
  BillingAndWalletAlertTemplate,
  EMAIL_FOOTER_LOGO_CID,
  EMAIL_HEADER_LOGO_CID,
  EmailVerificationTemplate,
  listRecentEmails,
  PasswordResetTemplate,
  prepareSmtpEmailPayload,
  resolvePublicLogoAssetPath,
  sendBillingNotification,
  sendEmailVerificationCode,
  sendStorageAndBackupNotification,
  sendTeamInviteNotification,
  SmtpDiagnosticTemplate,
  StorageAndBackupReportTemplate,
  TeamInvitationTemplate,
} from "@rsl/notifications";
import { buildPlatformCredentialsSeedTemplate } from "@rsl/tenancy";
import { MetricCard, SectionCard, StatusPill } from "@rsl/ui";
import { getLegalEntityContext } from "../lib/legal-documents";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Phase 34 — Corporate Email Suite, app@rapidshiftlabs.in Migration, Storefront Revamp & Multi-Color Z-Axis UI", () => {
  it("renders all 6 transactional email templates & dispatches clean non-AI subjects with /email-logo.png, /logo.png, and app@rapidshiftlabs.in", async () => {
    const elements = [
      React.createElement(EmailVerificationTemplate, {
        recipientName: "Rohan Mehta",
        recipientEmail: "rohan@mehtaelectricals.in",
        verificationCode: "482910",
        verifyUrl: "https://app.rapidshiftlabs.in/login?verifyEmail=rohan%40mehtaelectricals.in&code=482910",
      }),
      React.createElement(PasswordResetTemplate, {
        recipientName: "Rohan Mehta",
        recipientEmail: "rohan@mehtaelectricals.in",
        resetUrl: "https://app.rapidshiftlabs.in/reset-password?token=abc123",
        requestedFromIp: "49.36.112.18",
      }),
      React.createElement(TeamInvitationTemplate, {
        inviterName: "Rohan Mehta",
        businessName: "Mehta Electricals Pvt Ltd",
        roleLabel: "Billing & Accounts",
        recipientEmail: "ca@mehtaelectricals.in",
        acceptUrl: "https://app.rapidshiftlabs.in/accept-invite?token=inv123",
      }),
      React.createElement(BillingAndWalletAlertTemplate, {
        businessName: "Mehta Electricals Pvt Ltd",
        headline: "GST Tax Invoice Issued",
        bodyText: "Your Tally + WhatsApp Suite annual plan is active.",
        walletBalanceFormatted: "₹2,450.00",
        invoiceNumber: "RSL/26-27/0019",
        billingUrl: "https://app.rapidshiftlabs.in/billing",
      }),
      React.createElement(StorageAndBackupReportTemplate, {
        businessName: "Mehta Electricals Pvt Ltd",
        operationTitle: "Encrypted Google Drive Backup Completed",
        summaryLine: "Archive uploaded and verified against SHA-256 signature.",
        checksumOrDetails: "SHA256: 9f86d081884c7d659a2feaa0c55ad015",
        backupsUrl: "https://app.rapidshiftlabs.in/backups",
      }),
      React.createElement(SmtpDiagnosticTemplate, {
        recipientEmail: "app@rapidshiftlabs.in",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        fromHeader: "RapidShift Labs <app@rapidshiftlabs.in>",
        credentialSource: "database",
        adminCredentialsUrl: "https://admin.rapidshiftlabs.in/credentials",
      }),
    ];

    for (const el of elements) {
      const html = renderToStaticMarkup(el);
      expect(html).toContain("/email-logo.png");
      expect(html).toContain("/logo.png");
      expect(html).toContain("app@rapidshiftlabs.in");
      expect(html).toContain('role="presentation"');
      expect(html).toContain('content="light only"');
      expect(html).toContain("linear-gradient(#FFFFFF, #FFFFFF)");
      expect(html).not.toContain("—");
      expect(html).not.toContain("thewebsensei.email");

      // Verify SMTP inline CID logo payload resolves directly from workspace root public/ folder
      const smtpPayload = prepareSmtpEmailPayload(html);
      expect(smtpPayload.html).toContain(`src="cid:${EMAIL_HEADER_LOGO_CID}"`);
      expect(smtpPayload.html).toContain(`src="cid:${EMAIL_FOOTER_LOGO_CID}"`);
      expect(smtpPayload.attachments).toHaveLength(2);
      expect(smtpPayload.attachments[0]?.path).toBe(path.join(REPO_ROOT, "public", "email-logo.png"));
      expect(smtpPayload.attachments[0]?.contentDisposition).toBe("inline");
      expect(smtpPayload.attachments[1]?.path).toBe(path.join(REPO_ROOT, "public", "logo.png"));
      expect(smtpPayload.attachments[1]?.contentDisposition).toBe("inline");
    }

    expect(resolvePublicLogoAssetPath("email-logo.png")).toBe(
      path.join(REPO_ROOT, "public", "email-logo.png")
    );
    expect(resolvePublicLogoAssetPath("logo.png")).toBe(
      path.join(REPO_ROOT, "public", "logo.png")
    );

    // End-to-end notifications dispatch check via @react-email/render inside @rsl/notifications
    const suffix = crypto.randomBytes(4).toString("hex");
    const reg = registerUserWithWorkspace({
      name: "Email Suite Owner",
      email: `email-owner-${suffix}@rapidshiftlabs.in`,
      password: "StrongPassword123!",
      businessName: `Shree polymers ${suffix}`,
      stateCode: "24",
    });

    await sendEmailVerificationCode({
      userId: reg.userId,
      email: `email-owner-${suffix}@rapidshiftlabs.in`,
      recipientName: "Email Suite Owner",
      workspaceId: reg.workspaceId,
    });
    await sendTeamInviteNotification({
      workspaceId: reg.workspaceId,
      businessName: `Shree polymers ${suffix}`,
      inviterName: "Email Suite Owner",
      recipientEmail: `accountant-${suffix}@rapidshiftlabs.in`,
      roleLabel: "Billing & Accounts",
    });
    await sendBillingNotification({
      workspaceId: reg.workspaceId,
      businessName: `Shree polymers ${suffix}`,
      recipientEmail: `email-owner-${suffix}@rapidshiftlabs.in`,
      headline: "GST Tax Invoice Issued",
      bodyText: "Plan unlocked cleanly.",
      walletBalanceFormatted: "₹1,200.00",
      invoiceNumber: "RSL/26-27/0102",
    });
    await sendStorageAndBackupNotification({
      workspaceId: reg.workspaceId,
      businessName: `Shree polymers ${suffix}`,
      recipientEmail: `email-owner-${suffix}@rapidshiftlabs.in`,
      operationTitle: "Daily Encrypted Backup Verified",
      summaryLine: "Stored in Google Drive.",
      checksumOrDetails: "SHA256: abcd1234",
    });

    const delivered = listRecentEmails(reg.workspaceId, 10);
    expect(delivered.length).toBe(4);
    for (const row of delivered) {
      expect(row.subject).not.toContain("—");
      expect(row.subject).not.toContain("RSL Marketing");
      expect(row.renderedHtml).toContain("/email-logo.png");
      expect(row.renderedHtml).toContain("app@rapidshiftlabs.in");
    }
  });

  it("standardizes official platform email to app@rapidshiftlabs.in across billing, credentials seed template, and legal context", () => {
    const billing = getPlatformBillingSettings();
    expect(billing.billingEmail).toBe("app@rapidshiftlabs.in");

    const seed = buildPlatformCredentialsSeedTemplate();
    expect(seed.smtp_email?.user).toBe("app@rapidshiftlabs.in");
    expect(seed.smtp_email?.from).toContain("app@rapidshiftlabs.in");
    expect(seed.web_push_vapid?.subject).toBe("mailto:app@rapidshiftlabs.in");

    const env = getEnv();
    expect(env.EMAIL_FROM).toContain("app@rapidshiftlabs.in");

    const legal = getLegalEntityContext();
    expect(legal.privacyEmail).toBe(`app@${legal.primaryDomain}`);
    expect(legal.billingEmail).toBe(`app@${legal.primaryDomain}`);
  });

  it("revamps unauthenticated homepage without Sparkles or em-dashes while preserving fluid w-full layout", () => {
    const landingSrc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/public-landing-page.tsx"),
      "utf8"
    );
    expect(landingSrc).toContain("w-full");
    expect(landingSrc).toContain("WORKBENCH_DOMAINS");
    expect(landingSrc).toContain("app@rapidshiftlabs.in");
    expect(landingSrc).not.toContain("Sparkles");
    expect(landingSrc).not.toContain("—");
    expect(landingSrc).not.toMatch(/\bmax-w-(?:7xl|6xl|5xl|4xl)\b/);
  });

  it("supports multi-color domain accents (indigo, violet, teal) and preserves untouched brand logo binaries", () => {
    const pillHtml = renderToStaticMarkup(
      React.createElement(StatusPill, { label: "Synced", tone: "indigo" })
    );
    expect(pillHtml).toContain("Synced");

    const metricHtml = renderToStaticMarkup(
      React.createElement(MetricCard, {
        label: "Marketing Linked",
        value: "₹1,24,000",
        sublabel: "Last 30 days",
        accent: "indigo",
      })
    );
    expect(metricHtml).toContain("₹1,24,000");

    const sectionHtml = renderToStaticMarkup(
      React.createElement(SectionCard, {
        title: "Ledger Ageing",
        accent: "violet",
        children: React.createElement("div", null, "Body"),
      })
    );
    expect(sectionHtml).toContain("Ledger Ageing");

    for (const logoRel of [
      "public/logo.png",
      "public/logo-nobg.png",
      "public/long-logo-nobg.png",
      "public/long-logo.jpeg",
      "public/email-logo.png",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, logoRel))).toBe(true);
    }
  });
});
