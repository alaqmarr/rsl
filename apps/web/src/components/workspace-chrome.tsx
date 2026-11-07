"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo, IosSpinner, useDialogFocusTrap } from "@rsl/ui";
import { useWorkspaceAccess } from "@/components/workspace-access-context";
import { resolveWebPageGuide } from "@/lib/page-guides";
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  Command,
  Database,
  FileSpreadsheet,
  HelpCircle,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Megaphone,
  Menu,
  MessageSquareShare,
  Package,
  Search,
  ShieldCheck,
  Star,
  UserCircle2,
  Users,
  Wallet,
  X,
} from "lucide-react";

export interface NavItemDef {
  href: string;
  label: string;
  badge?: string | number;
  keywords: string;
  helpTitle: string;
  helpSummary: string;
  helpSteps: string[];
  guideSlug: string;
}

const WORKSPACE_NAV_SECTIONS: Array<{
  heading: string;
  items: NavItemDef[];
}> = [
  {
    heading: "Performance & Cashflow",
    items: [
      {
        href: "/",
        label: "Business Overview",
        keywords: "home summary dashboard cashflow receivables",
        helpTitle: "Understanding Your Business Overview",
        helpSummary:
          "Every figure on this screen comes directly from your actual bills, receipts, and customer conversations — never estimated or sample numbers.",
        helpSteps: [
          "Check Money Collected vs. Pending Customer Bills in the top row.",
          "Complete any remaining items in Quick Setup Progress.",
          "Send 1-click WhatsApp reminders directly from Overdue Bills.",
        ],
        guideSlug: "getting-started",
      },
      {
        href: "/analytics",
        label: "Detailed Analytics",
        keywords: "charts roi roas funnel aging reports csv",
        helpTitle: "Reading Detailed Business Analytics",
        helpSummary:
          "Compare 7-day, 30-day, 90-day, or 12-month collections, team reply speed, customer conversion funnel, and return per ₹1 spent.",
        helpSteps: [
          "Switch time windows at the top right (7d / 30d / 90d / 365d / All Time).",
          "Review Channel-by-Channel Breakdown to see which channel brings real collections.",
          "Click Download CSV Report to open any period in Excel or Tally.",
        ],
        guideSlug: "analytics-cashflow-and-aging-reports",
      },
    ],
  },
  {
    heading: "Daily Operations",
    items: [
      {
        href: "/inbox",
        label: "Customer Messages",
        keywords: "inbox chat whatsapp instagram facebook sla replies",
        helpTitle: "Replying to Customer Messages",
        helpSummary:
          "Manage WhatsApp, Instagram, Facebook, and Google inquiries in one shared team inbox with automatic 24-hour reply window checks.",
        helpSteps: [
          "Add or import customer contacts along with WhatsApp permission.",
          "Reply directly inside the 24-hour customer service window, or select an approved template anytime.",
          "Leave private team notes that customers never see.",
        ],
        guideSlug: "shared-inbox-and-customer-messages",
      },
      {
        href: "/tally",
        label: "Tally Prime & Bills",
        keywords: "tally xml csv tdl webhook automation invoices vouchers receipts payments paid overdue reminders pdf",
        helpTitle: "All-in-One Tally Prime Vouchers, Paid-in-Tally Sync & Native PDFs",
        helpSummary:
          "Connect Tally Prime using your personalized '<Business Name> & RSL Sync' .tdl v2.7 add-on, dedicated *.tally.rapidshiftlabs.in webhook URL, or Windows PC connector so bills, receipts, and exact Tally PDFs sync automatically.",
        helpSteps: [
          "Download your personalized <business>-rsl-sync.tdl v2.7 add-on or pair the 1-click Windows Connector.",
          "Whenever a Receipt, Payment, or Credit/Debit Note is saved in Tally, linked bills automatically mark Paid and pending overdue WhatsApp reminders cancel.",
          "Click any Voucher # or Party Name to open the full detailed Voucher or Client Running Balance Statement.",
        ],
        guideSlug: "tally-sync-and-import",
      },
      {
        href: "/tally/parties",
        label: "Client & Party Ledgers",
        keywords: "clients parties customers suppliers debtors creditors ledgers statement running balance ageing credit limit paid",
        helpTitle: "Client & Supplier Ledgers, Ageing & Running Balance Statements",
        helpSummary:
          "Inspect Sundry Debtors (Customers) and Sundry Creditors (Suppliers) with T-account chronological running balances, 0–90+ day ageing buckets, credit limit alerts, and downloadable PDF statements.",
        helpSteps: [
          "Filter by Sundry Debtors, Sundry Creditors, Overdue 30/60/90+ days, or Credit Limit Breaches.",
          "Click any Party Name to open their T-account running balance statement, open bills, settlement trail, and item purchase history.",
          "Download branded Party Ledger Statement PDFs or share polite payment follow-ups on WhatsApp in 1 click.",
        ],
        guideSlug: "tally-sync-and-import",
      },
      {
        href: "/inventory",
        label: "Inventory & Stock",
        keywords: "inventory stock items godowns warehouse batches expiry reorder dead stock valuation price list",
        helpTitle: "Live Tally Inventory, Godowns & Reorder Intelligence",
        helpSummary:
          "Monitor real-time stock quantities, godown & batch expiry balances, HSN/GST price lists, reorder shortfalls, and 30/60/90-day inactive dead stock synced directly from Tally Prime.",
        helpSteps: [
          "Sync Stock Items, Godowns, and Party Credit Limits automatically via Port 9000, Windows Connector, or Tally XML/CSV.",
          "Every new Sales/Purchase bill, edit, cancellation, or deletion updates closing stock & item movement history automatically.",
          "Share 1-click WhatsApp price quotes with customers and review Reorder & Dead Stock alerts.",
        ],
        guideSlug: "tally-sync-and-import",
      },
      {
        href: "/whatsapp",
        label: "WhatsApp & Templates",
        keywords: "whatsapp templates manager header buttons variables bulk broadcast opt-in stop unsubscribed",
        helpTitle: "WhatsApp Business Template Manager & Broadcasts",
        helpSummary:
          "Design official WhatsApp Business templates with headers, Tally bill variables, and buttons, sync with Meta, and send broadcasts to opted-in customers.",
        helpSteps: [
          "Load ready-made Tally PDF bill & receipt templates in 1 click, or build custom templates with a live phone preview.",
          "Sync templates directly with your connected WhatsApp Business Account.",
          "Launch broadcasts to opted-in customers while keeping unsubscribed numbers permanently excluded.",
        ],
        guideSlug: "whatsapp-and-broadcasts",
      },
      {
        href: "/campaigns",
        label: "Ads & Social Posts",
        keywords: "meta facebook instagram ads pixel scheduled posts",
        helpTitle: "Ad Campaigns, Scheduled Posts & Website Sales",
        helpSummary:
          "Track Facebook & Instagram ad spend against real linked sales, schedule social posts, and record website orders without duplicate counting.",
        helpSteps: [
          "Create an ad campaign with your daily rupee budget.",
          "Record daily spend & linked sales to track Return per ₹1 Spent.",
          "Log Website Sales Events with unique order IDs so orders are never counted twice.",
        ],
        guideSlug: "ads-social-posts-and-website-conversions",
      },
      {
        href: "/reviews",
        label: "Google Reviews",
        keywords: "google business profile stars ratings replies",
        helpTitle: "Managing Google Business Reviews",
        helpSummary:
          "Monitor customer star ratings across store locations and publish polite owner replies.",
        helpSteps: [
          "Filter or review incoming star ratings.",
          "Publish direct owner responses to build local trust.",
        ],
        guideSlug: "google-reviews-and-smart-replies",
      },
    ],
  },
  {
    heading: "Settings & Account",
    items: [
      {
        href: "/settings/profile",
        label: "My Profile",
        keywords: "profile password email verification sessions devices mobile job title",
        helpTitle: "Your Personal Account & Security",
        helpSummary:
          "Update your name, job title, mobile number, login password, email verification, and active browser sessions.",
        helpSteps: [
          "Update your personal identity details and verify your work email.",
          "Review active device sessions and sign out unfamiliar browsers in 1 click.",
        ],
        guideSlug: "team-roles-security-and-business-settings",
      },
      {
        href: "/settings/business",
        label: "Business Settings",
        keywords: "business gstin state address tally company billing email phone workspace switch ssl subdomain",
        helpTitle: "Business Identity, GSTIN & SSL Subdomains",
        helpSummary:
          "Configure your registered business name, GST state & 15-character GSTIN, dedicated *.tally.rapidshiftlabs.in / *.api.rapidshiftlabs.in SSL endpoints, and default Tally Prime company.",
        helpSteps: [
          "Set your GST billing state and GSTIN so tax invoices reflect accurate CGST/SGST or IGST.",
          "Verify your dedicated Tally & API HTTPS subdomain SSL certificates.",
        ],
        guideSlug: "team-roles-security-and-business-settings",
      },
      {
        href: "/settings/team",
        label: "Team & Roles",
        keywords: "team members invite roles permissions staff colleague",
        helpTitle: "Team Members & Role Permissions",
        helpSummary:
          "Invite staff members as Admin, Manager, Inbox Agent, Analyst, or Billing and manage access anytime.",
        helpSteps: [
          "Invite colleagues by email and share their direct invitation link.",
          "Update member roles or revoke access whenever responsibilities change.",
        ],
        guideSlug: "team-roles-security-and-business-settings",
      },
      {
        href: "/connections",
        label: "Connected Channels",
        keywords: "whatsapp meta facebook instagram google drive ads reviews connect oauth",
        helpTitle: "1-Click Connected Accounts (Meta & Google)",
        helpSummary:
          "Sign in with Facebook or Google in one click to connect WhatsApp Business, Instagram, Facebook Pages, Meta Ads, Google Business Profile, Google Ads, and Google Drive.",
        helpSteps: [
          "Click 'Connect All with Facebook' or 'Connect All with Google' (or connect any individual channel).",
          "Approve your business account on Facebook or Google — assets and webhooks configure automatically.",
        ],
        guideSlug: "connecting-channels-whatsapp-meta-google",
      },
      {
        href: "/settings/tokens",
        label: "All API Tokens",
        keywords: "api tokens keys bearer tally webhook verify whatsapp meta instagram secret rotate",
        helpTitle: "Unified API Tokens & Webhook Credentials",
        helpSummary:
          "Manage every token in one screen: External Channel tokens, Tally Prime webhook token, Meta webhook verify token, and Developer REST API keys.",
        helpSteps: [
          "Rotate channel tokens, Tally webhook tokens, or Meta verify tokens in one place.",
          "Issue scoped Live or Test REST API keys on your *.api.rapidshiftlabs.in subdomain.",
        ],
        guideSlug: "developer-api",
      },
      {
        href: "/billing",
        label: "Plans & Wallet",
        keywords: "wallet recharge utr upi gst invoice plans services rupees overdraft negative",
        helpTitle: "Service Plans, Prepaid Wallet (-₹200 Overdraft) & GST Invoices",
        helpSummary:
          "Review modular plan details, request feature activation, monitor your Prepaid Wallet (including -₹200 overdraft credit), and download official GST tax invoices.",
        helpSteps: [
          "Review everything included in each plan and submit a feature activation request.",
          "Submit a wallet recharge via UPI / Bank Transfer — WhatsApp & metered usage stay uninterrupted down to -₹200.00.",
        ],
        guideSlug: "plans-wallet-and-gst",
      },
      {
        href: "/backups",
        label: "Backups & Storage",
        keywords: "cloud storage backup restore export import",
        helpTitle: "Cloud Storage & Full Data Backups",
        helpSummary:
          "Choose Managed Cloud Storage or connect your own cloud storage bucket, and download full backups of your business records anytime.",
        helpSteps: [
          "Switch between Managed Cloud Storage and your own cloud bucket anytime.",
          "Download a password-protected backup file before major changes.",
          "Restore safely — your wallet balance, GST invoices, and unsubscribed numbers always stay intact.",
        ],
        guideSlug: "storage-r2-and-backups",
      },
      {
        href: "/activity",
        label: "Activity History",
        keywords: "audit logs history team actions security",
        helpTitle: "Business Activity History",
        helpSummary:
          "View a complete, permanent timeline of actions taken by your team, Tally sync, and automated WhatsApp rules.",
        helpSteps: [
          "Filter or review who performed each action and when it happened.",
          "Past activity records are permanent and cannot be altered.",
        ],
        guideSlug: "getting-started",
      },
      {
        href: "/status",
        label: "Workspace Health",
        keywords: "health status queue uptime ssl",
        helpTitle: "Workspace Health & Message Queue",
        helpSummary:
          "Check live readiness of your business workspace, SSL subdomains, automated WhatsApp delivery, and cloud storage.",
        helpSteps: ["Verify that all services show Online."],
        guideSlug: "getting-started",
      },
      {
        href: "/help",
        label: "Guides & Help",
        keywords: "docs documentation help search troubleshooting",
        helpTitle: "Step-by-Step Guides & Help",
        helpSummary:
          "Plain-English setup guides for Tally Prime, WhatsApp Business templates, billing, and backups.",
        helpSteps: ["Search any topic or question for step-by-step instructions."],
        guideSlug: "getting-started",
      },
    ],
  },
];

const ICON_BY_HREF: Record<string, React.ComponentType<{ className?: string }>> = {
  "/": LayoutDashboard,
  "/analytics": BarChart3,
  "/inbox": Inbox,
  "/tally": FileSpreadsheet,
  "/tally/parties": Users,
  "/whatsapp": MessageSquareShare,
  "/campaigns": Megaphone,
  "/reviews": Star,
  "/inventory": Package,
  "/settings/profile": UserCircle2,
  "/settings/business": Building2,
  "/settings/team": Users,
  "/connections": Link2,
  "/settings/tokens": KeyRound,
  "/developers": KeyRound,
  "/billing": Wallet,
  "/backups": Database,
  "/activity": ShieldCheck,
  "/status": Activity,
  "/help": BookOpen,
};

interface NavDomainPalette {
  activeRow: string;
  activeIcon: string;
  idleIcon: string;
  dot: string;
}

const NAV_TONE_PALETTES: Record<
  "indigo" | "sky" | "violet" | "emerald" | "copper" | "amber" | "teal" | "slate",
  NavDomainPalette
> = {
  indigo: {
    activeRow: "bg-indigo-50/95 font-semibold text-indigo-950 ring-1 ring-indigo-200/90 shadow-2xs",
    activeIcon: "text-indigo-600",
    idleIcon: "text-indigo-500/80 group-hover:text-indigo-700",
    dot: "bg-indigo-600",
  },
  sky: {
    activeRow: "bg-sky-50/95 font-semibold text-sky-950 ring-1 ring-sky-200/90 shadow-2xs",
    activeIcon: "text-sky-600",
    idleIcon: "text-sky-500/85 group-hover:text-sky-700",
    dot: "bg-sky-600",
  },
  violet: {
    activeRow: "bg-violet-50/95 font-semibold text-violet-950 ring-1 ring-violet-200/90 shadow-2xs",
    activeIcon: "text-violet-600",
    idleIcon: "text-violet-500/85 group-hover:text-violet-700",
    dot: "bg-violet-600",
  },
  emerald: {
    activeRow: "bg-emerald-50/95 font-semibold text-emerald-950 ring-1 ring-emerald-200/90 shadow-2xs",
    activeIcon: "text-emerald-600",
    idleIcon: "text-emerald-600/85 group-hover:text-emerald-700",
    dot: "bg-emerald-600",
  },
  copper: {
    activeRow: "bg-orange-50/95 font-semibold text-orange-950 ring-1 ring-orange-200/90 shadow-2xs",
    activeIcon: "text-orange-600",
    idleIcon: "text-orange-500/85 group-hover:text-orange-700",
    dot: "bg-orange-600",
  },
  amber: {
    activeRow: "bg-amber-50/95 font-semibold text-amber-950 ring-1 ring-amber-200/90 shadow-2xs",
    activeIcon: "text-amber-600",
    idleIcon: "text-amber-500/90 group-hover:text-amber-700",
    dot: "bg-amber-500",
  },
  teal: {
    activeRow: "bg-teal-50/95 font-semibold text-teal-950 ring-1 ring-teal-200/90 shadow-2xs",
    activeIcon: "text-teal-600",
    idleIcon: "text-teal-500/85 group-hover:text-teal-700",
    dot: "bg-teal-600",
  },
  slate: {
    activeRow: "bg-slate-100/95 font-semibold text-slate-950 ring-1 ring-slate-300/80 shadow-2xs",
    activeIcon: "text-slate-700",
    idleIcon: "text-slate-400 group-hover:text-slate-700",
    dot: "bg-slate-700",
  },
};

function getNavPaletteForHref(href: string): NavDomainPalette {
  if (href === "/" || href === "/analytics") return NAV_TONE_PALETTES.indigo;
  if (href === "/inbox") return NAV_TONE_PALETTES.sky;
  if (href.startsWith("/tally") || href === "/inventory") return NAV_TONE_PALETTES.violet;
  if (href === "/whatsapp") return NAV_TONE_PALETTES.emerald;
  if (href === "/campaigns") return NAV_TONE_PALETTES.copper;
  if (href === "/reviews" || href === "/billing") return NAV_TONE_PALETTES.amber;
  if (href === "/connections" || href === "/backups") return NAV_TONE_PALETTES.teal;
  if (href === "/settings/tokens" || href === "/settings/business") return NAV_TONE_PALETTES.indigo;
  return NAV_TONE_PALETTES.slate;
}

export function SidebarNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { canAccessRoute } = useWorkspaceAccess();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const visibleSections = useMemo(
    () =>
      WORKSPACE_NAV_SECTIONS.map((sec) => ({
        heading: sec.heading,
        items: sec.items.filter((item) => canAccessRoute(item.href)),
      })).filter((sec) => sec.items.length > 0),
    [canAccessRoute]
  );

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
    }
  }, [isPending, pathname]);

  return (
    <nav className="mt-4 space-y-4 pb-2">
      {visibleSections.map((sec) => (
        <div key={sec.heading}>
          <div className="px-2.5 text-[10px] font-bold tracking-[0.08em] text-zinc-500 uppercase">
            {sec.heading}
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {sec.items.map((item) => {
              const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
              const tone = getNavPaletteForHref(item.href);
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/tally"
                    ? pathname === "/tally" || pathname.startsWith("/tally/vouchers/")
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`) ||
                      (item.href === "/settings/tokens" &&
                        (pathname === "/developers" || pathname.startsWith("/developers/")));
              const isItemLoading = isPending && pendingHref === item.href;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={(e) => {
                      if (
                        e.button !== 0 ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey
                      ) {
                        onNavigate?.();
                        return;
                      }
                      e.preventDefault();
                      onNavigate?.();
                      if (isActive && pathname === item.href) return;
                      setPendingHref(item.href);
                      startTransition(() => {
                        router.push(item.href);
                      });
                    }}
                    className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] transition-all ${
                      isActive
                        ? tone.activeRow
                        : isItemLoading
                          ? "bg-slate-100/90 font-semibold text-slate-900"
                          : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                    }`}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2.5 truncate">
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isActive
                            ? tone.activeIcon
                            : isItemLoading
                              ? "text-slate-900"
                              : tone.idleIcon
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {isItemLoading ? (
                      <IosSpinner size="xs" className="text-indigo-600" />
                    ) : isActive ? (
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
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
}: {
  workspaceName: string;
  walletFormatted: string;
  walletBalancePaise?: number;
  walletOverdraftLimitPaise?: number;
  docsBaseUrl: string;
  setupDoneCount: number;
  setupTotalCount: number;
  sidebarSlot?: React.ReactNode;
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
  const helpDrawerRef = React.useRef<HTMLElement>(null);

  useDialogFocusTrap(mobileDrawerRef, mobileMenuOpen, () => setMobileMenuOpen(false));
  useDialogFocusTrap(paletteDialogRef, paletteOpen, () => setPaletteOpen(false));
  useDialogFocusTrap(helpDrawerRef, helpOpen, () => setHelpOpen(false));

  const allItems = useMemo(() => WORKSPACE_NAV_SECTIONS.flatMap((s) => s.items), []);
  const accessibleItems = useMemo(
    () => allItems.filter((item) => canAccessRoute(item.href)),
    [allItems, canAccessRoute]
  );

  const currentItem = useMemo(() => {
    return (
      allItems.find((i) =>
        i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`)
      ) ??
      accessibleItems[0] ??
      allItems[0]!
    );
  }, [accessibleItems, allItems, pathname]);

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
        href: "/billing?tab=wallet",
      });
    }
    if (canAccessRoute("/tally")) {
      actions.push({
        id: "tally-sync",
        label: "Pair Tally Prime or Download .bat Connector",
        summary: "Configure Tally Prime .tdl v2.5 add-on or Windows 1-click sync",
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

  return (
    <>
      <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200/90 bg-white/90 shadow-[0_4px_20px_-12px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3 lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xs lg:hidden"
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
              <span className="truncate font-bold text-slate-950">{currentItem.label}</span>
              {isBarPending && <IosSpinner size="xs" className="text-indigo-600" />}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2.5 rounded-xl border border-slate-200/95 bg-slate-50/80 px-3 py-1.5 text-xs text-slate-500 shadow-2xs transition hover:border-indigo-300 hover:bg-white hover:text-slate-900"
            >
              <Search className="h-3.5 w-3.5 text-indigo-500" />
              <span className="hidden sm:inline">Jump to screen, Tally, templates, or help...</span>
              <span className="sm:hidden">Search</span>
              <kbd className="hidden items-center gap-0.5 rounded-md border border-indigo-200/80 bg-indigo-50/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 md:inline-flex">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {canViewBilling && (
              <Link
                href="/billing?tab=wallet"
                title={
                  isOverdraftExhausted
                    ? "Wallet overdraft limit (-₹200.00) reached — recharge to resume metered usage"
                    : isNegativeWallet
                      ? "Wallet overdraft active (usable down to -₹200.00)"
                      : "Prepaid Message & Usage Wallet"
                }
                onClick={(e) => {
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    startBarTransition(() => router.push("/billing?tab=wallet"));
                  }
                }}
                className={`hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold tabular-nums transition md:inline-flex ${
                  isOverdraftExhausted
                    ? "border-rose-200/90 bg-rose-50/90 text-rose-800 hover:bg-rose-100/80"
                    : isNegativeWallet
                      ? "border-amber-200/90 bg-amber-50/90 text-amber-900 hover:bg-amber-100/80"
                      : "border-emerald-200/90 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100/80"
                }`}
              >
                <Wallet
                  className={`h-3.5 w-3.5 ${
                    isOverdraftExhausted
                      ? "text-rose-600"
                      : isNegativeWallet
                        ? "text-amber-600"
                        : "text-emerald-600"
                  }`}
                />
                <span>{walletFormatted}</span>
                {isNegativeWallet && (
                  <span
                    className={`rounded-md px-1.5 py-0.2 text-[10px] font-bold ${
                      isOverdraftExhausted
                        ? "bg-rose-200/70 text-rose-900"
                        : "bg-amber-200/70 text-amber-950"
                    }`}
                  >
                    {isOverdraftExhausted ? "Limit" : "Overdraft"}
                  </span>
                )}
              </Link>
            )}

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200/90 bg-indigo-50/75 px-3 py-1.5 text-xs font-semibold text-indigo-900 shadow-2xs transition hover:bg-indigo-100/80"
              title="Open help for this page"
            >
              <HelpCircle className="h-3.5 w-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Page Guide</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation menu"
            className="relative z-10 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-white p-4 shadow-2xl"
          >
            <div>
              <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sidebarSlot}
              <SidebarNavLinks onNavigate={() => setMobileMenuOpen(false)} />
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
              <BrandLogo variant="mark" size="xs" />
              <span>© {new Date().getFullYear()} RapidShift Labs</span>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/35 px-4 pt-[12vh] backdrop-blur-xs">
          <div
            ref={paletteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace command palette"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5">
              <Search className="h-4 w-4 text-emerald-600" />
              <label htmlFor="workspace-cmdk-input" className="sr-only">
                Search workspace pages or quick actions
              </label>
              <input
                id="workspace-cmdk-input"
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
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
              >
                ESC
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2" role="listbox">
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
                      <div className="px-3 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                        Quick Actions
                      </div>
                      {filteredQuickActions.map((act, idx) => {
                        const isSelected = activeIndex === idx;
                        return (
                          <button
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
                              <span className="block truncate text-[11px] text-zinc-500">
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
                      <div className="px-3 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                        Workspace Screens
                      </div>
                      {filteredItems.map((item, idx) => {
                        const entryIndex = filteredQuickActions.length + idx;
                        const isSelected = activeIndex === entryIndex;
                        const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
                        return (
                          <button
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
                                {item.label}
                              </span>
                              <span className="block truncate text-[11px] text-zinc-500">
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
            <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/75 px-4 py-2 text-[11px] text-zinc-500">
              <span>↑↓ Navigate • ↵ Open • Esc Close</span>
              <span className="font-mono">Ctrl+K / ⌘K</span>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Help Drawer */}
      {helpOpen && (() => {
        const detailedGuide = resolveWebPageGuide(pathname || "/");
        const activeSlug = detailedGuide?.guideSlug || currentItem.guideSlug;
        return (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div
              className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs"
              onClick={() => setHelpOpen(false)}
            />
            <aside
              ref={helpDrawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Step-by-step page guide"
              className="relative z-10 flex h-full w-full max-w-lg flex-col justify-between overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-2xl"
            >
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
                  <div>
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/70">
                      Step-by-Step Page Guide
                    </span>
                    <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900">
                      {detailedGuide?.title || currentItem.helpTitle}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(false)}
                    aria-label="Close page guide"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-xs leading-relaxed text-zinc-600">
                  {detailedGuide?.summary || currentItem.helpSummary}
                </p>

                <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">Workspace Setup Progress</span>
                    <span className="font-bold text-emerald-700 tabular-nums">
                      {setupDoneCount} / {setupTotalCount} steps complete
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200/80">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{
                        width: `${Math.round((setupDoneCount / Math.max(1, setupTotalCount)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {detailedGuide && detailedGuide.prerequisites.length > 0 && (
                  <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/75 p-3.5 text-xs">
                    <div className="text-[11px] font-bold tracking-wider text-slate-800 uppercase">
                      Before You Start
                    </div>
                    <ul className="mt-2 space-y-1.5 text-zinc-700">
                      {detailedGuide.prerequisites.map((req, idx) => (
                        <li key={idx} className="flex items-start gap-2 leading-relaxed">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                          <span>{req}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                    Minute-by-Minute Steps ({detailedGuide ? detailedGuide.steps.length : currentItem.helpSteps.length})
                  </h3>
                  {detailedGuide ? (
                    <ol className="mt-3 space-y-2.5">
                      {detailedGuide.steps.map((step, idx) => (
                        <li
                          key={idx}
                          className="flex gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/50 p-3.5 text-xs text-slate-900"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white tabular-nums">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="font-semibold text-slate-900">{step.title}</div>
                            <p className="leading-relaxed text-zinc-600">{step.detail}</p>
                            {step.tip && (
                              <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] font-medium text-emerald-900">
                                Tip: {step.tip}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ol className="mt-3 space-y-2.5">
                      {currentItem.helpSteps.map((step, idx) => (
                        <li
                          key={idx}
                          className="flex gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 text-xs text-slate-900"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                {detailedGuide && detailedGuide.commonMistakes.length > 0 && (
                  <div className="rounded-xl border border-amber-200/85 bg-amber-50/60 p-3.5 text-xs">
                    <div className="text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                      Common Mistakes to Avoid
                    </div>
                    <ul className="mt-2 space-y-1.5 text-amber-950/90">
                      {detailedGuide.commonMistakes.map((m, idx) => (
                        <li key={idx} className="flex items-start gap-2 leading-relaxed">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-2 border-t border-zinc-100 pt-4">
                <Link
                  href={`/help?slug=${encodeURIComponent(activeSlug)}`}
                  onClick={() => setHelpOpen(false)}
                  className="rsl-btn-primary w-full"
                >
                  Open Full Guide Inside App
                </Link>
                <a
                  href={`${docsBaseUrl}/guides/${activeSlug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rsl-btn-secondary w-full"
                >
                  Open Help Center in New Tab ↗
                </a>
              </div>
            </aside>
          </div>
        );
      })()}
    </>
  );
}
