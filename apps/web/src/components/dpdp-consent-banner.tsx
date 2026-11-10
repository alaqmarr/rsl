"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

const CONSENT_STORAGE_KEY = "rsl_dpdp_cookie_consent_v1";

export function DpdpConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!saved) {
        setVisible(true);
      }
    } catch {
      // Ignore storage access restrictions in private browsing
    }
  }, []);

  const acknowledge = (choice: "essential_only" | "accepted") => {
    try {
      window.localStorage.setItem(
        CONSENT_STORAGE_KEY,
        JSON.stringify({ choice, recordedAt: new Date().toISOString() })
      );
    } catch {
      // Ignore storage restrictions
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside
      role="region"
      aria-label="Cookie and DPDP Act 2023 privacy notice"
      className="no-print rsl-drawer-frost fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-3xl rounded-2xl border p-4 sm:px-5 sm:py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="text-xs leading-relaxed text-slate-700">
            <span className="font-bold text-slate-900">
              DPDP Act 2023 &amp; Essential Cookies Notice:
            </span>{" "}
            We use strictly necessary first-party cookies (<code className="font-mono">rsl_session</code>,{" "}
            <code className="font-mono">rsl_locale</code>) for secure sign-in, CSRF protection, and
            language preference - never third-party ad trackers. Review our{" "}
            <Link
              href="/privacy"
              className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800"
            >
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link
              href="/cookies"
              className="font-semibold text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800"
            >
              Cookie Policy
            </Link>
            .
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            onClick={() => acknowledge("essential_only")}
            className="rsl-btn-secondary px-3 py-1.5 text-xs"
          >
            Essential Only
          </button>
          <button
            type="button"
            onClick={() => acknowledge("accepted")}
            className="rsl-btn-primary px-3.5 py-1.5 text-xs"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </aside>
  );
}
