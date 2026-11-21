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

export function AiAdCopywriterCard({
  defaultPlatform = "meta",
  initialOffer = "",
  onOfferChange,
}: {
  defaultPlatform?: "meta" | "google";
  initialOffer?: string;
  onOfferChange?: (offer: string) => void;
}) {
  const [offer, setOffer] = useState(initialOffer);
  const [platform, setPlatform] = useState<"meta" | "google">(defaultPlatform);
  const [busy, setBusy] = useState(false);
  const [adDraft, setAdDraft] = useState<{
    headline: string;
    primaryText: string;
    description: string;
    provider: string;
  } | null>(null);

  React.useEffect(() => {
    if (initialOffer) {
      setOffer(initialOffer);
    }
  }, [initialOffer]);

  async function handleGenerateCopy() {
    if (!offer.trim()) {
      sileo.error({
        title: "Enter Product or Offer",
        description: "Type what you are promoting first.",
      });
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
        sileo.error({
          title: "Could Not Generate Copy",
          description: res.message || "Try again.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--brand)]" />
          <span className="font-bold text-[var(--ink)]">
            1-Click AI Ad Copywriter (INR / India SMB)
          </span>
        </div>
        <StatusPill label="Free AI" tone="emerald" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={offer}
          onChange={(e) => {
            setOffer(e.target.value);
            onOfferChange?.(e.target.value);
          }}
          placeholder="e.g. Wholesale TMT Steel Bars - Same-day dispatch"
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
          {busy ? <IosSpinner size="xs" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>Generate Copy</span>
        </button>
      </div>

      {adDraft && (
        <div className="space-y-2 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand-surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-[var(--ink)]">Headline: {adDraft.headline}</span>
              <StatusPill
                label={
                  adDraft.provider === "cloudflare_workers_ai"
                    ? "Cloudflare Workers AI"
                    : "Local Starter Draft"
                }
                tone={adDraft.provider === "cloudflare_workers_ai" ? "emerald" : "amber"}
                showDot={false}
              />
            </div>
            <CopyTextButton text={adDraft.headline} label="Copy Headline" copiedLabel="Copied" />
          </div>
          <p className="text-[var(--ink-secondary)]">{adDraft.primaryText}</p>
          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[var(--ink-muted)]">
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
  );
}

export function GoogleSearchConsoleCard({
  gscConnected,
  gscSiteUrl,
  gscTotals,
  gscQueries,
  oauthReturnTo = "/google/search",
  onSelectQuery,
}: {
  gscConnected: boolean;
  gscSiteUrl: string | null;
  gscTotals: { clicks: number; impressions: number; ctrPct: number; avgPosition: number };
  gscQueries: GscQueryItem[];
  oauthReturnTo?: string;
  onSelectQuery?: (query: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[var(--info)]" />
          <span className="font-bold text-[var(--ink)]">
            Google Search Console - Free Organic Keywords (28d)
          </span>
        </div>
        {gscConnected ? (
          <StatusPill label={gscSiteUrl || "Connected"} tone="emerald" />
        ) : (
          <a
            href={`/api/oauth/google/start?purpose=google_search_console&returnTo=${encodeURIComponent(oauthReturnTo)}`}
            className="rsl-btn-secondary py-1 text-[11px] font-semibold"
          >
            Connect Search Console (1-Click)
          </a>
        )}
      </div>

      {gscConnected ? (
        gscQueries.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3 text-[11px] text-[var(--ink-secondary)]">
              <span>
                Clicks: <strong className="text-[var(--ink)]">{gscTotals.clicks}</strong>
              </span>
              <span>
                Impressions: <strong className="text-[var(--ink)]">{gscTotals.impressions}</strong>
              </span>
              <span>
                CTR: <strong className="text-[var(--ink)]">{gscTotals.ctrPct}%</strong>
              </span>
              <span>
                Avg Rank: <strong className="text-[var(--ink)]">#{gscTotals.avgPosition}</strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {gscQueries.slice(0, 8).map((q) => (
                <button
                  key={q.query}
                  type="button"
                  onClick={() => onSelectQuery?.(q.query)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-1 text-[11px] transition-colors hover:border-[var(--brand)]"
                  title="Click to draft an ad for this search query"
                >
                  <span className="font-semibold text-[var(--ink)]">{q.query}</span>{" "}
                  <span className="text-[var(--ink-muted)]">
                    ({q.clicks} clicks • #{q.avgPosition})
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] text-[var(--ink-muted)]">
            Connected ({gscSiteUrl || "verified"}). Organic keyword impressions will appear here as
            Google indexes your site.
          </p>
        )
      ) : (
        <p className="text-[11.5px] text-[var(--ink-muted)]">
          Connect Google Search Console free to discover which exact keywords bring organic buyers
          to your website - and turn top queries into high-ROAS ads in 1 click.
        </p>
      )}
    </div>
  );
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
  const [selectedQuery, setSelectedQuery] = useState("");
  return (
    <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
      <AiAdCopywriterCard defaultPlatform="meta" initialOffer={selectedQuery} />
      <GoogleSearchConsoleCard
        gscConnected={gscConnected}
        gscSiteUrl={gscSiteUrl}
        gscTotals={gscTotals}
        gscQueries={gscQueries}
        oauthReturnTo="/google/search"
        onSelectQuery={setSelectedQuery}
      />
    </div>
  );
}
