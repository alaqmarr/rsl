import {
  BILLING_CYCLE_META,
  SERVICE_CATALOG,
  type getWorkspaceFreeAccessStatus,
  type listBundlesWithWorkspaceState,
  type listServicesWithWorkspaceState,
  type listWorkspaceBillingReminders,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { AccessRestrictedState, SectionCard, StatusPill } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffBulkUnlockBundleAction,
  staffCreateClientCustomBundleAction,
  staffGrantFreeAllToolsAction,
  staffRecordPlanPaymentAction,
  staffRevokeFreeAllToolsAction,
  staffRevokePlanAction,
  staffSendBillingReminderNowAction,
  staffSetClientBundleOverrideAction,
  staffSetClientCustomPriceAction,
  staffToggleAutoBillingRemindersAction,
} from "@/lib/actions";

export function ClientPlansEntitlementsTab({
  workspaceId,
  workspaceName,
  ownerEmail,
  canManageBilling,
  staffRoleLabel,
  unlockedCount,
  plans,
  bundles,
  freeAccess,
  reminders,
}: {
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string;
  canManageBilling: boolean;
  staffRoleLabel: string;
  unlockedCount: number;
  plans: ReturnType<typeof listServicesWithWorkspaceState>;
  bundles: ReturnType<typeof listBundlesWithWorkspaceState>;
  freeAccess: ReturnType<typeof getWorkspaceFreeAccessStatus>;
  reminders: ReturnType<typeof listWorkspaceBillingReminders>;
}) {
  if (!canManageBilling) {
    return (
      <div className="space-y-6">
        <AccessRestrictedState
          pageTitle="Plan Unlocks & Custom Client Pricing"
          roleLabel={staffRoleLabel}
          requiredPermissionLabel="Manage client billing, wallet & plan unlocks"
          description={`Your ${staffRoleLabel} account has read-only visibility into unlocked plans. Ask a Finance or Super Admin team member to grant complimentary access, change negotiated bundle rates, or record paid renewals.`}
        />
        <SectionCard
          title={`Unlocked Plans Summary (${unlockedCount}/${plans.length})`}
          subtitle="Read-only plan status for support troubleshooting"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Feature Plan</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-6 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {plans.map((p) => (
                  <tr key={p.key}>
                    <td className="px-6 py-3 font-semibold text-slate-900">{p.name}</td>
                    <td className="px-4 py-3 text-zinc-500">{p.category}</td>
                    <td className="px-6 py-3 text-right">
                      <StatusPill
                        label={
                          p.isComplimentaryFreeAccess
                            ? "Free Access"
                            : p.isPaidUnlocked
                              ? `Active (${BILLING_CYCLE_META[p.billingCycle].shortLabel})`
                              : p.pendingRequest
                                ? "Requested"
                                : "Locked"
                        }
                        tone={p.isUnlocked ? "emerald" : p.pendingRequest ? "amber" : "stone"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    );
  }

  const returnToPlans = `/clients/${workspaceId}?tab=plans`;

  return (
    <div className="space-y-6">
      {/* ROW 1: Complimentary Free Access + Automatic Renewal Reminders */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Complimentary Free Access to All Tools (15/15)"
          subtitle="Grant this client temporary ₹0 full-platform access across every tool for a chosen number of days or until a specific date."
          action={
            <StatusPill
              label={
                freeAccess.isActive
                  ? `Active (${freeAccess.remainingDays}d left)`
                  : "Inactive"
              }
              tone={freeAccess.isActive ? "emerald" : "stone"}
            />
          }
        >
          <div className="space-y-4 text-xs">
            {freeAccess.isActive && freeAccess.untilMs && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-emerald-950">
                <div>
                  <div className="font-semibold">
                    All 15 tools unlocked until{" "}
                    {new Date(freeAccess.untilMs).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    ({freeAccess.remainingDays} days remaining)
                  </div>
                  {freeAccess.note && (
                    <div className="mt-0.5 text-[11px] text-emerald-800">
                      Reason: {freeAccess.note}
                    </div>
                  )}
                </div>
                <form action={staffRevokeFreeAllToolsAction}>
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="returnTo" value={returnToPlans} />
                  <SubmitButton
                    className="adm-btn-danger py-1.5 text-xs"
                    spinnerSize="xs"
                    pendingText="Ending..."
                  >
                    End Free Access
                  </SubmitButton>
                </form>
              </div>
            )}

            <form action={staffGrantFreeAllToolsAction} className="space-y-3">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToPlans} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="free-access-duration" className="adm-label">
                    Preset Period
                  </label>
                  <select
                    id="free-access-duration"
                    name="durationDays"
                    defaultValue="14"
                    className="adm-input"
                  >
                    <option value="7">7 Days Trial</option>
                    <option value="14">14 Days Onboarding</option>
                    <option value="30">30 Days (1 Month)</option>
                    <option value="90">90 Days (1 Quarter)</option>
                    <option value="180">180 Days (6 Months)</option>
                    <option value="365">365 Days (1 Year)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="free-access-until" className="adm-label">
                    Or Exact End Date (Optional)
                  </label>
                  <input
                    id="free-access-until"
                    name="customUntilDate"
                    type="date"
                    className="adm-input tabular-nums"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="note"
                  aria-label="Free access reason or note"
                  defaultValue={freeAccess.note ?? ""}
                  placeholder="Optional note (e.g. Pilot trial / VIP partner access)"
                  className="adm-input min-w-[200px] flex-1"
                />
                <SubmitButton
                  className="adm-btn-primary shrink-0"
                  spinnerSize="xs"
                  pendingText="Granting..."
                >
                  {freeAccess.isActive ? "Extend / Update Free Access" : "Grant Free Access"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </SectionCard>

        <SectionCard
          title="Automatic Renewal Reminders (Monthly / Quarterly / Yearly)"
          subtitle="Automatically emails UPI payment details 7 days before, 1 day before, and when any plan or bundle renewal falls due."
          action={
            <form action={staffToggleAutoBillingRemindersAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input
                type="hidden"
                name="enabled"
                value={freeAccess.autoBillingReminders ? "false" : "true"}
              />
              <input type="hidden" name="returnTo" value={returnToPlans} />
              <SubmitButton
                className={
                  freeAccess.autoBillingReminders
                    ? "adm-btn-secondary py-1 px-2.5 text-xs"
                    : "adm-btn-primary py-1 px-2.5 text-xs"
                }
                spinnerSize="xs"
                pendingText="Saving..."
              >
                {freeAccess.autoBillingReminders ? "Pause Auto-Reminders" : "Enable Auto-Reminders"}
              </SubmitButton>
            </form>
          }
        >
          <div className="space-y-4 text-xs">
            <form action={staffSendBillingReminderNowAction} className="space-y-3">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToPlans} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="rem-cycle" className="adm-label">
                    Billing Cycle
                  </label>
                  <select id="rem-cycle" name="billingCycle" defaultValue="monthly" className="adm-input">
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rem-amount" className="adm-label">
                    Custom Subtotal ₹ (Opt)
                  </label>
                  <input
                    id="rem-amount"
                    name="customAmountRupees"
                    type="number"
                    min="1"
                    placeholder="Auto from plans"
                    className="adm-input tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="rem-label" className="adm-label">
                    Plan / Bundle Label (Opt)
                  </label>
                  <input
                    id="rem-label"
                    name="customLabel"
                    placeholder="Auto summary"
                    className="adm-input"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-zinc-500">
                  Sends to <strong>{ownerEmail || "owner email"}</strong> with exact 18% GST total &amp; UPI note.
                </span>
                <SubmitButton
                  className="adm-btn-dark py-1.5 text-xs"
                  spinnerSize="xs"
                  pendingText="Sending..."
                >
                  Send Billing Reminder Now
                </SubmitButton>
              </div>
            </form>

            {reminders.length > 0 && (
              <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3">
                <div className="mb-1.5 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
                  Recent Renewal Reminders Sent ({reminders.length})
                </div>
                <div className="space-y-1.5">
                  {reminders.slice(0, 3).map((rem) => (
                    <div
                      key={rem.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-700"
                    >
                      <span>
                        <strong className="text-slate-900">{rem.targetSummary}</strong> ({rem.billingCycle},{" "}
                        {rem.reminderStage})
                      </span>
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatInr(rem.amountPaise, { showDecimals: true })} •{" "}
                        {new Date(rem.createdAt).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* ROW 2: Bundles & Complete Software Package */}
      <SectionCard
        title="Bundles & Complete Software Package (Unlock & Customize Per Client)"
        subtitle="Unlock any bundle on Monthly, Quarterly, or Yearly billing - or customize included tools and negotiated rates specifically for this client."
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {bundles.map((bundle) => {
              const effMonthlyRupees = Math.round(bundle.monthlyAmountPaise / 100);
              const effQuarterlyRupees = Math.round(bundle.quarterlyAmountPaise / 100);
              const effYearlyRupees = Math.round(bundle.yearlyAmountPaise / 100);

              return (
                <div
                  key={bundle.key}
                  className={`flex flex-col justify-between rounded-2xl border p-4 text-xs ${
                    bundle.isFullyUnlocked
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-zinc-200/90 bg-zinc-50/60"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-900 uppercase">
                            {bundle.badgeLabel}
                          </span>
                          {bundle.hasCustomOverride && (
                            <StatusPill label="Custom Client Bundle" tone="emerald" />
                          )}
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {bundle.name}
                        </div>
                      </div>
                      {bundle.isFullyUnlocked ? (
                        <StatusPill
                          label={
                            bundle.isAllFreeAccess
                              ? `All ${bundle.totalServicesCount} Active (Free)`
                              : `All ${bundle.totalServicesCount} Active`
                          }
                          tone="emerald"
                        />
                      ) : (
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-zinc-200 tabular-nums">
                          {bundle.unlockedCount}/{bundle.totalServicesCount} unlocked
                        </span>
                      )}
                    </div>

                    <p className="text-[11.5px] leading-relaxed text-zinc-600">{bundle.tagline}</p>

                    <div className="flex flex-wrap gap-1">
                      {bundle.includedServiceNames.map((svcName) => (
                        <span
                          key={svcName}
                          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10.5px] text-zinc-700"
                        >
                          {svcName}
                        </span>
                      ))}
                    </div>

                    <div className="text-[11px] text-zinc-600 tabular-nums">
                      Client Rates: <strong>₹{effMonthlyRupees}/mo</strong> •{" "}
                      <strong>₹{effQuarterlyRupees}/qtr</strong> •{" "}
                      <strong>₹{effYearlyRupees}/yr</strong> (+18% GST)
                    </div>
                  </div>

                  <details
                    open={Boolean(bundle.pendingRequest)}
                    className="mt-3.5 rounded-xl border border-zinc-200 bg-white p-3"
                  >
                    <summary className="cursor-pointer text-[11px] font-semibold text-emerald-800 select-none">
                      {bundle.isFullyUnlocked
                        ? `All ${bundle.totalServicesCount} tools active - Record Paid Renewal / Convert Bundle`
                        : bundle.pendingRequest
                          ? `Client Requested Unlock (${bundle.pendingRequest.billingCycle}) - Verify & Unlock`
                          : "Record Payment & Unlock Bundle →"}
                    </summary>
                    <form
                      action={staffBulkUnlockBundleAction}
                      className="mt-3 space-y-2.5 border-t border-zinc-100 pt-3"
                    >
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="bundleKey" value={bundle.key} />
                      <input type="hidden" name="returnTo" value={returnToPlans} />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Cycle
                          </label>
                          <select
                            name="billingCycle"
                            defaultValue={bundle.pendingRequest?.billingCycle ?? "monthly"}
                            className="adm-input py-1.5"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Paid Subtotal (₹) *
                          </label>
                          <input
                            name="amountRupees"
                            type="number"
                            min="1"
                            required
                            defaultValue={Math.max(1, effMonthlyRupees)}
                            className="adm-input py-1.5 tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Method
                          </label>
                          <select name="paymentMethod" defaultValue="upi" className="adm-input py-1.5">
                            <option value="upi">UPI</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="cash">Cash</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <input
                          name="paymentReference"
                          required
                          minLength={3}
                          defaultValue={bundle.pendingRequest?.customerPaymentRef ?? ""}
                          placeholder="UTR / Receipt #"
                          className="adm-input flex-1 py-1.5 font-mono"
                        />
                        <SubmitButton
                          className="adm-btn-primary shrink-0 py-1.5 text-xs"
                          spinnerSize="xs"
                          pendingText="Unlocking..."
                        >
                          {bundle.isFullyUnlocked ? "Record Paid Bundle" : "Unlock Bundle"}
                        </SubmitButton>
                      </div>
                    </form>
                  </details>

                  <details className="mt-2.5 rounded-xl border border-zinc-200 bg-white p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold text-slate-800 select-none">
                      Customize Bundle Prices &amp; Included Tools for {workspaceName}
                    </summary>
                    <form
                      action={staffSetClientBundleOverrideAction}
                      className="mt-3 space-y-3 border-t border-zinc-100 pt-3"
                    >
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="bundleKey" value={bundle.key} />
                      <input type="hidden" name="returnTo" value={returnToPlans} />

                      <div>
                        <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                          Custom Bundle Title (Optional)
                        </label>
                        <input
                          name="customName"
                          defaultValue={bundle.name}
                          className="adm-input py-1 text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Monthly (₹)
                          </label>
                          <input
                            name="monthlyOverrideRupees"
                            type="number"
                            min="0"
                            defaultValue={effMonthlyRupees}
                            className="adm-input py-1 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Quarterly (₹)
                          </label>
                          <input
                            name="quarterlyOverrideRupees"
                            type="number"
                            min="0"
                            defaultValue={effQuarterlyRupees}
                            className="adm-input py-1 text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10.5px] font-semibold text-zinc-600">
                            Yearly (₹)
                          </label>
                          <input
                            name="yearlyOverrideRupees"
                            type="number"
                            min="0"
                            defaultValue={effYearlyRupees}
                            className="adm-input py-1 text-xs tabular-nums"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 text-[10.5px] font-semibold text-zinc-600">
                          Included Tools for This Client
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {SERVICE_CATALOG.map((svc) => (
                            <label
                              key={svc.key}
                              className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200/80 bg-zinc-50/60 px-2 py-1 text-[11px] text-slate-800"
                            >
                              <input
                                type="checkbox"
                                name="includedKeys"
                                value={svc.key}
                                defaultChecked={bundle.includedKeys.includes(svc.key)}
                              />
                              <span className="truncate">{svc.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        {bundle.hasCustomOverride && !bundle.isClientCustomBundle && (
                          <SubmitButton
                            name="mode"
                            value="clear"
                            spinnerSize="xs"
                            pendingText="Resetting..."
                            className="adm-btn-secondary py-1 px-2.5 text-[11px]"
                          >
                            Reset to Default
                          </SubmitButton>
                        )}
                        <SubmitButton
                          name="mode"
                          value="set"
                          spinnerSize="xs"
                          pendingText="Saving..."
                          className="adm-btn-primary py-1 px-3 text-[11px]"
                        >
                          Save Client Bundle
                        </SubmitButton>
                      </div>
                    </form>
                  </details>
                </div>
              );
            })}
          </div>

          <details className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-xs">
            <summary className="cursor-pointer font-semibold text-slate-900 select-none">
              + Create a Brand-New Bespoke Bundle Package Exclusively for {workspaceName}
            </summary>
            <form
              action={staffCreateClientCustomBundleAction}
              className="mt-4 space-y-3.5 border-t border-zinc-200/80 pt-4"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToPlans} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="adm-label">Custom Bundle Name *</label>
                  <input
                    name="name"
                    required
                    placeholder={`e.g. ${workspaceName} Growth Suite`}
                    className="adm-input"
                  />
                </div>
                <div>
                  <label className="adm-label">Short Tagline</label>
                  <input
                    name="tagline"
                    placeholder="Tailored combination of tools negotiated for your team"
                    className="adm-input"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="adm-label">Monthly Price (₹) *</label>
                  <input
                    name="monthlyRupees"
                    type="number"
                    min="1"
                    required
                    defaultValue="2999"
                    className="adm-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="adm-label">Quarterly Price (₹)</label>
                  <input
                    name="quarterlyRupees"
                    type="number"
                    min="1"
                    defaultValue="8099"
                    className="adm-input tabular-nums"
                  />
                </div>
                <div>
                  <label className="adm-label">Yearly Price (₹)</label>
                  <input
                    name="yearlyRupees"
                    type="number"
                    min="1"
                    defaultValue="28799"
                    className="adm-input tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="adm-label">Select Included Tools (at least 2) *</label>
                <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SERVICE_CATALOG.map((svc, idx) => (
                    <label
                      key={svc.key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                    >
                      <input
                        type="checkbox"
                        name="includedKeys"
                        value={svc.key}
                        defaultChecked={idx < 3}
                      />
                      <span className="truncate">{svc.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <SubmitButton className="adm-btn-primary" pendingText="Creating...">
                  Create Bespoke Client Bundle
                </SubmitButton>
              </div>
            </form>
          </details>
        </div>
      </SectionCard>

      {/* ROW 3: Individual Plans - Clean Summary Rows with Expand-on-Demand Controls */}
      <SectionCard
        title="Individual Plans & Negotiated Client Pricing (Monthly / Quarterly / Yearly)"
        subtitle="Click 'Edit Rates' on any row to set custom negotiated Rupee prices, or click 'Unlock Plan' to record payment."
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-6 py-3 font-semibold">Feature Plan</th>
                <th className="px-4 py-3 font-semibold">Status &amp; Cycle</th>
                <th className="px-4 py-3 font-semibold">Effective Client Rates</th>
                <th className="px-6 py-3 text-right font-semibold">Unlock / Lock Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {plans.map((p) => {
                const effectiveMonthly = Math.round(p.monthlyAmountPaise / 100);
                const effectiveQuarterly = Math.round(p.quarterlyAmountPaise / 100);
                const effectiveYearly = Math.round(p.yearlyAmountPaise / 100);
                const standardMonthly = Math.round(p.standardMonthlyAmountPaise / 100);

                return (
                  <tr key={p.key} className="align-top">
                    <td className="px-6 py-3.5">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
                        {p.category} • Catalog ₹{standardMonthly}/mo
                        {p.hasCustomPriceOverride && (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                            Custom Rate
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <StatusPill
                        label={
                          p.isComplimentaryFreeAccess
                            ? "Free Access"
                            : p.isPaidUnlocked
                              ? `Active (${BILLING_CYCLE_META[p.billingCycle].shortLabel})`
                              : p.pendingRequest
                                ? `Requested (${BILLING_CYCLE_META[(p.pendingRequest.billingCycle as "monthly" | "quarterly" | "yearly") || "monthly"]?.shortLabel ?? "Monthly"})`
                                : "Locked"
                        }
                        tone={
                          p.isUnlocked ? "emerald" : p.pendingRequest ? "amber" : "stone"
                        }
                      />
                      {p.expiresAt && (
                        <div className="mt-1 text-[10.5px] text-zinc-500 tabular-nums">
                          Until{" "}
                          {new Date(p.expiresAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-2 tabular-nums">
                        <span className="text-zinc-700">
                          <strong>₹{effectiveMonthly}</strong>/mo •{" "}
                          <strong>₹{effectiveQuarterly}</strong>/qtr •{" "}
                          <strong>₹{effectiveYearly}</strong>/yr
                        </span>
                      </div>
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] font-semibold text-emerald-700 select-none hover:underline">
                          Edit Negotiated Rates
                        </summary>
                        <form
                          action={staffSetClientCustomPriceAction}
                          className="mt-2 flex flex-wrap items-center gap-1.5"
                        >
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <input type="hidden" name="serviceKey" value={p.key} />
                          <input type="hidden" name="returnTo" value={returnToPlans} />
                          <input
                            name="customMonthlyRupees"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={effectiveMonthly}
                            title="Monthly (₹)"
                            aria-label={`${p.name} Custom Monthly Rupees`}
                            className="adm-input !w-20 py-1 text-xs tabular-nums"
                          />
                          <input
                            name="customQuarterlyRupees"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={effectiveQuarterly}
                            title="Quarterly (₹)"
                            aria-label={`${p.name} Custom Quarterly Rupees`}
                            className="adm-input !w-22 py-1 text-xs tabular-nums"
                          />
                          <input
                            name="customYearlyRupees"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={effectiveYearly}
                            title="Yearly (₹)"
                            aria-label={`${p.name} Custom Yearly Rupees`}
                            className="adm-input !w-24 py-1 text-xs tabular-nums"
                          />
                          <SubmitButton
                            name="mode"
                            value="set"
                            spinnerSize="xs"
                            pendingText="..."
                            className="adm-btn-secondary py-1 px-2.5 text-[11px]"
                          >
                            Save
                          </SubmitButton>
                          {p.hasCustomPriceOverride && (
                            <SubmitButton
                              name="mode"
                              value="clear"
                              spinnerSize="xs"
                              pendingText="..."
                              className="adm-btn-secondary py-1 px-2 text-[11px] text-zinc-500"
                            >
                              Reset
                            </SubmitButton>
                          )}
                        </form>
                      </details>
                    </td>

                    <td className="px-6 py-3.5 text-right">
                      {p.isPaidUnlocked ? (
                        <form action={staffRevokePlanAction} className="inline-flex justify-end">
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <input type="hidden" name="serviceKey" value={p.key} />
                          <input type="hidden" name="returnTo" value={returnToPlans} />
                          <SubmitButton
                            className="adm-btn-danger py-1.5 text-xs"
                            spinnerSize="xs"
                            pendingText="Locking..."
                          >
                            Lock Plan
                          </SubmitButton>
                        </form>
                      ) : (
                        <details
                          open={Boolean(p.pendingRequest)}
                          className="inline-block text-right"
                        >
                          <summary className="cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 select-none hover:bg-emerald-100/80">
                            {p.isComplimentaryFreeAccess
                              ? "Record Paid Plan"
                              : p.pendingRequest
                                ? "VerifyUTR & Unlock"
                                : "Unlock Plan →"}
                          </summary>
                          <form
                            action={staffRecordPlanPaymentAction}
                            className="mt-2 inline-flex flex-wrap items-center justify-end gap-1.5"
                          >
                            <input type="hidden" name="workspaceId" value={workspaceId} />
                            <input type="hidden" name="serviceKey" value={p.key} />
                            <input type="hidden" name="returnTo" value={returnToPlans} />
                            <input type="hidden" name="paymentMethod" value="upi" />
                            <select
                              name="billingCycle"
                              aria-label={`${p.name} billing cycle`}
                              defaultValue={p.pendingRequest?.billingCycle ?? "monthly"}
                              className="adm-input !w-26 py-1 text-xs"
                            >
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                            <input
                              name="amountRupees"
                              type="number"
                              min="1"
                              required
                              defaultValue={Math.max(1, effectiveMonthly)}
                              className="adm-input !w-20 py-1 text-xs tabular-nums"
                              title="Amount Received (₹)"
                              aria-label={`${p.name} amount received in rupees`}
                            />
                            <input
                              name="paymentReference"
                              required
                              minLength={3}
                              defaultValue={p.pendingRequest?.customerPaymentRef ?? ""}
                              placeholder="UTR / Ref #"
                              aria-label={`${p.name} payment UTR reference`}
                              className="adm-input !w-28 py-1 font-mono text-xs"
                            />
                            <SubmitButton
                              className="adm-btn-primary py-1 text-xs"
                              spinnerSize="xs"
                              pendingText="Unlocking..."
                            >
                              Unlock
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
