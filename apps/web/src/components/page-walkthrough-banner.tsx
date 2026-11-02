"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { resolveWebPageGuide } from "@/lib/page-guides";

export function PageWalkthroughBanner() {
  const pathname = usePathname();
  const [openByRoute, setOpenByRoute] = useState<Record<string, boolean>>({});

  const guide = resolveWebPageGuide(pathname || "/");
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
                Step-by-Step Guide
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 tabular-nums">
                <Clock className="h-3 w-3 text-zinc-400" />
                {guide.steps.length} detailed steps • {guide.estimatedTime}
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
            <span>{isOpen ? "Hide Detailed Steps" : "Show Step-by-Step Instructions"}</span>
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <Link
            href={`/help?slug=${encodeURIComponent(guide.guideSlug)}`}
            className="hidden items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:inline-flex"
          >
            <span>Full Guide →</span>
          </Link>
        </div>
      </div>

      {isOpen && (
        <div className="space-y-4 border-t border-emerald-100 px-4 py-4 text-xs sm:px-5 sm:py-5">
          <p className="leading-relaxed text-zinc-600">{guide.summary}</p>

          {guide.prerequisites.length > 0 && (
            <div className="rounded-xl border border-zinc-200/85 bg-zinc-50/80 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-slate-800 uppercase">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>Before You Begin (Prerequisites)</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-zinc-700">
                {guide.prerequisites.map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
              Minute-by-Minute Instructions ({guide.steps.length} Steps)
            </div>
            <ol className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              {guide.steps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex gap-3 rounded-xl border border-zinc-200/85 bg-zinc-50/45 p-3.5"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-slate-900">{step.title}</div>
                    <p className="leading-relaxed text-zinc-600">{step.detail}</p>
                    {step.tip && (
                      <p className="rounded-lg border border-emerald-200/75 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] font-medium text-emerald-900">
                        Tip: {step.tip}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {guide.commonMistakes.length > 0 && (
            <div className="rounded-xl border border-amber-200/85 bg-amber-50/60 p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>Common Mistakes to Avoid</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-amber-950/90">
                {guide.commonMistakes.map((m, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
            <span className="text-[11px] text-zinc-500">
              Need screenshots, code samples, or troubleshooting tables?
            </span>
            <Link
              href={`/help?slug=${encodeURIComponent(guide.guideSlug)}`}
              className="font-semibold text-emerald-700 hover:underline"
            >
              Open Full Detailed Article in Guides &amp; Help →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
