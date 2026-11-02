"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandLogo, IosSpinner } from "@rsl/ui";
import { useWorkspaceAccess } from "@/components/workspace-access-context";
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

export const WORKSPACE_NAV_SECTIONS: Array<{
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
        guideSlug: "getting-started",
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
        guideSlug: "whatsapp-and-broadcasts",
      },
      {
        href: "/tally",
        label: "Tally Prime & Bills",
        keywords: "tally xml csv tdl webhook automation invoices vouchers receipts overdue reminders pdf",
        helpTitle: "Automatic WhatsApp Bills & Native Tally PDFs",
        helpSummary:
          "Connect Tally Prime using our .tdl v2.5 add-on, dedicated *.tally.rapidshiftlabs.in webhook URL, or Windows PC connector so your exact Tally-printed PDF invoices go out on WhatsApp automatically.",
        helpSteps: [
          "Download the pre-configured Tally Prime .tdl v2.5 add-on or pair the Windows Connector.",
          "Create an automation rule using tally_tax_invoice_pdf so customers receive your exact untouched Tally-printed PDF invoice.",
          "Edits, cancellations (Alt+X), and deletions (Alt+D) sync automatically across single or multiple companies.",
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
        guideSlug: "getting-started",
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
        guideSlug: "getting-started",
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
        guideSlug: "getting-started",
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
        guideSlug: "plans-wallet-and-gst",
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
        guideSlug: "getting-started",
      },
      {
        href: "/connections",
        label: "Connected Channels",
        keywords: "whatsapp meta facebook instagram google drive connect whitelisting webhook verify",
        helpTitle: "Connecting WhatsApp, Instagram, Facebook & Google",
        helpSummary:
          "Follow step-by-step whitelisting checklists and link WhatsApp Cloud API, Instagram Business, Facebook Pages, and Google Business Profile.",
        helpSteps: [
          "Complete the Meta / Google whitelisting checklist for your channel.",
          "Paste your Permanent System User token and click Test Live API to verify connectivity.",
        ],
        guideSlug: "getting-started",
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
  "/whatsapp": MessageSquareShare,
  "/campaigns": Megaphone,
  "/reviews": Star,
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
          <div className="px-2.5 text-[10px] font-bold tracking-[0.08em] text-zinc-400 uppercase">
            {sec.heading}
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {sec.items.map((item) => {
              const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
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
                        ? "bg-emerald-50/90 font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                        : isItemLoading
                          ? "bg-zinc-100/80 font-semibold text-slate-900"
                          : "font-medium text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                    }`}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2.5 truncate">
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          isActive
                            ? "text-emerald-600"
                            : isItemLoading
                              ? "text-slate-900"
                              : "text-zinc-400 group-hover:text-slate-700"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {isItemLoading ? (
                      <IosSpinner size="xs" className="text-emerald-600" />
                    ) : isActive ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
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
      <header className="sticky top-0 z-30 shrink-0 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md">
        <div className="flex w-full items-center justify-between gap-4 px-5 py-3 lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-slate-900 shadow-2xs lg:hidden"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Home">
              <BrandLogo variant="mark" size="sm" />
            </Link>
            <div className="inline-flex min-w-0 items-center gap-2 text-xs">
              <span className="hidden font-medium text-zinc-500 sm:inline">{workspaceName}</span>
              <span className="hidden text-zinc-300 sm:inline">/</span>
              <span className="truncate font-semibold text-slate-900">{currentItem.label}</span>
              {isBarPending && <IosSpinner size="xs" className="text-emerald-600" />}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-200/90 bg-zinc-50/70 px-3 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-300 hover:bg-white hover:text-slate-900"
            >
              <Search className="h-3.5 w-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Jump to screen, Tally, templates, or help...</span>
              <span className="sm:hidden">Search</span>
              <kbd className="hidden items-center gap-0.5 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 md:inline-flex">
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition hover:bg-zinc-50"
              title="Open help for this page"
            >
              <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
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
          <div className="relative z-10 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-white p-4 shadow-2xl">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                  <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sidebarSlot}
              <SidebarNavLinks onNavigate={() => setMobileMenuOpen(false)} />
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400">
              <BrandLogo variant="mark" size="xs" />
              <span>© {new Date().getFullYear()} RapidShift Labs</span>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/35 px-4 pt-[12vh] backdrop-blur-xs">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5">
              <Search className="h-4 w-4 text-emerald-600" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a page or task (e.g. Tally bills, WhatsApp templates, Wallet, Backups)..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500"
              >
                ESC
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
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
                filteredItems.map((item) => {
                  const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setQuery("");
                        startBarTransition(() => router.push(item.href));
                      }}
                      className="flex w-full items-start gap-3 rounded-xl px-3.5 py-2.5 text-left transition hover:bg-emerald-50/60"
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
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contextual Help Drawer */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs"
            onClick={() => setHelpOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
                <div>
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/70">
                    Page Guide
                  </span>
                  <h2 className="mt-2 text-lg font-bold tracking-tight text-slate-900">
                    {currentItem.helpTitle}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs leading-relaxed text-zinc-600">{currentItem.helpSummary}</p>

              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">Setup Progress</span>
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

              <div>
                <h3 className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                  How to use this screen
                </h3>
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
              </div>
            </div>

            <div className="mt-6 space-y-2 border-t border-zinc-100 pt-4">
              <Link
                href={`/help?slug=${encodeURIComponent(currentItem.guideSlug)}`}
                onClick={() => setHelpOpen(false)}
                className="rsl-btn-primary w-full"
              >
                Open Full Guide Inside App
              </Link>
              <a
                href={`${docsBaseUrl}/guides/${currentItem.guideSlug}`}
                target="_blank"
                rel="noreferrer"
                className="rsl-btn-secondary w-full"
              >
                Open Help Center in New Tab ↗
              </a>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
