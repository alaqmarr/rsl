import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  Layers,
  MessageSquare,
  Wallet,
} from "lucide-react";
import {
  canStaffPerform,
  formatStaffRoleLabel,
  listWorkspaceTeam,
} from "@rsl/auth";
import {
  BILLING_CYCLE_META,
  getWalletAvailableSpendPaise,
  getWalletBalancePaise,
  getWorkspaceFreeAccessStatus,
  INDIA_GST_STATES,
  listBundlesWithWorkspaceState,
  listLedgerEntries,
  listServicesWithWorkspaceState,
  listWorkspaceBillingReminders,
  SERVICE_CATALOG,
} from "@rsl/billing";
import { formatInr, resolvePublicEndpoints } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { ensureWorkspaceSslProvisioned } from "@rsl/queue";
import { controlDb } from "@rsl/tenancy";
import {
  AccessRestrictedState,
  FlashBanner,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffAdjustWalletAction,
  staffBulkUnlockBundleAction,
  staffCreateClientCustomBundleAction,
  staffCreateCustomInvoiceAction,
  staffGrantFreeAllToolsAction,
  staffProvisionClientSslAction,
  staffRecordPlanPaymentAction,
  staffResetClientPasswordAction,
  staffRevokeFreeAllToolsAction,
  staffRevokePlanAction,
  staffSeedStarterTemplatesAction,
  staffSendBillingReminderNowAction,
  staffSendClientEmailAction,
  staffSetClientBundleOverrideAction,
  staffSetClientCustomPriceAction,
  staffStartImpersonationAction,
  staffToggleAutoBillingRemindersAction,
  staffUpdateClientProfileAction,
  staffVerifyClientEmailAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const canViewBilling = canStaffPerform(staff.staffRole, "staff:billing.view");
  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const canImpersonate = canStaffPerform(staff.staffRole, "staff:impersonate");
  const canManageTemplates = canStaffPerform(staff.staffRole, "staff:templates.manage");
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const canSendEmail = canManageBilling || canManageOps;
  const canProvisionSsl = canManageClients || canManageOps;

  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab || (canManageBilling ? "plans" : "profile");

  const db = controlDb();
  const workspace = db
    .select()
    .from(controlSchema.workspaces)
    .where(eq(controlSchema.workspaces.id, id))
    .get();

  if (!workspace) {
    notFound();
  }

  const sslCerts = await ensureWorkspaceSslProvisioned(workspace.id, workspace.slug);
  const clientEndpoints = resolvePublicEndpoints({
    workspaceSlug: workspace.slug,
    preferLocal: false,
  });
  const walletPaise = getWalletBalancePaise(workspace.id);
  const overdraftRemainingPaise = getWalletAvailableSpendPaise(walletPaise);
  const freeAccess = getWorkspaceFreeAccessStatus(workspace.id);
  const plans = listServicesWithWorkspaceState(workspace.id);
  const bundles = listBundlesWithWorkspaceState(workspace.id);
  const reminders = listWorkspaceBillingReminders(workspace.id, 6);
  const ledger = listLedgerEntries(workspace.id, 30);
  const team = listWorkspaceTeam(workspace.id);
  const invoices = db
    .select()
    .from(controlSchema.invoices)
    .where(eq(controlSchema.invoices.workspaceId, workspace.id))
    .orderBy(desc(controlSchema.invoices.issuedAt))
    .limit(25)
    .all();

  const connections = db
    .select()
    .from(controlSchema.connections)
    .where(eq(controlSchema.connections.workspaceId, workspace.id))
    .all();

  const usersById = new Map(
    db
      .select()
      .from(controlSchema.users)
      .all()
      .map((u) => [u.id, u])
  );

  const unlockedCount = plans.filter((p) => p.isUnlocked).length;
  const pendingCount = plans.filter((p) => Boolean(p.pendingRequest)).length;
  const isPaused = workspace.billingStatus === "suspended";
  const ownerEmail = team.members[0]?.email || "";

  const returnHere = `/clients/${workspace.id}?tab=${activeTab}`;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={
          <>
            <ActionLink href="/clients" className="text-xs font-semibold text-zinc-500 hover:text-slate-900">
              ← Client Directory
            </ActionLink>
            <span className="text-zinc-300">/</span>
            <StatusPill
              label={isPaused ? "Account Paused" : "Active Account"}
              tone={isPaused ? "ruby" : "emerald"}
            />
            {freeAccess.isActive && (
              <StatusPill
                label={`Free All-Tools Access (${freeAccess.remainingDays}d left)`}
                tone="emerald"
              />
            )}
            {workspace.gstin && (
              <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-600">
                GSTIN: {workspace.gstin}
              </span>
            )}
          </>
        }
        title={workspace.name}
        subtitle={`Client ID: ${workspace.id} • State Code ${workspace.stateCode} (${
          workspace.stateCode === "27" ? "CGST + SGST" : "IGST 18%"
        }) • Created ${new Date(workspace.createdAt).toLocaleDateString("en-IN")}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewBilling && (
              <a
                href={`/api/pdf/client-statement?workspaceId=${workspace.id}`}
                className="adm-btn-secondary text-xs"
              >
                Statement PDF
              </a>
            )}

            {canManageClients && (
              <form action={staffUpdateClientProfileAction}>
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input type="hidden" name="name" value={workspace.name} />
                <input type="hidden" name="industry" value={workspace.industry ?? ""} />
                <input type="hidden" name="gstin" value={workspace.gstin ?? ""} />
                <input type="hidden" name="stateCode" value={workspace.stateCode} />
                <input
                  type="hidden"
                  name="billingStatus"
                  value={isPaused ? "active" : "suspended"}
                />
                <input type="hidden" name="returnTo" value={returnHere} />
                <SubmitButton
                  className={isPaused ? "adm-btn-primary text-xs" : "adm-btn-danger text-xs"}
                  spinnerSize="xs"
                  pendingText={isPaused ? "Activating..." : "Pausing..."}
                >
                  {isPaused ? "Reactivate Account" : "Pause Account"}
                </SubmitButton>
              </form>
            )}

            {canImpersonate && (
              <form action={staffStartImpersonationAction} className="inline-flex items-center gap-1.5">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input type="hidden" name="returnTo" value={returnHere} />
                <input type="hidden" name="reason" value="Client onboarding & support assistance" />
                <SubmitButton className="adm-btn-dark text-xs" spinnerSize="xs" pendingText="Opening...">
                  Open Client Dashboard (30m) ↗
                </SubmitButton>
              </form>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* Client Summary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Unlocked Tools"
          value={`${unlockedCount} / ${plans.length}`}
          sublabel={
            freeAccess.isActive
              ? `Complimentary all-tools access (${freeAccess.remainingDays}d left)`
              : pendingCount > 0
                ? `${pendingCount} request(s) waiting for payment`
                : "All active plans verified"
          }
          accent={unlockedCount > 0 ? "emerald" : "default"}
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="Wallet Balance"
          value={formatInr(walletPaise, { showDecimals: true })}
          sublabel={
            walletPaise < 0
              ? `Overdraft active • ${formatInr(overdraftRemainingPaise, { showDecimals: true })} left of ₹200.00 limit`
              : `${ledger.length} recent passbook entries`
          }
          accent={walletPaise < 0 ? "ruby" : "emerald"}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="GST Tax Invoices"
          value={String(invoices.length)}
          sublabel={
            invoices[0] ? `Latest: ${invoices[0].invoiceNumber}` : "No GST invoices issued yet"
          }
        />
        <MetricCard
          label="Auto Renewal Reminders"
          value={freeAccess.autoBillingReminders ? "Enabled" : "Paused"}
          sublabel={`${reminders.length} reminder(s) logged • ${team.members.length} user(s)`}
          accent={freeAccess.autoBillingReminders ? "emerald" : "default"}
        />
      </div>

      {/* Segmented Control Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-2xs">
        {[
          {
            key: "plans",
            label: `Free Access, Bundles, Cycles & Custom Rates (${unlockedCount}/${plans.length})`,
          },
          ...(canViewBilling
            ? [{ key: "finance", label: `Wallet, PDFs & GST Invoices (${invoices.length})` }]
            : []),
          { key: "profile", label: `Business Profile, SSL & Team (${team.members.length})` },
          { key: "support", label: "Templates & Email Tools" },
        ].map((tab) => {
          const isCurrent = activeTab === tab.key;
          return (
            <ActionLink
              key={tab.key}
              href={`/clients/${workspace.id}?tab=${tab.key}`}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                isCurrent
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </ActionLink>
          );
        })}
      </div>

      {/* TAB 1: FREE ACCESS, REMINDERS, BUNDLES & CUSTOM NEGOTIATED PRICING */}
      {activeTab === "plans" && !canManageBilling && (
        <div className="space-y-6">
          <AccessRestrictedState
            pageTitle="Plan Unlocks & Custom Client Pricing"
            roleLabel={formatStaffRoleLabel(staff.staffRole)}
            requiredPermissionLabel="Manage client billing, wallet & plan unlocks"
            description={`Your ${formatStaffRoleLabel(staff.staffRole)} account has read-only visibility into unlocked plans. Ask a Finance or Super Admin team member to grant complimentary access, change negotiated bundle rates, or record paid renewals.`}
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
      )}

      {activeTab === "plans" && canManageBilling && (
        <div className="space-y-6">
          {/* ROW 1: Complimentary Free Access + Automatic Renewal Reminders */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {/* Free Access to All Tools for a Specific Period */}
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
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={`/clients/${workspace.id}?tab=plans`}
                      />
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
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=plans`}
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="adm-label">Preset Period</label>
                      <select name="durationDays" defaultValue="14" className="adm-input">
                        <option value="7">7 Days Trial</option>
                        <option value="14">14 Days Onboarding</option>
                        <option value="30">30 Days (1 Month)</option>
                        <option value="90">90 Days (1 Quarter)</option>
                        <option value="180">180 Days (6 Months)</option>
                        <option value="365">365 Days (1 Year)</option>
                      </select>
                    </div>
                    <div>
                      <label className="adm-label">Or Exact End Date (Optional)</label>
                      <input
                        name="customUntilDate"
                        type="date"
                        className="adm-input tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      name="note"
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

            {/* Automatic & Manual Billing Renewal Reminders */}
            <SectionCard
              title="Automatic Renewal Reminders (Monthly / Quarterly / Yearly)"
              subtitle="Automatically emails UPI payment details 7 days before, 1 day before, and when any plan or bundle renewal falls due."
              action={
                <form action={staffToggleAutoBillingRemindersAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={freeAccess.autoBillingReminders ? "false" : "true"}
                  />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=plans`}
                  />
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
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=plans`}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="adm-label">Billing Cycle</label>
                      <select name="billingCycle" defaultValue="monthly" className="adm-input">
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div>
                      <label className="adm-label">Custom Subtotal ₹ (Opt)</label>
                      <input
                        name="customAmountRupees"
                        type="number"
                        min="1"
                        placeholder="Auto from plans"
                        className="adm-input tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="adm-label">Plan / Bundle Label (Opt)</label>
                      <input
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

          {/* ROW 2: Dependency Bundles, Entire Software Package & Custom Client Bundles */}
          <SectionCard
            title="Bundles & Complete Software Package (Unlock & Customize Per Client)"
            subtitle="Unlock any bundle on Monthly, Quarterly, or Yearly billing — or customize included tools and negotiated rates specifically for this client."
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

                        <p className="text-[11.5px] leading-relaxed text-zinc-600">
                          {bundle.tagline}
                        </p>

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

                      {/* 1-Click Bundle Unlock Form (collapsed cleanly when already fully unlocked) */}
                      {bundle.isFullyUnlocked ? (
                        <details className="mt-3.5 rounded-xl border border-emerald-200/80 bg-white p-3">
                          <summary className="cursor-pointer text-[11px] font-semibold text-emerald-800 select-none">
                            All {bundle.totalServicesCount} tools active — Record Paid Renewal / Convert Bundle
                          </summary>
                          <form
                            action={staffBulkUnlockBundleAction}
                            className="mt-3 space-y-2.5 border-t border-zinc-100 pt-3"
                          >
                            <input type="hidden" name="workspaceId" value={workspace.id} />
                            <input type="hidden" name="bundleKey" value={bundle.key} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={`/clients/${workspace.id}?tab=plans`}
                            />
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
                                pendingText="Recording..."
                              >
                                Record Paid Bundle
                              </SubmitButton>
                            </div>
                          </form>
                        </details>
                      ) : (
                        <form
                          action={staffBulkUnlockBundleAction}
                          className="mt-3.5 space-y-2.5 border-t border-zinc-200/80 pt-3"
                        >
                          <input type="hidden" name="workspaceId" value={workspace.id} />
                          <input type="hidden" name="bundleKey" value={bundle.key} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={`/clients/${workspace.id}?tab=plans`}
                          />

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
                              Unlock Bundle
                            </SubmitButton>
                          </div>
                        </form>
                      )}

                      {/* Collapsible Per-Client Bundle Customization */}
                      <details className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
                        <summary className="cursor-pointer text-[11px] font-semibold text-slate-800 select-none">
                          Customize Bundle Prices &amp; Included Tools for {workspace.name}
                        </summary>
                        <form
                          action={staffSetClientBundleOverrideAction}
                          className="mt-3 space-y-3 border-t border-zinc-100 pt-3"
                        >
                          <input type="hidden" name="workspaceId" value={workspace.id} />
                          <input type="hidden" name="bundleKey" value={bundle.key} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={`/clients/${workspace.id}?tab=plans`}
                          />

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

              {/* Create Bespoke Bundle Specifically for This Client */}
              <details className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-xs">
                <summary className="cursor-pointer font-semibold text-slate-900 select-none">
                  + Create a Brand-New Bespoke Bundle Package Exclusively for {workspace.name}
                </summary>
                <form
                  action={staffCreateClientCustomBundleAction}
                  className="mt-4 space-y-3.5 border-t border-zinc-200/80 pt-4"
                >
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=plans`}
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="adm-label">Custom Bundle Name *</label>
                      <input
                        name="name"
                        required
                        placeholder={`e.g. ${workspace.name} Growth Suite`}
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

          {/* ROW 3: Individual Plans — Custom Monthly / Quarterly / Yearly Client Rates & Cycle Unlock */}
          <SectionCard
            title="Individual Plans & Negotiated Client Pricing (Monthly / Quarterly / Yearly)"
            subtitle="Manually set custom Monthly, Quarterly, and Yearly Rupee prices for this client, or record payment to unlock/lock individual tools."
            noPadding
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Feature Plan</th>
                    <th className="px-4 py-3 font-semibold">Status &amp; Cycle</th>
                    <th className="px-4 py-3 font-semibold">
                      Custom Client Rates (Monthly / Quarterly / Yearly ₹)
                    </th>
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
                      <tr key={p.key} className="align-middle">
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
                                    ? `Requested (${BILLING_CYCLE_META[p.pendingRequest.billingCycle as "monthly" | "quarterly" | "yearly" || "monthly"]?.shortLabel ?? "Monthly"})`
                                    : "Locked"
                            }
                            tone={
                              p.isUnlocked
                                ? "emerald"
                                : p.pendingRequest
                                  ? "amber"
                                  : "stone"
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
                          <form
                            action={staffSetClientCustomPriceAction}
                            className="flex flex-wrap items-center gap-1.5"
                          >
                            <input type="hidden" name="workspaceId" value={workspace.id} />
                            <input type="hidden" name="serviceKey" value={p.key} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={`/clients/${workspace.id}?tab=plans`}
                            />
                            <input
                              name="customMonthlyRupees"
                              type="number"
                              min="0"
                              step="1"
                              defaultValue={effectiveMonthly}
                              title="Monthly (₹)"
                              aria-label={`${p.name} Custom Monthly Rupees`}
                              className="adm-input py-1 text-xs tabular-nums"
                              style={{ width: "5rem" }}
                            />
                            <input
                              name="customQuarterlyRupees"
                              type="number"
                              min="0"
                              step="1"
                              defaultValue={effectiveQuarterly}
                              title="Quarterly (₹)"
                              aria-label={`${p.name} Custom Quarterly Rupees`}
                              className="adm-input py-1 text-xs tabular-nums"
                              style={{ width: "5.5rem" }}
                            />
                            <input
                              name="customYearlyRupees"
                              type="number"
                              min="0"
                              step="1"
                              defaultValue={effectiveYearly}
                              title="Yearly (₹)"
                              aria-label={`${p.name} Custom Yearly Rupees`}
                              className="adm-input py-1 text-xs tabular-nums"
                              style={{ width: "5.75rem" }}
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
                        </td>

                        <td className="px-6 py-3.5 text-right">
                          {p.isPaidUnlocked ? (
                            <form action={staffRevokePlanAction} className="inline-flex justify-end">
                              <input type="hidden" name="workspaceId" value={workspace.id} />
                              <input type="hidden" name="serviceKey" value={p.key} />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={`/clients/${workspace.id}?tab=plans`}
                              />
                              <SubmitButton
                                className="adm-btn-danger py-1.5 text-xs"
                                spinnerSize="xs"
                                pendingText="Locking..."
                              >
                                Lock Plan
                              </SubmitButton>
                            </form>
                          ) : p.isComplimentaryFreeAccess ? (
                            <details className="inline-block text-right">
                              <summary className="cursor-pointer text-[11px] font-semibold text-emerald-700 select-none hover:underline">
                                Active via Free Access • Record Paid Plan
                              </summary>
                              <form
                                action={staffRecordPlanPaymentAction}
                                className="mt-2 inline-flex flex-wrap items-center justify-end gap-1.5"
                              >
                                <input type="hidden" name="workspaceId" value={workspace.id} />
                                <input type="hidden" name="serviceKey" value={p.key} />
                                <input
                                  type="hidden"
                                  name="returnTo"
                                  value={`/clients/${workspace.id}?tab=plans`}
                                />
                                <input type="hidden" name="paymentMethod" value="upi" />
                                <select
                                  name="billingCycle"
                                  defaultValue={p.pendingRequest?.billingCycle ?? "monthly"}
                                  className="adm-input py-1 text-xs"
                                  style={{ width: "6.5rem" }}
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
                                  className="adm-input py-1 text-xs tabular-nums"
                                  style={{ width: "5rem" }}
                                  title="Amount Received (₹)"
                                />
                                <input
                                  name="paymentReference"
                                  required
                                  minLength={3}
                                  defaultValue={p.pendingRequest?.customerPaymentRef ?? ""}
                                  placeholder="UTR / Ref #"
                                  className="adm-input py-1 font-mono text-xs"
                                  style={{ width: "6.75rem" }}
                                />
                                <SubmitButton
                                  className="adm-btn-primary py-1 text-xs"
                                  spinnerSize="xs"
                                  pendingText="Recording..."
                                >
                                  Record Paid
                                </SubmitButton>
                              </form>
                            </details>
                          ) : (
                            <form
                              action={staffRecordPlanPaymentAction}
                              className="inline-flex flex-wrap items-center justify-end gap-1.5"
                            >
                              <input type="hidden" name="workspaceId" value={workspace.id} />
                              <input type="hidden" name="serviceKey" value={p.key} />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={`/clients/${workspace.id}?tab=plans`}
                              />
                              <input type="hidden" name="paymentMethod" value="upi" />
                              <select
                                name="billingCycle"
                                defaultValue={p.pendingRequest?.billingCycle ?? "monthly"}
                                className="adm-input py-1 text-xs"
                                style={{ width: "6.5rem" }}
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
                                className="adm-input py-1 text-xs tabular-nums"
                                style={{ width: "5rem" }}
                                title="Amount Received (₹)"
                              />
                              <input
                                name="paymentReference"
                                required
                                minLength={3}
                                defaultValue={p.pendingRequest?.customerPaymentRef ?? ""}
                                placeholder="UTR / Ref #"
                                className="adm-input py-1 font-mono text-xs"
                                style={{ width: "6.75rem" }}
                              />
                              <SubmitButton
                                className="adm-btn-primary py-1 text-xs"
                                spinnerSize="xs"
                                pendingText="Unlocking..."
                              >
                                Unlock
                              </SubmitButton>
                            </form>
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
      )}

      {/* TAB 2: WALLET & GST INVOICES */}
      {activeTab === "finance" && !canViewBilling && (
        <AccessRestrictedState
          pageTitle="Client Wallet & GST Invoices"
          roleLabel={formatStaffRoleLabel(staff.staffRole)}
          requiredPermissionLabel="View GST invoices & revenue"
          description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to client wallet ledgers or GST tax invoices.`}
        />
      )}

      {activeTab === "finance" && canViewBilling && (
        <div className="space-y-6">
          {canManageBilling && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SectionCard
                title="Add or Deduct Wallet Balance"
                subtitle="Updates this client's prepaid wallet immediately with a permanent audit entry (overdraft allowed down to -₹200.00)"
              >
                <form action={staffAdjustWalletAction} className="space-y-3.5 text-xs">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=finance`}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">Action</label>
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
                        defaultValue="1000"
                        className="adm-input tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-800">Reason / Note *</label>
                    <div className="flex gap-2">
                      <input
                        name="reason"
                        required
                        minLength={5}
                        placeholder="e.g. Verified bank transfer or onboarding bonus"
                        className="adm-input flex-1"
                      />
                      <SubmitButton className="adm-btn-primary" pendingText="Saving...">
                        Update Wallet
                      </SubmitButton>
                    </div>
                  </div>
                </form>
              </SectionCard>

              <SectionCard
                title="Issue Custom GST Tax Invoice"
                subtitle="Generate an official sequential 18% GST invoice (SAC 998314) for onboarding, setup, or custom billing"
              >
                <form action={staffCreateCustomInvoiceAction} className="space-y-3.5 text-xs">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=finance`}
                  />
                  <div>
                    <label className="mb-1 block font-semibold text-slate-800">
                      Invoice Description *
                    </label>
                    <input
                      name="description"
                      required
                      placeholder="e.g. Custom Tally Prime Integration & Setup"
                      className="adm-input"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">
                        Subtotal before GST (₹) *
                      </label>
                      <input
                        name="subtotalRupees"
                        type="number"
                        min="1"
                        required
                        placeholder="2500"
                        className="adm-input tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">Status</label>
                      <select name="status" defaultValue="paid" className="adm-input">
                        <option value="paid">Paid</option>
                        <option value="issued">Issued (Unpaid)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">UTR / Ref</label>
                      <input
                        name="paymentReference"
                        placeholder="UTR #"
                        className="adm-input font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <SubmitButton className="adm-btn-dark" pendingText="Issuing...">
                      Generate GST Invoice
                    </SubmitButton>
                  </div>
                </form>
              </SectionCard>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard
              title="Client Wallet Passbook"
              action={
                <a
                  href={`/api/pdf/client-statement?workspaceId=${workspace.id}`}
                  className="adm-btn-secondary py-1 px-2.5 text-xs"
                >
                  Download Statement PDF
                </a>
              }
              noPadding
            >
              {ledger.length === 0 ? (
                <div className="p-6 text-xs text-zinc-500">No wallet transactions yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                      <tr>
                        <th className="px-5 py-2.5 font-semibold">Description</th>
                        <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {ledger.map((e) => (
                        <tr key={e.id}>
                          <td className="px-5 py-3">
                            <div className="font-medium text-slate-900">{e.description}</div>
                            <div className="text-[11px] text-zinc-500">
                              {new Date(e.createdAt).toLocaleString("en-IN")}
                            </div>
                          </td>
                          <td
                            className={`px-5 py-3 text-right font-bold tabular-nums ${
                              e.amountPaise >= 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {e.amountPaise >= 0 ? "+" : ""}
                            {formatInr(e.amountPaise, { showDecimals: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Client GST Tax Invoices" noPadding>
              {invoices.length === 0 ? (
                <div className="p-6 text-xs text-zinc-500">No GST invoices issued yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                      <tr>
                        <th className="px-5 py-2.5 font-semibold">Invoice #</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                        <th className="px-5 py-2.5 text-right font-semibold">PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-5 py-3">
                            <ActionLink
                              href={`/invoices/${inv.id}`}
                              spinnerSize="xs"
                              className="font-mono font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                            >
                              {inv.invoiceNumber}
                            </ActionLink>
                            <div className="text-[11px] text-zinc-500">{inv.description}</div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusPill
                              label={inv.status.toUpperCase()}
                              tone={
                                inv.status === "paid"
                                  ? "emerald"
                                  : inv.status === "void"
                                    ? "ruby"
                                    : "amber"
                              }
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                            {formatInr(inv.totalPaise)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <a
                              href={`/api/pdf/invoice?id=${inv.id}`}
                              className="adm-btn-secondary py-1 px-2 text-[11px]"
                            >
                              Download PDF
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {/* TAB 3: BUSINESS PROFILE, CLIENT SUBDOMAIN SSL & CLIENT USER PASSWORDS */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          <SectionCard
            title="Client Wildcard Subdomains & Queued SSL Certificates"
            subtitle={`Dedicated HTTPS ingress endpoints under ${clientEndpoints.tallyWildcardPattern} and ${clientEndpoints.apiWildcardPattern} managed automatically through the backend SSL queue`}
            action={
              canProvisionSsl ? (
                <form action={staffProvisionClientSslAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=profile`}
                  />
                  <SubmitButton
                    className="adm-btn-secondary py-1.5 text-xs"
                    spinnerSize="xs"
                    pendingText="Verifying SSL..."
                  >
                    Verify / Re-Queue SSL Certificates
                  </SubmitButton>
                </form>
              ) : undefined
            }
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
              {[
                {
                  zone: "tally" as const,
                  title: "Tally Prime Webhook Subdomain",
                  hostname: clientEndpoints.clientTallySubdomainHost,
                  sampleUrl: `https://${clientEndpoints.clientTallySubdomainHost}/api/webhooks/tally`,
                },
                {
                  zone: "api" as const,
                  title: "Developer & Webhook API Subdomain",
                  hostname: clientEndpoints.clientApiSubdomainHost,
                  sampleUrl: `https://${clientEndpoints.clientApiSubdomainHost}/api/v1`,
                },
              ].map((endpoint) => {
                const cert = sslCerts.find((c) => c.zone === endpoint.zone);
                const status = cert?.status ?? "queued";
                return (
                  <div
                    key={endpoint.zone}
                    className="space-y-2 rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{endpoint.title}</span>
                      <StatusPill
                        label={
                          status === "active"
                            ? "HTTPS Active"
                            : status === "failed"
                              ? "Provision Failed"
                              : "Queued in SSL Worker"
                        }
                        tone={
                          status === "active"
                            ? "emerald"
                            : status === "failed"
                              ? "ruby"
                              : "amber"
                        }
                      />
                    </div>
                    <div className="font-mono text-[11.5px] font-semibold text-slate-900 break-all">
                      {endpoint.sampleUrl}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      <span>
                        Wildcard:{" "}
                        <strong className="font-mono text-slate-700">
                          {cert?.wildcardParent ?? `*.${endpoint.zone}.rapidshiftlabs.in`}
                        </strong>
                      </span>
                      <span>
                        Mode:{" "}
                        <strong className="text-slate-700">
                          {cert?.coverageMode === "dedicated_acme"
                            ? "Dedicated ACME TLS"
                            : "Wildcard SAN TLS"}
                        </strong>
                      </span>
                      {cert?.expiresAt && (
                        <span>
                          Valid until{" "}
                          <strong className="text-slate-700 tabular-nums">
                            {new Date(cert.expiresAt).toLocaleDateString("en-IN")}
                          </strong>
                        </span>
                      )}
                    </div>
                    {cert?.lastError && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
                        {cert.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.25fr]">
            <SectionCard
              title="Client Business & GST Details"
              subtitle={
                canManageClients
                  ? "Changes apply immediately to future GST tax invoices and account status"
                  : "Read-only client business profile"
              }
            >
              {canManageClients ? (
                <form action={staffUpdateClientProfileAction} className="space-y-3.5 text-xs">
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=profile`}
                  />
                  <div>
                    <label className="mb-1 block font-semibold text-slate-800">Business Name *</label>
                    <input
                      name="name"
                      required
                      defaultValue={workspace.name}
                      className="adm-input"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">Industry</label>
                      <input
                        name="industry"
                        defaultValue={workspace.industry ?? ""}
                        placeholder="Retail / Wholesale / Services"
                        className="adm-input"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">
                        Billing State (for GST)
                      </label>
                      <select
                        name="stateCode"
                        defaultValue={workspace.stateCode || "27"}
                        className="adm-input"
                      >
                        {Object.entries(INDIA_GST_STATES)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([code, stateName]) => (
                            <option key={code} value={code}>
                              {code} — {stateName}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">GSTIN</label>
                      <input
                        name="gstin"
                        defaultValue={workspace.gstin ?? ""}
                        placeholder="27AAAAA0000A1Z5"
                        className="adm-input font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-800">Account Status</label>
                      <select
                        name="billingStatus"
                        defaultValue={isPaused ? "suspended" : "active"}
                        className="adm-input"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Paused / Suspended</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <SubmitButton className="adm-btn-primary" pendingText="Saving...">
                      Save Business Profile
                    </SubmitButton>
                  </div>
                </form>
              ) : (
                <div className="space-y-2.5 text-xs text-zinc-700">
                  <div>
                    <span className="text-zinc-500">Business Name:</span>{" "}
                    <strong className="text-slate-900">{workspace.name}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500">Workspace Slug:</span>{" "}
                    <strong className="font-mono text-slate-900">{workspace.slug}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500">Industry:</span>{" "}
                    <strong className="text-slate-900">{workspace.industry || "Not specified"}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500">Billing State:</span>{" "}
                    <strong className="text-slate-900">{workspace.stateCode || "27"}</strong>
                  </div>
                  <div>
                    <span className="text-zinc-500">GSTIN:</span>{" "}
                    <strong className="font-mono text-slate-900">
                      {workspace.gstin || "Unregistered"}
                    </strong>
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title={`Client Team Logins (${team.members.length})`}
              subtitle={
                canManageClients
                  ? "Reset a client user's password or verify their email address directly during a support call"
                  : "Read-only team member directory for this client"
              }
              noPadding
            >
              <div className="divide-y divide-zinc-100">
                {team.members.map((m) => {
                  const fullUser = usersById.get(m.userId);
                  return (
                    <div key={m.membershipId} className="space-y-3 p-5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900">{m.name}</div>
                          <div className="text-zinc-500">
                            {m.email} • Role: <strong className="uppercase">{m.roleSlug}</strong>
                          </div>
                        </div>
                        <StatusPill
                          label={fullUser?.emailVerified ? "Email Verified" : "Unverified"}
                          tone={fullUser?.emailVerified ? "emerald" : "amber"}
                        />
                      </div>

                      {canManageClients && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form
                            action={staffResetClientPasswordAction}
                            className="flex flex-1 flex-wrap items-center gap-2"
                          >
                            <input type="hidden" name="workspaceId" value={workspace.id} />
                            <input type="hidden" name="userId" value={m.userId} />
                            <input
                              type="hidden"
                              name="returnTo"
                              value={`/clients/${workspace.id}?tab=profile`}
                            />
                            <input
                              name="newPassword"
                              type="text"
                              required
                              minLength={6}
                              placeholder="Set new password (min 6 chars)"
                              className="adm-input flex-1 min-w-[180px] py-1.5 font-mono text-xs"
                            />
                            <SubmitButton
                              className="adm-btn-secondary py-1.5 text-xs"
                              spinnerSize="xs"
                              pendingText="Resetting..."
                            >
                              Reset Password
                            </SubmitButton>
                          </form>

                          {!fullUser?.emailVerified && (
                            <form action={staffVerifyClientEmailAction}>
                              <input type="hidden" name="workspaceId" value={workspace.id} />
                              <input type="hidden" name="userId" value={m.userId} />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={`/clients/${workspace.id}?tab=profile`}
                              />
                              <SubmitButton
                                className="adm-btn-primary py-1.5 text-xs"
                                spinnerSize="xs"
                                pendingText="Verifying..."
                              >
                                Verify Email
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {/* TAB 4: WHATSAPP STARTER PACK & DIRECT CLIENT EMAIL */}
      {activeTab === "support" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionCard
            title="Push Approved Tally WhatsApp Starter Templates"
            subtitle="Adds ready-to-use Sales Invoice, Payment Receipt, and Overdue Reminder templates directly into this client's account"
          >
            <div className="space-y-4 text-xs">
              <ul className="space-y-2 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-zinc-700">
                <li className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    <code className="font-mono font-semibold">tally_sales_bill_created</code> — Automatic Sales Bill notification
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    <code className="font-mono font-semibold">tally_payment_receipt_thankyou</code> — Payment Receipt confirmation
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    <code className="font-mono font-semibold">tally_overdue_payment_reminder</code> — Polite Overdue Bill reminder
                  </span>
                </li>
              </ul>

              {canManageTemplates ? (
                <form action={staffSeedStarterTemplatesAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={`/clients/${workspace.id}?tab=support`}
                  />
                  <SubmitButton className="adm-btn-primary" pendingText="Adding Templates...">
                    Add Starter Templates to Client Account
                  </SubmitButton>
                </form>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-zinc-600">
                  Template seeding requires Support or Super Admin permissions.
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Send Account or Billing Email to Client"
            subtitle="Sends a formatted email notification to the client and records it in Sent Emails"
          >
            {canSendEmail ? (
              <form action={staffSendClientEmailAction} className="space-y-3 text-xs">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <input
                  type="hidden"
                  name="returnTo"
                  value={`/clients/${workspace.id}?tab=support`}
                />
                <div>
                  <label className="mb-1 block font-semibold text-slate-800">Recipient Email *</label>
                  <input
                    name="recipientEmail"
                    type="email"
                    required
                    defaultValue={ownerEmail}
                    className="adm-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-800">Subject Headline *</label>
                  <input
                    name="headline"
                    required
                    defaultValue="Your RSL Marketing plan update"
                    className="adm-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-slate-800">Message *</label>
                  <textarea
                    name="bodyText"
                    rows={3}
                    required
                    defaultValue={`Hello ${workspace.name}, your requested feature plan and GST tax invoice are ready in your dashboard.`}
                    className="adm-input"
                  />
                </div>
                <div className="flex justify-end">
                  <SubmitButton className="adm-btn-dark" pendingText="Sending...">
                    Send Email Notification
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                Sending client notifications requires Finance, Support, or Super Admin permissions.
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
