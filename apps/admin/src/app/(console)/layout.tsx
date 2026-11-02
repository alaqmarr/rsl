import Link from "next/link";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  canStaffPerform,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { formatInr, getEnv } from "@rsl/core";
import { BrandLogo, PlatformFooter } from "@rsl/ui";
import { AdminSidebarNav, AdminTopBar } from "@/components/admin-nav";
import { AdminPageWalkthroughBanner } from "@/components/admin-page-guide";
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
    <div className="mt-4 rounded-2xl border border-zinc-200/90 bg-zinc-50/75 p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-zinc-500">Operations Pulse</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            totalPending > 0
              ? "bg-amber-100/80 text-amber-800"
              : "bg-emerald-100/80 text-emerald-800"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              totalPending > 0 ? "bg-amber-500" : "bg-emerald-600"
            }`}
          />
          {totalPending > 0 ? `${totalPending} Pending` : "All Clear"}
        </span>
      </div>

      <div className="mt-2.5 space-y-1.5 text-xs">
        <div className="flex items-center justify-between text-zinc-600">
          <span>Plan Requests</span>
          <span className="font-bold text-slate-900 tabular-nums">{pendingPlanRequestsCount}</span>
        </div>
        <div className="flex items-center justify-between text-zinc-600">
          <span>Wallet Top-Ups</span>
          <span className="font-bold text-slate-900 tabular-nums">{pendingWalletRequestsCount}</span>
        </div>
        {canViewBilling && (
          <div className="flex items-center justify-between border-t border-zinc-200/75 pt-1.5 text-zinc-600">
            <span>Revenue Collected</span>
            <span className="font-bold text-emerald-700 tabular-nums">
              {formatInr(adminData.totals.totalInvoicedRevenuePaise)}
            </span>
          </div>
        )}
      </div>

      {totalPending > 0 && (
        <div className="mt-2.5 border-t border-zinc-200/75 pt-2">
          <ActionLink
            href="/"
            className="text-xs font-semibold text-emerald-700 hover:underline"
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
    { label: "Client App ↗", href: env.APP_URL, external: true },
  ];

  return (
    <div className="flex min-h-screen w-full bg-[#F8F9FB] text-slate-900 lg:h-screen lg:overflow-hidden">
      {/* Quiet Fixed Non-Scrolling Left Sidebar */}
      <aside className="hidden border-r border-zinc-200/90 bg-white px-4 py-5 lg:flex lg:h-full lg:w-[268px] lg:shrink-0 lg:flex-col lg:justify-between lg:overflow-hidden">
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-2 px-1.5">
            <Link href="/" className="min-w-0">
              <BrandLogo variant="long" size="sm" subtitle="Operations & Billing" />
            </Link>
            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-zinc-600 uppercase">
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
              {staff.name.slice(0, 1).toUpperCase()}
            </span>
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

      {/* Independent Full-Width Main Scroll Column */}
      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto">
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
          <AdminPageWalkthroughBanner />
          {children}
        </main>

        <PlatformFooter suiteLabel="RSL Staff & Billing Console" links={footerLinks} />
      </div>
    </div>
  );
}
