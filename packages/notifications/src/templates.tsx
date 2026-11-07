import React from "react";

function Html(props: React.HTMLAttributes<HTMLHtmlElement>) {
  return <html {...props} />;
}

function Head(props: React.HTMLAttributes<HTMLHeadElement>) {
  return (
    <head {...props}>
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="x-apple-disable-message-reformatting" />
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

const palette = {
  canvas: "#EEF2F6",
  surface: "#FFFFFF",
  footerBg: "#F8FAFC",
  panelBg: "#F8FAFC",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  ink: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  subtle: "#94A3B8",
  navy: "#0B1220",
  indigo: "#4338CA",
  emerald: "#047857",
  emeraldSoft: "#ECFDF5",
  emeraldBorder: "#A7F3D0",
  amberInk: "#92400E",
  amberSoft: "#FFFBEB",
  amberBorder: "#FDE68A",
};

const fontSans =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const fontMono =
  "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

function formatEmailDate(): string {
  return new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function resolveAppBaseUrl(): string {
  return (process.env.APP_URL || "https://app.rapidshiftlabs.in").replace(/\/$/, "");
}

function DetailTable(props: { rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }> }) {
  const visible = props.rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== "");
  if (visible.length === 0) return null;

  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        backgroundColor: palette.panelBg,
        border: `1px solid ${palette.border}`,
        borderRadius: "10px",
        margin: "0 0 24px",
      }}
    >
      <tbody>
        {visible.map((row, idx) => {
          const isLast = idx === visible.length - 1;
          return (
            <tr key={row.label}>
              <td
                style={{
                  padding: "11px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: palette.muted,
                  borderBottom: isLast ? "none" : `1px solid ${palette.border}`,
                  width: "38%",
                  verticalAlign: "top",
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  padding: "11px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: palette.ink,
                  fontFamily: row.mono ? fontMono : fontSans,
                  borderBottom: isLast ? "none" : `1px solid ${palette.border}`,
                  textAlign: "right",
                  verticalAlign: "top",
                  wordBreak: "break-word",
                }}
              >
                {row.value}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ActionButton(props: {
  href: string;
  label: string;
  tone?: "navy" | "emerald" | "indigo";
}) {
  const bg =
    props.tone === "emerald"
      ? palette.emerald
      : props.tone === "indigo"
        ? palette.indigo
        : palette.navy;

  return (
    <div style={{ margin: "4px 0 22px" }}>
      <table role="presentation" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "separate" }}>
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: bg,
                borderRadius: "8px",
              }}
            >
              <a
                href={props.href}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  padding: "12px 24px",
                  fontFamily: fontSans,
                  fontSize: "13.5px",
                  fontWeight: 600,
                  lineHeight: "18px",
                  color: "#FFFFFF",
                  textDecoration: "none",
                  letterSpacing: "-0.01em",
                }}
              >
                {props.label}
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <p
        style={{
          margin: "14px 0 0",
          fontSize: "11.5px",
          lineHeight: "18px",
          color: palette.muted,
          wordBreak: "break-all",
        }}
      >
        Direct link:{" "}
        <a
          href={props.href}
          style={{
            color: palette.indigo,
            textDecoration: "underline",
          }}
        >
          {props.href}
        </a>
      </p>
    </div>
  );
}

function EmailFrame(props: {
  previewText: string;
  categoryLabel: string;
  businessName?: string;
  recipientEmail?: string;
  children: React.ReactNode;
}) {
  const appBase = resolveAppBaseUrl();
  const supportEmail = "app@rapidshiftlabs.in";
  const year = new Date().getFullYear();

  return (
    <Html lang="en">
      <Head />
      <Preview>{props.previewText}</Preview>
      <body
        style={{
          backgroundColor: palette.canvas,
          fontFamily: fontSans,
          margin: 0,
          padding: "36px 14px",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: "580px",
                    width: "100%",
                    backgroundColor: palette.surface,
                    border: `1px solid ${palette.borderStrong}`,
                    borderRadius: "14px",
                    overflow: "hidden",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                  }}
                >
                  <tbody>
                    {/* Multi-Tone Architectural Top Seam (Outlook-safe 3-column bar) */}
                    <tr>
                      <td style={{ padding: 0 }}>
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ width: "100%", borderCollapse: "collapse" }}
                        >
                          <tbody>
                            <tr>
                              <td
                                style={{
                                  width: "54%",
                                  height: "4px",
                                  backgroundColor: palette.navy,
                                  fontSize: 0,
                                  lineHeight: 0,
                                }}
                              >
                                &nbsp;
                              </td>
                              <td
                                style={{
                                  width: "26%",
                                  height: "4px",
                                  backgroundColor: palette.indigo,
                                  fontSize: 0,
                                  lineHeight: 0,
                                }}
                              >
                                &nbsp;
                              </td>
                              <td
                                style={{
                                  width: "20%",
                                  height: "4px",
                                  backgroundColor: palette.emerald,
                                  fontSize: 0,
                                  lineHeight: 0,
                                }}
                              >
                                &nbsp;
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Branded Masthead Header */}
                    <tr>
                      <td
                        style={{
                          padding: "24px 34px 20px",
                          borderBottom: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                        }}
                      >
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ width: "100%", borderCollapse: "collapse" }}
                        >
                          <tbody>
                            <tr>
                              <td align="left" style={{ verticalAlign: "middle" }}>
                                <a
                                  href={appBase}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ textDecoration: "none", display: "inline-block" }}
                                >
                                  <img
                                    src={`${appBase}/email-logo.png`}
                                    alt="RapidShift Labs"
                                    width={138}
                                    height={30}
                                    style={{
                                      height: "28px",
                                      width: "auto",
                                      display: "block",
                                      border: 0,
                                    }}
                                  />
                                </a>
                              </td>
                              <td align="right" style={{ verticalAlign: "middle" }}>
                                <div
                                  style={{
                                    fontSize: "10.5px",
                                    fontWeight: 700,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: palette.muted,
                                  }}
                                >
                                  {props.categoryLabel}
                                </div>
                                <div
                                  style={{
                                    marginTop: "2px",
                                    fontSize: "11px",
                                    fontFamily: fontMono,
                                    color: palette.subtle,
                                  }}
                                >
                                  {formatEmailDate()}
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {/* Main Document Content */}
                    <tr>
                      <td style={{ padding: "30px 34px 26px" }}>{props.children}</td>
                    </tr>

                    {/* Corporate Footer */}
                    <tr>
                      <td
                        style={{
                          padding: "22px 34px 26px",
                          backgroundColor: palette.footerBg,
                          borderTop: `1px solid ${palette.border}`,
                        }}
                      >
                        <table
                          role="presentation"
                          width="100%"
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ width: "100%", borderCollapse: "collapse" }}
                        >
                          <tbody>
                            <tr>
                              <td style={{ verticalAlign: "middle", paddingBottom: "12px" }}>
                                <table role="presentation" cellPadding={0} cellSpacing={0}>
                                  <tbody>
                                    <tr>
                                      <td style={{ paddingRight: "10px", verticalAlign: "middle" }}>
                                        <img
                                          src={`${appBase}/logo.png`}
                                          alt="RapidShift Labs"
                                          width={20}
                                          height={20}
                                          style={{
                                            width: "20px",
                                            height: "20px",
                                            display: "block",
                                            border: 0,
                                          }}
                                        />
                                      </td>
                                      <td style={{ verticalAlign: "middle" }}>
                                        <span
                                          style={{
                                            fontSize: "12.5px",
                                            fontWeight: 700,
                                            color: palette.ink,
                                          }}
                                        >
                                          RapidShift Labs
                                        </span>
                                        <span
                                          style={{
                                            fontSize: "12px",
                                            color: palette.muted,
                                            paddingLeft: "6px",
                                          }}
                                        >
                                          Accounting, Messaging &amp; Growth Suite
                                        </span>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                            </tr>

                            <tr>
                              <td
                                style={{
                                  fontSize: "12px",
                                  lineHeight: "19px",
                                  color: palette.muted,
                                  paddingBottom: "12px",
                                }}
                              >
                                {props.businessName ? (
                                  <>
                                    Issued for workspace <strong style={{ color: palette.body }}>{props.businessName}</strong>.{" "}
                                  </>
                                ) : null}
                                Support and billing desk:{" "}
                                <a
                                  href={`mailto:${supportEmail}`}
                                  style={{
                                    color: palette.ink,
                                    fontWeight: 600,
                                    textDecoration: "underline",
                                  }}
                                >
                                  {supportEmail}
                                </a>
                              </td>
                            </tr>

                            <tr>
                              <td
                                style={{
                                  fontSize: "11.5px",
                                  lineHeight: "18px",
                                  color: palette.muted,
                                  paddingTop: "10px",
                                  borderTop: `1px solid ${palette.border}`,
                                }}
                              >
                                <a
                                  href={`${appBase}/login`}
                                  style={{ color: palette.body, textDecoration: "none", fontWeight: 500 }}
                                >
                                  Workspace Sign In
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>&bull;</span>
                                <a
                                  href={`${appBase}/privacy`}
                                  style={{ color: palette.body, textDecoration: "none", fontWeight: 500 }}
                                >
                                  Privacy Policy
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>&bull;</span>
                                <a
                                  href={`${appBase}/terms`}
                                  style={{ color: palette.body, textDecoration: "none", fontWeight: 500 }}
                                >
                                  Terms
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>&bull;</span>
                                <a
                                  href={`${appBase}/legal`}
                                  style={{ color: palette.body, textDecoration: "none", fontWeight: 500 }}
                                >
                                  GST &amp; Compliance
                                </a>
                                <div style={{ marginTop: "6px", color: palette.subtle, fontSize: "11px" }}>
                                  &copy; {year} RapidShift Labs. Transactional system message; logged in workspace activity history.
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </Html>
  );
}

export function EmailVerificationTemplate(props: {
  recipientName: string;
  recipientEmail?: string;
  verificationCode: string;
  verifyUrl: string;
  expiresMinutes?: number;
}) {
  const validity = `${props.expiresMinutes ?? 30} minutes`;

  return (
    <EmailFrame
      previewText={`${props.verificationCode} is your RapidShift Labs verification code`}
      categoryLabel="Email Verification"
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        Verify your email address
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        Hello {props.recipientName}, enter the verification code below in your browser window or select the button to confirm your RapidShift Labs account.
      </p>

      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.panelBg,
          border: `1px solid ${palette.borderStrong}`,
          borderRadius: "10px",
          marginBottom: "22px",
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "20px 18px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: palette.muted,
                  marginBottom: "6px",
                }}
              >
                One-Time Verification Code
              </div>
              <div
                style={{
                  fontFamily: fontMono,
                  fontSize: "30px",
                  fontWeight: 700,
                  letterSpacing: "0.24em",
                  color: palette.navy,
                }}
              >
                {props.verificationCode}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <DetailTable
        rows={[
          { label: "Account Holder", value: props.recipientName },
          ...(props.recipientEmail ? [{ label: "Email Address", value: props.recipientEmail, mono: true }] : []),
          { label: "Code Validity", value: validity },
        ]}
      />

      <ActionButton href={props.verifyUrl} label="Confirm Email Address" tone="emerald" />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        RapidShift Labs staff will never ask for this code by phone, email, or WhatsApp. If you did not initiate this request, no action is needed.
      </p>
    </EmailFrame>
  );
}

export function PasswordResetTemplate(props: {
  recipientName: string;
  recipientEmail?: string;
  resetUrl: string;
  requestedFromIp?: string;
}) {
  return (
    <EmailFrame
      previewText="Password reset instructions for your RapidShift Labs account"
      categoryLabel="Account Security"
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        Password reset request
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        Hello {props.recipientName}, a password reset was requested for your RapidShift Labs login. Use the button below within the next 30 minutes to set a new password.
      </p>

      <DetailTable
        rows={[
          { label: "Account Holder", value: props.recipientName },
          ...(props.recipientEmail ? [{ label: "Login Email", value: props.recipientEmail, mono: true }] : []),
          ...(props.requestedFromIp ? [{ label: "Origin IP", value: props.requestedFromIp, mono: true }] : []),
          { label: "Link Expiry", value: "30 minutes (single use)" },
        ]}
      />

      <ActionButton href={props.resetUrl} label="Set New Password" tone="navy" />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        Completing a password reset signs out all active browser sessions immediately. If you did not request this change, your current password remains active.
      </p>
    </EmailFrame>
  );
}

export function TeamInvitationTemplate(props: {
  inviterName: string;
  businessName: string;
  roleLabel: string;
  recipientEmail?: string;
  acceptUrl: string;
}) {
  return (
    <EmailFrame
      previewText={`${props.inviterName} added you to ${props.businessName} on RapidShift Labs`}
      categoryLabel="Workspace Access"
      businessName={props.businessName}
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        Workspace invitation for {props.businessName}
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        <strong>{props.inviterName}</strong> has granted you team access to{" "}
        <strong>{props.businessName}</strong> on RapidShift Labs. Review your assigned permissions below and accept the invitation to sign in.
      </p>

      <DetailTable
        rows={[
          { label: "Business Workspace", value: props.businessName },
          { label: "Assigned Role", value: props.roleLabel },
          { label: "Invited By", value: props.inviterName },
          ...(props.recipientEmail ? [{ label: "Invited Email", value: props.recipientEmail, mono: true }] : []),
        ]}
      />

      <ActionButton href={props.acceptUrl} label="Accept Workspace Access" tone="indigo" />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        Your access is scoped strictly to the {props.roleLabel} role within {props.businessName}. Contact your workspace administrator if you need role adjustments.
      </p>
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
      previewText={`${props.headline} (${props.businessName})`}
      categoryLabel="Billing & Wallet"
      businessName={props.businessName}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        {props.headline}
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        {props.bodyText}
      </p>

      <DetailTable
        rows={[
          { label: "Business Workspace", value: props.businessName },
          { label: "Prepaid Wallet Balance", value: props.walletBalanceFormatted, mono: true },
          ...(props.invoiceNumber
            ? [{ label: "GST Tax Invoice #", value: props.invoiceNumber, mono: true }]
            : []),
        ]}
      />

      <ActionButton href={props.billingUrl} label="Open Plans, Wallet & GST Invoices" tone="emerald" />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        Tax invoices (SAC 998314) and wallet ledger entries are available for download anytime inside your workspace under Plans &amp; Wallet.
      </p>
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
      previewText={`${props.operationTitle} (${props.businessName})`}
      categoryLabel="Backups & Storage"
      businessName={props.businessName}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        {props.operationTitle}
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 20px",
        }}
      >
        {props.summaryLine}
      </p>

      <DetailTable
        rows={[
          { label: "Business Workspace", value: props.businessName },
          { label: "Operation", value: props.operationTitle },
        ]}
      />

      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.navy,
          borderRadius: "10px",
          marginBottom: "22px",
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "14px 16px" }}>
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: palette.subtle,
                  marginBottom: "4px",
                }}
              >
                Verification Record
              </div>
              <div
                style={{
                  fontFamily: fontMono,
                  fontSize: "12px",
                  lineHeight: "18px",
                  color: "#E2E8F0",
                  wordBreak: "break-all",
                }}
              >
                {props.checksumOrDetails}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <ActionButton href={props.backupsUrl} label="Open Backups & Storage" tone="navy" />
    </EmailFrame>
  );
}

export function SmtpDiagnosticTemplate(props: {
  recipientEmail: string;
  smtpHost: string;
  smtpPort: number;
  fromHeader: string;
  credentialSource: string;
  adminCredentialsUrl: string;
}) {
  return (
    <EmailFrame
      previewText={`Outbound SMTP verified via ${props.smtpHost}:${props.smtpPort}`}
      categoryLabel="SMTP Diagnostics"
      businessName="RapidShift Labs Control Plane"
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: "28px",
          margin: "0 0 10px",
        }}
      >
        Outbound SMTP delivery verified
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        This test message confirms that RapidShift Labs can dispatch transactional emails (verification codes, password resets, team invitations, and GST billing notices) through your configured mail server.
      </p>

      <DetailTable
        rows={[
          { label: "SMTP Server", value: `${props.smtpHost}:${props.smtpPort}`, mono: true },
          { label: "Sender Header", value: props.fromHeader, mono: true },
          { label: "Test Recipient", value: props.recipientEmail, mono: true },
          { label: "Credential Source", value: props.credentialSource },
        ]}
      />

      <ActionButton
        href={props.adminCredentialsUrl}
        label="Return to Platform Credentials"
        tone="indigo"
      />
    </EmailFrame>
  );
}
