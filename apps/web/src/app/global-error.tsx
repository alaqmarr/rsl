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
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="rsl-ambient-canvas flex min-h-screen items-center justify-center p-6 font-sans text-slate-900 antialiased">
        <div className="rsl-frost-card max-w-md rounded-2xl p-7">
          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
            Unexpected Issue
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
            Something interrupted this page
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
            Our team has been notified automatically so we can fix this quickly. Your business
            records and wallet balance are completely safe.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-[11.5px] text-zinc-500">Reference: {error.digest}</p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button onClick={() => reset()} className="rsl-btn-primary">
              Try Again
            </button>
            <a href="/" className="rsl-btn-secondary">
              Back to Overview
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
