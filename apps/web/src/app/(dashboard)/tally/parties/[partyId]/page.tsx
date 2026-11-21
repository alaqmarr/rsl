import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { formatInr } from "@rsl/core";
import { formatRoleLabel } from "@rsl/rbac";
import { AccessRestrictedState, SectionCard } from "@rsl/ui";
import { FeaturePlanGate } from "@/components/feature-plan-gate";
import { ActionLink } from "@/components/ios-feedback";
import { PartyDetailShell } from "@/components/party-detail-shell";
import { formatPartyShortDate, loadPartyDetailContext } from "@/lib/party-detail-data";

export default async function TallyPartyStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ partyId }, sp] = await Promise.all([params, searchParams]);

  if (
    sp.tab === "bills" ||
    sp.tab === "items" ||
    sp.tab === "record" ||
    sp.tab === "edit"
  ) {
    const qs = new URLSearchParams();
    if (sp.notice) qs.set("notice", sp.notice);
    if (sp.error) qs.set("error", sp.error);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/tally/parties/${encodeURIComponent(partyId)}/${sp.tab}${suffix}`);
  }

  const ctx = await loadPartyDetailContext(partyId);

  if (ctx.status === "restricted") {
    return (
      <AccessRestrictedState
        pageTitle="Party Ledger Statement"
        roleLabel={formatRoleLabel(ctx.session.roleSlug)}
        requiredPermissionLabel="View Tally bills & aging"
        homeHref="/inbox"
        homeLabel="Go to Customer Messages"
      />
    );
  }

  if (ctx.status === "locked") {
    return (
      <FeaturePlanGate
        pageTitle="Client & Supplier Ledger Statement"
        pageSubtitle="Unlock All-in-One Tally Prime Sync to inspect chronological party running balances, bill-wise settlements, and downloadable PDF statements."
        plans={ctx.plans}
        returnPath={`/tally/parties/${encodeURIComponent(partyId)}`}
        notice={sp.notice}
        error={sp.error}
      />
    );
  }

  const { session, detail, tallyOverview, canManageTally } = ctx;
  const { totals } = detail;

  return (
    <PartyDetailShell
      activeSection="statement"
      workspaceName={session.workspace.name}
      canManageTally={canManageTally}
      tallyCounts={{
        vouchersCount: tallyOverview.vouchers.length,
        partiesCount: tallyOverview.totals.partiesCount,
        stockItemsCount: tallyOverview.totals.stockItemsCount,
      }}
      detail={detail}
      notice={sp.notice}
      error={sp.error}
    >
      <SectionCard
        title="Chronological Party Ledger Statement (Tally T-Account Format)"
        subtitle="Every Sales, Receipt, Payment, Credit Note, Debit Note, and Purchase entry in chronological order with live Dr/Cr running balance"
        noPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-inset)] text-[11px] font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
              <tr>
                <th className="px-6 py-3">Date</th>
                <th className="px-4 py-3">Particulars &amp; Settlement Ref</th>
                <th className="px-4 py-3">Vch Type</th>
                <th className="px-4 py-3">Vch No.</th>
                <th className="px-4 py-3 text-right">Debit (Dr)</th>
                <th className="px-4 py-3 text-right">Credit (Cr)</th>
                <th className="px-6 py-3 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]">
              {detail.statementRows.map((row) => {
                const isOpening = row.id === "opening_balance";
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-[var(--surface-inset)] ${
                      row.isCancelled ? "opacity-60" : isOpening ? "bg-[var(--surface-inset)]/60" : ""
                    }`}
                  >
                    <td className="px-6 py-3.5 whitespace-nowrap text-[var(--ink-secondary)] tabular-nums">
                      {formatPartyShortDate(row.date)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div
                        className={`font-semibold ${
                          row.isCancelled ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"
                        }`}
                      >
                        {row.particulars}
                      </div>
                      {row.settlementSummary && (
                        <div className="mt-0.5 text-[11px] font-medium text-emerald-700">
                          {row.settlementSummary}
                        </div>
                      )}
                      {row.narration && (
                        <div className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{row.narration}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-md border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--ink)]">
                        {row.voucherType}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono font-bold">
                      {row.voucherId ? (
                        <ActionLink
                          href={`/tally/vouchers/${encodeURIComponent(row.voucherId)}`}
                          spinnerSize="xs"
                          className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                        >
                          <span>#{row.voucherNumber}</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </ActionLink>
                      ) : (
                        <span className="text-[var(--ink-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-medium text-[var(--ink)] tabular-nums">
                      {row.debitPaise > 0 ? formatInr(row.debitPaise) : "-"}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-emerald-700 tabular-nums">
                      {row.creditPaise > 0 ? formatInr(row.creditPaise) : "-"}
                    </td>
                    <td className="px-6 py-3.5 text-right font-extrabold text-[var(--ink)] tabular-nums">
                      {row.runningBalancePaise > 0 ? (
                        <>
                          {formatInr(row.runningBalancePaise)}{" "}
                          <span
                            className={`text-[11px] font-bold ${
                              row.runningDrCr === "Dr" ? "text-amber-700" : "text-sky-700"
                            }`}
                          >
                            {row.runningDrCr}
                          </span>
                        </>
                      ) : (
                        <span className="text-emerald-700">Nil</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-[var(--border)] bg-[var(--surface-inset)] text-xs font-bold text-[var(--ink)]">
              <tr>
                <td colSpan={4} className="px-6 py-3.5 text-right uppercase">
                  Closing Ledger Totals
                </td>
                <td className="px-4 py-3.5 text-right tabular-nums">
                  {formatInr(totals.totalDebitsPaise)}
                </td>
                <td className="px-4 py-3.5 text-right text-emerald-700 tabular-nums">
                  {formatInr(totals.totalCreditsPaise)}
                </td>
                <td className="px-6 py-3.5 text-right tabular-nums">
                  {totals.closingAbsPaise === 0
                    ? "₹0 (Settled)"
                    : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>
    </PartyDetailShell>
  );
}
