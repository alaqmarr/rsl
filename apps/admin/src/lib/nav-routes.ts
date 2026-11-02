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
