export type AdminNavIconKey =
  | "dashboard"
  | "clients"
  | "invoices"
  | "pricing"
  | "templates"
  | "queues"
  | "staff"
  | "inspector"
  | "runbooks"
  | "credentials"
  | "setup";

export interface AdminNavItemMeta {
  href: string;
  label: string;
  keywords: string;
  summary: string;
  iconKey: AdminNavIconKey;
  showPendingBadge?: boolean;
}

export interface AdminNavSectionMeta {
  heading: string;
  items: AdminNavItemMeta[];
}

export interface AdminPageWalkthroughStep {
  title: string;
  detail: string;
}

export interface AdminPageGuide {
  routePrefix: string;
  exact?: boolean;
  title: string;
  summary: string;
  roleNote: string;
  steps: AdminPageWalkthroughStep[];
  cautions: string[];
}

export const ADMIN_NAV_SECTIONS_META: AdminNavSectionMeta[] = [
  {
    heading: "Approvals & Revenue",
    items: [
      {
        href: "/",
        label: "Overview & Requests",
        keywords: "home approvals requests payments utr unlock revenue summary",
        summary: "Verify client payments, unlock requested plans, and approve wallet top-ups.",
        iconKey: "dashboard",
        showPendingBadge: true,
      },
      {
        href: "/clients",
        label: "Client Directory",
        keywords: "clients businesses accounts onboard suspend custom price team password",
        summary: "Search clients, onboard new businesses, pause accounts, or open full client controls.",
        iconKey: "clients",
      },
      {
        href: "/invoices",
        label: "GST Invoices & Ledger",
        keywords: "invoices gst tax ledger finance csv export void custom invoice",
        summary: "Search all GST invoices, issue manual invoices, mark paid/void, or download CSV.",
        iconKey: "invoices",
      },
      {
        href: "/pricing",
        label: "Plan Prices & Bank Info",
        keywords: "pricing catalog rates upi bank ifsc payment details",
        summary: "Edit monthly & per-unit plan prices and update UPI / Bank receiving details.",
        iconKey: "pricing",
      },
    ],
  },
  {
    heading: "Platform Operations",
    items: [
      {
        href: "/templates",
        label: "WhatsApp & Tally",
        keywords: "whatsapp templates approve tally rules bills starter",
        summary: "Approve client WhatsApp templates, push starter packs, and inspect Tally links.",
        iconKey: "templates",
      },
      {
        href: "/queues",
        label: "Tasks & Emails",
        keywords: "queues tasks failed retry emails notifications feedback",
        summary: "Retry failed tasks, send client account notifications, and review sent emails.",
        iconKey: "queues",
      },
      {
        href: "/staff",
        label: "Staff Team & Roles",
        keywords: "staff admins roles finance support password access",
        summary: "Add staff members, manage Super Admin / Finance / Support roles, and reset passwords.",
        iconKey: "staff",
      },
      {
        href: "/inspector",
        label: "Support Check & Log",
        keywords: "inspector support check audit log history",
        summary: "Run read-only client record checks and search the permanent staff activity log.",
        iconKey: "inspector",
      },
      {
        href: "/runbooks",
        label: "Server Health & Guides",
        keywords: "runbooks health ports services guides",
        summary: "Live port health checks and step-by-step operational guides.",
        iconKey: "runbooks",
      },
      {
        href: "/credentials",
        label: "OAuth & API Credentials",
        keywords: "google oauth drive consent credentials smtp r2 meta razorpay database keys",
        summary: "Manage Google OAuth Consent Screen, SMTP, R2, Meta & Razorpay credentials in DB.",
        iconKey: "credentials",
      },
      {
        href: "/setup",
        label: "Setup & SSL Readiness",
        keywords: "setup ssl domain smtp bootstrap readiness subdomains",
        summary: "Review server onboarding modules, subdomain SSL mode, and SMTP readiness.",
        iconKey: "setup",
      },
    ],
  },
];

export const ADMIN_NAV_HREFS: string[] = ADMIN_NAV_SECTIONS_META.flatMap((section) =>
  section.items.map((item) => item.href)
);

export const ADMIN_PAGE_GUIDES: AdminPageGuide[] = [
  {
    routePrefix: "/",
    exact: true,
    title: "Staff SOP — Verifying Client UTR Payments, Unlocking Plans & Wallet Top-Ups",
    summary:
      "Verify incoming UPI / Bank UTR references against your bank statement, unlock requested plans or bundles, approve wallet top-ups, or open a 30-minute Support View.",
    roleNote: "Finance & Super Admin can approve/decline billing; Support has read-only overview.",
    steps: [
      {
        title: "Verify Plan Activation Requests Against Your Bank Statement",
        detail:
          "Match the client's 12-digit UTR / Bank Ref and confirm bank credit equals Quoted Subtotal × 1.18 (with 18% GST). Enter the Taxable Subtotal Paid (₹) excluding GST, select Payment Method, confirm UTR, keep 'Also unlock companion base plans' ticked if shown, and click 'Record Payment & Unlock'.",
      },
      {
        title: "Approve Verified Prepaid Wallet Top-Up Transfers",
        detail:
          "In 'Wallet Top-Up Payments', verify the submitted UTR and rupee amount in your corporate bank / UPI app, then click 'Approve & Add Balance'. Any negative -₹200 overdraft balance is cleared automatically first.",
      },
      {
        title: "Unlock a Plan Directly or Issue Promotional Wallet Credit",
        detail:
          "If a client paid over phone/NEFT without submitting an online request, use 'Unlock a Plan Directly' (generates a sequential Rule 46 GST invoice) or 'Quick Wallet Adjustment' (requires a 5+ character audit reason).",
      },
      {
        title: "Launch a 30-Minute Audited Support View When Assisting Clients",
        detail:
          "In 'Client Accounts', enter a clear support reason (e.g. 'Tally .tdl setup check') and click 'Support View ↗' to inspect their workspace with a transparent client notice banner.",
      },
    ],
    cautions: [
      "Always enter the pre-GST Taxable Subtotal in 'Subtotal Paid (₹)' — the system adds 9%+9% CGST/SGST (State 27) or 18% IGST automatically!",
    ],
  },
  {
    routePrefix: "/clients/",
    title: "Staff SOP — Deep Client Account Controls, Custom Pricing & Complimentary Access",
    summary:
      "Manage a single client's GST profile, custom Monthly/Quarterly/Yearly pricing, complimentary All-Tools trials, team passwords, wallet ledger, and GST invoices.",
    roleNote: "Super Admin & Finance manage pricing/plans; Support manages onboarding & diagnostics.",
    steps: [
      {
        title: "Grant Complimentary All-Tools Pilot Access Without Polluting GST Ledger",
        detail:
          "Use 'Complimentary All-Tools Free Access' to grant e.g. 7 or 14 pilot days with an audit note — unlocks all 15 tools cleanly without generating ₹0 tax invoices.",
      },
      {
        title: "Configure Custom Negotiated Per-Client Plan Prices",
        detail:
          "Set custom Monthly, Quarterly, or Yearly rupee overrides for specific plans or bundles. The client's Plans & Wallet modal and UPI QR code automatically quote their custom rate.",
      },
      {
        title: "Reset Client Passwords, Verify Emails or Pause Suspended Accounts",
        detail:
          "Assist locked-out client owners by resetting their user password or marking email verified, or pause/resume workspace billing status when required.",
      },
    ],
    cautions: [
      "Revoking an active paid plan locks that screen immediately — record a clear audit note before revoking.",
    ],
  },
  {
    routePrefix: "/clients",
    title: "Staff SOP — Searching Client Accounts & Direct Business Onboarding",
    summary:
      "Search businesses by trade name, GSTIN, or workspace ID, or onboard a brand-new client workspace directly on a sales/onboarding call.",
    roleNote: "Accessible to Super Admin, Finance, and Support.",
    steps: [
      {
        title: "Onboard a New Client Workspace in One Step",
        detail:
          "Enter Business Name, 2-digit GST State Code (27 = Maharashtra), optional 15-character GSTIN, Owner Name, Owner Email, and initial password. Click 'Create Client Account' to provision their isolated SQLite DB and queue *.tally / *.api SSL.",
      },
      {
        title: "Search & Open Full Client Controls",
        detail:
          "Filter by name, GSTIN, or billing status and click 'Manage Client →' to set custom pricing, unlock bundles, grant free access, or reset team credentials.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/invoices/",
    title: "Staff SOP — Printing or Auditing a Sequential Rule 46 GST Tax Invoice",
    summary:
      "Review statutory SAC 998314 tax invoice details and print/save a clean A4 PDF copy for the client or finance archive.",
    roleNote: "Finance & Super Admin.",
    steps: [
      {
        title: "Check Supplier & Recipient GSTIN, State Code & UTR Reference",
        detail:
          "Verify whether intra-state (9% CGST + 9% SGST) or inter-state (18% IGST) tax applied based on recipient State Code.",
      },
      {
        title: "Click 'Print / Save PDF' for Clean Statutory Output",
        detail:
          "All staff navigation chrome hides automatically when printing so only the Rule 46 GST Tax Invoice prints.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/invoices",
    title: "Staff SOP — GST Invoice Ledger, Manual Invoices, Voiding & GSTR-1 CSV Export",
    summary:
      "Audit every sequential GST tax invoice (RSL/YY-YY/XXXX), issue custom manual invoices, settle unpaid invoices, or export CSV for CA filing.",
    roleNote: "Finance & Super Admin.",
    steps: [
      {
        title: "Issue a Manual GST Invoice When Billing Custom Services",
        detail:
          "Select the client workspace, enter line-item description and taxable rupee subtotal, choose Issued (unpaid) or Paid (with UTR), and generate the next sequential invoice number.",
      },
      {
        title: "Settle 'Issued' Invoices or Mark Erroneous Drafts 'Void'",
        detail:
          "Never delete GST serial numbers. Record UTR payment to mark an Issued invoice Paid, or click Void so sequence continuity remains 100% intact for GST audits.",
      },
      {
        title: "Download Monthly CSV Ledger for GSTR-1 / Accounting",
        detail:
          "Click 'Export CSV' to download invoice numbers, dates, client GSTINs, taxable values, CGST, SGST, IGST, totals, and UTRs.",
      },
    ],
    cautions: [
      "Marking an invoice Void cancels the tax document permanently — issue a fresh sequential invoice if needed afterward.",
    ],
  },
  {
    routePrefix: "/pricing",
    title: "Staff SOP — Updating Catalog Plan Prices & Corporate Bank / UPI Receiving Info",
    summary:
      "Manage default Monthly / Per-Unit catalog prices and the corporate Bank + UPI details rendered on all client payment QR modals and GST invoices.",
    roleNote: "Super Admin & Pricing Managers.",
    steps: [
      {
        title: "Update Corporate Bank Account, IFSC, Beneficiary Name & UPI ID",
        detail:
          "Save your verified receiving bank account, IFSC, GSTIN, and optional merchant UPI VPA. Client payment modals immediately generate dynamic UPI QR codes from these exact coordinates.",
      },
      {
        title: "Adjust Default Monthly & Per-Unit Catalog Rates",
        detail:
          "Edit rupee rates for any service plan. Existing per-client custom overrides on /clients/[id] take priority over catalog defaults.",
      },
    ],
    cautions: [
      "Double-check IFSC and Account Number character-by-character before saving — every client's UPI QR code uses these exact values!",
    ],
  },
  {
    routePrefix: "/templates",
    title: "Staff SOP — Approving Client WhatsApp Templates & Auditing Tally Links",
    summary:
      "Push ready-made Tally Prime starter templates to client workspaces, review template compliance, and inspect client Tally sync activity.",
    roleNote: "Support & Super Admin.",
    steps: [
      {
        title: "Push Ready-Made Tally Starter Templates to Any Client",
        detail:
          "Select a client workspace and install tally_tax_invoice_pdf (native Tally PDF header), bill creation, receipt thank-you, and overdue reminder templates in 1 click.",
      },
      {
        title: "Verify Template Placeholder Compliance & Update Status",
        detail:
          "Check that {{1}}..{{4}} variables have text around them and match UTILITY vs MARKETING rules, then update approval status when assisting managed clients.",
      },
      {
        title: "Monitor Client Tally Sync Runs & Paired Windows Devices",
        detail:
          "Confirm whether each client's .tdl v2.5 webhook or Windows Connector v2.2 is actively syncing bills and capturing native Tally PDFs.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/queues",
    title: "Staff SOP — Retrying Failed Background Tasks & Sending Client Email Notices",
    summary:
      "Inspect queued/failed WhatsApp, Tally, and SSL jobs, retry resolved failures safely without double-charging, and email client owners.",
    roleNote: "Operations, Support & Super Admin.",
    steps: [
      {
        title: "Diagnose Failed / Dead-Letter Jobs Before Retrying",
        detail:
          "Read the exact error code (e.g. RSL-BILL-1003 -₹200 wallet overdraft exhausted, or Meta OAuth 190 expired token). Once the client recharges or updates their token, click 'Retry'.",
      },
      {
        title: "Rely on Built-In SendGuard Idempotency Protection",
        detail:
          "Retrying a failed task NEVER charges a client's wallet twice or sends duplicate WhatsApp messages.",
      },
      {
        title: "Send Direct Account Notifications & Check SMTP Delivery Log",
        detail:
          "Select a client business, enter subject and message body, click Send Notification, and confirm delivery status in the Outbound Email table.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/staff",
    title: "Staff SOP — Managing Internal Staff Accounts & Role-Based Console Access",
    summary:
      "Create internal staff logins with least-privilege roles (Super Admin, Finance, Support), rotate passwords, or deactivate departing staff.",
    roleNote: "Super Admin only.",
    steps: [
      {
        title: "Assign Least-Privilege Staff Roles",
        detail:
          "Grant 'finance' for UTR verification, wallet approvals & GST invoices; 'support' for client onboarding, templates, queues & read-only inspector; 'super_admin' for full platform & staff control.",
      },
      {
        title: "Rotate Passwords or Deactivate Accounts Immediately",
        detail:
          "Toggling a staff member Inactive deletes all of their active browser sessions immediately. At least one active Super Admin is always protected against accidental lockout.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/inspector",
    title: "Staff SOP — Running Read-Only Client Support Checks & Searching Audit Logs",
    summary:
      "Execute safe, strictly read-only diagnostic queries on a client's tenant database with mandatory ticket logging, and audit every staff action.",
    roleNote: "Support & Super Admin.",
    steps: [
      {
        title: "Select Client, Pick Diagnostic Check & Enter Ticket Reference",
        detail:
          "Choose the client workspace, select a read-only check (record counts, latest 20 Tally bills, sync runs, channel health), enter your call/ticket ID (e.g. SUP-108), and run.",
      },
      {
        title: "Review the Permanent Staff Activity Log",
        detail:
          "Every staff login, payment unlock, price edit, impersonation session, and inspector check is recorded permanently below and cannot be altered.",
      },
    ],
    cautions: [],
  },
  {
    routePrefix: "/credentials",
    title: "Staff SOP — Google OAuth Consent Screen & Database-Controlled API Credentials",
    summary:
      "Configure the RapidShift Labs Google OAuth 2.0 Web Client (for 1-click customer Google Drive & Business Profile connections), SMTP email, Cloudflare R2, Meta App, and Razorpay — encrypted directly in control.db without SSH .env edits.",
    roleNote: "Super Admin only — all secrets encrypted with AES-256-GCM envelope keys.",
    steps: [
      {
        title: "Create a Google 'Web Application' OAuth Client (NEVER a Service Account JSON!)",
        detail:
          "In console.cloud.google.com → APIs & Services → Library, enable 'Google Drive API'. Configure the 'RapidShift Labs' External OAuth Consent Screen and click PUBLISH APP. Then go to Credentials → + Create Credentials → OAuth client ID → Application type: Web application (do NOT choose Service Account).",
      },
      {
        title: "Paste Exact Origin & Callback URI Shown on This Page",
        detail:
          "Copy the Authorized JavaScript Origin (https://app.rapidshiftlabs.in) and Authorized Redirect URI (https://app.rapidshiftlabs.in/api/oauth/google/callback) from the top guide card into Google Cloud Console, then paste either the downloaded client_secret_*.json or Client ID + Secret below.",
      },
      {
        title: "Verify SMTP, Managed R2, Meta App & Razorpay in Database",
        detail:
          "Save any platform-wide API keys below to override .env immediately across all PM2 workers without restarting the server, and click 'Send Live Test Email' to verify SMTP delivery.",
      },
    ],
    cautions: [
      "Do NOT create or paste a Google Service Account JSON ('type': 'service_account'). Service accounts have zero personal Drive quota and cannot display Google's 'Sign in with Google' consent screen.",
      "Always click 'PUBLISH APP' under Google Auth Platform → Audience so customer refresh tokens do not expire every 7 days.",
    ],
  },
  {
    routePrefix: "/setup",
    title: "Staff SOP — Platform Onboarding Modules, Wildcard SSL Mode & Server Readiness",
    summary:
      "Verify Super Admin bootstrap lock status, subdomain HTTPS configuration (*.tally & *.api), SSL_PROVIDER_MODE, and SMTP readiness.",
    roleNote: "Super Admin readiness hub (also served on setup.rapidshiftlabs.in).",
    steps: [
      {
        title: "Confirm Bootstrap Lock & Subdomain Routing",
        detail:
          "Verify Step 1 shows 'Bootstrap Completed & Locked' and confirm app, admin, docs, setup, *.tally, and *.api point to your origin server IP.",
      },
      {
        title: "Keep *.tally and *.api Set to 'DNS Only (Grey Cloud)' in Cloudflare",
        detail:
          "Cloudflare Free Universal SSL does not cover second-level wildcards (*.tally.rapidshiftlabs.in). Set *.tally and *.api to Grey Cloud so Nginx + Let's Encrypt serves valid TLS directly, then run 'bash update.sh' on the server to verify!",
      },
    ],
    cautions: [],
  },
];

export function resolveAdminPageGuide(pathname: string): AdminPageGuide | null {
  const clean = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (clean === "/runbooks" || clean.startsWith("/runbooks/")) {
    return null;
  }
  for (const guide of ADMIN_PAGE_GUIDES) {
    if (guide.exact) {
      if (clean === guide.routePrefix) return guide;
    } else if (guide.routePrefix.endsWith("/")) {
      if (clean.startsWith(guide.routePrefix) && clean.length > guide.routePrefix.length) {
        return guide;
      }
    } else if (clean === guide.routePrefix || clean.startsWith(`${guide.routePrefix}/`)) {
      return guide;
    }
  }
  return ADMIN_PAGE_GUIDES[0] ?? null;
}
