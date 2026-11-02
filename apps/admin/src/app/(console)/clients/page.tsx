import Form from "next/form";
import { Building2, Search } from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import { canStaffPerform } from "@rsl/auth";
import { SERVICE_CATALOG } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { FlashBanner, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { staffCreateNewClientAction, staffUpdateClientProfileAction } from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminClientsDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  const canManageClients = canStaffPerform(staff.staffRole, "staff:clients.manage");
  const sp = await searchParams;
  const adminData = getPlatformAdminAnalytics();
  const q = sp.q?.trim().toLowerCase() || "";
  const statusFilter = sp.status || "all";
  const showNewForm = sp.new === "1";

  const catalogByKey = new Map(SERVICE_CATALOG.map((s) => [s.key, s]));

  const filteredClients = adminData.businesses.filter((b) => {
    if (statusFilter === "active" && b.billingStatus === "suspended") return false;
    if (statusFilter === "paused" && b.billingStatus !== "suspended") return false;
    if (statusFilter === "pending" && b.pendingRequestsCount === 0) return false;
    if (q) {
      const hay = `${b.name} ${b.gstin ?? ""} ${b.industry ?? ""} ${b.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const activeBusinessesCount = adminData.businesses.filter(
    (b) => b.billingStatus !== "suspended"
  ).length;
  const pausedBusinessesCount = adminData.businesses.filter(
    (b) => b.billingStatus === "suspended"
  ).length;
  const withPendingCount = adminData.businesses.filter(
    (b) => b.pendingRequestsCount > 0
  ).length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Client Directory & Account Controls"
        subtitle="Onboard new client businesses, filter accounts by status, pause unpaid accounts, or open full 360° controls for any client."
        actions={
          canManageClients ? (
            <ActionLink
              href={showNewForm ? "/clients" : "/clients?new=1"}
              className="adm-btn-primary"
            >
              {showNewForm ? "Hide Onboarding Form" : "+ Onboard New Client"}
            </ActionLink>
          ) : undefined
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Clients"
          value={String(adminData.businesses.length)}
          sublabel={`${adminData.totals.totalUsers} client team logins`}
          accent="emerald"
          icon={<Building2 className="h-3.5 w-3.5" />}
        />
        <MetricCard
          label="Active Accounts"
          value={String(activeBusinessesCount)}
          sublabel={
            adminData.totals.freeAccessClientsCount > 0
              ? `${adminData.totals.effectiveUnlockedToolsCount} tools active (${adminData.totals.freeAccessClientsCount} free-access)`
              : `${adminData.totals.activePlansCount} paid plans unlocked`
          }
          accent="emerald"
        />
        <MetricCard
          label="Paused Accounts"
          value={String(pausedBusinessesCount)}
          sublabel={pausedBusinessesCount > 0 ? "Temporarily paused by staff" : "Zero paused accounts"}
          accent={pausedBusinessesCount > 0 ? "ruby" : "default"}
        />
        <MetricCard
          label="Awaiting Plan Unlock"
          value={String(withPendingCount)}
          sublabel="Clients with pending feature requests"
          accent={withPendingCount > 0 ? "amber" : "default"}
        />
      </div>

      {/* Onboard New Client Business Form */}
      {showNewForm && canManageClients && (
        <SectionCard
          title="Onboard a New Client Business"
          subtitle="Creates a ready-to-use client account and owner login immediately so you can unlock plans or starter templates"
        >
          <form action={staffCreateNewClientAction} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Business Name *</label>
                <input
                  name="businessName"
                  required
                  placeholder="Shree Ganesh Traders"
                  className="adm-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Owner Full Name *</label>
                <input
                  name="ownerName"
                  required
                  placeholder="Rajesh Sharma"
                  className="adm-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Owner Login Email *</label>
                <input
                  name="ownerEmail"
                  type="email"
                  required
                  placeholder="owner@clientbusiness.in"
                  className="adm-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">
                  Initial Password * (min 6 chars)
                </label>
                <input
                  name="password"
                  type="text"
                  required
                  minLength={6}
                  placeholder="Welcome@2026"
                  className="adm-input font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Industry</label>
                <input
                  name="industry"
                  placeholder="Wholesale / Retail / Manufacturing"
                  className="adm-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">
                  Billing State Code (27 = Maharashtra)
                </label>
                <input name="stateCode" defaultValue="27" className="adm-input font-mono" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-800">Client GSTIN (Optional)</label>
                <input
                  name="gstin"
                  placeholder="27AAAAA0000A1Z5"
                  className="adm-input font-mono uppercase"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <ActionLink href="/clients" className="adm-btn-secondary">
                Cancel
              </ActionLink>
              <SubmitButton className="adm-btn-primary" pendingText="Creating Client...">
                Create Client Account &amp; Open Controls →
              </SubmitButton>
            </div>
          </form>
        </SectionCard>
      )}

      {/* Directory Filter & Search Table */}
      <SectionCard
        title={`Clients (${filteredClients.length})`}
        subtitle="Select any client to configure custom plan rates, unlock bundles, view GST invoices, or reset user passwords"
        action={
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {[
              { key: "all", label: `All (${adminData.businesses.length})` },
              { key: "active", label: `Active (${activeBusinessesCount})` },
              { key: "pending", label: `Pending Request (${withPendingCount})` },
              { key: "paused", label: `Paused (${pausedBusinessesCount})` },
            ].map((tab) => {
              const active = statusFilter === tab.key;
              const href = `/clients?status=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
              return (
                <ActionLink
                  key={tab.key}
                  href={href}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {tab.label}
                </ActionLink>
              );
            })}
          </div>
        }
        noPadding
      >
        <div className="border-b border-zinc-100 bg-white px-6 py-3.5">
          <Form action="/clients" className="flex flex-wrap items-center gap-2.5">
            <input type="hidden" name="status" value={statusFilter} />
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-zinc-400" />
              <input
                name="q"
                defaultValue={sp.q || ""}
                placeholder="Search by business name, GSTIN, industry, or account ID..."
                className="adm-input pl-8 text-xs"
              />
            </div>
            <SubmitButton className="adm-btn-secondary text-xs" pendingText="Searching...">
              Search
            </SubmitButton>
            {q && (
              <ActionLink href={`/clients?status=${statusFilter}`} className="adm-btn-secondary text-xs">
                Clear
              </ActionLink>
            )}
          </Form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-6 py-3 font-semibold">Client &amp; GST Details</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Unlocked Plans</th>
                <th className="px-4 py-3 font-semibold">Wallet Balance</th>
                <th className="px-6 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-xs text-zinc-500">
                    No client accounts match your current filter.
                  </td>
                </tr>
              ) : (
                filteredClients.map((b) => {
                  const activeKeys = b.activeServiceKeysCsv
                    ? b.activeServiceKeysCsv.split(",").filter(Boolean)
                    : [];
                  const isPaused = b.billingStatus === "suspended";

                  return (
                    <tr key={b.id} className="align-middle">
                      <td className="px-6 py-4">
                        <ActionLink
                          href={`/clients/${b.id}`}
                          className="text-sm font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                        >
                          {b.name}
                        </ActionLink>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                          {b.industry && <span>{b.industry} •</span>}
                          <span>State {b.stateCode}</span>
                          {b.gstin && <span className="font-mono">• {b.gstin}</span>}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex flex-col items-start gap-1">
                          <StatusPill
                            label={isPaused ? "Paused" : "Active"}
                            tone={isPaused ? "ruby" : "emerald"}
                          />
                          {b.pendingRequestsCount > 0 && (
                            <StatusPill
                              label={`${b.pendingRequestsCount} Pending Request`}
                              tone="amber"
                              showDot={false}
                            />
                          )}
                        </div>
                      </td>

                      <td className="max-w-sm px-4 py-4">
                        {b.hasFreeAllTools && activeKeys.length === 0 ? (
                          <StatusPill
                            label={`All ${SERVICE_CATALOG.length} Tools (Free • ${b.freeAccessRemainingDays}d)`}
                            tone="emerald"
                          />
                        ) : activeKeys.length === 0 ? (
                          <span className="text-[11px] text-zinc-400">
                            0 of {SERVICE_CATALOG.length} active
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {b.hasFreeAllTools && (
                              <StatusPill
                                label={`Free All-Tools (${b.freeAccessRemainingDays}d)`}
                                tone="emerald"
                              />
                            )}
                            {activeKeys.slice(0, 3).map((k) => (
                              <span
                                key={k}
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800"
                              >
                                {catalogByKey.get(k)?.name ?? k}
                              </span>
                            ))}
                            {activeKeys.length > 3 && (
                              <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
                                +{activeKeys.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-4 tabular-nums">
                        <div
                          className={`font-bold ${
                            b.walletBalancePaise < 0 ? "text-rose-700" : "text-slate-900"
                          }`}
                        >
                          {formatInr(b.walletBalancePaise, { showDecimals: true })}
                        </div>
                        {b.walletBalancePaise < 0 && (
                          <div className="mt-0.5 text-[10.5px] font-semibold text-rose-600">
                            Overdraft (-₹200 limit)
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {canManageClients && (
                            <form action={staffUpdateClientProfileAction}>
                              <input type="hidden" name="workspaceId" value={b.id} />
                              <input type="hidden" name="name" value={b.name} />
                              <input type="hidden" name="industry" value={b.industry ?? ""} />
                              <input type="hidden" name="gstin" value={b.gstin ?? ""} />
                              <input type="hidden" name="stateCode" value={b.stateCode} />
                              <input
                                type="hidden"
                                name="billingStatus"
                                value={isPaused ? "active" : "suspended"}
                              />
                              <input type="hidden" name="returnTo" value="/clients" />
                              <SubmitButton
                                className={
                                  isPaused
                                    ? "adm-btn-primary py-1.5 text-xs"
                                    : "adm-btn-danger py-1.5 text-xs"
                                }
                                spinnerSize="xs"
                                pendingText={isPaused ? "Activating..." : "Pausing..."}
                              >
                                {isPaused ? "Reactivate" : "Pause"}
                              </SubmitButton>
                            </form>
                          )}

                          <ActionLink
                            href={`/clients/${b.id}`}
                            className="adm-btn-secondary py-1.5 text-xs"
                          >
                            Manage Client →
                          </ActionLink>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
