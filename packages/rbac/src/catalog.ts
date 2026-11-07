export interface PermissionMeta {
  key: string;
  group: string;
  label: string;
  description: string;
}

export const PERMISSION_CATALOG = {
  "workspace:manage": {
    key: "workspace:manage",
    group: "Business & Team",
    label: "Edit business profile",
    description: "Update business name, GSTIN, state, and timezone.",
  },
  "members:invite": {
    key: "members:invite",
    group: "Business & Team",
    label: "Invite team members",
    description: "Invite colleagues and assign their access roles.",
  },
  "members:remove": {
    key: "members:remove",
    group: "Business & Team",
    label: "Remove team members",
    description: "Revoke a colleague's access to this business.",
  },
  "roles:manage": {
    key: "roles:manage",
    group: "Business & Team",
    label: "Manage custom roles",
    description: "Create or edit custom permission roles.",
  },

  "billing:view": {
    key: "billing:view",
    group: "Plans & Wallet",
    label: "View plans, wallet & invoices",
    description: "See active plans, wallet balance, and GST invoices.",
  },
  "billing:manage": {
    key: "billing:manage",
    group: "Plans & Wallet",
    label: "Manage plans & add wallet funds",
    description: "Activate plans, add prepaid balance, and manage billing.",
  },

  "connections:view": {
    key: "connections:view",
    group: "Connected Apps",
    label: "View connected accounts",
    description: "View connected WhatsApp, Meta, Google, and Tally status.",
  },
  "connections:manage": {
    key: "connections:manage",
    group: "Connected Apps",
    label: "Connect or disconnect accounts",
    description: "Link or remove WhatsApp numbers, social pages, and Tally PCs.",
  },

  "inbox:view": {
    key: "inbox:view",
    group: "Customer Messages",
    label: "Read customer messages",
    description: "Open customer chat threads and search messages.",
  },
  "inbox:reply": {
    key: "inbox:reply",
    group: "Customer Messages",
    label: "Reply to customers",
    description: "Send messages and replies to customers.",
  },
  "inbox:assign": {
    key: "inbox:assign",
    group: "Customer Messages",
    label: "Assign conversations",
    description: "Assign chats to team members and update chat status.",
  },
  "inbox:note": {
    key: "inbox:note",
    group: "Customer Messages",
    label: "Write internal team notes",
    description: "Leave private notes inside customer conversations.",
  },

  "reviews:view": {
    key: "reviews:view",
    group: "Google Reviews",
    label: "View Google reviews",
    description: "Read customer star ratings and reviews across locations.",
  },
  "reviews:reply": {
    key: "reviews:reply",
    group: "Google Reviews",
    label: "Reply to Google reviews",
    description: "Publish public responses to Google Business reviews.",
  },
  "reviews:autoreply.manage": {
    key: "reviews:autoreply.manage",
    group: "Google Reviews",
    label: "Configure auto-reply rules",
    description: "Set rating rules for automatic review reply drafts.",
  },

  "posts:view": {
    key: "posts:view",
    group: "Social Publishing",
    label: "View scheduled posts",
    description: "View planned Instagram, Facebook, and Google posts.",
  },
  "posts:create": {
    key: "posts:create",
    group: "Social Publishing",
    label: "Draft social posts",
    description: "Create social post drafts and upload media.",
  },
  "posts:publish": {
    key: "posts:publish",
    group: "Social Publishing",
    label: "Publish posts immediately",
    description: "Publish posts directly to connected social pages.",
  },
  "posts:schedule": {
    key: "posts:schedule",
    group: "Social Publishing",
    label: "Schedule future posts",
    description: "Schedule posts on the content calendar.",
  },

  "ads:view": {
    key: "ads:view",
    group: "Ad Campaigns",
    label: "View ad campaigns & results",
    description: "View ad spend, clicks, conversions, and sales return.",
  },
  "ads:create": {
    key: "ads:create",
    group: "Ad Campaigns",
    label: "Create ad campaigns",
    description: "Create new Facebook and Instagram ad campaigns.",
  },
  "ads:budget.edit": {
    key: "ads:budget.edit",
    group: "Ad Campaigns",
    label: "Change daily ad budgets",
    description: "Increase or decrease daily campaign spend limits.",
  },
  "ads:pause": {
    key: "ads:pause",
    group: "Ad Campaigns",
    label: "Pause or resume ads",
    description: "Pause or restart active ad campaigns.",
  },

  "pixel:view": {
    key: "pixel:view",
    group: "Website Sales Tracking",
    label: "View website sales events",
    description: "Inspect purchase and lead tracking events.",
  },
  "pixel:manage": {
    key: "pixel:manage",
    group: "Website Sales Tracking",
    label: "Configure website tracking",
    description: "Record and configure server-side sales tracking.",
  },

  "whatsapp:view": {
    key: "whatsapp:view",
    group: "WhatsApp",
    label: "View WhatsApp templates & broadcasts",
    description: "View WhatsApp message templates, opt-ins, and broadcast history.",
  },
  "whatsapp:send": {
    key: "whatsapp:send",
    group: "WhatsApp",
    label: "Send 1-to-1 WhatsApp messages",
    description: "Send individual WhatsApp messages and templates.",
  },
  "whatsapp:template.manage": {
    key: "whatsapp:template.manage",
    group: "WhatsApp",
    label: "Create WhatsApp templates",
    description: "Create and manage message templates.",
  },
  "whatsapp:broadcast": {
    key: "whatsapp:broadcast",
    group: "WhatsApp",
    label: "Send bulk WhatsApp broadcasts",
    description: "Launch WhatsApp broadcasts to opted-in contacts.",
  },

  "tally:view": {
    key: "tally:view",
    group: "Tally Bills & Sync",
    label: "View Tally bills & aging",
    description: "View synced Tally bills, payments, and overdue balances.",
  },
  "tally:sync.manage": {
    key: "tally:sync.manage",
    group: "Tally Bills & Sync",
    label: "Manage Tally sync & rules",
    description: "Pair Tally PCs, import bills, and edit reminder schedules.",
  },
  "tally:invoice.send": {
    key: "tally:invoice.send",
    group: "Tally Bills & Sync",
    label: "Send bills & payment reminders",
    description: "Send Tally invoices and overdue reminders on WhatsApp.",
  },

  "backup:view": {
    key: "backup:view",
    group: "Backups & Export",
    label: "View backup history",
    description: "Check backup status, sizes, and schedules.",
  },
  "backup:manage": {
    key: "backup:manage",
    group: "Backups & Export",
    label: "Run backups & exports",
    description: "Trigger encrypted backups and CSV/JSON data exports.",
  },
  "backup:restore": {
    key: "backup:restore",
    group: "Backups & Export",
    label: "Restore from backup",
    description: "Restore business data from a verified backup snapshot.",
  },
  "backup:destination.manage": {
    key: "backup:destination.manage",
    group: "Backups & Export",
    label: "Configure backup storage",
    description: "Add or edit Google Drive, S3, or R2 backup folders.",
  },

  "apikeys:view": {
    key: "apikeys:view",
    group: "Developer API",
    label: "View API keys",
    description: "View active live and test API keys.",
  },
  "apikeys:manage": {
    key: "apikeys:manage",
    group: "Developer API",
    label: "Create or revoke API keys",
    description: "Issue, rotate, or revoke developer API keys.",
  },

  "logs:view": {
    key: "logs:view",
    group: "Activity History",
    label: "View activity history",
    description: "Inspect business activity logs and step-by-step traces.",
  },
  "logs:export": {
    key: "logs:export",
    group: "Activity History",
    label: "Export activity logs",
    description: "Download activity records as CSV or JSON.",
  },
  "audit:view": {
    key: "audit:view",
    group: "Activity History",
    label: "Verify permanent records",
    description: "Check that past activity records have not been altered.",
  },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSION_CATALOG;

export const ALL_PERMISSIONS = Object.keys(PERMISSION_CATALOG) as Permission[];

export const VIEW_ONLY_PERMISSIONS = ALL_PERMISSIONS.filter((p) =>
  p.endsWith(":view")
) as Permission[];

export interface SystemRoleDefinition {
  slug: "owner" | "admin" | "manager" | "agent" | "analyst" | "billing";
  name: string;
  description: string;
  permissions: Permission[];
}

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    slug: "owner",
    name: "Business Owner",
    description:
      "Full control over everything including billing, wallet, team, and backup restores.",
    permissions: ALL_PERMISSIONS,
  },
  {
    slug: "admin",
    name: "Admin",
    description:
      "Full operational access except changing billing plans or restoring over live data.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "billing:manage" && p !== "backup:restore"),
  },
  {
    slug: "manager",
    name: "Marketing & Operations Manager",
    description:
      "Manages messages, reviews, social posts, ad campaigns, WhatsApp sends, and views Tally bills.",
    permissions: [
      "inbox:view",
      "inbox:reply",
      "inbox:assign",
      "inbox:note",
      "reviews:view",
      "reviews:reply",
      "posts:view",
      "posts:create",
      "posts:publish",
      "posts:schedule",
      "ads:view",
      "ads:create",
      "ads:pause",
      "pixel:view",
      "whatsapp:view",
      "whatsapp:send",
      "whatsapp:template.manage",
      "whatsapp:broadcast",
      "tally:view",
      "tally:invoice.send",
      "connections:view",
      "logs:view",
    ],
  },
  {
    slug: "agent",
    name: "Support Executive",
    description:
      "Replies to customer messages, leaves team notes, and responds to Google reviews.",
    permissions: ["inbox:view", "inbox:reply", "inbox:note", "reviews:view", "reviews:reply"],
  },
  {
    slug: "analyst",
    name: "View-Only Analyst",
    description:
      "Can view all dashboards, analytics, reports, bills, and activity logs without changing data.",
    permissions: [...VIEW_ONLY_PERMISSIONS, "audit:view"],
  },
  {
    slug: "billing",
    name: "Accounts & Billing",
    description:
      "Manages plans, prepaid wallet recharges, GST invoices, and views Tally bills.",
    permissions: ["billing:view", "billing:manage", "tally:view", "audit:view", "logs:view"],
  },
];

export function formatRoleLabel(roleSlug: string): string {
  const sys = SYSTEM_ROLES.find((r) => r.slug === roleSlug);
  if (sys) return sys.name;
  return roleSlug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Route-level RBAC rules for Customer Web App (`apps/web`).
 * Empty `anyOf` means any authenticated workspace member may access the route.
 */
export const WEB_ROUTE_ACCESS_RULES: Array<{
  prefix: string;
  exact?: boolean;
  anyOf: Permission[];
  label: string;
}> = [
  { prefix: "/", exact: true, anyOf: [], label: "Business Overview" },
  {
    prefix: "/analytics",
    anyOf: ["tally:view", "ads:view", "pixel:view", "billing:view"],
    label: "Detailed Analytics",
  },
  { prefix: "/inbox", anyOf: ["inbox:view"], label: "Customer Messages" },
  {
    prefix: "/tally/parties",
    anyOf: ["tally:view", "tally:sync.manage", "tally:invoice.send"],
    label: "Client & Supplier Ledgers",
  },
  {
    prefix: "/tally",
    anyOf: ["tally:view", "tally:sync.manage", "tally:invoice.send"],
    label: "Tally Prime & Bills",
  },
  {
    prefix: "/inventory",
    anyOf: ["tally:view", "tally:sync.manage", "tally:invoice.send"],
    label: "Inventory & Stock",
  },
  {
    prefix: "/whatsapp",
    anyOf: ["whatsapp:view", "whatsapp:send", "whatsapp:template.manage", "whatsapp:broadcast"],
    label: "WhatsApp & Templates",
  },
  {
    prefix: "/campaigns",
    anyOf: ["ads:view", "posts:view", "pixel:view"],
    label: "Ads & Social Posts",
  },
  { prefix: "/reviews", anyOf: ["reviews:view"], label: "Google Reviews" },
  { prefix: "/settings", exact: true, anyOf: [], label: "Settings Index" },
  { prefix: "/settings/profile", anyOf: [], label: "My Profile" },
  {
    prefix: "/settings/business",
    anyOf: ["workspace:manage", "billing:view"],
    label: "Business Settings",
  },
  {
    prefix: "/settings/team",
    anyOf: ["members:invite", "members:remove", "roles:manage"],
    label: "Team & Roles",
  },
  {
    prefix: "/connections",
    anyOf: ["connections:view", "connections:manage"],
    label: "Connected Channels",
  },
  {
    prefix: "/settings/tokens",
    anyOf: ["apikeys:view", "apikeys:manage", "connections:manage", "tally:sync.manage"],
    label: "All API Tokens",
  },
  {
    prefix: "/settings/api-keys",
    anyOf: ["apikeys:view", "apikeys:manage"],
    label: "Developer API Keys",
  },
  {
    prefix: "/developers",
    anyOf: ["apikeys:view", "apikeys:manage"],
    label: "Developer API & Sandbox",
  },
  {
    prefix: "/billing",
    anyOf: ["billing:view", "billing:manage"],
    label: "Plans, Wallet & GST Invoices",
  },
  {
    prefix: "/backups",
    anyOf: ["backup:view", "backup:manage", "backup:restore", "backup:destination.manage"],
    label: "Backups & Storage",
  },
  {
    prefix: "/activity",
    anyOf: ["logs:view", "audit:view"],
    label: "Activity History",
  },
  {
    prefix: "/status",
    anyOf: ["logs:view", "connections:view", "billing:view"],
    label: "Workspace Health",
  },
  { prefix: "/help", anyOf: [], label: "Guides & Help" },
  { prefix: "/legal", anyOf: [], label: "Legal & Compliance Center" },
  { prefix: "/privacy", anyOf: [], label: "Privacy Policy" },
  { prefix: "/terms", anyOf: [], label: "Terms & Conditions" },
  { prefix: "/payment-terms", anyOf: [], label: "Payment & GST Billing Terms" },
  { prefix: "/refund-policy", anyOf: [], label: "Refund & Cancellation Policy" },
  { prefix: "/service-delivery", anyOf: [], label: "Service Delivery Policy" },
  { prefix: "/acceptable-use", anyOf: [], label: "Acceptable Use & Messaging Policy" },
  { prefix: "/cookies", anyOf: [], label: "Cookie & Session Policy" },
  { prefix: "/data-deletion", anyOf: [], label: "User Data Deletion & Grievance" },
  { prefix: "/dpa", anyOf: [], label: "Data Processing & Security Addendum" },
  { prefix: "/pay", anyOf: [], label: "Public Bill Payment Portal" },
];

export function canPermissionsAccessWebRoute(
  grantedPermissions: Iterable<Permission | string>,
  pathname: string
): boolean {
  const cleanPath = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const permSet = new Set(grantedPermissions);

  for (const rule of WEB_ROUTE_ACCESS_RULES) {
    const matched = rule.exact
      ? cleanPath === rule.prefix
      : cleanPath === rule.prefix || cleanPath.startsWith(`${rule.prefix}/`);
    if (matched) {
      if (rule.anyOf.length === 0) return true;
      return rule.anyOf.some((p) => permSet.has(p));
    }
  }
  return false;
}

/* ============================================================================
 * Staff Console (`apps/admin`) RBAC — Super Admin, Finance & Support
 * ============================================================================ */

export type StaffRoleSlug = "super_admin" | "finance" | "support";

export const STAFF_PERMISSION_CATALOG = {
  "staff:clients.view": {
    key: "staff:clients.view",
    label: "View client directory & profiles",
  },
  "staff:clients.manage": {
    key: "staff:clients.manage",
    label: "Onboard clients, update profiles & reset client passwords",
  },
  "staff:impersonate": {
    key: "staff:impersonate",
    label: "Start audited 30-minute client support view",
  },
  "staff:billing.view": {
    key: "staff:billing.view",
    label: "View GST invoices, wallet ledgers & revenue reports",
  },
  "staff:billing.manage": {
    key: "staff:billing.manage",
    label: "Approve payments, unlock plans, adjust wallets & issue GST invoices",
  },
  "staff:pricing.manage": {
    key: "staff:pricing.manage",
    label: "Update global plan pricing & UPI/Bank receiving details",
  },
  "staff:templates.manage": {
    key: "staff:templates.manage",
    label: "Approve WhatsApp templates, push starter packs & inspect Tally sync",
  },
  "staff:ops.view": {
    key: "staff:ops.view",
    label: "Inspect client records, queues & redacted support bundles",
  },
  "staff:ops.manage": {
    key: "staff:ops.manage",
    label: "Replay failed queue tasks & review custom storage requests",
  },
  "staff:flags.manage": {
    key: "staff:flags.manage",
    label: "Toggle platform-wide rollout feature flags",
  },
  "staff:team.manage": {
    key: "staff:team.manage",
    label: "Create & manage internal staff accounts and roles",
  },
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSION_CATALOG;

const ALL_STAFF_PERMISSIONS = Object.keys(STAFF_PERMISSION_CATALOG) as StaffPermission[];

export const STAFF_ROLE_PERMISSIONS: Record<StaffRoleSlug, StaffPermission[]> = {
  super_admin: ALL_STAFF_PERMISSIONS,
  finance: [
    "staff:clients.view",
    "staff:billing.view",
    "staff:billing.manage",
    "staff:pricing.manage",
  ],
  support: [
    "staff:clients.view",
    "staff:clients.manage",
    "staff:impersonate",
    "staff:templates.manage",
    "staff:ops.view",
    "staff:ops.manage",
  ],
};

export function formatStaffRoleLabel(staffRole: string): string {
  if (staffRole === "super_admin") return "Super Admin";
  if (staffRole === "finance") return "Finance & Billing";
  if (staffRole === "support") return "Client Support";
  return staffRole.replace(/_/g, " ");
}

export function getStaffPermissions(staffRole: string): Set<StaffPermission> {
  const list = STAFF_ROLE_PERMISSIONS[staffRole as StaffRoleSlug];
  return new Set(list ?? []);
}

export function canStaffRolePerform(staffRole: string, permission: StaffPermission): boolean {
  return getStaffPermissions(staffRole).has(permission);
}

export const STAFF_ROUTE_ACCESS_RULES: Array<{
  prefix: string;
  exact?: boolean;
  anyOf: StaffPermission[];
  label: string;
}> = [
  { prefix: "/", exact: true, anyOf: ["staff:clients.view"], label: "Overview & Requests" },
  { prefix: "/clients", anyOf: ["staff:clients.view"], label: "Client Directory" },
  { prefix: "/invoices", anyOf: ["staff:billing.view"], label: "GST Invoices & Ledger" },
  { prefix: "/pricing", anyOf: ["staff:pricing.manage"], label: "Plan Prices & Bank Info" },
  { prefix: "/templates", anyOf: ["staff:templates.manage"], label: "WhatsApp & Tally" },
  { prefix: "/queues", anyOf: ["staff:ops.view"], label: "Tasks & Emails" },
  { prefix: "/staff", anyOf: ["staff:team.manage"], label: "Staff Team & Roles" },
  { prefix: "/inspector", anyOf: ["staff:ops.view"], label: "Support Check & Log" },
  { prefix: "/runbooks", anyOf: ["staff:clients.view"], label: "Server Health & Guides" },
  { prefix: "/credentials", anyOf: ["staff:team.manage"], label: "OAuth & API Credentials" },
  { prefix: "/setup", anyOf: ["staff:team.manage"], label: "Setup & SSL Readiness" },
];

export function canStaffAccessAdminRoute(staffRole: string, pathname: string): boolean {
  const cleanPath = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const perms = getStaffPermissions(staffRole);

  for (const rule of STAFF_ROUTE_ACCESS_RULES) {
    const matched = rule.exact
      ? cleanPath === rule.prefix
      : cleanPath === rule.prefix || cleanPath.startsWith(`${rule.prefix}/`);
    if (matched) {
      if (rule.anyOf.length === 0) return true;
      return rule.anyOf.some((p) => perms.has(p));
    }
  }
  return false;
}
