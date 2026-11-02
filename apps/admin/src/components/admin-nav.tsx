"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  ClipboardList,
  Command,
  FileText,
  HelpCircle,
  IndianRupee,
  LayoutDashboard,
  MailCheck,
  Menu,
  MessageSquare,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { BrandLogo, IosSpinner } from "@rsl/ui";
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
  const pathname = usePathname();
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
    <div className="mt-4 space-y-5 pb-2">
      {visibleSections.map((section) => (
        <div key={section.heading}>
          <div className="mb-1.5 px-3 text-[10px] font-bold tracking-[0.08em] text-zinc-400 uppercase">
            {section.heading}
          </div>
          <nav className="space-y-0.5">
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
                  className={`group flex items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-all ${
                    active
                      ? "bg-emerald-50/90 font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                      : isNavigatingHere
                        ? "bg-zinc-100 font-semibold text-slate-900"
                        : "font-medium text-zinc-600 hover:bg-zinc-100/80 hover:text-slate-900"
                  }`}
                >
                  <span className="inline-flex min-w-0 items-center gap-2.5">
                    {isNavigatingHere ? (
                      <IosSpinner size="xs" className="text-emerald-600" />
                    ) : (
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          active
                            ? "text-emerald-600"
                            : "text-zinc-400 group-hover:text-zinc-700"
                        }`}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </span>

                  {item.showPendingBadge && pendingApprovalsCount > 0 ? (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white tabular-nums">
                      {pendingApprovalsCount}
                    </span>
                  ) : active ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
      ))}
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
      <header className="sticky top-0 z-30 shrink-0 border-b border-zinc-200/85 bg-white/90 backdrop-blur-md">
        <div className="flex w-full items-center justify-between gap-2 px-3.5 py-3 sm:gap-4 sm:px-5 lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-slate-900 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link href="/" className="shrink-0 lg:hidden" aria-label="Staff Portal Home">
              <BrandLogo variant="mark" size="sm" />
            </Link>

            <div className="flex min-w-0 items-center gap-2 text-xs">
              <span className="hidden font-medium text-zinc-400 sm:inline">Staff Portal</span>
              <span className="hidden text-zinc-300 sm:inline">/</span>
              <span className="truncate font-semibold text-slate-900">{activeItem.label}</span>
              {isBarPending && <IosSpinner size="xs" className="text-emerald-600" />}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-2.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-300 hover:bg-white hover:text-slate-900 sm:gap-2.5 sm:px-3"
            >
              <Search className="h-3.5 w-3.5 text-zinc-400" />
              <span className="hidden sm:inline">Jump to client, invoice, or setting...</span>
              <span className="sm:hidden">Jump</span>
              <kbd className="hidden items-center gap-0.5 rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 md:inline-flex">
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
                <span style={{ width: 8, height: 8, flexShrink: 0 }} className="h-2 w-2 rounded-full bg-amber-500" />
                <span>
                  {totalPending} <span className="hidden sm:inline">waiting</span>
                </span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100/80 sm:px-3"
              title="Open step-by-step Staff SOP guide for this screen"
            >
              <HelpCircle className="h-3.5 w-3.5 text-emerald-600" />
              <span className="hidden md:inline">Page Guide</span>
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
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-white p-4 shadow-2xl">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <Link href="/" onClick={() => setDrawerOpen(false)}>
                  <BrandLogo variant="long" size="sm" subtitle={`Staff Portal • ${staffName}`} />
                </Link>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sidebarCardSlot}
              <AdminSidebarNav
                pendingApprovalsCount={totalPending}
                allowedHrefs={allowedHrefs}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-400">
              <BrandLogo variant="mark" size="xs" />
              <span>© {new Date().getFullYear()} RapidShift Labs</span>
            </div>
          </aside>
        </div>
      )}

      {/* Staff Command Palette (Ctrl+K / Cmd+K) */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/35 px-4 pt-[11vh] backdrop-blur-xs">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5">
              <Search className="h-4 w-4 text-emerald-600" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search client name, GSTIN, invoices, pricing, templates, or staff..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500"
              >
                ESC
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto p-2">
              {filteredClients.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                    Client Accounts
                  </div>
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setQuery("");
                        startBarTransition(() => router.push(`/clients/${client.id}`));
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition hover:bg-emerald-50/70"
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
                  ))}
                </div>
              )}

              <div>
                <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                  Staff Screens
                </div>
                {filteredScreens.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setQuery("");
                        startBarTransition(() => router.push(item.href));
                      }}
                      className="flex w-full items-start gap-3 rounded-xl px-3.5 py-2.5 text-left transition hover:bg-zinc-50"
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
          </div>
        </div>
      )}

      {/* Contextual Staff Page Guide Slide-Over Drawer */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-xs"
            onClick={() => setHelpOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-lg flex-col justify-between overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-emerald-800 uppercase ring-1 ring-emerald-200">
                    Staff Screen SOP Guide
                  </span>
                  <h2 className="mt-2 text-base font-bold text-slate-900">
                    {activePageGuide?.title ?? "Server Health Matrix & Staff SOP Runbooks"}
                  </h2>
                  <p className="mt-1 text-xs font-medium text-emerald-700">
                    {activePageGuide?.roleNote ??
                      "Available to all Staff roles — live port telemetry + complete Markdown SOP runbooks."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  aria-label="Close guide"
                  className="rounded-xl border border-zinc-200 p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs leading-relaxed text-zinc-600">
                {activePageGuide?.summary ??
                  "Inspect live TCP/HTTP reachability of ports 4500–4503 at the top of this screen, and read the 4 complete Staff Standard Operating Procedure (SOP) runbooks below covering UTR verification, WhatsApp/Tally onboarding support, Oracle PM2/SSL deployment, and disaster recovery."}
              </p>

              {activePageGuide && activePageGuide.steps.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                    Step-by-Step Staff Procedure ({activePageGuide.steps.length} Steps)
                  </div>
                  <ol className="space-y-2.5">
                    {activePageGuide.steps.map((step, idx) => (
                      <li
                        key={idx}
                        className="flex gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/70 p-3.5 text-xs"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-semibold text-slate-900">{step.title}</div>
                          <p className="leading-relaxed text-zinc-600">{step.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {activePageGuide && activePageGuide.cautions.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    <span>Important Finance &amp; Security Check</span>
                  </div>
                  <ul className="mt-1.5 space-y-1 text-amber-950/90">
                    {activePageGuide.cautions.map((c, idx) => (
                      <li key={idx} className="leading-relaxed">
                        • {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-2 border-t border-zinc-100 pt-4 sm:flex-row">
              <Link
                href="/runbooks"
                onClick={() => setHelpOpen(false)}
                className="adm-btn-primary flex-1 justify-center text-center text-xs"
              >
                All Staff SOP Runbooks →
              </Link>
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="adm-btn-secondary flex-1 justify-center text-center text-xs"
              >
                Customer Help Center ↗
              </a>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
