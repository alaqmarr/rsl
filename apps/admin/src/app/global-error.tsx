"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[rsl-admin] GlobalError:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="rsl-ambient-canvas flex min-h-screen items-center justify-center p-6 font-sans text-slate-900 antialiased">
        <div className="rsl-frost-card max-w-md rounded-2xl p-7">
          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
            Staff Portal Issue
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
            Could not load this staff view
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
            This error has been logged automatically. Reload the view or return to Operations
            Overview.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-[11px] text-zinc-400">Ref: {error.digest}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => reset()} className="adm-btn-primary">
              Reload View
            </button>
            <a href="/" className="adm-btn-secondary">
              Operations Overview
            </a>
            <a href="/login" className="text-xs font-medium text-zinc-500 hover:text-slate-900">
              Sign In Page
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
