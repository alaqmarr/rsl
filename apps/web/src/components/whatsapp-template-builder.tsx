"use client";

import React, { useMemo, useState } from "react";
import { TALLY_TEMPLATE_VARIABLE_FIELDS } from "@rsl/whatsapp/client-constants";
import { SubmitButton } from "@/components/ios-feedback";

export function WhatsAppTemplateBuilder({
  action,
  wabaConnected,
}: {
  action: (formData: FormData) => void;
  wabaConnected: boolean;
}) {
  const [name, setName] = useState("tally_sales_invoice");
  const [category, setCategory] = useState<"utility" | "marketing" | "authentication">("utility");
  const [language, setLanguage] = useState("en_IN");
  const [headerType, setHeaderType] = useState<"NONE" | "TEXT" | "DOCUMENT">("TEXT");
  const [headerText, setHeaderText] = useState("New Tax Invoice Generated");
  const [bodyText, setBodyText] = useState(
    "Namaste {{1}}, your invoice #{{2}} for {{3}} has been generated. Payment due date is {{4}}. Thank you for your business!"
  );
  const [footerText, setFooterText] = useState("Reply STOP to opt out of updates");
  const [button1Type, setButton1Type] = useState<"QUICK_REPLY" | "URL" | "PHONE_NUMBER">(
    "QUICK_REPLY"
  );
  const [button1Text, setButton1Text] = useState("Confirm Receipt");
  const [button1Target, setButton1Target] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({
    "1": "partyName",
    "2": "voucherNumber",
    "3": "amountFormatted",
    "4": "dueDateFormatted",
  });

  const detectedVars = useMemo(() => {
    const nums = new Set<number>();
    for (const src of [headerType === "TEXT" ? headerText : "", bodyText]) {
      for (const m of src.matchAll(/\{\{(\d+)\}\}/g)) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 6) nums.add(n);
      }
    }
    return Array.from(nums).sort((a, b) => a - b);
  }, [headerType, headerText, bodyText]);

  const sampleLookup = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of TALLY_TEMPLATE_VARIABLE_FIELDS) {
      out[f.key] = f.sample;
    }
    return out;
  }, []);

  const replacePreviewVars = (txt: string) =>
    txt.replace(/\{\{(\d+)\}\}/g, (_all, slot: string) => {
      const key = mappings[slot];
      return (key && sampleLookup[key]) || `[Value ${slot}]`;
    });

  const insertPlaceholder = (n: number) => {
    setBodyText((prev) => `${prev}${prev.endsWith(" ") ? "" : " "}{{${n}}}`);
  };

  return (
    <form action={action} className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.9fr]">
      <div className="space-y-4 text-[13px]">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div>
            <label htmlFor="wa-tpl-name" className="rsl-label">
              Template Name *
            </label>
            <input
              id="wa-tpl-name"
              name="name"
              value={name}
              onChange={(e) =>
                setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))
              }
              required
              placeholder="tally_sales_invoice"
              className="rsl-input min-h-10 font-mono"
            />
          </div>
          <div>
            <label htmlFor="wa-tpl-category" className="rsl-label">
              Message Category
            </label>
            <select
              id="wa-tpl-category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="rsl-input min-h-10"
            >
              <option value="utility">Billing / Order Update (₹0.85)</option>
              <option value="marketing">Promotional / Offer (₹0.95)</option>
              <option value="authentication">One-Time Passcode (OTP)</option>
            </select>
          </div>
          <div>
            <label htmlFor="wa-tpl-language" className="rsl-label">
              Language
            </label>
            <select
              id="wa-tpl-language"
              name="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rsl-input min-h-10"
            >
              <option value="en_IN">English (India)</option>
              <option value="en_US">English (Global)</option>
              <option value="hi">Hindi (हिन्दी)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[200px_1fr]">
          <div>
            <label htmlFor="wa-tpl-header-type" className="rsl-label">
              Header Style
            </label>
            <select
              id="wa-tpl-header-type"
              name="headerType"
              value={headerType}
              onChange={(e) => setHeaderType(e.target.value as typeof headerType)}
              className="rsl-input min-h-10"
            >
              <option value="NONE">No Header</option>
              <option value="TEXT">Bold Text Header</option>
              <option value="DOCUMENT">PDF Bill Attachment</option>
            </select>
          </div>
          {headerType === "TEXT" ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor="wa-tpl-header-text" className="text-xs font-semibold text-slate-700">
                  Header Headline
                </label>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    headerText.length >= 55 ? "font-semibold text-amber-700" : "text-zinc-500"
                  }`}
                >
                  {headerText.length}/60
                </span>
              </div>
              <input
                id="wa-tpl-header-text"
                name="headerText"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                maxLength={60}
                placeholder="New Tax Invoice Generated"
                className="rsl-input min-h-10"
              />
            </div>
          ) : (
            <div className="flex items-end">
              <div className="flex min-h-10 w-full items-center rounded-xl border border-zinc-200/90 bg-zinc-50 px-3.5 py-2 text-[12px] text-zinc-600">
                {headerType === "DOCUMENT"
                  ? "Allows attaching an Invoice PDF link when sending from Tally."
                  : "Message starts directly with the body text below."}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="wa-tpl-body" className="text-xs font-semibold text-slate-700">
                Message Body *
              </label>
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  bodyText.length >= 960 ? "font-semibold text-amber-700" : "text-zinc-500"
                }`}
              >
                ({bodyText.length}/1024)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-zinc-500">Insert placeholder:</span>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => insertPlaceholder(n)}
                  className="min-h-7 rounded-md border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                  {`+ {{${n}}}`}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="wa-tpl-body"
            name="bodyText"
            rows={4}
            maxLength={1024}
            required
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            className="rsl-input"
          />
        </div>

        {detectedVars.length > 0 && (
          <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/75 p-4">
            <div className="mb-2.5 text-xs font-semibold text-slate-900">
              Auto-Fill Placeholders When Sent from Tally Bills
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {detectedVars.map((slotNum) => {
                const keyStr = String(slotNum);
                return (
                  <div key={slotNum} className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white font-mono text-xs font-semibold text-emerald-700">
                      {`{{${slotNum}}}`}
                    </span>
                    <select
                      name={`varMap_${slotNum}`}
                      value={mappings[keyStr] || "partyName"}
                      onChange={(e) =>
                        setMappings((prev) => ({ ...prev, [keyStr]: e.target.value }))
                      }
                      aria-label={`Mapping for placeholder ${slotNum}`}
                      className="rsl-input"
                    >
                      {TALLY_TEMPLATE_VARIABLE_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label} ({f.sample})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="wa-tpl-footer-text" className="rsl-label">
                Footer Note (Optional)
              </label>
              <span
                className={`text-[11px] font-medium tabular-nums ${
                  footerText.length >= 54 ? "text-amber-700" : "text-zinc-500"
                }`}
              >
                {footerText.length}/60
              </span>
            </div>
            <input
              id="wa-tpl-footer-text"
              name="footerText"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              maxLength={60}
              placeholder="Reply STOP to opt out"
              className="rsl-input"
            />
          </div>
          <div>
            <label htmlFor="wa-tpl-btn1-type" className="rsl-label">
              Action Button
            </label>
            <select
              id="wa-tpl-btn1-type"
              name="button1Type"
              value={button1Type}
              onChange={(e) => setButton1Type(e.target.value as typeof button1Type)}
              className="rsl-input"
            >
              <option value="QUICK_REPLY">Quick Reply Button</option>
              <option value="URL">Website / Payment Link</option>
              <option value="PHONE_NUMBER">Call Office Phone</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="wa-tpl-btn1-text" className="rsl-label">
                Button Label (Optional)
              </label>
              <span
                className={`text-[11px] font-medium tabular-nums ${
                  button1Text.length >= 22 ? "text-amber-700" : "text-zinc-500"
                }`}
              >
                {button1Text.length}/25
              </span>
            </div>
            <input
              id="wa-tpl-btn1-text"
              name="button1Text"
              value={button1Text}
              onChange={(e) => setButton1Text(e.target.value)}
              maxLength={25}
              placeholder="e.g. Confirm Receipt"
              className="rsl-input"
            />
          </div>
        </div>

        {(button1Type === "URL" || button1Type === "PHONE_NUMBER") && button1Text && (
          <div>
            <label htmlFor="wa-tpl-btn1-target" className="rsl-label">
              {button1Type === "URL" ? "Button Website URL" : "Office Phone Number (+91...)"}
            </label>
            <input
              id="wa-tpl-btn1-target"
              name="button1Target"
              value={button1Target}
              onChange={(e) => setButton1Target(e.target.value)}
              placeholder={button1Type === "URL" ? "https://yourbusiness.in/pay" : "+919820000000"}
              className="rsl-input"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-[12.5px] text-zinc-500">
            {wabaConnected
              ? "Connected to WhatsApp Cloud API — saving submits directly to Meta for approval. Wallet is charged strictly after confirmed message delivery (₹0 on error)."
              : "Saved as a Draft until your WhatsApp Business Account is connected and Meta approves the template."}
          </span>
          <SubmitButton pendingText="Saving Template..." className="rsl-btn-primary">
            Save WhatsApp Template
          </SubmitButton>
        </div>
      </div>

      {/* Live WhatsApp Phone Bubble Preview */}
      <div className="flex flex-col justify-between rounded-2xl border border-zinc-200/90 bg-zinc-100/75 p-5">
        <div>
          <div className="mb-3.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-zinc-600 uppercase">
              Live Customer Phone Preview
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
              Sample Tally Bill Values
            </span>
          </div>

          <div className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-md">
            <div className="bg-[#075E54] px-4 py-3 text-white">
              <div className="text-[13px] font-semibold">Your Business (Official WhatsApp)</div>
              <div className="text-[11px] text-white/80">Verified Business Account</div>
            </div>

            <div className="bg-[#EFEAE2] p-4">
              <div className="rounded-xl rounded-tl-none bg-white p-3.5 text-[13px] text-slate-900 shadow-xs">
                {headerType === "DOCUMENT" && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-slate-700">
                    <span>📄</span>
                    <span>Invoice_GST_26-27_0108.pdf</span>
                  </div>
                )}
                {headerType === "TEXT" && headerText.trim() && (
                  <div className="mb-1.5 text-[13.5px] font-semibold text-slate-900">
                    {replacePreviewVars(headerText)}
                  </div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                  {replacePreviewVars(bodyText)}
                </div>
                {footerText.trim() && (
                  <div className="mt-2 text-[11px] text-zinc-500">{footerText}</div>
                )}
                <div className="mt-1 text-right text-[10.5px] text-zinc-400 tabular-nums">
                  10:42 AM ✓✓
                </div>

                {button1Text.trim() && (
                  <div className="mt-2.5 border-t border-zinc-100 pt-2 text-center text-[13px] font-semibold text-[#008069]">
                    {button1Text}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-zinc-500">
          Placeholders like <code className="font-mono font-semibold text-slate-700">{"{{1}}"}</code>{" "}
          are automatically filled with each customer&apos;s real bill details when Tally saves an
          invoice.
        </p>
      </div>
    </form>
  );
}
