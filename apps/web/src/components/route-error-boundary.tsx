"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function RouteErrorBoundaryCard({
  error,
  reset,
  sectionLabel = "Workspace Screen",
  fallbackHref = "/",
  fallbackLabel = "Back to Business Overview",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  sectionLabel?: string;
  fallbackHref?: string;
  fallbackLabel?: string;
}) {
  useEffect(() => {
    console.error(`[rsl/web:${sectionLabel}] route boundary caught error`, error);
  }, [error, sectionLabel]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mx-auto my-10 w-full max-w-xl rounded-2xl border border-rose-200/90 bg-white p-6 shadow-xs sm:p-8"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800">
        <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        <span>{sectionLabel} - Temporary Error</span>
      </div>

      <h2 className="mt-4 text-lg font-bold tracking-tight text-slate-900">
        Something prevented this screen from loading cleanly
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-zinc-600">
        Your business records, Tally Prime vouchers, and prepaid wallet balance remain untouched.
        Try reloading this view, or return to your overview while our error monitor logs the trace.
      </p>

      {error.digest && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-700">
          <span className="font-semibold text-slate-900">Reference ID:</span>{" "}
          <code className="font-mono text-xs">{error.digest}</code>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rsl-btn-primary inline-flex items-center gap-2 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Try Again</span>
        </button>
        <Link href={fallbackHref} className="rsl-btn-secondary text-xs">
          {fallbackLabel}
        </Link>
        <a
          href="mailto:app@rapidshiftlabs.in"
          className="text-xs font-semibold text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-slate-900"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
