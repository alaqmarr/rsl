import { Landmark, Megaphone, QrCode, Wallet } from "lucide-react";
import { MIN_WALLET_BALANCE_PAISE, WALLET_OVERDRAFT_LIMIT_PAISE } from "@rsl/billing";
import { formatInr } from "@rsl/core";
import { canRoleAccessWebRoute, formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, MetricCard, PageHeader, SectionCard } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink, SubmitButton } from "@/components/ios-feedback";
import { RazorpayCheckoutButton } from "@/components/razorpay-checkout-button";
import { BillingSuiteNav } from "@/components/suite-subnav";
import {
  submitAdSpendRechargeRequestAction,
  submitRechargeRequestAction,
} from "@/lib/actions";
import { loadBillingWorkspaceContext } from "@/lib/billing-data";
import { requireWebSession } from "@/lib/session";

export default async function BillingWalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireWebSession();
  const sp = await searchParams;

  if (!canRoleAccessWebRoute(session.roleSlug, "/billing/wallet", session.workspace.id)) {
    return (
      <AccessRestrictedState
        pageTitle="Prepaid Wallet & Ad Spend Vault"
        roleLabel={formatRoleLabel(session.roleSlug)}
        requiredPermissionLabel="View prepaid wallet & UTR deposits"
        homeHref="/"
        homeLabel="Back to Overview"
      />
    );
  }

  const ctx = loadBillingWorkspaceContext(session.workspace.id, session.roleSlug);
  const { billingSettings } = ctx;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Plans, Wallet & GST"
        title="Prepaid Messaging Wallet & Ad Spend Vault"
        subtitle="Top up via UPI / NEFT UTR or instant Razorpay checkout and inspect your immutable passbook"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.ledger.length > 0 && (
              <a href="/api/pdf/wallet-statement" className="rsl-btn-secondary text-xs">
                Download Passbook PDF
              </a>
            )}
            <ActionLink href="/billing" className="rsl-btn-secondary text-xs">
              View Plans &amp; Bundles
            </ActionLink>
          </div>
        }
      />

      <BillingSuiteNav active="wallet" invoicesCount={ctx.invoices.length} />

      <FlashBanner notice={sp.notice} error={sp.error} />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <MetricCard
          label="Messaging Wallet Balance"
          value={formatInr(ctx.walletBalancePaise, { showDecimals: true })}
          sublabel={`Includes ${formatInr(WALLET_OVERDRAFT_LIMIT_PAISE)} overdraft floor (${formatInr(MIN_WALLET_BALANCE_PAISE)})`}
          accent={ctx.isOverdraftExhausted ? "ruby" : ctx.walletBalancePaise < 0 ? "amber" : "emerald"}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Available Messaging Credit"
          value={formatInr(ctx.walletAvailableSpendPaise, { showDecimals: true })}
          sublabel={
            ctx.pendingRechargeCount > 0
              ? `${ctx.pendingRechargeCount} top-up(s) pending verification`
              : "For WhatsApp templates, broadcasts & smart review drafts"
          }
          accent="sky"
        />
        <MetricCard
          label="Managed Ad Spend Vault"
          value={formatInr(ctx.adVault.availablePaise, { showDecimals: true })}
          sublabel="0-overdraft hard cutoff for Managed Meta & Google Ads"
          accent="sky"
          icon={<Megaphone className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1.35fr]">
        <SectionCard
          title="Recharge Prepaid Messaging Wallet"
          subtitle="Pay via UPI or IMPS/NEFT and enter your 12-digit UTR reference, or pay online via Razorpay"
        >
          {!ctx.canManageBilling ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Read-only view - ask Business Owner or Accounts &amp; Billing manager to submit a
              wallet recharge.
            </p>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-inset)] p-4 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold tracking-wider text-[var(--ink-muted)] uppercase">
                      {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                        ? "UPI ID (VPA)"
                        : "Beneficiary"}
                    </div>
                    <div className="truncate font-semibold text-[var(--ink)] select-all">
                      {billingSettings.upiQrMode === "upi_id" && billingSettings.upiId
                        ? billingSettings.upiId
                        : billingSettings.payeeName}
                    </div>
                    <div className="text-[11px] text-[var(--ink-muted)]">
                      {billingSettings.payeeName}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold tracking-wider text-[var(--ink-muted)] uppercase">
                      Bank Account &amp; IFSC
                    </div>
                    <div className="truncate font-mono font-bold text-[var(--ink)] select-all">
                      A/C {billingSettings.accountNumber}
                    </div>
                    <div className="truncate text-[11px] text-[var(--ink-muted)]">
                      IFSC <span className="font-mono font-semibold">{billingSettings.ifscCode}</span> •{" "}
                      {billingSettings.bankName}
                    </div>
                  </div>
                </div>
              </div>

              {billingSettings.upiId && (
                <a
                  href={`upi://pay?pa=${encodeURIComponent(billingSettings.upiId).replace(/%40/g, "@")}&pn=${encodeURIComponent(billingSettings.payeeName || "RapidShift Labs")}&cu=INR`}
                  className="rsl-btn-secondary inline-flex items-center gap-2 text-xs"
                >
                  <QrCode className="h-4 w-4 text-[var(--brand)]" />
                  <span>Open UPI Payment App →</span>
                </a>
              )}

              <form action={submitRechargeRequestAction} className="space-y-4">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <div>
                    <label htmlFor="wallet-recharge-rupees" className="rsl-label">
                      Amount (₹ INR)
                    </label>
                    <input
                      id="wallet-recharge-rupees"
                      name="amountRupees"
                      type="number"
                      min="100"
                      step="1"
                      defaultValue="2500"
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="wallet-payment-method" className="rsl-label">
                      Payment Method
                    </label>
                    <select
                      id="wallet-payment-method"
                      name="paymentMethod"
                      defaultValue="upi"
                      className="rsl-input"
                    >
                      <option value="upi">UPI Payment</option>
                      <option value="bank_transfer">Bank Transfer (NEFT / IMPS)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="wallet-utr-ref" className="rsl-label">
                      UTR / Reference # *
                    </label>
                    <input
                      id="wallet-utr-ref"
                      name="utrOrReference"
                      required
                      minLength={4}
                      placeholder="12-digit UPI UTR"
                      className="rsl-input font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
                  <span className="text-[11px] text-[var(--ink-muted)]">
                    Prepaid deposits carry an Advance Receipt Voucher (ADV/...).
                  </span>
                  <SubmitButton pendingText="Submitting..." className="rsl-btn-primary">
                    Submit Recharge UTR
                  </SubmitButton>
                </div>
              </form>

              {ctx.razorpayReady && (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <RazorpayCheckoutButton
                    purpose="wallet_topup"
                    defaultRupees={2500}
                    minRupees={100}
                    buttonLabel="Pay Online Now (Razorpay)"
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Wallet Passbook"
          subtitle="Immutable ledger of credits and metered message deductions"
          noPadding
        >
          {ctx.ledger.length === 0 ? (
            <div className="p-6 text-[13px] text-[var(--ink-muted)]">
              No wallet transactions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Description &amp; Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-5 py-3 text-right sm:px-6">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {ctx.ledger.map((entry) => (
                    <tr key={entry.id} className="hover:bg-[var(--surface-inset)]/60">
                      <td className="px-5 py-3 sm:px-6">
                        <div className="font-medium text-[var(--ink)]">{entry.description}</div>
                        <div className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {new Date(entry.createdAt).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-[var(--ink-secondary)]">
                        {entry.entryType.replace("_", " ")}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold tabular-nums sm:px-6 ${
                          entry.amountPaise >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {entry.amountPaise >= 0 ? "+" : ""}
                        {formatInr(entry.amountPaise, { showDecimals: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1.35fr]">
        <SectionCard
          title="Managed Ad Spend Vault (0-Overdraft)"
          subtitle="Optional budget pool for Meta & Google Ads in Managed Mode (Direct Ad Accounts need ₹0)"
        >
          {!ctx.canManageBilling ? (
            <p className="text-xs text-[var(--ink-muted)]">
              Read-only view - ask Business Owner or Billing Manager to fund Ad Spend Vault.
            </p>
          ) : (
            <div className="space-y-4 text-xs">
              <form action={submitAdSpendRechargeRequestAction} className="space-y-4">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                  <div>
                    <label htmlFor="ad-vault-rupees" className="rsl-label">
                      Ad Deposit (₹, min ₹500)
                    </label>
                    <input
                      id="ad-vault-rupees"
                      name="amountRupees"
                      type="number"
                      min="500"
                      step="100"
                      defaultValue="5000"
                      required
                      className="rsl-input tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="ad-vault-method" className="rsl-label">
                      Payment Method
                    </label>
                    <select
                      id="ad-vault-method"
                      name="paymentMethod"
                      defaultValue="upi"
                      className="rsl-input"
                    >
                      <option value="upi">UPI Payment</option>
                      <option value="bank_transfer">Bank Transfer (NEFT / IMPS)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ad-vault-utr" className="rsl-label">
                      UTR / Reference # *
                    </label>
                    <input
                      id="ad-vault-utr"
                      name="utrOrReference"
                      required
                      minLength={4}
                      placeholder="12-digit UPI UTR"
                      className="rsl-input font-mono"
                    />
                  </div>
                </div>
                <SubmitButton pendingText="Submitting..." className="rsl-btn-primary">
                  Submit Ad Vault UTR
                </SubmitButton>
              </form>

              {ctx.razorpayReady && (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <RazorpayCheckoutButton
                    purpose="ad_spend_topup"
                    defaultRupees={5000}
                    minRupees={500}
                    buttonLabel="Deposit Ad Funds Online"
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Ad Spend Vault Ledger"
          subtitle="Deposits, campaign allocations, and unspent releases"
          action={
            <ActionLink href="/meta/facebook/ads" spinnerSize="xs" className="rsl-btn-secondary text-xs">
              Open Ads Studio →
            </ActionLink>
          }
          noPadding
        >
          {ctx.adVault.recentEntries.length === 0 ? (
            <div className="p-6 text-[13px] text-[var(--ink-muted)]">
              No Managed Ad Spend Vault transactions yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 sm:px-6">Description</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-5 py-3 text-right sm:px-6">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
                  {ctx.adVault.recentEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-[var(--surface-inset)]/60">
                      <td className="px-5 py-3 sm:px-6">
                        <div className="font-medium text-[var(--ink)]">{entry.description}</div>
                        <div className="text-xs text-[var(--ink-muted)] tabular-nums">
                          {new Date(entry.createdAt).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-[var(--ink-secondary)]">
                        {entry.entryType.replace(/_/g, " ")}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold tabular-nums sm:px-6 ${
                          entry.amountPaise >= 0 ? "text-[var(--success)]" : "text-[var(--info)]"
                        }`}
                      >
                        {entry.amountPaise >= 0 ? "+" : ""}
                        {formatInr(entry.amountPaise, { showDecimals: true })}
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
