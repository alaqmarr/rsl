import { getPlatformBillingSettings, INDIA_GST_STATES } from "@rsl/billing";
import { getEnv } from "@rsl/core";

export type LegalDocSlug =
  | "privacy"
  | "terms"
  | "payment-terms"
  | "refund-policy"
  | "service-delivery"
  | "acceptable-use"
  | "cookies"
  | "data-deletion"
  | "dpa";

export type LegalCategory =
  | "Core Agreements"
  | "Payments, GST & Refunds"
  | "Privacy, Security & Messaging";

export interface LegalTableSpec {
  headers: string[];
  rows: string[][];
}

export interface LegalSection {
  id: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  callout?: {
    tone: "emerald" | "amber" | "sky";
    title: string;
    body: string;
  };
  table?: LegalTableSpec;
}

export interface LegalDocument {
  slug: LegalDocSlug;
  path: `/${LegalDocSlug}`;
  shortTitle: string;
  title: string;
  subtitle: string;
  category: LegalCategory;
  badge: string;
  effectiveDate: string;
  lastUpdated: string;
  plainSummary: string[];
  sections: LegalSection[];
}

export interface LegalEntityContext {
  legalName: string;
  brandName: string;
  gstin: string;
  stateCode: string;
  stateName: string;
  billingEmail: string;
  privacyEmail: string;
  supportPhone: string;
  primaryDomain: string;
  appUrl: string;
  docsUrl: string;
}

export function getLegalEntityContext(): LegalEntityContext {
  const env = getEnv();
  const billing = getPlatformBillingSettings();
  const primaryDomain = (env.PRIMARY_DOMAIN || "rapidshiftlabs.in").trim().toLowerCase();
  const gstin = (billing.gstin || "27AAACR5055K1Z1").trim().toUpperCase();
  const prefix = /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : "27";
  const stateName = INDIA_GST_STATES[prefix] ?? "Maharashtra";

  return {
    legalName: billing.payeeName || "RapidShift Labs",
    brandName: "RapidShift Labs",
    gstin,
    stateCode: prefix,
    stateName,
    billingEmail:
      billing.billingEmail &&
      billing.billingEmail !== "billing@rapidshiftlabs.in" &&
      billing.billingEmail !== "info@thewebsensei.email" &&
      billing.billingEmail !== "support@rapidshiftlabs.com"
        ? billing.billingEmail
        : `app@${primaryDomain}`,
    privacyEmail: `app@${primaryDomain}`,
    supportPhone: billing.supportPhone || "+91 98200 00000",
    primaryDomain,
    appUrl: env.APP_URL || `https://app.${primaryDomain}`,
    docsUrl: env.DOCS_URL || `https://docs.${primaryDomain}`,
  };
}

export function getAllLegalDocuments(ctx = getLegalEntityContext()): LegalDocument[] {
  return [
    {
      slug: "privacy",
      path: "/privacy",
      shortTitle: "Privacy Policy",
      title: "Privacy Policy",
      subtitle:
        "How RapidShift Labs collects, isolates, encrypts, and protects business, accounting, and customer communication data under Indian law and global API standards.",
      category: "Privacy, Security & Messaging",
      badge: "DPDP Act 2023 & Google Limited Use",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "Every customer business gets its own isolated SQLite database file — your Tally Prime bills, contacts, and chats are never mixed with any other company.",
        "We never sell customer data, never run third-party advertising trackers, and never train public AI models on your business records or Tally vouchers.",
        "OAuth tokens (Google Drive, Google Business Profile, Meta, WhatsApp Cloud API) are encrypted at rest with AES-256-GCM envelope encryption and can be revoked in 1 click.",
        "You can export a signed portable backup or request permanent cryptographic deletion of your workspace at any time.",
      ],
      sections: [
        {
          id: "scope-and-controller",
          heading: "1. Scope, Data Fiduciary & Processor Roles",
          paragraphs: [
            `This Privacy Policy explains how ${ctx.legalName} ("${ctx.brandName}", "we", "us", or "our"), operating the RSL Marketing & Tally Suite at ${ctx.primaryDomain} and ${ctx.appUrl}, collects, uses, stores, and safeguards information.`,
            "Under India's Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information Technology Act, 2000 (read with the IT Reasonable Security Practices and Procedures Rules, 2011), RapidShift Labs acts as a Data Fiduciary with respect to workspace account holders and billing records, and as a Data Processor acting strictly on your documented instructions with respect to your end-customers' Tally Prime invoices, receivables, and WhatsApp/Instagram/Facebook/Google conversations.",
          ],
        },
        {
          id: "information-collected",
          heading: "2. Categories of Information We Process",
          paragraphs: [
            "We collect only the minimum data necessary to provision your workspace, synchronize accounting vouchers, deliver customer messages, and issue statutory GST tax invoices:",
          ],
          bullets: [
            "Workspace & Account Identity: Full name, work email address, hashed password (scrypt/argon-grade KDF), team member role assignments, firm/company name, billing state, and optional 15-character GSTIN.",
            "Tally Prime Accounting Sync Data: Party ledger names, mobile numbers, voucher numbers, bill dates, due dates, line-item tax splits, receivable balances, and generated PDF tax invoices transmitted by your paired Windows Tally Connector.",
            "Customer Messaging & Shared Inbox Data: Inbound and outbound WhatsApp Cloud API template/session messages, Instagram Direct Messages, Facebook Page comments, Google Business Profile reviews, opt-in timestamps, and STOP/suppression records.",
            "Connected Channel Credentials: OAuth 2.0 access/refresh tokens and webhook secrets for Google Drive, Google Business Profile, and Meta/WhatsApp, stored exclusively in AES-256-GCM encrypted form.",
            "Billing, Wallet & Statutory Tax Records: Prepaid wallet ledger entries, Razorpay order/payment references, UTR bank transfer references, and SAC 998314 GST invoices/credit notes.",
            "Security & Tamper-Evident Audit Logs: Redacted diagnostic logs (with phone numbers, emails, and tokens automatically masked) and SHA-256 hash-chained workspace activity records.",
          ],
        },
        {
          id: "google-api-limited-use",
          heading: "3. Google API Services User Data Policy (Limited Use Disclosure)",
          paragraphs: [
            `${ctx.brandName}'s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.`,
            "Specifically, when you connect Google Drive for automated cloud backups or Google Business Profile for customer review management:",
          ],
          bullets: [
            "Scoped Google Drive Access (`drive.file`): When you click 'Connect to Google Drive', we request only narrow file-level scope to create and upload signed, AES-256-GCM encrypted `.rslbackup` archives created by RapidShift Labs into your designated backup folder. We cannot view, list, modify, or delete any unrelated personal or business files in your Google Drive.",
            "Scoped Google Business Profile Access: Used solely to fetch customer star ratings and review text for your authorized locations and to publish owner replies that your authorized staff explicitly submit.",
            "Strict Prohibition on Secondary Use: Google user data is never sold, never shared with advertising networks or data brokers, never used for creditworthiness profiling, and never used to train generalized or foundation AI/ML models.",
            "Human Access Restriction: Our staff cannot read your Google API data unless you explicitly initiate a time-boxed (maximum 30-minute), audited support session with written consent to troubleshoot a specific issue, or where strictly required by applicable law.",
          ],
          callout: {
            tone: "emerald",
            title: "1-Click Revocation Anytime",
            body: `You can disconnect Google Drive or Google Business Profile immediately from Connected Channels (${ctx.appUrl}/connections) or revoke access directly at myaccount.google.com/permissions.`,
          },
        },
        {
          id: "meta-whatsapp-data",
          heading: "4. Meta Platforms & Official WhatsApp Cloud API Data",
          paragraphs: [
            "When you connect a WhatsApp Business Account (WABA), Facebook Page, or Instagram Professional Account via Meta's official Graph API:",
          ],
          bullets: [
            "Inbound webhooks are cryptographically verified using `X-Hub-Signature-256` HMAC-SHA256 before ingestion.",
            "Duplicate-send protection (`SendGuard`) stores SHA-256 salted hashes of recipient identifiers rather than raw phone numbers in operational deduplication tables.",
            "Automated `STOP` / `UNSUBSCRIBE` replies immediately add the recipient to your workspace suppression list, blocking subsequent promotional broadcasts.",
          ],
        },
        {
          id: "tenant-isolation-security",
          heading: "5. Per-Business Database Isolation & Encryption Controls",
          paragraphs: [
            "Unlike conventional multi-tenant tools that place every customer's rows into one shared table, RapidShift Labs provisions physically separate SQLite database files (`data.db` and `logs/current.db`) inside an isolated directory (`0700` OS permissions) for each business workspace.",
          ],
          bullets: [
            "Encryption in Transit: All web, API, webhook, and Windows Tally Connector traffic enforces HTTPS (TLS 1.2 / TLS 1.3) with HTTP Strict Transport Security (HSTS).",
            "Encryption at Rest for Secrets & Backups: All OAuth tokens, API keys, and `.rslbackup` archives are encrypted with authenticated AES-256-GCM envelope encryption and Ed25519/HMAC integrity signatures.",
            "PII Log Redaction: Server diagnostic logs automatically scrub bearer tokens, API keys, passwords, email addresses, and phone numbers prior to disk write.",
          ],
        },
        {
          id: "sharing-and-subprocessors",
          heading: "6. Data Sharing & Infrastructure Sub-Processors",
          paragraphs: [
            "We do not sell, rent, or trade personal or business data. Data is transmitted strictly to infrastructure providers necessary to deliver the service you requested:",
          ],
          table: {
            headers: ["Provider", "Purpose", "Data Scope"],
            rows: [
              ["Meta Platforms, Inc.", "WhatsApp Cloud API, Instagram & Facebook delivery", "Only messages/templates you send or receive"],
              ["Google LLC", "Google Drive encrypted backups & Business Reviews", "Encrypted `.rslbackup` files & review replies"],
              ["Razorpay Software Pvt. Ltd.", "RBI-regulated payment gateway checkout", "Order amount, billing email/phone, payment status"],
              ["Cloudflare, Inc.", "DNS, TLS edge protection & optional R2 object storage", "Encrypted network traffic & encrypted backup blobs"],
            ],
          },
        },
        {
          id: "retention-and-rights",
          heading: "7. Data Retention, Export & Your DPDP Act Rights",
          paragraphs: [
            `Active workspace data is retained for the duration of your subscription. Completed background queue locks expire after 7–90 days, and expired browser sessions are purged automatically every 20 minutes. Statutory GST tax invoices and wallet ledger entries are retained for eight (8) years as mandated under Section 36 of the Central Goods and Services Tax (CGST) Act, 2017.`,
            `As a Data Principal or Workspace Owner, you have the right to access, correct, export (via ${ctx.appUrl}/backups), withdraw consent, and request permanent erasure (via ${ctx.appUrl}/data-deletion or by emailing ${ctx.privacyEmail}).`,
          ],
        },
        {
          id: "grievance-contact",
          heading: "8. Grievance Officer & Privacy Contact",
          paragraphs: [
            `In accordance with Rule 5(9) of the IT Rules, 2011, Rule 3(2) of the IT (Intermediary Guidelines) Rules, 2021, and the DPDP Act, 2023, privacy inquiries or grievances may be addressed to our Grievance & Data Protection Officer at ${ctx.privacyEmail} or ${ctx.billingEmail} (Phone: ${ctx.supportPhone}). Every request is acknowledged within 24 hours and resolved within 15 days.`,
          ],
        },
      ],
    },
    {
      slug: "terms",
      path: "/terms",
      shortTitle: "Terms & Conditions",
      title: "Terms & Conditions of Service",
      subtitle:
        "Master subscription agreement governing access to the RapidShift Labs Marketing, Shared Inbox, Cloud Backup, and Tally Prime Automation Suite.",
      category: "Core Agreements",
      badge: "Master SaaS Agreement",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "You retain 100% ownership of your business records, Tally Prime vouchers, customer lists, and backups at all times.",
        "Every new business workspace starts with a 7-day all-tools free trial with zero credit card required and zero forced auto-debit.",
        "You are responsible for keeping staff login credentials secure, obtaining customer opt-in before sending WhatsApp broadcasts, and verifying statutory tax filings with your Chartered Accountant.",
        "You may export your data and close your account at any time.",
      ],
      sections: [
        {
          id: "acceptance",
          heading: "1. Electronic Record & Acceptance of Terms",
          paragraphs: [
            `These Terms & Conditions ("Terms") constitute a legally binding electronic record under the Information Technology Act, 2000 and the Indian Contract Act, 1872 between ${ctx.legalName} ("${ctx.brandName}") and the business entity or professional ("Customer", "Workspace", or "you") registering for or using ${ctx.appUrl}, ${ctx.docsUrl}, or associated APIs and connectors.`,
            "By creating a workspace, running the Tally Prime Windows Connector, or using any service module, you confirm that you are at least 18 years old and authorized to bind your business entity to these Terms.",
          ],
        },
        {
          id: "workspace-and-rbac",
          heading: "2. Workspace Provisioning, Roles & Account Security",
          paragraphs: [
            "Each registered business receives an isolated workspace with role-based access control (Business Owner, Admin, Marketing & Operations Manager, Support Executive, View-Only Analyst, and Accounts & Billing).",
          ],
          bullets: [
            "You are responsible for maintaining the confidentiality of user passwords, API keys (`rsl_live_*` / `rsl_test_*`), and Tally pairing codes.",
            "Support Impersonation Safeguard: RapidShift Labs support personnel cannot enter your workspace unless an audited, single-use handoff session (auto-expiring in 30 minutes) is initiated with a logged ticket reason, which you may terminate instantly via the 'End Support Session' banner.",
          ],
        },
        {
          id: "free-trial-and-plans",
          heading: "3. 7-Day Starter Trial & Modular Subscriptions",
          paragraphs: [
            "New workspaces receive a complimentary 7-day starter trial unlocking platform tools for evaluation without requiring a credit card or upfront mandate. Metered third-party WhatsApp/Meta conversation fees require a funded prepaid wallet or connected Meta billing account.",
            "Upon trial expiry, unlocked trial modules pause gracefully without deleting any data until you activate an individual tool or value bundle under our Payment Terms.",
          ],
        },
        {
          id: "tally-connector-disclaimer",
          heading: "4. Tally Prime Integration & Accounting Accuracy",
          paragraphs: [
            "RapidShift Labs provides an automated bridge (`rsl-tally-connector.mjs` / `.bat` launcher) that communicates locally with your licensed installation of Tally Prime over HTTP XML.",
          ],
          bullets: [
            "Tally® and TallyPrime® are registered trademarks of Tally Solutions Pvt. Ltd. RapidShift Labs is an independent software vendor and is not affiliated with or endorsed by Tally Solutions Pvt. Ltd.",
            "While our voucher XML generator enforces balanced double-entry arithmetic and Indian Standard Time (IST) dates, RapidShift Labs is not a Chartered Accountancy firm or GST Suvidha Provider. Your business and accountant remain solely responsible for reviewing ledger postings, GSTR-1/GSTR-3B returns, and statutory tax compliance.",
          ],
        },
        {
          id: "customer-data-ownership",
          heading: "5. Intellectual Property & Ownership of Customer Data",
          paragraphs: [
            "You retain all right, title, and interest in and to all Customer Data (including accounting vouchers, customer contacts, PDF bills, messages, and brand media). You grant RapidShift Labs a limited, revocable, non-exclusive license solely to host, transmit, encrypt, and back up Customer Data to provide the Services.",
            "RapidShift Labs retains all intellectual property rights in the platform software, user interface, documentation, logos, and underlying multi-tenant architecture.",
          ],
        },
        {
          id: "third-party-platforms",
          heading: "6. Third-Party Platforms (Meta, WhatsApp, Google, Razorpay)",
          paragraphs: [
            "Certain features depend on external APIs operated by Meta Platforms, Inc., Google LLC, and Razorpay Software Pvt. Ltd. Availability of WhatsApp template approvals, phone number quality ratings, Google OAuth scopes, or UPI banking rails is subject to those providers' respective terms and uptime.",
          ],
        },
        {
          id: "warranties-and-liability",
          heading: "7. Disclaimers & Limitation of Liability",
          paragraphs: [
            "Except as expressly stated herein, the Services are provided on an 'as-is' and 'as-available' basis. To the maximum extent permitted under Indian law, neither party shall be liable for indirect, consequential, exemplary, or punitive damages.",
            `RapidShift Labs's aggregate cumulative liability arising out of or relating to these Terms in any twelve (12) month period shall not exceed the total subscription fees (excluding passthrough telecom/GST taxes) paid by Customer to ${ctx.legalName} during the three (3) months immediately preceding the event giving rise to the claim.`,
          ],
        },
        {
          id: "suspension-and-termination",
          heading: "8. Suspension, Termination & 30-Day Data Export Window",
          paragraphs: [
            "You may stop using the platform or cancel active plans at any time. We may suspend outbound messaging or workspace access immediately if your account engages in phishing, unsolicited WhatsApp spam, illegal activity, or materially breaches our Acceptable Use Policy.",
            "Upon workspace closure, you are granted a 30-day export window (unless immediate erasure is requested) to download portable JSON/CSV exports and encrypted `.rslbackup` archives before permanent deletion.",
          ],
        },
        {
          id: "governing-law",
          heading: "9. Governing Law & Dispute Resolution",
          paragraphs: [
            `These Terms are governed by and construed in accordance with the laws of the Republic of India. Subject to amicable good-faith resolution within 30 days of written notice to ${ctx.billingEmail}, courts located in ${ctx.stateName}, India shall have exclusive jurisdiction over any dispute arising under these Terms.`,
          ],
        },
      ],
    },
    {
      slug: "payment-terms",
      path: "/payment-terms",
      shortTitle: "Payment & GST Terms",
      title: "Payment, Wallet & GST Billing Terms",
      subtitle:
        "Transparent INR pricing, prepaid messaging wallet mechanics, -₹200 courtesy overdraft buffer, and statutory 18% GST invoicing (SAC 998314).",
      category: "Payments, GST & Refunds",
      badge: "SAC 998314 • 18% GST Compliant",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "All prices are denominated in Indian Rupees (INR ₹) across Monthly, Quarterly (~10% discount), and Yearly (~20% discount) billing cycles.",
        "Wallet recharges issue a 0% GST Official Advance Receipt at deposit time; 18% GST Tax Invoices (SAC 998314) are issued on service/bundle activation so you never face double taxation.",
        "Registered Indian businesses adding a valid 15-digit GSTIN receive B2B GST Tax Invoices (CGST+SGST or IGST) eligible for Input Tax Credit (ITC).",
        "A ₹200 courtesy wallet overdraft buffer ensures live Tally-to-WhatsApp invoices never halt abruptly mid-business-day.",
      ],
      sections: [
        {
          id: "billing-cycles-and-plans",
          heading: "1. Subscription Cycles & Modular Pricing",
          paragraphs: [
            "RapidShift Labs offers both individual a-la-carte tool subscriptions and discounted multi-tool Value Bundles across three billing durations: Monthly (30 days), Quarterly (90 days), and Yearly (365 days).",
            "Plan fees are prepaid in INR prior to activation (following any applicable free trial). We do not store debit/credit card numbers or auto-charge saved cards without your explicit checkout initiation.",
          ],
        },
        {
          id: "accepted-payment-methods",
          heading: "2. Accepted Payment Modes & Settlement",
          paragraphs: [
            `Payments to ${ctx.legalName} can be completed directly inside Billing & Plans (${ctx.appUrl}/billing) through:`,
          ],
          bullets: [
            "Razorpay Instant Checkout: UPI (Google Pay, PhonePe, Paytm, BHIM), Corporate/Consumer Credit & Debit Cards, and Netbanking — unlocked automatically upon cryptographic signature verification.",
            "Direct UPI QR & Mobile UPI Intent (`upi://pay`): Scan QR or tap Pay via UPI App and submit your 12-digit UPI UTR reference for rapid finance verification.",
            "NEFT / RTGS / IMPS Corporate Bank Transfer: Transfer to the official corporate bank account displayed in your workspace billing screen and record the UTR reference.",
          ],
        },
        {
          id: "prepaid-wallet-and-overdraft",
          heading: "3. Prepaid Usage Wallet & -₹200.00 Overdraft Buffer",
          paragraphs: [
            "Metered per-message and per-unit consumption (such as WhatsApp Business utility/marketing template deliveries and bulk broadcasts) is debited transparently in real time from your workspace Prepaid Wallet.",
          ],
          bullets: [
            "Atomic Ledger Accounting: Every wallet credit and usage debit is recorded in an immutable, append-only paise-precision ledger visible in your Billing screen.",
            "Courtesy -₹200.00 Overdraft Protection: To prevent critical Tally Prime GST bills from failing mid-afternoon if your wallet reaches ₹0.00, workspaces include an automatic ₹200.00 (`-20,000` paise) buffer.",
            "Automatic Pause & Replenishment: Once wallet balance reaches `-₹200.00`, metered outbound sends pause safely until you top up. Your next wallet recharge automatically clears the negative buffer first and credits the remaining balance.",
          ],
        },
        {
          id: "gst-tax-treatment",
          heading: "4. Statutory GST Invoicing (SAC 998314) & Input Tax Credit",
          paragraphs: [
            `All software subscriptions and cloud SaaS services supplied by ${ctx.legalName} (Supplier GSTIN: ${ctx.gstin}, State: ${ctx.stateName}) are classified under HSN/SAC 998314 (Information Technology Design & Development / Cloud SaaS Services) attracting 18% Goods and Services Tax under the CGST/IGST Acts, 2017:`,
          ],
          table: {
            headers: ["Transaction Type", "Document Issued", "GST Treatment"],
            rows: [
              [
                "Prepaid Wallet Recharge (Deposit)",
                "Official Advance Receipt (`RCPT/...`)",
                "0% GST at deposit time (held as adjustable customer advance)",
              ],
              [
                `Plan / Bundle Activation (Intra-State: ${ctx.stateName})`,
                "Statutory Tax Invoice (`RSL/...`)",
                "9% CGST + 9% SGST (18% Total GST)",
              ],
              [
                `Plan / Bundle Activation (Inter-State: Outside ${ctx.stateName})`,
                "Statutory Tax Invoice (`RSL/...`)",
                "18% IGST",
              ],
              [
                "Approved Billing Reversal / Adjustment",
                "Section 34 GST Credit Note (`CN/...`)",
                "Proportional CGST+SGST or IGST tax reversal",
              ],
            ],
          },
          callout: {
            tone: "sky",
            title: "Ensure Your GSTIN Is Saved Before Checkout",
            body: "To claim B2B Input Tax Credit (ITC) in GSTR-2B, enter your valid 15-character GSTIN and matching Billing State in Business Settings prior to plan activation. Under GST rules, B2C invoices issued without a GSTIN cannot be retroactively converted after GSTR-1 filing.",
          },
        },
        {
          id: "taxes-and-tds",
          heading: "5. Tax Deducted at Source (TDS) & Overdue Balances",
          paragraphs: [
            "Where an enterprise customer is statutorily required to deduct TDS under Section 194J / 194Q of the Income Tax Act, 1961 on annual/enterprise invoices, GST (18%) must always be paid in full, and Form 16A must be shared with our finance desk (`" +
              ctx.billingEmail +
              "`) within statutory timelines for wallet/account credit reconciliation.",
          ],
        },
      ],
    },
    {
      slug: "refund-policy",
      path: "/refund-policy",
      shortTitle: "Refund & Cancellation",
      title: "Refund, Cancellation & Credit Note Policy",
      subtitle:
        "Clear, fair rules for 7-day risk-free evaluation, subscription cancellations, duplicate payment reversals, and unused wallet refunds.",
      category: "Payments, GST & Refunds",
      badge: "5–7 Business Day Reversals",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "Every business gets a 7-day free trial of all 15 tools before paying anything — so you can test Tally Prime sync, WhatsApp billing, and Google Drive backups risk-free.",
        "Cancel any plan in 1 click anytime; there are no cancellation penalties and no surprise auto-debits.",
        "Duplicate payments, gateway capture errors, or verified provisioning failures are refunded 100% within 5–7 business days to your original payment method.",
        "Unused non-promotional Prepaid Wallet deposits can be refunded upon permanent account closure.",
      ],
      sections: [
        {
          id: "risk-free-trial",
          heading: "1. 7-Day Free Trial Before You Pay",
          paragraphs: [
            "Because we want every business owner and Chartered Accountant to verify Tally Prime compatibility and WhatsApp workflow fit before spending money, every new workspace includes a 7-day all-tools free starter trial with zero payment obligation.",
          ],
        },
        {
          id: "cancellation-policy",
          heading: "2. Plan Cancellation Policy",
          paragraphs: [
            `You may cancel or deactivate any active Monthly, Quarterly, or Yearly service or bundle at any time from Billing & Plans (${ctx.appUrl}/billing) or by emailing ${ctx.billingEmail}.`,
          ],
          bullets: [
            "Zero Cancellation Penalty: We never charge early-termination or exit fees.",
            "Continued Access Through Paid Term: Cancelled subscriptions remain usable through the end of their paid billing cycle and do not auto-charge on expiry.",
            "Plan Upgrades: Upgrading from a single tool to a broader Value Bundle applies cleanly from activation without losing workspace history.",
          ],
        },
        {
          id: "refund-eligibility",
          heading: "3. Subscription & Payment Refund Eligibility",
          paragraphs: [
            "Once a paid subscription cycle is activated after the 7-day free trial, subscription fees are generally non-refundable for partially used periods. However, a full or pro-rata refund (accompanied by a statutory Section 34 GST Credit Note) IS granted in the following cases:",
          ],
          bullets: [
            "Duplicate Payment or Gateway Double-Debit: If UPI, Netbanking, or Razorpay debits your bank account twice for the same plan request or fails to settle an order.",
            "Unresolved Technical Provisioning Failure: If a newly purchased module fails to provision due to a verified defect on RapidShift Labs's platform and our engineering team cannot resolve it within 72 hours of your support ticket, provided you request a refund within seven (7) calendar days of payment.",
            "Unapproved Manual Bank Transfer Request: If you submit a manual UTR plan request that is declined or cancelled prior to plan activation.",
          ],
        },
        {
          id: "wallet-balance-refunds",
          heading: "4. Prepaid Wallet Balance Refunds on Account Closure",
          paragraphs: [
            "If you permanently close your workspace with a positive, unused cash deposit in your Prepaid Wallet:",
          ],
          bullets: [
            "Unused cash top-ups (excluding promotional/trial credits and net of any accrued metered usage or negative overdraft) are eligible for refund upon written request from the Workspace Owner.",
            "Already-delivered WhatsApp Cloud API conversation charges, telecom passthrough fees, and completed API consumption are non-refundable.",
          ],
        },
        {
          id: "refund-timelines",
          heading: "5. How to Request a Refund & Processing Timelines",
          paragraphs: [
            `Email ${ctx.billingEmail} from your registered Workspace Owner email address with your Workspace Name, Invoice/Receipt Number, and payment reference (Razorpay Payment ID or 12-digit UPI/UTR number).`,
          ],
          table: {
            headers: ["Original Payment Mode", "Approval Review", "Bank / Source Credit Timeline"],
            rows: [
              ["Razorpay (UPI / Debit Card / Netbanking)", "Within 2 business days", "5–7 business days to original source"],
              ["Razorpay (Credit Card)", "Within 2 business days", "5–7 business days (statement cycle dependent)"],
              ["Direct UPI / NEFT / RTGS Bank Transfer", "Within 2 business days", "3–5 business days via NEFT/IMPS to verified firm bank account"],
            ],
          },
        },
      ],
    },
    {
      slug: "service-delivery",
      path: "/service-delivery",
      shortTitle: "Service Delivery Policy",
      title: "Service Delivery & Provisioning Policy",
      subtitle:
        "Electronic SaaS provisioning timelines, digital connector delivery, and GST invoice issuance (no physical shipping).",
      category: "Payments, GST & Refunds",
      badge: "Instant Cloud Provisioning",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "RapidShift Labs is a 100% digital cloud SaaS platform — no physical goods or couriers are involved.",
        "New workspaces and 7-day free trials provision instantly (< 5 seconds) upon online signup.",
        "Razorpay & Prepaid Wallet plan activations unlock immediately; manual NEFT/UPI UTR transfers activate within 2–4 business hours.",
      ],
      sections: [
        {
          id: "digital-delivery-nature",
          heading: "1. 100% Digital Cloud Software Delivery",
          paragraphs: [
            `${ctx.legalName} provides cloud-hosted business software, APIs, and downloadable Windows Tally Prime integration scripts via ${ctx.appUrl} and ${ctx.docsUrl}. No physical merchandise is manufactured or shipped, and zero shipping/freight charges apply.`,
          ],
        },
        {
          id: "provisioning-sla",
          heading: "2. Activation & Provisioning Timelines",
          paragraphs: [
            "Service modules, isolated tenant databases, per-client SSL subdomains, and GST tax invoices are delivered electronically according to the following schedule:",
          ],
          table: {
            headers: ["Event", "Delivery Method", "Standard Provisioning Time"],
            rows: [
              ["New Workspace + 7-Day Free Trial", `Online dashboard (${ctx.appUrl}) + welcome email`, "Instant (< 5 seconds)"],
              ["Plan Activation via Prepaid Wallet", "Instant entitlement unlock + PDF GST Invoice", "Instant (< 2 seconds)"],
              ["Plan Activation / Recharge via Razorpay", "Automated webhook & signature verification", "Instant (typically 2–30 seconds)"],
              ["Manual UPI QR / NEFT / RTGS UTR Submission", "Finance desk UTR verification + email alert", "2–4 business hours (max 1 business day)"],
              ["Per-Client Tally & API HTTPS Subdomains", "Automated Let's Encrypt ACME TLS issuance", "Within 1–5 minutes of provisioning"],
            ],
          },
        },
        {
          id: "delivery-confirmation",
          heading: "3. Proof of Delivery & Assistance",
          paragraphs: [
            `Every plan activation and wallet recharge generates an immediate timestamped entry in your Workspace Activity History and a downloadable PDF Tax Invoice or Advance Receipt under ${ctx.appUrl}/billing. If an online payment is debited from your bank but does not reflect within 15 minutes, contact ${ctx.billingEmail} or ${ctx.supportPhone} with your transaction reference.`,
          ],
        },
      ],
    },
    {
      slug: "acceptable-use",
      path: "/acceptable-use",
      shortTitle: "Acceptable Use Policy",
      title: "Acceptable Use & Messaging Compliance Policy",
      subtitle:
        "Mandatory anti-spam, customer opt-in, WhatsApp Business Policy, and platform security rules for all workspaces.",
      category: "Privacy, Security & Messaging",
      badge: "Anti-Spam & Meta/Google Rules",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "Only send WhatsApp templates and broadcasts to customers who have transacted with your business or given explicit opt-in consent.",
        "Always honor STOP / Unsubscribe requests immediately (RSL's suppression engine handles automated replies automatically).",
        "Never use the platform for unsolicited cold lists, deceptive promotions, illegal goods, or security testing without authorization.",
      ],
      sections: [
        {
          id: "whatsapp-opt-in",
          heading: "1. Mandatory Customer Opt-In & Anti-Spam Rules",
          paragraphs: [
            "Workspaces using WhatsApp Business Messaging, Bulk Broadcasts, or Tally Bill Reminders must strictly comply with the Meta WhatsApp Business Messaging Policy and TRAI/Indian commercial communication norms:",
          ],
          bullets: [
            "Prior Relationship or Explicit Opt-In: You may message only customers who have provided their mobile number during billing/invoicing in Tally Prime or explicitly opted in to receive WhatsApp updates from your business.",
            "Purchased or Scraped Lists Prohibited: Uploading third-party, bought, or scraped phone number lists is strictly forbidden and will trigger immediate broadcast suspension.",
            "Immediate Opt-Out Respect: You must not bypass or manually remove numbers that have opted out via `STOP` unless the customer expressly requests re-subscription in writing.",
          ],
        },
        {
          id: "prohibited-content",
          heading: "2. Prohibited Content & Regulated Industries",
          paragraphs: [
            "You may not transmit, publish, or store content through RapidShift Labs that involves:",
          ],
          bullets: [
            "Fraudulent invoices, phishing links, impersonation of banks/government bodies, or malware distribution.",
            "Illegal gambling, unlicensed lending, narcotics, weapons, counterfeit merchandise, or adult/exploitative material.",
            "Fake or incentivized Google Business Profile reviews that violate Google's Prohibited & Restricted Content policies.",
          ],
        },
        {
          id: "technical-integrity",
          heading: "3. API Rate Limits & Infrastructure Integrity",
          paragraphs: [
            "Customers must not probe, scan, or attempt to bypass tenant isolation boundaries, forged webhook HMAC headers, SSRF network guards, or per-workspace API rate limits. Violations may result in immediate API key revocation or account suspension.",
          ],
        },
      ],
    },
    {
      slug: "cookies",
      path: "/cookies",
      shortTitle: "Cookie Policy",
      title: "Cookie & Session Security Policy",
      subtitle:
        "Exact list of strictly necessary security cookies used by RapidShift Labs — with zero third-party advertising trackers.",
      category: "Privacy, Security & Messaging",
      badge: "Zero Ad Trackers",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "We use ONLY strictly necessary security cookies required to keep you signed in and protect Google/Meta OAuth handshakes.",
        "We do NOT use third-party advertising pixels, cross-site behavioral tracking cookies, or fingerprinting scripts on our platform.",
      ],
      sections: [
        {
          id: "strictly-necessary-cookies",
          heading: "1. Strictly Necessary First-Party Security Cookies",
          paragraphs: [
            "RapidShift Labs uses minimal, cryptographically signed `HttpOnly` cookies strictly required to authenticate your session and defend against Cross-Site Request Forgery (CSRF):",
          ],
          table: {
            headers: ["Cookie Name", "Host Scope", "Purpose", "Expiry & Flags"],
            rows: [
              [
                "`rsl_session`",
                "`app." + ctx.primaryDomain + "`",
                "Authenticates signed-in workspace users and active business selection",
                "30 days • `HttpOnly`, `Secure`, `SameSite=Lax`",
              ],
              [
                "`rsl_google_oauth_ctx`",
                "`app." + ctx.primaryDomain + "`",
                "Verifies PKCE (`S256`) state during 1-click Google Drive / GBP connection",
                "10 minutes • `HttpOnly`, `Secure`, `SameSite=Lax`",
              ],
              [
                "`rsl_staff_session`",
                "`admin." + ctx.primaryDomain + "` (Host-Only)",
                "Authenticates authorized internal RapidShift Labs operations staff",
                "12 hours • `HttpOnly`, `Secure`, `SameSite=Lax`",
              ],
            ],
          },
        },
        {
          id: "checkout-scripts",
          heading: "2. Payment Gateway Checkout Context",
          paragraphs: [
            "When—and only when—you initiate an online card/UPI recharge via Razorpay Checkout on the Billing page, `checkout.razorpay.com` may set fraud-prevention session storage or cookies governed by Razorpay's Privacy Policy to complete RBI two-factor authentication.",
          ],
        },
      ],
    },
    {
      slug: "data-deletion",
      path: "/data-deletion",
      shortTitle: "Data Deletion & Grievance",
      title: "User Data Deletion, Export & Grievance Redressal",
      subtitle:
        "Step-by-step instructions to disconnect OAuth integrations, export portable backups, delete workspace or Meta/Google user data, and contact our Grievance Officer.",
      category: "Privacy, Security & Messaging",
      badge: "Meta & Google Deletion URL",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "Disconnect Google Drive, Google Business Profile, WhatsApp, Instagram, or Facebook in 1 click from Connected Channels — deleting stored OAuth tokens immediately.",
        "Download complete JSON/CSV exports or encrypted `.rslbackup` archives anytime from Backups & Storage.",
        "Request permanent cryptographic erasure of your workspace database or end-customer messaging records with guaranteed 24-hour acknowledgment and completion within 15 days.",
      ],
      sections: [
        {
          id: "self-service-disconnect",
          heading: "1. Immediate Self-Service Channel Disconnection (Google & Meta)",
          paragraphs: [
            `Workspace Owners and Admins can revoke any connected integration at any time without contacting support:`,
          ],
          bullets: [
            `Sign in to ${ctx.appUrl}/connections (Connected Channels).`,
            "Locate Google Drive Backup, Google Business Profile, WhatsApp Business Cloud API, Facebook Page, or Instagram Account and click 'Disconnect'.",
            "Disconnecting immediately purges the encrypted OAuth access/refresh tokens from your workspace database and halts all future sync jobs.",
            "For Tally Prime, open Tally Studio or All API Tokens and click 'Revoke' next to your paired Windows PC token.",
          ],
        },
        {
          id: "full-workspace-deletion",
          heading: "2. Full Workspace & Meta/Google App Data Deletion Instructions",
          paragraphs: [
            "If you wish to permanently delete your entire RapidShift Labs workspace (or if you are a Facebook/Instagram/WhatsApp/Google user requesting deletion of data processed via RapidShift Labs App integrations):",
          ],
          bullets: [
            `Step 1 (Optional Export): Visit ${ctx.appUrl}/backups to download a portable export of your contacts, conversations, and Tally voucher summaries.`,
            `Step 2 (Submit Deletion Request): Send an email from your registered Workspace Owner email to ${ctx.privacyEmail} (or ${ctx.billingEmail}) with the subject line "Data Deletion Request — [Your Business Name]".`,
            "Step 3 (Verification & Erasure): Our Data Protection Officer verifies ownership within 24 hours, issues a unique Deletion Confirmation Ticket ID, and permanently purges your isolated tenant directory (`data.db`, `logs`, and staged backups) within 7–15 calendar days.",
          ],
          callout: {
            tone: "amber",
            title: "Statutory Tax Record Carve-Out (CGST Act Section 36)",
            body: "While all workspace databases, customer contacts, Tally vouchers, OAuth tokens, and chat histories are permanently destroyed upon deletion, statutory B2B/B2C GST invoices issued by RapidShift Labs for platform subscriptions must be retained in our tax ledger for 8 years under Indian GST law.",
          },
        },
        {
          id: "end-customer-optout",
          heading: "3. End-Customer WhatsApp Opt-Out & Erasure",
          paragraphs: [
            `End-customers who received a WhatsApp invoice or broadcast from a business using RapidShift Labs may reply "STOP" directly in WhatsApp for instant automated suppression, or email ${ctx.privacyEmail} with their mobile number so we can coordinate erasure with the respective Data Fiduciary business.`,
          ],
        },
        {
          id: "nodal-grievance-officer",
          heading: "4. Designated Grievance & Data Protection Officer (India)",
          paragraphs: [
            "Pursuant to the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023:",
          ],
          table: {
            headers: ["Field", "Official Details"],
            rows: [
              ["Legal Entity", ctx.legalName],
              ["Designation", "Grievance & Data Protection Officer"],
              ["Grievance / Privacy Email", `${ctx.privacyEmail} / ${ctx.billingEmail}`],
              ["Support Telephone", `${ctx.supportPhone} (Mon–Sat, 10:00 AM – 7:00 PM IST)`],
              ["Registered GSTIN & State", `${ctx.gstin} (${ctx.stateName}, India)`],
              ["SLA Commitments", "Acknowledgment within 24 hours • Final resolution within 15 days"],
            ],
          },
        },
      ],
    },
    {
      slug: "dpa",
      path: "/dpa",
      shortTitle: "Data Processing & Security",
      title: "Data Processing & Security Addendum (DPA)",
      subtitle:
        "Technical and organizational security architecture protecting B2B customer data, Tally Prime ledgers, and encrypted backups.",
      category: "Core Agreements",
      badge: "AES-256-GCM & Tenant Isolation",
      effectiveDate: "1 November 2026",
      lastUpdated: "3 November 2026",
      plainSummary: [
        "Forms an integral part of our Terms & Conditions for all B2B customers, Chartered Accountants, and multi-branch enterprises.",
        "Documents our physical per-tenant SQLite file isolation, AES-256-GCM secret encryption, SHA-256 tamper-evident audit chains, and 72-hour incident notification SLA.",
      ],
      sections: [
        {
          id: "processing-instructions",
          heading: "1. Processing Scope & Documented Instructions",
          paragraphs: [
            `This Data Processing Addendum ("DPA") supplements the Terms & Conditions between Customer (Data Fiduciary / Controller) and ${ctx.legalName} (Data Processor). RapidShift Labs processes Customer Data solely to execute workflows configured by Customer—such as Tally voucher ingestion, WhatsApp/Inbox delivery, analytics aggregation, and encrypted backup creation.`,
          ],
        },
        {
          id: "technical-measures",
          heading: "2. Technical & Organizational Security Controls",
          paragraphs: [
            "RapidShift Labs maintains defense-in-depth engineering safeguards across all production workloads:",
          ],
          bullets: [
            "Strict Tenant File Isolation: Separate SQLite WAL databases per tenant ULID with path-traversal validation (`resolveSafeTenantDir`) and OS `0700` directory permissions.",
            "Authenticated Envelope Encryption: OAuth tokens, webhook secrets, and backup payloads use AES-256-GCM with versioned master keys (`KMS_MASTER_KEY`) and cryptographic signing (`BACKUP_SIGNING_KEY`).",
            "Tamper-Evident Audit Chains: Workspace action logs compute sequential SHA-256 chain hashes anchored daily at 00:05 IST.",
            "Network & Webhook Hardening: Outbound webhook SSRF guards block RFC1918/loopback/link-local/metadata IP ranges; inbound Meta and Razorpay webhooks enforce constant-time HMAC-SHA256 verification.",
            "Fail-Closed Role-Based Access Control: Every web route, server action, and API key scope fails closed unless explicit permission is granted.",
          ],
        },
        {
          id: "breach-notification",
          heading: "3. Security Incident Notification (CERT-In & DPDP Alignment)",
          paragraphs: [
            `In the event of a confirmed personal data breach affecting your workspace, RapidShift Labs will notify the Workspace Owner without undue delay—and in any event within 72 hours (and within statutory CERT-In reporting windows where applicable)—providing root-cause scope, affected records, and containment actions taken.`,
          ],
        },
      ],
    },
  ];
}

export function getLegalDocumentBySlug(slug: LegalDocSlug): {
  doc: LegalDocument;
  allDocs: LegalDocument[];
  entity: LegalEntityContext;
} {
  const entity = getLegalEntityContext();
  const allDocs = getAllLegalDocuments(entity);
  const doc = allDocs.find((d) => d.slug === slug);
  if (!doc) {
    throw new Error(`Unknown legal document slug: ${slug}`);
  }
  return { doc, allDocs, entity };
}
