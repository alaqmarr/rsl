"use client";

import { useState } from "react";
import { sileo } from "@rsl/ui";

export function PrintInvoiceButton({ className = "adm-btn-primary" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.print();
        }
      }}
      className={className}
    >
      Print / Save PDF
    </button>
  );
}

export function CopyTextButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  className = "adm-btn-secondary text-xs",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          sileo.success({ title: copiedLabel === "Copied" ? "Copied to clipboard" : copiedLabel });
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Ignore clipboard errors in non-secure contexts
        }
      }}
      className={className}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
