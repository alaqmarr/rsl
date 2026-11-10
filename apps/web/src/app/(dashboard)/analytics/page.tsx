import { getWorkspaceAnalytics, type AnalyticsDateRange } from "@rsl/analytics";
import { getWalletAvailableSpendPaise, MIN_WALLET_BALANCE_PAISE } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import {
  AccessRestrictedState,
  ConversionFunnelBars,
  DualSeriesAreaChart,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  ReceivablesAgingStack,
  SectionCard,
  StarBreakdownCard,
  StatusPill,
} from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";
import { requireWebSession } from "@/lib/session";

const RANGES: Array<{ key: AnalyticsDateRange; label: string }> = [
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "90d", label: "90 Days" },
  { key: "365d", label: "12 Months" },
  { key: "all", label: "All Time" },
];

export default async function DetailedAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/analytics", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Detailed Business Analytics"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View Tally, marketing, or billing analytics"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  const rawRange = sp.range as AnalyticsDateRange | undefined;
  const range: AnalyticsDateRange =
    rawRange && ["7d", "30d", "90d", "365d", "all"].includes(rawRange) ? rawRange : "30d";

  const report = getWorkspaceAnalytics(session.workspace.id, range);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Performance & Cashflow"
        title="Detailed Business Analytics"
        subtitle="Cashflow collections, team reply speed, customer conversion funnel, and return per ₹1 spent - computed live from your business records."
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex flex-wrap rounded-xl border border-zinc-200/90 bg-white p-1 shadow-2xs">
              {RANGES.map((r) => (
                <ActionLink
                  key={r.key}
                  href={`/analytics?range=${r.key}`}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    range === r.key
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
                  }`}
                >
                  <span>{r.label}</span>
                </ActionLink>
              ))}
            </div>

            {report.hasAnyData && (
              <>
                <a href={`/api/pdf/analytics-report?range=${range}`} className="rsl-btn-primary">
                  Download Executive PDF
                </a>
                <a href={`/api/export/analytics-csv?range=${range}`} className="rsl-btn-secondary">
                  Download CSV Report
                </a>
              </>
            )}
          </div>
        }
      />

      {/* Primary Executive Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Money Collected"
          value={formatInr(report.kpis.moneyCollectedPaise)}
          changePct={report.kpis.moneyCollectedChangePct}
          sublabel="Payments received on Tally sales bills & receipts"
          accent="emerald"
        />
        <MetricCard
          label="Overdue Bill Balance"
          value={formatInr(report.kpis.overdueReceivablesPaise)}
          sublabel={`${report.kpis.overdueBillsCount} overdue bills of ${report.kpis.unpaidBillsCount} unpaid`}
          accent={report.kpis.overdueBillsCount > 0 ? "ruby" : "default"}
        />
        <MetricCard
          label="Total Marketing Spend"
          value={formatInr(report.kpis.marketingSpendPaise, { showDecimals: true })}
          changePct={report.kpis.marketingSpendChangePct}
          sublabel="Ad spend + WhatsApp template & broadcast charges"
        />
        <MetricCard
          label="Return per ₹1 Spent"
          value={
            report.kpis.marketingSpendPaise > 0
              ? `₹${report.kpis.returnPerRupeeSpent.toFixed(2)}`
              : "₹0.00"
          }
          sublabel={`${formatInr(report.kpis.salesLinkedPaise)} in linked campaign & website sales`}
          accent="emerald"
        />
      </div>

      {/* Operational Health Row (Collapsible Progressive Disclosure) */}
      <details
        open={range === "7d"}
        className="group rounded-2xl border border-zinc-200/90 bg-white shadow-2xs"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-3.5 select-none">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="font-bold text-slate-900">
              Operational &amp; Wallet Runway Metrics
            </span>
            <span className="text-zinc-500">
              Reply Rate <strong>{report.kpis.replyRatePct}%</strong> • Avg Reply{" "}
              <strong>{report.kpis.avgReplyMinutes}m</strong> • Reach{" "}
              <strong>{report.kpis.contactsTotalCount.toLocaleString("en-IN")}</strong>
            </span>
          </div>
          <span className="text-xs font-semibold text-emerald-700 group-open:hidden">
            Expand Operational KPIs
          </span>
          <span className="hidden text-xs font-semibold text-zinc-500 group-open:inline">
            Hide Operational KPIs
          </span>
        </summary>
        <div className="grid grid-cols-1 gap-4 border-t border-zinc-100 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Team Reply Rate"
          value={`${report.kpis.replyRatePct}%`}
          sublabel={`${report.kpis.withinTargetPct}% replied within target response window`}
          accent="sky"
        />
        <MetricCard
          label="Average Reply Time"
          value={report.kpis.avgReplyMinutes > 0 ? `${report.kpis.avgReplyMinutes} min` : "0 min"}
          sublabel={`${report.kpis.messagesInCount} inbound • ${report.kpis.messagesOutCount} outbound messages`}
        />
        <MetricCard
          label="Prepaid Wallet Runway"
          value={formatInr(report.kpis.walletBalancePaise, { showDecimals: true })}
          accent={
            report.kpis.walletBalancePaise <= MIN_WALLET_BALANCE_PAISE
              ? "ruby"
              : report.kpis.walletBalancePaise < 0
                ? "amber"
                : "default"
          }
          sublabel={
            report.kpis.walletBalancePaise < 0
              ? `Overdraft active • ${formatInr(getWalletAvailableSpendPaise(report.kpis.walletBalancePaise), { showDecimals: true })} credit left before ${formatInr(MIN_WALLET_BALANCE_PAISE)} limit`
              : report.kpis.estimatedDaysRemaining !== null
                ? `~${report.kpis.estimatedDaysRemaining} days left at 30d spend (${formatInr(report.kpis.walletSpend30dPaise)})`
                : "No wallet deductions in last 30 days"
          }
        />
        <MetricCard
          label="Customer Reach & Consent"
          value={report.kpis.contactsTotalCount.toLocaleString("en-IN")}
          sublabel={`${report.kpis.optedInCount} WhatsApp opted-in • ${report.kpis.unsubscribedCount} unsubscribed`}
        />
        </div>
      </details>

      {/* Dual Trend Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Cashflow Trend: Payments Collected vs. Bills Raised"
          subtitle="Daily rupee totals from Tally Prime bills and payment receipts"
        >
          <DualSeriesAreaChart
            points={report.dailySeries.map((d) => ({
              label: d.label,
              primary: Math.round(d.paymentsCollectedPaise / 100),
              secondary: Math.round(d.billsRaisedPaise / 100),
            }))}
            primaryLabel="Payments Collected (₹)"
            secondaryLabel="Bills Raised (₹)"
            formatValue={(v) => `₹${v.toLocaleString("en-IN")}`}
          />
        </SectionCard>

        <SectionCard
          title="Marketing Return: Linked Sales vs. Ad Spend"
          subtitle="Daily rupee comparison of ad spend against linked campaign & website sales"
        >
          <DualSeriesAreaChart
            points={report.dailySeries.map((d) => ({
              label: d.label,
              primary: Math.round(d.salesLinkedPaise / 100),
              secondary: Math.round(d.adSpendPaise / 100),
            }))}
            primaryLabel="Sales Linked (₹)"
            secondaryLabel="Ad Spend (₹)"
            formatValue={(v) => `₹${v.toLocaleString("en-IN")}`}
          />
        </SectionCard>
      </div>

      {/* Message Volume + Conversion Funnel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Customer Message Volume"
          subtitle="Daily inbound customer inquiries vs. outbound team replies"
        >
          <DualSeriesAreaChart
            points={report.dailySeries.map((d) => ({
              label: d.label,
              primary: d.messagesIn,
              secondary: d.messagesOut,
            }))}
            primaryLabel="Customer Inbound"
            secondaryLabel="Team Outbound"
          />
        </SectionCard>

        <SectionCard
          title="Customer Conversion Funnel"
          subtitle="From contacts reached to delivered messages, replies, and paid bills"
        >
          <ConversionFunnelBars steps={report.funnel} />
        </SectionCard>
      </div>

      {/* Channel Performance Breakdown Table */}
      <SectionCard
        title="Channel-by-Channel Breakdown"
        subtitle="Volume, rupee spend, linked collections/sales, and return across every channel"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-5 py-3 font-semibold sm:px-6">Channel</th>
                <th className="px-4 py-3 font-semibold">Activity</th>
                <th className="px-4 py-3 font-semibold">Spend</th>
                <th className="px-4 py-3 font-semibold">Collections / Linked Sales</th>
                <th className="px-4 py-3 font-semibold">Return per ₹1</th>
                <th className="px-5 py-3 font-semibold sm:px-6">Current Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {report.channelBreakdown.map((row) => (
                <tr key={row.channel}>
                  <td className="px-5 py-3.5 font-semibold text-slate-900 sm:px-6">{row.channel}</td>
                  <td className="px-4 py-3.5 text-zinc-600 tabular-nums">{row.activityLabel}</td>
                  <td className="px-4 py-3.5 text-slate-800 tabular-nums">
                    {formatInr(row.spendPaise, {
                      showDecimals: row.spendPaise > 0 && row.spendPaise < 10000,
                    })}
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900 tabular-nums">
                    {formatInr(row.valuePaise)}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {row.returnRatio !== null ? (
                      <StatusPill label={`₹${row.returnRatio.toFixed(2)} / ₹1`} tone="emerald" />
                    ) : (
                      <span className="text-zinc-400">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-zinc-600 sm:px-6">{row.statusNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Aging + Google Reviews + Provider Health */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard
          title="Tally Receivables Aging"
          subtitle="Breakdown of unpaid sales bills by days past due"
        >
          {report.receivablesAging.every((b) => b.amountPaise === 0) ? (
            <EmptyWorkspaceState
              title="No unpaid sales bills"
              description="All synced Tally sales bills are paid, or no sales bills have been synced yet."
            />
          ) : (
            <ReceivablesAgingStack
              buckets={report.receivablesAging}
              formatInrFn={(p) => formatInr(p)}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Google Business Rating"
          subtitle="Customer star distribution & pending replies"
        >
          <StarBreakdownCard
            averageRating={report.kpis.averageGoogleRating}
            totalReviews={report.kpis.reviewsCount}
            stars={report.reviewStars}
          />
        </SectionCard>

        <SectionCard
          title="Connected Channel Reliability"
          subtitle="Delivery and sync success across connected channels"
        >
          {report.providerHealth.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-zinc-500">
              No external channel sync calls recorded in this date window yet.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 text-[13px]">
              {report.providerHealth.map((p) => (
                <div key={p.provider} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-semibold text-slate-900 uppercase">{p.provider}</div>
                    <div className="text-xs text-zinc-500 tabular-nums">{p.totalCalls} syncs</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <StatusPill
                      label={`${p.successRatePct}% OK`}
                      tone={p.successRatePct >= 98 ? "emerald" : "amber"}
                    />
                    <div className="mt-1 text-xs text-zinc-500">{p.avgLatencyMs} ms avg</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
