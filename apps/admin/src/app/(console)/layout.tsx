import Link from "next/link";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  canStaffPerform,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { formatInr, getEnv } from "@rsl/core";
import { BrandLogo, PlatformFooter, UserAvatar } from "@rsl/ui";
import { AdminSidebarNav, AdminTopBar } from "@/components/admin-nav";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { staffLogoutAction } from "@/lib/actions";
import { ADMIN_NAV_HREFS } from "@/lib/nav-routes";
import { requireStaffSession } from "@/lib/session";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireStaffSession();
  const env = getEnv();
  const adminData = getPlatformAdminAnalytics();
  const pendingPlanRequestsCount = adminData.totals.pendingPlanRequestsCount;
  const pendingWalletRequestsCount = adminData.totals.pendingWalletRequestsCount;
  const totalPending = pendingPlanRequestsCount + pendingWalletRequestsCount;
  const canViewBilling = canStaffPerform(staff.staffRole, "staff:billing.view");
  const allowedHrefs = ADMIN_NAV_HREFS.filter((href) =>
    canStaffAccessAdminRoute(staff.staffRole, href)
  );

  const quickClients = adminData.businesses.map((b) => ({
    id: b.id,
    name: b.name,
    gstin: b.gstin,
    billingStatus: b.billingStatus,
  }));

  const statusSummaryCard = (
    <div className="rsl-hero-surface overflow-hidden rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold tracking-[-0.01em] text-[var(--ink-on-dark-muted)]">
          Operations Pulse
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
            totalPending > 0
              ? "bg-amber-400/20 text-amber-200 ring-amber-400/40"
              : "bg-white/10 text-[var(--ink-on-dark)] ring-white/20"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              totalPending > 0 ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          {totalPending > 0 ? `${totalPending} Pending` : "All Clear"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="text-[var(--ink-on-dark-muted)]">
          <div className="text-[11px]">Plan Requests</div>
          <div className="font-semibold text-[var(--ink-on-dark)] tabular-nums">
            {pendingPlanRequestsCount}
          </div>
        </div>
        <div className="text-right text-[var(--ink-on-dark-muted)]">
          <div className="text-[11px]">Wallet Top-Ups</div>
          <div className="font-semibold text-[var(--ink-on-dark)] tabular-nums">
            {pendingWalletRequestsCount}
          </div>
        </div>
      </div>

      {canViewBilling && (
        <div className="mt-2 flex items-center justify-between border-t border-white/15 pt-1.5 text-xs text-[var(--ink-on-dark-muted)]">
          <span>Revenue Collected</span>
          <span className="font-semibold text-amber-300 tabular-nums">
            {formatInr(adminData.totals.totalInvoicedRevenuePaise)}
          </span>
        </div>
      )}

      {totalPending > 0 && (
        <div className="mt-1.5 border-t border-white/15 pt-1.5">
          <ActionLink
            href="/"
            className="text-[11.5px] font-semibold text-amber-300 hover:text-amber-200 hover:underline"
          >
            Review pending approvals →
          </ActionLink>
        </div>
      )}
    </div>
  );

  const footerLinks = [
    ...(canStaffAccessAdminRoute(staff.staffRole, "/invoices")
      ? [{ label: "GST Ledger", href: "/invoices" }]
      : []),
    ...(canStaffAccessAdminRoute(staff.staffRole, "/pricing")
      ? [{ label: "Plan Pricing", href: "/pricing" }]
      : []),
    ...(canStaffAccessAdminRoute(staff.staffRole, "/runbooks")
      ? [{ label: "Server Health", href: "/runbooks" }]
      : []),
    { label: "Legal & Policies ↗", href: `${env.APP_URL}/legal`, external: true },
    { label: "Client App ↗", href: env.APP_URL, external: true },
  ];

  return (
    <div className="flex min-h-screen w-full bg-[var(--canvas)] text-slate-900 lg:h-screen lg:overflow-hidden">
      {/* Elevated Fixed Left Control-Plane Sidebar (Z-30) */}
      <aside className="rsl-frost-sidebar relative z-30 hidden px-3.5 py-4 lg:flex lg:h-full lg:w-[276px] lg:shrink-0 lg:flex-col lg:justify-between lg:overflow-hidden">
        {/* Clean Brand Header */}
        <div className="shrink-0 border-b border-[var(--border)] px-1.5 pb-3">
          <Link href="/" className="inline-flex min-w-0">
            <BrandLogo variant="long" size="sm" subtitle="Staff Control Plane" />
          </Link>
        </div>

        {/* Scrollable Categorized Control Plane Navigation */}
        <div className="rsl-sidebar-scroll min-h-0 flex-1 overflow-y-auto pr-1">
          <AdminSidebarNav pendingApprovalsCount={totalPending} allowedHrefs={allowedHrefs} />
        </div>

        {/* Bottom Dock: Operations Pulse + Staff Account, MFA & Settings Dock */}
        <div className="shrink-0 space-y-2 border-t border-[var(--border)] pt-2.5">
          {statusSummaryCard}

          <div className="rsl-account-dock rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-2.5">
            <div className="flex items-center gap-2.5">
              <UserAvatar name={staff.name} seed={staff.email} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold tracking-[-0.01em] text-[var(--ink)]">
                    {staff.name}
                  </span>
                  <span className="rsl-pill rsl-pill-forest shrink-0 !px-1.5 !py-0 !text-[10px]">
                    {formatStaffRoleLabel(staff.staffRole)}
                  </span>
                </div>
                <div className="truncate text-[11px] text-[var(--ink-muted)]">{staff.email}</div>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border)] pt-2">
              <Link
                href="/mfa"
                className="rsl-account-dock-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-secondary)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-strong)]"
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{staff.totpEnabled ? "MFA Active" : "Setup MFA"}</span>
              </Link>

              {canStaffAccessAdminRoute(staff.staffRole, "/setup") && (
                <Link
                  href="/setup"
                  aria-label="Open Platform Setup & Settings"
                  title="Platform Setup & Settings"
                  className="rsl-icon-action-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-secondary)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-strong)]"
                >
                  <Settings className="h-3.5 w-3.5" />
                </Link>
              )}

              <form action={staffLogoutAction} className="shrink-0">
                <SubmitButton
                  spinnerSize="xs"
                  pendingText="..."
                  aria-label="Sign Out"
                  title="Sign Out"
                  className="rsl-icon-action-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-secondary)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-strong)]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* Independent Full-Width Main Scroll Column (Z-0 Layered Canvas) */}
      <div className="rsl-ambient-canvas rsl-custom-scrollbar relative flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto">
        <AdminTopBar
          staffName={staff.name}
          pendingPlanRequestsCount={pendingPlanRequestsCount}
          pendingWalletRequestsCount={pendingWalletRequestsCount}
          allowedHrefs={allowedHrefs}
          clients={quickClients}
          appUrl={env.APP_URL}
          docsUrl={env.DOCS_URL}
          sidebarCardSlot={statusSummaryCard}
        />

        <main className="w-full flex-1 px-5 py-6 lg:px-8 xl:px-10">
          {children}
        </main>

        <PlatformFooter suiteLabel="RSL Staff & Billing Console" links={footerLinks} />
      </div>
    </div>
  );
}
