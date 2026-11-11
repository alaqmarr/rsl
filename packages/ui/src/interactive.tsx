"use client";

import React, { useEffect, useState } from "react";

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
  showStrengthMeter?: boolean;
}

function evaluatePasswordStrength(raw: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  toneClass: string;
  barClass: string;
} {
  if (!raw) {
    return { score: 0, label: "", toneClass: "text-zinc-500", barClass: "bg-zinc-200" };
  }
  let pts = 0;
  if (raw.length >= 8) pts += 1;
  if (raw.length >= 12) pts += 1;
  if (/[a-z]/.test(raw) && /[A-Z]/.test(raw)) pts += 1;
  if (/\d/.test(raw) && /[^A-Za-z0-9]/.test(raw)) pts += 1;
  else if (/\d/.test(raw) || /[^A-Za-z0-9]/.test(raw)) pts = Math.max(pts, 2);

  if (raw.length < 8) {
    return { score: 1, label: "Too short (min 8 chars)", toneClass: "text-rose-700", barClass: "bg-rose-500" };
  }
  if (pts <= 1) {
    return { score: 1, label: "Weak", toneClass: "text-rose-700", barClass: "bg-rose-500" };
  }
  if (pts === 2) {
    return { score: 2, label: "Fair", toneClass: "text-amber-700", barClass: "bg-amber-500" };
  }
  if (pts === 3) {
    return { score: 3, label: "Good", toneClass: "text-emerald-700", barClass: "bg-emerald-500" };
  }
  return { score: 4, label: "Strong", toneClass: "text-emerald-800", barClass: "bg-emerald-600" };
}

export function PasswordInput({
  id,
  className = "rsl-input",
  wrapperClassName = "",
  showStrengthMeter = false,
  onKeyDown,
  onKeyUp,
  onBlur,
  onChange,
  value,
  defaultValue,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [internalVal, setInternalVal] = useState(
    typeof value === "string"
      ? value
      : typeof defaultValue === "string"
        ? defaultValue
        : ""
  );

  const currentPassword = typeof value === "string" ? value : internalVal;
  const strength = showStrengthMeter ? evaluatePasswordStrength(currentPassword) : null;

  const updateCapsState = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setCapsLockOn(e.getModifierState("CapsLock"));
    }
  };

  return (
    <div className="w-full">
      <div className={`relative flex items-center ${wrapperClassName}`}>
        <input
          {...rest}
          id={id}
          value={value}
          defaultValue={defaultValue}
          type={visible ? "text" : "password"}
          onChange={(e) => {
            if (value === undefined) setInternalVal(e.target.value);
            onChange?.(e);
          }}
          onKeyDown={(e) => {
            updateCapsState(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            updateCapsState(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLockOn(false);
            onBlur?.(e);
          }}
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
      {capsLockOn && (
        <p
          role="status"
          aria-live="polite"
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
        >
          <span aria-hidden="true">⇪</span>
          <span>Caps Lock is ON</span>
        </p>
      )}
      {strength && currentPassword.length > 0 && (
        <div className="mt-2 space-y-1" aria-live="polite">
          <div
            role="progressbar"
            aria-label="Password strength"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={strength.score}
            className="grid grid-cols-4 gap-1"
          >
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={`h-1.5 rounded-full transition-colors ${
                  step <= strength.score ? strength.barClass : "bg-zinc-200"
                }`}
              />
            ))}
          </div>
          <p className={`text-xs font-medium ${strength.toneClass}`}>
            Password strength: {strength.label}
          </p>
        </div>
      )}
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
    <div className={`rsl-code-surface overflow-hidden rounded-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-1.5">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-[var(--butter-cream)] uppercase">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white transition hover:border-[var(--sunset-orange)] hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sunset-orange)]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-white">
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
            className="rsl-tab-bar !p-0.5 text-xs"
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
                  className={`rsl-tab-pill !px-2.5 !py-1 !text-[11.5px] ${
                    selected ? "rsl-tab-pill-active" : ""
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
            <span className="rsl-chart-dot-primary inline-block h-2.5 w-2.5 shrink-0 rounded-full" />
            <span>{primaryLabel}:</span>
            <span className="tabular-nums">
              {activePoint ? activePoint.primaryFormatted : primarySumFormatted}
            </span>
          </span>
          {secondaryLabel && (
            <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
              <span className="rsl-chart-dot-secondary inline-block h-2.5 w-2.5 shrink-0 rounded-full" />
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
          className="h-56 min-w-[540px] w-full select-none"
          role="img"
          aria-label={`${primaryLabel}: total ${primarySumFormatted}${
            secondaryLabel ? `; ${secondaryLabel}: total ${secondarySumFormatted}` : ""
          } across ${points.length} data points.`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryColor} stopOpacity={0.22} />
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
                stroke={tick.ratio === 0 ? "var(--border-strong)" : "var(--border)"}
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
                stroke="var(--ink-muted)"
                strokeWidth={1.25}
                strokeDasharray="3 3"
              />
              {secondaryLabel && (
                <circle
                  cx={activePoint.x}
                  cy={activePoint.secondaryY}
                  r={5}
                  fill="var(--surface)"
                  stroke={secondaryColor}
                  strokeWidth={2.5}
                />
              )}
              <circle
                cx={activePoint.x}
                cy={activePoint.primaryY}
                r={5.5}
                fill="var(--surface)"
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
                  fill="var(--surface)"
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
              data-chart-pt={`${gradId}-${idx}`}
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
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" && idx + 1 < points.length) {
                  e.preventDefault();
                  const next = document.querySelector<SVGRectElement>(
                    `rect[data-chart-pt="${gradId}-${idx + 1}"]`
                  );
                  next?.focus();
                } else if (e.key === "ArrowLeft" && idx > 0) {
                  e.preventDefault();
                  const prev = document.querySelector<SVGRectElement>(
                    `rect[data-chart-pt="${gradId}-${idx - 1}"]`
                  );
                  prev?.focus();
                }
              }}
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
                className="fill-zinc-500 text-xs font-medium tabular-nums"
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
            <div className="mt-1 flex items-center justify-between gap-4 text-xs">
              <span className="text-zinc-600">{primaryLabel}:</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {activePoint.primaryFormatted}
              </span>
            </div>
            {secondaryLabel && (
              <div className="mt-0.5 flex items-center justify-between gap-4 text-xs">
                <span className="text-zinc-600">{secondaryLabel}:</span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {activePoint.secondaryFormatted}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Screen-reader accessible tabular fallback */}
      <table className="sr-only">
        <caption>
          {primaryLabel}
          {secondaryLabel ? ` and ${secondaryLabel}` : ""} series breakdown
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{primaryLabel}</th>
            {secondaryLabel && <th scope="col">{secondaryLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((pt, idx) => (
            <tr key={`sr-row-${idx}`}>
              <td>{pt.label}</td>
              <td>{pt.primaryFormatted}</td>
              {secondaryLabel && <td>{pt.secondaryFormatted}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConfirmSubmitButton({
  confirmMessage,
  children,
  className = "",
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string;
}) {
  return (
    <button
      {...rest}
      type="submit"
      className={className}
      onClick={(e) => {
        if (typeof window !== "undefined" && !window.confirm(confirmMessage)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
