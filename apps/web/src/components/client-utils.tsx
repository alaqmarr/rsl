"use client";

import { useState } from "react";
import { sileo } from "@rsl/ui";
import { SubmitButton } from "./ios-feedback";

export function PrintInvoiceButton({ className = "rsl-btn-primary" }: { className?: string }) {
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
  className = "rsl-btn-secondary text-xs",
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

export function InboxReplyComposer({
  conversationId,
  action,
  cannedReplies,
}: {
  conversationId: string;
  action: (formData: FormData) => Promise<void>;
  cannedReplies: Array<{ id: string; shortcut: string; title: string; body: string }>;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      action={async (fd) => {
        await action(fd);
        setBody("");
      }}
      className="space-y-3"
    >
      <input type="hidden" name="conversationId" value={conversationId} />

      {cannedReplies.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            Quick Replies — Click to Insert
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cannedReplies.map((cr) => (
              <button
                key={cr.id}
                type="button"
                onClick={() => setBody(cr.body)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50/60"
                title={cr.body}
              >
                <span className="font-mono text-[11px] text-emerald-700">/{cr.shortcut}</span>
                <span>{cr.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="rsl-label">Reply Message *</label>
        <textarea
          name="body"
          rows={2}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your reply to the customer..."
          className="rsl-input"
        />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="rsl-label">Approved Template Name (if 24h window closed)</label>
          <input
            name="templateName"
            placeholder="e.g. tally_sales_bill_created"
            className="rsl-input font-mono"
          />
        </div>
        <SubmitButton pendingText="Sending..." className="rsl-btn-primary">
          Send Reply
        </SubmitButton>
      </div>
    </form>
  );
}
