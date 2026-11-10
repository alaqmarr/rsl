"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  ClipboardList,
  Command,
  FileText,
  HelpCircle,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  MailCheck,
  Menu,
  MessageSquare,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import {
  BrandLogo,
  GuideDrawer,
  IosSpinner,
  ThemeToggleButton,
  useDialogFocusTrap,
} from "@rsl/ui";
import {
  ADMIN_NAV_SECTIONS_META,
  resolveAdminPageGuide,
  type AdminNavIconKey,
} from "@/lib/nav-routes";

export interface AdminClientQuickEntry {
  id: string;
  name: string;
  gstin: string | null;
  billingStatus: string;
}

interface AdminNavSection {
  heading: string;
  items: Array<{
    href: string;
    label: string;
    keywords: string;
    summary: string;
    icon: React.ComponentType<{ className?: string }>;
    showPendingBadge?: boolean;
  }>;
}

const ADMIN_ICONS: Record<AdminNavIconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  clients: Building2,
  invoices: FileText,
  pricing: IndianRupee,
  templates: MessageSquare,
  queues: MailCheck,
  staff: ShieldCheck,
  inspector: ClipboardList,
  runbooks: BookOpen,
  credentials: KeyRound,
  setup: Wrench,
};

const ADMIN_SECTIONS: AdminNavSection[] = ADMIN_NAV_SECTIONS_META.map((section) => ({
  heading: section.heading,
  items: section.items.map((item) => ({
    href: item.href,
    label: item.label,
    keywords: item.keywords,
    summary: item.summary,
    icon: ADMIN_ICONS[item.iconKey] ?? LayoutDashboard,
    showPendingBadge: item.showPendingBadge,
  })),
}));

const ALL_ADMIN_ITEMS = ADMIN_SECTIONS.flatMap((s) => s.items);

export function AdminSidebarNav({
  pendingApprovalsCount,
  allowedHrefs,
  onNavigate,
}: {
  pendingApprovalsCount: number;
  allowedHrefs?: string[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const allowedSet = useMemo(
    () => (allowedHrefs ? new Set(allowedHrefs) : null),
    [allowedHrefs]
  );

  useEffect(() => {
    if (!isPending) setPendingHref(null);
  }, [isPending, pathname]);

  const visibleSections = useMemo(
    () =>
      ADMIN_SECTIONS.map((section) => ({
        ...section,
        items: allowedSet
          ? section.items.filter((item) => allowedSet.has(item.href))
          : section.items,
      })).filter((section) => section.items.length > 0),
    [allowedSet]
  );

  return (
    <div className="mt-3 space-y-3.5 pb-2" aria-label="Staff control plane navigation">
      {visibleSections.map((section) => {
        const hasActiveChild = section.items.some((item) =>
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`)
        );

        return (
          <div key={section.heading} className="rsl-nav-section">
            <div
              className={`rsl-nav-section-btn px-2.5 text-[10px] font-bold tracking-[0.08em] uppercase ${
                hasActiveChild
                  ? "rsl-nav-section-btn-active text-[var(--ink-strong)]"
                  : "text-[var(--ink-muted)]"
              }`}
            >
              <span className="truncate">{section.heading}</span>
            </div>

            <nav className="rsl-nav-group-rail mt-1 space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const isNavigatingHere = isPending && pendingHref === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    prefetch
                    onClick={(e) => {
                      if (
                        e.defaultPrevented ||
                        e.button !== 0 ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey
                      ) {
                        return;
                      }
                      onNavigate?.();
                      if (pathname === item.href) return;
                      e.preventDefault();
                      setPendingHref(item.href);
                      startTransition(() => {
                        router.push(item.href);
                      });
                    }}
                    aria-busy={isNavigatingHere}
                    className={`rsl-nav-item group flex w-full items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-all ${
                      active
                        ? "rsl-nav-item-active bg-[var(--forest-green)] font-semibold text-[var(--snow-white)] shadow-xs"
                        : isNavigatingHere
                          ? "rsl-nav-item-sunset font-semibold"
                          : "font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
                    }`}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2.5">
                      {isNavigatingHere ? (
                        <IosSpinner size="xs" className="text-[var(--sunset-orange)]" />
                      ) : (
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors ${
                            active
                              ? "text-[var(--sunset-orange)]"
                              : "text-[var(--ink-muted)] group-hover:text-[var(--ink-strong)]"
                          }`}
                        />
                      )}
                      <span className="truncate">{item.label}</span>
                    </span>

                    {item.showPendingBadge && pendingApprovalsCount > 0 ? (
                      <span className="rsl-pill rsl-pill-sunset !px-1.5 !py-0 font-mono text-[11px] font-bold tabular-nums">
                        {pendingApprovalsCount}
                      </span>
                    ) : active ? (
                      <span className="rsl-nav-dot h-2 w-2 shrink-0 rounded-full bg-[var(--sunset-orange)]" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        );
      })}
    </div>
  );
}

export function AdminTopBar({
  staffName,
  pendingPlanRequestsCount,
  pendingWalletRequestsCount,
  allowedHrefs,
  clients = [],
  appUrl,
  docsUrl,
  sidebarCardSlot,
}: {
  staffName: string;
  pendingPlanRequestsCount: number;
  pendingWalletRequestsCount: number;
  allowedHrefs?: string[];
  clients?: AdminClientQuickEntry[];
  appUrl: string;
  docsUrl: string;
  sidebarCardSlot?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isBarPending, startBarTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const mobileDrawerRef = React.useRef<HTMLElement>(null);
  const paletteDialogRef = React.useRef<HTMLDivElement>(null);

  useDialogFocusTrap(mobileDrawerRef, drawerOpen, () => setDrawerOpen(false));
  useDialogFocusTrap(paletteDialogRef, paletteOpen, () => setPaletteOpen(false));

  useEffect(() => {
    setActiveIndex(0);
  }, [query, paletteOpen]);
  const totalPending = pendingPlanRequestsCount + pendingWalletRequestsCount;
  const activePageGuide = useMemo(
    () => resolveAdminPageGuide(pathname || "/"),
    [pathname]
  );
  const allowedSet = useMemo(
    () => (allowedHrefs ? new Set(allowedHrefs) : null),
    [allowedHrefs]
  );
  const permittedAdminItems = useMemo(
    () =>
      allowedSet ? ALL_ADMIN_ITEMS.filter((i) => allowedSet.has(i.href)) : ALL_ADMIN_ITEMS,
    [allowedSet]
  );

  const activeItem =
    ALL_ADMIN_ITEMS.find((i) =>
      i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`)
    ) ?? ALL_ADMIN_ITEMS[0]!;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setDrawerOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredScreens = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return permittedAdminItems;
    return permittedAdminItems.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.keywords.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q)
    );
  }, [query, permittedAdminItems]);

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 6);
    return clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.gstin && c.gstin.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [clients, query]);

  return (
    <>
      <header className="rsl-frost-header sticky top-0 z-20 shrink-0">
        <div className="flex w-full items-center justify-between gap-2 px-3.5 py-3 sm:gap-4 sm:px-5 lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xs lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Staff Portal Home">
              <BrandLogo variant="mark" size="sm" />
            </Link>

            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="hidden font-mono text-[11px] font-bold tracking-wide text-indigo-700 uppercase sm:inline">
                Control Plane
              </span>
              <span className="hidden text-slate-300 sm:inline">/</span>
              <span className="truncate font-bold text-slate-950">{activeItem.label}</span>
              {isBarPending && <IosSpinner size="xs" className="text-indigo-600" />}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-2.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200/95 bg-slate-50/85 px-2.5 py-1.5 text-xs text-slate-500 shadow-2xs transition hover:border-indigo-300 hover:bg-white hover:text-slate-900 sm:gap-2.5 sm:px-3"
            >
              <Search className="h-3.5 w-3.5 text-indigo-500" />
              <span className="hidden sm:inline">Jump to client, invoice, or setting...</span>
              <span className="sm:hidden">Jump</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-indigo-200/80 bg-indigo-50/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 md:inline-flex">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </button>

            {totalPending > 0 && (
              <Link
                href="/"
                onClick={(e) => {
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey && pathname !== "/") {
                    e.preventDefault();
                    startBarTransition(() => router.push("/"));
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-800 tabular-nums transition hover:bg-amber-100/70 sm:px-3"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <span>
                  {totalPending} <span className="hidden sm:inline">waiting</span>
                </span>
              </Link>
            )}

            <ThemeToggleButton compact />

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rsl-guide-trigger"
              title="Open step-by-step Staff SOP guide for this screen"
            >
              <HelpCircle className="h-3.5 w-3.5 text-amber-600" />
              <span className="hidden md:inline">Need help?</span>
            </button>

            <a
              href={appUrl}
              target="_blank"
              rel="noreferrer"
              className="adm-btn-secondary hidden py-1.5 text-xs sm:inline-flex"
            >
              Client App ↗
            </a>
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="adm-btn-secondary hidden py-1.5 text-xs xl:inline-flex"
            >
              Help Center ↗
            </a>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="rsl-hard-blur-scrim fixed inset-0"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            ref={mobileDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Staff portal navigation menu"
            className="rsl-drawer-frost rsl-sidebar-scroll relative z-10 flex h-full w-72 max-w-[85vw] flex-col justify-between overflow-y-auto border-r p-4"
          >
            <div>
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <Link href="/" onClick={() => setDrawerOpen(false)}>
                  <BrandLogo variant="long" size="sm" subtitle={`Staff Portal • ${staffName}`} />
                </Link>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close staff menu"
                  className="rsl-icon-action-btn"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <AdminSidebarNav
                pendingApprovalsCount={totalPending}
                allowedHrefs={allowedHrefs}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
              {sidebarCardSlot}
              <div className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
                <BrandLogo variant="mark" size="xs" />
                <span>© {new Date().getFullYear()} RapidShift Labs</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Staff Command Palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && (
        <div className="rsl-hard-blur-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[11vh]">
          <div
            ref={paletteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Staff command palette"
            className="rsl-drawer-frost w-full max-w-xl overflow-hidden rounded-2xl border"
          >
            <div className="flex items-center gap-3 border-b border-zinc-200/70 px-4 py-3.5">
              <Search className="h-4 w-4 text-emerald-700" />
              <label htmlFor="admin-cmdk-input" className="sr-only">
                Search staff portal screens or client accounts
              </label>
              <input
                id="admin-cmdk-input"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  const totalEntries = filteredClients.length + filteredScreens.length;
                  if (totalEntries === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev + 1) % totalEntries);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((prev) => (prev - 1 + totalEntries) % totalEntries);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const clamped = Math.min(activeIndex, totalEntries - 1);
                    setPaletteOpen(false);
                    setQuery("");
                    if (clamped < filteredClients.length) {
                      const pickedClient = filteredClients[clamped];
                      if (pickedClient) {
                        startBarTransition(() => router.push(`/clients/${pickedClient.id}`));
                      }
                    } else {
                      const pickedScreen = filteredScreens[clamped - filteredClients.length];
                      if (pickedScreen) {
                        startBarTransition(() => router.push(pickedScreen.href));
                      }
                    }
                  }
                }}
                placeholder="Search client name, GSTIN, invoices, pricing, templates, or staff..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
              >
                ESC
              </button>
            </div>

            <div className="rsl-custom-scrollbar max-h-96 overflow-y-auto p-2" role="listbox">
              {filteredClients.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                    Client Accounts
                  </div>
                  {filteredClients.map((client, idx) => {
                    const isSelected = activeIndex === idx;
                    return (
                      <button
                        key={client.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => {
                          setPaletteOpen(false);
                          setQuery("");
                          startBarTransition(() => router.push(`/clients/${client.id}`));
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition ${
                          isSelected
                            ? "bg-emerald-50/90 ring-1 ring-emerald-200/80"
                            : "hover:bg-emerald-50/70"
                        }`}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-bold text-slate-800">
                            {client.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-900">
                              {client.name}
                            </span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {client.gstin ? `GSTIN ${client.gstin}` : "Open full client controls"}
                            </span>
                          </span>
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            client.billingStatus === "suspended"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {client.billingStatus === "suspended" ? "Paused" : "Active"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Staff Screens
                </div>
                {filteredScreens.map((item, idx) => {
                  const entryIndex = filteredClients.length + idx;
                  const isSelected = activeIndex === entryIndex;
                  const Icon = item.icon;
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
                          : "hover:bg-zinc-50"
                      }`}
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-emerald-600">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-slate-900">
                          {item.label}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500">
                          {item.summary}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200/70 bg-zinc-50/75 px-4 py-2 text-[11px] text-zinc-500">
              <span>↑↓ Navigate • ↵ Open • Esc Close</span>
              <span className="font-mono">Ctrl+K / ⌘K</span>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Staff Page Guide Bottom Drawer */}
      <GuideDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        guide={{
          eyebrow: "Staff Screen SOP Guide",
          title: activePageGuide?.title ?? "Server Health Matrix & Staff SOP Runbooks",
          summary:
            activePageGuide?.summary ??
            "Inspect live TCP/HTTP reachability of ports 4500-4503 and review the complete Staff Standard Operating Procedure (SOP) runbooks covering UTR verification, WhatsApp/Tally onboarding support, PM2/SSL deployment, and disaster recovery.",
          roleNote: activePageGuide?.roleNote ?? "Available to all Staff roles",
          steps: activePageGuide?.steps ?? [],
          cautions: activePageGuide?.cautions,
          fullGuideHref: "/runbooks",
          fullGuideLabel: "All Staff SOP Runbooks →",
          externalHref: docsUrl,
          externalLabel: "Customer Help Center",
        }}
      />
    </>
  );
}
