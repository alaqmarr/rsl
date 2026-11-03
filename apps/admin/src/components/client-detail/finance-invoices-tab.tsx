import { formatInr } from "@rsl/core";
import { AccessRestrictedState, SectionCard, StatusPill } from "@rsl/ui";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import {
  staffAdjustWalletAction,
  staffCreateCustomInvoiceAction,
} from "@/lib/actions";

export interface ClientFinanceLedgerRow {
  id: string;
  description: string;
  amountPaise: number;
  createdAt: number;
}

export interface ClientFinanceInvoiceRow {
  id: string;
  invoiceNumber: string;
  description: string;
  status: string;
  totalPaise: number;
}

export function ClientFinanceInvoicesTab({
  workspaceId,
  canViewBilling,
  canManageBilling,
  staffRoleLabel,
  ledger,
  invoices,
}: {
  workspaceId: string;
  canViewBilling: boolean;
  canManageBilling: boolean;
  staffRoleLabel: string;
  ledger: ClientFinanceLedgerRow[];
  invoices: ClientFinanceInvoiceRow[];
}) {
  if (!canViewBilling) {
    return (
      <AccessRestrictedState
        pageTitle="Client Wallet & GST Invoices"
        roleLabel={staffRoleLabel}
        requiredPermissionLabel="View GST invoices & revenue"
        description={`Your ${staffRoleLabel} account does not include access to client wallet ledgers or GST tax invoices.`}
      />
    );
  }

  const returnToFinance = `/clients/${workspaceId}?tab=finance`;

  return (
    <div className="space-y-6">
      {canManageBilling && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SectionCard
            title="Add or Deduct Wallet Balance"
            subtitle="Updates this client's prepaid wallet immediately with a permanent audit entry (overdraft allowed down to -₹200.00)"
          >
            <form action={staffAdjustWalletAction} className="space-y-3.5 text-xs">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToFinance} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fin-wallet-dir" className="mb-1 block font-semibold text-slate-800">
                    Action
                  </label>
                  <select id="fin-wallet-dir" name="direction" defaultValue="credit" className="adm-input">
                    <option value="credit">Add Balance (+₹)</option>
                    <option value="debit">Deduct Balance (-₹)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="fin-wallet-amt" className="mb-1 block font-semibold text-slate-800">
                    Amount (₹) *
                  </label>
                  <input
                    id="fin-wallet-amt"
                    name="amountRupees"
                    type="number"
                    min="1"
                    required
                    defaultValue="1000"
                    className="adm-input tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="fin-wallet-reason" className="mb-1 block font-semibold text-slate-800">
                  Reason / Note *
                </label>
                <div className="flex gap-2">
                  <input
                    id="fin-wallet-reason"
                    name="reason"
                    required
                    minLength={5}
                    placeholder="e.g. Verified bank transfer or onboarding bonus"
                    className="adm-input flex-1"
                  />
                  <SubmitButton className="adm-btn-primary" pendingText="Saving...">
                    Update Wallet
                  </SubmitButton>
                </div>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            title="Issue Custom GST Tax Invoice"
            subtitle="Generate an official sequential 18% GST invoice (SAC 998314) for onboarding, setup, or custom billing"
          >
            <form action={staffCreateCustomInvoiceAction} className="space-y-3.5 text-xs">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="returnTo" value={returnToFinance} />
              <div>
                <label htmlFor="fin-inv-desc" className="mb-1 block font-semibold text-slate-800">
                  Invoice Description *
                </label>
                <input
                  id="fin-inv-desc"
                  name="description"
                  required
                  placeholder="e.g. Custom Tally Prime Integration & Setup"
                  className="adm-input"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="fin-inv-sub" className="mb-1 block font-semibold text-slate-800">
                    Subtotal before GST (₹) *
                  </label>
                  <input
                    id="fin-inv-sub"
                    name="subtotalRupees"
                    type="number"
                    min="1"
                    required
                    placeholder="2500"
                    className="adm-input tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="fin-inv-status" className="mb-1 block font-semibold text-slate-800">
                    Status
                  </label>
                  <select id="fin-inv-status" name="status" defaultValue="paid" className="adm-input">
                    <option value="paid">Paid</option>
                    <option value="issued">Issued (Unpaid)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="fin-inv-utr" className="mb-1 block font-semibold text-slate-800">
                    UTR / Ref
                  </label>
                  <input
                    id="fin-inv-utr"
                    name="paymentReference"
                    placeholder="UTR #"
                    className="adm-input font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <SubmitButton className="adm-btn-dark" pendingText="Issuing...">
                  Generate GST Invoice
                </SubmitButton>
              </div>
            </form>
          </SectionCard>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Client Wallet Passbook"
          action={
            <a
              href={`/api/pdf/client-statement?workspaceId=${workspaceId}`}
              className="adm-btn-secondary py-1 px-2.5 text-xs"
            >
              Download Statement PDF
            </a>
          }
          noPadding
        >
          {ledger.length === 0 ? (
            <div className="p-6 text-xs text-zinc-500">No wallet transactions yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Description</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {ledger.map((e) => (
                    <tr key={e.id}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-900">{e.description}</div>
                        <div className="text-[11px] text-zinc-500">
                          {new Date(e.createdAt).toLocaleString("en-IN")}
                        </div>
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-bold tabular-nums ${
                          e.amountPaise >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {e.amountPaise >= 0 ? "+" : ""}
                        {formatInr(e.amountPaise, { showDecimals: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Client GST Invoices & Receipts" noPadding>
          {invoices.length === 0 ? (
            <div className="p-6 text-xs text-zinc-500">No GST invoices issued yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50/80 text-[11px] tracking-wider text-zinc-500 uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-semibold">Document #</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                    <th className="px-5 py-2.5 text-right font-semibold">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-5 py-3">
                        <ActionLink
                          href={`/invoices/${inv.id}`}
                          spinnerSize="xs"
                          className="font-mono font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </ActionLink>
                        <div className="text-[11px] text-zinc-500">{inv.description}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          label={inv.status.toUpperCase()}
                          tone={
                            inv.status === "paid"
                              ? "emerald"
                              : inv.status === "void" || inv.status === "credited"
                                ? "ruby"
                                : "amber"
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatInr(inv.totalPaise)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <a
                          href={`/api/pdf/invoice?id=${inv.id}`}
                          className="adm-btn-secondary py-1 px-2 text-[11px]"
                        >
                          Download PDF
                        </a>
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
