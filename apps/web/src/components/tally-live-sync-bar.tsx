"use client";

import React, { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Cpu } from "lucide-react";
import { IosSpinner, openGuideDrawerById, sileo, StatusPill } from "@rsl/ui";
import { syncLocalTallyPort9000JsonAction } from "@/lib/actions";

export interface TallyLiveSyncBarProps {
  workspaceName?: string;
  vouchersCount: number;
  eventsReceivedCount: number;
  lastEventAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  lastUserAgent: string | null;
  latestVoucherUpdatedAt?: number;
  nativePdfCount?: number;
  outdatedTdl: {
    isOutdated: boolean;
    detectedVersion: string | null;
    latestVersion: string;
  };
  isLocalDev: boolean;
  canManageTally: boolean;
  localPortProbe: {
    reachable: boolean;
    port: number;
    activeCompanyName: string | null;
    voucherCount: number;
  } | null;
}

function buildBarTdlFilename(workspaceName?: string): string {
  const slug = (workspaceName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${slug || "business"}-rsl-sync.tdl`;
}

function buildBarBrandTitle(workspaceName?: string): string {
  const cleaned = (workspaceName || "")
    .replace(/["'\r\n\t:;[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 38)
    .trim();
  if (!cleaned) return "Business & RSL Sync";
  if (/\brsl\s*sync\b/i.test(cleaned)) return cleaned;
  return `${cleaned} & RSL Sync`;
}

export function TallyLiveSyncBar({
  workspaceName,
  vouchersCount,
  eventsReceivedCount,
  lastEventAt,
  lastErrorAt,
  lastErrorMessage,
  latestVoucherUpdatedAt = 0,
  nativePdfCount = 0,
  outdatedTdl,
  isLocalDev,
  canManageTally,
  localPortProbe,
}: TallyLiveSyncBarProps) {
  const tdlFilename = buildBarTdlFilename(workspaceName);
  const tallyBrandTitle = buildBarBrandTitle(workspaceName);
  const router = useRouter();
  const [isFetchingLocal, startFetchLocal] = useTransition();

  const stateRef = useRef({
    vouchersCount,
    eventsReceivedCount,
    lastEventAt: lastEventAt ?? 0,
    lastErrorAt: lastErrorAt ?? 0,
    latestVoucherUpdatedAt,
    nativePdfCount,
  });

  useEffect(() => {
    stateRef.current = {
      vouchersCount,
      eventsReceivedCount,
      lastEventAt: lastEventAt ?? 0,
      lastErrorAt: lastErrorAt ?? 0,
      latestVoucherUpdatedAt,
      nativePdfCount,
    };
  }, [
    vouchersCount,
    eventsReceivedCount,
    lastEventAt,
    lastErrorAt,
    latestVoucherUpdatedAt,
    nativePdfCount,
  ]);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/tally/live-state", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          vouchersCount?: number;
          eventsReceivedCount?: number;
          lastEventAt?: number | null;
          lastErrorAt?: number | null;
          lastErrorMessage?: string | null;
          latestVoucherUpdatedAt?: number;
          nativePdfCount?: number;
        };
        if (!data.ok || cancelled) return;

        const nextVouchers = data.vouchersCount ?? stateRef.current.vouchersCount;
        const nextEvents = data.eventsReceivedCount ?? stateRef.current.eventsReceivedCount;
        const nextEventAt = data.lastEventAt ?? 0;
        const nextErrorAt = data.lastErrorAt ?? 0;
        const nextUpdatedAt = data.latestVoucherUpdatedAt ?? stateRef.current.latestVoucherUpdatedAt;
        const nextPdfCount = data.nativePdfCount ?? stateRef.current.nativePdfCount;

        if (
          nextVouchers !== stateRef.current.vouchersCount ||
          nextEvents > stateRef.current.eventsReceivedCount ||
          nextEventAt > stateRef.current.lastEventAt ||
          nextUpdatedAt > stateRef.current.latestVoucherUpdatedAt ||
          nextPdfCount > stateRef.current.nativePdfCount
        ) {
          stateRef.current = {
            vouchersCount: nextVouchers,
            eventsReceivedCount: nextEvents,
            lastEventAt: nextEventAt,
            lastErrorAt: nextErrorAt,
            latestVoucherUpdatedAt: nextUpdatedAt,
            nativePdfCount: nextPdfCount,
          };
          sileo.success({
            title: "Tally Prime Synced Live",
            description: "New, updated, or deleted Tally bill reflected automatically in your portal.",
            duration: 4500,
          });
          router.refresh();
          return;
        }

        if (nextErrorAt > stateRef.current.lastErrorAt) {
          stateRef.current.lastErrorAt = nextErrorAt;
          sileo.error({
            title: "Tally Prime Push Needs Attention",
            description:
              data.lastErrorMessage ||
              "Tally Prime sent an incomplete request. Check the diagnostic banner above.",
            duration: 6000,
          });
          router.refresh();
        }
      } catch {
        // Ignore transient network hiccups while polling
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [router]);

  function handleFetchLocalPort9000() {
    startFetchLocal(async () => {
      const res = await syncLocalTallyPort9000JsonAction(localPortProbe?.port ?? 9000);
      if (res.ok) {
        sileo.success({
          title:
            (res.upserted ?? 0) > 0
              ? `Fetched ${res.upserted} Bill(s) from Tally Prime`
              : "Tally Prime Checked",
          description: res.message,
          duration: 5500,
        });
        router.refresh();
      } else {
        sileo.error({
          title: "Could Not Fetch from Local Tally",
          description: res.message,
          duration: 5500,
        });
      }
    });
  }

  const hasRecentUnresolvedError =
    Boolean(lastErrorMessage) && (lastErrorAt ?? 0) > (lastEventAt ?? 0);
  const showOutdatedOrErrorBanner = outdatedTdl.isOutdated || hasRecentUnresolvedError;
  const tdlHref = isLocalDev ? "/api/export/tally-tdl?target=local" : "/api/export/tally-tdl";

  return (
    <div className="space-y-3">
      {/* 1. Outdated .TDL or Recent Delivery Error Diagnostic Banner */}
      {showOutdatedOrErrorBanner && (
        <div className="rsl-frost-card rounded-2xl border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-700">
                <AlertTriangle width={18} height={18} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    {outdatedTdl.isOutdated
                      ? `Tally Prime Add-On Update Available (v${outdatedTdl.detectedVersion} → v${outdatedTdl.latestVersion})`
                      : "Last Tally Prime Push Did Not Include a Complete Bill"}
                  </span>
                  <StatusPill label="Setup Fix Available" tone="amber" showDot={false} />
                </div>

                <p className="leading-relaxed text-amber-900">
                  {outdatedTdl.isOutdated
                    ? `Download ${tdlFilename} (v${outdatedTdl.latestVersion}) and reload Tally memory so "${tallyBrandTitle}" syncs Sales, Receipts, Ledgers, and Products live.`
                    : `Diagnostic detail: ${lastErrorMessage}`}
                </p>
              </div>
            </div>

            {canManageTally && (
              <div className="flex flex-wrap items-center gap-2">
                {localPortProbe?.reachable && (
                  <button
                    type="button"
                    disabled={isFetchingLocal}
                    onClick={handleFetchLocalPort9000}
                    className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
                  >
                    {isFetchingLocal && <IosSpinner size="xs" />}
                    <span>
                      {isFetchingLocal
                        ? "Fetching from Tally..."
                        : `Fetch Bills from Tally Now${
                            localPortProbe.voucherCount > 0
                              ? ` (${localPortProbe.voucherCount})`
                              : ""
                          }`}
                    </span>
                  </button>
                )}
                <a href={tdlHref} className="rsl-btn-secondary text-xs">
                  Download {tdlFilename} (v{outdatedTdl.latestVersion})
                </a>
                <button
                  type="button"
                  onClick={() => openGuideDrawerById("tally-suite-guide", "tdl")}
                  className="rsl-guide-trigger text-xs"
                >
                  Need help? • Reload Steps
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Live Local Tally Prime Port 9000 Direct Pull Bar */}
      {isLocalDev && localPortProbe?.reachable && (
        <div className="rsl-frost-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3.5 text-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700">
              <Cpu width={17} height={17} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">
                  Local Tally Prime Detected on Port {localPortProbe.port}
                </span>
                <StatusPill
                  label={
                    localPortProbe.activeCompanyName
                      ? `Company: ${localPortProbe.activeCompanyName}`
                      : "XML Server Ready"
                  }
                  tone="emerald"
                />
              </div>
              <p className="mt-0.5 text-xs text-zinc-600">
                {localPortProbe.voucherCount > 0
                  ? `${localPortProbe.voucherCount} saved voucher(s) detected in open Tally company.`
                  : "Tally Prime XML Server is online on 127.0.0.1:9000."}
              </p>
            </div>
          </div>

          {canManageTally && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isFetchingLocal}
                onClick={handleFetchLocalPort9000}
                className="rsl-btn-primary inline-flex items-center gap-1.5 text-xs"
              >
                {isFetchingLocal && <IosSpinner size="xs" />}
                <span>
                  {isFetchingLocal
                    ? "Fetching Bills..."
                    : `Fetch Bills from Tally Now${
                        localPortProbe.voucherCount > 0 ? ` (${localPortProbe.voucherCount})` : ""
                      }`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Subtle Live Auto-Refresh Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[var(--ink-muted)]">
        <div className="inline-flex items-center gap-1.5">
          <CheckCircle2 width={13} height={13} className="text-emerald-600" />
          <span>
            Live Sync active - Tally vouchers saved with{" "}
            <code className="font-mono text-[var(--ink-secondary)]">Ctrl + A</code> appear within 4
            seconds.
          </span>
        </div>
        <button
          type="button"
          onClick={() => openGuideDrawerById("tally-suite-guide", "troubleshooting")}
          className="text-[11.5px] font-medium text-[var(--ink-muted)] hover:text-[var(--ink)] hover:underline"
        >
          Troubleshooting
        </button>
      </div>
    </div>
  );
}
