import Form from "next/form";
import {
  FileCheck2,
  IndianRupee,
  Landmark,
  ReceiptText,
  Search,
} from "lucide-react";
import { getPlatformAdminAnalytics } from "@rsl/analytics";
import {
  canStaffAccessAdminRoute,
  canStaffPerform,
  formatStaffRoleLabel,
} from "@rsl/auth";
import { listAllPlatformInvoices } from "@rsl/billing";
import { formatInr } from "@rsl/core";
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
  staffCreateCustomInvoiceAction,
  staffUpdateInvoiceStatusAction,
} from "@/lib/actions";
import { requireStaffSession } from "@/lib/session";

export default async function AdminInvoicesAndLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaffSession();
  if (!canStaffAccessAdminRoute(staff.staffRole, "/invoices")) {
    return (
      <AccessRestrictedState
        pageTitle="GST Invoices & Ledger"
        roleLabel={formatStaffRoleLabel(staff.staffRole)}
        requiredPermissionLabel="View GST invoices & revenue"
        description={`Your ${formatStaffRoleLabel(staff.staffRole)} account does not include access to GST Invoices & Ledger. Contact a Super Admin if you need finance access.`}
      />
    );
  }
  const canManageBilling = canStaffPerform(staff.staffRole, "staff:billing.manage");
  const sp = await searchParams;
  const statusFilter = sp.status || "all";
  const query = sp.q?.trim() || "";

  const allInvoices = listAllPlatformInvoices({ limit: 500 });
  const filteredInvoices = listAllPlatformInvoices({
    status: statusFilter,
    q: query,
    limit: 250,
  });
  const adminData = getPlatformAdminAnalytics();

  const paidInvoices = allInvoices.filter((i) => i.status === "paid");
  const issuedUnpaidInvoices = allInvoices.filter((i) => i.status === "issued");
  const totalCollectedPaise = paidInvoices.reduce((acc, i) => acc + i.totalPaise, 0);
  const totalGstCollectedPaise = paidInvoices.reduce(
    (acc, i) => acc + i.cgstPaise + i.sgstPaise + i.igstPaise,
    0
  );
  const unpaidTotalPaise = issuedUnpaidInvoices.reduce((acc, i) => acc + i.totalPaise, 0);

  const exportHref = `/api/export-invoices?status=${encodeURIComponent(statusFilter)}&q=${encodeURIComponent(query)}`;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Finance & GST Accounting"
        title="GST Invoices & Payments"
        subtitle="Track sequential GST invoices across every client, issue custom retainers or setup bills, mark unpaid invoices as paid, and export CSV sheets for your CA."
        actions={
          <a href={exportHref} className="adm-btn-secondary">
            Download GST CSV
          </a>
        }
      />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Collected (Incl. GST)"
          value={formatInr(totalCollectedPaise)}
          sublabel={`${paidInvoices.length} paid GST invoice(s)`}
          accent="emerald"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="GST Collected (18%)"
          value={formatInr(totalGstCollectedPaise)}
          sublabel="CGST + SGST / IGST across paid bills"
          accent="sky"
          icon={<Landmark className="h-4 w-4" />}
        />
        <MetricCard
          label="Unpaid / Issued"
          value={formatInr(unpaidTotalPaise)}
          sublabel={`${issuedUnpaidInvoices.length} awaiting payment`}
          accent={issuedUnpaidInvoices.length > 0 ? "amber" : "default"}
          icon={<ReceiptText className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Invoices Issued"
          value={String(allInvoices.length)}
          sublabel="Sequential SAC 998314 tax bills"
          icon={<FileCheck2 className="h-4 w-4" />}
        />
      </div>

      {/* Issue Custom GST Invoice */}
      {canManageBilling && (
      <SectionCard
        title="Issue Custom GST Invoice"
        subtitle="Create an official sequential GST invoice (automatically calculates 9% CGST + 9% SGST for same-state or 18% IGST for inter-state)"
        action={<StatusPill label="SAC 998314 • 18% GST" tone="emerald" />}
      >
        <form action={staffCreateCustomInvoiceAction} className="space-y-4 text-[13px]">
          <input type="hidden" name="returnTo" value="/invoices" />

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="adm-label">Client Business</label>
              <select name="workspaceId" required className="adm-input">
                {adminData.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.gstin ? `(${b.gstin})` : `(State ${b.stateCode})`}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="adm-label">Invoice Line Description</label>
              <input
                name="description"
                required
                placeholder="Annual Tally + WhatsApp Setup & Training"
                className="adm-input"
              />
            </div>

            <div>
              <label className="adm-label">Subtotal (₹ ex-GST)</label>
              <input
                name="subtotalRupees"
                type="number"
                min="1"
                step="1"
                required
                placeholder="5000"
                className="adm-input tabular-nums"
              />
            </div>

            <div>
              <label className="adm-label">Payment Status</label>
              <select name="status" defaultValue="paid" className="adm-input">
                <option value="paid">Paid</option>
                <option value="issued">Issued (Unpaid)</option>
              </select>
            </div>

            <div>
              <label className="adm-label">Payment Method</label>
              <select name="paymentMethod" defaultValue="upi" className="adm-input">
                <option value="upi">UPI</option>
                <option value="bank_transfer">NEFT / IMPS / RTGS</option>
                <option value="razorpay">Razorpay</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash Receipt</option>
              </select>
            </div>

            <div>
              <label className="adm-label">UTR / Payment Ref #</label>
              <input
                name="paymentReference"
                placeholder="UTR409188231"
                className="adm-input font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3.5">
            <span className="text-xs text-zinc-500">
              GST rate (18%) and CGST/SGST vs. IGST split are applied automatically from the client&apos;s billing state.
            </span>
            <SubmitButton className="adm-btn-primary" pendingText="Issuing...">
              Issue Custom GST Invoice
            </SubmitButton>
          </div>
        </form>
      </SectionCard>
      )}

      {/* Search & Status Filter Toolbar + Invoices Table */}
      <SectionCard
        title={`GST Invoice Register (${filteredInvoices.length})`}
        subtitle="Click any client name to open their full 360° account & billing history"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: "all", label: "All" },
                { key: "paid", label: "Paid" },
                { key: "issued", label: "Unpaid" },
                { key: "void", label: "Void" },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <ActionLink
                  key={tab.key}
                  href={`/invoices?status=${tab.key}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                  spinnerSize="xs"
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white shadow-xs"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-slate-900"
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
        <div className="border-b border-zinc-100 bg-zinc-50/60 px-6 py-3">
          <Form action="/invoices" className="flex flex-wrap items-center gap-2.5">
            <input type="hidden" name="status" value={statusFilter} />
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={query}
                placeholder="Search invoice #, client name, GSTIN, or UTR reference..."
                className="adm-input pl-8"
              />
            </div>
            <SubmitButton className="adm-btn-secondary" spinnerSize="xs" pendingText="Filtering...">
              Filter
            </SubmitButton>
            {(query || statusFilter !== "all") && (
              <ActionLink href="/invoices" spinnerSize="xs" className="adm-btn-secondary">
                Reset
              </ActionLink>
            )}
          </Form>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-zinc-500">
            No GST invoices match your current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-6 py-3">Invoice #</th>
                  <th className="px-4 py-3">Client &amp; GSTIN</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                  <th className="px-4 py-3 text-right">GST (18%)</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status &amp; Ref</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {filteredInvoices.map((inv) => {
                  const gstTotal = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
                  const gstSplitLabel =
                    inv.igstPaise > 0 ? "18% IGST" : "9% CGST + 9% SGST";
                  return (
                    <tr key={inv.id} className="hover:bg-zinc-50/60">
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <ActionLink
                          href={`/invoices/${inv.id}`}
                          spinnerSize="xs"
                          className="font-mono font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </ActionLink>
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          {new Date(inv.issuedAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <ActionLink
                          href={`/clients/${inv.workspaceId}`}
                          spinnerSize="xs"
                          className="font-semibold text-slate-900 hover:text-emerald-700"
                        >
                          {inv.workspaceName}
                        </ActionLink>
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                          {inv.workspaceGstin || `Unregistered • State ${inv.workspaceStateCode}`}
                        </div>
                      </td>

                      <td className="max-w-xs px-4 py-3.5 text-zinc-700">{inv.description}</td>

                      <td className="px-4 py-3.5 text-right font-medium tabular-nums text-zinc-700">
                        {formatInr(inv.subtotalPaise, { showDecimals: true })}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums">
                        <div className="font-medium text-zinc-700">
                          {formatInr(gstTotal, { showDecimals: true })}
                        </div>
                        <div className="text-[10px] text-zinc-400">{gstSplitLabel}</div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-bold whitespace-nowrap tabular-nums text-slate-900">
                        {formatInr(inv.totalPaise, { showDecimals: true })}
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusPill
                          label={inv.status.toUpperCase()}
                          tone={
                            inv.status === "paid"
                              ? "emerald"
                              : inv.status === "issued"
                                ? "amber"
                                : "stone"
                          }
                        />
                        {inv.paymentReference && (
                          <div className="mt-1 font-mono text-[10px] text-zinc-500">
                            {inv.paymentMethod ? `${inv.paymentMethod.toUpperCase()}: ` : ""}
                            {inv.paymentReference}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-3.5 text-right whitespace-nowrap">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <a
                            href={`/api/pdf/invoice?id=${inv.id}`}
                            className="adm-btn-primary py-1 px-2.5 text-[11px]"
                          >
                            Download PDF
                          </a>
                          <ActionLink
                            href={`/invoices/${inv.id}`}
                            spinnerSize="xs"
                            className="adm-btn-secondary py-1 px-2.5 text-[11px]"
                          >
                            View / Print
                          </ActionLink>
                          {canManageBilling && inv.status === "issued" ? (
                            <>
                              <form
                                action={staffUpdateInvoiceStatusAction}
                                className="inline-flex items-center gap-1.5"
                              >
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input type="hidden" name="status" value="paid" />
                                <input type="hidden" name="returnTo" value="/invoices" />
                                <input
                                  name="paymentReference"
                                  required
                                  placeholder="UTR #"
                                  className="adm-input w-28 py-1 font-mono text-[11px]"
                                />
                                <SubmitButton
                                  className="adm-btn-primary py-1 text-[11px]"
                                  spinnerSize="xs"
                                  pendingText="Saving..."
                                >
                                  Mark Paid
                                </SubmitButton>
                              </form>

                              <form action={staffUpdateInvoiceStatusAction} className="inline-flex">
                                <input type="hidden" name="invoiceId" value={inv.id} />
                                <input type="hidden" name="status" value="void" />
                                <input type="hidden" name="returnTo" value="/invoices" />
                                <SubmitButton
                                  className="adm-btn-danger py-1 text-[11px]"
                                  spinnerSize="xs"
                                  pendingText="Voiding..."
                                >
                                  Void
                                </SubmitButton>
                              </form>
                            </>
                          ) : canManageBilling && inv.status === "paid" ? (
                            <form action={staffUpdateInvoiceStatusAction} className="inline-flex">
                              <input type="hidden" name="invoiceId" value={inv.id} />
                              <input type="hidden" name="status" value="void" />
                              <input type="hidden" name="returnTo" value="/invoices" />
                              <SubmitButton
                                className="adm-btn-secondary py-1 text-[11px]"
                                spinnerSize="xs"
                                pendingText="Voiding..."
                              >
                                Mark Void
                              </SubmitButton>
                            </form>
                          ) : (
                            <span className="text-[11px] text-zinc-400">Voided</span>
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
