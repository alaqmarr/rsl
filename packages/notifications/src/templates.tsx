import React from "react";

export const EMAIL_HEADER_LOGO_PUBLIC_PATH = "/email-logo.png";
export const EMAIL_FOOTER_LOGO_PUBLIC_PATH = "/logo.png";
export const EMAIL_HEADER_LOGO_CID = "rsl-header-logo@rapidshiftlabs.in";
export const EMAIL_FOOTER_LOGO_CID = "rsl-footer-mark@rapidshiftlabs.in";

type DomainAccentTone = "emerald" | "amber" | "indigo" | "teal" | "violet" | "sky";

function Html(props: React.HTMLAttributes<HTMLHtmlElement>) {
  return <html {...props} />;
}

function Head(props: React.HTMLAttributes<HTMLHeadElement>) {
  return (
    <head {...props}>
      <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="x-apple-disable-message-reformatting" />
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
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
  canvas: "#EDF1F7",
  surface: "#FFFFFF",
  footerBg: "#F8FAFC",
  panelBg: "#F8FAFC",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  cardBorder: "#D8E1EC",
  ink: "#0F172A",
  body: "#334155",
  muted: "#64748B",
  subtle: "#94A3B8",
  navy: "#0B1220",
  navyElevated: "#131C31",
  navyBorder: "#1E293B",
  indigo: "#4338CA",
  indigoSoft: "#EEF2FF",
  indigoBorder: "#C7D2FE",
  indigoInk: "#3730A3",
  emerald: "#047857",
  emeraldBright: "#10B981",
  emeraldSoft: "#ECFDF5",
  emeraldBorder: "#A7F3D0",
  emeraldInk: "#065F46",
  teal: "#0F766E",
  tealSoft: "#F0FDFA",
  tealBorder: "#99F6E4",
  amber: "#D97706",
  amberSoft: "#FFFBEB",
  amberBorder: "#FDE68A",
  amberInk: "#92400E",
  violet: "#6D28D9",
  violetSoft: "#F5F3FF",
  violetBorder: "#DDD6FE",
  sky: "#0284C7",
  skySoft: "#F0F9FF",
  skyBorder: "#BAE6FD",
  skyInk: "#075985",
};

const accentSpecs: Record<
  DomainAccentTone,
  {
    barPrimary: string;
    barSecondary: string;
    pillBg: string;
    pillBorder: string;
    pillInk: string;
    dotColor: string;
  }
> = {
  emerald: {
    barPrimary: "#059669",
    barSecondary: "#34D399",
    pillBg: palette.emeraldSoft,
    pillBorder: palette.emeraldBorder,
    pillInk: palette.emeraldInk,
    dotColor: "#059669",
  },
  amber: {
    barPrimary: "#D97706",
    barSecondary: "#FBBF24",
    pillBg: palette.amberSoft,
    pillBorder: palette.amberBorder,
    pillInk: palette.amberInk,
    dotColor: "#D97706",
  },
  indigo: {
    barPrimary: "#4338CA",
    barSecondary: "#818CF8",
    pillBg: palette.indigoSoft,
    pillBorder: palette.indigoBorder,
    pillInk: palette.indigoInk,
    dotColor: "#4338CA",
  },
  teal: {
    barPrimary: "#047857",
    barSecondary: "#14B8A6",
    pillBg: palette.tealSoft,
    pillBorder: palette.tealBorder,
    pillInk: palette.teal,
    dotColor: "#0D9488",
  },
  violet: {
    barPrimary: "#4338CA",
    barSecondary: "#7C3AED",
    pillBg: palette.violetSoft,
    pillBorder: palette.violetBorder,
    pillInk: palette.violet,
    dotColor: "#6D28D9",
  },
  sky: {
    barPrimary: "#0284C7",
    barSecondary: "#10B981",
    pillBg: palette.skySoft,
    pillBorder: palette.skyBorder,
    pillInk: palette.skyInk,
    dotColor: "#0284C7",
  },
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

function getWorkspaceMonogram(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "RS";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

function DetailTable(props: {
  title?: string;
  rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
}) {
  const visible = props.rows.filter(
    (r) => r.value !== undefined && r.value !== null && r.value !== ""
  );
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
        borderRadius: "12px",
        overflow: "hidden",
        margin: "0 0 24px",
      }}
    >
      <tbody>
        {props.title ? (
          <tr>
            <td
              colSpan={2}
              style={{
                padding: "10px 18px",
                fontSize: "10.5px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: palette.muted,
                backgroundColor: "#F1F5F9",
                borderBottom: `1px solid ${palette.border}`,
              }}
            >
              {props.title}
            </td>
          </tr>
        ) : null}
        {visible.map((row, idx) => {
          const isLast = idx === visible.length - 1;
          return (
            <tr key={row.label}>
              <td
                style={{
                  padding: "11px 18px",
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: palette.muted,
                  borderBottom: isLast ? "none" : `1px solid ${palette.border}`,
                  width: "40%",
                  verticalAlign: "top",
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  padding: "11px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: palette.ink,
                  fontFamily: row.mono ? fontMono : fontSans,
                  fontVariantNumeric: "tabular-nums",
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
    <div style={{ margin: "4px 0 24px" }}>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: "separate" }}
      >
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: bg,
                borderRadius: "9px",
                border: "1px solid rgba(15, 23, 42, 0.12)",
                boxShadow: "0 2px 6px rgba(15, 23, 42, 0.12)",
              }}
            >
              <a
                href={props.href}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  padding: "13px 26px",
                  fontFamily: fontSans,
                  fontSize: "13.5px",
                  fontWeight: 600,
                  lineHeight: "18px",
                  color: "#FFFFFF",
                  textDecoration: "none",
                  letterSpacing: "-0.01em",
                }}
              >
                {props.label} &rarr;
              </a>
            </td>
          </tr>
        </tbody>
      </table>

      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          marginTop: "16px",
          borderCollapse: "collapse",
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                padding: "10px 14px",
                backgroundColor: palette.panelBg,
                border: `1px solid ${palette.border}`,
                borderRadius: "8px",
                fontSize: "11.5px",
                lineHeight: "17px",
                color: palette.muted,
                wordBreak: "break-all",
              }}
            >
              <span style={{ fontWeight: 600, color: palette.body }}>
                Button not opening?
              </span>{" "}
              Copy and paste this link into your browser:{" "}
              <a
                href={props.href}
                style={{
                  color: palette.indigo,
                  fontFamily: fontMono,
                  fontSize: "11px",
                  textDecoration: "underline",
                }}
              >
                {props.href}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function EmailFrame(props: {
  previewText: string;
  categoryLabel: string;
  accentTone?: DomainAccentTone;
  businessName?: string;
  recipientEmail?: string;
  children: React.ReactNode;
}) {
  const appBase = resolveAppBaseUrl();
  const supportEmail = "app@rapidshiftlabs.in";
  const year = new Date().getFullYear();
  const accent = accentSpecs[props.accentTone ?? "indigo"];

  return (
    <Html lang="en">
      <Head />
      <Preview>{props.previewText}</Preview>
      <body
        style={{
          backgroundColor: palette.canvas,
          fontFamily: fontSans,
          margin: 0,
          padding: "40px 14px",
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
                    backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                    border: `1px solid ${palette.cardBorder}`,
                    borderRadius: "16px",
                    overflow: "hidden",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    boxShadow:
                      "0 14px 34px -10px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.03)",
                  }}
                >
                  <tbody>
                    {/* Domain-Coded 3-Segment Chromatic Top Seam */}
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
                                  width: "56%",
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
                                  backgroundColor: accent.barPrimary,
                                  fontSize: 0,
                                  lineHeight: 0,
                                }}
                              >
                                &nbsp;
                              </td>
                              <td
                                style={{
                                  width: "18%",
                                  height: "4px",
                                  backgroundColor: accent.barSecondary,
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

                    {/* Branded Masthead Header with Official /public Logo & Status Pill */}
                    <tr>
                      <td
                        style={{
                          padding: "26px 36px 22px",
                          borderBottom: `1px solid ${palette.border}`,
                          backgroundColor: palette.surface,
                          backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
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
                                  style={{
                                    textDecoration: "none",
                                    display: "inline-block",
                                    backgroundColor: "#FFFFFF",
                                    backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                                    borderRadius: "6px",
                                  }}
                                >
                                  <img
                                    src={EMAIL_HEADER_LOGO_PUBLIC_PATH}
                                    alt="RapidShift Labs"
                                    width={116}
                                    height={34}
                                    style={{
                                      width: "116px",
                                      height: "34px",
                                      display: "block",
                                      border: 0,
                                    }}
                                  />
                                </a>
                              </td>
                              <td align="right" style={{ verticalAlign: "middle" }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "4px 11px",
                                    borderRadius: "999px",
                                    backgroundColor: accent.pillBg,
                                    border: `1px solid ${accent.pillBorder}`,
                                    color: accent.pillInk,
                                    fontSize: "10.5px",
                                    fontWeight: 700,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                    lineHeight: "14px",
                                  }}
                                >
                                  <span style={{ color: accent.dotColor, paddingRight: "5px" }}>
                                    &#9679;
                                  </span>
                                  {props.categoryLabel}
                                </span>
                                <div
                                  style={{
                                    marginTop: "5px",
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

                    {/* Main Document Body */}
                    <tr>
                      <td
                        style={{
                          padding: "32px 36px 28px",
                          backgroundColor: palette.surface,
                          backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                        }}
                      >
                        {props.children}
                      </td>
                    </tr>

                    {/* Editorial Corporate Footer with Official /public Mark */}
                    <tr>
                      <td
                        style={{
                          padding: "24px 36px 28px",
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
                              <td style={{ verticalAlign: "middle", paddingBottom: "14px" }}>
                                <table role="presentation" cellPadding={0} cellSpacing={0}>
                                  <tbody>
                                    <tr>
                                      <td style={{ paddingRight: "11px", verticalAlign: "middle" }}>
                                        <div
                                          style={{
                                            width: "26px",
                                            height: "26px",
                                            borderRadius: "7px",
                                            backgroundColor: "#FFFFFF",
                                            backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                                            border: `1px solid ${palette.border}`,
                                            padding: "1px",
                                            boxSizing: "border-box",
                                          }}
                                        >
                                          <img
                                            src={EMAIL_FOOTER_LOGO_PUBLIC_PATH}
                                            alt="RapidShift Labs"
                                            width={22}
                                            height={22}
                                            style={{
                                              width: "22px",
                                              height: "22px",
                                              display: "block",
                                              borderRadius: "5px",
                                              border: 0,
                                            }}
                                          />
                                        </div>
                                      </td>
                                      <td style={{ verticalAlign: "middle" }}>
                                        <div
                                          style={{
                                            fontSize: "13px",
                                            fontWeight: 700,
                                            color: palette.ink,
                                            lineHeight: "17px",
                                          }}
                                        >
                                          RapidShift Labs
                                        </div>
                                        <div
                                          style={{
                                            fontSize: "11.5px",
                                            color: palette.muted,
                                            lineHeight: "16px",
                                          }}
                                        >
                                          Tally Prime, WhatsApp Cloud &amp; Growth Suite
                                        </div>
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
                                  paddingBottom: "14px",
                                }}
                              >
                                {props.businessName ? (
                                  <>
                                    Workspace:{" "}
                                    <strong style={{ color: palette.body }}>
                                      {props.businessName}
                                    </strong>
                                    .{" "}
                                  </>
                                ) : null}
                                {props.recipientEmail ? (
                                  <>
                                    Sent to{" "}
                                    <span
                                      style={{
                                        fontFamily: fontMono,
                                        fontSize: "11.5px",
                                        color: palette.body,
                                      }}
                                    >
                                      {props.recipientEmail}
                                    </span>
                                    .{" "}
                                  </>
                                ) : null}
                                Support &amp; billing:{" "}
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
                                  paddingTop: "12px",
                                  borderTop: `1px solid ${palette.border}`,
                                }}
                              >
                                <a
                                  href={`${appBase}/login`}
                                  style={{
                                    color: palette.body,
                                    textDecoration: "none",
                                    fontWeight: 600,
                                  }}
                                >
                                  Workspace Sign In
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>
                                  &bull;
                                </span>
                                <a
                                  href={`${appBase}/billing`}
                                  style={{
                                    color: palette.body,
                                    textDecoration: "none",
                                    fontWeight: 500,
                                  }}
                                >
                                  Plans &amp; GST
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>
                                  &bull;
                                </span>
                                <a
                                  href={`${appBase}/privacy`}
                                  style={{
                                    color: palette.body,
                                    textDecoration: "none",
                                    fontWeight: 500,
                                  }}
                                >
                                  Privacy
                                </a>
                                <span style={{ padding: "0 8px", color: palette.subtle }}>
                                  &bull;
                                </span>
                                <a
                                  href={`${appBase}/terms`}
                                  style={{
                                    color: palette.body,
                                    textDecoration: "none",
                                    fontWeight: 500,
                                  }}
                                >
                                  Terms
                                </a>
                                <div
                                  style={{
                                    marginTop: "6px",
                                    color: palette.subtle,
                                    fontSize: "11px",
                                  }}
                                >
                                  &copy; {year} RapidShift Labs. Automated transactional record; no
                                  marketing promotions are sent on this channel.
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
  const cleanCode = props.verificationCode.trim();
  const digits = cleanCode.split("");

  return (
    <EmailFrame
      previewText={`${cleanCode} is your RapidShift Labs verification code`}
      categoryLabel="Verification Code"
      accentTone="emerald"
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
          margin: "0 0 10px",
        }}
      >
        Confirm your email address
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 24px",
        }}
      >
        Hello {props.recipientName}, enter the 6-digit verification code below in your open
        RapidShift Labs browser window, or confirm your account directly using the button below.
      </p>

      {/* Segmented Tactile OTP Keycap Vault */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.panelBg,
          border: `1px solid ${palette.borderStrong}`,
          borderRadius: "14px",
          marginBottom: "24px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "22px 18px 18px", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: palette.muted,
                  marginBottom: "14px",
                }}
              >
                One-Time Security Passcode
              </div>

              <table
                role="presentation"
                align="center"
                cellPadding={0}
                cellSpacing={0}
                style={{ margin: "0 auto", borderCollapse: "separate" }}
              >
                <tbody>
                  <tr>
                    {digits.map((digit, idx) => (
                      <td
                        key={`${idx}-${digit}`}
                        style={{
                          padding: "0 4px",
                        }}
                      >
                        <div
                          style={{
                            width: "42px",
                            height: "50px",
                            lineHeight: "50px",
                            backgroundColor: "#FFFFFF",
                            backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                            border: `1px solid ${palette.borderStrong}`,
                            borderBottom: `2px solid ${palette.subtle}`,
                            borderRadius: "10px",
                            fontFamily: fontMono,
                            fontSize: "23px",
                            fontWeight: 700,
                            color: palette.navy,
                            textAlign: "center",
                          }}
                        >
                          {digit}
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>

              <div
                style={{
                  marginTop: "14px",
                  fontSize: "12px",
                  color: palette.muted,
                }}
              >
                Copyable code:{" "}
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    backgroundColor: "#FFFFFF",
                    border: `1px solid ${palette.border}`,
                    fontFamily: fontMono,
                    fontWeight: 700,
                    color: palette.ink,
                    letterSpacing: "0.06em",
                  }}
                >
                  {cleanCode}
                </span>
                <span style={{ padding: "0 7px", color: palette.subtle }}>&bull;</span>
                <span>Expires in {validity}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <DetailTable
        rows={[
          { label: "Account Holder", value: props.recipientName },
          ...(props.recipientEmail
            ? [{ label: "Email Address", value: props.recipientEmail, mono: true }]
            : []),
          { label: "Passcode Validity", value: `${validity} (single use)` },
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
        RapidShift Labs staff will never ask for this code by phone, email, or WhatsApp. If you did
        not initiate this signup or sign-in check, no action is needed.
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
      categoryLabel="Security Notice"
      accentTone="amber"
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
          margin: "0 0 10px",
        }}
      >
        Reset your account password
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 20px",
        }}
      >
        Hello {props.recipientName}, we received a request to reset the password for your RapidShift
        Labs login. Use the secure button below within the next 30 minutes to choose a new password.
      </p>

      {/* Calm Security Context Callout */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.amberSoft,
          border: `1px solid ${palette.amberBorder}`,
          borderLeft: `4px solid ${palette.amber}`,
          borderRadius: "10px",
          marginBottom: "22px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "13px 16px" }}>
              <div
                style={{
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: palette.amberInk,
                  marginBottom: "3px",
                }}
              >
                Single-use recovery token issued
              </div>
              <div
                style={{
                  fontSize: "12px",
                  lineHeight: "18px",
                  color: palette.amberInk,
                }}
              >
                Your existing password remains active until you submit a new one. Completing the
                reset automatically signs out all active browser sessions.
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <DetailTable
        title="Security Request Details"
        rows={[
          { label: "Account Holder", value: props.recipientName },
          ...(props.recipientEmail
            ? [{ label: "Login Email", value: props.recipientEmail, mono: true }]
            : []),
          ...(props.requestedFromIp
            ? [{ label: "Request Origin IP", value: props.requestedFromIp, mono: true }]
            : []),
          { label: "Token Expiry", value: "30 minutes (single use)" },
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
        Did not request a password change? You can safely ignore this email and your credentials
        will remain unchanged.
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
  const monogram = getWorkspaceMonogram(props.businessName);

  return (
    <EmailFrame
      previewText={`${props.inviterName} invited you to ${props.businessName} on RapidShift Labs`}
      categoryLabel="Workspace Invite"
      accentTone="indigo"
      businessName={props.businessName}
      recipientEmail={props.recipientEmail}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
          margin: "0 0 10px",
        }}
      >
        Join {props.businessName} on RapidShift Labs
      </h1>
      <p
        style={{
          color: palette.body,
          fontSize: "14.5px",
          lineHeight: "23px",
          margin: "0 0 22px",
        }}
      >
        <strong>{props.inviterName}</strong> has invited you to collaborate inside the{" "}
        <strong>{props.businessName}</strong> workspace. Review your assigned access pass below and
        accept the invitation to sign in.
      </p>

      {/* Workspace Membership Identity Pass */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.panelBg,
          border: `1px solid ${palette.indigoBorder}`,
          borderRadius: "14px",
          overflow: "hidden",
          marginBottom: "24px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "18px 20px" }}>
              <table
                role="presentation"
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                style={{ width: "100%", borderCollapse: "collapse" }}
              >
                <tbody>
                  <tr>
                    <td style={{ width: "56px", verticalAlign: "middle" }}>
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          lineHeight: "44px",
                          borderRadius: "11px",
                          backgroundColor: palette.indigo,
                          color: "#FFFFFF",
                          fontSize: "15px",
                          fontWeight: 700,
                          textAlign: "center",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {monogram}
                      </div>
                    </td>
                    <td style={{ verticalAlign: "middle", paddingRight: "10px" }}>
                      <div
                        style={{
                          fontSize: "15.5px",
                          fontWeight: 700,
                          color: palette.ink,
                          lineHeight: "21px",
                        }}
                      >
                        {props.businessName}
                      </div>
                      <div
                        style={{
                          fontSize: "12.5px",
                          color: palette.muted,
                          lineHeight: "18px",
                          marginTop: "2px",
                        }}
                      >
                        Invited by {props.inviterName}
                      </div>
                    </td>
                    <td align="right" style={{ verticalAlign: "middle" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "5px 11px",
                          borderRadius: "999px",
                          backgroundColor: palette.indigoSoft,
                          border: `1px solid ${palette.indigoBorder}`,
                          color: palette.indigoInk,
                          fontSize: "11.5px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {props.roleLabel}
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
                padding: "12px 20px",
                backgroundColor: "#FFFFFF",
                backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
                borderTop: `1px dashed ${palette.borderStrong}`,
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
                    <td style={{ fontSize: "12px", color: palette.muted }}>
                      Invited Login:{" "}
                      <strong
                        style={{
                          fontFamily: fontMono,
                          fontSize: "12px",
                          color: palette.ink,
                        }}
                      >
                        {props.recipientEmail || "Assigned Member"}
                      </strong>
                    </td>
                    <td
                      align="right"
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 600,
                        color: palette.emerald,
                      }}
                    >
                      Role-Scoped RBAC
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <ActionButton href={props.acceptUrl} label="Accept Workspace Invitation" tone="indigo" />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        Your permissions are scoped to the <strong>{props.roleLabel}</strong> role inside{" "}
        {props.businessName}. Reach out to {props.inviterName} if you require additional module
        permissions.
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
      categoryLabel="GST Ledger Receipt"
      accentTone="teal"
      businessName={props.businessName}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
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
          margin: "0 0 24px",
        }}
      >
        {props.bodyText}
      </p>

      {/* Stripe / Mercury Style Perforated Financial Ledger Slip */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: "#FFFFFF",
          backgroundImage: "linear-gradient(#FFFFFF, #FFFFFF)",
          border: `1px solid ${palette.borderStrong}`,
          borderRadius: "14px",
          overflow: "hidden",
          marginBottom: "24px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                padding: "18px 20px",
                backgroundColor: palette.tealSoft,
                borderBottom: `1px dashed ${palette.tealBorder}`,
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
                    <td style={{ verticalAlign: "top" }}>
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: palette.teal,
                          marginBottom: "4px",
                        }}
                      >
                        Prepaid Wallet Balance
                      </div>
                      <div
                        style={{
                          fontFamily: fontMono,
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "23px",
                          fontWeight: 700,
                          color: palette.emerald,
                          lineHeight: "28px",
                        }}
                      >
                        {props.walletBalanceFormatted}
                      </div>
                    </td>
                    <td align="right" style={{ verticalAlign: "top" }}>
                      <div
                        style={{
                          fontSize: "10.5px",
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: palette.muted,
                          marginBottom: "5px",
                        }}
                      >
                        {props.invoiceNumber ? "GST Tax Invoice" : "Ledger Classification"}
                      </div>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: "7px",
                          backgroundColor: "#FFFFFF",
                          border: `1px solid ${palette.borderStrong}`,
                          fontFamily: fontMono,
                          fontSize: "12px",
                          fontWeight: 700,
                          color: palette.ink,
                        }}
                      >
                        {props.invoiceNumber || "SAC 998314"}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
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
                        padding: "11px 20px",
                        fontSize: "12.5px",
                        color: palette.muted,
                        borderBottom: `1px solid ${palette.border}`,
                      }}
                    >
                      Business Workspace
                    </td>
                    <td
                      align="right"
                      style={{
                        padding: "11px 20px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: palette.ink,
                        borderBottom: `1px solid ${palette.border}`,
                      }}
                    >
                      {props.businessName}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: "11px 20px",
                        fontSize: "12.5px",
                        color: palette.muted,
                        borderBottom: props.invoiceNumber ? `1px solid ${palette.border}` : "none",
                      }}
                    >
                      HSN / SAC Code
                    </td>
                    <td
                      align="right"
                      style={{
                        padding: "11px 20px",
                        fontSize: "12.5px",
                        fontFamily: fontMono,
                        fontWeight: 600,
                        color: palette.ink,
                        borderBottom: props.invoiceNumber ? `1px solid ${palette.border}` : "none",
                      }}
                    >
                      998314 (Cloud &amp; Accounting Software)
                    </td>
                  </tr>
                  {props.invoiceNumber ? (
                    <tr>
                      <td
                        style={{
                          padding: "11px 20px",
                          fontSize: "12.5px",
                          color: palette.muted,
                        }}
                      >
                        Document Status
                      </td>
                      <td
                        align="right"
                        style={{
                          padding: "11px 20px",
                          fontSize: "12.5px",
                          fontWeight: 700,
                          color: palette.emerald,
                        }}
                      >
                        Issued &amp; Ready for GST Filing
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <ActionButton
        href={props.billingUrl}
        label="Open Plans, Wallet & GST Invoices"
        tone="emerald"
      />

      <p
        style={{
          color: palette.muted,
          fontSize: "12.5px",
          lineHeight: "19px",
          margin: 0,
        }}
      >
        PDF tax invoices (SAC 998314) and per-message WhatsApp wallet entries remain available for
        download inside your workspace under Plans &amp; Wallet.
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
      categoryLabel="Vault Integrity"
      accentTone="violet"
      businessName={props.businessName}
    >
      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
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
          margin: "0 0 22px",
        }}
      >
        {props.summaryLine}
      </p>

      {/* Cryptographic Vault Console Card */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.navy,
          border: `1px solid ${palette.navyBorder}`,
          borderRadius: "12px",
          overflow: "hidden",
          marginBottom: "22px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                padding: "9px 16px",
                backgroundColor: palette.navyElevated,
                borderBottom: `1px solid ${palette.navyBorder}`,
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
                    <td
                      style={{
                        fontSize: "10px",
                        fontFamily: fontMono,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: palette.subtle,
                      }}
                    >
                      Archive Verification Digest
                    </td>
                    <td
                      align="right"
                      style={{
                        fontSize: "10px",
                        fontFamily: fontMono,
                        fontWeight: 700,
                        color: "#34D399",
                      }}
                    >
                      AES-256-GCM &bull; VERIFIED
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style={{ padding: "15px 16px" }}>
              <div
                style={{
                  fontFamily: fontMono,
                  fontSize: "12px",
                  lineHeight: "19px",
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

      <DetailTable
        rows={[
          { label: "Business Workspace", value: props.businessName },
          { label: "Archive Event", value: props.operationTitle },
          { label: "Cipher & Checksum", value: "AES-256-GCM + SHA-256", mono: true },
        ]}
      />

      <ActionButton href={props.backupsUrl} label="Inspect Backup Archives" tone="navy" />
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
  const tlsMode =
    props.smtpPort === 465
      ? "Implicit TLS (Port 465)"
      : props.smtpPort === 587
        ? "STARTTLS (Port 587)"
        : `Custom Port ${props.smtpPort}`;

  return (
    <EmailFrame
      previewText={`Outbound SMTP verified via ${props.smtpHost}:${props.smtpPort}`}
      categoryLabel="SMTP Telemetry"
      accentTone="sky"
      businessName="RapidShift Labs Control Plane"
      recipientEmail={props.recipientEmail}
    >
      {/* Live Handshake Pass Banner */}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{
          width: "100%",
          backgroundColor: palette.emeraldSoft,
          border: `1px solid ${palette.emeraldBorder}`,
          borderRadius: "10px",
          marginBottom: "20px",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            <td style={{ padding: "11px 16px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: fontMono,
                  fontWeight: 700,
                  color: palette.emeraldInk,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                &#10003; Handshake Passed
              </span>
              <span style={{ padding: "0 8px", color: palette.emeraldBright }}>&bull;</span>
              <span
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: palette.emeraldInk,
                }}
              >
                Authenticated outbound relay is live
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <h1
        style={{
          color: palette.ink,
          fontSize: "21px",
          fontWeight: 700,
          letterSpacing: "-0.025em",
          lineHeight: "29px",
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
        This diagnostic dispatch confirms that RapidShift Labs can deliver OTP passcodes, password
        recovery links, workspace invitations, and GST ledger receipts through your configured mail
        transport with inline brand logos loaded directly from the public assets folder.
      </p>

      <DetailTable
        title="Transport Scorecard"
        rows={[
          { label: "SMTP Endpoint", value: `${props.smtpHost}:${props.smtpPort}`, mono: true },
          { label: "Transport Security", value: tlsMode },
          { label: "Sender Envelope", value: props.fromHeader, mono: true },
          { label: "Test Recipient", value: props.recipientEmail, mono: true },
          { label: "Credential Source", value: props.credentialSource },
          { label: "Brand Logo Payload", value: "Inline CID (/public/email-logo.png & /public/logo.png)" },
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
