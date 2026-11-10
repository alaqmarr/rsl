import Form from "next/form";
import {
  ACTION_CATALOG,
  countActionLogs,
  getCorrelationTimeline,
  listRecentActionLogs,
  verifyTenantHashChain,
} from "@rsl/logging";
import { canRoleAccessWebRoute, canRolePerform, formatRoleLabel } from "@rsl/rbac";
import { listCustomerVisibleStaffAccessLogs } from "@rsl/tenancy";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { formatCustomerAuditSummary } from "@/lib/plain-text";
import { requireWebSession } from "@/lib/session";

const OUTCOME_LABELS: Record<string, string> = {
  success: "Completed",
  denied: "Blocked",
  error: "Failed",
};

export default async function ActivityHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/activity", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Business Activity History"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View activity history"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const canExportLogs = canRolePerform(session.roleSlug, "logs:export", session.workspace.id);
  const outcomeFilter = sp.outcome?.trim() || "all";
  const categoryFilter = sp.category?.trim() || "all";
  const categories = Array.from(
    new Set(Object.values(ACTION_CATALOG).map((entry) => entry.category))
  ).sort();

  const ACTIVITY_PAGE_SIZE = 50;
  const chain = verifyTenantHashChain(session.workspace.id);
  const totalFilteredLogs = countActionLogs(session.workspace.id, {
    outcome: outcomeFilter,
    category: categoryFilter,
  });
  const totalLogPages = Math.max(1, Math.ceil(totalFilteredLogs / ACTIVITY_PAGE_SIZE));
  const rawLogPage = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const currentLogPage = Math.min(rawLogPage, totalLogPages);

  const logs = listRecentActionLogs(session.workspace.id, ACTIVITY_PAGE_SIZE, {
    outcome: outcomeFilter,
    category: categoryFilter,
    offset: (currentLogPage - 1) * ACTIVITY_PAGE_SIZE,
  });
  const staffAccessLogs = listCustomerVisibleStaffAccessLogs(session.workspace.id, 50);
  const traceId = sp.trace?.trim() || "";
  const timeline = traceId ? getCorrelationTimeline(session.workspace.id, traceId) : [];
  const baseFilterHref = `/activity?outcome=${encodeURIComponent(outcomeFilter)}&category=${encodeURIComponent(categoryFilter)}${
    traceId ? `&trace=${encodeURIComponent(traceId)}` : ""
  }`;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Settings & Account"
        title="Business Activity History"
        subtitle="Complete timeline of actions taken across your business - past entries are permanent and cannot be edited or deleted."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {chain.rowCount > 0 && canExportLogs && (
              <a href="/api/export/activity-csv" className="rsl-btn-secondary">
                Export Activity CSV
              </a>
            )}
            <Form action="/activity" className="flex items-center gap-2">
              <input
                name="trace"
                defaultValue={traceId}
                aria-label="Search by Reference ID"
                placeholder="Search by Reference ID..."
                className="rsl-input w-56 font-mono sm:w-64"
              />
              <SubmitButton
                className="rsl-btn-secondary"
                spinnerSize="xs"
                pendingText="Searching..."
              >
                Inspect Timeline
              </SubmitButton>
            </Form>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Activity Record Status"
          value={chain.valid ? "Verified" : "Attention Needed"}
          sublabel="Past entries cannot be edited or deleted"
          accent={chain.valid ? "emerald" : "ruby"}
        />
        <MetricCard
          label="Total Recorded Actions"
          value={chain.rowCount.toLocaleString("en-IN")}
          sublabel="Team, Tally sync, and WhatsApp activity"
          accent="sky"
        />
        <MetricCard
          label="Daily History Snapshots"
          value={String(chain.anchoredDaysCount)}
          sublabel="Verified daily activity summaries"
        />
      </div>

      {traceId && (
        <SectionCard
          title={`Step-by-Step Timeline for ${traceId}`}
          action={
            <ActionLink
              href="/activity"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Clear Filter
            </ActionLink>
          }
        >
          {timeline.length === 0 ? (
            <p className="text-[13px] text-zinc-500">No steps found for that Reference ID.</p>
          ) : (
            <ol className="space-y-2.5 text-[13px]">
              {timeline.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/75 px-4 py-3"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">{step.title}</span>
                    <div className="mt-0.5 text-zinc-600">
                      {formatCustomerAuditSummary(step.detail)}
                    </div>
                  </div>
                  <StatusPill
                    label={step.status}
                    tone={
                      step.status === "success" || step.status === "completed" ? "emerald" : "amber"
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      )}

      <SectionCard
        title={`Recent Actions (${totalFilteredLogs.toLocaleString("en-IN")})`}
        action={
          <Form action="/activity" className="flex flex-wrap items-center gap-2 text-xs">
            {traceId && <input type="hidden" name="trace" value={traceId} />}
            <select
              name="outcome"
              defaultValue={outcomeFilter}
              aria-label="Filter by Outcome"
              className="rsl-input !w-auto min-w-[144px] py-1.5 pr-8 text-xs"
            >
              <option value="all">All Outcomes</option>
              <option value="success">Completed</option>
              <option value="denied">Blocked</option>
              <option value="error">Failed</option>
            </select>
            <select
              name="category"
              defaultValue={categoryFilter}
              aria-label="Filter by Category"
              className="rsl-input !w-auto min-w-[164px] py-1.5 pr-8 text-xs"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <SubmitButton spinnerSize="xs" pendingText="Filtering..." className="rsl-btn-secondary py-1.5 text-xs">
              Apply Filter
            </SubmitButton>
            {(outcomeFilter !== "all" || categoryFilter !== "all") && (
              <ActionLink href="/activity" className="text-xs font-semibold text-emerald-600 hover:underline">
                Reset
              </ActionLink>
            )}
          </Form>
        }
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">
              Immutable hash-chained workspace activity log entries
            </caption>
            <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-xs tracking-wider text-zinc-500 uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold sm:px-6">
                  Action Summary
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Category
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Date &amp; Time (IST)
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Outcome
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-6">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-[13px] text-zinc-500">
                    No activity entries match your selected filter.
                  </td>
                </tr>
              ) : (
                logs.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3.5 sm:px-6">
                      <div className="font-medium text-slate-900">
                        {formatCustomerAuditSummary(row.summary)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-zinc-600">{row.category}</td>
                    <td className="px-4 py-3.5 text-zinc-600 whitespace-nowrap tabular-nums">
                      {new Date(row.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill
                        label={OUTCOME_LABELS[row.outcome] ?? row.outcome}
                        tone={
                          row.outcome === "success"
                            ? "emerald"
                            : row.outcome === "denied"
                              ? "amber"
                              : "ruby"
                        }
                      />
                    </td>
                    <td className="px-5 py-3.5 text-right sm:px-6">
                      <ActionLink
                        href={`/activity?trace=${encodeURIComponent(row.correlationId)}`}
                        className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 hover:underline"
                      >
                        <span>View Steps</span>
                      </ActionLink>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalLogPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 bg-zinc-50/60 px-6 py-3 text-xs text-zinc-600">
              <span className="tabular-nums">
                Showing {(currentLogPage - 1) * ACTIVITY_PAGE_SIZE + 1}–
                {Math.min(currentLogPage * ACTIVITY_PAGE_SIZE, totalFilteredLogs)} of{" "}
                {totalFilteredLogs.toLocaleString("en-IN")} entries (Page {currentLogPage} of{" "}
                {totalLogPages})
              </span>
              <div className="flex items-center gap-2">
                {currentLogPage > 1 ? (
                  <ActionLink
                    href={`${baseFilterHref}&page=${currentLogPage - 1}`}
                    spinnerSize="xs"
                    className="rsl-btn-secondary py-1 text-xs"
                  >
                    ← Previous
                  </ActionLink>
                ) : (
                  <span className="rounded-lg border border-zinc-200 px-3 py-1 text-zinc-400">
                    ← Previous
                  </span>
                )}
                {currentLogPage < totalLogPages ? (
                  <ActionLink
                    href={`${baseFilterHref}&page=${currentLogPage + 1}`}
                    spinnerSize="xs"
                    className="rsl-btn-secondary py-1 text-xs"
                  >
                    Next →
                  </ActionLink>
                ) : (
                  <span className="rounded-lg border border-zinc-200 px-3 py-1 text-zinc-400">
                    Next →
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={`Platform Support & Staff Access Trail (${staffAccessLogs.length})`}
        subtitle="Full transparency log of any temporary support assistance, read-only diagnostics, or billing actions performed by RapidShift Labs staff on your workspace"
        noPadding
      >
        {staffAccessLogs.length === 0 ? (
          <div className="p-6 text-xs text-zinc-500">
            Zero platform support or staff access sessions have occurred on your workspace.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                Customer-visible trail of platform staff support sessions and actions
              </caption>
              <thead className="border-b border-zinc-200/80 bg-zinc-50/75 text-xs tracking-wider text-zinc-500 uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold sm:px-6">
                    Support Summary &amp; Ticket
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Staff Engineer
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Access Type
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold sm:px-6">
                    Date &amp; Time (IST)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {staffAccessLogs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3 sm:px-6">
                      <div className="font-medium text-slate-900">{entry.summary}</div>
                      {entry.ticketReference && (
                        <div className="mt-0.5 font-mono text-xs text-zinc-500">
                          Ticket: {entry.ticketReference}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {entry.staffName}{" "}
                      <span className="text-zinc-400">({entry.staffRole})</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        label={
                          entry.kind === "impersonation"
                            ? "Support Session"
                            : entry.kind === "inspection"
                              ? "Read-Only Diagnostic"
                              : "Admin Action"
                        }
                        tone={entry.kind === "impersonation" ? "amber" : "sky"}
                      />
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-600 whitespace-nowrap tabular-nums sm:px-6">
                      {new Date(entry.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
