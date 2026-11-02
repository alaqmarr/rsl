import { desc, eq } from "drizzle-orm";
import {
  CheckCircle2,
  Clock,
  Landmark,
  Layers,
  QrCode,
  ReceiptText,
  Wallet,
} from "lucide-react";
import {
  BILLING_CYCLE_META,
  getPlatformBillingSettings,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  isRazorpayCheckoutConfigured,
  listBundlesWithWorkspaceState,
  listLedgerEntries,
  listServicesWithWorkspaceState,
  listWorkspacePlanRequests,
  listWorkspaceRechargeRequests,
  MIN_WALLET_BALANCE_PAISE,
  WALLET_OVERDRAFT_LIMIT_PAISE,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { controlDb } from "@rsl/tenancy";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { PlanActivationModal } from "@/components/plan-activation-modal";
import {
  createOnlineRazorpayOrderAction,
  submitRechargeRequestAction,
} from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

const FEATURE_PAGE_BY_KEY: Record<string, { href: string; label: string }> = {
  inbox: { href: "/inbox", label: "Open Customer Messages →" },
  "whatsapp.messaging": { href: "/whatsapp", label: "Open WhatsApp & Templates →" },
  "whatsapp.broadcast": { href: "/whatsapp", label: "Open Broadcasts →" },
  "tally.sync": { href: "/tally", label: "Open Tally Prime & Bills →" },
  "tally.invoicing": { href: "/tally?tab=rules", label: "Open Tally Automation →" },
  "meta.pages": { href: "/campaigns", label: "Open Social Posts →" },
  "meta.instagram": { href: "/campaigns", label: "Open Instagram Posts →" },
  "meta.pixel": { href: "/campaigns", label: "Open Sales Tracking →" },
  "meta.ads": { href: "/campaigns", label: "Open Ad Campaigns →" },
  "google.reviews": { href: "/reviews", label: "Open Google Reviews →" },
  "google.autoreply": { href: "/reviews", label: "Open Review Replies →" },
  "backup.export": { href: "/backups", label: "Open Backups →" },
  "storage.managed": { href: "/backups", label: "Open Storage →" },
  "backup.custom": { href: "/backups", label: "Open Storage →" },
  "api.access": { href: "/developers", label: "Open Developer API →" },
};

export default async function BillingAndWalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/billing", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Plans, Prepaid Wallet & GST Invoices"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View plans, wallet & invoices"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const canManageBilling = canRolePerform(
    session.roleSlug,
    "billing:manage",
    session.workspace.id
  );
  const activeTab =
    sp.tab === "wallet" || sp.tab === "invoices" ? sp.tab : "plans";
  const planFilter = sp.filter || "all";

  const walletBalancePaise = getWalletBalancePaise(session.workspace.id);
  const walletAvailableSpendPaise = getWalletAvailableSpendPaise(walletBalancePaise);
  const isOverdraftExhausted = walletBalancePaise <= MIN_WALLET_BALANCE_PAISE;
  const freeAccess = getWorkspaceFreeAccessStatus(session.workspace.id);
  const services = listServicesWithWorkspaceState(session.workspace.id);
  const bundles = listBundlesWithWorkspaceState(session.workspace.id);
  const planRequests = listWorkspacePlanRequests(session.workspace.id, 25);
  const ledger = listLedgerEntries(session.workspace.id, 40);
  const rechargeRequests = listWorkspaceRechargeRequests(session.workspace.id, 15);
  const razorpayReady = isRazorpayCheckoutConfigured();
  const billingSettings = getPlatformBillingSettings();

  const invoices = controlDb()
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.workspaceId, session.workspace.id))
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(40)
    .all();

  const activeCount = services.filter((s) => s.isUnlocked).length;
  const pendingPlanCount = services.filter(
    (s) => !s.isUnlocked && Boolean(s.pendingRequest)
  ).length;
  const availablePlanCount = services.filter(
    (s) => !s.isUnlocked && !s.pendingRequest
  ).length;
  const allToolsUnlocked = services.length > 0 && activeCount === services.length;
  const unlockedKeySet = new Set(
    services.filter((s) => s.isUnlocked).map((s) => s.key)
  );
  const serviceNameByKey = new Map(services.map((s) => [s.key, s.name]));

  const availableBundles = bundles.filter((b) => !b.isFullyUnlocked);
  const unlockedBundles = bundles.filter((b) => b.isFullyUnlocked);

  const pendingRechargeCount = rechargeRequests.filter(
    (r) => r.status === "pending_verification"
  ).length;

  const visibleServices = services.filter((svc) => {
    if (allToolsUnlocked) return true;
    if (planFilter === "active") return svc.isUnlocked;
    if (planFilter === "requested") return !svc.isUnlocked && Boolean(svc.pendingRequest);
    if (planFilter === "available") return !svc.isUnlocked && !svc.pendingRequest;
    return true;
  });

  const filterOptions = [
    { key: "all", label: `All (${services.length})`, show: true },
    { key: "active", label: `Active (${activeCount})`, show: activeCount > 0 },
    { key: "requested", label: `Pending (${pendingPlanCount})`, show: pendingPlanCount > 0 },
    { key: "available", label: `Available (${availablePlanCount})`, show: availablePlanCount > 0 },
  ].filter((f) => f.show);

  const showStatementPdfButton =
    ledger.length > 0 || invoices.length > 0 || activeCount > 0 || freeAccess.isActive;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={
          allToolsUnlocked
            ? "Active Suite, Prepaid Wallet & GST"
            : "Subscriptions, Bundles, Wallet & GST"
        }
        title={
          allToolsUnlocked
            ? "Active Tools, Prepaid Wallet & GST Invoices"
            : "Plans, Bundles, Prepaid Wallet & GST Invoices"
        }
        subtitle={
          allToolsUnlocked
            ? `All ${services.length} RSL Marketing tools are unlocked on your business account. Manage your prepaid wallet for metered WhatsApp sends and download official GST tax invoices & statements.`
            : "Choose Monthly, Quarterly, or Yearly billing on individual plans or dependency bundles, scan live UPI QR codes, download official PDF invoices & statements, and manage your prepaid wallet."
        }
        actions={
          showStatementPdfButton ? (
            <div className="flex flex-wrap items-center gap-2">
              <a href="/api/pdf/wallet-statement" className="rsl-btn-secondary text-xs">
                Download Billing Statement PDF
              </a>
            </div>
          ) : undefined
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Complimentary Free Access Banner (if granted by Staff) */}
      {freeAccess.isActive && freeAccess.untilMs && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/85 p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Complimentary Full-Platform Access" tone="emerald" />
                <span className="text-xs font-semibold text-emerald-900 tabular-nums">
                  {freeAccess.remainingDays} day(s) remaining • Valid until{" "}
                  {new Date(freeAccess.untilMs).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] font-medium text-emerald-950">
                All {services.length} RSL Marketing tools are active and ready to use on your account
                {freeAccess.note &&
                !/^complimentary full-platform access$/i.test(freeAccess.note.trim())
                  ? ` (${freeAccess.note.trim()})`
                  : ""}
                . Only metered WhatsApp messages and smart review drafts deduct from your Prepaid Wallet when sent.
              </p>
            </div>
            <ActionLink
              href="/billing?tab=wallet"
              spinnerSize="xs"
              className="rsl-btn-secondary bg-white py-1.5 text-xs"
            >
              Manage Prepaid Wallet →
            </ActionLink>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Prepaid Wallet Balance"
          value={formatInr(walletBalancePaise, { showDecimals: true })}
          sublabel={
            walletBalancePaise < 0
              ? isOverdraftExhausted
                ? "Overdraft limit (-₹200.00) reached — recharge to resume metered sends"
                : `Using ₹200 overdraft • ${formatInr(walletAvailableSpendPaise, { showDecimals: true })} left down to -₹200.00`
              : pendingRechargeCount > 0
                ? `${pendingRechargeCount} top-up(s) awaiting verification`
                : `Includes ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft buffer down to -₹200.00`
          }
          accent={isOverdraftExhausted ? "ruby" : walletBalancePaise < 0 ? "amber" : "emerald"}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Unlocked Tools"
          value={`${activeCount} of ${services.length}`}
          sublabel={
            freeAccess.isActive
              ? `Complimentary all-tools access (${freeAccess.remainingDays}d left)`
              : allToolsUnlocked
                ? "Complete platform unlocked on your account"
                : "Active tools on your business account"
          }
          accent="sky"
          icon={<Layers className="h-4 w-4" />}
        />
        {pendingPlanCount > 0 ? (
          <MetricCard
            label="Pending Activations"
            value={String(pendingPlanCount)}
            sublabel="Awaiting payment verification by billing desk"
            accent="amber"
            icon={<Clock className="h-4 w-4" />}
          />
        ) : allToolsUnlocked ? (
          <MetricCard
            label="Platform Coverage"
            value="100% Active"
            sublabel={
              freeAccess.isActive && freeAccess.untilMs
                ? `Valid until ${new Date(freeAccess.untilMs).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}`
                : `All ${services.length} workspace tools ready`
            }
            accent="emerald"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        ) : (
          <MetricCard
            label="Available Plans"
            value={String(availablePlanCount)}
            sublabel="Select any individual plan or value bundle below"
            accent="default"
            icon={<Clock className="h-4 w-4" />}
          />
        )}
        <MetricCard
          label="GST Tax Invoices"
          value={String(invoices.length)}
          sublabel={`State ${session.workspace.stateCode} (${
            session.workspace.stateCode === "27" ? "9% CGST + 9% SGST" : "18% IGST"
          })`}
          icon={<ReceiptText className="h-4 w-4" />}
        />
      </div>

      {/* Segmented Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                key: "plans",
                label: allToolsUnlocked
                  ? `Active Tools (${activeCount}/${services.length})`
                  : `Bundles & Feature Plans (${activeCount}/${services.length})`,
              },
              {
                key: "wallet",
                label: `Prepaid Wallet & Passbook`,
              },
              {
                key: "invoices",
                label: `GST Invoices & PDF Downloads (${invoices.length})`,
              },
            ] as const
          ).map((t) => {
            const active = activeTab === t.key;
            return (
              <ActionLink
                key={t.key}
                href={`/billing?tab=${t.key}`}
                spinnerSize="xs"
                className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-zinc-600 hover:bg-zinc-100/80 hover:text-slate-900"
                }`}
              >
                {t.label}
              </ActionLink>
            );
          })}
        </div>

        <div className="hidden items-center gap-2 pr-2 text-[11px] text-zinc-500 md:flex">
          {activeTab === "wallet" || !allToolsUnlocked || pendingPlanCount > 0 ? (
            <>
              <span>Bank / UPI:</span>
              <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono font-bold text-slate-900 select-all">
                {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                  ? billingSettings.upiId
                  : `${billingSettings.accountNumber} (${billingSettings.ifscCode})`}
              </code>
              <span>•</span>
              <span>Support: {billingSettings.supportPhone}</span>
            </>
          ) : (
            <>
              <span>Billing Support:</span>
              <span className="font-semibold text-slate-700">{billingSettings.billingEmail}</span>
              <span>•</span>
              <span>{billingSettings.supportPhone}</span>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: BUNDLES + FEATURE PLANS */}
      {activeTab === "plans" && (
        <div className="space-y-6">
          {/* SECTION 1A: AVAILABLE VALUE BUNDLES (hidden when all tools are already unlocked) */}
          {availableBundles.length > 0 && (
            <SectionCard
              title="Value Bundles & Complete All-in-One Software Package"
              subtitle="Save on dependent tools that work together — or unlock the entire 15-tool RSL Marketing platform on Monthly, Quarterly, or Yearly billing."
              action={<StatusPill label="Monthly • Quarterly • Yearly Cycles" tone="emerald" />}
            >
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {availableBundles.map((bundle) => {
                  const isAllFeatures = bundle.key === "all_features";
                  const bundlePending = Boolean(bundle.pendingRequest);

                  return (
                    <div
                      key={bundle.key}
                      className={`flex h-full flex-col justify-between rounded-2xl border p-5 text-[13px] transition ${
                        isAllFeatures
                          ? "border-slate-900/20 bg-slate-50/70 ring-1 ring-slate-900/5 lg:col-span-2"
                          : bundlePending
                            ? "border-amber-200 bg-amber-50/30"
                            : "border-zinc-200/90 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
                                  isAllFeatures
                                    ? "bg-slate-900 text-white"
                                    : "bg-emerald-100 text-emerald-900"
                                }`}
                              >
                                {bundle.badgeLabel}
                              </span>
                              {bundle.hasCustomOverride && (
                                <StatusPill label="Tailored Client Rate" tone="emerald" />
                              )}
                              {bundle.unlockedCount > 0 && (
                                <span className="text-[11px] font-medium text-emerald-700 tabular-nums">
                                  {bundle.unlockedCount}/{bundle.totalServicesCount} already active
                                </span>
                              )}
                            </div>
                            <h3 className="text-base font-bold tracking-tight text-slate-900">
                              {bundle.name}
                            </h3>
                            <p className="text-xs leading-relaxed text-zinc-600">
                              {bundle.tagline}
                            </p>
                          </div>

                          <div className="rounded-xl border border-zinc-200/90 bg-white px-4 py-2.5 text-right shadow-2xs tabular-nums">
                            {bundle.savingsMonthlyPaise > 0 && (
                              <div className="text-[11px] font-semibold text-emerald-700">
                                Save {formatInr(bundle.savingsMonthlyPaise)}/mo vs separate plans
                              </div>
                            )}
                            <div className="text-xl font-extrabold tracking-tight text-slate-900">
                              {formatInr(bundle.monthlyAmountPaise)}
                              <span className="ml-1 text-xs font-medium text-zinc-500">/ mo</span>
                            </div>
                            <div className="text-[11px] text-zinc-500">
                              Quarterly: <strong className="text-slate-700">{formatInr(bundle.quarterlyAmountPaise)}</strong> • Yearly:{" "}
                              <strong className="text-slate-700">{formatInr(bundle.yearlyAmountPaise)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-zinc-200/70 bg-white/90 p-3">
                          <div className="mb-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                            Included Tools ({bundle.totalServicesCount})
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {bundle.includedKeys.map((svcKey) => {
                              const svcName = serviceNameByKey.get(svcKey) ?? svcKey;
                              const alreadyActive = unlockedKeySet.has(svcKey);
                              return (
                                <span
                                  key={svcKey}
                                  className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                                    alreadyActive
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                      : "border-zinc-200 bg-zinc-50 text-slate-800"
                                  }`}
                                >
                                  {svcName}
                                  {alreadyActive ? " (Active)" : ""}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/70 pt-3.5">
                        <span className="text-xs text-zinc-500">
                          + 18% GST •{" "}
                          {bundle.unlockedCount > 0
                            ? `Unlocks ${bundle.remainingLockedCount} remaining tool(s) on a single GST tax invoice`
                            : `Unlocks all ${bundle.totalServicesCount} tools on a single GST tax invoice`}
                        </span>

                        <PlanActivationModal
                          targetType="bundle"
                          targetKey={bundle.key}
                          targetName={bundle.name}
                          tagline={bundle.tagline}
                          includedItems={bundle.includedServiceNames}
                          monthlyPaise={bundle.monthlyAmountPaise}
                          quarterlyPaise={bundle.quarterlyAmountPaise}
                          yearlyPaise={bundle.yearlyAmountPaise}
                          hasCustomRate={bundle.hasCustomOverride}
                          isUnlocked={bundle.isFullyUnlocked}
                          isPending={bundlePending}
                          pendingCycle={bundle.pendingRequest?.billingCycle}
                          workspaceSlug={session.workspace.slug}
                          billingSettings={billingSettings}
                          canManageBilling={canManageBilling}
                          triggerLabel={
                            isAllFeatures
                              ? "Request Full Software Package"
                              : "Request Bundle Activation"
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Compact summary when SOME (not all) bundles are already fully active */}
          {!allToolsUnlocked && unlockedBundles.length > 0 && (
            <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/50 px-5 py-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-950">
                  Active Bundle Package(s) on Your Account:
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {unlockedBundles.map((b) => (
                    <StatusPill
                      key={b.key}
                      label={`${b.name} (${b.totalServicesCount}/${b.totalServicesCount} active)`}
                      tone="emerald"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 1B: INDIVIDUAL MODULAR SERVICE PLANS / ACTIVE TOOLS */}
          <SectionCard
            title={
              allToolsUnlocked
                ? `Your Active Platform Tools (${activeCount} of ${services.length})`
                : "Individual Modular Service Plans"
            }
            subtitle={
              allToolsUnlocked
                ? "Every RSL Marketing tool is unlocked on your business account — jump directly into any workspace tool below."
                : "Pick individual tools a la carte on Monthly, Quarterly, or Yearly billing — click Request Activation to open your UPI QR code."
            }
            action={
              !allToolsUnlocked && filterOptions.length > 2 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {filterOptions.map((f) => {
                    const active = planFilter === f.key;
                    return (
                      <ActionLink
                        key={f.key}
                        href={
                          f.key === "all"
                            ? "/billing?tab=plans"
                            : `/billing?tab=plans&filter=${f.key}`
                        }
                        spinnerSize="xs"
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                          active
                            ? "bg-emerald-600 text-white"
                            : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {f.label}
                      </ActionLink>
                    );
                  })}
                </div>
              ) : allToolsUnlocked ? (
                <StatusPill label="All Tools Ready" tone="emerald" />
              ) : undefined
            }
          >
            {visibleServices.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                No plans match this filter.{" "}
                <ActionLink href="/billing?tab=plans" className="font-semibold text-emerald-700 underline">
                  Show all plans
                </ActionLink>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {visibleServices.map((svc) => {
                  const isPending = !svc.isUnlocked && Boolean(svc.pendingRequest);
                  const featureLink = FEATURE_PAGE_BY_KEY[svc.key];
                  const missingDepNames = svc.dependsOn
                    .filter((depKey) => !unlockedKeySet.has(depKey))
                    .map((depKey) => serviceNameByKey.get(depKey) ?? depKey);

                  return (
                    <div
                      key={svc.key}
                      className={`flex h-full flex-col justify-between rounded-2xl border p-5 text-[13px] transition ${
                        svc.isUnlocked
                          ? "border-emerald-200 bg-emerald-50/35"
                          : isPending
                            ? "border-amber-200 bg-amber-50/30"
                            : "border-zinc-200/90 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                                {svc.category}
                              </span>
                              {!svc.isComplimentaryFreeAccess && svc.hasCustomPriceOverride && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                  Custom Rate
                                </span>
                              )}
                            </div>
                            <h3 className="mt-0.5 text-[15px] font-bold tracking-tight text-slate-900">
                              {svc.name}
                            </h3>
                          </div>
                          <StatusPill
                            label={
                              svc.isComplimentaryFreeAccess
                                ? "Free Access"
                                : svc.isUnlocked
                                  ? `Active (${BILLING_CYCLE_META[svc.billingCycle].shortLabel})`
                                  : isPending
                                    ? "Pending Payment"
                                    : "Available"
                            }
                            tone={svc.isUnlocked ? "emerald" : isPending ? "amber" : "stone"}
                          />
                        </div>

                        <p className="leading-relaxed text-zinc-600">{svc.details.tagline}</p>

                        <div className="rounded-xl border border-zinc-200/70 bg-white/85 p-3.5">
                          <div className="mb-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                            Included Features
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-800">
                            {svc.details.includedFeatures.map((feat) => (
                              <li key={feat} className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {!svc.isUnlocked && missingDepNames.length > 0 && (
                          <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900">
                            Works with: <strong>{missingDepNames.join(" + ")}</strong>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 space-y-3 border-t border-zinc-200/70 pt-3.5">
                        {svc.isUnlocked ? (
                          <div className="space-y-2.5">
                            {(() => {
                              const isWalletMetered = [
                                "whatsapp.messaging",
                                "whatsapp.broadcast",
                                "tally.invoicing",
                                "google.autoreply",
                              ].includes(svc.key);
                              if (
                                svc.unitAmountPaise <= 0 ||
                                (!isWalletMetered && svc.isComplimentaryFreeAccess)
                              ) {
                                return null;
                              }
                              return (
                                <div className="flex items-center justify-between rounded-lg border border-emerald-200/70 bg-white/90 px-2.5 py-1.5 text-[11px] tabular-nums">
                                  <span className="text-zinc-600">
                                    {isWalletMetered
                                      ? "Metered wallet usage"
                                      : svc.key === "inbox"
                                        ? "Additional team seats"
                                        : "Additional storage quota"}
                                  </span>
                                  <span className="font-semibold text-emerald-800">
                                    {formatInr(svc.unitAmountPaise, { showDecimals: true })} /{" "}
                                    {svc.meteredUnit}
                                  </span>
                                </div>
                              );
                            })()}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-emerald-800 tabular-nums">
                                {svc.isComplimentaryFreeAccess && svc.freeAccessUntil
                                  ? `Complimentary until ${new Date(
                                      svc.freeAccessUntil
                                    ).toLocaleDateString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}`
                                  : svc.expiresAt
                                    ? `Renews ${new Date(svc.expiresAt).toLocaleDateString(
                                        "en-IN",
                                        {
                                          day: "2-digit",
                                          month: "short",
                                          year: "numeric",
                                        }
                                      )}`
                                    : "Active on your account"}
                              </span>
                              {featureLink && (
                                <ActionLink
                                  href={featureLink.href}
                                  spinnerSize="xs"
                                  className="rsl-btn-secondary bg-white py-1.5 text-xs"
                                >
                                  {featureLink.label}
                                </ActionLink>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-1 tabular-nums">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <div>
                                  {svc.hasCustomPriceOverride &&
                                    svc.standardMonthlyAmountPaise !== svc.monthlyAmountPaise && (
                                      <span className="mr-1.5 text-xs text-zinc-400 line-through">
                                        {formatInr(svc.standardMonthlyAmountPaise)}
                                      </span>
                                    )}
                                  <span className="text-base font-extrabold text-slate-900">
                                    {formatInr(svc.monthlyAmountPaise)}
                                  </span>
                                  <span className="text-[11px] text-zinc-500"> / mo + 18% GST</span>
                                </div>
                                {svc.unitAmountPaise > 0 && (
                                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/70">
                                    + {formatInr(svc.unitAmountPaise, { showDecimals: true })} /{" "}
                                    {svc.meteredUnit}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500">
                                Quarterly:{" "}
                                <strong className="text-slate-700">
                                  {formatInr(svc.quarterlyAmountPaise)}
                                </strong>{" "}
                                • Yearly:{" "}
                                <strong className="text-slate-700">
                                  {formatInr(svc.yearlyAmountPaise)}
                                </strong>
                              </div>
                            </div>

                            <div className="space-y-2">
                              {isPending && svc.pendingRequest && (
                                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800">
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                  <span>
                                    Requested{" "}
                                    {new Date(svc.pendingRequest.createdAt).toLocaleDateString(
                                      "en-IN",
                                      {
                                        day: "2-digit",
                                        month: "short",
                                      }
                                    )}
                                    {svc.pendingRequest.customerPaymentRef
                                      ? ` • Ref: ${svc.pendingRequest.customerPaymentRef}`
                                      : " — awaiting payment verification"}
                                  </span>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] text-zinc-500">
                                  UPI QR + 18% GST Invoice
                                </span>

                                <PlanActivationModal
                                  targetType="service"
                                  targetKey={svc.key}
                                  targetName={svc.name}
                                  tagline={svc.details.tagline}
                                  includedItems={svc.details.includedFeatures}
                                  monthlyPaise={svc.monthlyAmountPaise}
                                  quarterlyPaise={svc.quarterlyAmountPaise}
                                  yearlyPaise={svc.yearlyAmountPaise}
                                  hasCustomRate={svc.hasCustomPriceOverride}
                                  isUnlocked={svc.isUnlocked}
                                  isPending={isPending}
                                  pendingCycle={svc.pendingRequest?.billingCycle}
                                  workspaceSlug={session.workspace.slug}
                                  billingSettings={billingSettings}
                                  canManageBilling={canManageBilling}
                                  triggerLabel="Request Activation"
                                  triggerClassName="rsl-btn-primary py-1.5 px-3 text-xs"
                                />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* TAB 2: PREPAID WALLET & PASSBOOK */}
      {activeTab === "wallet" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1.35fr]">
          <SectionCard
            title="Recharge Your Prepaid Messaging Wallet"
            subtitle="Transfer via UPI or NEFT/IMPS using the official bank details below and submit your transaction reference (UTR). Your wallet balance and GST invoice update automatically once verified."
          >
            <div
              className={`mb-4 rounded-xl border p-3.5 text-xs ${
                isOverdraftExhausted
                  ? "border-rose-200 bg-rose-50/85 text-rose-950"
                  : walletBalancePaise < 0
                    ? "border-amber-200 bg-amber-50/85 text-amber-950"
                    : "border-emerald-200/80 bg-emerald-50/60 text-emerald-950"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  Current Balance: {formatInr(walletBalancePaise, { showDecimals: true })}
                </span>
                <span className="font-semibold tabular-nums">
                  Overdraft Protection Limit: {formatInr(MIN_WALLET_BALANCE_PAISE, { showDecimals: true })}
                </span>
              </div>
              <p className="mt-1 leading-relaxed">
                {isOverdraftExhausted
                  ? "Your wallet has reached the -₹200.00 overdraft floor. Submit a recharge below to automatically clear the negative balance and resume metered WhatsApp & Tally sends."
                  : walletBalancePaise < 0
                    ? `Your wallet is currently negative (${formatInr(walletBalancePaise, { showDecimals: true })}). You can still send WhatsApp messages, Tally bills, and metered actions using your remaining ${formatInr(walletAvailableSpendPaise, { showDecimals: true })} overdraft credit down to -₹200.00.`
                    : `Uninterrupted sending is enabled: even if your balance drops below ₹0.00, WhatsApp messages and Tally bill sends continue seamlessly down to ${formatInr(MIN_WALLET_BALANCE_PAISE, { showDecimals: true })} (${formatInr(walletAvailableSpendPaise, { showDecimals: true })} total spendable capacity).`}
              </p>
            </div>

            {!canManageBilling ? (
              <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-4 text-xs text-zinc-600">
                Read-only billing view — your current role ({formatRoleLabel(session.roleSlug)}) can inspect wallet passbook entries and download statements. Ask the Business Owner or Accounts &amp; Billing manager to submit a wallet recharge.
              </div>
            ) : (
            <>
            <form action={submitRechargeRequestAction} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-4 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                      {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                        ? "UPI ID (VPA)"
                        : "Beneficiary (UPI Bank Transfer)"}
                    </div>
                    <div className="truncate font-semibold text-slate-900 select-all">
                      {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                        ? billingSettings.upiId
                        : billingSettings.payeeName}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                        ? billingSettings.payeeName
                        : `${billingSettings.bankName} • Pay to Account + IFSC in any UPI app`}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                      Account &amp; IFSC (UPI / IMPS / NEFT)
                    </div>
                    <div className="truncate font-mono font-bold text-slate-900 select-all">
                      A/C {billingSettings.accountNumber}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      IFSC <span className="font-mono font-semibold text-slate-700 select-all">{billingSettings.ifscCode}</span> • {billingSettings.bankName}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div>
                  <label className="rsl-label">Recharge Amount (₹ INR)</label>
                  <input
                    name="amountRupees"
                    type="number"
                    min="100"
                    step="1"
                    defaultValue="2500"
                    required
                    className="rsl-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="rsl-label">Payment Method</label>
                  <select name="paymentMethod" defaultValue="upi" className="rsl-input">
                    <option value="upi">UPI Payment</option>
                    <option value="bank_transfer">Bank Transfer (NEFT / IMPS)</option>
                  </select>
                </div>
                <div>
                  <label className="rsl-label">UTR / Transaction Ref # *</label>
                  <input
                    name="utrOrReference"
                    required
                    minLength={4}
                    placeholder="12-digit UPI or bank UTR"
                    className="rsl-input font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3.5">
                <span className="text-xs text-zinc-500">
                  Balance is credited after payment verification — official 18% GST invoice (SAC 998314) issued automatically.
                </span>
                <SubmitButton pendingText="Submitting..." className="rsl-btn-primary">
                  Submit Recharge UTR
                </SubmitButton>
              </div>
            </form>

            {razorpayReady && (
              <form
                action={createOnlineRazorpayOrderAction}
                className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-4 text-[13px]"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    Instant Online Payment (Cards / NetBanking / UPI)
                  </div>
                  <div className="text-xs text-zinc-500">
                    Credits your wallet automatically upon gateway confirmation.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    name="amountRupees"
                    type="number"
                    min="100"
                    defaultValue="2500"
                    className="rsl-input w-32 tabular-nums"
                    style={{ width: "8rem" }}
                  />
                  <SubmitButton pendingText="Opening..." className="rsl-btn-secondary">
                    Pay Online Now
                  </SubmitButton>
                </div>
              </form>
            )}
            </>
            )}
          </SectionCard>

          <SectionCard
            title="Wallet Passbook"
            subtitle="Permanent record of wallet credits and message charges — past entries cannot be edited or deleted"
            action={
              ledger.length > 0 ? (
                <a href="/api/pdf/wallet-statement" className="rsl-btn-secondary text-xs">
                  Download Passbook PDF
                </a>
              ) : undefined
            }
            noPadding
          >
            {ledger.length === 0 ? (
              <div className="p-6 text-[13px] text-zinc-500">No wallet transactions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-3 sm:px-6">Description &amp; Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-5 py-3 text-right sm:px-6">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {ledger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-50/60">
                        <td className="px-5 py-3 sm:px-6">
                          <div className="font-medium text-slate-900">{entry.description}</div>
                          <div className="text-xs text-zinc-500 tabular-nums">
                            {new Date(entry.createdAt).toLocaleString("en-IN")}
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize text-zinc-600">
                          {entry.entryType.replace("_", " ")}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-semibold tabular-nums sm:px-6 ${
                            entry.amountPaise >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {entry.amountPaise >= 0 ? "+" : ""}
                          {formatInr(entry.amountPaise, { showDecimals: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* TAB 3: GST INVOICES & REQUEST STATUS */}
      {activeTab === "invoices" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
          <SectionCard
            title={`GST Tax Invoices (${invoices.length})`}
            subtitle={`Official sequential GST invoices (SAC 998314) • Supplier GSTIN: ${billingSettings.gstin}`}
            noPadding
          >
            {invoices.length === 0 ? (
              <div className="p-6 text-[13px] text-zinc-500">
                Your paid GST tax invoices appear here automatically once a plan or wallet payment is verified.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-3 sm:px-6">Invoice #</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                      <th className="px-4 py-3 text-right">GST (18%)</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right sm:px-6">PDF / Print</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {invoices.map((inv) => {
                      const gst = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
                      return (
                        <tr key={inv.id} className="hover:bg-zinc-50/60">
                          <td className="px-5 py-3 whitespace-nowrap sm:px-6">
                            <ActionLink
                              href={`/billing/invoices/${inv.id}`}
                              spinnerSize="xs"
                              className="font-mono font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                            >
                              {inv.invoiceNumber}
                            </ActionLink>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 tabular-nums">
                              <span>{new Date(inv.issuedAt).toLocaleDateString("en-IN")}</span>
                              <StatusPill
                                label={inv.status.toUpperCase()}
                                tone={inv.status === "paid" ? "emerald" : "amber"}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-zinc-700">{inv.description}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                            {formatInr(inv.subtotalPaise)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-zinc-500">
                            {formatInr(gst)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-700">
                            {formatInr(inv.totalPaise)}
                          </td>
                          <td className="px-5 py-3 text-right whitespace-nowrap sm:px-6">
                            <div className="inline-flex items-center gap-1.5">
                              <a
                                href={`/api/pdf/invoice?id=${inv.id}`}
                                className="rsl-btn-primary py-1 px-2.5 text-xs"
                              >
                                Download PDF
                              </a>
                              <ActionLink
                                href={`/billing/invoices/${inv.id}`}
                                spinnerSize="xs"
                                className="rsl-btn-secondary py-1 px-2.5 text-xs"
                              >
                                View
                              </ActionLink>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Plan & Recharge Verification History"
            subtitle="Live status of your submitted plan/bundle requests and UTR transfers"
            noPadding
          >
            {planRequests.length === 0 && rechargeRequests.length === 0 ? (
              <div className="p-6 text-[13px] text-zinc-500">
                No feature requests or recharge transfers submitted yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-3 sm:px-6">Item &amp; Cycle</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-5 py-3 text-right sm:px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {planRequests.map((pr) => (
                      <tr key={pr.id} className="hover:bg-zinc-50/60">
                        <td className="px-5 py-3 sm:px-6">
                          <div className="font-semibold text-slate-900">
                            {pr.bundleKey ? `Bundle: ${pr.serviceName}` : `Plan: ${pr.serviceName}`}
                          </div>
                          <div className="text-xs text-zinc-500 tabular-nums">
                            {BILLING_CYCLE_META[pr.billingCycle].shortLabel} •{" "}
                            {new Date(pr.createdAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                            {pr.customerPaymentRef ? ` • Ref: ${pr.customerPaymentRef}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {formatInr(pr.amountPaidPaise ?? pr.effectiveCyclePaise)}
                        </td>
                        <td className="px-5 py-3 text-right sm:px-6">
                          <StatusPill
                            label={
                              pr.status === "activated"
                                ? "Paid & Active"
                                : pr.status === "pending_payment"
                                  ? "Pending Payment"
                                  : "Declined"
                            }
                            tone={
                              pr.status === "activated"
                                ? "emerald"
                                : pr.status === "pending_payment"
                                  ? "amber"
                                  : "ruby"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                    {rechargeRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-zinc-50/60">
                        <td className="px-5 py-3 sm:px-6">
                          <div className="font-medium text-slate-900">
                            Wallet • {req.provider.toUpperCase()} (
                            {req.externalPaymentId || "Online"})
                          </div>
                          <div className="text-xs text-zinc-500 tabular-nums">
                            {new Date(req.createdAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {formatInr(req.amountPaise)}
                        </td>
                        <td className="px-5 py-3 text-right sm:px-6">
                          <StatusPill
                            label={
                              req.status === "captured"
                                ? "Verified & Credited"
                                : req.status === "pending_verification"
                                  ? "Pending Verification"
                                  : req.status === "failed"
                                    ? "Declined"
                                    : req.status
                            }
                            tone={
                              req.status === "captured"
                                ? "emerald"
                                : req.status === "pending_verification"
                                  ? "amber"
                                  : "ruby"
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
