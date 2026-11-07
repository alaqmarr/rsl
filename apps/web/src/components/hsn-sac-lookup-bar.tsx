"use client";

import React, { useState } from "react";
import { Search } from "lucide-react";
import { IosSpinner, sileo } from "@rsl/ui";

interface HsnItem {
  code: string;
  kind: "HSN" | "SAC";
  description: string;
  gstRateBps: number;
  defaultUom: string;
}

export function HsnSacLookupBar() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<HsnItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSearch(nextVal: string) {
    setQuery(nextVal);
    if (nextVal.trim().length < 2) {
      setItems([]);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/tools/lookup?kind=hsn&q=${encodeURIComponent(nextVal.trim())}&limit=8`
      );
      const json = (await res.json()) as { ok: boolean; items?: HsnItem[] };
      if (json.ok && json.items) {
        setItems(json.items);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-emerald-700" />
          <span className="font-bold text-slate-900">
            Free CBIC HSN &amp; SAC Code + GST Rate Finder
          </span>
        </div>
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search HSN/SAC or item (e.g. steel, cement, pharma, SaaS, cotton)..."
            className="rsl-input py-1.5 text-xs"
          />
          {busy && (
            <span className="absolute right-3 top-2">
              <IosSpinner size="xs" />
            </span>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((it) => {
            const gstPct = (it.gstRateBps / 100).toFixed(0);
            return (
              <button
                key={it.code}
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(it.code);
                  sileo.success({
                    title: `Copied ${it.kind} ${it.code}`,
                    description: `GST ${gstPct}% • Default UOM: ${it.defaultUom}`,
                    duration: 3000,
                  });
                }}
                className="flex flex-col items-start justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50/40"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-mono font-bold text-slate-900">
                    {it.kind} {it.code}
                  </span>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 text-[10px]">
                    {gstPct}% GST • {it.defaultUom}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{it.description}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
