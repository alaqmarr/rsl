import React from "react";

export {
  FlashBanner,
  RSL_SILEO_TOAST_OPTIONS,
  SileoToastProvider,
  sileo,
  triggerSileoToast,
  type FlashToastPayload,
} from "./sileo-toast";
export { TurnstileWidget } from "./turnstile-widget";
export { TotpQrCodeCard, type TotpQrCodeCardProps } from "./totp-qr-card";

import {
  ConfirmSubmitButton,
  CopyCodeBlock,
  InteractiveAreaChartCanvas,
  PasswordInput,
  TabbedApiCodeViewer,
  useDialogFocusTrap,
  type InteractiveChartPoint,
  type PasswordInputProps,
} from "./interactive";

export {
  ConfirmSubmitButton,
  CopyCodeBlock,
  InteractiveAreaChartCanvas,
  PasswordInput,
  TabbedApiCodeViewer,
  useDialogFocusTrap,
  type InteractiveChartPoint,
  type PasswordInputProps,
};

export {
  GuideDrawer,
  GuideDrawerButton,
  openGuideDrawerById,
  ThemeToggleButton,
  type GuideCopyValue,
  type GuideDrawerContent,
  type GuideDrawerStep,
  type GuideDrawerTab,
} from "./guide-drawer";

const AVATAR_TONES = [
  "bg-emerald-700 text-white",
  "bg-slate-900 text-white",
  "bg-amber-600 text-white",
] as const;

export function getAvatarToneClasses(seed: string): string {
  const clean = seed.trim().toLowerCase() || "rsl";
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

export function getAvatarInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "RS";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function UserAvatar({
  name,
  seed,
  size = "sm",
  className = "",
}: {
  name: string;
  seed?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass =
    size === "xs"
      ? "h-6 w-6 text-[10px]"
      : size === "md"
        ? "h-9 w-9 text-xs"
        : size === "lg"
          ? "h-11 w-11 text-sm"
          : "h-8 w-8 text-[11px]";
  const tone = getAvatarToneClasses(seed || name);
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-tight shadow-2xs select-none ${sizeClass} ${tone} ${className}`}
    >
      {getAvatarInitials(name)}
    </span>
  );
}

const BRAND_LONG_HEIGHT_PX: Record<"xs" | "sm" | "md" | "lg", number> = {
  xs: 22,
  sm: 26,
  md: 32,
  lg: 38,
};

const BRAND_MARK_PX: Record<"xs" | "sm" | "md" | "lg", number> = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 34,
};

const BRAND_MARK_CLASS: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "rsl-logo-mark-xs",
  sm: "rsl-logo-mark-sm",
  md: "rsl-logo-mark-md",
  lg: "rsl-logo-mark-lg",
};

const BRAND_LONG_CLASS: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "rsl-logo-long-xs",
  sm: "rsl-logo-long-sm",
  md: "rsl-logo-long-md",
  lg: "rsl-logo-long-lg",
};

export function BrandLogo({
  variant = "long",
  size = "md",
  subtitle,
  className = "",
}: {
  variant?: "long" | "mark";
  size?: "xs" | "sm" | "md" | "lg";
  subtitle?: string;
  className?: string;
}) {
  if (variant === "mark") {
    const px = BRAND_MARK_PX[size];
    return (
      <span className={`inline-flex shrink-0 items-center gap-2 ${className}`}>
        <img
          src="/logo-nobg.png"
          alt="RapidShift Labs"
          width={px}
          height={px}
          draggable={false}
          className={`rsl-brand-logo-img ${BRAND_MARK_CLASS[size]} shrink-0 select-none object-contain`}
        />
        {subtitle ? (
          <span className="truncate font-sans text-xs font-medium tracking-[-0.01em] text-[var(--ink-muted)]">
            {subtitle}
          </span>
        ) : null}
      </span>
    );
  }

  const h = BRAND_LONG_HEIGHT_PX[size];
  const w = Math.round(h * (1228 / 362));

  return (
    <span className={`inline-flex min-w-0 flex-col items-start ${className}`}>
      <img
        src="/long-logo-nobg.png"
        alt="RapidShift Labs"
        width={w}
        height={h}
        draggable={false}
        className={`rsl-brand-logo-img ${BRAND_LONG_CLASS[size]} shrink-0 select-none object-contain`}
      />
      {subtitle ? (
        <span className="mt-1 block truncate font-sans text-[11.5px] font-medium tracking-[-0.008em] text-[var(--ink-muted)]">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}

export function PlatformFooter({
  suiteLabel = "RSL Marketing & Tally Suite",
  links = [],
  rightNote,
  className = "",
}: {
  suiteLabel?: string;
  links?: Array<{ label: string; href: string; external?: boolean }>;
  rightNote?: React.ReactNode;
  className?: string;
}) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`rsl-frost-surface no-print mt-auto shrink-0 border-x-0 border-b-0 px-5 py-4 text-xs text-zinc-500 lg:px-8 xl:px-10 ${className}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2.5">
          <img
            src="/long-logo-nobg.png"
            alt="RapidShift Labs"
            width={75}
            height={22}
            draggable={false}
            className="rsl-brand-logo-img rsl-logo-footer shrink-0 select-none object-contain opacity-90"
          />
          <span className="hidden text-zinc-300 sm:inline">•</span>
          <span className="font-semibold text-slate-800">{suiteLabel}</span>
          <span className="text-zinc-500">© {year} RapidShift Labs</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-zinc-500">
          {links.map((link) => (
            <a
              key={link.href + link.label}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noreferrer" : undefined}
              className="transition hover:text-slate-900"
            >
              {link.label}
            </a>
          ))}
          {rightNote}
        </div>
      </div>
    </footer>
  );
}

const IOS_BLADE_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330] as const;

const IOS_SPINNER_PX: Record<"xs" | "sm" | "md" | "lg" | "xl", number> = {
  xs: 13,
  sm: 15,
  md: 18,
  lg: 24,
  xl: 32,
};

export function IosSpinner({
  size = "sm",
  className = "",
  label = "Loading",
}: {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  label?: string;
}) {
  const px = IOS_SPINNER_PX[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
      className={`rsl-ios-spinner inline-block shrink-0 select-none align-middle ${className}`}
    >
      {IOS_BLADE_ANGLES.map((angle, idx) => (
        <line
          key={angle}
          x1="12"
          y1="2.2"
          x2="12"
          y2="6.8"
          stroke="currentColor"
          strokeWidth="2.35"
          strokeLinecap="round"
          transform={`rotate(${angle} 12 12)`}
          className={`rsl-ios-blade rsl-ios-blade-${idx}`}
        />
      ))}
    </svg>
  );
}

export function WorkspaceLoadingScreen({
  label = "Loading...",
}: {
  label?: string;
  dark?: boolean;
}) {
  return (
    <div className="w-full animate-fadeIn space-y-6 py-1">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-52 animate-pulse rounded-lg bg-zinc-200" />
          <div className="h-3.5 w-80 max-w-[75vw] animate-pulse rounded-md bg-zinc-200/75" />
        </div>
        <span className="rsl-frost-surface inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-zinc-700">
          <IosSpinner size="xs" className="text-[var(--sunset-orange)]" />
          <span>{label}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rsl-frost-card rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-28 animate-pulse rounded bg-zinc-200" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-zinc-100" />
            </div>
            <div className="mt-4 h-7 w-28 animate-pulse rounded-lg bg-zinc-200" />
            <div className="mt-4 h-3 w-40 animate-pulse rounded bg-zinc-100" />
          </div>
        ))}
      </div>

      <div className="rsl-frost-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-6 py-4">
          <div className="h-4 w-44 animate-pulse rounded bg-zinc-200" />
          <div className="h-7 w-28 animate-pulse rounded-lg bg-zinc-100" />
        </div>
        <div className="divide-y divide-zinc-200 px-6 py-2">
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className="flex items-center justify-between gap-4 py-4">
              <div className="space-y-2">
                <div className="h-3.5 w-48 animate-pulse rounded bg-zinc-200" />
                <div className="h-3 w-72 max-w-[60vw] animate-pulse rounded bg-zinc-100" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PendingSubmitButton({
  pending,
  children,
  pendingText,
  className = "rsl-btn-primary",
  spinnerSize = "xs",
  disabled = false,
  iconOnly = false,
  name,
  value,
  title,
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  spinnerSize?: "xs" | "sm" | "md";
  disabled?: boolean;
  iconOnly?: boolean;
  name?: string;
  value?: string;
  title?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      disabled={disabled || pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-1.5 ${className} disabled:cursor-not-allowed disabled:opacity-75`}
    >
      {iconOnly ? (
        pending ? (
          <IosSpinner size={spinnerSize} />
        ) : (
          children
        )
      ) : (
        <>
          {pending && <IosSpinner size={spinnerSize} />}
          {pending && pendingText ? <span>{pendingText}</span> : children}
        </>
      )}
    </button>
  );
}

export type Tone =
  | "emerald"
  | "amber"
  | "ruby"
  | "sky"
  | "indigo"
  | "violet"
  | "teal"
  | "stone"
  | "copper"
  | "neutral";

const TONE_CLASS_MAP: Record<Tone, { pill: string; dot: string }> = {
  emerald: { pill: "rsl-pill-forest", dot: "rsl-pill-dot-forest" },
  teal: { pill: "rsl-pill-forest", dot: "rsl-pill-dot-forest" },
  indigo: { pill: "rsl-pill-forest", dot: "rsl-pill-dot-forest" },
  sky: { pill: "rsl-pill-forest", dot: "rsl-pill-dot-forest" },
  violet: { pill: "rsl-pill-forest", dot: "rsl-pill-dot-forest" },
  amber: { pill: "rsl-pill-sunset", dot: "rsl-pill-dot-sunset" },
  copper: { pill: "rsl-pill-sunset", dot: "rsl-pill-dot-sunset" },
  ruby: { pill: "rsl-pill-sunset", dot: "rsl-pill-dot-sunset" },
  stone: { pill: "rsl-pill-cream", dot: "rsl-pill-dot-cream" },
  neutral: { pill: "rsl-pill-cream", dot: "rsl-pill-dot-cream" },
};

export function StatusPill({
  label,
  tone = "stone",
  showDot = true,
}: {
  label: string;
  tone?: Tone;
  showDot?: boolean;
}) {
  const mapped = TONE_CLASS_MAP[tone] ?? TONE_CLASS_MAP.stone;
  return (
    <span className={`rsl-pill ${mapped.pill}`}>
      {showDot && (
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${mapped.dot}`} />
      )}
      <span>{label}</span>
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  badge,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {(eyebrow || badge) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {typeof eyebrow === "string" ? (
              <span className="rsl-eyebrow">{eyebrow}</span>
            ) : (
              eyebrow
            )}
            {badge}
          </div>
        )}
        <h1 className="rsl-display-heading text-[21px] font-semibold tracking-[-0.025em] text-[var(--ink)] sm:text-[24px]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-[var(--ink-muted)] sm:text-[14px]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  sublabel,
  changePct,
  accent = "default",
  icon,
}: {
  label: string;
  value: string;
  sublabel: string;
  changePct?: number | null;
  accent?:
    | "default"
    | "emerald"
    | "amber"
    | "ruby"
    | "copper"
    | "sky"
    | "indigo"
    | "violet"
    | "teal";
  icon?: React.ReactNode;
}) {
  const isWarm = accent === "amber" || accent === "ruby" || accent === "copper";
  const chipClass = isWarm
    ? "border-[var(--spark-border)] bg-[var(--spark-soft)] text-[var(--spark-ink)]"
    : "border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink-secondary)]";
  const isLongText = value.length > 15;

  return (
    <div className="rsl-frost-card relative flex flex-col justify-between rounded-2xl p-4 sm:p-5">
      <div>
        <div className="flex items-center justify-between gap-2.5">
          <span className="truncate text-[12.5px] font-medium tracking-[-0.006em] text-[var(--ink-muted)]">
            {label}
          </span>

          {icon ? (
            <span
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 ${chipClass}`}
            >
              {icon}
            </span>
          ) : changePct !== undefined && changePct !== null ? (
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                changePct >= 0 ? "rsl-pill-forest" : "rsl-pill-sunset"
              }`}
            >
              {changePct >= 0 ? `+${changePct}%` : `${changePct}%`}
            </span>
          ) : null}
        </div>

        <div className="mt-2.5 flex items-baseline justify-between gap-2">
          <div
            title={value}
            className={`rsl-display-metric min-w-0 font-semibold tracking-[-0.03em] text-[var(--ink)] tabular-nums ${
              isLongText
                ? "truncate text-[17px] leading-snug sm:text-[18px]"
                : "text-[23px] leading-none xl:text-[26px]"
            }`}
          >
            {value}
          </div>
          {icon && changePct !== undefined && changePct !== null && (
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                changePct >= 0 ? "rsl-pill-forest" : "rsl-pill-sunset"
              }`}
            >
              {changePct >= 0 ? `+${changePct}%` : `${changePct}%`}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-[var(--ink-muted)]">{sublabel}</p>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  noPadding = false,
  accent = "default",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
  accent?: "default" | "emerald" | "indigo" | "amber" | "sky" | "violet" | "ruby" | "teal";
}) {
  const isWarm = accent === "amber" || accent === "ruby";

  return (
    <section className="rsl-frost-card relative flex flex-col overflow-hidden rounded-2xl">
      {isWarm && (
        <div aria-hidden="true" className="rsl-accent-bar-sunset h-[2px] w-full shrink-0" />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-5 tracking-[-0.016em] text-[var(--ink)]">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--ink-muted)]">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className={noPadding ? "flex-1" : "flex-1 p-5 sm:p-6"}>{children}</div>
    </section>
  );
}

export function EmptyWorkspaceState({
  title,
  description,
  actionLabel,
  actionHref,
  secondaryLabel,
  secondaryHref,
  icon,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/75 px-6 py-10 text-center">
      <div className="mx-auto mb-3.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-emerald-700 shadow-2xs [&>svg]:h-5 [&>svg]:w-5 [&>svg]:shrink-0">
        {icon ?? (
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            className="inline-block h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        )}
      </div>
      <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-zinc-600">
        {description}
      </p>
      {(actionLabel || secondaryLabel) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {actionLabel && actionHref && (
            <a href={actionHref} className="rsl-btn-primary">
              {actionLabel}
            </a>
          )}
          {secondaryLabel && secondaryHref && (
            <a href={secondaryHref} className="rsl-btn-secondary">
              {secondaryLabel}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function AccessRestrictedState({
  pageTitle,
  roleLabel,
  requiredPermissionLabel,
  description,
  homeHref = "/",
  homeLabel = "Back to Overview",
  secondaryHref,
  secondaryLabel,
}: {
  pageTitle: string;
  roleLabel: string;
  requiredPermissionLabel?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="w-full py-4">
      <div className="rsl-frost-card mx-auto max-w-2xl rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            className="inline-block h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0v4" />
          </svg>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
          <span>Current Role:</span>
          <span className="font-bold text-slate-900">{roleLabel}</span>
        </div>

        <h1 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-slate-900">
          Access Restricted - {pageTitle}
        </h1>

        <p className="mx-auto mt-2 max-w-lg text-[13.5px] leading-relaxed text-zinc-600">
          {description ??
            `Your current role (${roleLabel}) does not include access to ${pageTitle}${
              requiredPermissionLabel ? ` (${requiredPermissionLabel})` : ""
            }. Ask a Business Owner or Admin if your responsibilities require this permission.`}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <a href={homeHref} className="rsl-btn-primary">
            {homeLabel}
          </a>
          {secondaryHref && secondaryLabel && (
            <a href={secondaryHref} className="rsl-btn-secondary">
              {secondaryLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  primary: number;
  secondary?: number;
}

export function DualSeriesAreaChart({
  points,
  primaryLabel,
  secondaryLabel,
  primaryColor = "var(--chart-primary)",
  secondaryColor = "var(--chart-secondary)",
  formatValue = (v) => String(v),
  emptyHint = "No activity recorded in this date window yet.",
}: {
  points: SeriesPoint[];
  primaryLabel: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
  formatValue?: (val: number) => string;
  emptyHint?: string;
}) {
  const width = 920;
  const height = 236;
  const padLeft = 68;
  const padRight = 22;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(1, ...points.map((p) => Math.max(p.primary, p.secondary ?? 0)));
  const primarySum = points.reduce((s, p) => s + p.primary, 0);
  const secondarySum = points.reduce((s, p) => s + (p.secondary ?? 0), 0);
  const totalSum = primarySum + secondarySum;

  const xFor = (idx: number) =>
    Math.round(
      points.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (points.length - 1)) * plotW
    );
  const yFor = (val: number) =>
    Math.round(padTop + plotH - (Math.max(0, val) / maxVal) * plotH);

  const primaryLine =
    points.length === 1
      ? `M${padLeft},${yFor(points[0]!.primary)} L${padLeft + plotW},${yFor(points[0]!.primary)}`
      : points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.primary)}`).join(" ");

  const primaryArea =
    points.length === 1
      ? `${primaryLine} L${padLeft + plotW},${padTop + plotH} L${padLeft},${padTop + plotH} Z`
      : points.length > 1
        ? `${primaryLine} L${xFor(points.length - 1)},${padTop + plotH} L${xFor(0)},${padTop + plotH} Z`
        : "";

  const secondaryLine =
    secondaryLabel !== undefined && points.length > 0
      ? points.length === 1
        ? `M${padLeft},${yFor(points[0]!.secondary ?? 0)} L${padLeft + plotW},${yFor(points[0]!.secondary ?? 0)}`
        : points
            .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.secondary ?? 0)}`)
            .join(" ")
      : "";

  const yTickRatios = [0, 0.33, 0.66, 1];
  const yTicks = yTickRatios.map((ratio) => {
    const val = totalSum === 0 ? 0 : Math.round(maxVal * ratio);
    return {
      ratio,
      y: Math.round(padTop + plotH - ratio * plotH),
      text: totalSum === 0 && ratio > 0 ? "" : formatValue(val),
    };
  });

  const labelStride = Math.max(1, Math.ceil(points.length / 7));
  const gradId = `rsl-grad-${primaryLabel.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

  const interactivePoints: InteractiveChartPoint[] = points.map((pt, idx) => ({
    label: pt.label,
    x: xFor(idx),
    primaryY: yFor(pt.primary),
    secondaryY: yFor(pt.secondary ?? 0),
    primaryRaw: pt.primary,
    secondaryRaw: pt.secondary ?? 0,
    primaryFormatted: formatValue(pt.primary),
    secondaryFormatted: formatValue(pt.secondary ?? 0),
  }));

  return (
    <InteractiveAreaChartCanvas
      width={width}
      height={height}
      padLeft={padLeft}
      padRight={padRight}
      padTop={padTop}
      plotH={plotH}
      gradId={gradId}
      primaryLabel={primaryLabel}
      secondaryLabel={secondaryLabel}
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      primarySumFormatted={formatValue(primarySum)}
      secondarySumFormatted={formatValue(secondarySum)}
      totalSum={totalSum}
      emptyHint={emptyHint}
      primaryLine={primaryLine}
      primaryArea={primaryArea}
      secondaryLine={secondaryLine}
      yTicks={yTicks}
      labelStride={labelStride}
      points={interactivePoints}
    />
  );
}

export function ConversionFunnelBars({
  steps,
}: {
  steps: Array<{
    step: string;
    plainDescription: string;
    count: number;
    conversionFromStartPct: number;
  }>;
}) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="space-y-3">
      {steps.map((item, idx) => {
        const widthPct = item.count === 0 ? 0 : Math.max(4, Math.round((item.count / max) * 100));
        return (
          <div
            key={item.step}
            className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <div>
                <span className="font-semibold text-slate-900">
                  {idx + 1}. {item.step}
                </span>
                <span className="ml-2 text-zinc-500">{item.plainDescription}</span>
              </div>
              <div className="shrink-0 font-semibold text-slate-900 tabular-nums">
                {item.count.toLocaleString("en-IN")}{" "}
                <span className="font-normal text-zinc-500">({item.conversionFromStartPct}%)</span>
              </div>
            </div>
            <progress
              value={widthPct}
              max={100}
              aria-label={`${item.step}: ${item.conversionFromStartPct}%`}
              className="rsl-progress mt-2.5"
            />
          </div>
        );
      })}
    </div>
  );
}

export function ReceivablesAgingStack({
  buckets,
  formatInrFn,
}: {
  buckets: Array<{ bucket: string; billsCount: number; amountPaise: number; sharePct: number }>;
  formatInrFn: (paise: number) => string;
}) {
  const segClasses = [
    "rsl-aging-seg-0",
    "rsl-aging-seg-1",
    "rsl-aging-seg-2",
    "rsl-aging-seg-3",
    "rsl-aging-seg-4",
  ] as const;
  const totalAmount = buckets.reduce((s, b) => s + b.amountPaise, 0);
  let runningX = 0;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-full bg-zinc-100 p-0.5 ring-1 ring-zinc-200/70">
        <svg
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          className="block h-3 w-full overflow-hidden rounded-full"
          role="img"
          aria-label="Receivables aging distribution"
        >
          {totalAmount > 0 &&
            buckets.map((b, i) => {
              if (b.sharePct <= 0) return null;
              const startX = runningX;
              runningX += b.sharePct;
              return (
                <rect
                  key={b.bucket}
                  x={startX}
                  y={0}
                  width={b.sharePct}
                  height={6}
                  className={segClasses[i % segClasses.length]}
                >
                  <title>{`${b.bucket}: ${formatInrFn(b.amountPaise)}`}</title>
                </rect>
              );
            })}
        </svg>
      </div>

      <div className="divide-y divide-zinc-100">
        {buckets.map((b, i) => (
          <div key={b.bucket} className="flex items-center justify-between py-2.5 text-[13px]">
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${segClasses[i % segClasses.length]}`}
              />
              <span className="font-medium text-slate-900">{b.bucket}</span>
              <span className="text-zinc-500">({b.billsCount} bills)</span>
            </div>
            <div className="font-semibold text-slate-900 tabular-nums">
              {formatInrFn(b.amountPaise)}{" "}
              <span className="font-normal text-zinc-500">({b.sharePct}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StarBreakdownCard({
  averageRating,
  totalReviews,
  stars,
}: {
  averageRating: number;
  totalReviews: number;
  stars: Array<{ star: number; count: number; sharePct: number }>;
}) {
  const filledStars = totalReviews > 0 ? Math.max(0, Math.min(5, Math.round(averageRating))) : 0;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-[148px_1fr] sm:items-center">
      <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-center">
        <div className="rsl-display-metric text-3xl font-semibold text-slate-900">
          {totalReviews > 0 ? averageRating.toFixed(1) : "0.0"}
        </div>
        <div className="mt-1 flex items-center justify-center gap-0.5 text-sm leading-none">
          {[1, 2, 3, 4, 5].map((idx) => (
            <span
              key={idx}
              className={idx <= filledStars ? "text-amber-500" : "text-zinc-300"}
            >
              ★
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-xs font-medium text-zinc-500 tabular-nums">
          {totalReviews} {totalReviews === 1 ? "review" : "reviews"}
        </div>
      </div>

      <div className="space-y-2.5">
        {stars.map((s) => (
          <div key={s.star} className="flex items-center gap-3 text-[13px]">
            <span className="w-10 shrink-0 font-medium text-slate-900 tabular-nums">
              {s.star} ★
            </span>
            <progress
              value={s.sharePct}
              max={100}
              aria-label={`${s.star} star share: ${s.sharePct}%`}
              className="rsl-progress rsl-progress-sunset flex-1"
            />
            <span className="w-20 shrink-0 text-right text-[12.5px] font-medium text-zinc-500 tabular-nums">
              {s.count} ({s.sharePct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderInlineGuideTokens(
  text: string,
  linkMode: "help" | "docs",
  keyPrefix: string
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(!\[([^\]]*)\]\(([^)]+)\))|(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const alt = match[2] ?? "";
      const src = match[3] ?? "";
      nodes.push(
        <img
          key={`${keyPrefix}-img-${idx++}`}
          src={src}
          alt={alt}
          loading="lazy"
          className="my-2 inline-block max-w-full rounded-xl border border-zinc-200 bg-white p-1"
        />
      );
    } else if (match[4]) {
      const label = match[5] ?? "";
      let href = match[6] ?? "#";
      if (linkMode === "help" && href.startsWith("/guides/")) {
        const targetSlug = href.replace(/^\/guides\//, "").split(/[?#]/)[0] ?? "";
        href = `/help?slug=${encodeURIComponent(targetSlug)}`;
      }
      nodes.push(
        <a
          key={`${keyPrefix}-lnk-${idx++}`}
          href={href}
          className="font-semibold text-emerald-600 underline decoration-emerald-600/40 underline-offset-2 transition hover:decoration-emerald-600"
        >
          {label}
        </a>
      );
    } else if (match[7]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${idx++}`}
          className="rounded-md border border-zinc-200 bg-zinc-100/80 px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-slate-900"
        >
          {match[8]}
        </code>
      );
    } else if (match[9]) {
      const bIdx = idx++;
      nodes.push(
        <strong key={`${keyPrefix}-b-${bIdx}`} className="font-semibold text-slate-900">
          {renderInlineGuideTokens(match[10] ?? "", linkMode, `${keyPrefix}-b-${bIdx}`)}
        </strong>
      );
    } else if (match[11]) {
      const iIdx = idx++;
      nodes.push(
        <em key={`${keyPrefix}-i-${iIdx}`} className="italic text-zinc-700">
          {renderInlineGuideTokens(match[12] ?? "", linkMode, `${keyPrefix}-i-${iIdx}`)}
        </em>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function FormattedGuideBody({
  markdown,
  linkMode = "docs",
}: {
  markdown: string;
  linkMode?: "help" | "docs";
}) {
  const lines = markdown.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];

  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let unorderedItems: Array<{ text: string; subBullets: string[] }> = [];
  let orderedItems: Array<{ num: number; text: string; subBullets: string[] }> = [];
  let quoteLines: string[] = [];
  let tableRows: string[][] = [];
  let blockIdx = 0;

  const flushUnordered = () => {
    if (unorderedItems.length === 0) return;
    const current = unorderedItems;
    unorderedItems = [];
    blocks.push(
      <ul key={`ul-${blockIdx++}`} className="my-3.5 space-y-2">
        {current.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-[14px] leading-[1.65] text-zinc-700"
          >
            <span className="mt-2.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
            <div className="min-w-0 flex-1">
              <div>{renderInlineGuideTokens(item.text, linkMode, `ul-${blockIdx}-${i}`)}</div>
              {item.subBullets.length > 0 && (
                <ul className="mt-1.5 space-y-1 pl-1">
                  {item.subBullets.map((sub, si) => (
                    <li
                      key={si}
                      className="flex items-start gap-2 text-[13px] leading-[1.6] text-zinc-600"
                    >
                      <span className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                      <span className="min-w-0 flex-1">
                        {renderInlineGuideTokens(sub, linkMode, `ulsub-${blockIdx}-${i}-${si}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const flushOrdered = () => {
    if (orderedItems.length === 0) return;
    const current = orderedItems;
    orderedItems = [];
    blocks.push(
      <ol key={`ol-${blockIdx++}`} className="my-4 space-y-2.5">
        {current.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 text-[14px] leading-[1.65] text-zinc-700"
          >
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/80 tabular-nums">
              {item.num}
            </span>
            <div className="min-w-0 flex-1">
              <div>{renderInlineGuideTokens(item.text, linkMode, `ol-${blockIdx}-${i}`)}</div>
              {item.subBullets.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-t border-zinc-200/70 pt-2">
                  {item.subBullets.map((sub, si) => (
                    <li
                      key={si}
                      className="flex items-start gap-2 text-[13px] leading-[1.6] text-zinc-600"
                    >
                      <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="min-w-0 flex-1">
                        {renderInlineGuideTokens(sub, linkMode, `olsub-${blockIdx}-${i}-${si}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const rawQuote = quoteLines.join(" ").trim();
    quoteLines = [];

    let variant: "tip" | "note" | "warning" | "important" = "tip";
    let label = "Tip";
    let bodyText = rawQuote;

    const alertMatch = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i.exec(rawQuote);
    const prefixMatch =
      /^(?:\*\*)?(Note|Tip|Warning|Important|Caution|Security)(?::)?(?:\*\*)?:?\s+(.*)$/i.exec(
        rawQuote
      );

    if (alertMatch) {
      const kind = alertMatch[1]!.toUpperCase();
      bodyText = alertMatch[2] || "";
      if (kind === "NOTE") {
        variant = "note";
        label = "Note";
      } else if (kind === "WARNING") {
        variant = "warning";
        label = "Warning";
      } else if (kind === "IMPORTANT" || kind === "CAUTION") {
        variant = "important";
        label = kind === "CAUTION" ? "Caution" : "Important";
      } else {
        variant = "tip";
        label = "Tip";
      }
    } else if (prefixMatch) {
      const kind = prefixMatch[1]!.toLowerCase();
      bodyText = prefixMatch[2] || "";
      if (kind === "note") {
        variant = "note";
        label = "Note";
      } else if (kind === "warning") {
        variant = "warning";
        label = "Warning";
      } else if (kind === "important" || kind === "caution" || kind === "security") {
        variant = "important";
        label = kind === "caution" ? "Caution" : kind === "security" ? "Security" : "Important";
      } else {
        variant = "tip";
        label = "Tip";
      }
    }

    const styles =
      variant === "note"
        ? {
            box: "border-sky-200 bg-sky-50/70 text-sky-950",
            badge: "bg-sky-100 text-sky-800 border-sky-200",
          }
        : variant === "warning"
          ? {
              box: "border-amber-200 bg-amber-50/75 text-amber-950",
              badge: "bg-amber-100 text-amber-900 border-amber-200",
            }
          : variant === "important"
            ? {
                box: "border-rose-200 bg-rose-50/75 text-rose-950",
                badge: "bg-rose-100 text-rose-800 border-rose-200",
              }
            : {
                box: "border-emerald-200 bg-emerald-50/65 text-emerald-950",
                badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
              };

    blocks.push(
      <div
        key={`q-${blockIdx++}`}
        role="note"
        className={`my-4 rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed ${styles.box}`}
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold tracking-wider uppercase ${styles.badge}`}
          >
            {label}
          </span>
        </div>
        <div>{renderInlineGuideTokens(bodyText || rawQuote, linkMode, `q-${blockIdx}`)}</div>
      </div>
    );
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const rows = tableRows;
    tableRows = [];
    const header = rows[0] ?? [];
    const body = rows.slice(1).filter((r) => !r.every((cell) => /^[-:\s]+$/.test(cell)));
    blocks.push(
      <div
        key={`tbl-${blockIdx++}`}
        className="my-4 overflow-x-auto rounded-xl border border-zinc-200"
      >
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              {header.map((cell, ci) => (
                <th key={ci} className="px-4 py-2.5 font-semibold">
                  {renderInlineGuideTokens(cell, linkMode, `th-${blockIdx}-${ci}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2.5 text-zinc-700">
                    {renderInlineGuideTokens(cell, linkMode, `td-${blockIdx}-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const flushAll = () => {
    flushUnordered();
    flushOrdered();
    flushQuote();
    flushTable();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      flushAll();
      if (inCode) {
        blocks.push(
          <CopyCodeBlock
            key={`code-${blockIdx++}`}
            code={codeLines.join("\n")}
            language={codeLang}
          />
        );
        codeLines = [];
        codeLang = "";
        inCode = false;
      } else {
        codeLang = trimmed.slice(3).trim();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushUnordered();
      flushOrdered();
      flushQuote();
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (tableRows.length > 0) {
      flushTable();
    }

    if (trimmed.startsWith(">")) {
      flushUnordered();
      flushOrdered();
      const qLine = trimmed.replace(/^>\s?/, "").trim();
      if (qLine) {
        quoteLines.push(qLine);
      }
      continue;
    } else if (quoteLines.length > 0) {
      flushQuote();
    }

    const standaloneImageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (standaloneImageMatch) {
      flushAll();
      const alt = standaloneImageMatch[1] ?? "";
      const src = standaloneImageMatch[2] ?? "";
      blocks.push(
        <figure
          key={`img-${blockIdx++}`}
          className="my-5 overflow-hidden rounded-2xl border border-zinc-200/90 bg-zinc-50/70 p-3 shadow-2xs"
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="mx-auto block max-w-full rounded-xl bg-white"
          />
          {alt && (
            <figcaption className="mt-2.5 text-center text-xs font-medium text-zinc-500">
              {alt}
            </figcaption>
          )}
        </figure>
      );
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushAll();
      const headingText = trimmed.slice(3).trim();
      const id = headingText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      blocks.push(
        <h2
          key={`h2-${blockIdx++}`}
          id={id}
          className="mt-8 mb-3 border-b border-zinc-100 pb-2 text-[20px] font-bold tracking-[-0.02em] text-slate-900 first:mt-0"
        >
          {renderInlineGuideTokens(headingText, linkMode, `h2-${blockIdx}`)}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushAll();
      const headingText = trimmed.slice(4).trim();
      const id = headingText
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      blocks.push(
        <h3
          key={`h3-${blockIdx++}`}
          id={id}
          className="mt-6 mb-2 text-[17px] font-semibold tracking-[-0.015em] text-slate-900"
        >
          {renderInlineGuideTokens(headingText, linkMode, `h3-${blockIdx}`)}
        </h3>
      );
      continue;
    }

    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      flushAll();
      blocks.push(<hr key={`hr-${blockIdx++}`} className="my-6 border-zinc-200/80" />);
      continue;
    }

    if (trimmed.startsWith("#### ")) {
      flushAll();
      const headingText = trimmed.slice(5).trim();
      blocks.push(
        <h4
          key={`h4-${blockIdx++}`}
          className="mt-4 mb-1.5 text-[15px] font-semibold text-slate-900"
        >
          {renderInlineGuideTokens(headingText, linkMode, `h4-${blockIdx}`)}
        </h4>
      );
      continue;
    }

    const indentedSubBullet = /^\s{2,}[-*]\s+(.+)$/.exec(rawLine);
    if (indentedSubBullet) {
      const subText = indentedSubBullet[1]!.trim();
      if (orderedItems.length > 0) {
        orderedItems[orderedItems.length - 1]!.subBullets.push(subText);
        continue;
      }
      if (unorderedItems.length > 0) {
        unorderedItems[unorderedItems.length - 1]!.subBullets.push(subText);
        continue;
      }
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      flushOrdered();
      unorderedItems.push({ text: trimmed.slice(2).trim(), subBullets: [] });
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (orderedMatch) {
      flushUnordered();
      orderedItems.push({
        num: Number(orderedMatch[1]),
        text: orderedMatch[2]!.trim(),
        subBullets: [],
      });
      continue;
    }

    flushAll();
    blocks.push(
      <p key={`p-${blockIdx++}`} className="my-2.5 text-[14px] leading-[1.65] text-zinc-700">
        {renderInlineGuideTokens(trimmed, linkMode, `p-${blockIdx}`)}
      </p>
    );
  }

  flushAll();

  return <div className="text-[14px] leading-[1.65] text-zinc-700">{blocks}</div>;
}

const ONES_WORDS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS_WORDS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES_WORDS[n] ?? "";
  const ten = Math.floor(n / 10);
  const rem = n % 10;
  return `${TENS_WORDS[ten] ?? ""}${rem > 0 ? ` ${ONES_WORDS[rem] ?? ""}` : ""}`.trim();
}

function integerToIndianWords(num: number): string {
  if (num === 0) return "Zero";
  let n = Math.floor(Math.abs(num));
  const parts: string[] = [];

  const crore = Math.floor(n / 10_000_000);
  if (crore > 0) {
    parts.push(`${integerToIndianWords(crore)} Crore`);
    n %= 10_000_000;
  }
  const lakh = Math.floor(n / 100_000);
  if (lakh > 0) {
    parts.push(`${twoDigitWords(lakh)} Lakh`);
    n %= 100_000;
  }
  const thousand = Math.floor(n / 1_000);
  if (thousand > 0) {
    parts.push(`${twoDigitWords(thousand)} Thousand`);
    n %= 1_000;
  }
  const hundred = Math.floor(n / 100);
  if (hundred > 0) {
    parts.push(`${ONES_WORDS[hundred]} Hundred`);
    n %= 100;
  }
  if (n > 0) {
    parts.push(twoDigitWords(n));
  }
  return parts.join(" ").trim();
}

export function paiseToIndianWords(paise: number): string {
  const safePaise = Math.max(0, Math.round(paise));
  const rupees = Math.floor(safePaise / 100);
  const remPaise = safePaise % 100;
  const rupeePart = `Rupees ${integerToIndianWords(rupees)}`;
  if (remPaise > 0) {
    return `${rupeePart} and ${twoDigitWords(remPaise)} Paise Only`;
  }
  return `${rupeePart} Only`;
}

function formatRupeeExact(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export interface GstTaxInvoiceDocumentProps {
  invoiceNumber: string;
  docType?: string;
  linkedInvoiceNumber?: string | null;
  description: string;
  sacCode: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  status: string;
  issuedAt: number;
  paidAt: number | null;
  buyerName: string;
  buyerGstin: string | null;
  buyerStateCode: string;
  buyerStateName: string;
  supplierName: string;
  supplierGstin: string;
  supplierStateCode: string;
  supplierStateName: string;
  supplierEmail: string;
  supplierPhone: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  upiId: string;
  paymentMethod: string | null;
  paymentReference: string | null;
}

export function GstTaxInvoiceDocument(props: GstTaxInvoiceDocumentProps) {
  const isAdvanceReceipt = props.docType === "advance_receipt";
  const isCreditNote = props.docType === "credit_note";
  const isInterState = props.igstPaise !== 0;
  const totalGstPaise = props.cgstPaise + props.sgstPaise + props.igstPaise;
  const sacCode = props.sacCode || "998314";
  const docHeading = isAdvanceReceipt
    ? "Advance Receipt Voucher (0% GST Deposit)"
    : isCreditNote
      ? "GST Credit Note (Sec. 34 CGST Act)"
      : "Tax Invoice (Original for Recipient)";
  const totalRowLabel = isCreditNote
    ? "Total Credited (INR)"
    : isAdvanceReceipt
      ? "Deposit Received (INR)"
      : "Total Payable (INR)";
  const statusTone =
    props.status === "paid" ? "emerald" : props.status === "void" ? "ruby" : "amber";
  const statusLabel = isCreditNote
    ? "SEC. 34 CREDIT NOTE"
    : props.status === "paid"
      ? "PAID IN FULL"
      : props.status === "void"
        ? "VOID"
        : "ISSUED • UNPAID";

  const issuedDateStr = new Date(props.issuedAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const paidDateStr = props.paidAt
    ? new Date(props.paidAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : null;

  return (
    <div
      id="rsl-print-sheet"
      className="rsl-frost-card mx-auto max-w-4xl overflow-hidden rounded-2xl text-slate-900"
    >
      {/* Top Corporate Stationery Accent Bar */}
      <div className="rsl-top-seam flex h-1.5 w-full" />

      <div className="p-6 sm:p-10">
      {/* Top Document Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-col items-start gap-2">
            <img
              src="/long-logo-nobg.png"
              alt="RapidShift Labs"
              width={122}
              height={36}
              draggable={false}
              className="rsl-brand-logo-img rsl-logo-invoice shrink-0 select-none object-contain"
            />
            <div>
              <div className="text-base font-bold tracking-tight text-slate-900">
                {props.supplierName}
              </div>
              <div className="text-xs text-zinc-500">
                Cloud Marketing, WhatsApp Business &amp; Tally Automation Suite
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-0.5 text-xs text-zinc-600">
            <div>
              Supplier GSTIN:{" "}
              <strong className="font-mono text-slate-900">{props.supplierGstin}</strong>
            </div>
            <div>
              Origin State: {props.supplierStateName} ({props.supplierStateCode})
            </div>
            <div>
              Support: {props.supplierEmail} • {props.supplierPhone}
            </div>
          </div>
        </div>

        <div className="sm:text-right">
          <div className="text-xs font-bold tracking-[0.1em] text-zinc-500 uppercase">
            {docHeading}
          </div>
          <div className="mt-1 font-mono text-xl font-bold tracking-tight text-slate-900">
            {props.invoiceNumber}
          </div>
          {isCreditNote && props.linkedInvoiceNumber ? (
            <div className="mt-1 text-xs font-medium text-zinc-600">
              Against Tax Invoice #{props.linkedInvoiceNumber}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:justify-end">
            <StatusPill label={statusLabel} tone={statusTone} />
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-xs font-medium text-zinc-700">
              SAC {sacCode}
            </span>
          </div>
          <div className="mt-2.5 space-y-0.5 text-xs text-zinc-600 tabular-nums">
            <div>
              Invoice Date: <strong className="text-slate-900">{issuedDateStr}</strong>
            </div>
            {paidDateStr && (
              <div>
                Paid Date: <strong className="text-emerald-700">{paidDateStr}</strong>
              </div>
            )}
            <div>
              Reverse Charge: <strong className="text-slate-900">No</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Billed To & Place of Supply */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-4 text-xs">
          <div className="text-[10px] font-bold tracking-[0.08em] text-zinc-500 uppercase">
            Billed To (Recipient)
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">{props.buyerName}</div>
          <div className="mt-1 space-y-0.5 text-zinc-600">
            <div>
              Buyer GSTIN:{" "}
              <strong className="font-mono text-slate-900">
                {props.buyerGstin || "Unregistered / B2C"}
              </strong>
            </div>
            <div>
              Billing State: {props.buyerStateName} ({props.buyerStateCode})
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-4 text-xs">
          <div className="text-[10px] font-bold tracking-[0.08em] text-zinc-500 uppercase">
            Supply &amp; Tax Classification
          </div>
          <div className="mt-1.5 space-y-1 text-zinc-600">
            <div>
              Place of Supply:{" "}
              <strong className="text-slate-900">
                {props.buyerStateName} (Code {props.buyerStateCode})
              </strong>
            </div>
            <div>
              Tax Regime:{" "}
              <strong className="text-slate-900">
                {isAdvanceReceipt
                  ? "Prepaid Deposit (0% GST - Tax Invoice issued on usage)"
                  : isInterState
                    ? "Inter-State Supply (18% IGST)"
                    : "Intra-State Supply (9% CGST + 9% SGST)"}
              </strong>
            </div>
            <div>
              Service Category:{" "}
              <strong className="text-slate-900">IT &amp; Cloud Software Services</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Itemized Tax Table */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200/90">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            Itemized GST line items for invoice {props.invoiceNumber}
          </caption>
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">#</th>
              <th scope="col" className="px-4 py-3">Description of Service</th>
              <th scope="col" className="px-4 py-3 font-mono">SAC</th>
              <th scope="col" className="px-4 py-3 text-right">Taxable Value</th>
              {isInterState ? (
                <th scope="col" className="px-4 py-3 text-right">IGST (18%)</th>
              ) : (
                <>
                  <th scope="col" className="px-4 py-3 text-right">CGST (9%)</th>
                  <th scope="col" className="px-4 py-3 text-right">SGST (9%)</th>
                </>
              )}
              <th scope="col" className="px-4 py-3 text-right">Total (INR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white">
            <tr>
              <td className="px-4 py-4 font-mono text-zinc-500">01</td>
              <td className="px-4 py-4">
                <div className="font-semibold text-slate-900">{props.description}</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  Cloud software subscription / prepaid messaging credit
                </div>
              </td>
              <td className="px-4 py-4 font-mono text-zinc-700">{props.sacCode}</td>
              <td className="px-4 py-4 text-right font-medium tabular-nums text-slate-900">
                {formatRupeeExact(props.subtotalPaise)}
              </td>
              {isInterState ? (
                <td className="px-4 py-4 text-right tabular-nums text-zinc-700">
                  {formatRupeeExact(props.igstPaise)}
                </td>
              ) : (
                <>
                  <td className="px-4 py-4 text-right tabular-nums text-zinc-700">
                    {formatRupeeExact(props.cgstPaise)}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums text-zinc-700">
                    {formatRupeeExact(props.sgstPaise)}
                  </td>
                </>
              )}
              <td className="px-4 py-4 text-right font-bold tabular-nums text-slate-900">
                {formatRupeeExact(props.totalPaise)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Words, Payment Settlement & Summary Totals */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-3 text-xs">
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5">
            <div className="text-[10px] font-bold tracking-[0.08em] text-zinc-500 uppercase">
              Total Invoice Amount in Words
            </div>
            <div className="mt-1 font-semibold text-slate-900">
              {paiseToIndianWords(props.totalPaise)}
            </div>
          </div>

          {props.status === "paid" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-emerald-950">
              <div className="text-[10px] font-bold tracking-[0.08em] text-emerald-700 uppercase">
                Payment Settlement Details
              </div>
              <div className="mt-1 font-medium">
                Settled in full
                {props.paymentMethod ? ` via ${props.paymentMethod.toUpperCase()}` : ""}
                {props.paymentReference ? (
                  <>
                    {" "}
                    • Reference:{" "}
                    <span className="font-mono font-bold">{props.paymentReference}</span>
                  </>
                ) : null}
              </div>
            </div>
          ) : props.status === "issued" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 text-amber-950">
              <div className="text-[10px] font-bold tracking-[0.08em] text-amber-800 uppercase">
                Bank &amp; UPI Remittance Details
              </div>
              <div className="mt-1 space-y-0.5 text-xs">
                <div>
                  Bank: <strong>{props.bankName}</strong> • A/C{" "}
                  <strong className="font-mono">{props.accountNumber}</strong> • IFSC{" "}
                  <strong className="font-mono">{props.ifscCode}</strong>
                </div>
                {props.upiId && !props.upiId.endsWith(".ifsc.npci") ? (
                  <div>
                    UPI ID: <strong className="font-mono">{props.upiId}</strong>
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-900/80">
                    Direct Bank Transfer via UPI QR (Account + IFSC) &amp; NEFT/IMPS supported
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-4 text-xs tabular-nums">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-zinc-600">
              <span>Subtotal (Before Tax)</span>
              <span className="font-medium text-slate-900">
                {formatRupeeExact(props.subtotalPaise)}
              </span>
            </div>
            {isAdvanceReceipt ? (
              <div className="flex items-center justify-between text-zinc-600">
                <span>GST on Prepaid Deposit (0%)</span>
                <span className="font-medium text-slate-900">{formatRupeeExact(0)}</span>
              </div>
            ) : isInterState ? (
              <div className="flex items-center justify-between text-zinc-600">
                <span>IGST (18% Inter-State)</span>
                <span className="font-medium text-slate-900">
                  {formatRupeeExact(props.igstPaise)}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>CGST (9% Central Tax)</span>
                  <span className="font-medium text-slate-900">
                    {formatRupeeExact(props.cgstPaise)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>SGST (9% State Tax)</span>
                  <span className="font-medium text-slate-900">
                    {formatRupeeExact(props.sgstPaise)}
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-zinc-600">
              <span>{isAdvanceReceipt ? "Total GST (0%)" : "Total GST (18%)"}</span>
              <span className="font-medium text-slate-900">
                {formatRupeeExact(totalGstPaise)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2.5 text-sm font-bold text-slate-900">
              <span>{totalRowLabel}</span>
              <span className={`text-base ${isCreditNote ? "text-rose-700" : "text-emerald-700"}`}>
                {formatRupeeExact(props.totalPaise)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Statutory Footer */}
      <div className="mt-8 flex flex-col justify-between gap-3 border-t border-zinc-200 pt-4 text-[11px] text-zinc-500 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo-nobg.png"
            alt="RapidShift Labs"
            width={18}
            height={18}
            draggable={false}
            className="rsl-brand-logo-img rsl-logo-invoice-sm shrink-0 select-none object-contain opacity-85"
          />
          <span>
            Computer-generated GST Tax Invoice issued under Rule 46 of the CGST Rules, 2017. Physical
            signature is not required.
          </span>
        </div>
        <span className="shrink-0 font-semibold text-slate-700">For {props.supplierName}</span>
      </div>
      </div>
    </div>
  );
}
