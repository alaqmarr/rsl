import Link from "next/link";
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
    <div className="mt-4 overflow-hidden rounded-2xl border border-indigo-950 bg-gradient-to-br from-[#0B1220] via-[#131C33] to-[#1E1B4B] p-3.5 text-white shadow-[0_14px_28px_-10px_rgba(11,18,32,0.5)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-wider text-indigo-200/85 uppercase">
          Operations Pulse
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
            totalPending > 0
              ? "bg-amber-400/20 text-amber-200 ring-amber-400/40"
              : "bg-emerald-400/15 text-emerald-300 ring-emerald-400/35"
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

      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between text-slate-300">
          <span>Plan Requests</span>
          <span className="font-mono font-bold text-white tabular-nums">
            {pendingPlanRequestsCount}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-300">
          <span>Wallet Top-Ups</span>
          <span className="font-mono font-bold text-white tabular-nums">
            {pendingWalletRequestsCount}
          </span>
        </div>
        {canViewBilling && (
          <div className="flex items-center justify-between border-t border-white/10 pt-2 text-slate-300">
            <span>Revenue Collected</span>
            <span className="font-mono font-bold text-emerald-300 tabular-nums">
              {formatInr(adminData.totals.totalInvoicedRevenuePaise)}
            </span>
          </div>
        )}
      </div>

      {totalPending > 0 && (
        <div className="mt-2.5 border-t border-white/10 pt-2">
          <ActionLink
            href="/"
            className="text-xs font-semibold text-amber-300 hover:text-amber-200 hover:underline"
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
    <div className="flex min-h-screen w-full bg-[#EEF2F7] text-slate-900 lg:h-screen lg:overflow-hidden">
      {/* Elevated Fixed Left Control-Plane Sidebar (Z-30) */}
      <aside className="relative z-30 hidden border-r border-slate-200/95 bg-white px-4 py-5 shadow-[4px_0_24px_-12px_rgba(15,23,42,0.12)] lg:flex lg:h-full lg:w-[272px] lg:shrink-0 lg:flex-col lg:justify-between lg:overflow-hidden">
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-2 px-1.5">
            <Link href="/" className="min-w-0">
              <BrandLogo variant="long" size="sm" subtitle="Staff Control Plane" />
            </Link>
            <span className="shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-800 uppercase">
              {formatStaffRoleLabel(staff.staffRole)}
            </span>
          </div>

          {statusSummaryCard}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <AdminSidebarNav pendingApprovalsCount={totalPending} allowedHrefs={allowedHrefs} />
        </div>

        <div className="shrink-0 border-t border-zinc-100 px-2 pt-4">
          <div className="flex items-center gap-2.5">
            <UserAvatar name={staff.name} seed={staff.email} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-900">{staff.name}</div>
              <div className="truncate text-[11px] text-zinc-500">{staff.email}</div>
            </div>
          </div>

          <form action={staffLogoutAction} className="mt-3">
            <SubmitButton
              spinnerSize="xs"
              pendingText="Signing out..."
              className="adm-btn-secondary w-full text-xs"
            >
              Sign Out
            </SubmitButton>
          </form>
        </div>
      </aside>

      {/* Independent Full-Width Main Scroll Column (Z-0 Layered Canvas) */}
      <div
        className="relative flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto"
        style={{
          backgroundImage:
            "radial-gradient(55% 420px at 18% 0%, rgba(67, 56, 202, 0.07) 0%, transparent 75%), radial-gradient(45% 380px at 88% 0%, rgba(217, 119, 6, 0.05) 0%, transparent 75%)",
        }}
      >
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
