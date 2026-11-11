import React from "react";
import { Building2, FileSpreadsheet, Package, Users } from "lucide-react";
import { GuideDrawerButton } from "@rsl/ui";
import { ActionLink } from "@/components/ios-feedback";
import { buildTallySuiteGuideContent } from "@/lib/tally-guide-drawer";

export interface TallySuiteCompanyOption {
  id: string;
  name: string;
  lastSyncedAt?: number | null;
}

export interface TallySuiteNavProps {
  activeSection: "vouchers" | "parties" | "inventory";
  vouchersCount?: number;
  partiesCount?: number;
  stockItemsCount?: number;
  companies?: TallySuiteCompanyOption[];
  selectedCompanyId?: string;
}

export function TallySuiteNav({
  activeSection,
  vouchersCount,
  partiesCount,
  stockItemsCount,
  companies = [],
  selectedCompanyId = "all",
}: TallySuiteNavProps) {
  const companyQuery =
    selectedCompanyId && selectedCompanyId !== "all"
      ? `?company=${encodeURIComponent(selectedCompanyId)}`
      : "";

  const baseSectionPath =
    activeSection === "parties"
      ? "/tally/parties"
      : activeSection === "inventory"
        ? "/inventory"
        : "/tally";

  const items = [
    {
      key: "vouchers" as const,
      href: `/tally${companyQuery}`,
      label: "Vouchers, Receipts & Sync",
      count: vouchersCount,
      icon: FileSpreadsheet,
    },
    {
      key: "parties" as const,
      href: `/tally/parties${companyQuery}`,
      label: "Client & Supplier Ledgers",
      count: partiesCount,
      icon: Users,
    },
    {
      key: "inventory" as const,
      href: `/inventory${companyQuery}`,
      label: "Stock & Godown Inventory",
      count: stockItemsCount,
      icon: Package,
    },
  ];

  return (
    <div className="rsl-frost-card w-full overflow-hidden rounded-2xl">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rsl-eyebrow mr-1.5 hidden sm:inline-flex">
            <span>Tally Suite</span>
          </span>
          <div className="rsl-tab-bar">
            {items.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.key;
              return (
                <ActionLink
                  key={item.key}
                  href={item.href}
                  spinnerSize="xs"
                  className={`rsl-tab-pill ${active ? "rsl-tab-pill-active" : ""}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                  {typeof item.count === "number" && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums ${
                        active
                          ? "bg-[var(--surface-inset)] text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </ActionLink>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
          <GuideDrawerButton
            drawerId="tally-suite-guide"
            label="Need help?"
            badgeText="Tally Guide"
            guide={buildTallySuiteGuideContent()}
          />
        </div>
      </div>

      {companies.length >= 1 && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ink-secondary)]">
              <Building2 className="h-3.5 w-3.5 text-emerald-700" />
              <span>Company:</span>
            </span>
            <ActionLink
              href={baseSectionPath}
              spinnerSize="xs"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                selectedCompanyId === "all"
                  ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-2xs"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              }`}
            >
              <span>All ({companies.length})</span>
            </ActionLink>
            {companies.map((c) => {
              const isSelected = selectedCompanyId === c.id;
              return (
                <ActionLink
                  key={c.id}
                  href={`${baseSectionPath}?company=${encodeURIComponent(c.id)}`}
                  spinnerSize="xs"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    isSelected
                      ? "bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-2xs"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSelected
                        ? "bg-[var(--sunset-orange)]"
                        : c.lastSyncedAt
                          ? "bg-emerald-500"
                          : "bg-zinc-400"
                    }`}
                  />
                  <span>{c.name}</span>
                </ActionLink>
              );
            })}
          </div>
          <span className="font-mono text-xs text-[var(--ink-muted)]">
            {companies.length} {companies.length === 1 ? "company synced" : "companies synced"}
          </span>
        </div>
      )}
    </div>
  );
}
