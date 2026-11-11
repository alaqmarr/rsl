"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  HelpCircle,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { CopyCodeBlock, useDialogFocusTrap } from "./interactive";

export interface GuideCopyValue {
  label: string;
  value: string;
}

export interface GuideDrawerStep {
  title: string;
  detail: string;
  tip?: string;
  code?: string;
  codeLanguage?: string;
  copyValues?: GuideCopyValue[];
}

export interface GuideDrawerTab {
  id: string;
  label: string;
  badge?: string;
  summary?: string;
  estimatedTime?: string;
  prerequisites?: string[];
  copyValues?: GuideCopyValue[];
  steps: GuideDrawerStep[];
  cautions?: string[];
}

export interface GuideDrawerContent {
  eyebrow?: string;
  title: string;
  summary: string;
  estimatedTime?: string;
  roleNote?: string;
  prerequisites?: string[];
  copyValues?: GuideCopyValue[];
  steps?: GuideDrawerStep[];
  cautions?: string[];
  cautionsTitle?: string;
  tabs?: GuideDrawerTab[];
  progress?: {
    label: string;
    doneCount: number;
    totalCount: number;
  };
  fullGuideHref?: string;
  fullGuideLabel?: string;
  externalHref?: string;
  externalLabel?: string;
}

function CopyValueChip({ item }: { item: GuideCopyValue }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(item.value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Ignore restricted clipboard contexts
    }
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10.5px] font-semibold tracking-wider text-zinc-500 uppercase">
          {item.label}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs font-medium text-slate-900">
          {item.value}
        </div>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="rsl-btn-secondary shrink-0 !min-h-7 !px-2.5 !py-1 !text-xs"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-700" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

export function GuideDrawer({
  open,
  onClose,
  guide,
  activeTabId,
  onTabChange,
}: {
  open: boolean;
  onClose: () => void;
  guide: GuideDrawerContent;
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [internalTabId, setInternalTabId] = useState<string>(
    activeTabId || guide.tabs?.[0]?.id || ""
  );

  useDialogFocusTrap(sheetRef, open, onClose);

  useEffect(() => {
    if (activeTabId) {
      setInternalTabId(activeTabId);
    } else if (guide.tabs?.[0]?.id && !guide.tabs.some((t) => t.id === internalTabId)) {
      setInternalTabId(guide.tabs[0].id);
    }
  }, [activeTabId, guide.tabs, internalTabId]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const tabs = guide.tabs ?? [];
  const currentTab =
    tabs.length > 0 ? (tabs.find((t) => t.id === internalTabId) ?? tabs[0]) : undefined;

  const effectiveSummary = currentTab?.summary || guide.summary;
  const effectiveTime = currentTab?.estimatedTime || guide.estimatedTime;
  const effectivePrerequisites = currentTab?.prerequisites ?? guide.prerequisites ?? [];
  const effectiveCopyValues = currentTab?.copyValues ?? guide.copyValues ?? [];
  const effectiveSteps = currentTab?.steps ?? guide.steps ?? [];
  const effectiveCautions = currentTab?.cautions ?? guide.cautions ?? [];
  const hasWideBlocks = effectiveSteps.some(
    (s) => Boolean(s.code) || Boolean(s.copyValues && s.copyValues.length > 0)
  );

  const selectTab = (id: string) => {
    setInternalTabId(id);
    onTabChange?.(id);
  };

  const progressPct = guide.progress
    ? Math.round((guide.progress.doneCount / Math.max(1, guide.progress.totalCount)) * 100)
    : 0;

  return (
    <div className="no-print fixed inset-0 z-50 flex flex-col justify-end">
      {/* Hard-Blur Frosted Backdrop Scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="rsl-hard-blur-scrim fixed inset-0 transition-opacity"
      />

      {/* Frosted Bottom Sheet */}
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rsl-drawer-frost animate-drawerUp relative z-10 mx-auto flex max-h-[86vh] w-full flex-col overflow-hidden rounded-t-[28px] border-x border-t sm:max-w-[980px]"
      >
        <div aria-hidden="true" className="rsl-top-seam h-1 w-full shrink-0" />

        {/* Tactile Handle + Sticky Header */}
        <div className="shrink-0 border-b border-zinc-200 px-5 pt-3 pb-4 sm:px-8">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-300" aria-hidden="true" />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rsl-eyebrow">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--sunset-orange)]" />
                  <span>{guide.eyebrow || "Step-by-Step Setup Guide"}</span>
                </span>
                {effectiveTime && (
                  <span className="rsl-pill rsl-pill-sunset">{effectiveTime}</span>
                )}
                {effectiveSteps.length > 0 && (
                  <span className="rsl-pill rsl-pill-cream">
                    {effectiveSteps.length} {effectiveSteps.length === 1 ? "step" : "steps"}
                  </span>
                )}
              </div>

              <h2
                id={titleId}
                className="rsl-display-heading mt-2.5 text-[22px] font-semibold text-[var(--ink-strong)] sm:text-[26px]"
              >
                {guide.title}
              </h2>

              {guide.roleNote && (
                <p className="mt-1 text-xs font-semibold text-emerald-700">{guide.roleNote}</p>
              )}

              <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-zinc-600 sm:text-sm">
                {effectiveSummary}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              data-autofocus="true"
              aria-label="Close guide drawer"
              className="rsl-btn-secondary shrink-0 !min-h-9 !px-3 !py-1.5"
            >
              <span className="hidden font-mono text-[11px] sm:inline">ESC</span>
              <X className="h-4 w-4" />
            </button>
          </div>

          {tabs.length > 1 && (
            <div
              role="tablist"
              aria-label="Guide topics"
              className="mt-4 flex flex-wrap items-center gap-1.5"
            >
              {tabs.map((tab) => {
                const selected = tab.id === currentTab?.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => selectTab(tab.id)}
                    className={
                      selected
                        ? "rsl-btn-primary !min-h-8 !rounded-full !px-3.5 !py-1 !text-xs"
                        : "rsl-btn-secondary !min-h-8 !rounded-full !px-3.5 !py-1 !text-xs"
                    }
                  >
                    <span>{tab.label}</span>
                    {tab.badge && (
                      <span className="rounded-full bg-[var(--sunset-orange)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--midnight-black)]">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Scrollable Editorial Steps Body */}
        <div className="rsl-custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          {guide.progress && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900">{guide.progress.label}</span>
                <span className="font-mono font-bold text-emerald-700 tabular-nums">
                  {guide.progress.doneCount} / {guide.progress.totalCount} complete ({progressPct}%)
                </span>
              </div>
              <progress
                value={progressPct}
                max={100}
                aria-label={guide.progress.label}
                className="rsl-progress mt-2.5"
              />
            </div>
          )}

          {effectivePrerequisites.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-wider text-slate-900 uppercase">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                <span>Before You Begin</span>
              </div>
              <ul className="mt-2.5 grid grid-cols-1 gap-2 text-[13px] leading-relaxed text-zinc-700 sm:grid-cols-2">
                {effectivePrerequisites.map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                    <span>{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {effectiveCopyValues.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {effectiveCopyValues.map((cv, cIdx) => (
                <CopyValueChip key={cIdx} item={cv} />
              ))}
            </div>
          )}

          {effectiveSteps.length > 0 && (
            <ol
              className={`grid grid-cols-1 gap-3.5 ${
                !hasWideBlocks && effectiveSteps.length >= 2 ? "md:grid-cols-2" : ""
              }`}
            >
              {effectiveSteps.map((step, idx) => (
                <li
                  key={idx}
                  className="rsl-frost-card flex flex-col justify-between rounded-2xl p-4 sm:p-5"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-[var(--btn-primary-bg)] px-2 font-mono text-xs font-bold text-[var(--btn-primary-fg)] tabular-nums">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                          {step.title}
                        </h3>
                        <p className="mt-1 text-[13.5px] leading-[1.62] text-zinc-600">
                          {step.detail}
                        </p>
                      </div>
                    </div>

                    {step.copyValues && step.copyValues.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {step.copyValues.map((cv, cIdx) => (
                          <CopyValueChip key={cIdx} item={cv} />
                        ))}
                      </div>
                    )}

                    {step.code && (
                      <CopyCodeBlock
                        code={step.code}
                        language={step.codeLanguage || "bash"}
                        className="my-2"
                      />
                    )}
                  </div>

                  {step.tip && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                      <strong className="font-semibold">Tip:</strong> {step.tip}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          {effectiveCautions.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px]">
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>{guide.cautionsTitle || "Common Pitfalls & Checks"}</span>
              </div>
              <ul className="mt-2 space-y-1.5 text-amber-950">
                {effectiveCautions.map((c, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Sticky Frosted Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-5 py-3.5 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            {guide.fullGuideHref && (
              <a
                href={guide.fullGuideHref}
                onClick={onClose}
                className="rsl-btn-secondary !min-h-9 text-xs"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>{guide.fullGuideLabel || "Open Full Guide"}</span>
              </a>
            )}
            {guide.externalHref && (
              <a
                href={guide.externalHref}
                target="_blank"
                rel="noreferrer"
                className="rsl-btn-secondary !min-h-9 text-xs"
              >
                <span>{guide.externalLabel || "Help Center"}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <button type="button" onClick={onClose} className="rsl-btn-primary !min-h-9 text-xs">
            Got it, continue working
          </button>
        </div>
      </section>
    </div>
  );
}

export function GuideDrawerButton({
  guide,
  label = "Need help?",
  badgeText,
  initialTabId,
  drawerId,
  variant = "pill",
  className = "",
}: {
  guide: GuideDrawerContent;
  label?: string;
  badgeText?: string;
  initialTabId?: string;
  drawerId?: string;
  variant?: "pill" | "secondary" | "spark";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tabId, setTabId] = useState<string | undefined>(initialTabId);

  useEffect(() => {
    if (!drawerId || typeof window === "undefined") return;
    const onExternalOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ drawerId?: string; tabId?: string }>).detail;
      if (detail?.drawerId === drawerId) {
        if (detail.tabId) setTabId(detail.tabId);
        setOpen(true);
      }
    };
    window.addEventListener("rsl-open-guide-drawer", onExternalOpen);
    return () => window.removeEventListener("rsl-open-guide-drawer", onExternalOpen);
  }, [drawerId]);

  const btnBase =
    variant === "spark"
      ? "rsl-btn-spark"
      : variant === "secondary"
        ? "rsl-btn-secondary"
        : "rsl-guide-trigger";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (initialTabId) setTabId(initialTabId);
          setOpen(true);
        }}
        className={`${btnBase} ${className}`}
      >
        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-[var(--sunset-orange)]" />
        <span>{label}</span>
        {badgeText && (
          <span className="rounded-full bg-[var(--spark-soft)] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[var(--spark-ink)]">
            {badgeText}
          </span>
        )}
      </button>

      <GuideDrawer
        open={open}
        onClose={() => setOpen(false)}
        guide={guide}
        activeTabId={tabId}
        onTabChange={setTabId}
      />
    </>
  );
}

export function openGuideDrawerById(drawerId: string, tabId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("rsl-open-guide-drawer", {
      detail: { drawerId, tabId },
    })
  );
}

function applyDomTheme(next: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = next;
  document.documentElement.classList.toggle("dark", next === "dark");
}

function persistThemePreference(next: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  applyDomTheme(next);
  document.cookie = `rsl_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    window.localStorage.setItem("rsl_theme", next);
  } catch {
    // Ignore private browsing storage blocks
  }
  window.dispatchEvent(new CustomEvent("rsl-theme-change", { detail: next }));
}

export function ThemeToggleButton({
  compact = false,
  showLabel = false,
  className = "",
}: {
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const syncFromEnv = () => {
      try {
        const attr = document.documentElement.dataset.theme;
        const stored = window.localStorage.getItem("rsl_theme");
        if (stored === "dark" || stored === "light") {
          applyDomTheme(stored);
          document.cookie = `rsl_theme=${stored}; Path=/; Max-Age=31536000; SameSite=Lax`;
          setTheme(stored);
          return;
        }
        if (attr === "dark" || attr === "light") {
          applyDomTheme(attr);
          setTheme(attr);
          return;
        }
        const prefersDark = Boolean(
          window.matchMedia?.("(prefers-color-scheme: dark)").matches
        );
        const resolved: "light" | "dark" = prefersDark ? "dark" : "light";
        applyDomTheme(resolved);
        setTheme(resolved);
      } catch {
        // Ignore storage restrictions
      }
    };

    syncFromEnv();

    const onThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<"light" | "dark">).detail;
      if (next === "dark" || next === "light") {
        applyDomTheme(next);
        setTheme(next);
      }
    };
    window.addEventListener("rsl-theme-change", onThemeEvent);
    return () => window.removeEventListener("rsl-theme-change", onThemeEvent);
  }, []);

  const toggle = () => {
    const next: "light" | "dark" = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persistThemePreference(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-pressed={theme === "dark"}
      className={`rsl-btn-secondary !min-h-8 !px-2.5 !py-1 text-xs ${className}`}
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5 text-[var(--sunset-orange)]" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-[var(--ink-strong)]" />
      )}
      {showLabel && !compact && <span>{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}
