"use client";

import React, { useState } from "react";
import { Globe, Sparkles } from "lucide-react";
import { IosSpinner, sileo, StatusPill } from "@rsl/ui";
import { CopyTextButton } from "@/components/client-utils";
import { generateSmartAdCopyJsonAction } from "@/lib/actions";

export interface GscQueryItem {
  query: string;
  clicks: number;
  impressions: number;
  ctrPct: number;
  avgPosition: number;
}

export function CampaignsFreeAiBar({
  gscConnected,
  gscSiteUrl,
  gscTotals,
  gscQueries,
}: {
  gscConnected: boolean;
  gscSiteUrl: string | null;
  gscTotals: { clicks: number; impressions: number; ctrPct: number; avgPosition: number };
  gscQueries: GscQueryItem[];
}) {
  const [offer, setOffer] = useState("");
  const [platform, setPlatform] = useState<"meta" | "google">("meta");
  const [busy, setBusy] = useState(false);
  const [adDraft, setAdDraft] = useState<{
    headline: string;
    primaryText: string;
    description: string;
    provider: string;
  } | null>(null);

  async function handleGenerateCopy() {
    if (!offer.trim()) {
      sileo.error({ title: "Enter Product or Offer", description: "Type what you are promoting first." });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("productOrOffer", offer.trim());
      fd.set("platform", platform);
      const res = await generateSmartAdCopyJsonAction(fd);
      if (res.ok && res.headline && res.primaryText) {
        setAdDraft({
          headline: res.headline,
          primaryText: res.primaryText,
          description: res.description || "",
          provider: res.provider || "cloudflare_workers_ai",
        });
      } else {
        sileo.error({ title: "Could Not Generate Copy", description: res.message || "Try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
      {/* 1. Free Cloudflare Workers AI Ad Copywriter */}
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-700" />
            <span className="font-bold text-slate-900">1-Click AI Ad Copywriter (INR / India SMB)</span>
          </div>
          <StatusPill label="Free AI" tone="emerald" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="e.g. Wholesale TMT Steel Bars — Same-day dispatch"
            className="rsl-input flex-1 py-1.5 text-xs"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "meta" | "google")}
            className="rsl-input py-1.5 text-xs"
          >
            <option value="meta">Meta Ads</option>
            <option value="google">Google Search</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={handleGenerateCopy}
            className="rsl-btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs"
          >
            {busy ? <IosSpinner size="xs" className="text-white" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Generate Copy</span>
          </button>
        </div>

        {adDraft && (
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">Headline: {adDraft.headline}</span>
              <CopyTextButton text={adDraft.headline} label="Copy Headline" copiedLabel="Copied" />
            </div>
            <p className="text-slate-700">{adDraft.primaryText}</p>
            <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-500">
              <span>{adDraft.description}</span>
              <CopyTextButton
                text={`${adDraft.headline}\n\n${adDraft.primaryText}`}
                label="Copy Full Ad"
                copiedLabel="Copied"
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Free Google Search Console Organic Keyword Insights */}
      <div className="rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-700" />
            <span className="font-bold text-slate-900">
              Google Search Console — Free Organic Keywords (28d)
            </span>
          </div>
          {gscConnected ? (
            <StatusPill label={gscSiteUrl || "Connected"} tone="emerald" />
          ) : (
            <a
              href="/api/oauth/google/start?purpose=google_search_console&returnTo=/campaigns"
              className="rsl-btn-secondary py-1 text-[11px] font-semibold"
            >
              Connect Search Console (1-Click)
            </a>
          )}
        </div>

        {gscConnected ? (
          gscQueries.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-[11px] text-zinc-600">
                <span>
                  Clicks: <strong className="text-slate-900">{gscTotals.clicks}</strong>
                </span>
                <span>
                  Impressions: <strong className="text-slate-900">{gscTotals.impressions}</strong>
                </span>
                <span>
                  CTR: <strong className="text-slate-900">{gscTotals.ctrPct}%</strong>
                </span>
                <span>
                  Avg Rank: <strong className="text-slate-900">#{gscTotals.avgPosition}</strong>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {gscQueries.slice(0, 6).map((q) => (
                  <button
                    key={q.query}
                    type="button"
                    onClick={() => setOffer(q.query)}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] hover:border-emerald-300"
                    title="Click to write an ad for this search query"
                  >
                    <span className="font-semibold text-slate-900">{q.query}</span>{" "}
                    <span className="text-zinc-500">({q.clicks} clicks • #{q.avgPosition})</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] text-zinc-500">
              Connected ({gscSiteUrl || "verified"}). Organic keyword impressions will appear here as Google indexes your site.
            </p>
          )
        ) : (
          <p className="text-[11.5px] text-zinc-500">
            Connect Google Search Console free to discover which exact keywords bring organic buyers to your website — and turn top queries into high-ROAS ads in 1 click.
          </p>
        )}
      </div>
    </div>
  );
}
