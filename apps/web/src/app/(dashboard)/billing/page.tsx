import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Layers, Megaphone, ReceiptText, Wallet } from "lucide-react";
import { BILLING_CYCLE_META, WALLET_OVERDRAFT_LIMIT_PAISE } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { PlanActivationModal } from "@/components/plan-activation-modal";
import { BillingSuiteNav } from "@/components/suite-subnav";
import { FEATURE_PAGE_BY_KEY, loadBillingWorkspaceContext } from "@/lib/billing-data";
import { requireWebSession } from "@/lib/session";

export default async function BillingPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  if (sp.tab === "wallet") {
    redirect("/billing/wallet");
  }
  if (sp.tab === "invoices") {
    redirect("/billing/invoices");
  }

  const session = await requireWebSession();

  if (!canRoleAccessWebRoute(session.roleSlug, "/billing", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Plans & Bundles"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View plans & billing"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = loadBillingWorkspaceContext(session.workspace.id, session.roleSlug);
  const planFilter =
    sp.filter === "active" || sp.filter === "requested" || sp.filter === "available"
      ? sp.filter
      : "all";
  const selectedCycle =
    sp.cycle === "yearly" ? "yearly" : sp.cycle === "quarterly" ? "quarterly" : "monthly";
  const selectedCycleSuffix =
    selectedCycle === "yearly" ? "/ yr" : selectedCycle === "quarterly" ? "/ 3 mo" : "/ mo";

  const visibleServices = ctx.services.filter((svc) => {
    if (ctx.allToolsUnlocked) return true;
    if (planFilter === "active") return svc.isUnlocked;
    if (planFilter === "requested") return !svc.isUnlocked && Boolean(svc.pendingRequest);
    if (planFilter === "available") return !svc.isUnlocked && !svc.pendingRequest;
    return true;
  });

  const filterOptions = [
    { key: "all", label: `All (${ctx.services.length})`, show: true },
    { key: "active", label: `Active (${ctx.activeCount})`, show: ctx.activeCount > 0 },
    {
      key: "requested",
      label: `Pending (${ctx.pendingPlanCount})`,
      show: ctx.pendingPlanCount > 0,
    },
    {
      key: "available",
      label: `Available (${ctx.availablePlanCount})`,
      show: ctx.availablePlanCount > 0,
    },
  ].filter((f) => f.show);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={ctx.allToolsUnlocked ? "Active Suite" : "Plans & Modular Add-Ons"}
        title="Plans & Value Bundles"
        subtitle={
          ctx.allToolsUnlocked
            ? `All ${ctx.services.length} RapidShift tools are active on your workspace.`
            : "Activate Monthly, Quarterly, or Yearly tool subscriptions or dependency bundles via UPI / Wallet."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.showStatementPdfButton && (
              <a href="/api/pdf/wallet-statement" className="rsl-btn-secondary text-xs">
                Billing Statement PDF
              </a>
            )}
            <ActionLink href="/billing/wallet" className="rsl-btn-primary text-xs">
              Top Up Wallet →
            </ActionLink>
          </div>
        }
      />

      <BillingSuiteNav active="plans" invoicesCount={ctx.invoices.length} />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {ctx.freeAccess.isActive && ctx.freeAccess.untilMs && (
        <div className="rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand-surface)] p-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Complimentary Full-Platform Access" tone="emerald" />
                <span className="text-xs font-semibold text-[var(--brand)] tabular-nums">
                  {ctx.freeAccess.remainingDays} day(s) remaining • Valid until{" "}
                  {new Date(ctx.freeAccess.untilMs).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-[var(--ink-secondary)]">
                All {ctx.services.length} tools are active. Only metered WhatsApp sends and smart
                review drafts deduct from your Prepaid Wallet.
              </p>
            </div>
            <ActionLink href="/billing/wallet" spinnerSize="xs" className="rsl-btn-secondary text-xs">
              Manage Wallet →
            </ActionLink>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label="Prepaid Wallet"
          value={formatInr(ctx.walletBalancePaise, { showDecimals: true })}
          sublabel={`Includes ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft`}
          accent={ctx.isOverdraftExhausted ? "ruby" : ctx.walletBalancePaise < 0 ? "amber" : "emerald"}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Ad Spend Vault"
          value={formatInr(ctx.adVault.availablePaise, { showDecimals: true })}
          sublabel="0-overdraft Managed Ads"
          accent="sky"
          icon={<Megaphone className="h-4 w-4" />}
        />
        <MetricCard
          label="Unlocked Tools"
          value={`${ctx.activeCount} of ${ctx.services.length}`}
          sublabel={ctx.allToolsUnlocked ? "100% active" : `${ctx.availablePlanCount} available`}
          accent="emerald"
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="GST Tax Invoices"
          value={String(ctx.invoices.filter((i) => i.docType !== "advance_receipt").length)}
          sublabel={`State ${session.workspace.stateCode} GST`}
          icon={<ReceiptText className="h-4 w-4" />}
        />
      </div>

      {!ctx.allToolsUnlocked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-2xs">
          <div className="text-xs text-[var(--ink-secondary)]">
            <span className="font-bold text-[var(--ink)]">Billing Cycle:</span> Prices update live
            across all bundles and modular plans (+ 18% GST).
          </div>
          <div
            role="group"
            aria-label="Billing cycle switcher"
            className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-1"
          >
            {(
              [
                { key: "monthly", label: "Monthly", badge: null },
                { key: "quarterly", label: "Quarterly", badge: "Save ~10%" },
                { key: "yearly", label: "Yearly", badge: "Save ~20%" },
              ] as const
            ).map((opt) => {
              const active = selectedCycle === opt.key;
              const href = `/billing?cycle=${opt.key}${
                planFilter !== "all" ? `&filter=${encodeURIComponent(planFilter)}` : ""
              }`;
              return (
                <ActionLink
                  key={opt.key}
                  href={href}
                  spinnerSize="xs"
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-2xs"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span>{opt.label}</span>
                  {opt.badge && (
                    <span className="rounded-full bg-[var(--brand-surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--brand)]">
                      {opt.badge}
                    </span>
                  )}
                </ActionLink>
              );
            })}
          </div>
        </div>
      )}

      {ctx.availableBundles.length > 0 && (
        <SectionCard
          title="Value Bundles & All-in-One Package"
          subtitle="Save on combined tool packages with a single GST invoice"
          action={<StatusPill label="Monthly • Quarterly • Yearly" tone="emerald" />}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {ctx.availableBundles.map((bundle) => {
              const isAllFeatures = bundle.key === "all_features";
              const isRecommended = bundle.key === "tally_whatsapp_pack";
              const bundlePending = Boolean(bundle.pendingRequest);
              const activeBundlePaise =
                selectedCycle === "yearly"
                  ? bundle.yearlyAmountPaise
                  : selectedCycle === "quarterly"
                    ? bundle.quarterlyAmountPaise
                    : bundle.monthlyAmountPaise;

              return (
                <div
                  key={bundle.key}
                  className={`flex h-full flex-col justify-between rounded-2xl border p-5 text-[13px] transition ${
                    isAllFeatures
                      ? "border-[var(--brand)]/40 bg-[var(--brand-surface)] lg:col-span-2"
                      : isRecommended
                        ? "border-[var(--brand)] bg-[var(--surface)]"
                        : bundlePending
                          ? "border-[var(--warning)]/40 bg-[var(--warning-surface)]"
                          : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-[var(--brand-surface)] px-2 py-0.5 text-[10px] font-bold tracking-wider text-[var(--brand)] uppercase">
                            {isRecommended ? "Recommended" : bundle.badgeLabel}
                          </span>
                          {bundle.hasCustomOverride && (
                            <StatusPill label="Custom Rate" tone="emerald" />
                          )}
                        </div>
                        <h3 className="text-base font-bold text-[var(--ink)]">{bundle.name}</h3>
                        <p className="text-xs text-[var(--ink-secondary)]">{bundle.tagline}</p>
                      </div>

                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-right tabular-nums">
                        {bundle.savingsMonthlyPaise > 0 && (
                          <div className="text-[11px] font-semibold text-[var(--brand)]">
                            Save {formatInr(bundle.savingsMonthlyPaise)}/mo
                          </div>
                        )}
                        <div className="text-xl font-extrabold text-[var(--ink)]">
                          {formatInr(activeBundlePaise)}
                          <span className="ml-1 text-xs font-medium text-[var(--ink-muted)]">
                            {selectedCycleSuffix}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {bundle.includedKeys.map((svcKey) => {
                        const svcName = ctx.serviceNameByKey.get(svcKey) ?? svcKey;
                        const alreadyActive = ctx.unlockedKeySet.has(svcKey);
                        return (
                          <span
                            key={svcKey}
                            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                              alreadyActive
                                ? "border-[var(--brand)]/30 bg-[var(--brand-surface)] text-[var(--brand)]"
                                : "border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink-secondary)]"
                            }`}
                          >
                            {svcName}
                            {alreadyActive ? " (Active)" : ""}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3.5">
                    <span className="text-xs text-[var(--ink-muted)]">
                      + 18% GST • {bundle.totalServicesCount} tools included
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
                      defaultCycle={selectedCycle}
                      walletBalancePaise={ctx.walletBalancePaise}
                      hasCustomRate={bundle.hasCustomOverride}
                      isUnlocked={bundle.isFullyUnlocked}
                      isPending={bundlePending}
                      pendingCycle={bundle.pendingRequest?.billingCycle}
                      workspaceSlug={session.workspace.slug}
                      buyerStateCode={session.workspace.stateCode}
                      supplierStateCode={ctx.billingSettings.gstin.slice(0, 2) || "27"}
                      billingSettings={ctx.billingSettings}
                      canManageBilling={ctx.canManageBilling}
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

      <SectionCard
        title={
          ctx.allToolsUnlocked
            ? `Active Platform Tools (${ctx.activeCount} of ${ctx.services.length})`
            : "Individual Modular Service Plans"
        }
        subtitle="Open any unlocked tool directly or activate individual add-ons"
        action={
          !ctx.allToolsUnlocked && filterOptions.length > 2 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {filterOptions.map((f) => {
                const active = planFilter === f.key;
                return (
                  <ActionLink
                    key={f.key}
                    href={f.key === "all" ? "/billing" : `/billing?filter=${f.key}`}
                    spinnerSize="xs"
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                      active
                        ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]"
                        : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)]"
                    }`}
                  >
                    {f.label}
                  </ActionLink>
                );
              })}
            </div>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {visibleServices.map((svc) => {
            const isPending = !svc.isUnlocked && Boolean(svc.pendingRequest);
            const featureLink = FEATURE_PAGE_BY_KEY[svc.key];

            return (
              <div
                key={svc.key}
                className={`flex h-full flex-col justify-between rounded-2xl border p-5 text-[13px] transition ${
                  svc.isUnlocked
                    ? "border-[var(--brand)]/35 bg-[var(--brand-surface)]"
                    : isPending
                      ? "border-[var(--warning)]/35 bg-[var(--warning-surface)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold tracking-wider text-[var(--ink-muted)] uppercase">
                        {svc.category}
                      </span>
                      <h3 className="mt-0.5 text-[15px] font-bold text-[var(--ink)]">{svc.name}</h3>
                    </div>
                    <StatusPill
                      label={
                        svc.isComplimentaryFreeAccess
                          ? "Free Access"
                          : svc.isUnlocked
                            ? `Active (${BILLING_CYCLE_META[svc.billingCycle].shortLabel})`
                            : isPending
                              ? "Pending"
                              : "Available"
                      }
                      tone={svc.isUnlocked ? "emerald" : isPending ? "amber" : "stone"}
                    />
                  </div>

                  <p className="text-[var(--ink-secondary)]">{svc.details.tagline}</p>

                  <ul className="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3 text-xs text-[var(--ink-secondary)]">
                    {svc.details.includedFeatures.map((feat) => (
                      <li key={feat} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 space-y-2.5 border-t border-[var(--border-subtle)] pt-3.5">
                  {svc.isUnlocked ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[var(--brand)]">
                        {svc.expiresAt
                          ? `Renews ${new Date(svc.expiresAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}`
                          : "Active on workspace"}
                      </span>
                      {featureLink && (
                        <ActionLink
                          href={featureLink.href}
                          spinnerSize="xs"
                          className="rsl-btn-secondary py-1.5 text-xs"
                        >
                          {featureLink.label}
                        </ActionLink>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-2 tabular-nums">
                        <div>
                          <span className="text-base font-extrabold text-[var(--ink)]">
                            {formatInr(
                              selectedCycle === "yearly"
                                ? svc.yearlyAmountPaise
                                : selectedCycle === "quarterly"
                                  ? svc.quarterlyAmountPaise
                                  : svc.monthlyAmountPaise
                            )}
                          </span>
                          <span className="text-[11px] text-[var(--ink-muted)]">
                            {" "}
                            {selectedCycleSuffix} + 18% GST
                          </span>
                        </div>
                        {isPending && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--warning)]">
                            <Clock className="h-3 w-3" /> Pending
                          </span>
                        )}
                      </div>
                      <PlanActivationModal
                        targetType="service"
                        targetKey={svc.key}
                        targetName={svc.name}
                        tagline={svc.details.tagline}
                        includedItems={svc.details.includedFeatures}
                        monthlyPaise={svc.monthlyAmountPaise}
                        quarterlyPaise={svc.quarterlyAmountPaise}
                        yearlyPaise={svc.yearlyAmountPaise}
                        defaultCycle={selectedCycle}
                        walletBalancePaise={ctx.walletBalancePaise}
                        hasCustomRate={svc.hasCustomPriceOverride}
                        isUnlocked={svc.isUnlocked}
                        isPending={isPending}
                        pendingCycle={svc.pendingRequest?.billingCycle}
                        workspaceSlug={session.workspace.slug}
                        buyerStateCode={session.workspace.stateCode}
                        supplierStateCode={ctx.billingSettings.gstin.slice(0, 2) || "27"}
                        billingSettings={ctx.billingSettings}
                        canManageBilling={ctx.canManageBilling}
                        triggerLabel="Request Activation"
                        triggerClassName="rsl-btn-primary w-full py-1.5 text-xs"
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
