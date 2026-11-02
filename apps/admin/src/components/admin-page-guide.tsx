"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { resolveAdminPageGuide } from "@/lib/nav-routes";

export function AdminPageWalkthroughBanner() {
  const pathname = usePathname();
  const [openByRoute, setOpenByRoute] = useState<Record<string, boolean>>({});

  const guide = resolveAdminPageGuide(pathname || "/");
  if (!guide) return null;

  const isOpen = Boolean(openByRoute[guide.routePrefix]);
  const toggleOpen = () =>
    setOpenByRoute((prev) => ({
      ...prev,
      [guide.routePrefix]: !prev[guide.routePrefix],
    }));

  return (
    <div className="no-print mb-5 overflow-hidden rounded-2xl border border-emerald-200/85 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50/45 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-2xs sm:mt-0">
            <BookOpen className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-emerald-900 uppercase">
                Staff Screen Guide
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                {guide.steps.length} SOP steps • {guide.roleNote}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900">
              {guide.title}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={isOpen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/90 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs transition hover:bg-emerald-50"
          >
            <span>{isOpen ? "Hide SOP Steps" : "Show Step-by-Step SOP"}</span>
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <Link
            href="/runbooks"
            className="hidden items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:inline-flex"
          >
            <span>All Staff Guides →</span>
          </Link>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-4 border-t border-emerald-100 px-4 py-4 text-xs sm:px-5 sm:py-5">
          <p className="leading-relaxed text-zinc-600">{guide.summary}</p>

          <ol className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {guide.steps.map((step, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/50 p-3.5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white tabular-nums">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-semibold text-slate-900">{step.title}</div>
                  <p className="leading-relaxed text-zinc-600">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {guide.cautions.length > 0 && (
            <div className="rounded-xl border border-amber-200/85 bg-amber-50/60 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>Important Finance &amp; Security Check</span>
              </div>
              <ul className="mt-1.5 space-y-1 text-amber-950/90">
                {guide.cautions.map((c, idx) => (
                  <li key={idx} className="leading-relaxed">
                    • {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
