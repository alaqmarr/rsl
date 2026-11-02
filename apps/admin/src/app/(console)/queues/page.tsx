import { desc } from "drizzle-orm";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
} from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  canStaffPerform,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { controlSchema } from "@rsl/database";
import { listRecentEmails } from "@rsl/notifications";
import { getPlatformQueueOverview } from "@rsl/queue";
import { controlDb } from "@rsl/tenancy";
import {
  AccessRestrictedState,
  FlashBanner,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import {
  staffRehydrateQueuesAction,
  staffReplayDeadLetterAction,
  staffSendClientEmailAction,
  staffUpdateProviderRequestAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

function formatEmailStatus(transportMode: string, status: string): {
  label: string;
  tone: "emerald" | "amber" | "ruby" | "stone";
} {
  if (status === "failed") {
    return { label: "Failed", tone: "ruby" };
  }
  if (
    transportMode === "local_preview" ||
    transportMode === "local_outbox" ||
    status === "queued_local"
  ) {
    return { label: "Saved in Preview", tone: "stone" };
  }
  return { label: "Sent", tone: "emerald" };
}

function summarizeEmailHtml(html: string): {
  excerpt: string;
  actionUrl?: string;
} {
  const hrefMatch = /href=["'](https?:\/\/[^"']+)["']/i.exec(html);
  const plain = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return {
    excerpt: plain.length > 260 ? `${plain.slice(0, 260)}...` : plain,
    actionUrl: hrefMatch ? hrefMatch[1] : undefined,
  };
}

export default async function QueuesAndOpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/queues")) {
    return (
      <AccessRestrictedState
        pageTitle="Tasks & Client Emails"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="View background tasks & operations"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to Tasks & Client Emails.`}
      />
    );
  }
  const canManageOps = canStaffPerform(staff.staffRole, "staff:ops.manage");
  const sp = await searchParams;
  const qOverview = getPlatformQueueOverview();
  const adminData = getPlatformAdminAnalytics();
  const emails = listRecentEmails(undefined, 30);
  const providerRequests = controlDb()
    .select()
    .from(controlSchema.providerRequests)
    .orderBy(desc(controlSchema.providerRequests.createdAt))
    .all();
  const businessNameById = new Map(adminData.businesses.map((b) => [b.id, b.name]));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Background Delivery & Notifications"
        title="Tasks & Client Emails"
        subtitle="Monitor background WhatsApp and Tally delivery tasks, retry any stopped task in one click, and send direct billing or support emails to clients."
        actions={
          canManageOps ? (
            <form action={staffRehydrateQueuesAction}>
              <SubmitButton className="adm-btn-primary" pendingText="Scanning Tasks...">
                Retry Pending Tasks
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Waiting to Run"
          value={String(qOverview.pendingCount)}
          sublabel="Queued WhatsApp & Tally tasks"
          accent={qOverview.pendingCount > 0 ? "amber" : "default"}
          icon={<Clock className="h-4 w-4" />}
        />
        <MetricCard
          label="Completed Tasks"
          value={String(qOverview.completedCount)}
          sublabel="Delivered background messages"
          accent="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <MetricCard
          label="Stopped Tasks"
          value={String(qOverview.failedCount)}
          sublabel={qOverview.failedCount > 0 ? "Needs review below" : "All tasks running smoothly"}
          accent={qOverview.failedCount > 0 ? "ruby" : "emerald"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <MetricCard
          label="Client Emails Logged"
          value={String(adminData.emailStats.totalCount)}
          sublabel={`${adminData.emailStats.sentCount} delivered • ${adminData.emailStats.localPreviewCount} saved in preview`}
          accent="sky"
          icon={<Mail className="h-4 w-4" />}
        />
      </div>

      {qOverview.deadLetters.length > 0 && (
        <SectionCard
          title="Stopped Tasks Ready to Retry"
          subtitle="Resolve the issue noted below (such as low wallet balance or an expired WhatsApp token), then click Retry"
        >
          <div className="space-y-2.5 text-xs">
            {qOverview.deadLetters.map((dl) => (
              <div
                key={dl.outboxId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/70 p-3.5"
              >
                <div className="text-red-950">
                  <span className="font-semibold">{dl.jobType}</span>
                  <span className="mx-1.5 text-red-400">•</span>
                  <span>{dl.lastError || "Stopped after repeated attempts"}</span>
                </div>
                {canManageOps && (
                  <form action={staffReplayDeadLetterAction}>
                    <input type="hidden" name="tenantId" value={dl.tenantId} />
                    <input type="hidden" name="outboxId" value={dl.outboxId} />
                    <SubmitButton
                      className="adm-btn-secondary py-1.5 text-xs"
                      spinnerSize="xs"
                      pendingText="Retrying..."
                    >
                      Retry Task
                    </SubmitButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Direct Client Notification Email Sender + Sent Emails Table */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.55fr]">
        <SectionCard
          title="Send Email to Client"
          subtitle="Send an official billing receipt note, payment reminder, or onboarding update directly to a client's inbox"
        >
          <form action={staffSendClientEmailAction} className="space-y-3.5 text-xs">
            <input type="hidden" name="returnTo" value="/queues" />

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Client Business</label>
              <select name="workspaceId" className="adm-input">
                {adminData.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Recipient Email</label>
              <input
                name="recipientEmail"
                type="email"
                required
                placeholder="owner@clientbusiness.in"
                className="adm-input"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Subject / Headline</label>
              <input
                name="headline"
                required
                placeholder="Your Tally Prime & WhatsApp Plan is Now Active"
                className="adm-input"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Message</label>
              <textarea
                name="bodyText"
                rows={4}
                required
                placeholder="Hello, we have verified your payment and unlocked your Tally Prime & WhatsApp plan. Your GST tax invoice is ready inside Plans & Wallet."
                className="adm-input"
              />
            </div>

            <SubmitButton className="adm-btn-primary w-full" pendingText="Sending Email...">
              Send Client Email
            </SubmitButton>
          </form>
        </SectionCard>

        <SectionCard
          title={`Recent Client Emails (${emails.length})`}
          subtitle="Password reset links, team invitations, and billing notifications"
          noPadding
        >
          {emails.length === 0 ? (
            <div className="p-6 text-xs text-zinc-500">No emails have been sent yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-6 py-3">Subject</th>
                    <th className="px-4 py-3">Sent To</th>
                    <th className="px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {emails.map((e) => {
                    const statusBadge = formatEmailStatus(e.transportMode, e.status);
                    const preview = summarizeEmailHtml(e.renderedHtml);
                    return (
                      <tr key={e.id} className="align-top hover:bg-zinc-50/60">
                        <td className="px-6 py-3.5">
                          <div className="font-semibold text-slate-900">{e.subject}</div>
                          <details className="mt-1 text-[11px] text-zinc-500">
                            <summary className="cursor-pointer font-medium text-emerald-700 hover:underline">
                              Preview email &amp; link
                            </summary>
                            <div className="mt-1.5 space-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50/80 p-2.5 text-zinc-700">
                              <p className="leading-relaxed">{preview.excerpt}</p>
                              {preview.actionUrl && (
                                <div>
                                  <span className="font-semibold text-slate-900">Action Link:</span>
                                  <code className="mt-0.5 block rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[10.5px] break-all text-emerald-800 select-all">
                                    {preview.actionUrl}
                                  </code>
                                </div>
                              )}
                            </div>
                          </details>
                        </td>
                        <td className="px-4 py-3.5 text-zinc-600">{e.recipientEmail}</td>
                        <td className="px-6 py-3.5">
                          <StatusPill label={statusBadge.label} tone={statusBadge.tone} />
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

      {/* Custom Storage Connector Requests */}
      <SectionCard
        title={`Custom Cloud Storage Requests (${providerRequests.length})`}
        subtitle="Clients requesting custom backup or cloud storage connectors from Backups & Storage"
      >
        {providerRequests.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No custom cloud storage connector requests have been submitted yet.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 text-xs">
            {providerRequests.map((req) => {
              const clientName = businessNameById.get(req.workspaceId) || req.workspaceId;
              const statusTone =
                req.status === "enabled"
                  ? "emerald"
                  : req.status === "custom_quoted"
                    ? "sky"
                    : req.status === "reviewing"
                      ? "amber"
                      : "stone";
              const statusLabel =
                req.status === "custom_quoted"
                  ? "Quote Sent"
                  : req.status === "enabled"
                    ? "Enabled"
                    : req.status === "reviewing"
                      ? "Reviewing"
                      : "Submitted";
              return (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{req.providerName}</span>
                      <StatusPill label={statusLabel} tone={statusTone} />
                      <span className="text-[11px] text-zinc-500">
                        Priority: <strong className="capitalize">{req.urgency}</strong>
                      </span>
                    </div>
                    <div className="text-[11.5px] text-zinc-600">
                      Client: <strong>{clientName}</strong> • Contact: {req.contactEmail}
                      {req.providerUrl ? ` • ${req.providerUrl}` : ""}
                    </div>
                  </div>
                  {canManageOps && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { value: "reviewing", label: "Mark Reviewing" },
                          { value: "custom_quoted", label: "Quote Sent" },
                          { value: "enabled", label: "Mark Enabled" },
                        ] as const
                      ).map((btn) => (
                        <form key={btn.value} action={staffUpdateProviderRequestAction}>
                          <input type="hidden" name="requestId" value={req.id} />
                          <input type="hidden" name="status" value={btn.value} />
                          <SubmitButton
                            spinnerSize="xs"
                            pendingText="Saving..."
                            className={
                              req.status === btn.value
                                ? "adm-btn-primary py-1 text-[11px]"
                                : "adm-btn-secondary py-1 text-[11px]"
                            }
                          >
                            {btn.label}
                          </SubmitButton>
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Help Searches with No Results"
          subtitle="Topics clients searched for in Help Guides that returned zero matches"
        >
          {adminData.zeroResultSearches.length === 0 ? (
            <p className="text-xs text-zinc-500">Every client search matched an existing guide.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {adminData.zeroResultSearches.map((z) => (
                <li
                  key={z.query}
                  className="flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3.5 py-2"
                >
                  <span className="font-semibold text-slate-800">&ldquo;{z.query}&rdquo;</span>
                  <span className="text-zinc-500">{z.searches} searches</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Help Guide Ratings"
          subtitle="Feedback and comments left by clients at the bottom of guides"
        >
          {adminData.docsFeedbackRows.length === 0 ? (
            <p className="text-xs text-zinc-500">No guide feedback submitted yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {adminData.docsFeedbackRows.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-3.5 py-2"
                >
                  <span className="text-slate-800">
                    <strong>{f.slug}</strong> {f.comment ? `— ${f.comment}` : ""}
                  </span>
                  <StatusPill
                    label={f.helpful ? "Helpful" : "Needs Update"}
                    tone={f.helpful ? "emerald" : "amber"}
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
