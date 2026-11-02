"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function ConsoleSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[rsl-admin] ConsoleSegmentError:", error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto my-8 max-w-lg rounded-2xl border border-zinc-200 bg-white p-7 shadow-xs">
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
        Staff View Error
      </span>
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-slate-900">
        Could not load this staff view
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-600">
        This error has been logged automatically. Reload the view or choose another section from the
        sidebar.
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
      </div>
    </div>
  );
}
