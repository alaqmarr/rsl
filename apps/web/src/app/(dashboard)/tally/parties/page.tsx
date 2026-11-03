import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  IndianRupee,
  MessageSquareShare,
  Plus,
  Search,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { getWorkspacePlansByKeys, hasActiveEntitlement } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import {
  getTallyWorkspaceSummary,
  getWorkspacePartiesLedgerSummary,
  type AgeingBucketKey,
} from "@rsl/tally";
import {
  AccessRestrictedState,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { TallySuiteNav } from "@/components/tally-suite-nav";
import { upsertWorkspacePartyLedgerAction } from "@/lib/actions";
import { requireWebSession } from "@/lib/session";

function formatSignedBalance(paise: number): { text: string; suffix: "Dr" | "Cr" | "Nil" } {
  const abs = Math.abs(paise);
  if (abs === 0) return { text: "₹0", suffix: "Nil" };
  return {
    text: formatInr(abs),
    suffix: paise > 0 ? "Dr" : "Cr",
  };
}

export default async function TallyPartiesLedgersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/tally/parties", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Client & Supplier Ledgers"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Tally bills & aging"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (!hasActiveEntitlement(session.workspace.id, "tally.sync")) {
    const plans = getWorkspacePlansByKeys(session.workspace.id, ["tally.sync", "tally.invoicing"]);
    return (
      <FeaturePlanGate
        pageTitle="Client & Supplier Ledgers, Ageing & Running Balance Statements"
        pageSubtitle="Sync every Sundry Debtor (Customer) and Sundry Creditor (Supplier) from Tally Prime with live Paid-in-Tally settlements, running balance statements, and credit limit alerts."
        plans={plans}
        returnPath="/tally/parties"
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const canManageTally = canRolePerform(
    session.roleSlug,
    "tally:sync.manage",
    session.workspace.id
  );

  const [ledgerSummary, tallyOverview] = await Promise.all([
    Promise.resolve(
      getWorkspacePartiesLedgerSummary(
        session.workspace.id,
        sp.company && sp.company !== "all" ? sp.company : undefined
      )
    ),
    Promise.resolve(getTallyWorkspaceSummary(session.workspace.id)),
  ]);

  const groupFilter =
    sp.group === "debtors" ||
    sp.group === "creditors" ||
    sp.group === "overdue" ||
    sp.group === "breach"
      ? sp.group
      : "all";
  const bucketFilter =
    sp.bucket === "0_15" ||
    sp.bucket === "16_30" ||
    sp.bucket === "31_60" ||
    sp.bucket === "61_90" ||
    sp.bucket === "90_plus"
      ? (sp.bucket as AgeingBucketKey)
      : null;
  const selectedCompanyId =
    sp.company && ledgerSummary.companies.some((c) => c.id === sp.company) ? sp.company : "all";
  const query = sp.q?.trim() || "";
  const showAddForm = sp.add === "1" && canManageTally;

  const filteredParties = ledgerSummary.parties.filter((p) => {
    if (selectedCompanyId !== "all" && p.companyId !== selectedCompanyId) return false;
    if (groupFilter === "debtors" && p.isCreditor) return false;
    if (groupFilter === "creditors" && !p.isCreditor) return false;
    if (groupFilter === "overdue" && p.overdueBillsCount <= 0 && p.overdueReceivablePaise <= 0) {
      return false;
    }
    if (groupFilter === "breach" && !p.creditLimitBreached) return false;
    if (bucketFilter && p.ageingBucketKey !== bucketFilter) return false;
    if (query) {
      const qLower = query.toLowerCase();
      const hay =
        `${p.name} ${p.gstin ?? ""} ${p.pan ?? ""} ${p.phoneE164 ?? ""} ${p.email ?? ""} ${p.stateName ?? ""} ${p.companyName}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  const defaultCompanyName =
    session.workspace.defaultTallyCompany ||
    ledgerSummary.companies[0]?.name ||
    session.workspace.name;

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="parties"
        vouchersCount={
          selectedCompanyId === "all"
            ? tallyOverview.vouchers.length
            : tallyOverview.vouchers.filter((v) => v.companyId === selectedCompanyId).length
        }
        partiesCount={ledgerSummary.kpis.totalPartiesCount}
        stockItemsCount={tallyOverview.totals.stockItemsCount}
        companies={ledgerSummary.companies}
        selectedCompanyId={selectedCompanyId}
      />

      <PageHeader
        eyebrow="All-in-One Tally Prime Suite • Accounts & Receivables"
        badge={
          <StatusPill
            label={`${ledgerSummary.kpis.debtorsCount} Clients • ${ledgerSummary.kpis.creditorsCount} Suppliers`}
            tone={ledgerSummary.kpis.totalPartiesCount > 0 ? "emerald" : "stone"}
          />
        }
        title="Client & Supplier Ledgers"
        subtitle="Real-time Sundry Debtors & Creditors synced from Tally Prime — complete with automatic Paid-in-Tally bill settlements, 5-bucket ageing, credit limit alerts, and downloadable PDF statements."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ledgerSummary.kpis.totalPartiesCount > 0 && (
              <>
                <a href="/api/export/party-ledgers-csv" className="rsl-btn-secondary">
                  <Download className="mr-1.5 inline h-3.5 w-3.5" />
                  Export Ledgers CSV
                </a>
                <a href="/api/pdf/tally-receivables" className="rsl-btn-secondary">
                  <FileText className="mr-1.5 inline h-3.5 w-3.5" />
                  Receivables Summary PDF
                </a>
              </>
            )}
            {canManageTally && (
              <ActionLink
                href={showAddForm ? "/tally/parties" : "/tally/parties?add=1"}
                spinnerSize="xs"
                className="rsl-btn-primary"
              >
                <Plus className="mr-1 inline h-3.5 w-3.5" />
                {showAddForm ? "Close New Party Form" : "Add Client / Supplier"}
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      {/* 5-Card Financial Position Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Total Receivables (Dr)"
          value={formatInr(ledgerSummary.kpis.totalReceivablePaise)}
          sublabel={`${ledgerSummary.kpis.debtorsCount} customer ledger(s) • ${ledgerSummary.kpis.openBillsCount} open bill(s)`}
          accent="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Payables (Cr)"
          value={formatInr(ledgerSummary.kpis.totalPayablePaise)}
          sublabel={`${ledgerSummary.kpis.creditorsCount} supplier / creditor ledger(s)`}
          icon={<Building2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Net Working Position"
          value={`${formatInr(Math.abs(ledgerSummary.kpis.netPositionPaise))} ${
            ledgerSummary.kpis.netPositionPaise >= 0 ? "Dr" : "Cr"
          }`}
          sublabel={`${ledgerSummary.kpis.settledBillsCount} bill(s) settled & marked Paid`}
          accent="sky"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Overdue Receivables"
          value={formatInr(ledgerSummary.kpis.totalOverdueReceivablePaise)}
          sublabel="Past party credit due date"
          accent={ledgerSummary.kpis.totalOverdueReceivablePaise > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Credit Limit Breaches"
          value={String(ledgerSummary.kpis.creditLimitBreachCount)}
          sublabel="Clients exceeding Tally credit limit"
          accent={ledgerSummary.kpis.creditLimitBreachCount > 0 ? "ruby" : "default"}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      {/* Add Client / Supplier Collapsible Form */}
      {showAddForm && canManageTally && (
        <SectionCard
          title="Create or Update Client / Supplier Ledger"
          subtitle="Syncs seamlessly with Tally Prime Sundry Debtors & Sundry Creditors by exact Ledger Name"
        >
          <form action={upsertWorkspacePartyLedgerAction} className="space-y-4 text-xs">
            <input type="hidden" name="returnPath" value="/tally/parties?add=1" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  Party / Business Ledger Name *
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g. Shree Ganesh Traders"
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Account Group</label>
                <select name="parentGroup" defaultValue="Sundry Debtors" className="rsl-input">
                  <option value="Sundry Debtors">Sundry Debtors (Customer / Client)</option>
                  <option value="Sundry Creditors">Sundry Creditors (Supplier / Vendor)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Tally Company</label>
                <input
                  name="companyName"
                  defaultValue={defaultCompanyName}
                  required
                  className="rsl-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">
                  WhatsApp Mobile (+91...)
                </label>
                <input name="phoneE164" placeholder="+919820012345" className="rsl-input" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">15-Digit GSTIN</label>
                <input
                  name="gstin"
                  maxLength={15}
                  placeholder="27AABCS1429B1Z1"
                  className="rsl-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">PAN</label>
                <input
                  name="pan"
                  maxLength={10}
                  placeholder="AABCS1429B"
                  className="rsl-input font-mono uppercase"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Contact Person</label>
                <input name="contactPerson" placeholder="Accounts / Owner" className="rsl-input" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Email</label>
                <input name="email" type="email" placeholder="accounts@client.in" className="rsl-input" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">State</label>
                <input name="stateName" placeholder="Maharashtra" className="rsl-input" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Credit Days</label>
                <input
                  name="creditDays"
                  type="number"
                  min={0}
                  max={365}
                  defaultValue={15}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Credit Limit (₹)</label>
                <input
                  name="creditLimitRupees"
                  type="number"
                  min={0}
                  step="100"
                  defaultValue={0}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Opening Balance (₹)</label>
                <input
                  name="openingBalanceRupees"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  className="rsl-input tabular-nums"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Dr / Cr</label>
                <select name="openingBalanceType" defaultValue="Dr" className="rsl-input">
                  <option value="Dr">Debit (Dr — Receivable)</option>
                  <option value="Cr">Credit (Cr — Payable / Advance)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Billing Address</label>
                <input name="address" placeholder="City, Industrial Estate..." className="rsl-input" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <ActionLink href="/tally/parties" spinnerSize="xs" className="rsl-btn-secondary">
                Cancel
              </ActionLink>
              <SubmitButton pendingText="Saving Ledger..." className="rsl-btn-primary">
                Save Party Ledger
              </SubmitButton>
            </div>
          </form>
        </SectionCard>
      )}

      {/* Interactive 5-Bucket Receivables Ageing Strip */}
      <SectionCard
        title="Receivables Ageing Breakdown (Click Any Bucket to Filter Clients)"
        subtitle="Calculated across open unpaid & partially paid Sales invoices — updates automatically whenever Tally receipts clear a bill"
        action={
          bucketFilter ? (
            <ActionLink href="/tally/parties" spinnerSize="xs" className="rsl-btn-secondary py-1 text-xs">
              Clear Ageing Filter
            </ActionLink>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ledgerSummary.ageingBuckets.map((b) => {
            const active = bucketFilter === b.key;
            const isHighRisk = b.key === "61_90" || b.key === "90_plus";
            const compSuffix =
              selectedCompanyId !== "all" ? `&company=${encodeURIComponent(selectedCompanyId)}` : "";
            const href = active
              ? `/tally/parties${
                  groupFilter !== "all"
                    ? `?group=${groupFilter}${compSuffix}`
                    : selectedCompanyId !== "all"
                      ? `?company=${encodeURIComponent(selectedCompanyId)}`
                      : ""
                }`
              : `/tally/parties?bucket=${b.key}${groupFilter !== "all" ? `&group=${groupFilter}` : ""}${compSuffix}`;
            return (
              <ActionLink
                key={b.key}
                href={href}
                spinnerSize="xs"
                className={`flex flex-col justify-between rounded-2xl border p-3.5 text-left transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                    : isHighRisk && b.amountPaise > 0
                      ? "border-rose-200/90 bg-rose-50/55 hover:border-rose-300"
                      : "border-zinc-200/85 bg-zinc-50/70 hover:bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold uppercase ${
                      active ? "text-emerald-300" : isHighRisk && b.amountPaise > 0 ? "text-rose-700" : "text-zinc-500"
                    }`}
                  >
                    {b.label}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                      active ? "bg-white/15 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200/80"
                    }`}
                  >
                    {b.billsCount} bill(s)
                  </span>
                </div>
                <div
                  className={`mt-2 text-lg font-extrabold tabular-nums ${
                    active ? "text-white" : "text-slate-900"
                  }`}
                >
                  {formatInr(b.amountPaise)}
                </div>
              </ActionLink>
            );
          })}
        </div>
      </SectionCard>

      {/* Main Client & Supplier Directory Table */}
      <SectionCard
        title={`Party Ledger Accounts (${filteredParties.length})`}
        subtitle="Click any Client or Supplier name to view their complete T-account Running Balance Statement, Bill-Wise Settlements, and Item Purchase History"
        noPadding
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/60 px-6 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: "all", label: `All Parties (${ledgerSummary.kpis.totalPartiesCount})` },
                { key: "debtors", label: `Clients / Debtors (${ledgerSummary.kpis.debtorsCount})` },
                { key: "creditors", label: `Suppliers / Creditors (${ledgerSummary.kpis.creditorsCount})` },
                { key: "overdue", label: "Overdue Accounts" },
                {
                  key: "breach",
                  label: `Over Credit Limit (${ledgerSummary.kpis.creditLimitBreachCount})`,
                },
              ] as const
            ).map((pill) => {
              const active = groupFilter === pill.key;
              const href = `/tally/parties?group=${pill.key}${
                bucketFilter ? `&bucket=${bucketFilter}` : ""
              }${selectedCompanyId !== "all" ? `&company=${encodeURIComponent(selectedCompanyId)}` : ""}${
                query ? `&q=${encodeURIComponent(query)}` : ""
              }`;
              return (
                <ActionLink
                  key={pill.key}
                  href={href}
                  spinnerSize="xs"
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white shadow-xs"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                  }`}
                >
                  {pill.label}
                </ActionLink>
              );
            })}
          </div>

          <form method="get" action="/tally/parties" className="flex flex-wrap items-center gap-2">
            {groupFilter !== "all" && <input type="hidden" name="group" value={groupFilter} />}
            {bucketFilter && <input type="hidden" name="bucket" value={bucketFilter} />}
            {ledgerSummary.companies.length > 1 && (
              <select
                name="company"
                defaultValue={selectedCompanyId}
                className="rsl-input w-auto py-1.5 text-xs"
              >
                <option value="all">All Companies ({ledgerSummary.companies.length})</option>
                {ledgerSummary.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <div className="relative min-w-[230px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={query}
                placeholder="Search party, GSTIN, mobile, state..."
                className="rsl-input py-1.5 pl-8 text-xs"
              />
            </div>
            <SubmitButton spinnerSize="xs" pendingText="Filtering..." className="rsl-btn-secondary py-1.5 text-xs">
              Filter
            </SubmitButton>
            {(query || groupFilter !== "all" || bucketFilter || selectedCompanyId !== "all") && (
              <ActionLink href="/tally/parties" spinnerSize="xs" className="rsl-btn-secondary py-1.5 text-xs">
                Reset
              </ActionLink>
            )}
          </form>
        </div>

        {ledgerSummary.kpis.totalPartiesCount === 0 ? (
          <div className="p-6">
            <EmptyWorkspaceState
              title="No client or supplier ledgers synced yet"
              description="Sync Tally Prime via your personalized .tdl v2.7 add-on or Windows Connector, upload Tally XML/CSV bills, or click 'Add Client / Supplier' above to start tracking party running balances."
              actionLabel={canManageTally ? "Connect Tally Prime" : "Go to Tally Bills"}
              actionHref={canManageTally ? "/tally?tab=connect" : "/tally"}
              icon={<Users className="h-5 w-5" />}
            />
          </div>
        ) : filteredParties.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            No party ledgers match your active filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3">Client / Supplier Party</th>
                  <th className="px-4 py-3">Group &amp; Terms</th>
                  <th className="px-4 py-3 text-right">Billed Total</th>
                  <th className="px-4 py-3 text-right">Paid / Settled</th>
                  <th className="px-4 py-3 text-right">Closing Balance</th>
                  <th className="px-4 py-3">Open Bills &amp; Ageing</th>
                  <th className="px-6 py-3 text-right">Statement &amp; Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {filteredParties.map((p) => {
                  const closing = formatSignedBalance(p.closingBalancePaise);
                  const waText = encodeURIComponent(
                    `Namaste ${p.name}, your current account balance with ${session.workspace.name} is ${closing.text}${closing.suffix !== "Nil" ? ` (${closing.suffix})` : ""}${p.unpaidBillsCount > 0 ? ` across ${p.unpaidBillsCount} open bill(s)` : ""}. Please review and let us know if you need invoice copies.`
                  );
                  const waHref = p.phoneE164
                    ? `https://wa.me/${p.phoneE164.replace(/\D/g, "")}?text=${waText}`
                    : null;

                  return (
                    <tr key={p.id} className="hover:bg-zinc-50/70">
                      <td className="px-6 py-3.5">
                        <ActionLink
                          href={`/tally/parties/${encodeURIComponent(p.id)}`}
                          spinnerSize="xs"
                          className="group inline-flex items-center gap-1 font-bold text-slate-900 hover:text-emerald-700"
                        >
                          <span>{p.name}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400 transition group-hover:text-emerald-600" />
                        </ActionLink>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                          {p.gstin && <span className="font-mono">GSTIN: {p.gstin}</span>}
                          <span>{p.phoneE164 || "No mobile"}</span>
                          {p.stateName && <span>• {p.stateName}</span>}
                          {ledgerSummary.companies.length > 1 && (
                            <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px]">
                              {p.companyName}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <StatusPill
                          label={p.isCreditor ? "Supplier (Creditor)" : "Client (Debtor)"}
                          tone={p.isCreditor ? "sky" : "emerald"}
                          showDot={false}
                        />
                        <div className="mt-1 text-[11px] text-zinc-500">
                          {p.creditDays}d credit
                          {p.creditLimitPaise > 0
                            ? ` • Limit ${formatInr(p.creditLimitPaise)}`
                            : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-medium text-zinc-700 tabular-nums">
                        {formatInr(p.totalInvoicedPaise)}
                      </td>

                      <td className="px-4 py-3.5 text-right font-semibold text-emerald-700 tabular-nums">
                        {formatInr(p.totalReceivedPaise)}
                      </td>

                      <td className="px-4 py-3.5 text-right tabular-nums">
                        <div className="font-extrabold text-slate-900">
                          {closing.text}{" "}
                          {closing.suffix !== "Nil" && (
                            <span
                              className={`text-[11px] font-bold ${
                                closing.suffix === "Dr" ? "text-amber-700" : "text-sky-700"
                              }`}
                            >
                              {closing.suffix}
                            </span>
                          )}
                        </div>
                        {p.creditLimitBreached && (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-bold text-rose-700">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Limit Exceeded</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {p.unpaidBillsCount === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>All Bills Settled</span>
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-800">
                              {p.unpaidBillsCount} open bill(s)
                              {p.overdueBillsCount > 0 && (
                                <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                                  {p.overdueBillsCount} overdue
                                </span>
                              )}
                            </div>
                            {p.maxOpenBillAgeDays > 0 && (
                              <div className="text-[11px] text-zinc-500">
                                Oldest open bill: {p.maxOpenBillAgeDays} day(s)
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <ActionLink
                            href={`/tally/parties/${encodeURIComponent(p.id)}`}
                            spinnerSize="xs"
                            className="rsl-btn-primary px-2.5 py-1 text-[11px]"
                          >
                            View Ledger
                          </ActionLink>
                          <a
                            href={`/api/pdf/party-ledger?partyId=${encodeURIComponent(p.id)}`}
                            className="rsl-btn-secondary px-2.5 py-1 text-[11px]"
                            title="Download A4 Party Ledger Statement PDF"
                          >
                            PDF
                          </a>
                          {waHref && (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                              title="Share balance summary on WhatsApp"
                            >
                              <MessageSquareShare className="h-3 w-3" />
                              <span>WhatsApp</span>
                            </a>
                          )}
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
    </div>
  );
}
