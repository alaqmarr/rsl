"use client";

import React, { useState } from "react";
import { IosSpinner } from "@/components/ios-feedback";

const ENDPOINT_PRESETS = [
  {
    label: "POST /api/v1/tally/bill-event — Push Tally Bill & Send Automated WhatsApp",
    method: "POST",
    path: "/api/v1/tally/bill-event",
    sampleBody: JSON.stringify(
      {
        companyName: "RSL Management",
        voucherNumber: "GST/26-27/0109",
        voucherType: "Sales",
        partyName: "Shree Ganesh Traders",
        partyPhone: "+919820000000",
        amountRupees: 18450,
        voucherDate: "2026-11-01",
      },
      null,
      2
    ),
  },
  {
    label: "POST /api/v1/whatsapp/send-template — Send WhatsApp Template Message",
    method: "POST",
    path: "/api/v1/whatsapp/send-template",
    sampleBody: JSON.stringify(
      {
        templateName: "tally_sales_bill_created",
        recipientPhone: "+919820000000",
        recipientName: "Shree Ganesh Traders",
        variables: {
          "1": "Shree Ganesh Traders",
          "2": "GST/26-27/0109",
          "3": "₹18,450",
          "4": "15 Nov 2026",
        },
      },
      null,
      2
    ),
  },
  {
    label: "GET /api/v1/whatsapp/templates — List Saved WhatsApp Templates",
    method: "GET",
    path: "/api/v1/whatsapp/templates",
    sampleBody: "",
  },
  {
    label: "GET /api/v1/vouchers — List Synced Tally Bills & Totals",
    method: "GET",
    path: "/api/v1/vouchers",
    sampleBody: "",
  },
  {
    label: "GET /api/v1/analytics — Business Cashflow, Messages & Receivables KPIs",
    method: "GET",
    path: "/api/v1/analytics?range=30d",
    sampleBody: "",
  },
  {
    label: "GET /api/v1/contacts — List Customer Contacts",
    method: "GET",
    path: "/api/v1/contacts",
    sampleBody: "",
  },
];

export function ApiSandbox({ initialKey }: { initialKey?: string }) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [apiKey, setApiKey] = useState(initialKey || "");
  const [body, setBody] = useState(ENDPOINT_PRESETS[0]!.sampleBody);
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);
  const [responseBody, setResponseBody] = useState<string>("");

  const preset = ENDPOINT_PRESETS[selectedIdx]!;

  const handleSelectEndpoint = (idx: number) => {
    setSelectedIdx(idx);
    setBody(ENDPOINT_PRESETS[idx]!.sampleBody);
    setResponseStatus(null);
    setResponseBody("");
  };

  const runLiveRequest = async () => {
    setLoading(true);
    setResponseStatus(null);
    try {
      const res = await fetch(preset.path, {
        method: preset.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(preset.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(preset.method === "POST" && body.trim() ? { body } : {}),
      });
      setResponseStatus(`HTTP ${res.status}`);
      const txt = await res.text();
      try {
        setResponseBody(JSON.stringify(JSON.parse(txt), null, 2));
      } catch {
        setResponseBody(txt);
      }
    } catch (err) {
      setResponseStatus("Network Error");
      setResponseBody(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-[13px]">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div>
          <label className="rsl-label">API Endpoint</label>
          <select
            value={selectedIdx}
            onChange={(e) => handleSelectEndpoint(Number(e.target.value))}
            className="rsl-input"
          >
            {ENDPOINT_PRESETS.map((ep, idx) => (
              <option key={ep.path} value={idx}>
                {ep.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rsl-label">Your API Key (Bearer Token)</label>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste rsl_live_... or rsl_test_... key here"
            className="rsl-input font-mono"
          />
        </div>
      </div>

      {preset.method === "POST" && (
        <div>
          <label className="rsl-label">JSON Request Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            className="rsl-input font-mono text-xs"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12.5px] text-zinc-500">
          Sends a live authenticated call to{" "}
          <code className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs text-slate-800">
            {preset.path}
          </code>
        </span>
        <button
          type="button"
          onClick={runLiveRequest}
          disabled={loading || !apiKey.trim()}
          className="rsl-btn-primary disabled:opacity-50"
        >
          {loading && <IosSpinner size="xs" />}
          <span>{loading ? "Sending Request..." : `Send ${preset.method} Request`}</span>
        </button>
      </div>

      {responseStatus && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-4 text-slate-100">
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2 text-xs">
            <span className="font-semibold text-emerald-400">Live API Response</span>
            <span className="font-mono font-semibold text-slate-200">{responseStatus}</span>
          </div>
          <pre className="max-h-64 overflow-auto font-mono text-xs leading-relaxed text-slate-200">
            {responseBody}
          </pre>
        </div>
      )}
    </div>
  );
}
