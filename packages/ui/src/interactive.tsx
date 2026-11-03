"use client";

import React, { useEffect, useState } from "react";

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
}

export function PasswordInput({
  id,
  className = "rsl-input",
  wrapperClassName = "",
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative flex items-center ${wrapperClassName}`}>
      <input
        {...rest}
        id={id}
        type={visible ? "text" : "password"}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {visible ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose?: () => void
) {
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;

    const focusInitial = () => {
      const container = containerRef.current;
      if (!container) return;
      const explicitAuto = container.querySelector<HTMLElement>("[data-autofocus='true']");
      if (explicitAuto) {
        explicitAuto.focus();
        return;
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable[0]) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    };

    const raf = window.requestAnimationFrame(focusInitial);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!active || active === last || !container.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, isOpen, onClose]);
}

export function CopyCodeBlock({
  code,
  language,
  className = "my-4",
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Ignore clipboard permission restrictions in sandboxed iframes
    }
  };

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xs ${className}`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200 transition hover:border-emerald-500/60 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function TabbedApiCodeViewer({
  curl,
  javascript,
  python,
  responseJson,
}: {
  curl: string;
  javascript: string;
  python: string;
  responseJson: string;
}) {
  const [activeTab, setActiveTab] = useState<"curl" | "javascript" | "python">("curl");

  const activeCode =
    activeTab === "javascript" ? javascript : activeTab === "python" ? python : curl;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            Request Code Example
          </p>
          <div
            role="tablist"
            aria-label="API code language"
            className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 text-xs"
          >
            {(
              [
                { key: "curl", label: "cURL" },
                { key: "javascript", label: "JavaScript" },
                { key: "python", label: "Python" },
              ] as const
            ).map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${
                    selected
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-zinc-600 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <CopyCodeBlock code={activeCode} language={activeTab} className="my-0" />
      </div>

      <div className="min-w-0 space-y-2">
        <div className="flex min-h-7 items-center">
          <p className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
            200 OK JSON Response
          </p>
        </div>
        <CopyCodeBlock code={responseJson} language="json" className="my-0" />
      </div>
    </div>
  );
}

export interface InteractiveChartPoint {
  label: string;
  x: number;
  primaryY: number;
  secondaryY: number;
  primaryRaw: number;
  secondaryRaw: number;
  primaryFormatted: string;
  secondaryFormatted: string;
}

export function InteractiveAreaChartCanvas({
  width,
  height,
  padLeft,
  padRight,
  padTop,
  plotH,
  gradId,
  primaryLabel,
  secondaryLabel,
  primaryColor,
  secondaryColor,
  primarySumFormatted,
  secondarySumFormatted,
  totalSum,
  emptyHint,
  primaryLine,
  primaryArea,
  secondaryLine,
  yTicks,
  labelStride,
  points,
}: {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  plotH: number;
  gradId: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryColor: string;
  secondaryColor: string;
  primarySumFormatted: string;
  secondarySumFormatted: string;
  totalSum: number;
  emptyHint: string;
  primaryLine: string;
  primaryArea: string;
  secondaryLine: string;
  yTicks: Array<{ ratio: number; y: number; text: string }>;
  labelStride: number;
  points: InteractiveChartPoint[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activePoint = hoverIdx !== null ? points[hoverIdx] ?? null : null;
  const hitColWidth =
    points.length > 1
      ? Math.max(12, Math.round((width - padLeft - padRight) / points.length))
      : width - padLeft - padRight;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-2.5 text-[13px] text-zinc-600">
        <div className="flex flex-wrap items-center gap-5">
          <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ width: 10, height: 10, backgroundColor: primaryColor }}
            />
            <span>{primaryLabel}:</span>
            <span className="tabular-nums">
              {activePoint ? activePoint.primaryFormatted : primarySumFormatted}
            </span>
          </span>
          {secondaryLabel && (
            <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ width: 10, height: 10, backgroundColor: secondaryColor }}
              />
              <span>{secondaryLabel}:</span>
              <span className="tabular-nums">
                {activePoint ? activePoint.secondaryFormatted : secondarySumFormatted}
              </span>
            </span>
          )}
        </div>
        {activePoint ? (
          <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-0.5 text-[11.5px] font-semibold text-slate-800 shadow-2xs tabular-nums">
            {activePoint.label}
          </span>
        ) : totalSum === 0 ? (
          <span className="text-[12px] font-medium text-zinc-500">{emptyHint}</span>
        ) : (
          <span className="text-[11.5px] font-medium text-zinc-500">
            Hover or tap points to inspect daily values
          </span>
        )}
      </div>

      <div
        className="relative w-full overflow-x-auto"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ height: 224 }}
          className="h-56 min-w-[540px] w-full select-none"
          role="img"
          aria-label={primaryLabel}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryColor} stopOpacity={0.18} />
              <stop offset="100%" stopColor={primaryColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {yTicks.map((tick) => (
            <g key={tick.ratio}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={tick.y}
                y2={tick.y}
                stroke={tick.ratio === 0 ? "#E4E4E7" : "#F4F4F5"}
                strokeDasharray={tick.ratio === 0 ? undefined : "4 4"}
              />
              <text
                x={padLeft - 10}
                y={tick.y + 4}
                textAnchor="end"
                className="fill-zinc-500 text-[11px] font-medium tabular-nums"
              >
                {tick.text}
              </text>
            </g>
          ))}

          {primaryArea && totalSum > 0 && <path d={primaryArea} fill={`url(#${gradId})`} />}

          {secondaryLine && (
            <path
              d={secondaryLine}
              fill="none"
              stroke={secondaryColor}
              strokeWidth={2}
              strokeDasharray="5 3"
            />
          )}

          {primaryLine && (
            <path
              d={primaryLine}
              fill="none"
              stroke={primaryColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Crosshair vertical guide + active point rings */}
          {activePoint && (
            <g pointerEvents="none">
              <line
                x1={activePoint.x}
                x2={activePoint.x}
                y1={padTop}
                y2={padTop + plotH}
                stroke="#94A3B8"
                strokeWidth={1.25}
                strokeDasharray="3 3"
              />
              {secondaryLabel && (
                <circle
                  cx={activePoint.x}
                  cy={activePoint.secondaryY}
                  r={5}
                  fill="#FFFFFF"
                  stroke={secondaryColor}
                  strokeWidth={2.5}
                />
              )}
              <circle
                cx={activePoint.x}
                cy={activePoint.primaryY}
                r={5.5}
                fill="#FFFFFF"
                stroke={primaryColor}
                strokeWidth={2.5}
              />
            </g>
          )}

          {totalSum > 0 &&
            points.map((pt, idx) =>
              pt.primaryRaw > 0 && idx !== hoverIdx ? (
                <circle
                  key={`pt-${idx}`}
                  cx={pt.x}
                  cy={pt.primaryY}
                  r={3.5}
                  fill="#FFFFFF"
                  stroke={primaryColor}
                  strokeWidth={2}
                >
                  <title>{`${pt.label}: ${pt.primaryFormatted}`}</title>
                </circle>
              ) : null
            )}

          {/* Interactive hover & keyboard columns */}
          {points.map((pt, idx) => (
            <rect
              key={`hit-${idx}`}
              x={Math.max(padLeft, Math.round(pt.x - hitColWidth / 2))}
              y={padTop}
              width={hitColWidth}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${pt.label}: ${primaryLabel} ${pt.primaryFormatted}${
                secondaryLabel ? `, ${secondaryLabel} ${pt.secondaryFormatted}` : ""
              }`}
              onMouseEnter={() => setHoverIdx(idx)}
              onFocus={() => setHoverIdx(idx)}
              onBlur={() => setHoverIdx((curr) => (curr === idx ? null : curr))}
              className="cursor-crosshair focus:outline-none"
            />
          ))}

          {points.map((pt, idx) => {
            if (idx % labelStride !== 0 && idx !== points.length - 1) return null;
            return (
              <text
                key={`${pt.label}-${idx}`}
                x={pt.x}
                y={height - 8}
                textAnchor="middle"
                className="fill-zinc-500 text-[11px] font-medium tabular-nums"
              >
                {pt.label}
              </text>
            );
          })}
        </svg>

        {activePoint && (
          <div
            className="pointer-events-none absolute top-2 right-3 rounded-xl border border-zinc-200/95 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur-xs"
            aria-live="polite"
          >
            <div className="font-bold text-slate-900">{activePoint.label}</div>
            <div className="mt-1 flex items-center justify-between gap-4 text-[11.5px]">
              <span className="text-zinc-600">{primaryLabel}:</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {activePoint.primaryFormatted}
              </span>
            </div>
            {secondaryLabel && (
              <div className="mt-0.5 flex items-center justify-between gap-4 text-[11.5px]">
                <span className="text-zinc-600">{secondaryLabel}:</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {activePoint.secondaryFormatted}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
