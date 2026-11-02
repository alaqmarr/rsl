"use client";

import React, { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Cpu } from "lucide-react";
import { IosSpinner, sileo, StatusPill } from "@rsl/ui";
import { syncLocalTallyPort9000JsonAction } from "@/lib/actions";

export interface TallyLiveSyncBarProps {
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

export function TallyLiveSyncBar({
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
        <div className="rounded-2xl border border-amber-300/90 bg-amber-50/90 p-4 text-xs text-amber-950 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div
                style={{ width: 36, height: 36 }}
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-700"
              >
                <AlertTriangle width={18} height={18} />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    {outdatedTdl.isOutdated
                      ? `Action Needed: Tally Prime Still Has Older Add-On v${outdatedTdl.detectedVersion} Loaded (Update to v${outdatedTdl.latestVersion})`
                      : "Last Tally Prime Push Did Not Include a Complete Bill"}
                  </span>
                  <StatusPill label="Setup Fix Available" tone="amber" showDot={false} />
                </div>

                {outdatedTdl.isOutdated ? (
                  <p className="leading-relaxed text-amber-900">
                    Your endpoint token is verified, and Tally Prime reached this server —{" "}
                    <strong>however</strong>, Tally Prime is still running{" "}
                    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-900">
                      TallyPrime-RSL-TDL/{outdatedTdl.detectedVersion}
                    </code>{" "}
                    in memory, which sent blank voucher amounts on save.{" "}
                    <strong>Version {outdatedTdl.latestVersion}</strong> fixes voucher field capture
                    on <code className="font-mono">Ctrl + A</code> and adds a 1-click{" "}
                    <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> button on Gateway of Tally
                    for bills you already created!
                  </p>
                ) : (
                  <p className="leading-relaxed text-amber-900">
                    <strong>Diagnostic detail:</strong> {lastErrorMessage}
                  </p>
                )}

                <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-slate-800">
                  <li>
                    Click <strong>Download Updated .tdl (v{outdatedTdl.latestVersion})</strong>{" "}
                    below and <strong>overwrite the exact TDL path configured in Tally Prime</strong>{" "}
                    (e.g.{" "}
                    <code className="rounded bg-white px-1 py-0.5 font-mono">
                      C:\Program Files\TallyPrime\rsl-tally-whatsapp.tdl
                    </code>{" "}
                    — do not leave it in Downloads as{" "}
                    <code className="font-mono">rsl-tally-whatsapp (1).tdl</code>).
                  </li>
                  <li>
                    In Tally Prime, press <strong>F1 (Help)</strong> →{" "}
                    <strong>TDLs &amp; Add-Ons</strong> → <strong>F4 (Manage Local TDLs)</strong> →
                    press <strong>Ctrl + A</strong> so Tally reloads the updated file into memory.
                  </li>
                  <li>
                    On <strong>Gateway of Tally</strong>, click{" "}
                    <strong>&ldquo;RSL Sync All Bills Now&rdquo;</strong> to push your already-saved
                    Sales invoice(s) immediately (or use the 1-click{" "}
                    <strong>Fetch Bills from Tally Now</strong> button below if Tally is on this PC).
                  </li>
                </ol>
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
                  Download Updated .tdl (v{outdatedTdl.latestVersion})
                </a>
                <Link href="/tally?tab=connect#setup-guide" className="rsl-btn-secondary text-xs">
                  View Detailed Setup Guide
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Live Local Tally Prime Port 9000 Direct Pull Bar (when running locally & Port 9000 is open) */}
      {isLocalDev && localPortProbe?.reachable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200/90 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-950 shadow-2xs">
          <div className="flex min-w-0 items-center gap-3">
            <div
              style={{ width: 34, height: 34 }}
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700"
            >
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
              <p className="mt-0.5 text-[11px] text-emerald-900">
                {localPortProbe.voucherCount > 0
                  ? `Found ${localPortProbe.voucherCount} saved bill(s)/receipt(s) in open Tally company${
                      localPortProbe.activeCompanyName
                        ? ` '${localPortProbe.activeCompanyName}'`
                        : ""
                    }. Pull existing invoices into your portal in 1 click — plus portal auto-refreshes every 4s.`
                  : "Tally Prime XML Server is online on 127.0.0.1:9000. Any saved Sales or Receipt voucher can be pulled in 1 click."}
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-zinc-500">
        <div className="inline-flex items-center gap-1.5">
          <CheckCircle2 width={13} height={13} className="text-emerald-600" />
          <span>
            Live Sync Listener active — new Tally bills saved with{" "}
            <code className="font-mono text-slate-700">Ctrl + A</code> appear automatically within 4
            seconds without refreshing the page.
          </span>
        </div>
        <Link href="/tally?tab=connect#setup-guide" className="font-semibold text-emerald-700 hover:underline">
          Step-by-step Tally Prime setup &amp; troubleshooting →
        </Link>
      </div>
    </div>
  );
}
