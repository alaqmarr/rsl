import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getWorkspaceSetupProgress } from "@rsl/analytics";
import {
  getPlatformBillingSettings,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  listServicesWithWorkspaceState,
  MIN_WALLET_BALANCE_PAISE,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { formatInr, getEnv } from "@rsl/core";
import {
  canRoleAccessWebRoute,
  formatRoleLabel,
  getPermissionsForRole,
} from "@rsl/rbac";
import { BrandLogo, PlatformFooter, UserAvatar } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { WorkspaceAccessProvider } from "@/components/workspace-access-context";
import { SidebarNavLinks, TopWorkspaceBar } from "@/components/workspace-chrome";
import { logoutAction, switchWorkspaceAction } from "@/lib/actions";
import { getOptionalWebSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getOptionalWebSession();
  if (!session) {
    return <>{children}</>;
  }
  const env = getEnv();
  const grantedPermissions = Array.from(
    getPermissionsForRole(session.roleSlug, session.workspace.id)
  );
  const canViewBusinessSettings = canRoleAccessWebRoute(
    session.roleSlug,
    "/settings/business",
    session.workspace.id
  );
  const canViewBilling = canRoleAccessWebRoute(
    session.roleSlug,
    "/billing",
    session.workspace.id
  );
  const homeHref = canRoleAccessWebRoute(session.roleSlug, "/", session.workspace.id)
    ? "/"
    : canRoleAccessWebRoute(session.roleSlug, "/inbox", session.workspace.id)
      ? "/inbox"
      : canViewBilling
        ? "/billing"
        : "/settings/profile";

  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const walletFormatted = formatInr(walletBalancePaise, { showDecimals: true });
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isNegativeWallet = walletBalancePaise < 0;
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;

  const workspaceServices = listServicesWithWorkspaceState(session.workspace.id);
  const unlockedToolsCount = workspaceServices.filter((s) => s.isUnlocked).length;
  const setupProgress = getWorkspaceSetupProgress(session.workspace.id);
  const billingSettings = getPlatformBillingSettings();
  const isSuspended = session.workspace.billingStatus === "suspended";
  const setupPct = Math.round(
    (setupProgress.doneCount / Math.max(1, setupProgress.totalCount)) * 100
  );

  const footerLinks = [
    { label: "Plans & GST Invoices", href: "/billing" },
    { label: "Backups", href: "/backups" },
    { label: "Workspace Health", href: "/status" },
    { label: "Help Guides", href: "/help" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Refunds", href: "/refund-policy" },
    { label: "Legal", href: "/legal" },
  ].filter((link) => canRoleAccessWebRoute(session.roleSlug, link.href, session.workspace.id));

  const workspaceSwitcherCard = (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-br from-[#0B1220] via-slate-900 to-[#1E1B4B] p-3.5 text-white shadow-[0_14px_28px_-10px_rgba(11,18,32,0.45)]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-wider text-indigo-200/80 uppercase">
          Active Business
        </span>
        {isSuspended ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200 ring-1 ring-amber-400/40">
            Paused
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Active
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-bold tracking-tight text-white">
          {session.workspace.name}
        </div>
        {canViewBusinessSettings && (
          <ActionLink
            href="/settings/business"
            spinnerSize="xs"
            className="shrink-0 text-[11px] font-semibold text-indigo-300 hover:text-white hover:underline"
          >
            Settings
          </ActionLink>
        )}
      </div>
      {session.workspace.industry && (
        <div className="mt-0.5 truncate text-[11px] text-slate-400">
          {session.workspace.industry}
        </div>
      )}

      {session.workspaces.length > 1 && (
        <form action={switchWorkspaceAction} className="mt-2.5 flex items-center gap-1.5">
          <select
            name="workspaceId"
            defaultValue={session.workspace.id}
            className="w-full rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs font-medium text-white"
          >
            {session.workspaces.map((w) => (
              <option key={w.id} value={w.id} className="bg-slate-900 text-white">
                {w.name}
              </option>
            ))}
          </select>
          <SubmitButton
            spinnerSize="xs"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-400"
          >
            Switch
          </SubmitButton>
        </form>
      )}

      <div className="mt-3 space-y-2 border-t border-white/10 pt-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-300">Active Tools</span>
          {canViewBilling ? (
            <ActionLink
              href="/billing"
              spinnerSize="xs"
              className="font-mono font-bold text-indigo-200 tabular-nums hover:text-white hover:underline"
            >
              {unlockedToolsCount} / {workspaceServices.length}
            </ActionLink>
          ) : (
            <span className="font-mono font-bold text-indigo-200 tabular-nums">
              {unlockedToolsCount} / {workspaceServices.length}
            </span>
          )}
        </div>

        {canViewBilling && (
          <div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-300">Prepaid Wallet</span>
              <ActionLink
                href="/billing?tab=wallet"
                spinnerSize="xs"
                className={`font-mono font-bold tabular-nums hover:underline ${
                  isOverdraftExhausted
                    ? "text-rose-300 hover:text-rose-200"
                    : isNegativeWallet
                      ? "text-amber-300 hover:text-amber-200"
                      : "text-emerald-300 hover:text-emerald-200"
                }`}
              >
                {walletFormatted}
              </ActionLink>
            </div>
            {isNegativeWallet && (
              <div
                className={`mt-0.5 text-[10px] font-medium tabular-nums ${
                  isOverdraftExhausted ? "text-rose-300" : "text-amber-300"
                }`}
              >
                {isOverdraftExhausted
                  ? `${formatInr(MIN_WALLET_BALANCE_PAISE)} overdraft limit reached`
                  : `Overdraft active • ${formatInr(walletAvailableSpendPaise, { showDecimals: true })} left of ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)}`}
              </div>
            )}
          </div>
        )}

        {setupProgress.doneCount < setupProgress.totalCount && (
          <div>
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Setup progress</span>
              <span className="font-mono font-semibold text-white tabular-nums">
                {setupProgress.doneCount}/{setupProgress.totalCount}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all"
                style={{ width: `${setupPct}%` }}
              />
            </div>
            {(() => {
              const nextMilestone = setupProgress.milestones.find((m) => !m.done);
              return nextMilestone ? (
                <ActionLink
                  href={nextMilestone.href}
                  spinnerSize="xs"
                  className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-300 hover:text-emerald-200 hover:underline"
                >
                  <span>Next: {nextMilestone.label} →</span>
                </ActionLink>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <WorkspaceAccessProvider roleSlug={session.roleSlug} permissions={grantedPermissions}>
      <div className="flex min-h-screen w-full flex-col bg-[#F1F5F9] text-slate-900 lg:h-screen lg:overflow-hidden">
        {session.impersonatorStaffId && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-xs font-medium text-amber-900 lg:px-10">
            <span className="inline-flex items-center gap-2">
              <span
                style={{ width: 8, height: 8, flexShrink: 0 }}
                className="h-2 w-2 rounded-full bg-amber-500"
              />
              <span>
                Support Session Active — Assisted by RSL Support • Reason:{" "}
                <strong>{session.impersonationReason}</strong> (auto-expires within 30 minutes)
              </span>
            </span>
            <a
              href="/api/auth/impersonate?exit=1"
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              End Support Session
            </a>
          </div>
        )}

        {isSuspended && (
          <div className="shrink-0 border-b border-red-200 bg-red-50 px-6 py-2.5 text-xs font-medium text-red-900 lg:px-10">
            <span className="inline-flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" />
              <span>
                Your business account is currently paused pending billing review. Contact{" "}
                <strong>{billingSettings.billingEmail}</strong> or{" "}
                <strong>{billingSettings.supportPhone}</strong>
                {canViewBilling ? (
                  <>
                    , or review your{" "}
                    <ActionLink href="/billing" spinnerSize="xs" className="font-bold underline">
                      Plans &amp; Invoices
                    </ActionLink>
                  </>
                ) : null}
                .
              </span>
            </span>
          </div>
        )}

        <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row lg:overflow-hidden">
          {/* Desktop Fixed Elevated Sidebar (Z-30 Plane) */}
          <aside className="relative z-30 hidden border-r border-slate-200/95 bg-white px-4 py-5 shadow-[4px_0_24px_-12px_rgba(15,23,42,0.10)] lg:flex lg:h-full lg:w-[272px] lg:shrink-0 lg:flex-col lg:justify-between lg:overflow-hidden">
            <div className="shrink-0">
              <div className="flex items-center justify-between gap-2 px-1.5">
                <Link href={homeHref} className="min-w-0">
                  <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
                </Link>
                <span
                  title={formatRoleLabel(session.roleSlug)}
                  className="shrink-0 rounded-md border border-indigo-200/80 bg-indigo-50/80 px-2 py-0.5 text-[10px] font-bold tracking-wide text-indigo-800 uppercase"
                >
                  {formatRoleLabel(session.roleSlug)}
                </span>
              </div>

              {workspaceSwitcherCard}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <SidebarNavLinks />
            </div>

            <div className="shrink-0 border-t border-zinc-200/80 px-1.5 pt-3.5">
              <Link
                href="/settings/profile"
                className="group flex items-center gap-2.5 rounded-xl p-1 -m-1 transition hover:bg-zinc-50"
              >
                <UserAvatar name={session.user.name} seed={session.user.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-semibold text-slate-900 group-hover:text-emerald-700">
                      {session.user.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-zinc-500 group-hover:text-emerald-700">
                      Profile
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">{session.user.email}</div>
                </div>
              </Link>
              <form action={logoutAction} className="mt-3">
                <SubmitButton
                  pendingText="Signing out..."
                  spinnerSize="xs"
                  className="rsl-btn-secondary w-full text-xs"
                >
                  Sign Out
                </SubmitButton>
              </form>
            </div>
          </aside>

          {/* Independent Scrolling Main Workspace Column (Z-0 Canvas with Multi-Tone Ambient Wash) */}
          <div
            className="relative flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto"
            style={{
              backgroundImage:
                "radial-gradient(55% 420px at 15% 0%, rgba(67, 56, 202, 0.055) 0%, transparent 75%), radial-gradient(45% 380px at 88% 0%, rgba(5, 150, 105, 0.055) 0%, transparent 75%)",
            }}
          >
            <TopWorkspaceBar
              workspaceName={session.workspace.name}
              walletFormatted={walletFormatted}
              walletBalancePaise={walletBalancePaise}
              walletOverdraftLimitPaise={WALLET_OVERDRAFT_LIMIT_PAISE}
              docsBaseUrl={env.DOCS_URL}
              setupDoneCount={setupProgress.doneCount}
              setupTotalCount={setupProgress.totalCount}
              sidebarSlot={workspaceSwitcherCard}
            />

            <main className="w-full flex-1 px-5 py-6 lg:px-8 xl:px-10">
              {children}
            </main>

            <PlatformFooter
              suiteLabel="RapidShift Labs Marketing & Tally Suite"
              links={footerLinks}
            />
          </div>
        </div>
      </div>
    </WorkspaceAccessProvider>
  );
}
