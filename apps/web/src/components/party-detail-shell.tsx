import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  MessageSquareShare,
  Pencil,
  Wallet,
} from "lucide-react";
import { formatInr } from "@rsl/core";
import { MetricCard, PageHeader, StatusPill } from "@rsl/ui";
import { FlashBanner } from "@/components/flash-banner";
import { ActionLink } from "@/components/ios-feedback";
import { TallySuiteNav } from "@/components/tally-suite-nav";

export type PartySectionKey = "statement" | "bills" | "items" | "record" | "edit";

export function PartyDetailShell({
  activeSection,
  workspaceName,
  canManageTally,
  tallyCounts,
  detail,
  notice,
  error,
  children,
}: {
  activeSection: PartySectionKey;
  workspaceName: string;
  canManageTally: boolean;
  tallyCounts: { vouchersCount: number; partiesCount: number; stockItemsCount: number };
  detail: {
    companyName: string;
    financialYearFrom: string;
    isCreditor: boolean;
    party: {
      id: string;
      name: string;
      parentGroup: string;
      gstin: string | null;
      phoneE164: string | null;
      email: string | null;
      stateName: string | null;
      address: string | null;
      creditDays: number;
      creditLimitPaise: number;
      openingBalancePaise: number;
      closingBalancePaise: number;
    };
    totals: {
      closingAbsPaise: number;
      closingSignedPaise: number;
      closingDrCr: string;
      totalDebitsPaise: number;
      totalCreditsPaise: number;
    };
    statementRows: Array<unknown>;
    allBills: Array<unknown>;
    openBills: Array<unknown>;
    settledBills: Array<unknown>;
    itemHistory: Array<unknown>;
  };
  notice?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const { party, totals } = detail;
  const selfPath = `/tally/parties/${encodeURIComponent(party.id)}`;
  const creditLimitBreached =
    party.creditLimitPaise > 0 && party.closingBalancePaise > party.creditLimitPaise;

  const waStatementMessage = encodeURIComponent(
    `Namaste ${party.name},\n\nAccount Summary with ${workspaceName} (${detail.companyName}):\n• Closing Balance: ${formatInr(totals.closingAbsPaise)}${totals.closingDrCr !== "Nil" ? ` (${totals.closingDrCr})` : ""}\n• Open Bills: ${detail.openBills.length}\n\nThank you for your business.`
  );
  const waShareHref = party.phoneE164
    ? `https://wa.me/${party.phoneE164.replace(/\D/g, "")}?text=${waStatementMessage}`
    : null;

  const navSections: Array<{ key: PartySectionKey; href: string; label: string }> = [
    {
      key: "statement",
      href: selfPath,
      label: `Running Balance Statement (${detail.statementRows.length})`,
    },
    {
      key: "bills",
      href: `${selfPath}/bills`,
      label: `Bill-Wise Paid & Pending (${detail.allBills.length})`,
    },
    {
      key: "items",
      href: `${selfPath}/items`,
      label: `Item Purchase History (${detail.itemHistory.length})`,
    },
    ...(canManageTally
      ? [
          {
            key: "record" as const,
            href: `${selfPath}/record`,
            label: detail.isCreditor ? "+ Record Payment / Bill" : "+ Record Receipt / Bill",
          },
          {
            key: "edit" as const,
            href: `${selfPath}/edit`,
            label: "Edit Party Details",
          },
        ]
      : []),
  ];

  return (
    <div className="w-full space-y-6">
      <TallySuiteNav
        activeSection="parties"
        vouchersCount={tallyCounts.vouchersCount}
        partiesCount={tallyCounts.partiesCount}
        stockItemsCount={tallyCounts.stockItemsCount}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-secondary)]">
        <ActionLink
          href="/tally/parties"
          spinnerSize="xs"
          className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Client &amp; Supplier Ledgers</span>
        </ActionLink>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-medium text-[var(--ink)]">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{detail.companyName}</span>
          </span>
          {party.gstin && (
            <span className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono font-semibold text-[var(--ink)]">
              GSTIN: {party.gstin}
            </span>
          )}
        </div>
      </div>

      <PageHeader
        eyebrow={`${party.parentGroup} • Tally Ledger Statement`}
        badge={
          <StatusPill
            label={
              totals.closingAbsPaise === 0
                ? "Account Settled"
                : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`
            }
            tone={
              creditLimitBreached
                ? "ruby"
                : totals.closingSignedPaise > 0
                  ? "amber"
                  : "emerald"
            }
          />
        }
        title={party.name}
        subtitle={[
          party.phoneE164 ? `WhatsApp: ${party.phoneE164}` : "No WhatsApp mobile saved",
          party.email ? `Email: ${party.email}` : null,
          party.stateName ? `State: ${party.stateName}` : null,
          `Credit Terms: ${party.creditDays} days${
            party.creditLimitPaise > 0 ? ` • Limit: ${formatInr(party.creditLimitPaise)}` : ""
          }`,
        ]
          .filter(Boolean)
          .join("  •  ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/pdf/party-ledger?partyId=${encodeURIComponent(party.id)}`}
              className="rsl-btn-primary"
            >
              <Download className="mr-1.5 inline h-3.5 w-3.5" />
              Download Statement PDF
            </a>
            <a
              href={`/api/pdf/party-ledger?partyId=${encodeURIComponent(party.id)}&inline=1`}
              target="_blank"
              rel="noreferrer"
              className="rsl-btn-secondary"
            >
              <FileText className="mr-1.5 inline h-3.5 w-3.5" />
              Preview PDF
            </a>
            {waShareHref && (
              <a
                href={waShareHref}
                target="_blank"
                rel="noreferrer"
                className="rsl-btn-secondary"
              >
                <MessageSquareShare className="mr-1.5 inline h-3.5 w-3.5 text-emerald-600" />
                Share Balance on WhatsApp
              </a>
            )}
            {canManageTally && activeSection !== "edit" && (
              <ActionLink href={`${selfPath}/edit`} spinnerSize="xs" className="rsl-btn-secondary">
                <Pencil className="mr-1 inline h-3.5 w-3.5" />
                Edit Profile
              </ActionLink>
            )}
          </div>
        }
      />

      <FlashBanner notice={notice} error={error} />

      {creditLimitBreached && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/85 px-5 py-3.5 text-xs text-rose-950">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>
              <strong>Credit Limit Breach Alert:</strong> Closing receivable balance (
              <strong>{formatInr(totals.closingAbsPaise)} Dr</strong>) exceeds this party&rsquo;s
              configured Tally credit limit of <strong>{formatInr(party.creditLimitPaise)}</strong>{" "}
              by{" "}
              <strong>
                {formatInr(Math.max(0, party.closingBalancePaise - party.creditLimitPaise))}
              </strong>
              .
            </span>
          </div>
          {canManageTally && activeSection !== "record" && (
            <ActionLink href={`${selfPath}/record`} spinnerSize="xs" className="rsl-btn-secondary text-xs">
              Record Payment Receipt
            </ActionLink>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Opening Balance"
          value={`${formatInr(Math.abs(party.openingBalancePaise))}${
            party.openingBalancePaise > 0
              ? " Dr"
              : party.openingBalancePaise < 0
                ? " Cr"
                : ""
          }`}
          sublabel={`FY starting ${detail.financialYearFrom}`}
          icon={<FileSpreadsheet className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Debits (Dr)"
          value={formatInr(totals.totalDebitsPaise)}
          sublabel="Sales bills, supplier payments & debit notes"
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <MetricCard
          label="Total Credits (Cr)"
          value={formatInr(totals.totalCreditsPaise)}
          sublabel="Receipts, credit notes & purchase bills"
          accent="emerald"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          label="Closing Running Balance"
          value={
            totals.closingAbsPaise === 0
              ? "₹0 (Settled)"
              : `${formatInr(totals.closingAbsPaise)} ${totals.closingDrCr}`
          }
          sublabel={`${detail.openBills.length} open bill(s) • ${detail.settledBills.length} paid bill(s)`}
          accent={
            creditLimitBreached
              ? "ruby"
              : totals.closingSignedPaise > 0
                ? "amber"
                : "emerald"
          }
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <nav
        aria-label="Party Ledger Pages"
        className="rsl-frost-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-2"
      >
        <div className="rsl-tab-bar">
          {navSections.map((t) => {
            const active = activeSection === t.key;
            return (
              <ActionLink
                key={t.key}
                href={t.href}
                spinnerSize="xs"
                className={`rsl-tab-pill ${active ? "rsl-tab-pill-active" : ""}`}
              >
                {t.label}
              </ActionLink>
            );
          })}
        </div>
        {party.address && (
          <div className="px-3 text-[11px] text-[var(--ink-muted)]">Address: {party.address}</div>
        )}
      </nav>

      {children}
    </div>
  );
}
