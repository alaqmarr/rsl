import React from "react";
import {
  CheckCircle2,
  Clock,
  Landmark,
  QrCode,
} from "lucide-react";
import {
  getMatchingBundlesForKeys,
  getPlatformBillingSettings,
  type WorkspaceServicePlanState,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform } from "@rsl/rbac";
import { PageHeader, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { PlanActivationModal } from "@/components/plan-activation-modal";
import { getOptionalWebSession } from "@/lib/session";

export async function FeaturePlanGate({
  pageTitle,
  pageSubtitle,
  plans,
  notice,
  error,
}: {
  pageTitle: string;
  pageSubtitle: string;
  plans: WorkspaceServicePlanState[];
  returnPath?: string;
  notice?: string;
  error?: string;
}) {
  const session = await getOptionalWebSession();
  const workspaceSlug = session?.workspace.slug ?? "client";
  const canManageBilling = session
    ? canRolePerform(session.roleSlug, "billing:manage", session.workspace.id)
    : false;
  const canViewBilling = session
    ? canRoleAccessWebRoute(session.roleSlug, "/billing", session.workspace.id)
    : false;
  const lockedPlans = plans.filter((p) => !p.isUnlocked);
  const displayPlans = lockedPlans.length > 0 ? lockedPlans : plans;
  const anyPending = displayPlans.some((p) => Boolean(p.pendingRequest));
  const billingSettings = getPlatformBillingSettings();
  const matchingBundles = session
    ? getMatchingBundlesForKeys(
        session.workspace.id,
        displayPlans.map((p) => p.key)
      )
    : [];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Paid Feature Plan"
        title={pageTitle}
        subtitle={pageSubtitle}
        badge={
          <StatusPill
            label={
              anyPending
                ? "Requested — Awaiting Payment Verification"
                : "Locked — Requires Active Plan"
            }
            tone={anyPending ? "amber" : "stone"}
          />
        }
        actions={
          canViewBilling ? (
            <ActionLink href="/billing" className="rsl-btn-secondary text-xs">
              View All Plans &amp; Bundles →
            </ActionLink>
          ) : undefined
        }
      />

      <FlashBanner notice={notice} error={error} />

      {/* Crisp Activation Summary + Live UPI & Bank Details */}
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">
                Instant UPI QR Checkout &amp; Billing Cycles
              </h2>
              <StatusPill label="Monthly • Quarterly • Yearly" tone="emerald" />
            </div>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-zinc-600">
              Click <strong>Request Activation</strong> on an individual tool or save more with a bundled package below. Scan the live UPI QR code with exact GST amount &amp; transaction note pre-filled — our billing desk unlocks your tools and issues an official 18% GST tax invoice.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3.5 text-xs sm:grid-cols-2 xl:min-w-[420px]">
            <div className="flex items-start gap-2.5">
              <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                    ? "UPI Payment ID"
                    : "UPI Bank-Transfer QR"}
                </div>
                <div className="truncate font-semibold text-slate-900">
                  {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                    ? billingSettings.upiId
                    : `${billingSettings.payeeName}`}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                    ? billingSettings.payeeName
                    : "Direct to Bank Account over UPI"}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Bank Account (UPI / IMPS / NEFT)
                </div>
                <div className="truncate font-mono font-bold text-slate-900 select-all">
                  A/C {billingSettings.accountNumber}
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {billingSettings.bankName} • IFSC {billingSettings.ifscCode}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Individual Plan Cards */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          displayPlans.length > 1 ? "xl:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {displayPlans.map((plan) => {
          const isPending = Boolean(plan.pendingRequest);
          const gstPaise = Math.round(plan.monthlyAmountPaise * 0.18);
          const totalWithGstPaise = plan.monthlyAmountPaise + gstPaise;

          return (
            <div
              key={plan.key}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]"
            >
              <div>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 bg-zinc-50/60 px-6 py-5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-bold tracking-wider text-zinc-600 uppercase">
                        {plan.category}
                      </span>
                      {plan.hasCustomPriceOverride && (
                        <StatusPill label="Custom Account Rate" tone="emerald" />
                      )}
                      {isPending ? (
                        <StatusPill label="Pending Payment Verification" tone="amber" />
                      ) : (
                        <StatusPill label="Available to Request" tone="sky" />
                      )}
                    </div>
                    <h3 className="text-lg font-bold tracking-tight text-slate-900">{plan.name}</h3>
                    <p className="text-xs leading-relaxed text-zinc-600">{plan.details.tagline}</p>
                  </div>

                  <div className="rounded-xl border border-zinc-200/90 bg-white px-4 py-3 text-right shadow-2xs">
                    {plan.hasCustomPriceOverride &&
                      plan.standardMonthlyAmountPaise !== plan.monthlyAmountPaise && (
                        <div className="text-[11px] text-zinc-400 line-through tabular-nums">
                          {formatInr(plan.standardMonthlyAmountPaise)} / mo
                        </div>
                      )}
                    <div className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums">
                      {formatInr(plan.monthlyAmountPaise)}
                      <span className="ml-1 text-xs font-medium text-zinc-500">/ month</span>
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-zinc-500 tabular-nums">
                      + 18% GST ({formatInr(totalWithGstPaise)} incl. tax)
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                      Quarterly: <strong className="text-slate-700">{formatInr(plan.quarterlyAmountPaise)}</strong> • Yearly:{" "}
                      <strong className="text-slate-700">{formatInr(plan.yearlyAmountPaise)}</strong>
                    </div>
                    {plan.unitAmountPaise > 0 && (
                      <div className="mt-1 text-[11px] font-semibold text-emerald-700 tabular-nums">
                        + {formatInr(plan.unitAmountPaise, { showDecimals: true })} per{" "}
                        {plan.meteredUnit}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4 p-6">
                  <div>
                    <div className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
                      Included in {plan.name}
                    </div>
                    <ul className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {plan.details.includedFeatures.map((feat) => (
                        <li
                          key={feat}
                          className="flex items-start gap-2 rounded-xl border border-zinc-200/70 bg-zinc-50/50 p-3 text-xs leading-relaxed text-slate-800"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-200/70 bg-zinc-50/40 p-4 text-xs sm:grid-cols-2">
                    <div>
                      <span className="font-semibold text-slate-900">Best suited for: </span>
                      <span className="text-zinc-600">{plan.details.whoItsFor}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Billing terms: </span>
                      <span className="text-zinc-600">{plan.details.billingHighlights}</span>
                    </div>
                  </div>

                  {plan.dependNames.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-900">
                      <strong>Companion plan note:</strong> Works together with{" "}
                      <strong>{plan.dependNames.join(" + ")}</strong>. Choose one of the value bundles below to unlock everything together at a lower combined rate.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-6 py-4">
                {isPending && plan.pendingRequest ? (
                  <div className="flex items-center gap-2 text-xs text-amber-900">
                    <Clock className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>Activation requested</strong> on{" "}
                      {new Date(plan.pendingRequest.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {plan.pendingRequest.customerPaymentRef
                        ? ` • UTR: ${plan.pendingRequest.customerPaymentRef}`
                        : " • Awaiting payment verification"}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-600">
                    Opens UPI QR code with exact GST amount &amp; transaction note pre-filled.
                  </div>
                )}

                <PlanActivationModal
                  targetType="service"
                  targetKey={plan.key}
                  targetName={plan.name}
                  tagline={plan.details.tagline}
                  includedItems={plan.details.includedFeatures}
                  monthlyPaise={plan.monthlyAmountPaise}
                  quarterlyPaise={plan.quarterlyAmountPaise}
                  yearlyPaise={plan.yearlyAmountPaise}
                  hasCustomRate={plan.hasCustomPriceOverride}
                  isUnlocked={plan.isUnlocked}
                  isPending={isPending}
                  pendingCycle={plan.pendingRequest?.billingCycle}
                  workspaceSlug={workspaceSlug}
                  billingSettings={billingSettings}
                  canManageBilling={canManageBilling}
                  triggerLabel="Request Activation"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Matching Dependency Bundles & Full Software Package */}
      {matchingBundles.length > 0 && (
        <div className="space-y-4 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-semibold tracking-tight text-slate-900">
                  Save More with a Bundle or Complete Software Package
                </h2>
                <StatusPill label="Dependency & Full-Suite Bundles" tone="emerald" />
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                Unlock dependent tools together — or get the entire 15-tool RSL Marketing platform on one invoice.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {matchingBundles.map((bundle) => {
              const bundlePending = Boolean(bundle.pendingRequest);
              return (
                <div
                  key={bundle.key}
                  className="flex flex-col justify-between rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-900 uppercase">
                          {bundle.badgeLabel}
                        </span>
                        <h3 className="mt-1 text-[15px] font-bold text-slate-900">{bundle.name}</h3>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="text-base font-extrabold text-slate-900">
                          {formatInr(bundle.monthlyAmountPaise)}
                          <span className="text-[11px] font-normal text-zinc-500"> / mo</span>
                        </div>
                        {bundle.savingsMonthlyPaise > 0 && (
                          <div className="text-[11px] font-semibold text-emerald-700">
                            Save {formatInr(bundle.savingsMonthlyPaise)}/mo vs separate plans
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-zinc-600">{bundle.tagline}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {bundle.includedServiceNames.map((svcName) => (
                        <span
                          key={svcName}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700"
                        >
                          {svcName}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/80 pt-3">
                    <span className="text-[11px] text-zinc-500 tabular-nums">
                      Quarterly: {formatInr(bundle.quarterlyAmountPaise)} • Yearly:{" "}
                      {formatInr(bundle.yearlyAmountPaise)} (+18% GST)
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
                      workspaceSlug={workspaceSlug}
                      billingSettings={billingSettings}
                      canManageBilling={canManageBilling}
                      triggerLabel="Request Bundle Activation"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export async function InlineAddonPlanBanner({
  plan,
}: {
  plan: WorkspaceServicePlanState;
  returnPath?: string;
}) {
  if (plan.isUnlocked) {
    return null;
  }
  const session = await getOptionalWebSession();
  const workspaceSlug = session?.workspace.slug ?? "client";
  const canManageBilling = session
    ? canRolePerform(session.roleSlug, "billing:manage", session.workspace.id)
    : false;
  const billingSettings = getPlatformBillingSettings();
  const isPending = Boolean(plan.pendingRequest);

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900">{plan.name}</span>
            <StatusPill
              label={
                isPending
                  ? "Pending Payment Verification"
                  : `${formatInr(plan.monthlyAmountPaise)}/mo + GST`
              }
              tone={isPending ? "amber" : "stone"}
            />
          </div>
          <p className="mt-1 text-zinc-600">{plan.details.tagline}</p>
        </div>
      </div>

      <ul className="space-y-1 text-[11px] text-zinc-700">
        {plan.details.includedFeatures.slice(0, 3).map((f) => (
          <li key={f} className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-zinc-500 tabular-nums">
          Quarterly: {formatInr(plan.quarterlyAmountPaise)} • Yearly: {formatInr(plan.yearlyAmountPaise)}
        </span>
        <PlanActivationModal
          targetType="service"
          targetKey={plan.key}
          targetName={plan.name}
          tagline={plan.details.tagline}
          includedItems={plan.details.includedFeatures}
          monthlyPaise={plan.monthlyAmountPaise}
          quarterlyPaise={plan.quarterlyAmountPaise}
          yearlyPaise={plan.yearlyAmountPaise}
          hasCustomRate={plan.hasCustomPriceOverride}
          isUnlocked={plan.isUnlocked}
          isPending={isPending}
          pendingCycle={plan.pendingRequest?.billingCycle}
          workspaceSlug={workspaceSlug}
          billingSettings={billingSettings}
          canManageBilling={canManageBilling}
          triggerLabel="Request Activation"
          triggerClassName="rsl-btn-primary py-1.5 text-xs"
        />
      </div>
    </div>
  );
}
