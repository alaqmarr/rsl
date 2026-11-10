import Form from "next/form";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  formatStaffRoleLabel,
} from "@rsl/auth";
import {
  ALLOWLISTED_INSPECTOR_QUERIES,
  runAllowlistedTenantInspection,
  type InspectorQueryKey,
} from "@rsl/tenancy";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";
import { requireStaffSession } from "@/lib/session";

function formatCellValue(col: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "-";
  if (typeof val === "number") {
    if (col.endsWith("_at") && val > 1_000_000_000_000) {
      return new Date(val).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    }
    if (col.endsWith("_paise")) {
      return `₹${(val / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return val.toLocaleString("en-IN");
  }
  return String(val);
}

function formatColumnHeading(col: string): string {
  return col
    .replace(/_paise$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatStaffActionLabel(action: string): {
  label: string;
  tone: "emerald" | "amber" | "ruby" | "sky" | "stone";
} {
  const map: Record<string, { label: string; tone: "emerald" | "amber" | "ruby" | "sky" | "stone" }> = {
    "plan.payment_activated": { label: "Plan Unlocked", tone: "emerald" },
    "plan.bundle_activated": { label: "Bundle Unlocked", tone: "emerald" },
    "plan.request_declined": { label: "Request Declined", tone: "amber" },
    "plan.revoked": { label: "Plan Locked", tone: "ruby" },
    "plan.entitlement_revoked": { label: "Plan Locked", tone: "ruby" },
    "pricing.client_override": { label: "Custom Client Rate", tone: "sky" },
    "pricing.updated": { label: "Catalog Price Updated", tone: "sky" },
    "billing.settings_updated": { label: "UPI / Bank Updated", tone: "sky" },
    "wallet.recharge.approved": { label: "Recharge Approved", tone: "emerald" },
    "wallet.recharge.rejected": { label: "Recharge Declined", tone: "amber" },
    "wallet.credit": { label: "Manual Wallet Credit", tone: "emerald" },
    "wallet.debit": { label: "Manual Wallet Deduction", tone: "amber" },
    "client.created": { label: "New Client Onboarded", tone: "emerald" },
    "client.updated": { label: "Client Profile Updated", tone: "stone" },
    "client.password_reset": { label: "Password Reset", tone: "amber" },
    "client.email_verified": { label: "Email Verified", tone: "emerald" },
    "invoice.issued": { label: "GST Invoice Issued", tone: "emerald" },
    "invoice.paid": { label: "Invoice Marked Paid", tone: "emerald" },
    "invoice.void": { label: "Invoice Voided", tone: "ruby" },
    "whatsapp.template.reviewed": { label: "Template Reviewed", tone: "sky" },
    "whatsapp.template.created": { label: "Template Added", tone: "emerald" },
    "whatsapp.template.seeded": { label: "Starter Pack Pushed", tone: "emerald" },
    "whatsapp.template.provisioned": { label: "Template Added", tone: "emerald" },
    "staff.member_created": { label: "Staff Added", tone: "sky" },
    "staff.member_updated": { label: "Staff Updated", tone: "stone" },
    "staff.impersonation.started": { label: "Support View Opened", tone: "amber" },
    "inspector.support_bundle": { label: "Support Bundle Exported", tone: "sky" },
    "email.sent": { label: "Client Email Sent", tone: "sky" },
    "ssl.client_provisioned": { label: "Client SSL Verified", tone: "emerald" },
  };
  if (map[action]) return map[action]!;
  if (action.startsWith("inspector.")) return { label: "Read-Only Check", tone: "stone" };
  return { label: action.replace(/[._]/g, " "), tone: "stone" };
}

export default async function ClientRecordsAndLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/inspector")) {
    return (
      <AccessRestrictedState
        pageTitle="Support Check & Staff Activity Log"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="Inspect client records & support logs"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to the read-only Support Inspector.`}
      />
    );
  }
  const sp = await searchParams;
  const adminData = getPlatformAdminAnalytics();

  let inspectionRows: Record<string, unknown>[] | null = null;
  let inspectionError: string | null = null;

  if (sp.tenantId && sp.queryKey && sp.ticket) {
    try {
      inspectionRows = runAllowlistedTenantInspection({
        staffId: staff.id,
        tenantId: sp.tenantId,
        queryKey: sp.queryKey as InspectorQueryKey,
        ticketReference: sp.ticket,
      });
    } catch (err) {
      inspectionError = err instanceof Error ? err.message : String(err);
    }
  }

  const columns =
    inspectionRows && inspectionRows.length > 0 ? Object.keys(inspectionRows[0]!) : [];

  const logQuery = sp.logQuery?.trim().toLowerCase() || "";
  const filteredAdminLogs = logQuery
    ? adminData.recentAdminLogs.filter(
        (l) =>
          l.action.toLowerCase().includes(logQuery) ||
          l.summary.toLowerCase().includes(logQuery) ||
          (l.ticketReference && l.ticketReference.toLowerCase().includes(logQuery))
      )
    : adminData.recentAdminLogs;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Support & Audit Trail"
        title="Support Check & Staff Activity Log"
        subtitle="Run safe read-only checks on client bills, templates, or tasks during a support call, download redacted diagnostic bundles, and review the permanent log of all staff actions."
        badge={<StatusPill label="Read-Only Support Tool" tone="emerald" />}
      />

      <SectionCard
        title="Read-Only Client Account Check"
        subtitle="Never modifies client data. Enter a brief call reason or support ticket note to view summary records."
      >
        <Form
          action="/inspector"
          className="grid grid-cols-1 gap-3.5 text-[13px] sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1.4fr_auto]"
        >
          <div>
            <label className="adm-label">Client Account</label>
            <select name="tenantId" defaultValue={sp.tenantId || ""} required className="adm-input">
              {adminData.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="adm-label">Record Group</label>
            <select name="queryKey" defaultValue={sp.queryKey || "summary_counts"} className="adm-input">
              {Object.entries(ALLOWLISTED_INSPECTOR_QUERIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="adm-label">Support Call / Ticket Reason</label>
            <input
              name="ticket"
              defaultValue={sp.ticket || ""}
              required
              placeholder="e.g. Support call regarding bill sync"
              className="adm-input"
            />
          </div>

          <div className="flex items-end">
            <SubmitButton className="adm-btn-primary w-full lg:w-auto" pendingText="Checking...">
              Check Records
            </SubmitButton>
          </div>
        </Form>

        {inspectionError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800">
            {inspectionError}
          </div>
        )}

        {inspectionRows && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200">
            {inspectionRows.length === 0 ? (
              <div className="bg-zinc-50/70 p-4 text-[13px] text-zinc-500">
                No matching records found for this check.
              </div>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-4 py-2.5 whitespace-nowrap">
                        {formatColumnHeading(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 bg-white">
                  {inspectionRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50/60">
                      {columns.map((col) => (
                        <td key={col} className="px-4 py-2.5 whitespace-nowrap text-slate-800 tabular-nums">
                          {formatCellValue(col, row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Download Redacted Support Bundle (.json)"
        subtitle="Exports hash-chain verification, active plans, connection health, and redacted recent actions & jobs for escalation - with zero raw tokens or customer phone/email PII."
      >
        <form
          action="/api/support-bundle"
          method="GET"
          className="grid grid-cols-1 gap-3.5 text-[13px] sm:grid-cols-2 lg:grid-cols-[1.3fr_1.5fr_auto]"
        >
          <div>
            <label className="adm-label">Client Account</label>
            <select name="tenantId" defaultValue={sp.tenantId || ""} required className="adm-input">
              {adminData.businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="adm-label">Support Call / Ticket Reference</label>
            <input
              name="ticket"
              defaultValue={sp.ticket || ""}
              required
              minLength={3}
              placeholder="e.g. SUP-1042 - WhatsApp sync check"
              className="adm-input"
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="adm-btn-secondary w-full lg:w-auto">
              Download Support Bundle (.json)
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title={`Staff Activity Log (${filteredAdminLogs.length})`}
        subtitle="Permanent record of payments recorded, plans unlocked, custom rates, wallet updates, and support checks"
        action={
          <Form action="/inspector" className="flex flex-wrap items-center gap-2 text-xs">
            <input
              name="logQuery"
              defaultValue={sp.logQuery || ""}
              placeholder="Filter by action, client, or UTR..."
              className="adm-input w-56 py-1.5 text-xs"
            />
            <SubmitButton spinnerSize="xs" pendingText="Filtering..." className="adm-btn-secondary py-1.5 text-xs">
              Filter Log
            </SubmitButton>
          </Form>
        }
        noPadding
      >
        {filteredAdminLogs.length === 0 ? (
          <div className="p-6 text-[13px] text-zinc-500">No matching staff actions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 sm:px-6">Date &amp; Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-5 py-3 sm:px-6">UTR / Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {filteredAdminLogs.map((l) => {
                  const badge = formatStaffActionLabel(l.action);
                  return (
                    <tr key={l.id} className="hover:bg-zinc-50/60">
                      <td className="px-5 py-3 whitespace-nowrap text-xs text-zinc-500 tabular-nums sm:px-6">
                        {new Date(l.ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusPill label={badge.label} tone={badge.tone} />
                      </td>
                      <td className="px-4 py-3 text-slate-800">{l.summary}</td>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-500 sm:px-6">
                        {l.ticketReference || "-"}
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
