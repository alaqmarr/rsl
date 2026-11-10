import Link from "next/link";
import { AlertTriangle, LogOut, MailCheck, Settings, UserCircle2 } from "lucide-react";
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
import {
  logoutAction,
  resendVerificationEmailAction,
  switchWorkspaceAction,
  verifyEmailCodeAction,
} from "@/lib/actions";
import { getOptionalWebSession, getWebLocale } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, locale] = await Promise.all([getOptionalWebSession(), getWebLocale()]);
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
    <div className="rsl-hero-surface overflow-hidden rounded-xl p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-[0.06em] uppercase text-[var(--butter-cream)]/85">
          Active Business
        </span>
        <div className="inline-flex items-center gap-1.5">
          {canViewBilling ? (
            <ActionLink
              href="/billing"
              spinnerSize="xs"
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--butter-cream)] tabular-nums ring-1 ring-white/15 hover:bg-white/20 hover:text-white"
            >
              {unlockedToolsCount}/{workspaceServices.length} tools
            </ActionLink>
          ) : (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--butter-cream)] tabular-nums ring-1 ring-white/15">
              {unlockedToolsCount}/{workspaceServices.length} tools
            </span>
          )}
          {isSuspended ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-semibold text-white ring-1 ring-amber-400/40">
              Paused
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--butter-cream)] ring-1 ring-white/20">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--sunset-orange)]" />
              Active
            </span>
          )}
        </div>
      </div>

      {session.workspaces.length > 1 ? (
        <form action={switchWorkspaceAction} className="mt-1.5 flex items-center gap-1.5">
          <select
            name="workspaceId"
            defaultValue={session.workspace.id}
            aria-label="Switch active business workspace"
            className="min-w-0 flex-1 truncate rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs font-semibold text-white"
          >
            {session.workspaces.map((w) => (
              <option key={w.id} value={w.id} className="bg-slate-900 text-white">
                {w.name}
              </option>
            ))}
          </select>
          <SubmitButton
            spinnerSize="xs"
            className="rsl-btn-spark shrink-0 !min-h-6 !px-2.5 !py-1 !text-[11px]"
          >
            Switch
          </SubmitButton>
        </form>
      ) : (
        <div className="mt-1 truncate text-xs font-semibold tracking-[-0.01em] text-white">
          {session.workspace.name}
        </div>
      )}

      {canViewBilling && isNegativeWallet && (
        <div className="mt-1.5 text-[10.5px] font-medium text-[var(--sunset-orange)] tabular-nums">
          {isOverdraftExhausted
            ? `${formatInr(MIN_WALLET_BALANCE_PAISE)} overdraft limit reached`
            : `Overdraft active • ${formatInr(walletAvailableSpendPaise, { showDecimals: true })} left`}
        </div>
      )}

      {setupProgress.doneCount < setupProgress.totalCount && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5 text-[11px]">
          <span className="text-white/80 tabular-nums">
            Setup <strong className="text-white">{setupProgress.doneCount}/{setupProgress.totalCount}</strong>
          </span>
          {(() => {
            const nextMilestone = setupProgress.milestones.find((m) => !m.done);
            return nextMilestone ? (
              <ActionLink
                href={nextMilestone.href}
                spinnerSize="xs"
                className="truncate font-semibold text-[var(--butter-cream)] hover:text-white hover:underline"
              >
                <span>Next: {nextMilestone.label} →</span>
              </ActionLink>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );

  return (
    <WorkspaceAccessProvider roleSlug={session.roleSlug} permissions={grantedPermissions}>
      <div className="flex min-h-screen w-full flex-col bg-[var(--canvas)] text-[var(--ink)] lg:h-screen lg:overflow-hidden">
        {session.impersonatorStaffId && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-xs font-medium text-amber-900 lg:px-10">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span>
                Support Session Active - Assisted by RSL Support • Reason:{" "}
                <strong>{session.impersonationReason}</strong> (auto-expires within 30 minutes)
              </span>
            </span>
            <form method="post" action="/api/auth/impersonate">
              <input type="hidden" name="intent" value="exit" />
              <button
                type="submit"
                className="rsl-btn-secondary !min-h-7 !px-2.5 !py-1 !text-xs"
              >
                End Support Session
              </button>
            </form>
          </div>
        )}

        {!session.user.emailVerified && !session.impersonatorStaffId && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50/90 px-6 py-2.5 text-xs text-amber-950 lg:px-10">
            <span className="inline-flex items-center gap-2 font-medium">
              <MailCheck className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Verify your work email (<strong>{session.user.email}</strong>) before inviting team
                members, issuing API keys, or launching outbound broadcasts.
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <form action={verifyEmailCodeAction} className="inline-flex items-center gap-1.5">
                <input type="hidden" name="returnPath" value="/" />
                <label htmlFor="banner-verify-code" className="sr-only">
                  6-digit email verification code
                </label>
                <input
                  id="banner-verify-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="6-digit code"
                  className="rsl-input !min-h-7 !w-28 !px-2.5 !py-1 font-mono !text-xs"
                />
                <SubmitButton
                  spinnerSize="xs"
                  className="rsl-btn-primary !min-h-7 !px-3 !py-1 !text-xs"
                >
                  Verify
                </SubmitButton>
              </form>
              <form action={resendVerificationEmailAction}>
                <input type="hidden" name="returnPath" value="/" />
                <SubmitButton
                  spinnerSize="xs"
                  className="rsl-btn-secondary !min-h-7 !px-2.5 !py-1 !text-xs"
                >
                  Resend Code
                </SubmitButton>
              </form>
            </div>
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
          {/* Desktop Fixed Frosted Sidebar */}
          <aside className="rsl-frost-sidebar relative z-30 hidden px-3.5 py-4 lg:flex lg:h-full lg:w-[276px] lg:shrink-0 lg:flex-col lg:justify-between lg:overflow-hidden">
            {/* Top Brand Header - Clean & Uncluttered */}
            <div className="shrink-0 border-b border-[var(--border)] px-1.5 pb-3">
              <Link href={homeHref} className="inline-flex min-w-0">
                <BrandLogo variant="long" size="sm" subtitle="Growth & Tally Suite" />
              </Link>
            </div>

            {/* Scrollable Deeply Categorized Navigation */}
            <div className="rsl-sidebar-scroll min-h-0 flex-1 overflow-y-auto pr-1">
              <SidebarNavLinks locale={locale} />
            </div>

            {/* Bottom Dock: Active Business Card + Smart Account, Profile & Settings Dock */}
            <div className="shrink-0 space-y-2 border-t border-[var(--border)] pt-2.5">
              {workspaceSwitcherCard}

              <div className="rsl-account-dock rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-2.5">
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={session.user.name} seed={session.user.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold tracking-[-0.01em] text-[var(--ink)]">
                        {session.user.name}
                      </span>
                      <span
                        title={formatRoleLabel(session.roleSlug)}
                        className="rsl-pill rsl-pill-forest shrink-0 !px-1.5 !py-0 !text-[10px]"
                      >
                        {formatRoleLabel(session.roleSlug)}
                      </span>
                    </div>
                    <div className="truncate text-[11px] text-[var(--ink-muted)]">
                      {session.user.email}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border)] pt-2">
                  <ActionLink
                    href="/settings/profile"
                    spinnerSize="xs"
                    className="rsl-account-dock-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-secondary)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-strong)]"
                  >
                    <UserCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Your Profile</span>
                  </ActionLink>

                  {canViewBusinessSettings && (
                    <ActionLink
                      href="/settings/business"
                      spinnerSize="xs"
                      aria-label="Open Business Settings"
                      title="Business Settings"
                      className="rsl-icon-action-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink-secondary)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-strong)]"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </ActionLink>
                  )}

                  <form action={logoutAction} className="shrink-0">
                    <SubmitButton
                      pendingText="..."
                      spinnerSize="xs"
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

          {/* Independent Scrolling Main Workspace Column */}
          <div className="rsl-ambient-canvas rsl-custom-scrollbar relative flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-y-auto">
            <TopWorkspaceBar
              workspaceName={session.workspace.name}
              walletFormatted={walletFormatted}
              walletBalancePaise={walletBalancePaise}
              walletOverdraftLimitPaise={WALLET_OVERDRAFT_LIMIT_PAISE}
              docsBaseUrl={env.DOCS_URL}
              setupDoneCount={setupProgress.doneCount}
              setupTotalCount={setupProgress.totalCount}
              sidebarSlot={workspaceSwitcherCard}
              locale={locale}
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
