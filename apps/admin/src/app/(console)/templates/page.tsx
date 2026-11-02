import {
  FileSpreadsheet,
  MessageSquareCode,
  Webhook,
} from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { listAllPlatformTallyWebhooks } from "@rsl/tally";
import {
  AccessRestrictedState,
  FlashBanner,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@rsl/ui";
import { listAllPlatformWhatsAppTemplates } from "@rsl/whatsapp";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffCreateWorkspaceTemplateAction,
  staffReviewTemplateAction,
  staffSeedStarterTemplatesAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminWhatsAppTemplatesAndTallyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/templates")) {
    return (
      <AccessRestrictedState
        pageTitle="WhatsApp & Tally Operations"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="Manage WhatsApp templates & Tally sync"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to WhatsApp Templates & Tally Operations.`}
      />
    );
  }
  const sp = await searchParams;
  const statusFilter = sp.status || "ALL";
  const templates = listAllPlatformWhatsAppTemplates();
  const tallyWebhooks = listAllPlatformTallyWebhooks();
  const adminData = getPlatformAdminAnalytics();

  const approvedCount = templates.filter((t) => t.approvalStatus === "APPROVED").length;
  const pendingCount = templates.filter((t) => t.approvalStatus === "PENDING").length;
  const totalTallyEvents = tallyWebhooks.reduce((acc, w) => acc + w.eventsReceivedCount, 0);
  const verifiedTallyClientsCount = tallyWebhooks.filter(
    (w) =>
      w.liveStatus.state === "receiving_live" || w.liveStatus.state === "handshake_verified"
  ).length;

  const visibleTemplates =
    statusFilter === "ALL"
      ? templates
      : templates.filter((t) => t.approvalStatus === statusFilter);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="WhatsApp & Tally Operations"
        title="WhatsApp Templates & Tally Links"
        subtitle="Push ready-to-use Tally bill & reminder templates to any client in one click, review client-submitted templates, and monitor live Tally Prime bill connections."
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="WhatsApp Templates"
          value={String(templates.length)}
          sublabel={`${approvedCount} approved • ${pendingCount} waiting review`}
          accent={pendingCount > 0 ? "amber" : "emerald"}
          icon={<MessageSquareCode className="h-4 w-4" />}
        />
        <MetricCard
          label="Verified Tally Clients"
          value={`${verifiedTallyClientsCount}/${tallyWebhooks.length}`}
          sublabel="Clients verified or receiving live bills"
          accent="emerald"
          icon={<Webhook className="h-4 w-4" />}
        />
        <MetricCard
          label="Bills Received from Tally"
          value={String(totalTallyEvents)}
          sublabel="Sales bills & receipts synced automatically"
          accent="sky"
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
      </div>

      {/* 1-Click Starter Pack Push */}
      <SectionCard
        title="1-Click Tally Starter Templates"
        subtitle="Instantly add 3 approved Tally WhatsApp templates (Sales Invoice Created, Payment Receipt Thank You, Overdue Reminder) into a client's account"
        action={<StatusPill label="Instant Approved Pack" tone="emerald" />}
      >
        <form
          action={staffSeedStarterTemplatesAction}
          className="flex flex-wrap items-end gap-3 text-xs"
        >
          <input type="hidden" name="returnTo" value="/templates" />
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block font-semibold text-zinc-700">Select Client Business</label>
            <select name="workspaceId" required className="adm-input">
              {adminData.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton className="adm-btn-primary" pendingText="Adding Starter Pack...">
            Push 3 Starter Templates
          </SubmitButton>
        </form>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1.45fr]">
        <SectionCard
          title="Add Custom Approved Template"
          subtitle="Create a custom WhatsApp message template directly inside a client's account"
        >
          <form action={staffCreateWorkspaceTemplateAction} className="space-y-3.5 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Client</label>
                <select name="workspaceId" required className="adm-input">
                  {adminData.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Message Type</label>
                <select name="category" defaultValue="utility" className="adm-input">
                  <option value="utility">Bills, Receipts &amp; Reminders (Utility)</option>
                  <option value="marketing">Offers &amp; Announcements (Marketing)</option>
                  <option value="authentication">Login / Verification Code</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Template Code Name</label>
                <input
                  name="name"
                  required
                  placeholder="tally_dispatch_update"
                  className="adm-input font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-zinc-700">Top Header</label>
                <select name="headerType" defaultValue="TEXT" className="adm-input">
                  <option value="NONE">No Header</option>
                  <option value="TEXT">Text Heading</option>
                  <option value="DOCUMENT">PDF Bill Attachment</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Header Text (Optional)</label>
              <input
                name="headerText"
                placeholder="Tax Invoice Generated"
                className="adm-input"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">
                Message Text ({"{{1}}"} Customer, {"{{2}}"} Bill #, {"{{3}}"} Amount, {"{{4}}"} Due Date)
              </label>
              <textarea
                name="bodyText"
                rows={3}
                required
                defaultValue="Namaste {{1}}, your invoice #{{2}} for {{3}} has been generated. Payment due date is {{4}}. Thank you!"
                className="adm-input"
              />
            </div>

            <div>
              <label className="mb-1 block font-semibold text-zinc-700">Bottom Note (Optional)</label>
              <input
                name="footerText"
                placeholder="Reply STOP to opt out"
                className="adm-input"
              />
            </div>

            <SubmitButton className="adm-btn-dark w-full" pendingText="Saving Template...">
              Save Approved Template
            </SubmitButton>
          </form>
        </SectionCard>

        <SectionCard
          title={`Client Tally Prime Connections (${tallyWebhooks.length})`}
          subtitle="Active automation rules and bills synced per client"
          noPadding
        >
          {tallyWebhooks.length === 0 ? (
            <div className="p-6 text-xs text-zinc-500">
              No clients have connected Tally Prime yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-3">Client &amp; Subdomain</th>
                    <th className="px-4 py-3">Connection Status</th>
                    <th className="px-4 py-3">Active Rules</th>
                    <th className="px-5 py-3 text-right">Bills Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {tallyWebhooks.map((ep) => {
                    const stTone =
                      ep.liveStatus.tone === "success"
                        ? "emerald"
                        : ep.liveStatus.tone === "info"
                          ? "sky"
                          : ep.liveStatus.tone === "danger"
                            ? "ruby"
                            : ep.liveStatus.tone === "warning"
                              ? "amber"
                              : "stone";
                    return (
                      <tr key={ep.id} className="hover:bg-zinc-50/60">
                        <td className="px-5 py-3.5">
                          <ActionLink
                            href={`/clients/${ep.workspaceId}`}
                            spinnerSize="xs"
                            className="font-semibold text-slate-900 hover:text-emerald-700"
                          >
                            {ep.workspaceName}
                          </ActionLink>
                          <div className="font-mono text-[11px] text-zinc-500">
                            {ep.workspaceSlug}.tally.rapidshiftlabs.in
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusPill label={ep.liveStatus.label} tone={stTone} />
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusPill
                            label={`${ep.activeRulesCount} rule(s)`}
                            tone={ep.activeRulesCount > 0 ? "emerald" : "stone"}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold tabular-nums text-slate-900">
                          {ep.eventsReceivedCount}
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

      <SectionCard
        title={`All Client WhatsApp Templates (${visibleTemplates.length})`}
        subtitle="Approve, pause, or reject templates created by clients"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {(["ALL", "PENDING", "APPROVED", "PAUSED", "REJECTED"] as const).map((st) => {
              const active = statusFilter === st;
              return (
                <ActionLink
                  key={st}
                  href={st === "ALL" ? "/templates" : `/templates?status=${st}`}
                  spinnerSize="xs"
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {st === "ALL" ? "All" : st.charAt(0) + st.slice(1).toLowerCase()}
                </ActionLink>
              );
            })}
          </div>
        }
        noPadding
      >
        {visibleTemplates.length === 0 ? (
          <div className="p-6 text-xs text-zinc-500">
            No WhatsApp templates match this status filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-4 py-3">Template Name</th>
                  <th className="px-4 py-3">Message Preview</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Update Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {visibleTemplates.map((t) => (
                  <tr key={`${t.workspaceId}:${t.id}`} className="hover:bg-zinc-50/60">
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <ActionLink
                        href={`/clients/${t.workspaceId}`}
                        spinnerSize="xs"
                        className="hover:text-emerald-700"
                      >
                        {t.workspaceName}
                      </ActionLink>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-mono font-bold text-slate-900">{t.name}</div>
                      <div className="mt-0.5 text-[11px] capitalize text-zinc-500">{t.category}</div>
                    </td>
                    <td className="max-w-md px-4 py-4">
                      {t.headerText && (
                        <div className="font-semibold text-slate-900">{t.headerText}</div>
                      )}
                      <div className="text-zinc-600">{t.bodyText}</div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill
                        label={t.approvalStatus}
                        tone={
                          t.approvalStatus === "APPROVED"
                            ? "emerald"
                            : t.approvalStatus === "PENDING"
                              ? "amber"
                              : "ruby"
                        }
                      />
                    </td>
                    <td className="px-6 py-4">
                      <form
                        action={staffReviewTemplateAction}
                        className="flex items-center justify-end gap-2"
                      >
                        <input type="hidden" name="workspaceId" value={t.workspaceId} />
                        <input type="hidden" name="templateId" value={t.id} />
                        <select
                          name="approvalStatus"
                          defaultValue={t.approvalStatus}
                          className="adm-input w-32 py-1.5 text-xs"
                        >
                          <option value="APPROVED">Approved</option>
                          <option value="PENDING">Pending</option>
                          <option value="PAUSED">Paused</option>
                          <option value="REJECTED">Rejected</option>
                        </select>
                        <SubmitButton
                          className="adm-btn-secondary py-1.5 text-xs"
                          spinnerSize="xs"
                          pendingText="Saving..."
                        >
                          Save
                        </SubmitButton>
                      </form>
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
