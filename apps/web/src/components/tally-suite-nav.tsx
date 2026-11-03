import React from "react";
import { FileSpreadsheet, Package, Users } from "lucide-react";
import { ActionLink } from "@/components/ios-feedback";

export interface TallySuiteNavProps {
  activeSection: "vouchers" | "parties" | "inventory";
  vouchersCount?: number;
  partiesCount?: number;
  stockItemsCount?: number;
}

export function TallySuiteNav({
  activeSection,
  vouchersCount,
  partiesCount,
  stockItemsCount,
}: TallySuiteNavProps) {
  const items = [
    {
      key: "vouchers" as const,
      href: "/tally",
      label: "Vouchers, Receipts & Sync",
      count: vouchersCount,
      icon: FileSpreadsheet,
    },
    {
      key: "parties" as const,
      href: "/tally/parties",
      label: "Client & Supplier Ledgers",
      count: partiesCount,
      icon: Users,
    },
    {
      key: "inventory" as const,
      href: "/inventory",
      label: "Stock & Godown Inventory",
      count: stockItemsCount,
      icon: Package,
    },
  ];

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/90 bg-white px-3 py-2 shadow-2xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="hidden rounded-lg bg-emerald-50 px-2.5 py-1 text-[10.5px] font-bold tracking-wider text-emerald-800 uppercase ring-1 ring-emerald-200/80 sm:inline-flex">
          All-in-One Tally Suite
        </span>
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.key;
          return (
            <ActionLink
              key={item.key}
              href={item.href}
              spinnerSize="xs"
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100/80 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? "text-emerald-300" : "text-zinc-500"}`} />
              <span>{item.label}</span>
              {typeof item.count === "number" && (
                <span
                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums ${
                    active ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </ActionLink>
          );
        })}
      </div>

      <div className="hidden items-center gap-2 text-[11px] text-zinc-500 xl:flex">
        <span>Auto Paid-in-Tally Settlements</span>
        <span className="text-zinc-300">•</span>
        <span>Running Balance Statements</span>
        <span className="text-zinc-300">•</span>
        <span>Live Stock &amp; Ageing</span>
      </div>
    </div>
  );
}
