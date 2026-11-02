import { eq } from "drizzle-orm";
import {
  Building2,
  Clock,
  IndianRupee,
  Wallet,
} from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import { canStaffPerform } from "@rsl/auth";
import {
  BILLING_CYCLE_META,
  ensureServiceCatalogSeeded,
  listPendingPlatformRechargeRequests,
  listPlatformPlanRequests,
  SERVICE_CATALOG,
} from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { controlDb } from "@rsl/tenancy";
import { FlashBanner, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffAdjustWalletAction,
  staffApproveRechargeAction,
  staffDeclinePlanRequestAction,
  staffRecordPlanPaymentAction,
  staffRejectRechargeAction,
  staffRevokePlanAction,
  staffRunBillingReminderSweepAction,
  staffStartImpersonationAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const canViewBilling = canStaffPerform(staff.staffRole, "staff:billing.view");
  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const canImpersonate = canStaffPerform(staff.staffRole, "staff:impersonate");
  ensureServiceCatalogSeeded();
  const sp = await searchParams;
  const adminData = getPlatformAdminAnalytics();
  const pendingPlanRequests = listPlatformPlanRequests("pending_payment");
  const allRecentPlanRequests = listPlatformPlanRequests().slice(0, 10);
  const processedPlanRequests = allRecentPlanRequests.filter((r) => r.status !== "pending_payment");
  const pendingRecharges = listPendingPlatformRechargeRequests();

  const prices = controlDb()
    .select()
    .from(controlSchema.servicePrices)
    .where(eq(controlSchema.servicePrices.active, true))
    .all();
  const priceByKey = new Map(prices.map((p) => [p.serviceKey, p]));
  const catalogByKey = new Map(SERVICE_CATALOG.map((s) => [s.key, s]));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={
          <StatusPill
            label={
              pendingPlanRequests.length + pendingRecharges.length > 0
                ? `${pendingPlanRequests.length + pendingRecharges.length} Pending Approvals`
                : "All Approvals Up to Date"
            }
            tone={pendingPlanRequests.length + pendingRecharges.length > 0 ? "amber" : "emerald"}
          />
        }
        title="Overview & Payment Approvals"
        subtitle="Verify client UPI / Bank payments to unlock requested features, approve wallet top-ups, and jump into any client account."
        actions={
          <>
            {canManageBilling && (
              <form action={staffRunBillingReminderSweepAction} className="inline-flex">
                <input type="hidden" name="returnTo" value="/" />
                <SubmitButton
                  className="adm-btn-secondary"
                  spinnerSize="xs"
                  pendingText="Checking..."
                >
                  Run Renewal Sweep
                </SubmitButton>
              </form>
            )}
            <ActionLink href="/clients" className="adm-btn-secondary">
              Client Directory ({adminData.totals.totalBusinesses})
            </ActionLink>
            {canViewBilling && (
              <ActionLink href="/invoices" className="adm-btn-secondary">
                GST Invoices
              </ActionLink>
            )}
            {canManageClients && (
              <ActionLink href="/clients?new=1" className="adm-btn-primary">
                + Onboard Client
              </ActionLink>
            )}
          </>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pending Plan Requests"
          value={String(pendingPlanRequests.length)}
          sublabel="Clients waiting for feature activation"
          accent={pendingPlanRequests.length > 0 ? "amber" : "emerald"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Wallet Top-Ups"
          value={String(pendingRecharges.length)}
          sublabel="UPI / Bank transfers waiting for check"
          accent={pendingRecharges.length > 0 ? "amber" : "emerald"}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Total Revenue Collected"
          value={formatInr(adminData.totals.totalInvoicedRevenuePaise)}
          sublabel="Paid GST invoices (incl. 18% GST)"
          accent="emerald"
          icon={<IndianRupee className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Client Accounts"
          value={String(adminData.totals.totalBusinesses)}
          sublabel={`${adminData.totals.effectiveUnlockedToolsCount} tools active${
            adminData.totals.freeAccessClientsCount > 0
              ? ` (${adminData.totals.freeAccessClientsCount} free-access)`
              : ""
          } • ${formatInr(adminData.totals.totalWalletLiabilityPaise, { showDecimals: true })} in wallets`}
          icon={<Building2 className="h-3.5 w-3.5" />}
        />
      </div>

      {/* SECTION 1: Pending Plan Activation Requests */}
      <SectionCard
        title={`Plan Activation Requests (${pendingPlanRequests.length})`}
        subtitle="Clients cannot turn on plans themselves — record their payment below to unlock the feature and issue a GST invoice"
        action={
          <StatusPill
            label={
              pendingPlanRequests.length > 0
                ? `${pendingPlanRequests.length} Waiting`
                : "Zero Pending"
            }
            tone={pendingPlanRequests.length > 0 ? "amber" : "emerald"}
          />
        }
        noPadding
      >
        {pendingPlanRequests.length === 0 ? (
          <div className="px-6 py-5 text-xs text-zinc-500">
            No pending plan requests right now. Whenever a client requests a feature on their dashboard, it appears here immediately.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {pendingPlanRequests.map((req) => {
              const suggestedRupees =
                req.effectiveCyclePaise > 0 ? Math.round(req.effectiveCyclePaise / 100) : 500;
              const gstTotalPaise = Math.round(req.effectiveCyclePaise * 1.18);
              const cycleMeta = BILLING_CYCLE_META[req.billingCycle];

              return (
                <div
                  key={req.id}
                  className="grid grid-cols-1 gap-5 p-6 2xl:grid-cols-[1.05fr_1.45fr] 2xl:items-center"
                >
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Clock className="h-3 w-3" />
                        <span>Waiting for Payment</span>
                      </span>
                      <StatusPill label={cycleMeta.label} tone="emerald" />
                      {req.bundleKey && (
                        <StatusPill
                          label={`Bundle (${req.includedKeys.length} tools)`}
                          tone="sky"
                        />
                      )}
                      <span className="text-[11px] text-zinc-500">
                        {new Date(req.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>

                    <div>
                      <div className="text-base font-bold text-slate-900">{req.serviceName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                        <span>Client:</span>
                        <ActionLink
                          href={`/clients/${req.workspaceId}`}
                          className="font-semibold text-emerald-700 hover:underline"
                        >
                          {req.workspaceName}
                        </ActionLink>
                        {req.requesterEmail && (
                          <span className="text-zinc-400">
                            • {req.requesterName} ({req.requesterEmail})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-semibold text-slate-900 tabular-nums">
                        Quoted ({cycleMeta.shortLabel}):{" "}
                        <span className="text-emerald-700">
                          {formatInr(req.effectiveCyclePaise)}
                        </span>
                        {req.effectiveCyclePaise > 0 && (
                          <span className="ml-1 font-normal text-zinc-500">
                            ({formatInr(gstTotalPaise)} with 18% GST)
                          </span>
                        )}
                      </span>
                    </div>

                    {(req.customerPaymentRef || req.customerNote) && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-xs text-slate-900">
                        {req.customerPaymentRef && (
                          <div>
                            <span className="font-medium text-zinc-600">Client Payment Ref:</span>{" "}
                            <span className="font-mono font-bold">{req.customerPaymentRef}</span>
                          </div>
                        )}
                        {req.customerNote && (
                          <div className="mt-0.5">
                            <span className="font-medium text-zinc-600">Client Note:</span>{" "}
                            {req.customerNote}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {canManageBilling ? (
                    <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4">
                      <form action={staffRecordPlanPaymentAction} className="space-y-3 text-xs">
                        <input type="hidden" name="requestId" value={req.id} />
                        <input type="hidden" name="workspaceId" value={req.workspaceId} />
                        <input type="hidden" name="serviceKey" value={req.serviceKey} />
                        <input type="hidden" name="returnTo" value="/" />

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                          <div>
                            <label className="mb-1 block font-semibold text-slate-800">
                              Billing Cycle *
                            </label>
                            <select
                              name="billingCycle"
                              defaultValue={req.billingCycle}
                              className="adm-input"
                            >
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block font-semibold text-slate-800">
                              Subtotal Paid (₹) *
                            </label>
                            <input
                              name="amountRupees"
                              type="number"
                              min="1"
                              step="1"
                              required
                              defaultValue={suggestedRupees}
                              className="adm-input tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block font-semibold text-slate-800">
                              Method *
                            </label>
                            <select name="paymentMethod" defaultValue="upi" className="adm-input">
                              <option value="upi">UPI</option>
                              <option value="bank_transfer">Bank Transfer</option>
                              <option value="razorpay">Razorpay</option>
                              <option value="cash">Cash</option>
                              <option value="cheque">Cheque</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block font-semibold text-slate-800">
                              UTR / Receipt No. *
                            </label>
                            <input
                              name="paymentReference"
                              required
                              minLength={3}
                              defaultValue={req.customerPaymentRef || ""}
                              placeholder="Enter UTR or receipt #"
                              className="adm-input font-mono"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          {req.dependsOn.length > 0 ? (
                            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                              <input
                                type="checkbox"
                                name="includePrerequisites"
                                value="on"
                                defaultChecked
                                className="h-4 w-4 rounded"
                              />
                              <span>Also unlock companion base plans</span>
                            </label>
                          ) : (
                            <span className="text-[11px] text-zinc-500">
                              Unlocks feature immediately &amp; generates sequential GST invoice
                            </span>
                          )}

                          <SubmitButton
                            className="adm-btn-primary"
                            spinnerSize="xs"
                            pendingText="Unlocking..."
                          >
                            Record Payment &amp; Unlock
                          </SubmitButton>
                        </div>
                      </form>

                      <form
                        action={staffDeclinePlanRequestAction}
                        className="mt-2.5 flex items-center justify-between gap-2 border-t border-zinc-200/80 pt-2.5 text-xs"
                      >
                        <input type="hidden" name="requestId" value={req.id} />
                        <input type="hidden" name="returnTo" value="/" />
                        <input
                          name="staffNotes"
                          placeholder="Reason if declining (optional)"
                          className="adm-input py-1.5 text-xs"
                        />
                        <SubmitButton
                          className="adm-btn-danger py-1.5 text-xs"
                          spinnerSize="xs"
                          pendingText="Declining..."
                        >
                          Decline
                        </SubmitButton>
                      </form>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-xs text-zinc-600">
                      Awaiting Finance or Super Admin payment verification.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* SECTION 2: Wallet Top-Up Verification */}
      <SectionCard
        title={`Wallet Top-Up Payments (${pendingRecharges.length})`}
        subtitle="Verify UPI / Bank transfers before adding balance to a client's wallet"
        action={
          <StatusPill
            label={pendingRecharges.length > 0 ? `${pendingRecharges.length} Waiting` : "Zero Pending"}
            tone={pendingRecharges.length > 0 ? "amber" : "emerald"}
          />
        }
        noPadding
      >
        {pendingRecharges.length === 0 ? (
          <div className="px-6 py-5 text-xs text-zinc-500">
            No wallet payments waiting for approval right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Client</th>
                  <th className="px-6 py-3 font-semibold">Method &amp; UTR Number</th>
                  <th className="px-6 py-3 font-semibold">Amount</th>
                  <th className="px-6 py-3 font-semibold">Submitted</th>
                  <th className="px-6 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pendingRecharges.map((req) => (
                  <tr key={req.id}>
                    <td className="px-6 py-3.5 font-semibold text-slate-900">
                      <ActionLink
                        href={`/clients/${req.workspaceId}`}
                        className="hover:text-emerald-700 hover:underline"
                      >
                        {req.workspaceName}
                      </ActionLink>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] font-semibold">
                        {req.provider.toUpperCase()}
                      </span>{" "}
                      <span className="font-mono font-bold text-slate-900">
                        {req.externalPaymentId}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-sm font-bold text-emerald-700 tabular-nums">
                      {formatInr(req.amountPaise)}
                    </td>
                    <td className="px-6 py-3.5 text-zinc-500">
                      {new Date(req.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {canManageBilling ? (
                        <div className="flex items-center justify-end gap-2">
                          <form action={staffApproveRechargeAction}>
                            <input type="hidden" name="paymentId" value={req.id} />
                            <input type="hidden" name="returnTo" value="/" />
                            <SubmitButton
                              className="adm-btn-primary py-1.5 text-xs"
                              spinnerSize="xs"
                              pendingText="Approving..."
                            >
                              Approve &amp; Add Balance
                            </SubmitButton>
                          </form>
                          <form action={staffRejectRechargeAction}>
                            <input type="hidden" name="paymentId" value={req.id} />
                            <input type="hidden" name="returnTo" value="/" />
                            <SubmitButton
                              className="adm-btn-danger py-1.5 text-xs"
                              spinnerSize="xs"
                              pendingText="Declining..."
                            >
                              Decline
                            </SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-500">Finance verification</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* SECTION 3: Quick Billing Desk Forms */}
      {canManageBilling && (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Unlock a Plan Directly"
          subtitle="Record a payment received over phone, UPI, or bank transfer to unlock a feature right away"
        >
          <form action={staffRecordPlanPaymentAction} className="space-y-3.5 text-xs">
            <input type="hidden" name="returnTo" value="/" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Client *</label>
                <select name="workspaceId" required className="adm-input">
                  {adminData.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Plan to Unlock *</label>
                <select name="serviceKey" required className="adm-input">
                  {SERVICE_CATALOG.map((s) => {
                    const pr = priceByKey.get(s.key);
                    const monthly = Math.round(
                      (pr?.monthlyAmountPaise ?? s.defaultMonthlyPaise) / 100
                    );
                    return (
                      <option key={s.key} value={s.key}>
                        {s.name} — ₹{monthly}/mo
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-slate-800">
                  Amount Received (₹) *
                </label>
                <input
                  name="amountRupees"
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder="e.g. 999"
                  className="adm-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Payment Method *</label>
                <select name="paymentMethod" defaultValue="upi" className="adm-input">
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="razorpay">Razorpay</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">UTR / Receipt No. *</label>
                <input
                  name="paymentReference"
                  required
                  minLength={3}
                  placeholder="UTR or receipt #"
                  className="adm-input font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  name="includePrerequisites"
                  value="on"
                  defaultChecked
                  className="h-4 w-4 rounded"
                />
                <span>Unlock companion base plans automatically</span>
              </label>

              <SubmitButton className="adm-btn-primary" pendingText="Unlocking...">
                Record Payment &amp; Unlock
              </SubmitButton>
            </div>
          </form>
        </SectionCard>

        <SectionCard
          title="Quick Wallet Adjustment"
          subtitle="Add promotional credit or adjust a client's wallet balance with an audit note"
        >
          <form action={staffAdjustWalletAction} className="space-y-3.5 text-xs">
            <input type="hidden" name="returnTo" value="/" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Client *</label>
                <select name="workspaceId" required className="adm-input">
                  {adminData.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Action *</label>
                <select name="direction" defaultValue="credit" className="adm-input">
                  <option value="credit">Add Balance (+₹)</option>
                  <option value="debit">Deduct Balance (-₹)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Amount (₹) *</label>
                <input
                  name="amountRupees"
                  type="number"
                  min="1"
                  required
                  placeholder="e.g. 1000"
                  className="adm-input tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-slate-800">Note / Reason *</label>
              <div className="flex flex-wrap gap-2.5">
                <input
                  name="reason"
                  required
                  minLength={5}
                  placeholder="e.g. Onboarding welcome credit"
                  className="adm-input flex-1"
                />
                <SubmitButton className="adm-btn-dark" pendingText="Updating...">
                  Update Wallet
                </SubmitButton>
              </div>
            </div>
          </form>
        </SectionCard>
      </div>
      )}

      {/* SECTION 4: Client Accounts Quick View */}
      <SectionCard
        title={`Client Accounts (${adminData.businesses.length})`}
        subtitle="Click any client to edit profile, set custom pricing, unlock bundles, reset passwords, or manage GST invoices"
        action={
          <ActionLink href="/clients" className="adm-btn-secondary py-1.5 text-xs">
            Open Full Client Directory →
          </ActionLink>
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-6 py-3 font-semibold">Client Business</th>
                <th className="px-4 py-3 font-semibold">Active Paid Plans</th>
                <th className="px-4 py-3 font-semibold">Wallet</th>
                <th className="px-6 py-3 text-right font-semibold">Controls &amp; Support</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {adminData.businesses.slice(0, 12).map((b) => {
                const activeKeys = b.activeServiceKeysCsv
                  ? b.activeServiceKeysCsv.split(",").filter(Boolean)
                  : [];

                return (
                  <tr key={b.id} className="align-top">
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionLink
                          href={`/clients/${b.id}`}
                          className="text-sm font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                        >
                          {b.name}
                        </ActionLink>
                        {b.billingStatus === "suspended" && (
                          <StatusPill label="Paused" tone="ruby" />
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        <span>State {b.stateCode}</span>
                        {b.gstin && <span>• GSTIN {b.gstin}</span>}
                        {b.pendingRequestsCount > 0 && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
                            {b.pendingRequestsCount} pending request(s)
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="max-w-md px-4 py-4">
                      {b.hasFreeAllTools && activeKeys.length === 0 ? (
                        <StatusPill
                          label={`All ${SERVICE_CATALOG.length} Tools (Free Access • ${b.freeAccessRemainingDays}d left)`}
                          tone="emerald"
                        />
                      ) : activeKeys.length === 0 ? (
                        <span className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                          No active plans
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {b.hasFreeAllTools && (
                            <StatusPill
                              label={`Free All-Tools (${b.freeAccessRemainingDays}d left)`}
                              tone="emerald"
                            />
                          )}
                          {activeKeys.map((key) => {
                            const svc = catalogByKey.get(key);
                            return canManageBilling ? (
                              <form
                                key={key}
                                action={staffRevokePlanAction}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/80 py-0.5 pr-1 pl-2.5 text-[11px] font-semibold text-emerald-800"
                              >
                                <input type="hidden" name="workspaceId" value={b.id} />
                                <input type="hidden" name="serviceKey" value={key} />
                                <input type="hidden" name="returnTo" value="/" />
                                <span>{svc?.name ?? key}</span>
                                <SubmitButton
                                  iconOnly
                                  title={`Lock ${svc?.name ?? key}`}
                                  spinnerSize="xs"
                                  className="h-4 w-4 rounded text-emerald-700 transition hover:bg-rose-100 hover:text-rose-700"
                                >
                                  <span aria-hidden="true">×</span>
                                </SubmitButton>
                              </form>
                            ) : (
                              <span
                                key={key}
                                className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800"
                              >
                                {svc?.name ?? key}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-4 tabular-nums">
                      <div
                        className={`text-sm font-bold ${
                          b.walletBalancePaise < 0 ? "text-rose-700" : "text-slate-900"
                        }`}
                      >
                        {formatInr(b.walletBalancePaise, { showDecimals: true })}
                      </div>
                      {b.walletBalancePaise < 0 && (
                        <div className="mt-0.5 text-[10.5px] font-semibold text-amber-700">
                          Overdraft (-₹200 limit)
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <ActionLink
                          href={`/clients/${b.id}`}
                          className="adm-btn-secondary py-1.5 text-xs"
                        >
                          Manage Client →
                        </ActionLink>
                        {canImpersonate && (
                          <form
                            action={staffStartImpersonationAction}
                            className="inline-flex items-center gap-1.5"
                          >
                            <input type="hidden" name="workspaceId" value={b.id} />
                            <input type="hidden" name="returnTo" value="/" />
                            <input
                              name="reason"
                              required
                              minLength={5}
                              defaultValue="Account support check"
                              aria-label="Support reason"
                              className="adm-input w-40 py-1.5 text-xs"
                            />
                            <SubmitButton
                              className="adm-btn-dark py-1.5 text-xs"
                              spinnerSize="xs"
                              pendingText="Opening..."
                            >
                              Support View ↗
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {processedPlanRequests.length > 0 && (
        <SectionCard
          title="Recent Plan Approvals & Declines"
          subtitle="Completed feature request verifications"
          noPadding
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Payment Details</th>
                  <th className="px-6 py-3 text-right font-semibold">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {processedPlanRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-6 py-3 font-semibold text-slate-900">
                      <ActionLink
                        href={`/clients/${r.workspaceId}`}
                        className="hover:text-emerald-700 hover:underline"
                      >
                        {r.workspaceName}
                      </ActionLink>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{r.serviceName}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        label={r.status === "activated" ? "Unlocked & Paid" : "Declined"}
                        tone={r.status === "activated" ? "emerald" : "ruby"}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-zinc-600">
                      {r.status === "activated"
                        ? `${formatInr(r.amountPaidPaise ?? 0)} • ${(r.paymentMethod ?? "upi").toUpperCase()} (${r.paymentReference ?? "—"})`
                        : r.staffNotes ?? "Declined"}
                    </td>
                    <td className="px-6 py-3 text-right text-zinc-500">
                      {r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("en-IN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
