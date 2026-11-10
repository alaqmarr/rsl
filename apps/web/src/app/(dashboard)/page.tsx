import {
  Clock,
  FileSpreadsheet,
  IndianRupee,
  MessageSquare,
  Star,
  TrendingUp,
} from "lucide-react";
import { getWorkspaceAnalytics } from "@rsl/analytics";
import { hasActiveEntitlement, listPublicPricingCatalog } from "@rsl/billing";
import { formatInr, getEnv } from "@rsl/core";
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
  GuideDrawerButton,
  MetricCard,
  PageHeader,
  ReceivablesAgingStack,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { ConfirmWhatsAppReminderButton } from "@/components/confirm-whatsapp-reminder";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { PublicLandingPage } from "@/components/public-landing-page";
import { sendBillWhatsAppAction } from "@/lib/actions";
import { formatCustomerAuditSummary } from "@/lib/plain-text";
import { getOptionalWebSession } from "@/lib/session";

export default async function BusinessOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getOptionalWebSession();
  if (!session) {
    const env = getEnv();
    const catalog = listPublicPricingCatalog();
    return (
      <PublicLandingPage
        bundles={catalog.bundles}
        services={catalog.services}
        docsBaseUrl={env.DOCS_URL}
      />
    );
  }
  const sp = await searchParams;
  const analytics = getWorkspaceAnalytics(session.workspace.id, "30d");

  const canViewTally = canRolePerform(session.roleSlug, "tally:view", session.workspace.id);
  const canSendTallyWhatsApp = canRolePerform(
    session.roleSlug,
    "tally:invoice.send",
    session.workspace.id
  );
  const canViewMarketing =
    canRolePerform(session.roleSlug, "ads:view", session.workspace.id) ||
    canRolePerform(session.roleSlug, "posts:view", session.workspace.id);
  const canViewAnalyticsRoute = canRoleAccessWebRoute(
    session.roleSlug,
    "/analytics",
    session.workspace.id
  );
  const canViewLogs =
    canRolePerform(session.roleSlug, "logs:view", session.workspace.id) ||
    canRolePerform(session.roleSlug, "audit:view", session.workspace.id);

  // Marketing-scoped roles (e.g. `marketing`) never see Tally bills, receivables, or accounting data
  if (!canViewTally && canViewMarketing) {
    return (
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow={`Marketing & Growth Desk • ${formatRoleLabel(session.roleSlug)}`}
          title={session.workspace.name}
          subtitle="Live Meta & Google ad campaigns, scheduled social publishing, website conversion tracking, and Google Business reviews."
          badge={<StatusPill label="Marketing & Campaigns Desk" tone="emerald" />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canRoleAccessWebRoute(session.roleSlug, "/reviews", session.workspace.id) && (
                <ActionLink href="/reviews" className="rsl-btn-secondary">
                  Google Reviews
                </ActionLink>
              )}
              {canRoleAccessWebRoute(session.roleSlug, "/whatsapp", session.workspace.id) && (
                <ActionLink href="/whatsapp" className="rsl-btn-secondary">
                  WhatsApp Broadcasts
                </ActionLink>
              )}
              {canRoleAccessWebRoute(session.roleSlug, "/campaigns", session.workspace.id) && (
                <ActionLink href="/campaigns" className="rsl-btn-primary">
                  Open Ads &amp; Social Studio
                </ActionLink>
              )}
            </div>
          }
        />

        <FlashBanner notice={sp.notice} error={sp.error} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Ad Spend (30 Days)"
            value={formatInr(analytics.kpis.marketingSpendPaise)}
            changePct={analytics.kpis.marketingSpendChangePct}
            sublabel="Paid Meta & Google campaign spend"
            accent="emerald"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            label="Tracked Ad Revenue"
            value={formatInr(analytics.kpis.salesLinkedPaise)}
            changePct={analytics.kpis.salesLinkedChangePct}
            sublabel={
              analytics.kpis.returnPerRupeeSpent !== null
                ? `Blended ROAS ${analytics.kpis.returnPerRupeeSpent.toFixed(2)}x`
                : "Attributed campaign sales"
            }
            accent="sky"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            label="WhatsApp Outbound (30d)"
            value={String(analytics.kpis.messagesOutCount)}
            sublabel="Template broadcasts & campaign sends"
            icon={<MessageSquare className="h-4 w-4" />}
          />
          <MetricCard
            label="Google Rating"
            value={
              analytics.kpis.reviewsCount > 0
                ? `${analytics.kpis.averageGoogleRating.toFixed(1)} ★`
                : "No reviews yet"
            }
            sublabel={`${analytics.kpis.reviewsCount} total customer review(s)`}
            accent="amber"
            icon={<Star className="h-4 w-4" />}
          />
        </div>

        <SectionCard
          title="Campaign & Audience Engagement (Last 30 Days)"
          subtitle="Outbound campaign activity and customer engagement trend"
          action={
            canRoleAccessWebRoute(session.roleSlug, "/campaigns", session.workspace.id) ? (
              <ActionLink
                href="/campaigns"
                spinnerSize="xs"
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                Open Ads &amp; Social Posts →
              </ActionLink>
            ) : undefined
          }
        >
          <DualSeriesAreaChart
            points={analytics.dailySeries.map((d) => ({
              label: d.label,
              primary: d.messagesOut,
              secondary: d.messagesIn,
            }))}
            primaryLabel="Campaign Outbound"
            secondaryLabel="Audience Responses"
          />
        </SectionCard>
      </div>
    );
  }

  // Support / Inbox-only roles (e.g. `agent`) get a focused Customer Service Overview without confidential financial totals
  if (!canViewTally) {
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
                : "No reviews yet"
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
          />
        </SectionCard>
      </div>
    );
  }

  const tally = getTallyWorkspaceSummary(session.workspace.id, {
    userId: session.user.id,
  });
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
        subtitle="Live 30-day cashflow, customer bills, and WhatsApp activity - every figure comes directly from your real business records."
        badge={<StatusPill label="Live 30-Day View" tone="emerald" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {completedSteps < analytics.setupChecklist.length && visibleChecklist.length > 0 && (
              <GuideDrawerButton
                label="Need help? • Setup Checklist"
                badgeText={`${completedSteps}/${analytics.setupChecklist.length}`}
                guide={{
                  eyebrow: "Workspace Onboarding",
                  title: "Quick Business Setup Checklist",
                  summary:
                    "Complete these milestones to automate Tally Prime invoice delivery, customer messaging, and daily encrypted backups.",
                  progress: {
                    label: "Setup Milestones Completed",
                    doneCount: completedSteps,
                    totalCount: analytics.setupChecklist.length,
                  },
                  steps: visibleChecklist.map((step) => ({
                    title: `${step.title} ${step.done ? "✓" : ""}`,
                    detail: step.done
                      ? "Completed and verified for your workspace."
                      : `Open ${step.cta} (${step.href}) to finish this setup milestone.`,
                  })),
                  fullGuideHref: "/help",
                  fullGuideLabel: "Open All Setup Guides",
                }}
              />
            )}
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
          accent={analytics.kpis.overdueBillsCount > 0 ? "amber" : "violet"}
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
          accent="indigo"
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
          accent="sky"
          icon={<MessageSquare className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
        <SectionCard
          title="Payments Collected vs. Bills Raised (Last 30 Days)"
          subtitle="Daily rupee cashflow across your Tally Prime sales bills and receipts"
          accent="emerald"
          action={
            canViewAnalyticsRoute ? (
              <ActionLink
                href="/analytics"
                spinnerSize="xs"
                className="text-xs font-semibold text-indigo-700 hover:underline"
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
            formatValue={(v) => formatInr(v * 100)}
            emptyHint="No Tally bills or receipts recorded in the last 30 days."
          />
        </SectionCard>

        <SectionCard
          title="Unpaid Bills Aging"
          subtitle="How long unpaid customer sales bills have been waiting"
          accent="violet"
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
            accent="amber"
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
                      ? `All ${tally.vouchers.length.toLocaleString("en-IN")} synced Tally voucher(s) are settled or within due date - no overdue reminders needed.`
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
                  <caption className="sr-only">
                    Overdue Tally Prime customer bills ready for WhatsApp payment reminders
                  </caption>
                  <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th scope="col" className="px-5 py-2.5">
                        Bill # &amp; Customer
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right">
                        Balance Due
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {overdueBills.map((bill) => {
                      const balance = Math.max(0, bill.amountPaise - bill.paidAmountPaise);
                      return (
                        <tr key={bill.id} className="hover:bg-zinc-50/60">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-900">{bill.partyName}</div>
                            <div className="text-xs text-zinc-500">
                              #{bill.voucherNumber} • {bill.partyPhoneE164 || "No phone"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-rose-700 tabular-nums">
                            {formatInr(balance)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {!canSendTallyWhatsApp ? (
                              <span className="text-[11px] text-zinc-400">Read-only</span>
                            ) : canSendBillWhatsApp && bill.partyPhoneE164 ? (
                              <ConfirmWhatsAppReminderButton
                                voucherId={bill.id}
                                voucherNumber={bill.voucherNumber}
                                partyName={bill.partyName}
                                partyPhoneE164={bill.partyPhoneE164}
                                balanceFormatted={formatInr(balance)}
                                action={sendBillWhatsAppAction}
                              />
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
            subtitle="Permanent record of actions in your workspace - past entries cannot be altered"
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
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {log.category} •{" "}
                        {new Date(log.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
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
