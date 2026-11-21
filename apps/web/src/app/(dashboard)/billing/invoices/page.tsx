import { BILLING_CYCLE_META } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, PageHeader, SectionCard, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { BillingSuiteNav } from "@/components/suite-subnav";
import { loadBillingWorkspaceContext } from "@/lib/billing-data";
import { requireWebSession } from "@/lib/session";

export default async function BillingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/billing/invoices", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="GST Tax Invoices & Statements"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View GST invoices & payment requests"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = loadBillingWorkspaceContext(session.workspace.id, session.roleSlug);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Plans, Wallet & GST"
        title="GST Tax Invoices & Verification History"
        subtitle={`Sequential GST Tax Invoices (SAC 998314) • Supplier GSTIN: ${ctx.billingSettings.gstin}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.invoices.length > 0 && (
              <a href="/api/export/gst-invoices-csv" className="rsl-btn-secondary text-xs">
                Export GSTR-1 CSV
              </a>
            )}
            <ActionLink href="/billing" className="rsl-btn-secondary text-xs">
              ← Plans &amp; Bundles
            </ActionLink>
          </div>
        }
      />

      <BillingSuiteNav active="invoices" invoicesCount={ctx.invoices.length} />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title={`GST Invoices & Vouchers (${ctx.invoices.length})`}
          subtitle="Download PDF tax invoices, credit notes, and advance receipts anytime"
          noPadding
        >
          {ctx.invoices.length === 0 ? (
            <div className="p-6 text-[13px] text-[var(--ink-muted)]">
              GST tax invoices appear here automatically once a plan activation or wallet deposit
              is verified.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Invoice #</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                    <th className="px-4 py-3 text-right">GST (18%)</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right sm:px-6">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {ctx.invoices.map((inv) => {
                    const gst = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
                    return (
                      <tr key={inv.id} className="hover:bg-[var(--surface-inset)]/60">
                        <td className="px-5 py-3 whitespace-nowrap sm:px-6">
                          <ActionLink
                            href={`/billing/invoices/${inv.id}`}
                            spinnerSize="xs"
                            className="font-mono font-bold text-[var(--ink)] hover:text-[var(--brand)] hover:underline"
                          >
                            {inv.invoiceNumber}
                          </ActionLink>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-muted)] tabular-nums">
                            <span>
                              {new Date(inv.issuedAt).toLocaleDateString("en-IN", {
                                timeZone: "Asia/Kolkata",
                              })}
                            </span>
                            <StatusPill
                              label={
                                inv.docType === "advance_receipt"
                                  ? "ADVANCE RECEIPT"
                                  : inv.docType === "credit_note"
                                    ? "CREDIT NOTE"
                                    : "TAX INVOICE"
                              }
                              tone={
                                inv.docType === "credit_note"
                                  ? "ruby"
                                  : inv.docType === "advance_receipt"
                                    ? "sky"
                                    : "emerald"
                              }
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--ink-secondary)]">{inv.description}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--ink-secondary)]">
                          {formatInr(inv.subtotalPaise)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--ink-muted)]">
                          {formatInr(gst)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-[var(--brand)]">
                          {formatInr(inv.totalPaise)}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap sm:px-6">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={`/api/pdf/invoice?id=${inv.id}`}
                              className="rsl-btn-primary py-1 px-2.5 text-xs"
                            >
                              PDF
                            </a>
                            <ActionLink
                              href={`/billing/invoices/${inv.id}`}
                              spinnerSize="xs"
                              className="rsl-btn-secondary py-1 px-2.5 text-xs"
                            >
                              View
                            </ActionLink>
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

        <SectionCard
          title="Verification & UTR Request History"
          subtitle="Live status of submitted plan requests and wallet transfers"
          noPadding
        >
          {ctx.planRequests.length === 0 && ctx.rechargeRequests.length === 0 ? (
            <div className="p-6 text-[13px] text-[var(--ink-muted)]">
              No plan requests or UTR transfers submitted yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Item &amp; Cycle</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-right sm:px-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {ctx.planRequests.map((pr) => (
                    <tr key={pr.id} className="hover:bg-[var(--surface-inset)]/60">
                      <td className="px-5 py-3 sm:px-6">
                        <div className="font-semibold text-[var(--ink)]">
                          {pr.bundleKey ? `Bundle: ${pr.serviceName}` : `Plan: ${pr.serviceName}`}
                        </div>
                        <div className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {BILLING_CYCLE_META[pr.billingCycle].shortLabel} •{" "}
                          {new Date(pr.createdAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                          {pr.customerPaymentRef ? ` • Ref: ${pr.customerPaymentRef}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">
                        {formatInr(pr.amountPaidPaise ?? pr.effectiveCyclePaise)}
                      </td>
                      <td className="px-5 py-3 text-right sm:px-6">
                        <StatusPill
                          label={
                            pr.status === "activated"
                              ? "Paid & Active"
                              : pr.status === "pending_payment"
                                ? "Pending"
                                : "Declined"
                          }
                          tone={
                            pr.status === "activated"
                              ? "emerald"
                              : pr.status === "pending_payment"
                                ? "amber"
                                : "ruby"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  {ctx.rechargeRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-[var(--surface-inset)]/60">
                      <td className="px-5 py-3 sm:px-6">
                        <div className="font-medium text-[var(--ink)]">
                          Wallet • {req.provider.toUpperCase()} ({req.externalPaymentId || "Online"})
                        </div>
                        <div className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {new Date(req.createdAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--ink)]">
                        {formatInr(req.amountPaise)}
                      </td>
                      <td className="px-5 py-3 text-right sm:px-6">
                        <StatusPill
                          label={
                            req.status === "captured"
                              ? "Credited"
                              : req.status === "pending_verification"
                                ? "Pending"
                                : "Declined"
                          }
                          tone={
                            req.status === "captured"
                              ? "emerald"
                              : req.status === "pending_verification"
                                ? "amber"
                                : "ruby"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
