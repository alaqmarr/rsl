import React from "react";

function Html(props: React.HTMLAttributes<HTMLHtmlElement>) {
  return <html {...props} />;
}

function Head(props: React.HTMLAttributes<HTMLHeadElement>) {
  return (
    <head {...props}>
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      {props.children}
    </head>
  );
}

function Preview(props: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "none",
        overflow: "hidden",
        lineHeight: "1px",
        opacity: 0,
        maxHeight: 0,
        maxWidth: 0,
      }}
    >
      {props.children}
    </div>
  );
}

function Body(props: React.HTMLAttributes<HTMLBodyElement>) {
  return <body {...props} />;
}

function Container(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

function Section(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}

function Heading(props: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h1 {...props} />;
}

function Text(props: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} />;
}

function Hr(props: React.HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} />;
}

function Button(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}

const palette = {
  bg: "#F8F9FB",
  card: "#FFFFFF",
  border: "#E4E4E7",
  ink: "#0F172A",
  muted: "#52525B",
  subtle: "#71717A",
  emerald: "#059669",
  emeraldTint: "#ECFDF5",
  amberTint: "#FEF3C7",
  amberInk: "#92400E",
};

const baseFont =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif";

function EmailFrame(props: {
  previewText: string;
  businessName?: string;
  badgeText: string;
  children: React.ReactNode;
}) {
  const appBase = (process.env.APP_URL || "http://localhost:4500").replace(/\/$/, "");
  return (
    <Html lang="en">
      <Head />
      <Preview>{props.previewText}</Preview>
      <Body style={{ backgroundColor: palette.bg, fontFamily: baseFont, margin: 0, padding: "36px 16px" }}>
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: palette.card,
            border: `1px solid ${palette.border}`,
            borderRadius: "16px",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "5px", backgroundColor: "#0F172A", borderBottom: `2px solid ${palette.emerald}` }} />
          <div style={{ padding: "32px 36px 28px" }}>
            <Section
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                borderBottom: `1px solid ${palette.border}`,
                paddingBottom: "18px",
                marginBottom: "24px",
              }}
            >
              <img
                src={`${appBase}/long-logo.jpeg`}
                alt="RapidShift Labs"
                height={28}
                style={{ height: "28px", width: "auto", display: "block" }}
              />
              <Text
                style={{
                  display: "inline-block",
                  backgroundColor: palette.emeraldTint,
                  color: palette.emerald,
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "5px 10px",
                  borderRadius: "999px",
                  margin: 0,
                }}
              >
                {props.badgeText}
              </Text>
            </Section>

            {props.children}

            <Hr style={{ borderColor: palette.border, margin: "28px 0 18px" }} />

            <Section style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <img
                src={`${appBase}/logo.png`}
                alt="RapidShift Labs"
                width={18}
                height={18}
                style={{ width: "18px", height: "18px", display: "inline-block" }}
              />
              <Text style={{ color: palette.subtle, fontSize: "12px", lineHeight: "18px", margin: 0 }}>
                Sent by {props.businessName ? `${props.businessName} via ` : ""}
                <strong>RSL Marketing &amp; Tally Suite</strong> (RapidShift Labs). Every account action is recorded in your
                tamper-proof Activity History.
              </Text>
            </Section>
          </div>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailVerificationTemplate(props: {
  recipientName: string;
  verificationCode: string;
  verifyUrl: string;
  expiresMinutes?: number;
}) {
  return (
    <EmailFrame
      previewText={`Your verification code is ${props.verificationCode}`}
      badgeText="Verify Email Address"
    >
      <Heading style={{ color: palette.ink, fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>
        Confirm your email address, {props.recipientName}
      </Heading>
      <Text style={{ color: palette.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 20px" }}>
        Enter the 6-digit verification code below in RSL Marketing, or click the button to verify your account
        automatically.
      </Text>

      <Section
        style={{
          backgroundColor: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: "10px",
          padding: "18px",
          textAlign: "center" as const,
          marginBottom: "22px",
        }}
      >
        <Text
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: palette.ink,
            margin: 0,
          }}
        >
          {props.verificationCode}
        </Text>
      </Section>

      <Button
        href={props.verifyUrl}
        style={{
          backgroundColor: palette.emerald,
          color: "#FFFFFF",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 22px",
          borderRadius: "8px",
          display: "inline-block",
        }}
      >
        Verify My Email
      </Button>

      <Text style={{ color: palette.subtle, fontSize: "13px", marginTop: "20px" }}>
        This code expires in {props.expiresMinutes ?? 30} minutes. If you did not create an account, you can safely
        ignore this email.
      </Text>
    </EmailFrame>
  );
}

export function PasswordResetTemplate(props: {
  recipientName: string;
  resetUrl: string;
  requestedFromIp?: string;
}) {
  return (
    <EmailFrame previewText="Reset your RSL Marketing password" badgeText="Password Reset">
      <Heading style={{ color: palette.ink, fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>
        Reset your password
      </Heading>
      <Text style={{ color: palette.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 20px" }}>
        Hi {props.recipientName}, we received a request to set a new password for your RSL Marketing account.
      </Text>

      <Button
        href={props.resetUrl}
        style={{
          backgroundColor: palette.emerald,
          color: "#FFFFFF",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 22px",
          borderRadius: "8px",
          display: "inline-block",
        }}
      >
        Choose a New Password
      </Button>

      <Text style={{ color: palette.subtle, fontSize: "13px", lineHeight: "20px", marginTop: "20px" }}>
        This link stays active for 30 minutes
        {props.requestedFromIp ? ` (requested from ${props.requestedFromIp})` : ""}. If you did not ask to reset your
        password, your existing password remains unchanged.
      </Text>
    </EmailFrame>
  );
}

export function TeamInvitationTemplate(props: {
  inviterName: string;
  businessName: string;
  roleLabel: string;
  acceptUrl: string;
}) {
  return (
    <EmailFrame
      previewText={`${props.inviterName} invited you to ${props.businessName}`}
      businessName={props.businessName}
      badgeText="Team Invitation"
    >
      <Heading style={{ color: palette.ink, fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>
        Join {props.businessName} on RSL Marketing
      </Heading>
      <Text style={{ color: palette.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 18px" }}>
        <strong>{props.inviterName}</strong> has invited you to collaborate on <strong>{props.businessName}</strong>{" "}
        with the <strong>{props.roleLabel}</strong> role.
      </Text>

      <Button
        href={props.acceptUrl}
        style={{
          backgroundColor: palette.emerald,
          color: "#FFFFFF",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 22px",
          borderRadius: "8px",
          display: "inline-block",
        }}
      >
        Accept Invitation & Sign In
      </Button>
    </EmailFrame>
  );
}

export function BillingAndWalletAlertTemplate(props: {
  businessName: string;
  headline: string;
  bodyText: string;
  walletBalanceFormatted: string;
  invoiceNumber?: string;
  billingUrl: string;
}) {
  return (
    <EmailFrame
      previewText={props.headline}
      businessName={props.businessName}
      badgeText="Wallet & Billing Notice"
    >
      <Heading style={{ color: palette.ink, fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>
        {props.headline}
      </Heading>
      <Text style={{ color: palette.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 18px" }}>
        {props.bodyText}
      </Text>

      <Section
        style={{
          backgroundColor: palette.amberTint,
          borderRadius: "10px",
          padding: "16px 18px",
          marginBottom: "22px",
        }}
      >
        <Text style={{ color: palette.amberInk, fontSize: "14px", fontWeight: 600, margin: 0 }}>
          Current Prepaid Wallet Balance: {props.walletBalanceFormatted}
          {props.invoiceNumber ? ` • GST Invoice: ${props.invoiceNumber}` : ""}
        </Text>
      </Section>

      <Button
        href={props.billingUrl}
        style={{
          backgroundColor: palette.emerald,
          color: "#FFFFFF",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 22px",
          borderRadius: "8px",
          display: "inline-block",
        }}
      >
        Open Plans & Prepaid Wallet
      </Button>
    </EmailFrame>
  );
}

export function StorageAndBackupReportTemplate(props: {
  businessName: string;
  operationTitle: string;
  summaryLine: string;
  checksumOrDetails: string;
  backupsUrl: string;
}) {
  return (
    <EmailFrame
      previewText={props.operationTitle}
      businessName={props.businessName}
      badgeText="Data & Storage Report"
    >
      <Heading style={{ color: palette.ink, fontSize: "22px", fontWeight: 700, margin: "0 0 12px" }}>
        {props.operationTitle}
      </Heading>
      <Text style={{ color: palette.muted, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" }}>
        {props.summaryLine}
      </Text>

      <Section
        style={{
          backgroundColor: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: "10px",
          padding: "14px 16px",
          marginBottom: "22px",
        }}
      >
        <Text style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: palette.ink, margin: 0 }}>
          {props.checksumOrDetails}
        </Text>
      </Section>

      <Button
        href={props.backupsUrl}
        style={{
          backgroundColor: palette.emerald,
          color: "#FFFFFF",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 22px",
          borderRadius: "8px",
          display: "inline-block",
        }}
      >
        View Database & Storage
      </Button>
    </EmailFrame>
  );
}
