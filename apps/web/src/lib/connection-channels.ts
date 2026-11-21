import type { ConnectionChannelKind } from "@rsl/connections";

export type IndividualConnectionSlug =
  | "whatsapp"
  | "facebook"
  | "meta-ads"
  | "instagram"
  | "google-business"
  | "google-ads"
  | "google-drive"
  | "google-sheets"
  | "google-search-console"
  | "tally"
  | "cloudflare";

export type ServiceFamilyId = "meta" | "google" | "systems";

export interface IndividualConnectionRouteMeta {
  slug: IndividualConnectionSlug;
  family: ServiceFamilyId;
  familyLabel: string;
  subcategoryLabel: string;
  title: string;
  subtitle: string;
  channelKind?: ConnectionChannelKind;
  relatedLinks: Array<{ label: string; href: string }>;
}

export const INDIVIDUAL_CONNECTION_ROUTES: readonly IndividualConnectionRouteMeta[] = [
  {
    slug: "whatsapp",
    family: "meta",
    familyLabel: "Meta",
    subcategoryLabel: "WhatsApp",
    title: "WhatsApp Business Cloud API",
    subtitle:
      "Connect your approved WhatsApp Business number via 1-Click Facebook Sign-In for branded invoices, reminders, and shared team replies.",
    channelKind: "whatsapp_cloud",
    relatedLinks: [
      { label: "WhatsApp & Templates", href: "/whatsapp" },
      { label: "WhatsApp Team Inbox", href: "/inbox?channel=whatsapp" },
      { label: "Tally Integration", href: "/tally" },
    ],
  },
  {
    slug: "facebook",
    family: "meta",
    familyLabel: "Meta",
    subcategoryLabel: "Facebook",
    title: "Facebook Page & Lead Forms",
    subtitle:
      "Connect your Facebook Business Page to sync Lead Ads, publish updates, and route Messenger inquiries into the shared inbox.",
    channelKind: "facebook_page",
    relatedLinks: [
      { label: "Facebook Posts & Lead Ads", href: "/campaigns?platform=facebook&view=social" },
      { label: "Messenger Inbox", href: "/inbox?channel=facebook" },
      { label: "Meta Ads & Pixel Connection", href: "/connections/meta-ads" },
    ],
  },
  {
    slug: "meta-ads",
    family: "meta",
    familyLabel: "Meta",
    subcategoryLabel: "Facebook",
    title: "Meta Ads & Conversions Pixel",
    subtitle:
      "Link your Meta Ad Account and Conversions Pixel in one click for Click-to-WhatsApp ads and server-side purchase attribution.",
    channelKind: "meta_ads_pixel",
    relatedLinks: [
      { label: "Facebook & Meta Ads Studio", href: "/campaigns?platform=facebook" },
      { label: "Facebook Page Connection", href: "/connections/facebook" },
    ],
  },
  {
    slug: "instagram",
    family: "meta",
    familyLabel: "Meta",
    subcategoryLabel: "Instagram",
    title: "Instagram Business Account",
    subtitle:
      "Connect your Instagram Professional account to reply to Instagram DMs in the shared inbox and schedule Reels or Feed posts.",
    channelKind: "instagram_business",
    relatedLinks: [
      { label: "Instagram Posts & Reels", href: "/campaigns?platform=instagram" },
      { label: "Instagram DMs Inbox", href: "/inbox?channel=instagram" },
    ],
  },
  {
    slug: "google-business",
    family: "google",
    familyLabel: "Google",
    subcategoryLabel: "Business Profile",
    title: "Google Business Profile",
    subtitle:
      "Connect store locations via Google Sign-In to monitor Google Maps reviews and publish verified owner responses.",
    channelKind: "google_business",
    relatedLinks: [{ label: "Google Reviews & Replies", href: "/reviews" }],
  },
  {
    slug: "google-ads",
    family: "google",
    familyLabel: "Google",
    subcategoryLabel: "Google Ads & Search",
    title: "Google Ads Account",
    subtitle:
      "Sign in with Google to link your Google Ads Customer ID for Search and Performance Max campaign reporting.",
    channelKind: "google_ads",
    relatedLinks: [
      { label: "Google Ads Studio", href: "/campaigns?platform=google" },
      { label: "Search Console Connection", href: "/connections/google-search-console" },
    ],
  },
  {
    slug: "google-search-console",
    family: "google",
    familyLabel: "Google",
    subcategoryLabel: "Google Ads & Search",
    title: "Google Search Console",
    subtitle:
      "Connect your verified website property to monitor organic search clicks, impressions, and top ranking queries.",
    channelKind: "google_search_console",
    relatedLinks: [
      { label: "Search Insights & Campaigns", href: "/campaigns?platform=google&view=seo" },
      { label: "Google Ads Connection", href: "/connections/google-ads" },
    ],
  },
  {
    slug: "google-drive",
    family: "google",
    familyLabel: "Google",
    subcategoryLabel: "Drive & Sheets",
    title: "Google Drive Encrypted Backups",
    subtitle:
      "Save automatic encrypted .rslbackup workspace snapshots inside a dedicated folder in your own Google Drive.",
    channelKind: "google_drive",
    relatedLinks: [
      { label: "Backups & Storage", href: "/backups" },
      { label: "Google Sheets Connection", href: "/connections/google-sheets" },
    ],
  },
  {
    slug: "google-sheets",
    family: "google",
    familyLabel: "Google",
    subcategoryLabel: "Drive & Sheets",
    title: "Google Sheets (CA Live Sync)",
    subtitle:
      "Publish a 4-tab Sales, Purchase, Receipt, and Party Ageing workbook inside your own Google Drive for your Chartered Accountant.",
    channelKind: "google_sheets",
    relatedLinks: [
      { label: "Tally Bills & CA Sync", href: "/tally" },
      { label: "Google Drive Connection", href: "/connections/google-drive" },
    ],
  },
  {
    slug: "tally",
    family: "systems",
    familyLabel: "Systems & Storage",
    subcategoryLabel: "Tally Integration",
    title: "Tally Prime Desktop Connector",
    subtitle:
      "Pair your office Windows PC running Tally Prime to sync GST bills, receipts, party ledgers, and exact printed PDFs automatically.",
    relatedLinks: [
      { label: "Tally Bills & Live Sync", href: "/tally" },
      { label: "Client & Party Ledgers", href: "/tally/parties" },
      { label: "Stock & Inventory", href: "/inventory" },
      { label: "Webhook & API Tokens", href: "/settings/tokens" },
    ],
  },
  {
    slug: "cloudflare",
    family: "systems",
    familyLabel: "Systems & Storage",
    subcategoryLabel: "Cloudflare R2 & AI",
    title: "Cloudflare R2, Workers AI & Compute",
    subtitle:
      "Connect your own Cloudflare account in 1 click for private R2 document storage and Workers AI inference while Turnstile bot protection stays managed on RapidShift Labs.",
    relatedLinks: [
      { label: "Backups & Cloud Storage", href: "/backups" },
      { label: "API Keys & Webhooks", href: "/settings/tokens" },
    ],
  },
];

const SLUG_ALIASES: Record<string, IndividualConnectionSlug> = {
  whatsapp: "whatsapp",
  whatsapp_cloud: "whatsapp",
  facebook: "facebook",
  facebook_page: "facebook",
  "meta-ads": "meta-ads",
  meta_ads_pixel: "meta-ads",
  instagram: "instagram",
  instagram_business: "instagram",
  "google-business": "google-business",
  google_business: "google-business",
  "google-ads": "google-ads",
  google_ads: "google-ads",
  "google-drive": "google-drive",
  google_drive: "google-drive",
  "google-sheets": "google-sheets",
  google_sheets: "google-sheets",
  "google-search-console": "google-search-console",
  google_search_console: "google-search-console",
  tally: "tally",
  cloudflare: "cloudflare",
};

export function resolveConnectionRouteMeta(
  rawSlug: string
): IndividualConnectionRouteMeta | null {
  const normalized = SLUG_ALIASES[(rawSlug || "").trim().toLowerCase()];
  if (!normalized) return null;
  return INDIVIDUAL_CONNECTION_ROUTES.find((r) => r.slug === normalized) ?? null;
}

export function getConnectionPageHrefByKind(kind: ConnectionChannelKind): string {
  const match = INDIVIDUAL_CONNECTION_ROUTES.find((r) => r.channelKind === kind);
  return match ? `/connections/${match.slug}` : `/connections?tab=${encodeURIComponent(kind)}`;
}
