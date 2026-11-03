import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  computeIndianFinancialYearIst,
  escapeCsvCellSafe,
  formatInr,
  formatIstDateIso,
  getEnv,
  newId,
  RslError,
  verifyHmac,
} from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { sendBillingNotification } from "@rsl/notifications";
import { controlDb, getPlatformRazorpayConfig } from "@rsl/tenancy";
import {
  BILLING_CYCLE_META,
  type BillingCycle,
  buildUpiPaymentPayload,
  computeDefaultCycleAmountsPaise,
  computeGstTaxSplit,
  diagnoseUpiPayeeConfig,
  formatBankAccountUpiAddress,
  isEmailLikeHandle,
  isValidRbiIfsc,
  isValidUpiVpa,
  normalizeBillingCycle,
  type UpiQrRoutingMode,
} from "./upi";

export * from "./upi";
export * from "./pdf";

/**
 * Maximum negative wallet overdraft permitted for metered per-message & per-request usage (`-₹200.00`).
 */
export const WALLET_OVERDRAFT_LIMIT_PAISE = 20_000;
export const MIN_WALLET_BALANCE_PAISE = -WALLET_OVERDRAFT_LIMIT_PAISE;

export function getWalletAvailableSpendPaise(balancePaise: number): number {
  return Math.max(0, balancePaise + WALLET_OVERDRAFT_LIMIT_PAISE);
}

export function canDebitWalletUsage(balancePaise: number, costPaise: number): boolean {
  return balancePaise - costPaise >= MIN_WALLET_BALANCE_PAISE;
}

export interface ServiceDefinition {
  key: string;
  name: string;
  plainSummary: string;
  category: "Messages & Support" | "WhatsApp & Tally" | "Social & Ads" | "Google" | "Data & Developer";
  dependsOn: string[];
  pricingModel: "flat_monthly" | "per_seat" | "usage" | "wallet_plus_monthly";
  meteredUnit: string;
  defaultMonthlyPaise: number;
  defaultUnitPaise: number;
  sortOrder: number;
}

export const SERVICE_CATALOG: readonly ServiceDefinition[] = [
  {
    key: "inbox",
    name: "Shared Customer Inbox",
    plainSummary: "Manage WhatsApp, Instagram, Facebook, and Google customer replies in one team inbox.",
    category: "Messages & Support",
    dependsOn: [],
    pricingModel: "per_seat",
    meteredUnit: "team members",
    defaultMonthlyPaise: 24900,
    defaultUnitPaise: 9900,
    sortOrder: 1,
  },
  {
    key: "whatsapp.messaging",
    name: "WhatsApp Business Messaging",
    plainSummary: "Send and receive 1-to-1 customer messages and approved templates on your WhatsApp number.",
    category: "WhatsApp & Tally",
    dependsOn: [],
    pricingModel: "wallet_plus_monthly",
    meteredUnit: "conversations",
    defaultMonthlyPaise: 29900,
    defaultUnitPaise: 85,
    sortOrder: 2,
  },
  {
    key: "whatsapp.broadcast",
    name: "WhatsApp Bulk Broadcasts",
    plainSummary: "Send offers, announcements, and updates to opted-in customer lists with live delivery tracking.",
    category: "WhatsApp & Tally",
    dependsOn: ["whatsapp.messaging"],
    pricingModel: "usage",
    meteredUnit: "recipients",
    defaultMonthlyPaise: 19900,
    defaultUnitPaise: 95,
    sortOrder: 3,
  },
  {
    key: "tally.sync",
    name: "All-in-One Tally Prime Sync, Ledgers & Inventory",
    plainSummary:
      "Sync Sales, Receipts, Payments, Credit/Debit Notes, Client & Supplier Ledgers, Paid-in-Tally status, and Stock & Godown Inventory.",
    category: "WhatsApp & Tally",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "Tally companies",
    defaultMonthlyPaise: 29900,
    defaultUnitPaise: 0,
    sortOrder: 4,
  },
  {
    key: "tally.invoicing",
    name: "Tally Bills & Payment Reminders on WhatsApp",
    plainSummary: "Automatically send Tally sales bills, ledger statements, and polite overdue payment reminders on WhatsApp.",
    category: "WhatsApp & Tally",
    dependsOn: ["tally.sync", "whatsapp.messaging"],
    pricingModel: "wallet_plus_monthly",
    meteredUnit: "bill messages",
    defaultMonthlyPaise: 19900,
    defaultUnitPaise: 85,
    sortOrder: 5,
  },
  {
    key: "meta.pages",
    name: "Facebook Page Publishing & Comments",
    plainSummary: "Schedule Facebook Page posts and reply to comments from one place.",
    category: "Social & Ads",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "Facebook pages",
    defaultMonthlyPaise: 19900,
    defaultUnitPaise: 0,
    sortOrder: 6,
  },
  {
    key: "meta.instagram",
    name: "Instagram Publishing & DMs",
    plainSummary: "Schedule Reels, Stories, and Feed posts, and respond to Instagram comments and messages.",
    category: "Social & Ads",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "Instagram accounts",
    defaultMonthlyPaise: 24900,
    defaultUnitPaise: 0,
    sortOrder: 7,
  },
  {
    key: "meta.pixel",
    name: "Website Sales Tracking (Pixel & Server Events)",
    plainSummary: "Track real website purchases and leads accurately without duplicate counting.",
    category: "Social & Ads",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "events / month",
    defaultMonthlyPaise: 24900,
    defaultUnitPaise: 0,
    sortOrder: 8,
  },
  {
    key: "meta.ads",
    name: "Facebook & Instagram Ad Campaigns",
    plainSummary: "Launch, pause, and track return per ₹1 spent across Facebook and Instagram ads.",
    category: "Social & Ads",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "ad accounts",
    defaultMonthlyPaise: 39900,
    defaultUnitPaise: 0,
    sortOrder: 9,
  },
  {
    key: "google.reviews",
    name: "Google Business Reviews & Replies",
    plainSummary: "Monitor star ratings across store locations and reply to customer reviews quickly.",
    category: "Google",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "store locations",
    defaultMonthlyPaise: 19900,
    defaultUnitPaise: 0,
    sortOrder: 10,
  },
  {
    key: "google.autoreply",
    name: "Smart Review Reply Drafts",
    plainSummary: "Prepare suggested replies for new Google reviews with one-click approval.",
    category: "Google",
    dependsOn: ["google.reviews"],
    pricingModel: "usage",
    meteredUnit: "reply drafts",
    defaultMonthlyPaise: 14900,
    defaultUnitPaise: 100,
    sortOrder: 11,
  },
  {
    key: "backup.export",
    name: "Encrypted Customer Backups & Export",
    plainSummary: "Save signed, encrypted copies of your business data to your own Drive, S3, or R2 folder.",
    category: "Data & Developer",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "backup runs",
    defaultMonthlyPaise: 14900,
    defaultUnitPaise: 0,
    sortOrder: 12,
  },
  {
    key: "storage.managed",
    name: "RSL Managed Cloud Storage (Cloudflare R2)",
    plainSummary: "Store Tally PDFs, social media files, and backups on RSL's managed cloud vault — or switch to your own R2 anytime.",
    category: "Data & Developer",
    dependsOn: [],
    pricingModel: "wallet_plus_monthly",
    meteredUnit: "GB stored",
    defaultMonthlyPaise: 9900,
    defaultUnitPaise: 1500,
    sortOrder: 13,
  },
  {
    key: "backup.custom",
    name: "Custom Backup Storage Adapter",
    plainSummary: "Connect a dedicated custom storage provider requested by your IT team.",
    category: "Data & Developer",
    dependsOn: ["backup.export"],
    pricingModel: "flat_monthly",
    meteredUnit: "storage adapters",
    defaultMonthlyPaise: 99900,
    defaultUnitPaise: 0,
    sortOrder: 14,
  },
  {
    key: "api.access",
    name: "Developer REST API & Webhooks",
    plainSummary: "Connect your ERP, website, or custom software using live and sandbox API keys.",
    category: "Data & Developer",
    dependsOn: [],
    pricingModel: "flat_monthly",
    meteredUnit: "requests / month",
    defaultMonthlyPaise: 29900,
    defaultUnitPaise: 0,
    sortOrder: 15,
  },
] as const;

export type ServiceKey = (typeof SERVICE_CATALOG)[number]["key"];

export interface PlanFeatureDetail {
  tagline: string;
  whoItsFor: string;
  includedFeatures: string[];
  billingHighlights: string;
}

export const PLAN_FEATURE_DETAILS: Record<string, PlanFeatureDetail> = {
  inbox: {
    tagline: "Bring every WhatsApp, Instagram, Facebook, and Google inquiry into one shared team inbox.",
    whoItsFor: "Sales & support teams handling daily customer inquiries across multiple channels.",
    includedFeatures: [
      "Unified conversation inbox across WhatsApp, Instagram DMs, Facebook Messenger, and Google",
      "Automatic 24-hour WhatsApp reply window tracking with one-click switch to approved templates",
      "Private internal team notes alongside customer chats so staff stay aligned",
      "Reply speed tracking, open/resolved thread filters, and CSV contact directory import",
    ],
    billingHighlights: "Monthly base plan plus per-team-member seat rate. Includes official 18% GST tax invoice.",
  },
  "whatsapp.messaging": {
    tagline: "Official WhatsApp Business API messaging & custom template studio on your business number.",
    whoItsFor: "Businesses sending order updates, customer replies, and verified WhatsApp Business templates.",
    includedFeatures: [
      "Full WhatsApp Business Template Studio with headers, Tally variables, and quick-reply/call/link buttons",
      "One-click sync with your connected WhatsApp Business Account",
      "Direct 1-to-1 template and customer replies with real-time sent, delivered, and read receipts",
      "Automatic STOP / unsubscribe protection so opted-out numbers are never messaged",
    ],
    billingHighlights: "Monthly platform access plus per-conversation usage deducted from your Prepaid Wallet.",
  },
  "whatsapp.broadcast": {
    tagline: "Send festival offers, price lists, and announcements to opted-in customer lists.",
    whoItsFor: "Retailers, wholesalers, and brands running promotional or seasonal campaigns on WhatsApp.",
    includedFeatures: [
      "Bulk broadcast launcher using approved WhatsApp templates",
      "Live recipient-by-recipient delivery, read, and reply tracking",
      "Automatic exclusion of unsubscribed contacts before a single rupee is spent",
      "Pre-send audience count and wallet cost check",
    ],
    billingHighlights: "Requires WhatsApp Business Messaging. Per-recipient usage deducted only for eligible opted-in numbers.",
  },
  "tally.sync": {
    tagline: "All-in-One Tally Prime Suite: Live Paid-in-Tally Sync, Client & Supplier Ledgers, Running Balance Statements & Inventory.",
    whoItsFor: "Wholesalers, manufacturers, retailers, and CAs wanting complete BizAnalyst / Livekeeping-grade Tally visibility on web & mobile.",
    includedFeatures: [
      "Personalized '<Your Business> & RSL Sync' Tally Prime .tdl add-on + 1-click Windows PC connector",
      "Automatic 'Paid in Tally' bill-wise settlement engine (Receipts, Payments, Credit/Debit Notes & Cash Counter bills)",
      "Full Client & Supplier Ledgers (Sundry Debtors & Creditors) with T-account running balance statements & PDF download",
      "5-bucket receivables & payables ageing (0–15, 16–30, 31–60, 61–90, 90+ days) + Credit Limit breach alerts",
      "Live Stock Items, Godown balances, Reorder alerts, Dead Stock, and Batch Expiry tracking",
    ],
    billingHighlights: "Accessible Indian SMB pricing per Tally workspace with unlimited voucher, ledger, and stock syncs.",
  },
  "tally.invoicing": {
    tagline: "Automatically send WhatsApp bills & polite overdue reminders the moment a voucher is saved in Tally.",
    whoItsFor: "Accounts & dispatch teams wanting zero-manual-work WhatsApp bill delivery and faster collections.",
    includedFeatures: [
      "Event-driven Tally-to-WhatsApp automation rules for Sales Bills, Receipts, Credit Notes, and Delivery Challans",
      "Automatic mapping of Party Name, Voucher No., Bill Amount, Due Date, and Balance into WhatsApp templates",
      "Scheduled overdue payment reminder rules that auto-cancel the moment a bill is marked Paid in Tally",
      "1-click manual 'Send Bill on WhatsApp', 'Share Party Ledger Statement', and 'Send Polite Reminder' actions",
    ],
    billingHighlights: "Requires Tally Prime Live Sync + WhatsApp Business Messaging. Per-bill message fee applies.",
  },
  "meta.pages": {
    tagline: "Schedule Facebook Page updates and manage customer comments from one dashboard.",
    whoItsFor: "Local businesses and brands maintaining an active Facebook Page presence.",
    includedFeatures: [
      "Visual post scheduler for Facebook Pages with instant or scheduled publishing",
      "Centralized post history and reach/engagement tracking",
      "Seamless connection with your Facebook Business Page",
    ],
    billingHighlights: "Flat monthly plan with unlimited scheduled Facebook Page posts.",
  },
  "meta.instagram": {
    tagline: "Plan Instagram Feed & Reel posts and keep up with customer DMs and comments.",
    whoItsFor: "D2C brands, showrooms, and creators growing sales through Instagram.",
    includedFeatures: [
      "Schedule Instagram Feed posts and Reels from your calendar",
      "Track post status, reach, and audience engagement",
      "Works alongside Shared Customer Inbox for Instagram direct messages",
    ],
    billingHighlights: "Flat monthly plan per connected Instagram Business account.",
  },
  "meta.pixel": {
    tagline: "Track real website orders and leads accurately without duplicate counting.",
    whoItsFor: "E-commerce stores and lead-generation websites running digital ads.",
    includedFeatures: [
      "Server-side and browser event tracking for Purchase, Lead, and AddToCart events",
      "Automatic Order/Event ID deduplication so conversions are never counted twice",
      "Privacy-safe customer phone/email matching for higher ad attribution accuracy",
    ],
    billingHighlights: "Flat monthly plan covering website conversion event tracking.",
  },
  "meta.ads": {
    tagline: "Launch, pause, and measure real Rupee return per ₹1 spent on Facebook & Instagram ads.",
    whoItsFor: "Businesses investing in paid Meta ads that want clear ROI tied to real sales.",
    includedFeatures: [
      "Create and manage Meta ad campaigns with daily Rupee budgets",
      "Pause or resume campaigns in one click",
      "Daily spend vs. linked sales snapshots with automatic Return per ₹1 Spent calculation",
      "Full integration with Detailed Business Analytics charts",
    ],
    billingHighlights: "Flat monthly management plan (your ad spend is billed directly by Meta).",
  },
  "google.reviews": {
    tagline: "Track star ratings across your store locations and publish timely owner replies.",
    whoItsFor: "Showrooms, clinics, restaurants, and local offices building trust on Google Search & Maps.",
    includedFeatures: [
      "Centralized 1-star to 5-star rating breakdown across connected store locations",
      "Instant filter for unreplied customer reviews",
      "Direct owner reply publishing with full audit history",
    ],
    billingHighlights: "Flat monthly plan per store location.",
  },
  "google.autoreply": {
    tagline: "Save time with ready-to-approve polite reply drafts for incoming Google reviews.",
    whoItsFor: "High-volume retail chains and hospitality businesses receiving frequent daily reviews.",
    includedFeatures: [
      "Suggested context-aware reply drafts tailored to positive and critical reviews",
      "One-click review and approval before publishing publicly",
    ],
    billingHighlights: "Requires Google Business Reviews & Replies. Monthly base plus per-draft usage.",
  },
  "backup.export": {
    tagline: "Download password-protected backups of your business records or save to your own cloud.",
    whoItsFor: "Compliance-conscious businesses keeping independent off-site copies of their records.",
    includedFeatures: [
      "On-demand password-protected full workspace backup archives",
      "Safe point-in-time restore that preserves your wallet passbook, GST invoices, and opt-outs",
      "CSV exports for contacts, Tally bills, client ledgers, and analytics reports",
    ],
    billingHighlights: "Flat monthly plan with unlimited manual and scheduled backup runs.",
  },
  "storage.managed": {
    tagline: "Turnkey cloud file storage managed by RSL for your Tally bill PDFs, media, and backups.",
    whoItsFor: "Businesses that want zero cloud setup instead of managing their own Cloudflare R2 / S3 account.",
    includedFeatures: [
      "Instant cloud storage for Tally invoice PDFs, WhatsApp media headers, and backup archives",
      "Seamless 1-click migration to or from your own personal cloud bucket anytime",
      "Transparent per-GB storage meter",
    ],
    billingHighlights: "Monthly base plan plus per-GB stored usage.",
  },
  "backup.custom": {
    tagline: "Dedicated custom storage connector built and maintained for your IT team's destination.",
    whoItsFor: "Enterprises with specialized on-premise SFTP, NAS, or private cloud archival policies.",
    includedFeatures: [
      "Custom destination engineering and validation by RSL Operations",
      "Automated retention and health monitoring",
    ],
    billingHighlights: "Requires Encrypted Customer Backups & Export. Flat monthly enterprise add-on.",
  },
  "api.access": {
    tagline: "Connect your ERP, custom billing app, or website with scoped REST API keys and webhooks.",
    whoItsFor: "Businesses with an internal developer, Tally integrator, or custom ERP/website.",
    includedFeatures: [
      "Live and Sandbox Bearer API keys (`rsl_live_...` / `rsl_test_...`) with granular permission scopes",
      "REST endpoints for `/api/v1/tally/bill-event`, `/api/v1/whatsapp/templates`, and `/api/v1/whatsapp/send-template`",
      "Outbound webhook subscriptions for real-time event notifications",
      "Built-in interactive API tester inside your dashboard",
    ],
    billingHighlights: "Flat monthly developer access plan.",
  },
};

export interface DefaultBundleCatalogItem {
  key: string;
  name: string;
  tagline: string;
  description: string;
  includedKeys: string[];
  monthlyAmountPaise: number;
  quarterlyAmountPaise: number;
  yearlyAmountPaise: number;
  badgeLabel: string;
  sortOrder: number;
}

export const DEFAULT_BUNDLE_CATALOG: readonly DefaultBundleCatalogItem[] = [
  {
    key: "tally_business_suite",
    name: "All-in-One Tally Prime Suite",
    tagline:
      "Live Tally Prime Sync, Paid-in-Tally Settlements, Client & Supplier Ledgers, Stock & Godown Inventory + Google Drive Backups (~₹275/mo billed yearly).",
    description:
      "Complete Tally Prime desktop & mobile companion inspired by Indian SMB workflows: sync Sales, Receipts, Payments, Credit/Debit Notes, Party Ledgers, Running Balance Statements, Inventory, and Encrypted Cloud Backups.",
    includedKeys: ["tally.sync", "backup.export", "storage.managed"],
    monthlyAmountPaise: 34900,
    quarterlyAmountPaise: 99900,
    yearlyAmountPaise: 330000,
    badgeLabel: "All-in-One Tally Suite",
    sortOrder: 1,
  },
  {
    key: "tally_whatsapp_pack",
    name: "Tally Prime + WhatsApp Pro Suite",
    tagline:
      "Everything in Tally Sync, Ledgers & Inventory plus Official WhatsApp Auto-Invoicing, Payment Reminders & Shared Team Inbox (~₹375/mo billed yearly).",
    description:
      "Pairs All-in-One Tally Prime Sync & Party Ledgers with Automatic WhatsApp GST Invoice PDFs, Smart Overdue Reminders (auto-cancelled when paid in Tally), and Shared Team Inbox.",
    includedKeys: ["inbox", "whatsapp.messaging", "tally.sync", "tally.invoicing"],
    monthlyAmountPaise: 49900,
    quarterlyAmountPaise: 129900,
    yearlyAmountPaise: 449900,
    badgeLabel: "Most Popular Tally + WhatsApp Suite",
    sortOrder: 2,
  },
  {
    key: "whatsapp_growth_pack",
    name: "WhatsApp Broadcasts & Customer Inbox Suite",
    tagline: "1-to-1 WhatsApp support, team assignment, and high-delivery promotional broadcasts in one bundle.",
    description:
      "Combines WhatsApp Bulk Broadcasts with its required WhatsApp Business Messaging base plan plus Shared Customer Inbox.",
    includedKeys: ["inbox", "whatsapp.messaging", "whatsapp.broadcast"],
    monthlyAmountPaise: 39900,
    quarterlyAmountPaise: 109900,
    yearlyAmountPaise: 399900,
    badgeLabel: "Messaging & Broadcast Pack",
    sortOrder: 3,
  },
  {
    key: "social_growth_pack",
    name: "Meta Ads, Social Publishing & Sales Pixel Suite",
    tagline: "Run Facebook & Instagram posts, track real website orders, and measure Rupee ROI on ads.",
    description:
      "Unlocks Facebook Pages, Instagram Feed & Reels, Website Order Pixel deduplication, Meta Ad Campaigns, and Google Business Reviews.",
    includedKeys: ["meta.pages", "meta.instagram", "meta.pixel", "meta.ads", "google.reviews"],
    monthlyAmountPaise: 59900,
    quarterlyAmountPaise: 159900,
    yearlyAmountPaise: 549900,
    badgeLabel: "Digital Marketing Suite",
    sortOrder: 4,
  },
  {
    key: "google_reputation_pack",
    name: "Google Reviews & Smart Replies Pack",
    tagline: "Monitor store star ratings and publish context-aware owner replies in one click.",
    description:
      "Pairs Google Business Reviews & Replies together with its companion Suggested Review Replies add-on.",
    includedKeys: ["google.reviews", "google.autoreply"],
    monthlyAmountPaise: 24900,
    quarterlyAmountPaise: 67900,
    yearlyAmountPaise: 239900,
    badgeLabel: "Store Reputation Pack",
    sortOrder: 5,
  },
  {
    key: "cloud_backup_api_pack",
    name: "Cloud Storage, Encrypted Backups & Developer API Pack",
    tagline: "Managed cloud file vault, password-protected off-site backups, and REST API + webhooks.",
    description:
      "Built for businesses connecting custom ERPs or maintaining strict off-site archival and automated storage.",
    includedKeys: ["storage.managed", "backup.export", "api.access"],
    monthlyAmountPaise: 34900,
    quarterlyAmountPaise: 94900,
    yearlyAmountPaise: 329900,
    badgeLabel: "IT, Backup & API Pack",
    sortOrder: 6,
  },
  {
    key: "all_features",
    name: "Complete RSL All-in-One Software Package (All 15 Tools)",
    tagline:
      "Every feature across Tally Prime Suite, WhatsApp Auto-Billing, Inbox, Meta Ads, Google Reviews, Cloud Backups & API (~₹750/mo billed yearly).",
    description:
      "Full-platform access unlocking all 15 RSL Marketing & Tally Prime Suite tools with zero locked modules — customizable per client.",
    includedKeys: SERVICE_CATALOG.map((s) => s.key),
    monthlyAmountPaise: 99900,
    quarterlyAmountPaise: 269900,
    yearlyAmountPaise: 899900,
    badgeLabel: "Entire 15-Tool Business Suite",
    sortOrder: 7,
  },
];

const LEGACY_SERVICE_MONTHLY_PAISE: Record<string, number> = {
  inbox: 99900,
  "whatsapp.messaging": 149900,
  "whatsapp.broadcast": 49900,
  "tally.sync": 129900,
  "tally.invoicing": 79900,
  "meta.pages": 69900,
  "meta.instagram": 89900,
  "meta.pixel": 99900,
  "meta.ads": 199900,
  "google.reviews": 79900,
  "google.autoreply": 39900,
  "backup.export": 59900,
  "storage.managed": 39900,
  "backup.custom": 249900,
  "api.access": 149900,
};

const LEGACY_BUNDLE_MONTHLY_PAISE: Record<string, number> = {
  tally_whatsapp_pack: 349900,
  whatsapp_growth_pack: 229900,
  social_growth_pack: 399900,
  google_reputation_pack: 129900,
  cloud_backup_api_pack: 199900,
  all_features: 799900,
};

export function ensureServiceCatalogSeeded(): void {
  const db = controlDb();
  const svcCount = db
    .select({ c: sql<number>`count(*)` })
    .from(controlSchema.services)
    .get();
  const bundleCount = db
    .select({ c: sql<number>`count(*)` })
    .from(controlSchema.planBundles)
    .where(isNull(controlSchema.planBundles.workspaceId))
    .get();
  const tallySuiteRow = db
    .select({ key: controlSchema.planBundles.key })
    .from(controlSchema.planBundles)
    .where(eq(controlSchema.planBundles.key, "tally_business_suite"))
    .get();

  if (
    (svcCount?.c ?? 0) >= SERVICE_CATALOG.length &&
    (bundleCount?.c ?? 0) >= DEFAULT_BUNDLE_CATALOG.length &&
    Boolean(tallySuiteRow)
  ) {
    return;
  }

  const now = Date.now();

  for (const svc of SERVICE_CATALOG) {
    db.insert(controlSchema.services)
      .values({
        key: svc.key,
        name: svc.name,
        plainSummary: svc.plainSummary,
        category: svc.category,
        dependsOnJson: JSON.stringify(svc.dependsOn),
        pricingModel: svc.pricingModel,
        meteredUnit: svc.meteredUnit,
        active: true,
        sortOrder: svc.sortOrder,
      })
      .onConflictDoUpdate({
        target: controlSchema.services.key,
        set: {
          name: svc.name,
          plainSummary: svc.plainSummary,
          category: svc.category,
          dependsOnJson: JSON.stringify(svc.dependsOn),
          pricingModel: svc.pricingModel,
          meteredUnit: svc.meteredUnit,
          sortOrder: svc.sortOrder,
        },
      })
      .run();

    const existingPrice = db
      .select()
      .from(controlSchema.servicePrices)
      .where(and(eq(controlSchema.servicePrices.serviceKey, svc.key), eq(controlSchema.servicePrices.active, true)))
      .get();

    const defaults = computeDefaultCycleAmountsPaise(svc.defaultMonthlyPaise);
    if (!existingPrice) {
      db.insert(controlSchema.servicePrices)
        .values({
          id: newId(),
          serviceKey: svc.key,
          currency: "INR",
          monthlyAmountPaise: svc.defaultMonthlyPaise,
          quarterlyAmountPaise: defaults.quarterlyPaise,
          yearlyAmountPaise: defaults.yearlyPaise,
          unitAmountPaise: svc.defaultUnitPaise,
          includedUnits: 0,
          effectiveFrom: now,
          active: true,
        })
        .run();
    } else if (!tallySuiteRow && existingPrice.monthlyAmountPaise === LEGACY_SERVICE_MONTHLY_PAISE[svc.key]) {
      db.update(controlSchema.servicePrices)
        .set({
          monthlyAmountPaise: svc.defaultMonthlyPaise,
          quarterlyAmountPaise: defaults.quarterlyPaise,
          yearlyAmountPaise: defaults.yearlyPaise,
          unitAmountPaise: svc.defaultUnitPaise,
        })
        .where(eq(controlSchema.servicePrices.id, existingPrice.id))
        .run();
    }
  }

  for (const b of DEFAULT_BUNDLE_CATALOG) {
    const existingBundle = db
      .select()
      .from(controlSchema.planBundles)
      .where(eq(controlSchema.planBundles.key, b.key))
      .get();

    if (!existingBundle) {
      db.insert(controlSchema.planBundles)
        .values({
          key: b.key,
          workspaceId: null,
          name: b.name,
          tagline: b.tagline,
          description: b.description,
          includedKeysJson: JSON.stringify(b.includedKeys),
          monthlyAmountPaise: b.monthlyAmountPaise,
          quarterlyAmountPaise: b.quarterlyAmountPaise,
          yearlyAmountPaise: b.yearlyAmountPaise,
          badgeLabel: b.badgeLabel,
          active: true,
          sortOrder: b.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } else if (
      !tallySuiteRow &&
      existingBundle.workspaceId === null &&
      existingBundle.monthlyAmountPaise === LEGACY_BUNDLE_MONTHLY_PAISE[b.key]
    ) {
      db.update(controlSchema.planBundles)
        .set({
          name: b.name,
          tagline: b.tagline,
          description: b.description,
          includedKeysJson: JSON.stringify(b.includedKeys),
          monthlyAmountPaise: b.monthlyAmountPaise,
          quarterlyAmountPaise: b.quarterlyAmountPaise,
          yearlyAmountPaise: b.yearlyAmountPaise,
          badgeLabel: b.badgeLabel,
          sortOrder: b.sortOrder,
          updatedAt: now,
        })
        .where(eq(controlSchema.planBundles.key, b.key))
        .run();
    }
  }
}

export interface WorkspaceFreeAccessStatus {
  isActive: boolean;
  untilMs: number | null;
  remainingDays: number;
  note: string | null;
  grantedBy: string | null;
  autoBillingReminders: boolean;
}

export function getWorkspaceFreeAccessStatus(workspaceId: string): WorkspaceFreeAccessStatus {
  const ws = controlDb()
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  const now = Date.now();
  const untilMs = ws?.freeAccessUntil ?? null;
  const isActive = Boolean(untilMs && untilMs > now);
  const remainingDays = isActive && untilMs ? Math.max(1, Math.ceil((untilMs - now) / 86_400_000)) : 0;

  return {
    isActive,
    untilMs,
    remainingDays,
    note: ws?.freeAccessNote ?? null,
    grantedBy: ws?.freeAccessGrantedBy ?? null,
    autoBillingReminders: ws?.autoBillingReminders ?? true,
  };
}

export function staffGrantFreeAllToolsAccess(params: {
  workspaceId: string;
  durationDays?: number;
  customUntilMs?: number;
  note?: string;
  staffId: string;
}): { untilMs: number; remainingDays: number } {
  const now = Date.now();
  let untilMs: number;
  if (params.customUntilMs && Number.isFinite(params.customUntilMs)) {
    untilMs = Math.round(params.customUntilMs);
  } else {
    const days = Math.max(1, Math.min(3650, Math.round(params.durationDays || 14)));
    untilMs = now + days * 86_400_000;
  }

  if (untilMs <= now) {
    throw new RslError("RSL-VAL-1001", "Free access end date must be in the future.");
  }

  controlDb()
    .update(controlSchema.workspaces)
    .set({
      freeAccessUntil: untilMs,
      freeAccessNote: params.note?.trim() || "Complimentary full-platform access",
      freeAccessGrantedBy: params.staffId,
      updatedAt: now,
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();

  return {
    untilMs,
    remainingDays: Math.max(1, Math.ceil((untilMs - now) / 86_400_000)),
  };
}

export function staffRevokeFreeAllToolsAccess(params: {
  workspaceId: string;
  staffId: string;
}): void {
  controlDb()
    .update(controlSchema.workspaces)
    .set({
      freeAccessUntil: null,
      freeAccessNote: null,
      freeAccessGrantedBy: params.staffId,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();
}

export function staffToggleAutoBillingReminders(params: {
  workspaceId: string;
  enabled: boolean;
}): void {
  controlDb()
    .update(controlSchema.workspaces)
    .set({
      autoBillingReminders: params.enabled,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .run();
}

export function listServicesWithWorkspaceState(workspaceId: string) {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const now = Date.now();
  const freeAccess = getWorkspaceFreeAccessStatus(workspaceId);

  const allServices = db
    .select()
    .from(controlSchema.services)
    .orderBy(controlSchema.services.sortOrder)
    .all();
  const prices = db
    .select()
    .from(controlSchema.servicePrices)
    .where(eq(controlSchema.servicePrices.active, true))
    .all();
  const workspaceEntitlements = db
    .select()
    .from(controlSchema.entitlements)
    .where(eq(controlSchema.entitlements.workspaceId, workspaceId))
    .all();
  const planRequests = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(eq(controlSchema.servicePlanRequests.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.servicePlanRequests.createdAt))
    .all();

  const serviceNameByKey = new Map(allServices.map((s) => [s.key, s.name]));
  const priceByKey = new Map(prices.map((p) => [p.serviceKey, p]));
  const entByKey = new Map(workspaceEntitlements.map((e) => [e.serviceKey, e]));
  const pendingReqByKey = new Map<string, typeof controlSchema.servicePlanRequests.$inferSelect>();
  const latestReqByKey = new Map<string, typeof controlSchema.servicePlanRequests.$inferSelect>();

  for (const req of planRequests) {
    if (!latestReqByKey.has(req.serviceKey)) {
      latestReqByKey.set(req.serviceKey, req);
    }
    if (req.status === "pending_payment") {
      if (!pendingReqByKey.has(req.serviceKey)) {
        pendingReqByKey.set(req.serviceKey, req);
      }
      if (req.includedKeysJson) {
        try {
          const bundleKeys = JSON.parse(req.includedKeysJson) as string[];
          for (const bk of bundleKeys) {
            if (!pendingReqByKey.has(bk)) {
              pendingReqByKey.set(bk, req);
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  }

  return allServices.map((s) => {
    const price = priceByKey.get(s.key);
    const ent = entByKey.get(s.key);
    const dependsOn = JSON.parse(s.dependsOnJson) as string[];
    const dependNames = dependsOn.map((k) => serviceNameByKey.get(k) ?? k);

    const entNotExpired = !ent?.expiresAt || ent.expiresAt > now;
    const paidUnlocked = Boolean(
      (ent?.status === "active" || ent?.status === "trialing") && entNotExpired
    );
    const isUnlocked = freeAccess.isActive || paidUnlocked;
    const isExpired = Boolean(
      (ent?.status === "active" || ent?.status === "trialing") &&
        ent?.expiresAt &&
        ent.expiresAt <= now &&
        !freeAccess.isActive
    );

    const pendingReq = pendingReqByKey.get(s.key) ?? null;
    const latestReq = latestReqByKey.get(s.key) ?? null;

    const stdMonthly = price?.monthlyAmountPaise ?? 0;
    const stdCycles = computeDefaultCycleAmountsPaise(stdMonthly);
    const stdQuarterly = price?.quarterlyAmountPaise ?? stdCycles.quarterlyPaise;
    const stdYearly = price?.yearlyAmountPaise ?? stdCycles.yearlyPaise;

    const effMonthly = ent?.priceOverridePaise ?? stdMonthly;
    const overrideScaled =
      ent?.priceOverridePaise !== null && ent?.priceOverridePaise !== undefined
        ? computeDefaultCycleAmountsPaise(ent.priceOverridePaise)
        : null;
    const effQuarterly =
      ent?.quarterlyOverridePaise ?? (overrideScaled ? overrideScaled.quarterlyPaise : stdQuarterly);
    const effYearly =
      ent?.yearlyOverridePaise ?? (overrideScaled ? overrideScaled.yearlyPaise : stdYearly);

    const hasCustomPriceOverride =
      (ent?.priceOverridePaise !== null && ent?.priceOverridePaise !== undefined) ||
      (ent?.quarterlyOverridePaise !== null && ent?.quarterlyOverridePaise !== undefined) ||
      (ent?.yearlyOverridePaise !== null && ent?.yearlyOverridePaise !== undefined);

    const detail = PLAN_FEATURE_DETAILS[s.key] ?? {
      tagline: s.plainSummary,
      whoItsFor: "Growing businesses using RSL Marketing.",
      includedFeatures: [s.plainSummary],
      billingHighlights: "Includes official GST tax invoice once payment is recorded.",
    };

    const entitlementStatus = isUnlocked
      ? paidUnlocked
        ? (ent?.status ?? "active")
        : "complimentary"
      : pendingReq
        ? "pending_payment"
        : isExpired
          ? "expired"
          : (ent?.status ?? "locked");

    return {
      key: s.key,
      name: s.name,
      plainSummary: s.plainSummary,
      category: s.category,
      dependsOn,
      dependNames,
      pricingModel: s.pricingModel,
      meteredUnit: s.meteredUnit,
      monthlyAmountPaise: effMonthly,
      quarterlyAmountPaise: effQuarterly,
      yearlyAmountPaise: effYearly,
      standardMonthlyAmountPaise: stdMonthly,
      standardQuarterlyAmountPaise: stdQuarterly,
      standardYearlyAmountPaise: stdYearly,
      customMonthlyOverridePaise: ent?.priceOverridePaise ?? null,
      customQuarterlyOverridePaise: ent?.quarterlyOverridePaise ?? null,
      customYearlyOverridePaise: ent?.yearlyOverridePaise ?? null,
      hasCustomPriceOverride,
      unitAmountPaise: price?.unitAmountPaise ?? 0,
      entitlementStatus,
      billingCycle: normalizeBillingCycle(ent?.billingCycle),
      bundleKey: ent?.bundleKey ?? null,
      isUnlocked,
      isPaidUnlocked: paidUnlocked,
      isComplimentaryFreeAccess: freeAccess.isActive && !paidUnlocked,
      freeAccessUntil: freeAccess.isActive ? freeAccess.untilMs : null,
      activatedAt: ent?.activatedAt ?? null,
      expiresAt: ent?.expiresAt ?? (freeAccess.isActive ? freeAccess.untilMs : null),
      pendingRequest: pendingReq,
      latestRequest: latestReq,
      details: detail,
    };
  });
}

export type WorkspaceServicePlanState = ReturnType<typeof listServicesWithWorkspaceState>[number];

export function listBundlesWithWorkspaceState(workspaceId: string) {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const serviceStates = listServicesWithWorkspaceState(workspaceId);
  const svcStateByKey = new Map(serviceStates.map((s) => [s.key, s]));

  const bundleRows = db
    .select()
    .from(controlSchema.planBundles)
    .where(
      and(
        eq(controlSchema.planBundles.active, true),
        or(
          isNull(controlSchema.planBundles.workspaceId),
          eq(controlSchema.planBundles.workspaceId, workspaceId)
        )
      )
    )
    .orderBy(controlSchema.planBundles.sortOrder)
    .all();

  const overrides = db
    .select()
    .from(controlSchema.clientBundleOverrides)
    .where(eq(controlSchema.clientBundleOverrides.workspaceId, workspaceId))
    .all();
  const overrideByKey = new Map(overrides.map((o) => [o.bundleKey, o]));

  const pendingRequests = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(
      and(
        eq(controlSchema.servicePlanRequests.workspaceId, workspaceId),
        eq(controlSchema.servicePlanRequests.status, "pending_payment")
      )
    )
    .orderBy(desc(controlSchema.servicePlanRequests.createdAt))
    .all();

  return bundleRows
    .map((b) => {
      const ov = overrideByKey.get(b.key);
      if (ov?.hidden) return null;

      let includedKeys: string[] = [];
      try {
        includedKeys = JSON.parse(ov?.includedKeysJson || b.includedKeysJson) as string[];
      } catch {
        includedKeys = [];
      }
      includedKeys = includedKeys.filter((k) => svcStateByKey.has(k));

      const includedServices = includedKeys.map((k) => svcStateByKey.get(k)!);
      const unlockedCount = includedServices.filter((s) => s.isUnlocked).length;
      const isFullyUnlocked = includedKeys.length > 0 && unlockedCount === includedKeys.length;

      const individualMonthlySumPaise = includedServices.reduce(
        (acc, s) => acc + s.standardMonthlyAmountPaise,
        0
      );

      const monthlyAmountPaise = ov?.monthlyOverridePaise ?? b.monthlyAmountPaise;
      const ovScaled =
        ov?.monthlyOverridePaise !== null && ov?.monthlyOverridePaise !== undefined
          ? computeDefaultCycleAmountsPaise(ov.monthlyOverridePaise)
          : null;
      const quarterlyAmountPaise =
        ov?.quarterlyOverridePaise ?? (ovScaled ? ovScaled.quarterlyPaise : b.quarterlyAmountPaise);
      const yearlyAmountPaise =
        ov?.yearlyOverridePaise ?? (ovScaled ? ovScaled.yearlyPaise : b.yearlyAmountPaise);

      const pendingBundleReq =
        pendingRequests.find((r) => r.bundleKey === b.key) ??
        (includedKeys.length > 0 &&
        includedServices.every((s) => s.isUnlocked || Boolean(s.pendingRequest)) &&
        includedServices.some((s) => Boolean(s.pendingRequest))
          ? includedServices.find((s) => Boolean(s.pendingRequest))?.pendingRequest ?? null
          : null);

      const hasCustomOverride =
        Boolean(b.workspaceId) ||
        Boolean(ov?.customName) ||
        Boolean(ov?.includedKeysJson) ||
        (ov?.monthlyOverridePaise !== null && ov?.monthlyOverridePaise !== undefined) ||
        (ov?.quarterlyOverridePaise !== null && ov?.quarterlyOverridePaise !== undefined) ||
        (ov?.yearlyOverridePaise !== null && ov?.yearlyOverridePaise !== undefined);

      return {
        key: b.key,
        isClientCustomBundle: Boolean(b.workspaceId),
        name: ov?.customName?.trim() || b.name,
        tagline: b.tagline,
        description: b.description,
        badgeLabel:
          b.workspaceId || hasCustomOverride
            ? b.badgeLabel || "Tailored Client Package"
            : b.badgeLabel,
        includedKeys,
        includedServiceNames: includedServices.map((s) => s.name),
        unlockedCount,
        remainingLockedCount: Math.max(0, includedKeys.length - unlockedCount),
        totalServicesCount: includedKeys.length,
        isFullyUnlocked,
        isAllFreeAccess:
          isFullyUnlocked && includedServices.every((s) => s.isComplimentaryFreeAccess),
        monthlyAmountPaise,
        quarterlyAmountPaise,
        yearlyAmountPaise,
        standardMonthlyAmountPaise: b.monthlyAmountPaise,
        standardQuarterlyAmountPaise: b.quarterlyAmountPaise,
        standardYearlyAmountPaise: b.yearlyAmountPaise,
        customMonthlyOverridePaise: ov?.monthlyOverridePaise ?? null,
        customQuarterlyOverridePaise: ov?.quarterlyOverridePaise ?? null,
        customYearlyOverridePaise: ov?.yearlyOverridePaise ?? null,
        individualMonthlySumPaise,
        savingsMonthlyPaise: Math.max(0, individualMonthlySumPaise - monthlyAmountPaise),
        hasCustomOverride,
        pendingRequest: pendingBundleReq ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

export type WorkspaceBundlePlanState = ReturnType<typeof listBundlesWithWorkspaceState>[number];

export function listGlobalBundleCatalog() {
  ensureServiceCatalogSeeded();
  return controlDb()
    .select()
    .from(controlSchema.planBundles)
    .where(isNull(controlSchema.planBundles.workspaceId))
    .orderBy(controlSchema.planBundles.sortOrder)
    .all()
    .map((b) => ({
      ...b,
      includedKeys: JSON.parse(b.includedKeysJson) as string[],
    }));
}

export function getWorkspacePlansByKeys(
  workspaceId: string,
  serviceKeys: string[]
): WorkspaceServicePlanState[] {
  const all = listServicesWithWorkspaceState(workspaceId);
  const keySet = new Set(serviceKeys);
  return all.filter((s) => keySet.has(s.key));
}

export function getMatchingBundlesForKeys(
  workspaceId: string,
  serviceKeys: string[]
): WorkspaceBundlePlanState[] {
  const target = new Set(serviceKeys);
  return listBundlesWithWorkspaceState(workspaceId).filter(
    (b) => !b.isFullyUnlocked && b.includedKeys.some((k) => target.has(k))
  );
}

export function hasActiveEntitlement(workspaceId: string, serviceKey: string): boolean {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const now = Date.now();

  const ws = db
    .select({ freeAccessUntil: controlSchema.workspaces.freeAccessUntil })
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  if (ws?.freeAccessUntil && ws.freeAccessUntil > now) {
    return true;
  }

  const ent = db
    .select()
    .from(controlSchema.entitlements)
    .where(
      and(
        eq(controlSchema.entitlements.workspaceId, workspaceId),
        eq(controlSchema.entitlements.serviceKey, serviceKey)
      )
    )
    .get();

  if (!ent) return false;
  if (ent.status !== "active" && ent.status !== "trialing") return false;
  if (ent.expiresAt !== null && ent.expiresAt !== undefined && ent.expiresAt <= now) {
    return false;
  }
  return true;
}

export function hasAnyActiveEntitlement(workspaceId: string, serviceKeys: string[]): boolean {
  return serviceKeys.some((k) => hasActiveEntitlement(workspaceId, k));
}

export function requireEntitlement(workspaceId: string, serviceKey: string): void {
  if (!hasActiveEntitlement(workspaceId, serviceKey)) {
    const svc = controlDb()
      .select()
      .from(controlSchema.services)
      .where(eq(controlSchema.services.key, serviceKey))
      .get();
    throw new RslError(
      "RSL-BILL-1001",
      `'${svc?.name ?? serviceKey}' is locked until your plan request is approved and payment is recorded by our billing team.`,
      { serviceKey }
    );
  }
}

export type BillingDocumentType = "tax_invoice" | "advance_receipt" | "credit_note";

const DOC_SERIES_PREFIX: Readonly<Record<BillingDocumentType, string>> = {
  tax_invoice: "RSL",
  advance_receipt: "ADV",
  credit_note: "CN",
};

/**
 * Atomically allocates the next sequential document number (`RSL/YY-YY/0001`, `ADV/YY-YY/0001`, `CN/YY-YY/0001`)
 * via `controlSchema.invoiceSequences` so deletions, credit notes, or concurrent webhooks never reuse numbers (P1-24 / ACT-5.4).
 */
export function allocateNextDocumentNumber(
  docType: BillingDocumentType,
  fy = computeIndianFinancialYearIst()
): string {
  const db = controlDb();
  const raw = db.$client;
  const prefix = DOC_SERIES_PREFIX[docType];
  const seriesKey = `${prefix}:${fy}`;

  const tx = raw.transaction(() => {
    const existingSeq = db
      .select()
      .from(controlSchema.invoiceSequences)
      .where(eq(controlSchema.invoiceSequences.seriesKey, seriesKey))
      .get();

    let nextVal = (existingSeq?.lastValue ?? 0) + 1;

    if (!existingSeq) {
      const likePrefix = `${prefix}/${fy}/%`;
      const priorRows = raw
        .prepare("SELECT invoice_number AS n FROM invoices WHERE invoice_number LIKE ?")
        .all(likePrefix) as Array<{ n: string }>;
      let maxObserved = 0;
      for (const r of priorRows) {
        const tail = Number(r.n.split("/").pop() || "0");
        if (Number.isInteger(tail) && tail > maxObserved) {
          maxObserved = tail;
        }
      }
      nextVal = maxObserved + 1;
    }

    const now = Date.now();
    db.insert(controlSchema.invoiceSequences)
      .values({
        seriesKey,
        lastValue: nextVal,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: controlSchema.invoiceSequences.seriesKey,
        set: {
          lastValue: nextVal,
          updatedAt: now,
        },
      })
      .run();

    return `${prefix}/${fy}/${String(nextVal).padStart(4, "0")}`;
  });

  return raw.inTransaction ? tx() : tx.immediate();
}

export function getSupplierGstStateCode(): string {
  const settings = getPlatformBillingSettings();
  const prefix = (settings.gstin || "").trim().slice(0, 2);
  return /^\d{2}$/.test(prefix) ? prefix : "27";
}

export function createGstInvoice(params: {
  workspaceId: string;
  description: string;
  subtotalPaise: number;
  status?: "paid" | "issued";
  externalRefKey?: string | null;
}): typeof controlSchema.invoices.$inferSelect {
  const db = controlDb();
  const raw = db.$client;

  const tx = raw.transaction(() => {
    const cleanRef = params.externalRefKey?.trim() || null;
    if (cleanRef) {
      const existingByRef = db
        .select()
        .from(controlSchema.invoices)
        .where(eq(controlSchema.invoices.externalRefKey, cleanRef))
        .get();
      if (existingByRef) return existingByRef;
    }

    const ws = db
      .select()
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();
    if (!ws) throw new Error("Workspace not found");

    const fy = computeIndianFinancialYearIst();
    const invoiceNumber = allocateNextDocumentNumber("tax_invoice", fy);

    const supplierStateCode = getSupplierGstStateCode();
    const split = computeGstTaxSplit({
      subtotalPaise: params.subtotalPaise,
      buyerStateCode: ws.stateCode || supplierStateCode,
      supplierStateCode,
    });

    const now = Date.now();
    const id = newId();
    const status = params.status ?? "paid";

    const row: typeof controlSchema.invoices.$inferSelect = {
      id,
      workspaceId: params.workspaceId,
      invoiceNumber,
      docType: "tax_invoice",
      linkedInvoiceId: null,
      externalRefKey: cleanRef,
      financialYear: fy,
      description: params.description,
      subtotalPaise: split.subtotalPaise,
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise: split.igstPaise,
      totalPaise: split.totalPaise,
      currency: "INR",
      hsnSac: "998314",
      status,
      issuedAt: now,
      paidAt: status === "paid" ? now : null,
    };

    db.insert(controlSchema.invoices).values(row).run();
    return row;
  });

  return raw.inTransaction ? tx() : tx.immediate();
}

/**
 * Issues a statutory Advance Receipt Voucher (`ADV/YY-YY/0001`) at 0% GST when a customer deposits
 * funds into their refundable/prepaid messaging wallet. GST Tax Invoices (`RSL/...`) are issued
 * strictly upon taxable plan/service consumption (P0-06 / ACT-2.1).
 */
export function createAdvanceReceiptVoucher(params: {
  workspaceId: string;
  description: string;
  amountPaise: number;
  externalRefKey?: string | null;
}): typeof controlSchema.invoices.$inferSelect {
  const db = controlDb();
  const raw = db.$client;

  const tx = raw.transaction(() => {
    const cleanRef = params.externalRefKey?.trim() || null;
    if (cleanRef) {
      const existingByRef = db
        .select()
        .from(controlSchema.invoices)
        .where(eq(controlSchema.invoices.externalRefKey, cleanRef))
        .get();
      if (existingByRef) return existingByRef;
    }

    const ws = db
      .select()
      .from(controlSchema.workspaces)
      .where(eq(controlSchema.workspaces.id, params.workspaceId))
      .get();
    if (!ws) throw new Error("Workspace not found");

    const cleanPaise = Math.max(0, Math.round(params.amountPaise));
    const fy = computeIndianFinancialYearIst();
    const voucherNumber = allocateNextDocumentNumber("advance_receipt", fy);
    const now = Date.now();

    const row: typeof controlSchema.invoices.$inferSelect = {
      id: newId(),
      workspaceId: params.workspaceId,
      invoiceNumber: voucherNumber,
      docType: "advance_receipt",
      linkedInvoiceId: null,
      externalRefKey: cleanRef,
      financialYear: fy,
      description: params.description,
      subtotalPaise: cleanPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise: cleanPaise,
      currency: "INR",
      hsnSac: "998314",
      status: "paid",
      issuedAt: now,
      paidAt: now,
    };

    db.insert(controlSchema.invoices).values(row).run();
    return row;
  });

  return raw.inTransaction ? tx() : tx.immediate();
}

export function activateServiceEntitlement(params: {
  workspaceId: string;
  serviceKey: string;
  status?: "active" | "trialing";
  actorId: string;
  chargeWallet?: boolean;
}): { entitlementId: string; invoiceNumber?: string } {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const svc = db
    .select()
    .from(controlSchema.services)
    .where(eq(controlSchema.services.key, params.serviceKey))
    .get();
  if (!svc) {
    throw new RslError("RSL-VAL-1001", "Unknown plan key.");
  }

  // Enforce dependencies server-side (Section 2)
  const deps = JSON.parse(svc.dependsOnJson) as string[];
  for (const depKey of deps) {
    if (!hasActiveEntitlement(params.workspaceId, depKey)) {
      const depSvc = db
        .select()
        .from(controlSchema.services)
        .where(eq(controlSchema.services.key, depKey))
        .get();
      throw new RslError(
        "RSL-BILL-1002",
        `Please activate '${depSvc?.name ?? depKey}' first before turning on '${svc.name}'.`,
        { requiredService: depKey }
      );
    }
  }

  const price = db
    .select()
    .from(controlSchema.servicePrices)
    .where(and(eq(controlSchema.servicePrices.serviceKey, svc.key), eq(controlSchema.servicePrices.active, true)))
    .get();

  const monthlyPaise = price?.monthlyAmountPaise ?? 0;
  let invoiceNumber: string | undefined;

  if (params.chargeWallet && monthlyPaise > 0) {
    debitWallet({
      workspaceId: params.workspaceId,
      amountPaise: monthlyPaise,
      serviceKey: svc.key,
      description: `Activated plan: ${svc.name}`,
      idempotencyKey: `activate:${params.workspaceId}:${svc.key}:${Math.floor(Date.now() / 60000)}`,
      actorId: params.actorId,
      allowOverdraft: false,
    });
    const inv = createGstInvoice({
      workspaceId: params.workspaceId,
      description: `${svc.name} — Monthly Plan`,
      subtotalPaise: monthlyPaise,
      status: "paid",
    });
    invoiceNumber = inv.invoiceNumber;
  }

  const now = Date.now();
  const entId = newId();
  db.insert(controlSchema.entitlements)
    .values({
      id: entId,
      workspaceId: params.workspaceId,
      serviceKey: svc.key,
      status: params.status ?? "active",
      activatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [controlSchema.entitlements.workspaceId, controlSchema.entitlements.serviceKey],
      set: {
        status: params.status ?? "active",
        updatedAt: now,
      },
    })
    .run();

  return { entitlementId: entId, invoiceNumber };
}

export function deactivateServiceEntitlement(workspaceId: string, serviceKey: string): void {
  controlDb()
    .update(controlSchema.entitlements)
    .set({ status: "cancelled", updatedAt: Date.now() })
    .where(
      and(
        eq(controlSchema.entitlements.workspaceId, workspaceId),
        eq(controlSchema.entitlements.serviceKey, serviceKey)
      )
    )
    .run();
}

export function getWalletBalancePaise(workspaceId: string): number {
  const row = controlDb()
    .select({ total: sql<number>`COALESCE(SUM(${controlSchema.ledgerEntries.amountPaise}), 0)` })
    .from(controlSchema.ledgerEntries)
    .where(eq(controlSchema.ledgerEntries.workspaceId, workspaceId))
    .get();

  return Number(row?.total ?? 0);
}

export function listLedgerEntries(workspaceId: string, limit = 50) {
  return controlDb()
    .select()
    .from(controlSchema.ledgerEntries)
    .where(eq(controlSchema.ledgerEntries.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.ledgerEntries.createdAt))
    .limit(limit)
    .all();
}

export function creditWallet(params: {
  workspaceId: string;
  amountPaise: number;
  description: string;
  idempotencyKey: string;
  actorId: string;
  entryType?: "credit" | "refund" | "staff_adjustment";
  createInvoice?: boolean;
}): { balancePaise: number; invoiceNumber?: string } {
  if (!Number.isInteger(params.amountPaise) || params.amountPaise <= 0) {
    throw new RslError("RSL-VAL-1001", "Amount must be a positive rupee value.");
  }

  const db = controlDb();
  const raw = db.$client;

  const runImmediate = raw.transaction(() => {
    const existing = db
      .select()
      .from(controlSchema.ledgerEntries)
      .where(
        and(
          eq(controlSchema.ledgerEntries.workspaceId, params.workspaceId),
          eq(controlSchema.ledgerEntries.idempotencyKey, params.idempotencyKey)
        )
      )
      .get();

    if (!existing) {
      const debitAccount =
        params.entryType === "refund"
          ? "Recognized SaaS & Messaging Revenue"
          : params.entryType === "staff_adjustment"
            ? "Manual Staff Wallet Adjustment"
            : "Bank / Clearing Settlement";
      db.insert(controlSchema.ledgerEntries)
        .values({
          id: newId(),
          workspaceId: params.workspaceId,
          entryType: params.entryType ?? "credit",
          amountPaise: params.amountPaise,
          currency: "INR",
          debitAccount,
          creditAccount: "Customer Prepaid Wallet Liability",
          description: params.description,
          idempotencyKey: params.idempotencyKey,
          actorId: params.actorId,
          createdAt: Date.now(),
        })
        .run();
    }

    let invoiceNumber: string | undefined;
    if (params.createInvoice) {
      const extKey = `wallet_credit:${params.workspaceId}:${params.idempotencyKey}`;
      const inv = createAdvanceReceiptVoucher({
        workspaceId: params.workspaceId,
        description: `Prepaid Wallet Deposit — ${params.description}`,
        amountPaise: params.amountPaise,
        externalRefKey: extKey,
      });
      invoiceNumber = inv.invoiceNumber;

      if (!existing) {
        db.insert(controlSchema.payments)
          .values({
            id: newId(),
            workspaceId: params.workspaceId,
            invoiceId: inv.id,
            provider: "razorpay",
            amountPaise: inv.totalPaise,
            currency: "INR",
            purpose: "wallet_topup",
            status: "captured",
            createdAt: Date.now(),
          })
          .run();
      }
    }

    return {
      balancePaise: getWalletBalancePaise(params.workspaceId),
      invoiceNumber,
    };
  });

  return raw.inTransaction ? runImmediate() : runImmediate.immediate();
}

export function debitWallet(params: {
  workspaceId: string;
  amountPaise: number;
  serviceKey?: string;
  description: string;
  idempotencyKey: string;
  actorId: string;
  entryType?: "debit" | "reserve" | "staff_adjustment";
  allowOverdraft?: boolean;
}): { balancePaise: number } {
  if (!Number.isInteger(params.amountPaise) || params.amountPaise <= 0) {
    throw new RslError("RSL-VAL-1001", "Debit amount must be positive.");
  }

  const db = controlDb();
  const raw = db.$client;

  const runImmediate = raw.transaction(() => {
    const existing = db
      .select()
      .from(controlSchema.ledgerEntries)
      .where(
        and(
          eq(controlSchema.ledgerEntries.workspaceId, params.workspaceId),
          eq(controlSchema.ledgerEntries.idempotencyKey, params.idempotencyKey)
        )
      )
      .get();

    if (existing) {
      return { balancePaise: getWalletBalancePaise(params.workspaceId) };
    }

    const currentBalance = getWalletBalancePaise(params.workspaceId);
    const minAllowedBalance = params.allowOverdraft === false ? 0 : MIN_WALLET_BALANCE_PAISE;
    if (
      currentBalance - params.amountPaise < minAllowedBalance &&
      params.entryType !== "staff_adjustment"
    ) {
      throw new RslError(
        "RSL-BILL-1003",
        `Your prepaid wallet balance is ${formatInr(currentBalance, { showDecimals: true })} (overdraft allowed down to -₹200.00). Please add funds to your wallet to complete this ${formatInr(params.amountPaise, { showDecimals: true })} request.`
      );
    }

    const creditAccount =
      params.entryType === "staff_adjustment"
        ? "Manual Staff Wallet Adjustment"
        : params.entryType === "reserve"
          ? "Reserved Outbound Usage Hold"
          : "Recognized SaaS & Messaging Revenue";

    db.insert(controlSchema.ledgerEntries)
      .values({
        id: newId(),
        workspaceId: params.workspaceId,
        entryType: params.entryType ?? "debit",
        amountPaise: -Math.abs(params.amountPaise),
        currency: "INR",
        debitAccount: "Customer Prepaid Wallet Liability",
        creditAccount,
        serviceKey: params.serviceKey ?? null,
        description: params.description,
        idempotencyKey: params.idempotencyKey,
        actorId: params.actorId,
        createdAt: Date.now(),
      })
      .run();

    return { balancePaise: getWalletBalancePaise(params.workspaceId) };
  });

  return raw.inTransaction ? runImmediate() : runImmediate.immediate();
}

export function consumeUsage(params: {
  workspaceId: string;
  serviceKey: string;
  quantity: number;
  unitCostPaise: number;
  dedupeKey: string;
  description: string;
  actorId: string;
}): void {
  const db = controlDb();
  const totalCost = params.quantity * params.unitCostPaise;

  const existing = db
    .select()
    .from(controlSchema.usageEvents)
    .where(
      and(
        eq(controlSchema.usageEvents.workspaceId, params.workspaceId),
        eq(controlSchema.usageEvents.dedupeKey, params.dedupeKey)
      )
    )
    .get();
  if (existing) return;

  if (totalCost > 0) {
    debitWallet({
      workspaceId: params.workspaceId,
      amountPaise: totalCost,
      serviceKey: params.serviceKey,
      description: params.description,
      idempotencyKey: `usage:${params.dedupeKey}`,
      actorId: params.actorId,
    });
  }

  db.insert(controlSchema.usageEvents)
    .values({
      id: newId(),
      workspaceId: params.workspaceId,
      serviceKey: params.serviceKey,
      quantity: params.quantity,
      costPaise: totalCost,
      dedupeKey: params.dedupeKey,
      createdAt: Date.now(),
    })
    .run();
}

export function verifyRazorpaySignature(rawBody: string, signatureHex: string): boolean {
  const secret = getPlatformRazorpayConfig().webhookSecret;
  if (!secret) return false;
  return verifyHmac(rawBody, signatureHex, secret);
}

export function isRazorpayCheckoutConfigured(): boolean {
  return getPlatformRazorpayConfig().isReady;
}

export function submitWalletRechargeRequest(params: {
  workspaceId: string;
  amountPaise: number;
  utrOrReference: string;
  paymentMethod: "upi" | "bank_transfer";
}): { paymentId: string } {
  if (!Number.isInteger(params.amountPaise) || params.amountPaise < 10000) {
    throw new RslError("RSL-VAL-1001", "Minimum wallet recharge request is ₹100.");
  }
  const ref = params.utrOrReference.trim();
  if (ref.length < 4) {
    throw new RslError("RSL-VAL-1001", "Enter your UPI or Bank UTR transaction reference number.");
  }

  const db = controlDb();
  const duplicate = db
    .select()
    .from(controlSchema.payments)
    .where(
      and(
        eq(controlSchema.payments.workspaceId, params.workspaceId),
        eq(controlSchema.payments.externalPaymentId, ref)
      )
    )
    .get();

  if (duplicate) {
    throw new RslError("RSL-VAL-1001", "A recharge request with this UTR / Reference number has already been submitted.");
  }

  const paymentId = newId("pay", params.workspaceId);
  db.insert(controlSchema.payments)
    .values({
      id: paymentId,
      workspaceId: params.workspaceId,
      provider: params.paymentMethod,
      externalPaymentId: ref,
      amountPaise: params.amountPaise,
      currency: "INR",
      purpose: "wallet_topup",
      status: "pending_verification",
      createdAt: Date.now(),
    })
    .run();

  return { paymentId };
}

export function listWorkspaceRechargeRequests(workspaceId: string, limit = 20) {
  return controlDb()
    .select()
    .from(controlSchema.payments)
    .where(eq(controlSchema.payments.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.payments.createdAt))
    .limit(limit)
    .all();
}

export function listPendingPlatformRechargeRequests() {
  const db = controlDb();
  const rows = db
    .select()
    .from(controlSchema.payments)
    .where(eq(controlSchema.payments.status, "pending_verification"))
    .orderBy(desc(controlSchema.payments.createdAt))
    .all();

  const businesses = db.select().from(controlSchema.workspaces).all();
  const bizMap = new Map(businesses.map((b) => [b.id, b.name]));

  return rows.map((r) => ({
    ...r,
    workspaceName: bizMap.get(r.workspaceId) ?? r.workspaceId,
  }));
}

export function approveWalletRechargeRequest(params: {
  paymentId: string;
  staffId: string;
}): { workspaceId: string; amountPaise: number; invoiceNumber?: string; balancePaise: number } {
  const db = controlDb();
  const payment = db
    .select()
    .from(controlSchema.payments)
    .where(eq(controlSchema.payments.id, params.paymentId))
    .get();

  if (!payment || payment.status !== "pending_verification") {
    throw new RslError("RSL-VAL-1001", "Recharge request not found or already processed.");
  }

  const inv = createAdvanceReceiptVoucher({
    workspaceId: payment.workspaceId,
    description: `Prepaid Wallet Deposit (${payment.provider.toUpperCase()} Ref: ${payment.externalPaymentId ?? payment.id})`,
    amountPaise: payment.amountPaise,
    externalRefKey: `wallet_recharge:${payment.id}`,
  });

  const credited = creditWallet({
    workspaceId: payment.workspaceId,
    amountPaise: payment.amountPaise,
    description: `Verified ${payment.provider.toUpperCase()} recharge (Ref: ${payment.externalPaymentId ?? "—"})`,
    idempotencyKey: `verified_payment:${payment.id}`,
    actorId: params.staffId,
    entryType: "credit",
    createInvoice: false,
  });

  db.update(controlSchema.payments)
    .set({
      status: "captured",
      invoiceId: inv.id,
    })
    .where(eq(controlSchema.payments.id, payment.id))
    .run();

  return {
    workspaceId: payment.workspaceId,
    amountPaise: payment.amountPaise,
    invoiceNumber: inv.invoiceNumber,
    balancePaise: credited.balancePaise,
  };
}

export function rejectWalletRechargeRequest(params: {
  paymentId: string;
}): { workspaceId: string } {
  const db = controlDb();
  const payment = db
    .select()
    .from(controlSchema.payments)
    .where(eq(controlSchema.payments.id, params.paymentId))
    .get();

  if (!payment || payment.status !== "pending_verification") {
    throw new RslError("RSL-VAL-1001", "Recharge request not found or already processed.");
  }

  db.update(controlSchema.payments)
    .set({ status: "failed" })
    .where(eq(controlSchema.payments.id, payment.id))
    .run();

  return { workspaceId: payment.workspaceId };
}

export async function createRazorpayOrderForWallet(params: {
  workspaceId: string;
  amountPaise: number;
}): Promise<{ orderId: string; keyId: string; amountWithGstPaise: number }> {
  const rzp = getPlatformRazorpayConfig();
  if (!rzp.isReady) {
    throw new RslError(
      "RSL-VAL-1001",
      "Online gateway checkout is not enabled yet. Please pay via UPI / Bank Transfer and submit your UTR reference below."
    );
  }
  if (!Number.isInteger(params.amountPaise) || params.amountPaise < 10000) {
    throw new RslError("RSL-VAL-1001", "Minimum wallet recharge is ₹100.");
  }

  // Prepaid wallet deposits are collected at 0% GST (Advance Receipt Voucher); GST applies upon service consumption (P0-06)
  const amountWithGstPaise = params.amountPaise;
  const authHeader = Buffer.from(`${rzp.keyId}:${rzp.keySecret}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountWithGstPaise,
      currency: "INR",
      receipt: newId("pay", params.workspaceId),
      notes: {
        workspaceId: params.workspaceId,
        walletCreditPaise: String(params.amountPaise),
      },
    }),
  });

  if (!resp.ok) {
    throw new RslError("RSL-SYS-1001", "Could not create Razorpay payment order. Please try again.");
  }

  const data = (await resp.json()) as { id: string };
  controlDb()
    .insert(controlSchema.payments)
    .values({
      id: newId("pay", params.workspaceId),
      workspaceId: params.workspaceId,
      provider: "razorpay",
      externalOrderId: data.id,
      amountPaise: params.amountPaise,
      currency: "INR",
      purpose: "wallet_topup",
      status: "pending",
      createdAt: Date.now(),
    })
    .run();

  return {
    orderId: data.id,
    keyId: rzp.keyId,
    amountWithGstPaise,
  };
}

export function verifyRazorpayCheckoutAndCreditWallet(params: {
  workspaceId: string;
  orderId: string;
  paymentId: string;
  signatureHex: string;
  actorId: string;
}): { balancePaise: number; invoiceNumber?: string } {
  const secret = getPlatformRazorpayConfig().keySecret;
  if (!secret) {
    throw new RslError("RSL-VAL-1001", "Payment gateway secret is not configured.");
  }
  const valid = verifyHmac(`${params.orderId}|${params.paymentId}`, params.signatureHex, secret);
  if (!valid) {
    throw new RslError("RSL-VAL-1001", "Payment signature verification failed.");
  }

  const db = controlDb();
  const orderRow = db
    .select()
    .from(controlSchema.payments)
    .where(
      and(
        eq(controlSchema.payments.workspaceId, params.workspaceId),
        eq(controlSchema.payments.externalOrderId, params.orderId)
      )
    )
    .get();

  if (!orderRow) {
    throw new RslError("RSL-VAL-1001", "Matching payment order not found.");
  }

  const inv = createAdvanceReceiptVoucher({
    workspaceId: params.workspaceId,
    description: `Online Prepaid Wallet Deposit (Payment ${params.paymentId})`,
    amountPaise: orderRow.amountPaise,
    externalRefKey: `rzp_payment:${params.paymentId}`,
  });

  const credited = creditWallet({
    workspaceId: params.workspaceId,
    amountPaise: orderRow.amountPaise,
    description: `Razorpay Wallet Recharge (${params.paymentId})`,
    idempotencyKey: `rzp_payment:${params.paymentId}`,
    actorId: params.actorId,
    entryType: "credit",
    createInvoice: false,
  });

  db.update(controlSchema.payments)
    .set({
      externalPaymentId: params.paymentId,
      invoiceId: inv.id,
      status: "captured",
    })
    .where(eq(controlSchema.payments.id, orderRow.id))
    .run();

  return {
    balancePaise: credited.balancePaise,
    invoiceNumber: inv.invoiceNumber,
  };
}

// ============================================================================
// Customer Plan Request & Staff Payment-Backed Feature Activation Workflow
// ============================================================================

export function submitServicePlanRequest(params: {
  workspaceId: string;
  serviceKey: string;
  billingCycle?: BillingCycle;
  requestedByUserId: string;
  customerNote?: string;
  customerPaymentRef?: string;
}): {
  requestId: string;
  serviceName: string;
  billingCycle: BillingCycle;
  quotedCyclePaise: number;
  alreadyPending: boolean;
} {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const cycle = normalizeBillingCycle(params.billingCycle);
  const planState = getWorkspacePlansByKeys(params.workspaceId, [params.serviceKey])[0];

  if (!planState) {
    throw new RslError("RSL-VAL-1001", "Selected feature plan was not found.");
  }

  if (planState.isUnlocked) {
    throw new RslError(
      "RSL-VAL-1001",
      `'${planState.name}' is already active on your business account.`
    );
  }

  const quotedCyclePaise =
    cycle === "yearly"
      ? planState.yearlyAmountPaise
      : cycle === "quarterly"
        ? planState.quarterlyAmountPaise
        : planState.monthlyAmountPaise;

  const existingPending = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(
      and(
        eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
        eq(controlSchema.servicePlanRequests.serviceKey, planState.key),
        isNull(controlSchema.servicePlanRequests.bundleKey),
        eq(controlSchema.servicePlanRequests.status, "pending_payment")
      )
    )
    .get();

  const now = Date.now();
  const note = params.customerNote?.trim() || null;
  const payRef = params.customerPaymentRef?.trim() || null;

  if (existingPending) {
    db.update(controlSchema.servicePlanRequests)
      .set({
        billingCycle: cycle,
        quotedMonthlyPaise: planState.monthlyAmountPaise,
        quotedCyclePaise,
        customerNote: note ?? existingPending.customerNote,
        customerPaymentRef: payRef ?? existingPending.customerPaymentRef,
        updatedAt: now,
      })
      .where(eq(controlSchema.servicePlanRequests.id, existingPending.id))
      .run();

    return {
      requestId: existingPending.id,
      serviceName: planState.name,
      billingCycle: cycle,
      quotedCyclePaise,
      alreadyPending: true,
    };
  }

  const requestId = newId("req", params.workspaceId);
  db.insert(controlSchema.servicePlanRequests)
    .values({
      id: requestId,
      workspaceId: params.workspaceId,
      serviceKey: planState.key,
      requestedByUserId: params.requestedByUserId,
      billingCycle: cycle,
      quotedMonthlyPaise: planState.monthlyAmountPaise,
      quotedCyclePaise,
      quotedUnitPaise: planState.unitAmountPaise,
      customerNote: note,
      customerPaymentRef: payRef,
      status: "pending_payment",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    requestId,
    serviceName: planState.name,
    billingCycle: cycle,
    quotedCyclePaise,
    alreadyPending: false,
  };
}

export function submitBundlePlanRequest(params: {
  workspaceId: string;
  bundleKey: string;
  billingCycle?: BillingCycle;
  requestedByUserId: string;
  customerNote?: string;
  customerPaymentRef?: string;
}): {
  requestId: string;
  bundleName: string;
  billingCycle: BillingCycle;
  quotedCyclePaise: number;
  alreadyPending: boolean;
} {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const cycle = normalizeBillingCycle(params.billingCycle);
  const bundles = listBundlesWithWorkspaceState(params.workspaceId);
  const bundle = bundles.find((b) => b.key === params.bundleKey);

  if (!bundle || bundle.includedKeys.length === 0) {
    throw new RslError("RSL-VAL-1001", "Selected bundle package was not found.");
  }

  if (bundle.isFullyUnlocked) {
    throw new RslError(
      "RSL-VAL-1001",
      `All tools in '${bundle.name}' are already active on your business account.`
    );
  }

  const quotedCyclePaise =
    cycle === "yearly"
      ? bundle.yearlyAmountPaise
      : cycle === "quarterly"
        ? bundle.quarterlyAmountPaise
        : bundle.monthlyAmountPaise;

  const existingPending = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(
      and(
        eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
        eq(controlSchema.servicePlanRequests.bundleKey, bundle.key),
        eq(controlSchema.servicePlanRequests.status, "pending_payment")
      )
    )
    .get();

  const now = Date.now();
  const note = params.customerNote?.trim() || null;
  const payRef = params.customerPaymentRef?.trim() || null;

  if (existingPending) {
    db.update(controlSchema.servicePlanRequests)
      .set({
        billingCycle: cycle,
        quotedMonthlyPaise: bundle.monthlyAmountPaise,
        quotedCyclePaise,
        includedKeysJson: JSON.stringify(bundle.includedKeys),
        customerNote: note ?? existingPending.customerNote,
        customerPaymentRef: payRef ?? existingPending.customerPaymentRef,
        updatedAt: now,
      })
      .where(eq(controlSchema.servicePlanRequests.id, existingPending.id))
      .run();

    return {
      requestId: existingPending.id,
      bundleName: bundle.name,
      billingCycle: cycle,
      quotedCyclePaise,
      alreadyPending: true,
    };
  }

  const requestId = newId("req", params.workspaceId);
  db.insert(controlSchema.servicePlanRequests)
    .values({
      id: requestId,
      workspaceId: params.workspaceId,
      serviceKey: bundle.includedKeys[0]!,
      requestedByUserId: params.requestedByUserId,
      billingCycle: cycle,
      quotedMonthlyPaise: bundle.monthlyAmountPaise,
      quotedCyclePaise,
      quotedUnitPaise: 0,
      bundleKey: bundle.key,
      bundleName: bundle.name,
      includedKeysJson: JSON.stringify(bundle.includedKeys),
      customerNote: note,
      customerPaymentRef: payRef,
      status: "pending_payment",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    requestId,
    bundleName: bundle.name,
    billingCycle: cycle,
    quotedCyclePaise,
    alreadyPending: false,
  };
}

export function listWorkspacePlanRequests(workspaceId: string, limit = 30) {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const rows = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(eq(controlSchema.servicePlanRequests.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.servicePlanRequests.createdAt))
    .limit(limit)
    .all();

  const services = db.select().from(controlSchema.services).all();
  const svcMap = new Map(services.map((s) => [s.key, s]));

  return rows.map((r) => {
    const cycle = normalizeBillingCycle(r.billingCycle);
    const effectiveCyclePaise = r.quotedCyclePaise ?? r.quotedMonthlyPaise;
    return {
      ...r,
      billingCycle: cycle,
      effectiveCyclePaise,
      serviceName: r.bundleName || svcMap.get(r.serviceKey)?.name || r.serviceKey,
      category: r.bundleKey ? "Bundle Package" : (svcMap.get(r.serviceKey)?.category ?? "Plan"),
      includedKeys: r.includedKeysJson ? (JSON.parse(r.includedKeysJson) as string[]) : [r.serviceKey],
    };
  });
}

export function listPlatformPlanRequests(statusFilter?: "pending_payment" | "activated" | "declined") {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const rows = statusFilter
    ? db
        .select()
        .from(controlSchema.servicePlanRequests)
        .where(eq(controlSchema.servicePlanRequests.status, statusFilter))
        .orderBy(desc(controlSchema.servicePlanRequests.createdAt))
        .all()
    : db
        .select()
        .from(controlSchema.servicePlanRequests)
        .orderBy(desc(controlSchema.servicePlanRequests.createdAt))
        .limit(100)
        .all();

  const businesses = db.select().from(controlSchema.workspaces).all();
  const users = db.select().from(controlSchema.users).all();
  const services = db.select().from(controlSchema.services).all();

  const bizMap = new Map(businesses.map((b) => [b.id, b]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const svcMap = new Map(services.map((s) => [s.key, s]));

  return rows.map((r) => {
    const biz = bizMap.get(r.workspaceId);
    const usr = userMap.get(r.requestedByUserId);
    const svc = svcMap.get(r.serviceKey);
    const dependsOn = svc ? (JSON.parse(svc.dependsOnJson) as string[]) : [];
    const cycle = normalizeBillingCycle(r.billingCycle);
    const effectiveCyclePaise = r.quotedCyclePaise ?? r.quotedMonthlyPaise;
    const includedKeys = r.includedKeysJson
      ? (JSON.parse(r.includedKeysJson) as string[])
      : [r.serviceKey];

    return {
      ...r,
      billingCycle: cycle,
      effectiveCyclePaise,
      includedKeys,
      workspaceName: biz?.name ?? r.workspaceId,
      workspaceGstin: biz?.gstin ?? null,
      requesterName: usr?.name ?? "Customer",
      requesterEmail: usr?.email ?? "",
      serviceName: r.bundleName || svc?.name || r.serviceKey,
      serviceCategory: r.bundleKey ? "Bundle Package" : (svc?.category ?? "Service"),
      dependsOn: r.bundleKey ? [] : dependsOn,
    };
  });
}

export function staffRecordPlanPaymentAndActivate(params: {
  requestId?: string;
  workspaceId: string;
  serviceKey: string;
  billingCycle?: BillingCycle;
  amountPaidPaise: number;
  paymentMethod: "upi" | "bank_transfer" | "razorpay" | "cash" | "cheque";
  paymentReference: string;
  staffId: string;
  staffNotes?: string;
  includePrerequisites?: boolean;
}): {
  entitlementId: string;
  paymentId: string;
  invoiceNumber: string;
  serviceName: string;
  activatedKeys: string[];
  billingCycle: BillingCycle;
  expiresAt: number;
} {
  ensureServiceCatalogSeeded();
  if (!Number.isInteger(params.amountPaidPaise) || params.amountPaidPaise <= 0) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter a valid positive payment amount in Rupees before activating a plan."
    );
  }
  const ref = params.paymentReference.trim();
  if (ref.length < 3) {
    throw new RslError(
      "RSL-VAL-1001",
      "Payment UTR / receipt reference (at least 3 characters) is mandatory to unlock a plan."
    );
  }

  const db = controlDb();
  const raw = db.$client;

  const existingReq = params.requestId
    ? db
        .select()
        .from(controlSchema.servicePlanRequests)
        .where(eq(controlSchema.servicePlanRequests.id, params.requestId))
        .get()
    : null;

  const cycle = normalizeBillingCycle(params.billingCycle ?? existingReq?.billingCycle);
  const cycleMeta = BILLING_CYCLE_META[cycle];

  const svc = db
    .select()
    .from(controlSchema.services)
    .where(eq(controlSchema.services.key, params.serviceKey))
    .get();
  if (!svc) {
    throw new RslError("RSL-VAL-1001", "Unknown service plan key.");
  }

  const isBundleReq = Boolean(existingReq?.bundleKey && existingReq?.includedKeysJson);
  const bundleKeysFromReq = isBundleReq
    ? (JSON.parse(existingReq!.includedKeysJson!) as string[])
    : null;

  const deps = JSON.parse(svc.dependsOnJson) as string[];
  const includePrereqs = params.includePrerequisites !== false;
  if (!isBundleReq && !includePrereqs) {
    for (const depKey of deps) {
      if (!hasActiveEntitlement(params.workspaceId, depKey)) {
        const depSvc = db
          .select()
          .from(controlSchema.services)
          .where(eq(controlSchema.services.key, depKey))
          .get();
        throw new RslError(
          "RSL-BILL-1002",
          `Prerequisite '${depSvc?.name ?? depKey}' must be active first (or keep 'Also unlock prerequisites' checked).`
        );
      }
    }
  }

  const displayLabel = existingReq?.bundleName || svc.name;

  const runTx = raw.transaction(() => {
    const now = Date.now();
    const expiresAt = now + cycleMeta.durationDays * 86_400_000;

    const inv = createGstInvoice({
      workspaceId: params.workspaceId,
      description: `${displayLabel} — ${cycleMeta.label} (${params.paymentMethod.toUpperCase()} Ref: ${ref})`,
      subtotalPaise: params.amountPaidPaise,
      status: "paid",
    });

    const paymentId = newId("pay", params.workspaceId);
    db.insert(controlSchema.payments)
      .values({
        id: paymentId,
        workspaceId: params.workspaceId,
        invoiceId: inv.id,
        provider: params.paymentMethod,
        externalPaymentId: ref,
        amountPaise: inv.totalPaise,
        currency: "INR",
        purpose: existingReq?.bundleKey
          ? `bundle_activation:${existingReq.bundleKey}`
          : `plan_activation:${svc.key}`,
        status: "captured",
        createdAt: now,
      })
      .run();

    const keysToActivate = bundleKeysFromReq
      ? [...new Set(bundleKeysFromReq)]
      : includePrereqs
        ? [...new Set([...deps, svc.key])]
        : [svc.key];

    let primaryEntId = newId();

    for (const key of keysToActivate) {
      const eId = newId();
      if (key === svc.key) primaryEntId = eId;
      db.insert(controlSchema.entitlements)
        .values({
          id: eId,
          workspaceId: params.workspaceId,
          serviceKey: key,
          status: "active",
          billingCycle: cycle,
          bundleKey: existingReq?.bundleKey ?? null,
          activatedAt: now,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [controlSchema.entitlements.workspaceId, controlSchema.entitlements.serviceKey],
          set: {
            status: "active",
            billingCycle: cycle,
            bundleKey: existingReq?.bundleKey ?? null,
            activatedAt: now,
            expiresAt,
            updatedAt: now,
          },
        })
        .run();

      db.update(controlSchema.servicePlanRequests)
        .set({
          status: "activated",
          paymentId,
          invoiceId: inv.id,
          amountPaidPaise: key === svc.key ? params.amountPaidPaise : 0,
          paymentMethod: params.paymentMethod,
          paymentReference: ref,
          staffNotes: params.staffNotes?.trim() || null,
          reviewedByStaffId: params.staffId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
            eq(controlSchema.servicePlanRequests.serviceKey, key),
            eq(controlSchema.servicePlanRequests.status, "pending_payment")
          )
        )
        .run();
    }

    if (params.requestId) {
      db.update(controlSchema.servicePlanRequests)
        .set({
          status: "activated",
          paymentId,
          invoiceId: inv.id,
          amountPaidPaise: params.amountPaidPaise,
          paymentMethod: params.paymentMethod,
          paymentReference: ref,
          staffNotes: params.staffNotes?.trim() || null,
          reviewedByStaffId: params.staffId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(controlSchema.servicePlanRequests.id, params.requestId))
        .run();
    }

    return {
      entitlementId: primaryEntId,
      paymentId,
      invoiceNumber: inv.invoiceNumber,
      serviceName: displayLabel,
      activatedKeys: keysToActivate,
      billingCycle: cycle,
      expiresAt,
    };
  });

  return runTx.immediate();
}

export function staffDeclinePlanRequest(params: {
  requestId: string;
  staffId: string;
  staffNotes?: string;
}): { workspaceId: string; serviceKey: string } {
  const db = controlDb();
  const req = db
    .select()
    .from(controlSchema.servicePlanRequests)
    .where(eq(controlSchema.servicePlanRequests.id, params.requestId))
    .get();

  if (!req || req.status !== "pending_payment") {
    throw new RslError("RSL-VAL-1001", "Plan request not found or already processed.");
  }

  const now = Date.now();
  db.update(controlSchema.servicePlanRequests)
    .set({
      status: "declined",
      staffNotes: params.staffNotes?.trim() || "Declined — payment not received or cancelled.",
      reviewedByStaffId: params.staffId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(controlSchema.servicePlanRequests.id, req.id))
    .run();

  return { workspaceId: req.workspaceId, serviceKey: req.serviceKey };
}

export function staffRevokeServiceEntitlement(params: {
  workspaceId: string;
  serviceKey: string;
}): void {
  const now = Date.now();
  controlDb()
    .update(controlSchema.entitlements)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(controlSchema.entitlements.workspaceId, params.workspaceId),
        eq(controlSchema.entitlements.serviceKey, params.serviceKey)
      )
    )
    .run();
}

// ============================================================================
// Platform Payment Receiving Settings, Custom Pricing, Bundles & Invoices Admin
// ============================================================================

export interface PlatformBillingSettings {
  upiQrMode: UpiQrRoutingMode;
  upiId: string;
  payeeName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  gstin: string;
  billingEmail: string;
  supportPhone: string;
}

const BILLING_SETTINGS_KEY = "platform.billing_receiving_details";

const DEFAULT_BILLING_SETTINGS: PlatformBillingSettings = {
  upiQrMode: "bank_account",
  upiId: "",
  payeeName: "RSL Marketing Technologies",
  bankName: "HDFC Bank",
  accountNumber: "50200091827364",
  ifscCode: "HDFC0001234",
  gstin: "27AAACR5055K1Z1",
  billingEmail: "billing@rapidshiftlabs.in",
  supportPhone: "+91 98200 00000",
};

export function getPlatformBillingSettings(): PlatformBillingSettings {
  const row = controlDb()
    .select()
    .from(controlSchema.featureFlags)
    .where(eq(controlSchema.featureFlags.key, BILLING_SETTINGS_KEY))
    .get();

  if (!row) return DEFAULT_BILLING_SETTINGS;
  try {
    const parsed = JSON.parse(row.description) as Partial<PlatformBillingSettings>;
    const cleanUpiId = parsed.upiId?.trim() ?? DEFAULT_BILLING_SETTINGS.upiId;
    const defaultMode: UpiQrRoutingMode = isValidUpiVpa(cleanUpiId) ? "upi_id" : "bank_account";
    return {
      upiQrMode:
        parsed.upiQrMode === "upi_id" || parsed.upiQrMode === "bank_account"
          ? parsed.upiQrMode
          : defaultMode,
      upiId: cleanUpiId,
      payeeName: parsed.payeeName?.trim() || DEFAULT_BILLING_SETTINGS.payeeName,
      bankName: parsed.bankName?.trim() || DEFAULT_BILLING_SETTINGS.bankName,
      accountNumber: parsed.accountNumber?.trim() || DEFAULT_BILLING_SETTINGS.accountNumber,
      ifscCode: (parsed.ifscCode?.trim() || DEFAULT_BILLING_SETTINGS.ifscCode).toUpperCase(),
      gstin: (parsed.gstin?.trim() || DEFAULT_BILLING_SETTINGS.gstin).toUpperCase(),
      billingEmail: parsed.billingEmail?.trim() || DEFAULT_BILLING_SETTINGS.billingEmail,
      supportPhone: parsed.supportPhone?.trim() || DEFAULT_BILLING_SETTINGS.supportPhone,
    };
  } catch {
    return DEFAULT_BILLING_SETTINGS;
  }
}

export function savePlatformBillingSettings(next: Partial<PlatformBillingSettings>): PlatformBillingSettings {
  const current = getPlatformBillingSettings();
  const candidateUpiId = next.upiId !== undefined ? next.upiId.trim() : current.upiId;
  const candidateIfsc = (next.ifscCode?.trim() || current.ifscCode).toUpperCase();
  const candidateAccount = (next.accountNumber?.trim() || current.accountNumber).replace(/\s+/g, "");

  const candidateGstin = (next.gstin?.trim() || current.gstin).toUpperCase();
  if (candidateGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(candidateGstin)) {
    throw new RslError(
      "RSL-VAL-1001",
      `Supplier GSTIN "${candidateGstin}" is invalid. Enter a valid 15-character Indian GSTIN (for example: 27AAACR5055K1Z1).`
    );
  }
  if (candidateGstin && !INDIA_GST_STATES[candidateGstin.slice(0, 2)]) {
    throw new RslError(
      "RSL-VAL-1001",
      `Supplier GSTIN prefix "${candidateGstin.slice(0, 2)}" does not match an Indian GST state code.`
    );
  }

  if (candidateUpiId && isEmailLikeHandle(candidateUpiId)) {
    throw new RslError(
      "RSL-VAL-1001",
      `"${candidateUpiId}" looks like an email address rather than a bank UPI ID (VPA). Enter an active UPI handle such as yourbusiness@okhdfcbank, merchant@icici, or 98XXXXXXXX@ybl so UPI apps can fetch your Banking Name.`
    );
  }
  if (candidateUpiId && !isValidUpiVpa(candidateUpiId)) {
    throw new RslError(
      "RSL-VAL-1001",
      `Enter a valid UPI ID in the format handle@bank (for example: rapidshift@okhdfcbank or 9820000000@ybl).`
    );
  }
  if (candidateIfsc && !isValidRbiIfsc(candidateIfsc)) {
    throw new RslError(
      "RSL-VAL-1001",
      `IFSC "${candidateIfsc}" is invalid. RBI IFSC codes must be 11 characters with '0' as the 5th character (e.g. HDFC0000123).`
    );
  }
  if (next.upiQrMode === "upi_id" && !candidateUpiId) {
    throw new RslError(
      "RSL-VAL-1001",
      "Enter your active UPI ID (VPA) when 'Standard UPI ID (VPA)' QR mode is selected."
    );
  }

  const resolvedMode: UpiQrRoutingMode =
    next.upiQrMode === "upi_id" || next.upiQrMode === "bank_account"
      ? next.upiQrMode
      : candidateUpiId
        ? "upi_id"
        : current.upiQrMode;

  const diag = diagnoseUpiPayeeConfig({
    upiQrMode: resolvedMode,
    upiId: candidateUpiId,
    accountNumber: candidateAccount,
    ifscCode: candidateIfsc,
  });

  const autoPromoteNewVpa = !current.upiId && diag.hasValidVpa;

  const merged: PlatformBillingSettings = {
    upiQrMode:
      autoPromoteNewVpa ||
      (resolvedMode === "bank_account" && diag.isDemoBankPlaceholder && diag.hasValidVpa)
        ? "upi_id"
        : resolvedMode,
    upiId: candidateUpiId,
    payeeName: next.payeeName?.trim() || current.payeeName,
    bankName: next.bankName?.trim() || current.bankName,
    accountNumber: candidateAccount,
    ifscCode: candidateIfsc,
    gstin: (next.gstin?.trim() || current.gstin).toUpperCase(),
    billingEmail: next.billingEmail?.trim() || current.billingEmail,
    supportPhone: next.supportPhone?.trim() || current.supportPhone,
  };

  const now = Date.now();
  controlDb()
    .insert(controlSchema.featureFlags)
    .values({
      key: BILLING_SETTINGS_KEY,
      description: JSON.stringify(merged),
      enabledGlobal: true,
      workspaceAllowlistJson: "[]",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: controlSchema.featureFlags.key,
      set: {
        description: JSON.stringify(merged),
        updatedAt: now,
      },
    })
    .run();

  return merged;
}

export function staffUpdateServiceCatalogPrices(params: {
  serviceKey: string;
  monthlyAmountPaise: number;
  quarterlyAmountPaise?: number | null;
  yearlyAmountPaise?: number | null;
  unitAmountPaise: number;
}): void {
  ensureServiceCatalogSeeded();
  const defaults = computeDefaultCycleAmountsPaise(params.monthlyAmountPaise);
  controlDb()
    .update(controlSchema.servicePrices)
    .set({
      monthlyAmountPaise: Math.max(0, Math.round(params.monthlyAmountPaise)),
      quarterlyAmountPaise:
        params.quarterlyAmountPaise !== undefined && params.quarterlyAmountPaise !== null
          ? Math.max(0, Math.round(params.quarterlyAmountPaise))
          : defaults.quarterlyPaise,
      yearlyAmountPaise:
        params.yearlyAmountPaise !== undefined && params.yearlyAmountPaise !== null
          ? Math.max(0, Math.round(params.yearlyAmountPaise))
          : defaults.yearlyPaise,
      unitAmountPaise: Math.max(0, Math.round(params.unitAmountPaise)),
    })
    .where(
      and(
        eq(controlSchema.servicePrices.serviceKey, params.serviceKey),
        eq(controlSchema.servicePrices.active, true)
      )
    )
    .run();
}

export function staffUpdateGlobalBundleCatalog(params: {
  bundleKey: string;
  name?: string;
  monthlyAmountPaise: number;
  quarterlyAmountPaise: number;
  yearlyAmountPaise: number;
  includedKeys?: string[];
}): void {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const existing = db
    .select()
    .from(controlSchema.planBundles)
    .where(eq(controlSchema.planBundles.key, params.bundleKey))
    .get();
  if (!existing) {
    throw new RslError("RSL-VAL-1001", "Bundle not found.");
  }

  db.update(controlSchema.planBundles)
    .set({
      name: params.name?.trim() || existing.name,
      monthlyAmountPaise: Math.max(0, Math.round(params.monthlyAmountPaise)),
      quarterlyAmountPaise: Math.max(0, Math.round(params.quarterlyAmountPaise)),
      yearlyAmountPaise: Math.max(0, Math.round(params.yearlyAmountPaise)),
      includedKeysJson:
        params.includedKeys && params.includedKeys.length > 0
          ? JSON.stringify(params.includedKeys)
          : existing.includedKeysJson,
      updatedAt: Date.now(),
    })
    .where(eq(controlSchema.planBundles.key, params.bundleKey))
    .run();
}

export function staffSetClientPlanOverride(params: {
  workspaceId: string;
  serviceKey: string;
  customMonthlyPaise: number | null;
  customQuarterlyPaise?: number | null;
  customYearlyPaise?: number | null;
}): void {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const now = Date.now();
  const existing = db
    .select()
    .from(controlSchema.entitlements)
    .where(
      and(
        eq(controlSchema.entitlements.workspaceId, params.workspaceId),
        eq(controlSchema.entitlements.serviceKey, params.serviceKey)
      )
    )
    .get();

  const quarterlyVal =
    params.customQuarterlyPaise === undefined
      ? params.customMonthlyPaise === null
        ? null
        : (existing?.quarterlyOverridePaise ?? null)
      : params.customQuarterlyPaise;
  const yearlyVal =
    params.customYearlyPaise === undefined
      ? params.customMonthlyPaise === null
        ? null
        : (existing?.yearlyOverridePaise ?? null)
      : params.customYearlyPaise;

  if (existing) {
    db.update(controlSchema.entitlements)
      .set({
        priceOverridePaise: params.customMonthlyPaise,
        quarterlyOverridePaise: quarterlyVal,
        yearlyOverridePaise: yearlyVal,
        updatedAt: now,
      })
      .where(eq(controlSchema.entitlements.id, existing.id))
      .run();
  } else {
    db.insert(controlSchema.entitlements)
      .values({
        id: newId(),
        workspaceId: params.workspaceId,
        serviceKey: params.serviceKey,
        status: "cancelled",
        priceOverridePaise: params.customMonthlyPaise,
        quarterlyOverridePaise: quarterlyVal,
        yearlyOverridePaise: yearlyVal,
        activatedAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function staffSetClientBundleOverride(params: {
  workspaceId: string;
  bundleKey: string;
  customName?: string | null;
  includedKeys?: string[] | null;
  monthlyOverridePaise: number | null;
  quarterlyOverridePaise?: number | null;
  yearlyOverridePaise?: number | null;
  resetAll?: boolean;
}): void {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  if (params.resetAll) {
    db.delete(controlSchema.clientBundleOverrides)
      .where(
        and(
          eq(controlSchema.clientBundleOverrides.workspaceId, params.workspaceId),
          eq(controlSchema.clientBundleOverrides.bundleKey, params.bundleKey)
        )
      )
      .run();
    return;
  }

  const now = Date.now();
  const includedJson =
    params.includedKeys && params.includedKeys.length > 0
      ? JSON.stringify(params.includedKeys)
      : null;

  db.insert(controlSchema.clientBundleOverrides)
    .values({
      id: newId(),
      workspaceId: params.workspaceId,
      bundleKey: params.bundleKey,
      customName: params.customName?.trim() || null,
      includedKeysJson: includedJson,
      monthlyOverridePaise: params.monthlyOverridePaise,
      quarterlyOverridePaise: params.quarterlyOverridePaise ?? null,
      yearlyOverridePaise: params.yearlyOverridePaise ?? null,
      hidden: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        controlSchema.clientBundleOverrides.workspaceId,
        controlSchema.clientBundleOverrides.bundleKey,
      ],
      set: {
        customName: params.customName?.trim() || null,
        includedKeysJson: includedJson,
        monthlyOverridePaise: params.monthlyOverridePaise,
        quarterlyOverridePaise: params.quarterlyOverridePaise ?? null,
        yearlyOverridePaise: params.yearlyOverridePaise ?? null,
        updatedAt: now,
      },
    })
    .run();
}

export function staffCreateClientCustomBundle(params: {
  workspaceId: string;
  name: string;
  tagline?: string;
  includedKeys: string[];
  monthlyAmountPaise: number;
  quarterlyAmountPaise?: number;
  yearlyAmountPaise?: number;
}): { bundleKey: string } {
  ensureServiceCatalogSeeded();
  const cleanName = params.name.trim();
  if (cleanName.length < 3) {
    throw new RslError("RSL-VAL-1001", "Enter a bundle name (at least 3 characters).");
  }
  const validCatalogKeys = new Set(SERVICE_CATALOG.map((s) => s.key));
  const keys = [...new Set(params.includedKeys.filter((k) => validCatalogKeys.has(k)))];
  if (keys.length < 1) {
    throw new RslError("RSL-VAL-1001", "Select at least 1 tool to include in this client bundle.");
  }

  const defaults = computeDefaultCycleAmountsPaise(params.monthlyAmountPaise);
  const now = Date.now();
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  const bundleKey = `custom_${params.workspaceId.slice(-6).toLowerCase()}_${slug || "pack"}_${String(now).slice(-4)}`;

  controlDb()
    .insert(controlSchema.planBundles)
    .values({
      key: bundleKey,
      workspaceId: params.workspaceId,
      name: cleanName,
      tagline:
        params.tagline?.trim() ||
        `Custom ${keys.length}-tool package tailored specifically for your business.`,
      description: `Bespoke client bundle unlocking ${keys.length} selected RSL Marketing tools.`,
      includedKeysJson: JSON.stringify(keys),
      monthlyAmountPaise: Math.max(0, Math.round(params.monthlyAmountPaise)),
      quarterlyAmountPaise:
        params.quarterlyAmountPaise !== undefined
          ? Math.max(0, Math.round(params.quarterlyAmountPaise))
          : defaults.quarterlyPaise,
      yearlyAmountPaise:
        params.yearlyAmountPaise !== undefined
          ? Math.max(0, Math.round(params.yearlyAmountPaise))
          : defaults.yearlyPaise,
      badgeLabel: "Custom Client Bundle",
      active: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { bundleKey };
}

export const PLAN_BUNDLES = {
  tally_whatsapp_pack: {
    label: "Tally + WhatsApp Billing Pack",
    description: "Tally Prime Sync, WhatsApp Messaging, Tally Bill Reminders, and Shared Inbox",
    keys: ["inbox", "whatsapp.messaging", "tally.sync", "tally.invoicing"],
    suggestedRupees: 3499,
  },
  whatsapp_growth_pack: {
    label: "WhatsApp Broadcasts & Customer Inbox Suite",
    description: "Shared Customer Inbox, WhatsApp Messaging, and WhatsApp Bulk Broadcasts",
    keys: ["inbox", "whatsapp.messaging", "whatsapp.broadcast"],
    suggestedRupees: 2299,
  },
  social_growth_pack: {
    label: "Meta Ads, Social Publishing & Sales Pixel Suite",
    description: "Facebook Pages, Instagram DMs, Website Sales Tracking, Meta Ads, and Google Reviews",
    keys: ["meta.pages", "meta.instagram", "meta.pixel", "meta.ads", "google.reviews"],
    suggestedRupees: 3999,
  },
  google_reputation_pack: {
    label: "Google Reviews & Smart Replies Pack",
    description: "Google Business Reviews & Replies plus Suggested Review Replies",
    keys: ["google.reviews", "google.autoreply"],
    suggestedRupees: 1299,
  },
  cloud_backup_api_pack: {
    label: "Cloud Storage, Encrypted Backups & Developer API Pack",
    description: "Managed Cloud Storage, Encrypted Customer Backups, and Developer REST API & Webhooks",
    keys: ["storage.managed", "backup.export", "api.access"],
    suggestedRupees: 1999,
  },
  all_features: {
    label: "Complete RSL All-in-One Software Package (All 15 Tools)",
    description: "Unlocks every feature plan across WhatsApp, Tally, Social, Google, Storage, and API",
    keys: SERVICE_CATALOG.map((s) => s.key),
    suggestedRupees: 7999,
  },
} as const;

export type PlanBundleKey = keyof typeof PLAN_BUNDLES | (string & {});

export function staffBulkUnlockBundle(params: {
  workspaceId: string;
  bundleKey: string;
  billingCycle?: BillingCycle;
  amountPaidPaise: number;
  paymentMethod: "upi" | "bank_transfer" | "razorpay" | "cash" | "cheque";
  paymentReference: string;
  staffId: string;
}): { invoiceNumber: string; bundleLabel: string; unlockedCount: number; expiresAt: number } {
  ensureServiceCatalogSeeded();
  const clientBundles = listBundlesWithWorkspaceState(params.workspaceId);
  const resolved = clientBundles.find((b) => b.key === params.bundleKey);
  const fallbackStatic =
    params.bundleKey in PLAN_BUNDLES
      ? PLAN_BUNDLES[params.bundleKey as keyof typeof PLAN_BUNDLES]
      : null;

  const bundleLabel = resolved?.name ?? fallbackStatic?.label;
  const bundleKeys = resolved?.includedKeys ?? (fallbackStatic ? [...fallbackStatic.keys] : []);

  if (!bundleLabel || bundleKeys.length === 0) {
    throw new RslError("RSL-VAL-1001", "Selected plan bundle was not found.");
  }
  if (!Number.isInteger(params.amountPaidPaise) || params.amountPaidPaise <= 0) {
    throw new RslError("RSL-VAL-1001", "Enter a positive payment amount in Rupees.");
  }
  const ref = params.paymentReference.trim();
  if (ref.length < 3) {
    throw new RslError("RSL-VAL-1001", "Payment UTR / receipt number is mandatory.");
  }

  const cycle = normalizeBillingCycle(params.billingCycle);
  const cycleMeta = BILLING_CYCLE_META[cycle];

  const db = controlDb();
  const tx = db.$client.transaction(() => {
    const now = Date.now();
    const expiresAt = now + cycleMeta.durationDays * 86_400_000;
    const inv = createGstInvoice({
      workspaceId: params.workspaceId,
      description: `${bundleLabel} — ${cycleMeta.label} (${params.paymentMethod.toUpperCase()} Ref: ${ref})`,
      subtotalPaise: params.amountPaidPaise,
      status: "paid",
    });

    const paymentId = newId("pay", params.workspaceId);
    db.insert(controlSchema.payments)
      .values({
        id: paymentId,
        workspaceId: params.workspaceId,
        invoiceId: inv.id,
        provider: params.paymentMethod,
        externalPaymentId: ref,
        amountPaise: inv.totalPaise,
        currency: "INR",
        purpose: `bundle_activation:${params.bundleKey}`,
        status: "captured",
        createdAt: now,
      })
      .run();

    for (const key of bundleKeys) {
      db.insert(controlSchema.entitlements)
        .values({
          id: newId(),
          workspaceId: params.workspaceId,
          serviceKey: key,
          status: "active",
          billingCycle: cycle,
          bundleKey: params.bundleKey,
          activatedAt: now,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [controlSchema.entitlements.workspaceId, controlSchema.entitlements.serviceKey],
          set: {
            status: "active",
            billingCycle: cycle,
            bundleKey: params.bundleKey,
            activatedAt: now,
            expiresAt,
            updatedAt: now,
          },
        })
        .run();

      db.update(controlSchema.servicePlanRequests)
        .set({
          status: "activated",
          paymentId,
          invoiceId: inv.id,
          paymentMethod: params.paymentMethod,
          paymentReference: ref,
          reviewedByStaffId: params.staffId,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
            eq(controlSchema.servicePlanRequests.serviceKey, key),
            eq(controlSchema.servicePlanRequests.status, "pending_payment")
          )
        )
        .run();
    }

    db.update(controlSchema.servicePlanRequests)
      .set({
        status: "activated",
        paymentId,
        invoiceId: inv.id,
        amountPaidPaise: params.amountPaidPaise,
        paymentMethod: params.paymentMethod,
        paymentReference: ref,
        reviewedByStaffId: params.staffId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
          eq(controlSchema.servicePlanRequests.bundleKey, params.bundleKey),
          eq(controlSchema.servicePlanRequests.status, "pending_payment")
        )
      )
      .run();

    return {
      invoiceNumber: inv.invoiceNumber,
      bundleLabel,
      unlockedCount: bundleKeys.length,
      expiresAt,
    };
  });

  return tx.immediate();
}

export function listWorkspaceBillingReminders(workspaceId: string, limit = 15) {
  return controlDb()
    .select()
    .from(controlSchema.billingReminderLogs)
    .where(eq(controlSchema.billingReminderLogs.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.billingReminderLogs.createdAt))
    .limit(limit)
    .all();
}

/**
 * Automatic Renewal Reminder Sweep (Monthly, Quarterly & Yearly cycles).
 * Sends formatted renewal alerts with UPI payment details 7 days before expiry, 1 day before expiry, and when overdue.
 */
export async function sweepAutomaticBillingReminders(nowMs = Date.now()): Promise<{
  checkedWorkspaces: number;
  sentCount: number;
}> {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const settings = getPlatformBillingSettings();
  const activeWorkspaces = db
    .select()
    .from(controlSchema.workspaces)
    .where(
      and(
        eq(controlSchema.workspaces.billingStatus, "active"),
        eq(controlSchema.workspaces.autoBillingReminders, true)
      )
    )
    .all();

  const users = db.select().from(controlSchema.users).all();
  const userById = new Map(users.map((u) => [u.id, u]));

  let sentCount = 0;

  for (const ws of activeWorkspaces) {
    const owner = userById.get(ws.ownerUserId);
    if (!owner?.email) continue;

    // Skip if complimentary free access is active well beyond 7 days
    if (ws.freeAccessUntil && ws.freeAccessUntil > nowMs + 7 * 86_400_000) {
      continue;
    }

    const svcStates = listServicesWithWorkspaceState(ws.id);
    const bundles = listBundlesWithWorkspaceState(ws.id);
    const bundleByKey = new Map(bundles.map((b) => [b.key, b]));

    const expiringServices = svcStates.filter(
      (s) =>
        (s.entitlementStatus === "active" ||
          s.entitlementStatus === "trialing" ||
          s.entitlementStatus === "expired") &&
        s.expiresAt !== null &&
        s.expiresAt <= nowMs + 7 * 86_400_000
    );

    if (expiringServices.length === 0) continue;

    // Group by bundleKey (if unlocked via bundle) or individual service + billingCycle
    const groups = new Map<
      string,
      {
        label: string;
        cycle: BillingCycle;
        subtotalPaise: number;
        dueAt: number;
      }
    >();

    for (const s of expiringServices) {
      const dueAt = s.expiresAt!;
      const cycle = s.billingCycle;
      if (s.bundleKey && bundleByKey.has(s.bundleKey)) {
        const b = bundleByKey.get(s.bundleKey)!;
        const gKey = `bundle:${b.key}:${cycle}`;
        if (!groups.has(gKey)) {
          const sub =
            cycle === "yearly"
              ? b.yearlyAmountPaise
              : cycle === "quarterly"
                ? b.quarterlyAmountPaise
                : b.monthlyAmountPaise;
          groups.set(gKey, { label: b.name, cycle, subtotalPaise: sub, dueAt });
        }
      } else {
        const gKey = `svc:${s.key}:${cycle}`;
        const sub =
          cycle === "yearly"
            ? s.yearlyAmountPaise
            : cycle === "quarterly"
              ? s.quarterlyAmountPaise
              : s.monthlyAmountPaise;
        groups.set(gKey, { label: s.name, cycle, subtotalPaise: sub, dueAt });
      }
    }

    for (const [gKey, grp] of groups.entries()) {
      const diffMs = grp.dueAt - nowMs;
      let stage: "upcoming_7d" | "due_soon_1d" | "overdue";
      let bucketKey: string;
      const dueDayIso = new Date(grp.dueAt).toISOString().slice(0, 10);

      if (diffMs < 0) {
        stage = "overdue";
        const weekBucket = Math.floor(nowMs / (7 * 86_400_000));
        bucketKey = `${dueDayIso}:w${weekBucket}`;
      } else if (diffMs <= 86_400_000) {
        stage = "due_soon_1d";
        bucketKey = dueDayIso;
      } else {
        stage = "upcoming_7d";
        bucketKey = dueDayIso;
      }

      const dedupeKey = `rem:${ws.id}:${gKey}:${stage}:${bucketKey}`;
      const alreadySent = db
        .select({ id: controlSchema.billingReminderLogs.id })
        .from(controlSchema.billingReminderLogs)
        .where(eq(controlSchema.billingReminderLogs.dedupeKey, dedupeKey))
        .get();
      if (alreadySent) continue;

      const upi = buildUpiPaymentPayload({
        routingMode: settings.upiQrMode,
        accountNumber: settings.accountNumber,
        ifscCode: settings.ifscCode,
        bankName: settings.bankName,
        upiId: settings.upiId,
        payeeName: settings.payeeName,
        subtotalPaise: grp.subtotalPaise,
        buyerStateCode: ws.stateCode || "27",
        supplierStateCode: settings.gstin.slice(0, 2) || "27",
        workspaceSlug: ws.slug,
        itemLabel: grp.label,
        billingCycle: grp.cycle,
      });

      const cycleLabel = BILLING_CYCLE_META[grp.cycle].label;
      const dueFormatted = new Date(grp.dueAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

      const headline =
        stage === "overdue"
          ? `Action Needed: ${cycleLabel} Renewal Overdue — ${grp.label}`
          : `Upcoming ${cycleLabel} Plan Renewal on ${dueFormatted}`;

      const paymentDestCopy =
        upi.routingMode === "bank_account"
          ? `${settings.bankName} A/C ${settings.accountNumber} (IFSC ${settings.ifscCode})`
          : upi.payeeAddress;

      const bodyText = `Your ${cycleLabel.toLowerCase()} subscription for '${grp.label}' ${
        stage === "overdue" ? `expired on ${dueFormatted}` : `is scheduled for renewal on ${dueFormatted}`
      }. Amount payable (including 18% GST): ${formatInr(upi.totalPayablePaise, { showDecimals: true })}. Scan the direct Bank-over-UPI QR inside your Plans & Wallet dashboard, or remit to ${paymentDestCopy} with transaction note '${upi.transactionNote}'.`;

      const emailRes = await sendBillingNotification({
        workspaceId: ws.id,
        businessName: ws.name,
        recipientEmail: owner.email,
        headline,
        bodyText,
        walletBalanceFormatted: formatInr(getWalletBalancePaise(ws.id), { showDecimals: true }),
      }).catch(() => null);

      db.insert(controlSchema.billingReminderLogs)
        .values({
          id: newId("req", ws.id),
          workspaceId: ws.id,
          reminderStage: stage,
          billingCycle: grp.cycle,
          targetSummary: grp.label,
          dueAt: grp.dueAt,
          amountPaise: upi.totalPayablePaise,
          recipientEmail: owner.email,
          dedupeKey,
          emailId: emailRes?.emailId ?? null,
          createdAt: nowMs,
        })
        .run();

      sentCount++;
    }
  }

  return {
    checkedWorkspaces: activeWorkspaces.length,
    sentCount,
  };
}

export async function sendManualBillingReminder(params: {
  workspaceId: string;
  staffId: string;
  billingCycle?: BillingCycle;
  customAmountPaise?: number;
  customLabel?: string;
}): Promise<{ recipientEmail: string; amountWithGstPaise: number; summary: string }> {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) throw new RslError("RSL-VAL-1001", "Client workspace not found.");

  const owner = db
    .select()
    .from(controlSchema.users)
    .where(eq(controlSchema.users.id, ws.ownerUserId))
    .get();
  if (!owner?.email) {
    throw new RslError("RSL-VAL-1001", "Client owner email address not found.");
  }

  const cycle = normalizeBillingCycle(params.billingCycle);
  const svcStates = listServicesWithWorkspaceState(ws.id);
  const activePaid = svcStates.filter((s) => s.isPaidUnlocked);

  const fallbackMonthlySum = activePaid.reduce((acc, s) => acc + s.monthlyAmountPaise, 0);
  const subtotalPaise =
    params.customAmountPaise && params.customAmountPaise > 0
      ? params.customAmountPaise
      : fallbackMonthlySum > 0
        ? cycle === "yearly"
          ? computeDefaultCycleAmountsPaise(fallbackMonthlySum).yearlyPaise
          : cycle === "quarterly"
            ? computeDefaultCycleAmountsPaise(fallbackMonthlySum).quarterlyPaise
            : fallbackMonthlySum
        : 349900;

  const summary =
    params.customLabel?.trim() ||
    (activePaid.length > 0
      ? `${activePaid.length} Active Plan(s)`
      : "RSL Marketing Plan Subscription");

  const settings = getPlatformBillingSettings();
  const upi = buildUpiPaymentPayload({
    routingMode: settings.upiQrMode,
    accountNumber: settings.accountNumber,
    ifscCode: settings.ifscCode,
    bankName: settings.bankName,
    upiId: settings.upiId,
    payeeName: settings.payeeName,
    subtotalPaise,
    buyerStateCode: ws.stateCode || "27",
    supplierStateCode: settings.gstin.slice(0, 2) || "27",
    workspaceSlug: ws.slug,
    itemLabel: summary,
    billingCycle: cycle,
  });

  const paymentDestCopy =
    upi.routingMode === "bank_account"
      ? `${settings.bankName} A/C ${settings.accountNumber} (IFSC ${settings.ifscCode})`
      : upi.payeeAddress;

  const cycleLabel = BILLING_CYCLE_META[cycle].label;
  const emailRes = await sendBillingNotification({
    workspaceId: ws.id,
    businessName: ws.name,
    recipientEmail: owner.email,
    headline: `${cycleLabel} Billing Reminder — ${summary}`,
    bodyText: `Gentle reminder for your ${cycleLabel.toLowerCase()} renewal of '${summary}'. Total payable (including 18% GST): ${formatInr(upi.totalPayablePaise, { showDecimals: true })}. Scan the direct Bank-over-UPI QR inside your RSL Marketing Billing dashboard, or remit to ${paymentDestCopy} with transaction note '${upi.transactionNote}'.`,
    walletBalanceFormatted: formatInr(getWalletBalancePaise(ws.id), { showDecimals: true }),
  });

  const now = Date.now();
  db.insert(controlSchema.billingReminderLogs)
    .values({
      id: newId("req", ws.id),
      workspaceId: ws.id,
      reminderStage: "manual",
      billingCycle: cycle,
      targetSummary: summary,
      dueAt: now,
      amountPaise: upi.totalPayablePaise,
      recipientEmail: owner.email,
      dedupeKey: `manual:${ws.id}:${now}`,
      emailId: emailRes.emailId,
      createdAt: now,
    })
    .run();

  return {
    recipientEmail: owner.email,
    amountWithGstPaise: upi.totalPayablePaise,
    summary,
  };
}

export function listAllPlatformInvoices(filter?: {
  status?: string;
  workspaceId?: string;
  q?: string;
  limit?: number;
}) {
  const db = controlDb();
  const allInvoices = db
    .select()
    .from(controlSchema.invoices)
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(filter?.limit ?? 150)
    .all();

  const businesses = db.select().from(controlSchema.workspaces).all();
  const payments = db.select().from(controlSchema.payments).all();

  const bizMap = new Map(businesses.map((b) => [b.id, b]));
  const payByInv = new Map(
    payments.filter((p) => Boolean(p.invoiceId)).map((p) => [p.invoiceId!, p])
  );

  const q = filter?.q?.trim().toLowerCase() || "";

  return allInvoices
    .map((inv) => {
      const biz = bizMap.get(inv.workspaceId);
      const pay = payByInv.get(inv.id);
      return {
        ...inv,
        workspaceName: biz?.name ?? inv.workspaceId,
        workspaceGstin: biz?.gstin ?? null,
        workspaceStateCode: biz?.stateCode ?? "27",
        paymentMethod: pay?.provider ?? null,
        paymentReference: pay?.externalPaymentId ?? null,
      };
    })
    .filter((row) => {
      if (filter?.status && filter.status !== "all" && row.status !== filter.status) {
        return false;
      }
      if (filter?.workspaceId && row.workspaceId !== filter.workspaceId) {
        return false;
      }
      if (q) {
        const hay = `${row.invoiceNumber} ${row.workspaceName} ${row.description} ${row.paymentReference ?? ""} ${row.workspaceGstin ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
}

export function staffCreateCustomInvoice(params: {
  workspaceId: string;
  description: string;
  subtotalPaise: number;
  status: "paid" | "issued";
  paymentMethod?: string;
  paymentReference?: string;
}) {
  if (!Number.isInteger(params.subtotalPaise) || params.subtotalPaise <= 0) {
    throw new RslError("RSL-VAL-1001", "Invoice subtotal must be a positive Rupee amount.");
  }
  if (params.description.trim().length < 3) {
    throw new RslError("RSL-VAL-1001", "Enter a clear invoice line description.");
  }

  const db = controlDb();
  const inv = createGstInvoice({
    workspaceId: params.workspaceId,
    description: params.description.trim(),
    subtotalPaise: params.subtotalPaise,
    status: params.status,
  });

  if (params.status === "paid") {
    db.insert(controlSchema.payments)
      .values({
        id: newId("pay", params.workspaceId),
        workspaceId: params.workspaceId,
        invoiceId: inv.id,
        provider: params.paymentMethod || "bank_transfer",
        externalPaymentId: params.paymentReference?.trim() || "MANUAL-PAID",
        amountPaise: inv.totalPaise,
        currency: "INR",
        purpose: "invoice_payment",
        status: "captured",
        createdAt: Date.now(),
      })
      .run();
  }

  return inv;
}

/**
 * Issues a statutory Section 34 GST Credit Note (`CN/YY-YY/0001`) referencing an existing GST Tax Invoice,
 * preserving the immutable audit trail required for GSTR-1 Table 9B reporting instead of deleting/erasing invoices (ACT-5.2).
 */
export function issueGstCreditNote(params: {
  invoiceId: string;
  reason?: string;
  staffId?: string;
  refundToWallet?: boolean;
}): typeof controlSchema.invoices.$inferSelect {
  const db = controlDb();
  const raw = db.$client;

  const tx = raw.transaction(() => {
    const inv = db
      .select()
      .from(controlSchema.invoices)
      .where(eq(controlSchema.invoices.id, params.invoiceId))
      .get();
    if (!inv) {
      throw new RslError("RSL-VAL-1001", "Original GST invoice not found.");
    }
    if (inv.docType === "credit_note") {
      return inv;
    }

    const existingCn = db
      .select()
      .from(controlSchema.invoices)
      .where(
        and(
          eq(controlSchema.invoices.linkedInvoiceId, inv.id),
          eq(controlSchema.invoices.docType, "credit_note")
        )
      )
      .get();
    if (existingCn) {
      return existingCn;
    }

    const fy = computeIndianFinancialYearIst();
    const cnNumber = allocateNextDocumentNumber("credit_note", fy);
    const now = Date.now();
    const reasonText = params.reason?.trim() || "Statutory reversal / cancellation under CGST Sec. 34";

    const cnRow: typeof controlSchema.invoices.$inferSelect = {
      id: newId(),
      workspaceId: inv.workspaceId,
      invoiceNumber: cnNumber,
      docType: "credit_note",
      linkedInvoiceId: inv.id,
      externalRefKey: `credit_note_for:${inv.id}`,
      financialYear: fy,
      description: `Credit Note against ${inv.invoiceNumber} — ${reasonText}`,
      subtotalPaise: -Math.abs(inv.subtotalPaise),
      cgstPaise: -Math.abs(inv.cgstPaise),
      sgstPaise: -Math.abs(inv.sgstPaise),
      igstPaise: -Math.abs(inv.igstPaise),
      totalPaise: -Math.abs(inv.totalPaise),
      currency: inv.currency || "INR",
      hsnSac: inv.hsnSac || "998314",
      status: "issued",
      issuedAt: now,
      paidAt: now,
    };

    db.insert(controlSchema.invoices).values(cnRow).run();

    db.update(controlSchema.invoices)
      .set({ status: "credited" })
      .where(eq(controlSchema.invoices.id, inv.id))
      .run();

    if (params.refundToWallet && Math.abs(inv.subtotalPaise) > 0) {
      creditWallet({
        workspaceId: inv.workspaceId,
        amountPaise: Math.abs(inv.subtotalPaise),
        description: `Credit Note ${cnNumber} refund (${inv.invoiceNumber})`,
        idempotencyKey: `cn_refund:${cnRow.id}`,
        actorId: params.staffId || "staff_finance",
        entryType: "refund",
        createInvoice: false,
      });
    }

    return cnRow;
  });

  return raw.inTransaction ? tx() : tx.immediate();
}

export function staffUpdateInvoiceStatus(params: {
  invoiceId: string;
  status: "paid" | "void";
  paymentMethod?: string;
  paymentReference?: string;
  reason?: string;
  staffId?: string;
}) {
  const db = controlDb();
  const inv = db
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.id, params.invoiceId))
    .get();
  if (!inv) {
    throw new RslError("RSL-VAL-1001", "Invoice not found.");
  }

  // Statutory Section 34 Credit Note when reversing a GST Tax Invoice (ACT-5.2)
  if (params.status === "void" && inv.docType === "tax_invoice") {
    issueGstCreditNote({
      invoiceId: inv.id,
      reason: params.reason || params.paymentReference || "Reversed via Staff Finance Console",
      staffId: params.staffId,
    });
    return (
      db.select().from(controlSchema.invoices).where(eq(controlSchema.invoices.id, inv.id)).get() ??
      inv
    );
  }

  const now = Date.now();
  db.update(controlSchema.invoices)
    .set({
      status: params.status,
      paidAt: params.status === "paid" ? now : inv.paidAt,
    })
    .where(eq(controlSchema.invoices.id, inv.id))
    .run();

  if (params.status === "paid" && params.paymentReference?.trim()) {
    db.insert(controlSchema.payments)
      .values({
        id: newId("pay", inv.workspaceId),
        workspaceId: inv.workspaceId,
        invoiceId: inv.id,
        provider: params.paymentMethod || "bank_transfer",
        externalPaymentId: params.paymentReference.trim(),
        amountPaise: inv.totalPaise,
        currency: "INR",
        purpose: "invoice_payment",
        status: "captured",
        createdAt: now,
      })
      .run();
  }

  return inv;
}

export const INDIA_GST_STATES: Readonly<Record<string, string>> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export interface GstInvoiceDetail {
  id: string;
  invoiceNumber: string;
  docType: string;
  linkedInvoiceId: string | null;
  linkedInvoiceNumber: string | null;
  workspaceId: string;
  description: string;
  sacCode: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  status: string;
  issuedAt: number;
  paidAt: number | null;
  buyerName: string;
  buyerGstin: string | null;
  buyerStateCode: string;
  buyerStateName: string;
  supplierName: string;
  supplierGstin: string;
  supplierStateCode: string;
  supplierStateName: string;
  supplierEmail: string;
  supplierPhone: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  upiId: string;
  paymentMethod: string | null;
  paymentReference: string | null;
}

export function getInvoiceDetailById(
  invoiceId: string,
  opts?: { workspaceId?: string }
): GstInvoiceDetail | null {
  const db = controlDb();
  const inv = db
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.id, invoiceId))
    .get();

  if (!inv) return null;
  if (opts?.workspaceId && inv.workspaceId !== opts.workspaceId) {
    return null;
  }

  const biz = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, inv.workspaceId))
    .get();

  const payment = db
    .select()
    .from(controlSchema.payments)
    .where(eq(controlSchema.payments.invoiceId, inv.id))
    .orderBy(desc(controlSchema.payments.createdAt))
    .get();

  const linkedInv = inv.linkedInvoiceId
    ? db
        .select({ invoiceNumber: controlSchema.invoices.invoiceNumber })
        .from(controlSchema.invoices)
        .where(eq(controlSchema.invoices.id, inv.linkedInvoiceId))
        .get()
    : null;

  const settings = getPlatformBillingSettings();
  const supplierStateCode = getSupplierGstStateCode();
  const buyerStateCode = biz?.stateCode || supplierStateCode;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    docType: inv.docType || "tax_invoice",
    linkedInvoiceId: inv.linkedInvoiceId ?? null,
    linkedInvoiceNumber: linkedInv?.invoiceNumber ?? null,
    workspaceId: inv.workspaceId,
    description: inv.description,
    sacCode: inv.hsnSac || "998314",
    subtotalPaise: inv.subtotalPaise,
    cgstPaise: inv.cgstPaise,
    sgstPaise: inv.sgstPaise,
    igstPaise: inv.igstPaise,
    totalPaise: inv.totalPaise,
    status: inv.status,
    issuedAt: inv.issuedAt,
    paidAt: inv.paidAt,
    buyerName: biz?.name ?? inv.workspaceId,
    buyerGstin: biz?.gstin ?? null,
    buyerStateCode,
    buyerStateName: INDIA_GST_STATES[buyerStateCode] ?? `State ${buyerStateCode}`,
    supplierName: settings.payeeName,
    supplierGstin: settings.gstin,
    supplierStateCode,
    supplierStateName: INDIA_GST_STATES[supplierStateCode] ?? `State ${supplierStateCode}`,
    supplierEmail: settings.billingEmail,
    supplierPhone: settings.supportPhone,
    bankName: settings.bankName,
    accountNumber: settings.accountNumber,
    ifscCode: settings.ifscCode,
    upiId:
      settings.upiQrMode === "upi_id" && settings.upiId
        ? settings.upiId
        : formatBankAccountUpiAddress(settings.accountNumber, settings.ifscCode),
    paymentMethod: payment?.provider ?? null,
    paymentReference: payment?.externalPaymentId ?? null,
  };
}

function buildGstr1CsvFromRows(
  rows: Array<typeof controlSchema.invoices.$inferSelect>,
  bizMap: Map<string, typeof controlSchema.workspaces.$inferSelect>,
  invNumById: Map<string, string>,
  supplierStateCode: string
): string {
  const header = [
    "DocumentType",
    "InvoiceNumber",
    "InvoiceDateIST",
    "RecipientGSTIN",
    "RecipientLegalName",
    "PlaceOfSupplyCode",
    "PlaceOfSupplyState",
    "ReverseCharge",
    "InvoiceType",
    "HSN_SAC",
    "TaxRatePct",
    "TaxableValueINR",
    "IGSTAmountINR",
    "CGSTAmountINR",
    "SGSTAmountINR",
    "TotalInvoiceValueINR",
    "LinkedInvoiceNumber",
    "Status",
    "Description",
  ].join(",");

  const lines = rows.map((inv) => {
    const biz = bizMap.get(inv.workspaceId);
    const gstin = biz?.gstin?.trim() || "";
    const posCode = biz?.stateCode || supplierStateCode;
    const posState = INDIA_GST_STATES[posCode] ?? `State ${posCode}`;
    const docType = inv.docType || "tax_invoice";
    const taxRatePct = docType === "advance_receipt" ? 0 : 18;
    const invoiceType =
      docType === "credit_note"
        ? gstin
          ? "CDNR"
          : "CDNUR"
        : docType === "advance_receipt"
          ? "AT_ADVANCE"
          : gstin
            ? "B2B_REGULAR"
            : "B2C_SMALL";
    const linkedNo = inv.linkedInvoiceId ? invNumById.get(inv.linkedInvoiceId) || "" : "";

    return [
      escapeCsvCellSafe(docType),
      escapeCsvCellSafe(inv.invoiceNumber),
      escapeCsvCellSafe(formatIstDateIso(inv.issuedAt)),
      escapeCsvCellSafe(gstin),
      escapeCsvCellSafe(biz?.name ?? inv.workspaceId),
      escapeCsvCellSafe(posCode),
      escapeCsvCellSafe(posState),
      escapeCsvCellSafe("N"),
      escapeCsvCellSafe(invoiceType),
      escapeCsvCellSafe(inv.hsnSac || "998314"),
      escapeCsvCellSafe(taxRatePct),
      (inv.subtotalPaise / 100).toFixed(2),
      (inv.igstPaise / 100).toFixed(2),
      (inv.cgstPaise / 100).toFixed(2),
      (inv.sgstPaise / 100).toFixed(2),
      (inv.totalPaise / 100).toFixed(2),
      escapeCsvCellSafe(linkedNo),
      escapeCsvCellSafe(inv.status.toUpperCase()),
      escapeCsvCellSafe(inv.description),
    ].join(",");
  });

  return [header, ...lines].join("\r\n");
}

/**
 * Exports GSTR-1 / ITC-ready CSV for a single workspace with OWASP CSV formula neutralization (ACT-5.3, P2-09).
 */
export function exportWorkspaceGstInvoicesCsv(workspaceId: string): string {
  const db = controlDb();
  const rows = db
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.workspaceId, workspaceId))
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .all();

  const biz = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, workspaceId))
    .get();
  const bizMap = new Map<string, typeof controlSchema.workspaces.$inferSelect>();
  if (biz) bizMap.set(biz.id, biz);

  const invNumById = new Map(rows.map((r) => [r.id, r.invoiceNumber]));
  return buildGstr1CsvFromRows(rows, bizMap, invNumById, getSupplierGstStateCode());
}

/**
 * Exports platform-wide GSTR-1 CSV (B2B / B2CS / CDNR / Advance Receipts) with OWASP CSV formula neutralization (ACT-5.3, P2-09).
 */
export function exportPlatformGstr1Csv(filter?: {
  financialYear?: string;
  status?: string;
  q?: string;
}): string {
  const db = controlDb();
  const allRows = db
    .select()
    .from(controlSchema.invoices)
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(5000)
    .all();

  const businesses = db.select().from(controlSchema.workspaces).all();
  const bizMap = new Map(businesses.map((b) => [b.id, b]));
  const invNumById = new Map(allRows.map((r) => [r.id, r.invoiceNumber]));
  const q = filter?.q?.trim().toLowerCase() || "";

  const filtered = allRows.filter((r) => {
    if (filter?.financialYear && r.financialYear !== filter.financialYear) return false;
    if (filter?.status && filter.status !== "all" && r.status !== filter.status) return false;
    if (q) {
      const biz = bizMap.get(r.workspaceId);
      const hay = `${r.invoiceNumber} ${biz?.name ?? ""} ${biz?.gstin ?? ""} ${r.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return buildGstr1CsvFromRows(filtered, bizMap, invNumById, getSupplierGstStateCode());
}

/**
 * Returns live database-backed public bundle and modular service pricing for the unauthenticated `/` storefront (5.2).
 */
export function listPublicPricingCatalog() {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const servicesRows = db
    .select()
    .from(controlSchema.services)
    .where(eq(controlSchema.services.active, true))
    .orderBy(controlSchema.services.sortOrder)
    .all();

  const priceRows = db
    .select()
    .from(controlSchema.servicePrices)
    .where(eq(controlSchema.servicePrices.active, true))
    .all();
  const priceMap = new Map(priceRows.map((p) => [p.serviceKey, p]));

  const services = servicesRows.map((s) => {
    const p = priceMap.get(s.key);
    const monthlyAmountPaise = p?.monthlyAmountPaise ?? 0;
    const defaults = computeDefaultCycleAmountsPaise(monthlyAmountPaise);
    return {
      key: s.key,
      name: s.name,
      plainSummary: s.plainSummary,
      category: s.category,
      pricingModel: s.pricingModel,
      meteredUnit: s.meteredUnit,
      monthlyAmountPaise,
      quarterlyAmountPaise: p?.quarterlyAmountPaise ?? defaults.quarterlyPaise,
      yearlyAmountPaise: p?.yearlyAmountPaise ?? defaults.yearlyPaise,
      unitAmountPaise: p?.unitAmountPaise ?? 0,
      includedFeatures: PLAN_FEATURE_DETAILS[s.key]?.includedFeatures ?? [s.plainSummary],
    };
  });

  const svcMap = new Map(services.map((s) => [s.key, s]));

  const bundleRows = db
    .select()
    .from(controlSchema.planBundles)
    .where(
      and(
        eq(controlSchema.planBundles.active, true),
        isNull(controlSchema.planBundles.workspaceId)
      )
    )
    .orderBy(controlSchema.planBundles.sortOrder)
    .all();

  const bundles = bundleRows.map((b) => {
    let includedKeys: string[] = [];
    try {
      includedKeys = JSON.parse(b.includedKeysJson) as string[];
    } catch {
      includedKeys = [];
    }
    const includedServiceNames = includedKeys.map((k) => svcMap.get(k)?.name ?? k);
    const separateMonthlySumPaise = includedKeys.reduce(
      (sum, k) => sum + (svcMap.get(k)?.monthlyAmountPaise ?? 0),
      0
    );
    return {
      key: b.key,
      name: b.name,
      tagline: b.tagline,
      description: b.description,
      badgeLabel: b.badgeLabel,
      includedKeys,
      includedServiceNames,
      monthlyAmountPaise: b.monthlyAmountPaise,
      quarterlyAmountPaise: b.quarterlyAmountPaise,
      yearlyAmountPaise: b.yearlyAmountPaise,
      savingsMonthlyPaise: Math.max(0, separateMonthlySumPaise - b.monthlyAmountPaise),
    };
  });

  return { bundles, services };
}

/**
 * Instant self-serve activation using positive Prepaid Wallet balance (5.2 / UX-11).
 * Atomically debits subtotal + 18% GST from the customer's wallet (overdraft NOT allowed),
 * issues an official 18% GST Tax Invoice (RSL/...), and unlocks the plan or bundle immediately.
 */
export function activatePlanOrBundleFromWallet(params: {
  workspaceId: string;
  actorId: string;
  targetType: "service" | "bundle";
  targetKey: string;
  billingCycle?: BillingCycle;
}): {
  invoiceNumber: string;
  totalDebitedPaise: number;
  remainingWalletPaise: number;
  activatedName: string;
  activatedKeys: string[];
  expiresAt: number;
} {
  ensureServiceCatalogSeeded();
  const db = controlDb();
  const raw = db.$client;
  const cycle = normalizeBillingCycle(params.billingCycle);
  const cycleMeta = BILLING_CYCLE_META[cycle];

  const ws = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, params.workspaceId))
    .get();
  if (!ws) {
    throw new RslError("RSL-VAL-1001", "Workspace not found.");
  }

  let subtotalPaise = 0;
  let activatedName = "";
  let keysToActivate: string[] = [];
  let bundleKeyForRow: string | null = null;

  if (params.targetType === "bundle") {
    const bundles = listBundlesWithWorkspaceState(params.workspaceId);
    const bundle = bundles.find((b) => b.key === params.targetKey);
    if (!bundle || bundle.includedKeys.length === 0) {
      throw new RslError("RSL-VAL-1001", "Selected bundle package was not found.");
    }
    if (bundle.isFullyUnlocked && !bundle.includedKeys.some((k) => !hasActiveEntitlement(params.workspaceId, k))) {
      // Allow paid lock-in even during complimentary trial if desired, or guard only if all are paid-unlocked
      const services = listServicesWithWorkspaceState(params.workspaceId);
      const allPaid = bundle.includedKeys.every(
        (k) => services.find((s) => s.key === k)?.isPaidUnlocked
      );
      if (allPaid) {
        throw new RslError("RSL-VAL-1001", `'${bundle.name}' is already active on a paid subscription.`);
      }
    }
    subtotalPaise =
      cycle === "yearly"
        ? bundle.yearlyAmountPaise
        : cycle === "quarterly"
          ? bundle.quarterlyAmountPaise
          : bundle.monthlyAmountPaise;
    activatedName = bundle.name;
    keysToActivate = [...new Set(bundle.includedKeys)];
    bundleKeyForRow = bundle.key;
  } else {
    const services = listServicesWithWorkspaceState(params.workspaceId);
    const svc = services.find((s) => s.key === params.targetKey);
    if (!svc) {
      throw new RslError("RSL-VAL-1001", "Selected feature plan was not found.");
    }
    if (svc.isPaidUnlocked) {
      throw new RslError("RSL-VAL-1001", `'${svc.name}' is already active on a paid subscription.`);
    }
    subtotalPaise =
      cycle === "yearly"
        ? svc.yearlyAmountPaise
        : cycle === "quarterly"
          ? svc.quarterlyAmountPaise
          : svc.monthlyAmountPaise;
    activatedName = svc.name;
    keysToActivate = [...new Set([...svc.dependsOn, svc.key])];
  }

  if (subtotalPaise <= 0) {
    throw new RslError("RSL-VAL-1001", "Invalid plan subscription price.");
  }

  const taxSplit = computeGstTaxSplit({
    subtotalPaise,
    buyerStateCode: ws.stateCode,
    supplierStateCode: getSupplierGstStateCode(),
  });
  const currentWallet = getWalletBalancePaise(params.workspaceId);
  if (currentWallet < taxSplit.totalPaise) {
    throw new RslError(
      "RSL-BILL-1003",
      `Insufficient wallet balance (${formatInr(currentWallet, { showDecimals: true })}) to pay ${formatInr(taxSplit.totalPaise, { showDecimals: true })} (incl. 18% GST). Recharge your wallet first or pay via UPI QR.`
    );
  }

  const tx = raw.transaction(() => {
    const now = Date.now();
    const expiresAt = now + cycleMeta.durationDays * 86_400_000;

    const inv = createGstInvoice({
      workspaceId: params.workspaceId,
      description: `${activatedName} — ${cycleMeta.label} (Instant Prepaid Wallet Settlement)`,
      subtotalPaise,
      status: "paid",
    });

    const debited = debitWallet({
      workspaceId: params.workspaceId,
      amountPaise: inv.totalPaise,
      serviceKey: params.targetType === "service" ? params.targetKey : undefined,
      description: `${activatedName} (${cycleMeta.label}) — Tax Invoice ${inv.invoiceNumber}`,
      idempotencyKey: `wallet_plan_unlock:${inv.id}`,
      actorId: params.actorId,
      allowOverdraft: false,
    });

    const paymentId = newId("pay", params.workspaceId);
    db.insert(controlSchema.payments)
      .values({
        id: paymentId,
        workspaceId: params.workspaceId,
        invoiceId: inv.id,
        provider: "wallet",
        externalPaymentId: inv.invoiceNumber,
        amountPaise: inv.totalPaise,
        currency: "INR",
        purpose:
          params.targetType === "bundle"
            ? `bundle_activation:${params.targetKey}`
            : `plan_activation:${params.targetKey}`,
        status: "captured",
        createdAt: now,
      })
      .run();

    for (const key of keysToActivate) {
      db.insert(controlSchema.entitlements)
        .values({
          id: newId(),
          workspaceId: params.workspaceId,
          serviceKey: key,
          status: "active",
          billingCycle: cycle,
          bundleKey: bundleKeyForRow,
          activatedAt: now,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [controlSchema.entitlements.workspaceId, controlSchema.entitlements.serviceKey],
          set: {
            status: "active",
            billingCycle: cycle,
            bundleKey: bundleKeyForRow,
            activatedAt: now,
            expiresAt,
            updatedAt: now,
          },
        })
        .run();

      db.update(controlSchema.servicePlanRequests)
        .set({
          status: "activated",
          paymentId,
          invoiceId: inv.id,
          paymentMethod: "wallet",
          paymentReference: inv.invoiceNumber,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
            eq(controlSchema.servicePlanRequests.serviceKey, key),
            eq(controlSchema.servicePlanRequests.status, "pending_payment")
          )
        )
        .run();
    }

    if (bundleKeyForRow) {
      db.update(controlSchema.servicePlanRequests)
        .set({
          status: "activated",
          paymentId,
          invoiceId: inv.id,
          amountPaidPaise: subtotalPaise,
          paymentMethod: "wallet",
          paymentReference: inv.invoiceNumber,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(controlSchema.servicePlanRequests.workspaceId, params.workspaceId),
            eq(controlSchema.servicePlanRequests.bundleKey, bundleKeyForRow),
            eq(controlSchema.servicePlanRequests.status, "pending_payment")
          )
        )
        .run();
    }

    return {
      invoiceNumber: inv.invoiceNumber,
      totalDebitedPaise: inv.totalPaise,
      remainingWalletPaise: debited.balancePaise,
      activatedName,
      activatedKeys: keysToActivate,
      expiresAt,
    };
  });

  return raw.inTransaction ? tx() : tx.immediate();
}


