import {
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  IndianRupee,
  MessageSquare,
  Star,
  TrendingUp,
} from "lucide-react";
import { getWorkspaceAnalytics } from "@rsl/analytics";
import { hasActiveEntitlement } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { listRecentActionLogs } from "@rsl/logging";
import {
  canRoleAccessWebRoute,
  canRolePerform,
  formatRoleLabel,
} from "@rsl/rbac";
import { getTallyWorkspaceSummary } from "@rsl/tally";
import {
  DualSeriesAreaChart,
  EmptyWorkspaceState,
  MetricCard,
  PageHeader,
  ReceivablesAgingStack,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { sendBillWhatsAppAction } from "@/lib/actions";
import { formatCustomerAuditSummary } from "@/lib/plain-text";
import { requireWebSession } from "@/lib/session";

export default async function BusinessOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;
  const analytics = getWorkspaceAnalytics(session.workspace.id, "30d");

  const canViewTally = canRolePerform(session.roleSlug, "tally:view", session.workspace.id);
  const canSendTallyWhatsApp = canRolePerform(
    session.roleSlug,
    "tally:invoice.send",
    session.workspace.id
  );
  const canViewAnalyticsRoute = canRoleAccessWebRoute(
    session.roleSlug,
    "/analytics",
    session.workspace.id
  );
  const canViewLogs =
    canRolePerform(session.roleSlug, "logs:view", session.workspace.id) ||
    canRolePerform(session.roleSlug, "audit:view", session.workspace.id);

  // Support / Inbox-only roles (e.g. `agent`) get a focused Customer Service Overview without confidential financial totals
  if (!canViewTally && !canViewAnalyticsRoute) {
    return (
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow={`Workspace Desk • ${formatRoleLabel(session.roleSlug)}`}
          title={session.workspace.name}
          subtitle="Live customer message threads, response speed, and Google Business reviews assigned to your team."
          badge={<StatusPill label="Live Support Desk" tone="emerald" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canRoleAccessWebRoute(session.roleSlug, "/reviews", session.workspace.id) && (
                <ActionLink href="/reviews" className="rsl-btn-secondary">
                  Google Reviews
                </ActionLink>
              )}
              {canRoleAccessWebRoute(session.roleSlug, "/inbox", session.workspace.id) && (
                <ActionLink href="/inbox" className="rsl-btn-primary">
                  Open Customer Messages
                </ActionLink>
              )}
            </div>
          }
        />

        <FlashBanner notice={sp.notice} error={sp.error} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Open Conversations"
            value={String(analytics.kpis.openConversationsCount)}
            sublabel="Threads awaiting reply or resolution"
            accent="emerald"
            icon={<MessageSquare className="h-4 w-4" />}
          />
          <MetricCard
            label="Team Reply Rate"
            value={`${analytics.kpis.replyRatePct}%`}
            sublabel={
              analytics.kpis.avgReplyMinutes > 0
                ? `Avg reply ${analytics.kpis.avgReplyMinutes} min`
                : "Within target SLA window"
            }
            accent="sky"
            icon={<Clock className="h-4 w-4" />}
          />
          <MetricCard
            label="Messages (30 Days)"
            value={`${analytics.kpis.messagesInCount + analytics.kpis.messagesOutCount}`}
            sublabel={`${analytics.kpis.messagesInCount} inbound • ${analytics.kpis.messagesOutCount} outbound`}
            icon={<MessageSquare className="h-4 w-4" />}
          />
          <MetricCard
            label="Google Rating"
            value={
              analytics.kpis.reviewsCount > 0
                ? `${analytics.kpis.averageGoogleRating.toFixed(1)} ★`
                : "—"
            }
            sublabel={`${analytics.kpis.reviewsCount} total customer review(s)`}
            accent="amber"
            icon={<Star className="h-4 w-4" />}
          />
        </div>

        <SectionCard
          title="Customer Message Volume (Last 30 Days)"
          subtitle="Daily inbound customer inquiries vs. outbound team replies"
          action={
            canRoleAccessWebRoute(session.roleSlug, "/inbox", session.workspace.id) ? (
              <ActionLink
                href="/inbox"
                spinnerSize="xs"
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                Open Shared Inbox →
              </ActionLink>
            ) : undefined
          }
        >
          <DualSeriesAreaChart
            points={analytics.dailySeries.map((d) => ({
              label: d.label,
              primary: d.messagesIn,
              secondary: d.messagesOut,
            }))}
            primaryLabel="Customer Inbound"
            secondaryLabel="Team Outbound"
            primaryColor="#0284C7"
            secondaryColor="#059669"
          />
        </SectionCard>
      </div>
    );
  }

  const tally = getTallyWorkspaceSummary(session.workspace.id);
  const recentLogs = canViewLogs ? listRecentActionLogs(session.workspace.id, 8) : [];
  const hasInvoicingEntitlement = hasActiveEntitlement(session.workspace.id, "tally.invoicing");
  const canSendBillWhatsApp = hasInvoicingEntitlement && canSendTallyWhatsApp;

  const visibleChecklist = analytics.setupChecklist.filter((step) =>
    canRoleAccessWebRoute(session.roleSlug, step.href, session.workspace.id)
  );
  const completedSteps = analytics.setupChecklist.filter((c) => c.done).length;

  const overdueBills = tally.vouchers
    .filter(
      (v) =>
        v.voucherType === "Sales" &&
        v.paymentStatus !== "paid" &&
        v.paymentStatus !== "cancelled" &&
        v.dueDate !== null &&
        v.dueDate < Date.now()
    )
    .slice(0, 6);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={
          session.workspace.gstin
            ? `Active Business • GSTIN ${session.workspace.gstin}`
            : "Active Business Overview"
        }
        title={session.workspace.name}
        subtitle="Live 30-day cashflow, customer bills, and WhatsApp activity — every figure comes directly from your real business records."
        badge={<StatusPill label="Live 30-Day View" tone="emerald" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewTally && (
              <ActionLink href="/tally" className="rsl-btn-secondary">
                Tally Prime &amp; Bills
              </ActionLink>
            )}
            {canViewAnalyticsRoute && (
              <ActionLink href="/analytics" className="rsl-btn-primary">
                Detailed Analytics
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Money Collected (30 Days)"
          value={formatInr(analytics.kpis.moneyCollectedPaise)}
          changePct={analytics.kpis.moneyCollectedChangePct}
          sublabel="Settled Tally receipts & paid sales bills"
          accent="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Pending Customer Bills"
          value={formatInr(analytics.kpis.pendingReceivablesPaise)}
          sublabel={`${analytics.kpis.unpaidBillsCount} open bills (${analytics.kpis.overdueBillsCount} overdue)`}
          accent={analytics.kpis.overdueBillsCount > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Sales Linked to Marketing"
          value={formatInr(analytics.kpis.salesLinkedPaise)}
          changePct={analytics.kpis.salesLinkedChangePct}
          sublabel={
            analytics.kpis.marketingSpendPaise > 0
              ? `₹${analytics.kpis.returnPerRupeeSpent.toFixed(2)} earned per ₹1 spent`
              : "No ad or broadcast spend in last 30 days"
          }
          accent="sky"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Customer Messages & Speed"
          value={`${analytics.kpis.messagesInCount + analytics.kpis.messagesOutCount}`}
          sublabel={
            analytics.kpis.avgReplyMinutes > 0
              ? `Avg reply ${analytics.kpis.avgReplyMinutes} min (${analytics.kpis.openConversationsCount} open)`
              : `${analytics.kpis.openConversationsCount} open threads • ${analytics.kpis.contactsTotalCount} contacts`
          }
          icon={<MessageSquare className="h-4 w-4" />}
        />
      </div>

      {completedSteps < analytics.setupChecklist.length && visibleChecklist.length > 0 && (
        <SectionCard
          title={`Quick Setup Checklist (${completedSteps} of ${analytics.setupChecklist.length} completed)`}
          subtitle="Finish these quick steps to automate Tally Prime bill delivery, customer replies, and daily backups."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {visibleChecklist.map((step, idx) => (
              <div
                key={step.key}
                className={`flex flex-col justify-between rounded-xl border p-3.5 text-xs transition ${
                  step.done
                    ? "border-emerald-200/90 bg-emerald-50/50"
                    : "border-zinc-200/90 bg-zinc-50/50 hover:bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                      Step {idx + 1}
                    </span>
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <StatusPill label="Next" tone="amber" />
                    )}
                  </div>
                  <p className="mt-2 font-semibold leading-snug text-slate-900">{step.title}</p>
                </div>
                {step.done ? (
                  <span className="mt-3 text-[11px] font-semibold text-emerald-700">
                    Completed
                  </span>
                ) : (
                  <ActionLink
                    href={step.href}
                    spinnerSize="xs"
                    className="mt-3 font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    <span>{step.cta} →</span>
                  </ActionLink>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
        <SectionCard
          title="Payments Collected vs. Bills Raised (Last 30 Days)"
          subtitle="Daily rupee cashflow across your Tally Prime sales bills and receipts"
          action={
            canViewAnalyticsRoute ? (
              <ActionLink
                href="/analytics"
                spinnerSize="xs"
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                <span>Full Analytics →</span>
              </ActionLink>
            ) : undefined
          }
        >
          <DualSeriesAreaChart
            points={analytics.dailySeries.map((d) => ({
              label: d.label,
              primary: Math.round(d.paymentsCollectedPaise / 100),
              secondary: Math.round(d.billsRaisedPaise / 100),
            }))}
            primaryLabel="Payments Collected (₹)"
            secondaryLabel="Bills Raised (₹)"
            formatValue={(v) => `₹${v.toLocaleString("en-IN")}`}
            emptyHint="No Tally bills or receipts recorded in the last 30 days."
          />
        </SectionCard>

        <SectionCard
          title="Unpaid Bills Aging"
          subtitle="How long unpaid customer sales bills have been waiting"
        >
          <ReceivablesAgingStack
            buckets={analytics.receivablesAging}
            formatInrFn={(p) => formatInr(p)}
          />
        </SectionCard>
      </div>

      <div className={`grid grid-cols-1 gap-6 ${canViewLogs ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {canViewTally && (
          <SectionCard
            title="Overdue Bills Ready for WhatsApp Reminder"
            subtitle="Send a polite payment reminder directly to the customer's WhatsApp"
            action={
              <ActionLink
                href="/tally"
                spinnerSize="xs"
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                <span>Manage All Bills →</span>
              </ActionLink>
            }
            noPadding
          >
            {overdueBills.length === 0 ? (
              <div className="p-5">
                <EmptyWorkspaceState
                  title="Zero overdue bills right now"
                  description={
                    tally.vouchers.length > 0
                      ? `All ${tally.vouchers.length.toLocaleString("en-IN")} synced Tally voucher(s) are settled or within due date — no overdue reminders needed.`
                      : "Connect Tally Prime or import sales bills to track due dates and send 1-click WhatsApp reminders."
                  }
                  actionLabel={
                    tally.vouchers.length > 0 ? "View All Tally Bills" : "Go to Tally Prime & Bills"
                  }
                  actionHref="/tally"
                  icon={<FileSpreadsheet className="h-5 w-5" />}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-5 py-2.5">Bill # &amp; Customer</th>
                      <th className="px-4 py-2.5">Balance Due</th>
                      <th className="px-5 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {overdueBills.map((bill) => {
                      const balance = Math.max(0, bill.amountPaise - bill.paidAmountPaise);
                      return (
                        <tr key={bill.id} className="hover:bg-zinc-50/60">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-900">{bill.partyName}</div>
                            <div className="text-[11px] text-zinc-500">
                              #{bill.voucherNumber} • {bill.partyPhoneE164 || "No phone"}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-rose-700 tabular-nums">
                            {formatInr(balance)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {!canSendTallyWhatsApp ? (
                              <span className="text-[11px] text-zinc-400">Read-only</span>
                            ) : canSendBillWhatsApp && bill.partyPhoneE164 ? (
                              <form action={sendBillWhatsAppAction} className="inline">
                                <input type="hidden" name="voucherId" value={bill.id} />
                                <input type="hidden" name="sendKind" value="reminder" />
                                <SubmitButton
                                  className="rsl-btn-secondary py-1 text-[11px]"
                                  spinnerSize="xs"
                                  pendingText="Sending..."
                                >
                                  Send Reminder
                                </SubmitButton>
                              </form>
                            ) : canSendBillWhatsApp ? (
                              <ActionLink
                                href="/tally"
                                spinnerSize="xs"
                                className="text-[11px] font-semibold text-zinc-500 hover:text-slate-900 hover:underline"
                              >
                                Add party phone →
                              </ActionLink>
                            ) : (
                              <ActionLink
                                href="/tally?tab=rules"
                                spinnerSize="xs"
                                className="rsl-btn-secondary py-1 text-[11px]"
                              >
                                Unlock WhatsApp Send →
                              </ActionLink>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}

        {canViewLogs && (
          <SectionCard
            title="Recent Business Activity"
            subtitle="Permanent record of actions in your workspace — past entries cannot be altered"
            action={
              canRoleAccessWebRoute(session.roleSlug, "/activity", session.workspace.id) ? (
                <ActionLink
                  href="/activity"
                  spinnerSize="xs"
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                >
                  <span>View Full History →</span>
                </ActionLink>
              ) : undefined
            }
            noPadding
          >
            {recentLogs.length === 0 ? (
              <div className="p-6 text-xs text-zinc-500">No actions recorded yet.</div>
            ) : (
              <ul className="divide-y divide-zinc-100 bg-white text-xs">
                {recentLogs.map((log) => (
                  <li
                    key={log.id}
                    className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-zinc-50/60"
                  >
                    <div>
                      <div className="font-medium text-slate-900">
                        {formatCustomerAuditSummary(log.summary)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {log.category} • {new Date(log.ts).toLocaleString("en-IN")}
                      </div>
                    </div>
                    <StatusPill
                      label={log.outcome}
                      tone={
                        log.outcome === "success"
                          ? "emerald"
                          : log.outcome === "denied"
                            ? "amber"
                            : "ruby"
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
