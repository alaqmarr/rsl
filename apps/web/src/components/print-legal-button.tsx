"use client";

import React from "react";
import { Printer } from "lucide-react";

export function PrintLegalButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rsl-btn-secondary inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
    >
      <Printer className="h-3.5 w-3.5" />
      <span>Print / Save PDF</span>
    </button>
  );
}
