"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BrandLogo,
  GuideDrawer,
  IosSpinner,
  ThemeToggleButton,
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
  labelHi: string;
  badge?: string | number;
  keywords: string;
  helpTitle: string;
  helpSummary: string;
  helpSteps: string[];
  guideSlug: string;
}

interface RawNavSeed {
  href: string;
  label: string;
  labelHi: string;
  keywords: string;
  fallbackGuideSlug: string;
}

function hydrateNavItem(seed: RawNavSeed): NavItemDef {
  const guide = resolveWebPageGuide(seed.href);
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

export const WORKSPACE_NAV_SECTIONS: Array<{
  id: string;
  heading: string;
  headingHi: string;
  items: NavItemDef[];
}> = [
  {
    id: "overview",
    heading: "Overview & Intelligence",
    headingHi: "अवलोकन और विश्लेषण",
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
    id: "tally",
    heading: "Tally Prime & Accounting",
    headingHi: "टैली और लेखा विभाग",
    items: [
      hydrateNavItem({
        href: "/tally",
        label: "Tally Prime & Bills",
        labelHi: "टैली प्राइम और बिल",
        keywords:
          "tally xml csv tdl webhook automation invoices vouchers receipts payments paid overdue reminders pdf",
        fallbackGuideSlug: "tally-sync-and-import",
      }),
      hydrateNavItem({
        href: "/tally/parties",
        label: "Client & Party Ledgers",
        labelHi: "पार्टी खाता बही",
        keywords:
          "clients parties customers suppliers debtors creditors ledgers statement running balance ageing credit limit paid",
        fallbackGuideSlug: "tally-sync-and-import",
      }),
      hydrateNavItem({
        href: "/inventory",
        label: "Inventory & Stock",
        labelHi: "स्टॉक और गोदाम",
        keywords:
          "inventory stock items godowns warehouse batches expiry reorder dead stock valuation price list",
        fallbackGuideSlug: "tally-sync-and-import",
      }),
    ],
  },
  {
    id: "marketing",
    heading: "Marketing & Campaigns",
    headingHi: "मार्केटिंग और अभियान",
    items: [
      hydrateNavItem({
        href: "/whatsapp",
        label: "WhatsApp & Templates",
        labelHi: "व्हाट्सऐप और टेम्पलेट",
        keywords:
          "whatsapp templates manager header buttons variables bulk broadcast opt-in stop unsubscribed",
        fallbackGuideSlug: "whatsapp-and-broadcasts",
      }),
      hydrateNavItem({
        href: "/campaigns",
        label: "Ads & Social Posts",
        labelHi: "विज्ञापन और पोस्ट",
        keywords: "meta facebook instagram ads pixel scheduled posts",
        fallbackGuideSlug: "ads-social-posts-and-website-conversions",
      }),
      hydrateNavItem({
        href: "/reviews",
        label: "Google Reviews",
        labelHi: "गूगल रिव्यू",
        keywords: "google business profile stars ratings replies",
        fallbackGuideSlug: "google-reviews-and-smart-replies",
      }),
    ],
  },
  {
    id: "support",
    heading: "Customer Support Desk",
    headingHi: "ग्राहक सहायता डेस्क",
    items: [
      hydrateNavItem({
        href: "/inbox",
        label: "Customer Messages",
        labelHi: "ग्राहक संदेश",
        keywords: "inbox chat whatsapp instagram facebook sla replies",
        fallbackGuideSlug: "shared-inbox-and-customer-messages",
      }),
    ],
  },
  {
    id: "channels",
    heading: "Channels, API & Vault",
    headingHi: "चैनल, एपीआई और बैकअप",
    items: [
      hydrateNavItem({
        href: "/connections",
        label: "Connected Channels",
        labelHi: "जुड़े हुए चैनल",
        keywords: "whatsapp meta facebook instagram google drive ads reviews connect oauth",
        fallbackGuideSlug: "connecting-channels-whatsapp-meta-google",
      }),
      hydrateNavItem({
        href: "/settings/tokens",
        label: "All API Tokens",
        labelHi: "एपीआई टोकन और कुंजी",
        keywords:
          "api tokens keys bearer tally webhook verify whatsapp meta instagram secret rotate",
        fallbackGuideSlug: "developer-api",
      }),
      hydrateNavItem({
        href: "/backups",
        label: "Backups & Storage",
        labelHi: "बैकअप और स्टोरेज",
        keywords: "cloud storage backup restore export import",
        fallbackGuideSlug: "storage-r2-and-backups",
      }),
    ],
  },
  {
    id: "administration",
    heading: "Administration & Billing",
    headingHi: "प्रशासन और बिलिंग",
    items: [
      hydrateNavItem({
        href: "/billing",
        label: "Plans & Wallet",
        labelHi: "प्लान और वॉलेट",
        keywords: "wallet recharge utr upi gst invoice plans services rupees overdraft negative",
        fallbackGuideSlug: "plans-wallet-and-gst",
      }),
      hydrateNavItem({
        href: "/settings/team",
        label: "Team & Roles",
        labelHi: "टीम और भूमिकाएँ",
        keywords: "team members invite roles permissions staff colleague",
        fallbackGuideSlug: "team-roles-security-and-business-settings",
      }),
    ],
  },
  {
    id: "audit",
    heading: "Audit, Health & Guides",
    headingHi: "ऑडिट, स्वास्थ्य और गाइड",
    items: [
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

function isItemActiveForPathname(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/tally") {
    return pathname === "/tally" || pathname.startsWith("/tally/vouchers/");
  }
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/settings/tokens" &&
      (pathname === "/developers" || pathname.startsWith("/developers/")))
  );
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

  const visibleSections = useMemo(
    () =>
      WORKSPACE_NAV_SECTIONS.map((sec) => ({
        id: sec.id,
        heading: locale === "hi" ? sec.headingHi : sec.heading,
        items: sec.items.filter((item) => canAccessRoute(item.href)),
      })).filter((sec) => sec.items.length > 0),
    [canAccessRoute, locale]
  );

  useEffect(() => {
    if (!isPending) {
      setPendingHref(null);
    }
  }, [isPending, pathname]);

  return (
    <nav className="mt-3 space-y-3.5 pb-2" aria-label="Workspace navigation">
      {visibleSections.map((sec) => {
        const hasActiveChild = sec.items.some((item) =>
          isItemActiveForPathname(item.href, pathname)
        );

        return (
          <div key={sec.id} className="rsl-nav-section">
            <div
              className={`rsl-nav-section-btn px-2.5 text-[10px] font-bold tracking-[0.08em] uppercase ${
                hasActiveChild
                  ? "rsl-nav-section-btn-active text-[var(--ink-strong)]"
                  : "text-[var(--ink-muted)]"
              }`}
            >
              <span className="truncate">{sec.heading}</span>
            </div>

            <ul className="rsl-nav-group-rail mt-1 space-y-0.5">
              {sec.items.map((item) => {
                const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
                const isActive = isItemActiveForPathname(item.href, pathname);
                const isItemLoading = isPending && pendingHref === item.href;
                const displayLabel = locale === "hi" ? item.labelHi : item.label;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
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
                      className={`rsl-nav-item group flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-all ${
                        isActive
                          ? "rsl-nav-item-active bg-[var(--forest-green)] font-semibold text-[var(--snow-white)] shadow-xs"
                          : isItemLoading
                            ? "rsl-nav-item-sunset font-semibold"
                            : "font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2.5 truncate">
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors ${
                            isActive
                              ? "text-[var(--sunset-orange)]"
                              : isItemLoading
                                ? "text-[var(--sunset-orange)]"
                                : "text-[var(--ink-muted)] group-hover:text-[var(--ink-strong)]"
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
              })}
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

  const allItems = useMemo(
    () => [...WORKSPACE_NAV_SECTIONS.flatMap((s) => s.items), ...DOCK_ONLY_WORKSPACE_ITEMS],
    []
  );
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
        href: "/billing?tab=wallet",
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
              <Search className="h-3.5 w-3.5 text-emerald-700" />
              <span className="hidden xl:inline">
                {locale === "hi"
                  ? "स्क्रीन, टैली या टेम्पलेट खोजें..."
                  : "Jump to screen, Tally, templates, or help..."}
              </span>
              <span className="hidden sm:inline xl:hidden">
                {locale === "hi" ? "खोजें" : "Search"}
              </span>
              <kbd className="hidden items-center gap-0.5 rounded-md border border-slate-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 md:inline-flex">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {canViewBilling && (
              <Link
                href="/billing?tab=wallet"
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
                    startBarTransition(() => router.push("/billing?tab=wallet"));
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

            <ThemeToggleButton />

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
                        const Icon = ICON_BY_HREF[item.href] || LayoutDashboard;
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
