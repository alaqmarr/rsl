"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BrandLogo,
  GuideDrawer,
  IosSpinner,
  useDialogFocusTrap,
} from "@rsl/ui";
import { useWorkspaceAccess } from "@/components/workspace-access-context";
import { setWebLocaleAction } from "@/lib/actions";
import { resolveWebPageGuide } from "@/lib/page-guides";
import type { WebLocale } from "@/lib/session";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  Command,
  FileSpreadsheet,
  HelpCircle,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Menu,
  Package,
  Plug,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  UploadCloud,
  UserCircle2,
  UserMinus,
  Users,
  Wallet,
  Webhook,
  X,
} from "lucide-react";
import {
  CloudflareBrandIcon,
  FacebookBrandIcon,
  GoogleAdsBrandIcon,
  GoogleBrandIcon,
  GoogleBusinessBrandIcon,
  GoogleDriveBrandIcon,
  GoogleSearchConsoleBrandIcon,
  GoogleSheetsBrandIcon,
  InstagramBrandIcon,
  MessengerBrandIcon,
  MetaBrandIcon,
  TallyBrandIcon,
  WhatsAppBrandIcon,
} from "@/components/service-brand-icons";

export interface NavItemDef {
  href: string;
  label: string;
  labelHi: string;
  badge?: string | number;
  keywords: string;
  helpTitle: string;
  helpSummary: string;
  helpSteps: string[];
  guideSlug: string;
}

export interface NavBranchDef {
  id: string;
  label: string;
  labelHi: string;
  defaultOpen?: boolean;
  iconKey?: string;
  items?: NavItemDef[];
  branches?: NavBranchDef[];
}

export interface NavSectionDef {
  id: string;
  heading: string;
  headingHi: string;
  items?: NavItemDef[];
  branches?: NavBranchDef[];
}

interface RawNavSeed {
  href: string;
  label: string;
  labelHi: string;
  keywords: string;
  fallbackGuideSlug: string;
}

function hydrateNavItem(seed: RawNavSeed): NavItemDef {
  const basePath = seed.href.split("?")[0] || seed.href;
  const guide = resolveWebPageGuide(basePath);
  return {
    href: seed.href,
    label: seed.label,
    labelHi: seed.labelHi,
    keywords: seed.keywords,
    helpTitle: guide?.title || seed.label,
    helpSummary:
      guide?.summary ||
      "Step-by-step workspace controls, audit logs, and live status for your firm.",
    helpSteps:
      guide && guide.steps.length > 0
        ? guide.steps.map((s) => `${s.title} - ${s.detail}`)
        : ["Open Guides & Help (/help) for step-by-step setup instructions."],
    guideSlug: guide?.guideSlug || seed.fallbackGuideSlug,
  };
}

export const WORKSPACE_NAV_SECTIONS: NavSectionDef[] = [
  {
    id: "workspace",
    heading: "Workspace",
    headingHi: "कार्यक्षेत्र",
    items: [
      hydrateNavItem({
        href: "/",
        label: "Business Overview",
        labelHi: "व्यापार सारांश",
        keywords: "home summary dashboard cashflow receivables",
        fallbackGuideSlug: "getting-started",
      }),
      hydrateNavItem({
        href: "/analytics",
        label: "Detailed Analytics",
        labelHi: "विस्तृत रिपोर्ट",
        keywords: "charts roi roas funnel aging reports csv",
        fallbackGuideSlug: "analytics-cashflow-and-aging-reports",
      }),
    ],
  },
  {
    id: "meta",
    heading: "Meta Services",
    headingHi: "मेटा सेवाएं",
    branches: [
      {
        id: "meta-whatsapp",
        label: "WhatsApp",
        labelHi: "व्हाट्सऐप",
        defaultOpen: true,
        iconKey: "whatsapp",
        items: [
          hydrateNavItem({
            href: "/whatsapp",
            label: "WhatsApp & Templates",
            labelHi: "व्हाट्सऐप और टेम्पलेट",
            keywords:
              "whatsapp templates manager header buttons variables bulk broadcast opt-in stop",
            fallbackGuideSlug: "whatsapp-and-broadcasts",
          }),
          hydrateNavItem({
            href: "/whatsapp/broadcasts",
            label: "Broadcast Campaigns",
            labelHi: "ब्रॉडकास्ट अभियान",
            keywords: "whatsapp bulk broadcast campaigns send",
            fallbackGuideSlug: "whatsapp-and-broadcasts",
          }),
          hydrateNavItem({
            href: "/whatsapp/contacts",
            label: "Opt-Outs & Contacts",
            labelHi: "ऑप्ट-आउट और संपर्क",
            keywords: "whatsapp stop suppression opt out contacts",
            fallbackGuideSlug: "whatsapp-and-broadcasts",
          }),
          hydrateNavItem({
            href: "/inbox?channel=whatsapp",
            label: "Team Inbox",
            labelHi: "टीम इनबॉक्स",
            keywords: "whatsapp team inbox chat customer support desk replies sla",
            fallbackGuideSlug: "shared-inbox-and-customer-messages",
          }),
          hydrateNavItem({
            href: "/connections/whatsapp",
            label: "WhatsApp Connection",
            labelHi: "व्हाट्सऐप कनेक्शन",
            keywords: "connect whatsapp number waba embedded signup oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
        branches: [
          {
            id: "meta-whatsapp-tally",
            label: "Tally Integration",
            labelHi: "टैली एकीकरण",
            defaultOpen: true,
            iconKey: "tally",
            items: [
              hydrateNavItem({
                href: "/tally",
                label: "Bills & Live Sync",
                labelHi: "बिल और लाइव सिंक",
                keywords:
                  "tally xml csv tdl webhook automation invoices vouchers receipts payments paid overdue reminders pdf",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
              hydrateNavItem({
                href: "/tally/automation",
                label: "Auto-Send & Reminders",
                labelHi: "ऑटो-सेंड और रिमाइंडर",
                keywords: "tally automation overdue reminder schedule ca sheet",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
              hydrateNavItem({
                href: "/tally/import",
                label: "XML / Manual Import",
                labelHi: "XML / मैनुअल इम्पोर्ट",
                keywords: "tally xml csv import manual bill entry",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
              hydrateNavItem({
                href: "/tally/parties",
                label: "Party Ledgers",
                labelHi: "पार्टी खाता बही",
                keywords:
                  "clients parties customers suppliers debtors creditors ledgers statement ageing credit limit paid",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
              hydrateNavItem({
                href: "/inventory",
                label: "Stock & Inventory",
                labelHi: "स्टॉक और गोदाम",
                keywords: "inventory stock items godowns warehouse batches expiry reorder valuation",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
              hydrateNavItem({
                href: "/connections/tally",
                label: "Tally Connection",
                labelHi: "टैली कनेक्शन",
                keywords: "tally pc connector tdl download pairing code ssl setup",
                fallbackGuideSlug: "tally-sync-and-import",
              }),
            ],
          },
        ],
      },
      {
        id: "meta-facebook",
        label: "Facebook",
        labelHi: "फेसबुक",
        iconKey: "facebook",
        items: [
          hydrateNavItem({
            href: "/meta/facebook/ads",
            label: "Facebook Ads",
            labelHi: "फेसबुक विज्ञापन",
            keywords: "facebook meta ads roas spend lead ads",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/meta/facebook/posts",
            label: "Page Posts & Leads",
            labelHi: "पेज पोस्ट और लीड्स",
            keywords: "facebook page posts schedule lead forms",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/meta/facebook/pixel",
            label: "Pixel & CAPI",
            labelHi: "पिक्सेल और CAPI",
            keywords: "meta pixel capi server conversions purchase events",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/inbox?channel=facebook",
            label: "Messenger Inbox",
            labelHi: "मैसेंजर इनबॉक्स",
            keywords: "facebook messenger chat inbox replies",
            fallbackGuideSlug: "shared-inbox-and-customer-messages",
          }),
          hydrateNavItem({
            href: "/connections/facebook",
            label: "Facebook Page Connection",
            labelHi: "फेसबुक पेज कनेक्शन",
            keywords: "connect facebook page oauth asset switch",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
          hydrateNavItem({
            href: "/connections/meta-ads",
            label: "Meta Ads & Pixel Connection",
            labelHi: "मेटा विज्ञापन कनेक्शन",
            keywords: "connect meta ad account pixel capi oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
      },
      {
        id: "meta-instagram",
        label: "Instagram",
        labelHi: "इंस्टाग्राम",
        iconKey: "instagram",
        items: [
          hydrateNavItem({
            href: "/meta/instagram/posts",
            label: "Posts & Reels",
            labelHi: "पोस्ट और रील्स",
            keywords: "instagram reels posts schedule social",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/meta/instagram/ads",
            label: "Instagram Ads",
            labelHi: "इंस्टाग्राम विज्ञापन",
            keywords: "instagram reels feed ads meta campaigns roas",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/inbox?channel=instagram",
            label: "Instagram DMs",
            labelHi: "इंस्टाग्राम डीएम",
            keywords: "instagram direct messages dm inbox replies",
            fallbackGuideSlug: "shared-inbox-and-customer-messages",
          }),
          hydrateNavItem({
            href: "/connections/instagram",
            label: "Instagram Connection",
            labelHi: "इंस्टाग्राम कनेक्शन",
            keywords: "connect instagram business account oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
      },
    ],
  },
  {
    id: "google",
    heading: "Google Services",
    headingHi: "गूगल सेवाएं",
    branches: [
      {
        id: "google-gbp",
        label: "Google Business Profile",
        labelHi: "गूगल बिज़नेस प्रोफ़ाइल",
        iconKey: "reviews",
        items: [
          hydrateNavItem({
            href: "/reviews",
            label: "Reviews & Replies",
            labelHi: "रिव्यू और जवाब",
            keywords: "google business profile stars ratings maps replies",
            fallbackGuideSlug: "google-reviews-and-smart-replies",
          }),
          hydrateNavItem({
            href: "/reviews/automation",
            label: "Rating Stats & Auto-Reply",
            labelHi: "रेटिंग और ऑटो-जवाब",
            keywords: "google reviews ratings breakdown manual entry auto reply",
            fallbackGuideSlug: "google-reviews-and-smart-replies",
          }),
          hydrateNavItem({
            href: "/connections/google-business",
            label: "GBP Connection",
            labelHi: "जीबीपी कनेक्शन",
            keywords: "connect google business profile location oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
      },
      {
        id: "google-ads",
        label: "Google Ads & Search",
        labelHi: "गूगल विज्ञापन और सर्च",
        iconKey: "google-ads",
        items: [
          hydrateNavItem({
            href: "/google/ads",
            label: "Google Ads",
            labelHi: "गूगल विज्ञापन",
            keywords: "google ads search pmax performance max call ads roas",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/google/search",
            label: "Search Console & SEO",
            labelHi: "सर्च कंसोल और एसईओ",
            keywords: "google search console organic keywords rankings seo",
            fallbackGuideSlug: "ads-social-posts-and-website-conversions",
          }),
          hydrateNavItem({
            href: "/connections/google-ads",
            label: "Google Ads Connection",
            labelHi: "गूगल विज्ञापन कनेक्शन",
            keywords: "connect google ads customer id oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
          hydrateNavItem({
            href: "/connections/google-search-console",
            label: "Search Console Connection",
            labelHi: "सर्च कंसोल कनेक्शन",
            keywords: "connect google search console site property oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
      },
      {
        id: "google-drive-sheets",
        label: "Drive & Sheets",
        labelHi: "ड्राइव और शीट्स",
        iconKey: "drive",
        items: [
          hydrateNavItem({
            href: "/backups",
            label: "Backups & Restore",
            labelHi: "बैकअप और निर्यात",
            keywords: "cloud storage backup restore export import google drive",
            fallbackGuideSlug: "storage-r2-and-backups",
          }),
          hydrateNavItem({
            href: "/backups/exports",
            label: "Exports & CSV Imports",
            labelHi: "निर्यात और CSV इम्पोर्ट",
            keywords: "export json csv xml import contacts stored files quota",
            fallbackGuideSlug: "storage-r2-and-backups",
          }),
          hydrateNavItem({
            href: "/connections/google-drive",
            label: "Google Drive Connection",
            labelHi: "गूगल ड्राइव कनेक्शन",
            keywords: "connect google drive backup folder oauth",
            fallbackGuideSlug: "storage-r2-and-backups",
          }),
          hydrateNavItem({
            href: "/connections/google-sheets",
            label: "Google Sheets (CA Sync)",
            labelHi: "गूगल शीट्स (सीए सिंक)",
            keywords: "connect google sheets ca live sync oauth",
            fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
          }),
        ],
      },
    ],
  },
  {
    id: "systems",
    heading: "Connections & Systems",
    headingHi: "कनेक्शन और सिस्टम",
    items: [
      hydrateNavItem({
        href: "/connections",
        label: "All Connections",
        labelHi: "सभी कनेक्शन",
        keywords: "connections hub meta google tally cloudflare overview",
        fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
      }),
      hydrateNavItem({
        href: "/connections/cloudflare",
        label: "Cloudflare R2 & AI",
        labelHi: "क्लाउडफ्लेयर R2 और AI",
        keywords: "cloudflare r2 workers ai one click storage compute",
        fallbackGuideSlug: "storage-r2-and-backups",
      }),
      hydrateNavItem({
        href: "/settings/tokens",
        label: "Webhooks & Subdomains",
        labelHi: "एपीआई कुंजी और वेबहुक",
        keywords:
          "api tokens keys bearer tally webhook verify whatsapp meta instagram secret rotate",
        fallbackGuideSlug: "developer-api",
      }),
      hydrateNavItem({
        href: "/settings/api-keys",
        label: "REST API Keys",
        labelHi: "REST API कुंजी",
        keywords: "rest api keys bearer rsl_live_ sandbox developer tokens",
        fallbackGuideSlug: "developer-api",
      }),
    ],
  },
  {
    id: "workspace-admin",
    heading: "Team, Billing & Health",
    headingHi: "टीम, बिलिंग और स्वास्थ्य",
    items: [
      hydrateNavItem({
        href: "/settings/team",
        label: "Team & Roles",
        labelHi: "टीम और भूमिकाएँ",
        keywords: "team members invite roles permissions 5 users staff colleague",
        fallbackGuideSlug: "team-roles-security-and-business-settings",
      }),
      hydrateNavItem({
        href: "/billing",
        label: "Plans & Bundles",
        labelHi: "प्लान और वॉलेट",
        keywords: "wallet recharge utr upi gst invoice plans services rupees overdraft negative",
        fallbackGuideSlug: "plans-wallet-and-gst",
      }),
      hydrateNavItem({
        href: "/billing/wallet",
        label: "Prepaid Wallet & UPI",
        labelHi: "प्रीपेड वॉलेट और UPI",
        keywords: "wallet recharge utr upi razorpay ad vault overdraft",
        fallbackGuideSlug: "plans-wallet-and-gst",
      }),
      hydrateNavItem({
        href: "/billing/invoices",
        label: "GST Tax Invoices",
        labelHi: "जीएसटी टैक्स चालान",
        keywords: "gst invoices credit notes gstr1 pdf download",
        fallbackGuideSlug: "plans-wallet-and-gst",
      }),
      hydrateNavItem({
        href: "/activity",
        label: "Activity History",
        labelHi: "गतिविधि इतिहास",
        keywords: "audit logs history team actions security",
        fallbackGuideSlug: "getting-started",
      }),
      hydrateNavItem({
        href: "/status",
        label: "Workspace Health",
        labelHi: "सिस्टम स्थिति",
        keywords: "health status queue uptime ssl",
        fallbackGuideSlug: "getting-started",
      }),
      hydrateNavItem({
        href: "/help",
        label: "Guides & Help",
        labelHi: "गाइड और सहायता",
        keywords: "docs documentation help search troubleshooting",
        fallbackGuideSlug: "getting-started",
      }),
    ],
  },
];

function collectBranchItems(branch: NavBranchDef): NavItemDef[] {
  const direct = branch.items ?? [];
  const nested = (branch.branches ?? []).flatMap(collectBranchItems);
  return [...direct, ...nested];
}

function collectSectionItems(sec: NavSectionDef): NavItemDef[] {
  const direct = sec.items ?? [];
  const branched = (sec.branches ?? []).flatMap(collectBranchItems);
  return [...direct, ...branched];
}

function getBranchIconSpec(iconKey?: string): {
  Icon: React.ComponentType<{ className?: string }>;
  tintClass: string;
} {
  switch (iconKey) {
    case "whatsapp":
      return { Icon: WhatsAppBrandIcon, tintClass: "text-emerald-600 dark:text-emerald-400" };
    case "tally":
      return { Icon: TallyBrandIcon, tintClass: "text-sky-600 dark:text-sky-400" };
    case "facebook":
      return { Icon: FacebookBrandIcon, tintClass: "text-blue-600 dark:text-blue-400" };
    case "instagram":
      return { Icon: InstagramBrandIcon, tintClass: "text-rose-600 dark:text-rose-400" };
    case "reviews":
      return {
        Icon: GoogleBusinessBrandIcon,
        tintClass: "text-emerald-600 dark:text-emerald-400",
      };
    case "google-ads":
      return { Icon: GoogleAdsBrandIcon, tintClass: "text-amber-600 dark:text-amber-400" };
    case "drive":
      return { Icon: GoogleDriveBrandIcon, tintClass: "text-sky-600 dark:text-sky-400" };
    case "connection":
      return { Icon: Link2, tintClass: "text-indigo-600 dark:text-indigo-400" };
    default:
      return { Icon: GoogleBrandIcon, tintClass: "text-emerald-600 dark:text-emerald-400" };
  }
}

const DOCK_ONLY_WORKSPACE_ITEMS: NavItemDef[] = [
  hydrateNavItem({
    href: "/settings/business",
    label: "Business Settings",
    labelHi: "व्यापार सेटिंग्स",
    keywords:
      "business gstin state address tally company billing email phone workspace switch ssl subdomain confidentiality",
    fallbackGuideSlug: "team-roles-security-and-business-settings",
  }),
  hydrateNavItem({
    href: "/settings/profile",
    label: "My Profile",
    labelHi: "मेरी प्रोफ़ाइल",
    keywords: "profile password email verification sessions devices mobile job title",
    fallbackGuideSlug: "team-roles-security-and-business-settings",
  }),
];

const ICON_BY_HREF: Record<string, React.ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard,
  "/analytics": BarChart3,
  "/inbox": Inbox,
  "/inbox?channel=whatsapp": WhatsAppBrandIcon,
  "/inbox?channel=facebook": MessengerBrandIcon,
  "/inbox?channel=instagram": InstagramBrandIcon,
  "/tally": TallyBrandIcon,
  "/tally/parties": Users,
  "/inventory": Package,
  "/whatsapp": WhatsAppBrandIcon,
  "/whatsapp/broadcasts": Send,
  "/whatsapp/contacts": UserMinus,
  "/tally/automation": Sparkles,
  "/tally/import": UploadCloud,
  "/meta/facebook/ads": MetaBrandIcon,
  "/meta/facebook/posts": FacebookBrandIcon,
  "/meta/facebook/pixel": TrendingUp,
  "/meta/instagram/posts": InstagramBrandIcon,
  "/meta/instagram/ads": MetaBrandIcon,
  "/google/ads": GoogleAdsBrandIcon,
  "/google/search": GoogleSearchConsoleBrandIcon,
  "/reviews/automation": Star,
  "/backups/exports": FileSpreadsheet,
  "/settings/api-keys": KeyRound,
  "/billing/wallet": Wallet,
  "/billing/invoices": ReceiptText,
  "/campaigns": MetaBrandIcon,
  "/campaigns?platform=facebook": MetaBrandIcon,
  "/campaigns?platform=facebook&view=social": FacebookBrandIcon,
  "/campaigns?platform=instagram": InstagramBrandIcon,
  "/campaigns?platform=google": GoogleAdsBrandIcon,
  "/reviews": Star,
  "/settings/profile": UserCircle2,
  "/settings/business": Building2,
  "/settings/team": Users,
  "/connections": Link2,
  "/connections/whatsapp": WhatsAppBrandIcon,
  "/connections/facebook": FacebookBrandIcon,
  "/connections/meta-ads": MetaBrandIcon,
  "/connections/instagram": InstagramBrandIcon,
  "/connections/google-business": GoogleBusinessBrandIcon,
  "/connections/google-ads": GoogleAdsBrandIcon,
  "/connections/google-search-console": GoogleSearchConsoleBrandIcon,
  "/connections/google-drive": GoogleDriveBrandIcon,
  "/connections/google-sheets": GoogleSheetsBrandIcon,
  "/connections/cloudflare": CloudflareBrandIcon,
  "/connections/tally": TallyBrandIcon,
  "/settings/tokens": Webhook,
  "/developers": KeyRound,
  "/billing": Wallet,
  "/backups": GoogleDriveBrandIcon,
  "/activity": ShieldCheck,
  "/status": Activity,
  "/help": BookOpen,
};

const ICON_TINT_BY_HREF: Record<string, string> = {
  "/whatsapp": "text-emerald-600 dark:text-emerald-400",
  "/whatsapp/broadcasts": "text-emerald-600 dark:text-emerald-400",
  "/whatsapp/contacts": "text-emerald-600 dark:text-emerald-400",
  "/tally/automation": "text-sky-600 dark:text-sky-400",
  "/tally/import": "text-sky-600 dark:text-sky-400",
  "/meta/facebook/ads": "text-blue-600 dark:text-blue-400",
  "/meta/facebook/posts": "text-blue-600 dark:text-blue-400",
  "/meta/facebook/pixel": "text-indigo-600 dark:text-indigo-400",
  "/meta/instagram/posts": "text-rose-600 dark:text-rose-400",
  "/meta/instagram/ads": "text-rose-600 dark:text-rose-400",
  "/google/ads": "text-amber-600 dark:text-amber-400",
  "/google/search": "text-indigo-600 dark:text-indigo-400",
  "/reviews/automation": "text-amber-600 dark:text-amber-400",
  "/backups/exports": "text-sky-600 dark:text-sky-400",
  "/inbox?channel=whatsapp": "text-emerald-600 dark:text-emerald-400",
  "/connections/whatsapp": "text-emerald-600 dark:text-emerald-400",
  "/campaigns?platform=facebook": "text-blue-600 dark:text-blue-400",
  "/campaigns?platform=facebook&view=social": "text-blue-600 dark:text-blue-400",
  "/inbox?channel=facebook": "text-sky-600 dark:text-sky-400",
  "/connections/facebook": "text-blue-600 dark:text-blue-400",
  "/connections/meta-ads": "text-indigo-600 dark:text-indigo-400",
  "/campaigns?platform=instagram": "text-rose-600 dark:text-rose-400",
  "/inbox?channel=instagram": "text-rose-600 dark:text-rose-400",
  "/connections/instagram": "text-rose-600 dark:text-rose-400",
  "/reviews": "text-amber-600 dark:text-amber-400",
  "/connections/google-business": "text-emerald-600 dark:text-emerald-400",
  "/campaigns?platform=google": "text-amber-600 dark:text-amber-400",
  "/connections/google-ads": "text-amber-600 dark:text-amber-400",
  "/connections/google-search-console": "text-indigo-600 dark:text-indigo-400",
  "/backups": "text-sky-600 dark:text-sky-400",
  "/connections/google-drive": "text-sky-600 dark:text-sky-400",
  "/connections/google-sheets": "text-emerald-600 dark:text-emerald-400",
  "/connections/cloudflare": "text-amber-600 dark:text-amber-400",
  "/connections/tally": "text-sky-600 dark:text-sky-400",
  "/tally": "text-sky-600 dark:text-sky-400",
};

function resolveIconForHref(href: string): React.ComponentType<{ className?: string }> {
  if (ICON_BY_HREF[href]) return ICON_BY_HREF[href]!;
  const basePath = href.split("?")[0] || href;
  if (ICON_BY_HREF[basePath]) return ICON_BY_HREF[basePath]!;
  if (basePath.startsWith("/connections/")) return Plug;
  return LayoutDashboard;
}

function resolveIconTintForHref(href: string): string | undefined {
  if (ICON_TINT_BY_HREF[href]) return ICON_TINT_BY_HREF[href];
  const basePath = href.split("?")[0] || href;
  return ICON_TINT_BY_HREF[basePath];
}

function isItemActiveForPathname(
  itemHref: string,
  pathname: string,
  currentSearch = ""
): boolean {
  const [rawTargetPath, rawTargetQuery] = itemHref.split("?");
  const targetPath = rawTargetPath || "/";

  if (targetPath === "/") return pathname === "/";

  if (targetPath === "/connections" && !rawTargetQuery) {
    return pathname === "/connections";
  }

  if (targetPath === "/tally") {
    const matchesTallyPath = pathname === "/tally" || pathname.startsWith("/tally/vouchers/");
    if (!matchesTallyPath) return false;
  } else {
    const matchesPath = pathname === targetPath || pathname.startsWith(`${targetPath}/`) ||
      (targetPath === "/settings/tokens" &&
        (pathname === "/developers" || pathname.startsWith("/developers/")));
    if (!matchesPath) return false;
  }

  if (!rawTargetQuery) return true;

  const targetParams = new URLSearchParams(rawTargetQuery);
  const currentParams = new URLSearchParams(currentSearch);

  if (targetPath === "/inbox") {
    const targetChannel = targetParams.get("channel") || "whatsapp";
    const curChannel = currentParams.get("channel") || "";
    if (!curChannel || curChannel === "all") {
      return targetChannel === "whatsapp";
    }
    return curChannel === targetChannel;
  }

  if (targetPath === "/campaigns") {
    const targetPlatform = targetParams.get("platform");
    const targetView = targetParams.get("view");
    const curPlatform = currentParams.get("platform") || "";
    const curView = currentParams.get("view") || "";
    if (!curPlatform && targetPlatform === "facebook" && !targetView) {
      return true;
    }
    if (curPlatform !== targetPlatform) return false;
    if (targetView) return curView === targetView;
    return !curView || curView === "ads";
  }

  for (const [k, v] of targetParams.entries()) {
    if (currentParams.get(k) !== v) return false;
  }
  return true;
}

function filterVisibleBranch(
  branch: NavBranchDef,
  canAccessRoute: (href: string) => boolean
): NavBranchDef | null {
  const visibleItems = (branch.items ?? []).filter((item) =>
    canAccessRoute(item.href.split("?")[0] || item.href)
  );
  const visibleSubBranches = (branch.branches ?? [])
    .map((b) => filterVisibleBranch(b, canAccessRoute))
    .filter((b): b is NavBranchDef => Boolean(b));

  if (visibleItems.length === 0 && visibleSubBranches.length === 0) {
    return null;
  }
  return {
    ...branch,
    items: visibleItems,
    branches: visibleSubBranches,
  };
}

function branchContainsActiveRoute(
  branch: NavBranchDef,
  pathname: string,
  currentSearch: string
): boolean {
  if ((branch.items ?? []).some((i) => isItemActiveForPathname(i.href, pathname, currentSearch))) {
    return true;
  }
  return (branch.branches ?? []).some((sub) =>
    branchContainsActiveRoute(sub, pathname, currentSearch)
  );
}

function collectInitiallyExpandedIds(
  sections: NavSectionDef[],
  pathname: string,
  currentSearch: string
): Set<string> {
  const open = new Set<string>();
  const walk = (b: NavBranchDef) => {
    const activeInside = branchContainsActiveRoute(b, pathname, currentSearch);
    if (activeInside || (b.defaultOpen && (pathname === "/" || pathname === "/whatsapp"))) {
      open.add(b.id);
    }
    for (const sub of b.branches ?? []) {
      walk(sub);
    }
  };
  for (const sec of sections) {
    for (const b of sec.branches ?? []) {
      walk(b);
    }
  }
  return open;
}

export function SidebarNavLinks({
  onNavigate,
  locale = "en",
}: {
  onNavigate?: () => void;
  locale?: WebLocale;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { canAccessRoute } = useWorkspaceAccess();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [currentSearch, setCurrentSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    collectInitiallyExpandedIds(WORKSPACE_NAV_SECTIONS, pathname, "")
  );

  useEffect(() => {
    const syncSearch = () => {
      if (typeof window === "undefined") return;
      const nextSearch = window.location.search.replace(/^\?/, "");
      setCurrentSearch(nextSearch);
      const requiredOpen = collectInitiallyExpandedIds(
        WORKSPACE_NAV_SECTIONS,
        window.location.pathname || "/",
        nextSearch
      );
      if (requiredOpen.size > 0) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          requiredOpen.forEach((id) => next.add(id));
          return next;
        });
      }
    };
    syncSearch();
    window.addEventListener("popstate", syncSearch);
    return () => window.removeEventListener("popstate", syncSearch);
  }, [pathname]);

  const visibleSections = useMemo(
    () =>
      WORKSPACE_NAV_SECTIONS.map((sec) => {
        const items = (sec.items ?? []).filter((item) =>
          canAccessRoute(item.href.split("?")[0] || item.href)
        );
        const branches = (sec.branches ?? [])
          .map((b) => filterVisibleBranch(b, canAccessRoute))
          .filter((b): b is NavBranchDef => Boolean(b));
        return {
          id: sec.id,
          heading: locale === "hi" ? sec.headingHi : sec.heading,
          items,
          branches,
        };
      }).filter((sec) => sec.items.length > 0 || sec.branches.length > 0),
    [canAccessRoute, locale]
  );

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
    }
  }, [isPending, pathname, currentSearch]);

  const toggleBranch = (branchId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) {
        next.delete(branchId);
      } else {
        next.add(branchId);
      }
      return next;
    });
  };

  const renderNavLink = (item: NavItemDef, depth = 0) => {
    const Icon = resolveIconForHref(item.href);
    const customTint = resolveIconTintForHref(item.href);
    const isActive = isItemActiveForPathname(item.href, pathname, currentSearch);
    const isItemLoading = isPending && pendingHref === item.href;
    const displayLabel = locale === "hi" ? item.labelHi : item.label;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
              onNavigate?.();
              return;
            }
            e.preventDefault();
            onNavigate?.();
            const targetSearch = item.href.includes("?") ? item.href.split("?")[1] || "" : "";
            const targetPath = item.href.split("?")[0] || "/";
            if (isActive && pathname === targetPath && currentSearch === targetSearch) return;
            setPendingHref(item.href);
            setCurrentSearch(targetSearch);
            startTransition(() => {
              router.push(item.href);
            });
          }}
          className={`rsl-nav-item group flex w-full items-center justify-between gap-2 rounded-xl px-2.5 ${
            depth > 0 ? "py-1.5 text-[12.5px]" : "py-2 text-[13px]"
          } transition-all ${
            isActive
              ? "rsl-nav-item-active font-semibold shadow-xs"
              : isItemLoading
                ? "rsl-nav-item-sunset font-semibold"
                : "font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            <Icon
              className={`${depth > 0 ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 transition-colors ${
                isActive || isItemLoading
                  ? "text-[var(--sunset-orange)]"
                  : customTint || "text-[var(--ink-muted)] group-hover:text-[var(--ink-strong)]"
              }`}
            />
            <span className="truncate">{displayLabel}</span>
          </span>
          {isItemLoading ? (
            <IosSpinner size="xs" className="text-[var(--sunset-orange)]" />
          ) : isActive ? (
            <span className="rsl-nav-dot h-2 w-2 shrink-0 rounded-full bg-[var(--sunset-orange)]" />
          ) : null}
        </Link>
      </li>
    );
  };

  const renderBranch = (branch: NavBranchDef, depth = 0) => {
    const isExpanded = expandedIds.has(branch.id);
    const hasActiveInside = branchContainsActiveRoute(branch, pathname, currentSearch);
    const { Icon: BranchIcon, tintClass } = getBranchIconSpec(branch.iconKey);
    const label = locale === "hi" ? branch.labelHi : branch.label;

    return (
      <li key={branch.id}>
        <button
          type="button"
          onClick={() => toggleBranch(branch.id)}
          aria-expanded={isExpanded}
          className={`rsl-sidebar-subtoggle ${
            hasActiveInside ? "rsl-sidebar-subtoggle-active" : ""
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-2 truncate">
            <BranchIcon
              className={`h-4 w-4 shrink-0 ${
                hasActiveInside ? "text-[var(--sunset-orange)]" : tintClass
              }`}
            />
            <span className="truncate">{label}</span>
          </span>
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)] transition-transform duration-150 ${
              isExpanded ? "rotate-90 text-[var(--ink-strong)]" : ""
            }`}
          />
        </button>

        {isExpanded && (
          <ul
            className={
              depth > 0 ? "rsl-sidebar-nested-group space-y-0.5" : "rsl-sidebar-subtree space-y-0.5"
            }
          >
            {(branch.items ?? []).map((item) => renderNavLink(item, depth + 1))}
            {(branch.branches ?? []).map((sub) => renderBranch(sub, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav className="mt-3 space-y-3.5 pb-2" aria-label="Workspace navigation">
      {visibleSections.map((sec) => {
        const secItems = [
          ...sec.items,
          ...sec.branches.flatMap(collectBranchItems),
        ];
        const hasActiveChild = secItems.some((item) =>
          isItemActiveForPathname(item.href, pathname, currentSearch)
        );
        const SectionBrandIcon =
          sec.id === "meta"
            ? MetaBrandIcon
            : sec.id === "google"
              ? GoogleBrandIcon
              : null;

        return (
          <div key={sec.id} className="rsl-nav-section">
            <div
              className={`rsl-nav-section-btn px-2.5 text-[10px] font-bold tracking-[0.08em] uppercase ${
                hasActiveChild
                  ? "rsl-nav-section-btn-active text-[var(--ink-strong)]"
                  : "text-[var(--ink-muted)]"
              }`}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                {SectionBrandIcon && (
                  <SectionBrandIcon className="h-3 w-3 shrink-0 opacity-85" />
                )}
                <span className="truncate">{sec.heading}</span>
              </span>
            </div>

            <ul className="rsl-nav-group-rail mt-1 space-y-0.5">
              {sec.items.map((item) => renderNavLink(item, 0))}
              {sec.branches.map((branch) => renderBranch(branch, 0))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function TopWorkspaceBar({
  workspaceName,
  walletFormatted,
  walletBalancePaise = 0,
  walletOverdraftLimitPaise = 20_000,
  docsBaseUrl,
  setupDoneCount,
  setupTotalCount,
  sidebarSlot,
  locale = "en",
}: {
  workspaceName: string;
  walletFormatted: string;
  walletBalancePaise?: number;
  walletOverdraftLimitPaise?: number;
  docsBaseUrl: string;
  setupDoneCount: number;
  setupTotalCount: number;
  sidebarSlot?: React.ReactNode;
  locale?: WebLocale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAccessRoute } = useWorkspaceAccess();
  const [isBarPending, startBarTransition] = useTransition();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const mobileDrawerRef = React.useRef<HTMLDivElement>(null);
  const paletteDialogRef = React.useRef<HTMLDivElement>(null);

  useDialogFocusTrap(mobileDrawerRef, mobileMenuOpen, () => setMobileMenuOpen(false));
  useDialogFocusTrap(paletteDialogRef, paletteOpen, () => setPaletteOpen(false));

  const [topSearch, setTopSearch] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setTopSearch(window.location.search.replace(/^\?/, ""));
    }
  }, [pathname]);

  const allItems = useMemo(
    () => [...WORKSPACE_NAV_SECTIONS.flatMap(collectSectionItems), ...DOCK_ONLY_WORKSPACE_ITEMS],
    []
  );
  const accessibleItems = useMemo(
    () => allItems.filter((item) => canAccessRoute(item.href.split("?")[0] || item.href)),
    [allItems, canAccessRoute]
  );

  const currentItem = useMemo(() => {
    const cleanPath = pathname || "/";
    const sorted = [...allItems].sort(
      (a, b) => (b.href.split("?")[0] || "").length - (a.href.split("?")[0] || "").length
    );
    return (
      sorted.find((i) => isItemActiveForPathname(i.href, cleanPath, topSearch)) ??
      accessibleItems[0] ??
      allItems[0]!
    );
  }, [accessibleItems, allItems, pathname, topSearch]);

  const currentItemLabel = locale === "hi" ? currentItem.labelHi : currentItem.label;

  const quickActions = useMemo(() => {
    const actions: Array<{
      id: string;
      label: string;
      summary: string;
      keywords: string;
      href?: string;
      onRun?: () => void;
    }> = [
      {
        id: "open-guide",
        label: `Open Page Guide: ${currentItem.label}`,
        summary: "Read step-by-step instructions and common mistakes for this screen",
        keywords: "help guide manual steps walkthrough",
        onRun: () => setHelpOpen(true),
      },
    ];
    if (canAccessRoute("/billing")) {
      actions.push({
        id: "wallet-recharge",
        label: "Recharge Prepaid Wallet",
        summary: "Add funds via UPI / Bank Transfer or view GST Advance Receipts",
        keywords: "recharge topup wallet upi utr billing balance",
        href: "/billing/wallet",
      });
    }
    if (canAccessRoute("/tally")) {
      actions.push({
        id: "tally-sync",
        label: "Pair Tally Prime or Download .bat Connector",
        summary: "Configure Tally Prime .tdl v2.9 add-on or Windows 1-click sync",
        keywords: "tally prime sync connector bat tdl bills",
        href: "/tally",
      });
    }
    if (canAccessRoute("/whatsapp")) {
      actions.push({
        id: "wa-template",
        label: "Create WhatsApp Business Template",
        summary: "Design Meta-approved bill or payment reminder templates with live preview",
        keywords: "whatsapp template create broadcast reminder",
        href: "/whatsapp",
      });
    }
    return actions;
  }, [canAccessRoute, currentItem.label]);

  const filteredQuickActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickActions;
    return quickActions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.keywords.toLowerCase().includes(q)
    );
  }, [quickActions, query]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accessibleItems;
    return accessibleItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.labelHi.toLowerCase().includes(q) ||
        i.keywords.toLowerCase().includes(q) ||
        i.helpSummary.toLowerCase().includes(q)
    );
  }, [accessibleItems, query]);

  const paletteEntries = useMemo(
    () => [
      ...filteredQuickActions.map((a) => ({ kind: "action" as const, action: a })),
      ...filteredItems.map((i) => ({ kind: "nav" as const, item: i })),
    ],
    [filteredQuickActions, filteredItems]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, paletteOpen]);

  const canViewBilling = canAccessRoute("/billing");
  const isNegativeWallet = walletBalancePaise < 0;
  const isOverdraftExhausted = walletBalancePaise <= -walletOverdraftLimitPaise;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeDescendantId =
    paletteOpen && paletteEntries.length > 0 ? `cmdk-opt-${activeIndex}` : undefined;

  return (
    <>
      <header className="rsl-frost-header sticky top-0 z-20 shrink-0">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rsl-btn-secondary !min-h-9 !w-9 shrink-0 !p-0 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Home">
              <BrandLogo variant="mark" size="sm" />
            </Link>
            <div className="inline-flex min-w-0 items-center gap-2 text-xs">
              <span className="hidden font-medium text-slate-500 sm:inline">{workspaceName}</span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="truncate font-bold text-slate-950">{currentItemLabel}</span>
              {isBarPending && <IosSpinner size="xs" className="text-[var(--sunset-orange)]" />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="rsl-btn-secondary !min-h-8 !px-2.5 !py-1.5 text-xs"
            >
              <Search className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
              <span className="hidden md:inline text-[var(--ink-muted)]">
                {locale === "hi" ? "खोजें या पेज खोलें..." : "Search or jump..."}
              </span>
              <kbd className="hidden items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--ink-secondary)] sm:inline-flex">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {canViewBilling && (
              <Link
                href="/billing/wallet"
                title={
                  isOverdraftExhausted
                    ? "Wallet overdraft limit (-₹200.00) reached - recharge to resume metered usage"
                    : isNegativeWallet
                      ? "Wallet overdraft active (usable down to -₹200.00)"
                      : "Prepaid Message & Usage Wallet"
                }
                onClick={(e) => {
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    startBarTransition(() => router.push("/billing/wallet"));
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold tabular-nums transition sm:px-3 ${
                  isOverdraftExhausted || isNegativeWallet
                    ? "rsl-pill-sunset"
                    : "rsl-pill-forest"
                }`}
              >
                <Wallet className="h-3.5 w-3.5 shrink-0" />
                <span>{walletFormatted}</span>
                {isNegativeWallet && (
                  <span className="hidden rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-950 sm:inline">
                    {isOverdraftExhausted ? "Limit" : "Overdraft"}
                  </span>
                )}
              </Link>
            )}

            <form action={setWebLocaleAction} className="inline-flex">
              <input type="hidden" name="locale" value={locale === "hi" ? "en" : "hi"} />
              <input type="hidden" name="returnPath" value={pathname || "/"} />
              <button
                type="submit"
                title={locale === "hi" ? "Switch interface to English" : "हिंदी में बदलें"}
                aria-label={locale === "hi" ? "Switch language to English" : "Switch language to Hindi"}
                className="rsl-btn-secondary !min-h-8 !px-2.5 !py-1 text-xs"
              >
                {locale === "hi" ? "EN" : "हिं"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rsl-guide-trigger !min-h-8"
              title="Open step-by-step guide for this screen"
            >
              <HelpCircle className="h-3.5 w-3.5 text-[var(--sunset-orange)]" />
              <span className="hidden md:inline">
                {locale === "hi" ? "सहायता" : "Need help?"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="rsl-hard-blur-scrim fixed inset-0"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation menu"
            className="rsl-drawer-frost rsl-sidebar-scroll relative z-10 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto border-r p-4"
          >
            <div>
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="rsl-icon-action-btn"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SidebarNavLinks locale={locale} onNavigate={() => setMobileMenuOpen(false)} />
            </div>
            <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
              {sidebarSlot}
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
                <div className="inline-flex items-center gap-1.5">
                  <BrandLogo variant="mark" size="xs" />
                  <span>© {new Date().getFullYear()} RapidShift Labs</span>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <Link
                    href="/settings/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rsl-account-dock-btn"
                  >
                    <UserCircle2 className="h-3.5 w-3.5" />
                    <span>Your Profile</span>
                  </Link>
                  {canAccessRoute("/settings/business") && (
                    <Link
                      href="/settings/business"
                      onClick={() => setMobileMenuOpen(false)}
                      aria-label="Open Business Settings"
                      title="Business Settings"
                      className="rsl-icon-action-btn"
                    >
                      <Building2 className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && (
        <div className="rsl-hard-blur-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
          <div
            ref={paletteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace command palette"
            className="rsl-drawer-frost w-full max-w-xl overflow-hidden rounded-2xl border"
          >
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5">
              <Search className="h-4 w-4 text-emerald-600" />
              <label htmlFor="workspace-cmdk-input" className="sr-only">
                Search workspace pages or quick actions
              </label>
              <input
                id="workspace-cmdk-input"
                role="combobox"
                aria-expanded={paletteOpen}
                aria-controls="workspace-cmdk-listbox"
                aria-autocomplete="list"
                aria-activedescendant={activeDescendantId}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (paletteEntries.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev + 1) % paletteEntries.length);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex(
                      (prev) => (prev - 1 + paletteEntries.length) % paletteEntries.length
                    );
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const picked = paletteEntries[activeIndex] ?? paletteEntries[0];
                    if (!picked) return;
                    setPaletteOpen(false);
                    setQuery("");
                    if (picked.kind === "action") {
                      if (picked.action.onRun) {
                        picked.action.onRun();
                      } else if (picked.action.href) {
                        const targetHref = picked.action.href;
                        startBarTransition(() => router.push(targetHref));
                      }
                    } else {
                      startBarTransition(() => router.push(picked.item.href));
                    }
                  }
                }}
                placeholder="Type a page or task (e.g. Tally bills, WhatsApp templates, Wallet, Backups)..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600"
              >
                ESC
              </button>
            </div>
            <div
              id="workspace-cmdk-listbox"
              className="rsl-custom-scrollbar max-h-80 overflow-y-auto p-2"
              role="listbox"
              aria-label="Matching workspace actions and screens"
            >
              {paletteEntries.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-zinc-500">
                  No matching pages found. Try searching inside{" "}
                  <Link
                    href="/help"
                    onClick={() => setPaletteOpen(false)}
                    className="font-semibold text-emerald-700 underline"
                  >
                    Guides &amp; Help
                  </Link>
                  .
                </div>
              ) : (
                <>
                  {filteredQuickActions.length > 0 && (
                    <div className="mb-1.5">
                      <div className="px-3 py-1 text-xs font-bold tracking-wider text-zinc-500 uppercase">
                        Quick Actions
                      </div>
                      {filteredQuickActions.map((act, idx) => {
                        const isSelected = activeIndex === idx;
                        return (
                          <button
                            id={`cmdk-opt-${idx}`}
                            key={act.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => {
                              setPaletteOpen(false);
                              setQuery("");
                              if (act.onRun) {
                                act.onRun();
                              } else if (act.href) {
                                const targetHref = act.href;
                                startBarTransition(() => router.push(targetHref));
                              }
                            }}
                            className={`flex w-full items-start gap-3 rounded-xl px-3.5 py-2.5 text-left transition ${
                              isSelected
                                ? "bg-emerald-50/90 ring-1 ring-emerald-200/80"
                                : "hover:bg-emerald-50/60"
                            }`}
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-200/80 bg-emerald-50 text-emerald-700">
                              <Command className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-slate-900">
                                {act.label}
                              </span>
                              <span className="block truncate text-xs text-zinc-500">
                                {act.summary}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {filteredItems.length > 0 && (
                    <div>
                      <div className="px-3 py-1 text-xs font-bold tracking-wider text-zinc-500 uppercase">
                        Workspace Screens
                      </div>
                      {filteredItems.map((item, idx) => {
                        const entryIndex = filteredQuickActions.length + idx;
                        const isSelected = activeIndex === entryIndex;
                        const Icon = resolveIconForHref(item.href);
                        return (
                          <button
                            id={`cmdk-opt-${entryIndex}`}
                            key={item.href}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setActiveIndex(entryIndex)}
                            onClick={() => {
                              setPaletteOpen(false);
                              setQuery("");
                              startBarTransition(() => router.push(item.href));
                            }}
                            className={`flex w-full items-start gap-3 rounded-xl px-3.5 py-2.5 text-left transition ${
                              isSelected
                                ? "bg-emerald-50/90 ring-1 ring-emerald-200/80"
                                : "hover:bg-emerald-50/60"
                            }`}
                          >
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200/80 bg-zinc-50 text-emerald-600">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-slate-900">
                                {locale === "hi" ? `${item.labelHi} (${item.label})` : item.label}
                              </span>
                              <span className="block truncate text-xs text-zinc-500">
                                {item.helpSummary}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/75 px-4 py-2 text-xs text-zinc-500">
              <span>↑↓ Navigate • ↵ Open • Esc Close</span>
              <span className="font-mono">Ctrl+K / ⌘K</span>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Frosted Bottom Guide Drawer */}
      {(() => {
        const detailedGuide = resolveWebPageGuide(pathname || "/");
        const activeSlug = detailedGuide?.guideSlug || currentItem.guideSlug;
        return (
          <GuideDrawer
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            guide={{
              eyebrow: locale === "hi" ? "चरण-दर-चरण सहायता" : "Step-by-Step Page Guide",
              title: detailedGuide?.title || currentItem.helpTitle,
              summary: detailedGuide?.summary || currentItem.helpSummary,
              estimatedTime: detailedGuide?.estimatedTime,
              prerequisites: detailedGuide?.prerequisites ?? [],
              steps: detailedGuide
                ? detailedGuide.steps
                : currentItem.helpSteps.map((s, idx) => ({
                    title: `Step ${idx + 1}`,
                    detail: s,
                  })),
              cautions: detailedGuide?.commonMistakes ?? [],
              cautionsTitle: "Common Mistakes to Avoid",
              progress: {
                label: "Workspace Setup Progress",
                doneCount: setupDoneCount,
                totalCount: setupTotalCount,
              },
              fullGuideHref: `/help?slug=${encodeURIComponent(activeSlug)}`,
              fullGuideLabel: "Open Full Guide Inside App",
              externalHref: `${docsBaseUrl}/guides/${activeSlug}`,
              externalLabel: "Help Center",
            }}
          />
        );
      })()}
    </>
  );
}
