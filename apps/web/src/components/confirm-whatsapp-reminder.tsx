"use client";

import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, X } from "lucide-react";
import { useDialogFocusTrap } from "@rsl/ui";
import { SubmitButton } from "@/components/ios-feedback";

export interface ConfirmWhatsAppReminderButtonProps {
  voucherId: string;
  voucherNumber: string;
  partyName: string;
  partyPhoneE164: string;
  balanceFormatted: string;
  action: (formData: FormData) => void;
  returnPath?: string;
  buttonLabel?: string;
  buttonClassName?: string;
}

export function ConfirmWhatsAppReminderButton({
  voucherId,
  voucherNumber,
  partyName,
  partyPhoneE164,
  balanceFormatted,
  action,
  returnPath,
  buttonLabel = "Send Reminder",
  buttonClassName = "rsl-btn-secondary min-h-9 px-3 py-1.5 text-[11px]",
}: ConfirmWhatsAppReminderButtonProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocusTrap(dialogRef, open, () => setOpen(false));

  const titleId = `wa-rem-title-${voucherId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClassName}
      >
        {buttonLabel}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 id={titleId} className="text-sm font-bold text-slate-900">
                      Confirm WhatsApp Payment Reminder
                    </h2>
                    <p className="text-[11.5px] text-zinc-600">
                      Review recipient and balance before sending
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close confirmation dialog"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-zinc-200/85 bg-zinc-50/80 p-3">
                  <div>
                    <div className="text-[10.5px] font-semibold tracking-wider text-zinc-500 uppercase">
                      Customer / Party
                    </div>
                    <div className="mt-0.5 font-semibold text-slate-900">{partyName}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold tracking-wider text-zinc-500 uppercase">
                      WhatsApp Recipient
                    </div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900">
                      {partyPhoneE164}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold tracking-wider text-zinc-500 uppercase">
                      Tally Bill #
                    </div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900">
                      #{voucherNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold tracking-wider text-zinc-500 uppercase">
                      Balance Due
                    </div>
                    <div className="mt-0.5 font-bold text-rose-700 tabular-nums">
                      {balanceFormatted}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-200/80 bg-zinc-100 p-3">
                  <div className="text-[10.5px] font-bold tracking-wider text-zinc-600 uppercase">
                    Message Preview
                  </div>
                  <p className="mt-1 rounded-lg bg-white p-2.5 text-[12px] leading-relaxed text-slate-800 shadow-2xs">
                    Namaste {partyName}, this is a gentle payment reminder for Invoice #{voucherNumber}{" "}
                    with pending balance {balanceFormatted}. Kindly share payment confirmation once
                    remitted.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rsl-btn-secondary min-h-10 px-3.5 py-2 text-xs"
                >
                  Cancel
                </button>
                <form
                  action={action}
                  onSubmit={() => {
                    setOpen(false);
                  }}
                >
                  <input type="hidden" name="voucherId" value={voucherId} />
                  <input type="hidden" name="sendKind" value="reminder" />
                  {returnPath && <input type="hidden" name="returnPath" value={returnPath} />}
                  <SubmitButton
                    data-autofocus="true"
                    className="rsl-btn-primary min-h-10 px-4 py-2 text-xs"
                    spinnerSize="xs"
                    pendingText="Sending..."
                  >
                    Confirm &amp; Send WhatsApp
                  </SubmitButton>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
