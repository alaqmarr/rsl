import React from "react";

export {
  FlashBanner,
  SileoToastProvider,
  sileo,
  triggerSileoToast,
  type FlashToastPayload,
} from "./sileo-toast";

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
          src="/logo-nobg.svg"
          alt="RapidShift Labs"
          width={px}
          height={px}
          draggable={false}
          style={{ width: px, height: px, flexShrink: 0 }}
          className="shrink-0 select-none object-contain"
        />
        {subtitle ? (
          <span className="truncate text-[11px] font-medium text-zinc-500">{subtitle}</span>
        ) : null}
      </span>
    );
  }

  const h = BRAND_LONG_HEIGHT_PX[size];
  const w = Math.round(h * (1536 / 453));

  return (
    <span className={`inline-flex min-w-0 flex-col items-start ${className}`}>
      <img
        src="/long-logo-nobg.svg"
        alt="RapidShift Labs"
        width={w}
        height={h}
        draggable={false}
        style={{ height: h, width: "auto", maxWidth: "100%", flexShrink: 0 }}
        className="shrink-0 select-none object-contain"
      />
      {subtitle ? (
        <span className="mt-1 block truncate text-[10.5px] font-medium leading-none text-zinc-500">
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
      className={`no-print mt-auto shrink-0 border-t border-zinc-200/85 bg-white/95 px-5 py-4 text-xs text-zinc-500 lg:px-8 xl:px-10 ${className}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2.5">
          <img
            src="/long-logo-nobg.svg"
            alt="RapidShift Labs"
            width={75}
            height={22}
            draggable={false}
            style={{ height: 20, width: "auto", flexShrink: 0 }}
            className="shrink-0 select-none object-contain opacity-90"
          />
          <span className="hidden text-zinc-300 sm:inline">•</span>
          <span className="font-medium text-slate-700">{suiteLabel}</span>
          <span className="text-zinc-400">© {year} RapidShift Labs</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-medium text-zinc-500">
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
      style={{
        display: "inline-block",
        verticalAlign: "-0.14em",
        flexShrink: 0,
      }}
      className={`inline-block shrink-0 select-none align-middle ${className}`}
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
          style={{
            animation: "rsl-ios-blade-fade 0.92s linear infinite",
            animationDelay: `${(-((12 - idx) / 12) * 0.92).toFixed(4)}s`,
          }}
        />
      ))}
    </svg>
  );
}

export function WorkspaceLoadingScreen({
  label = "Loading...",
  dark = false,
}: {
  label?: string;
  dark?: boolean;
}) {
  return (
    <div className="w-full animate-fadeIn space-y-6 py-1">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div
            className={`h-6 w-52 animate-pulse rounded-lg ${
              dark ? "bg-slate-800" : "bg-zinc-200/80"
            }`}
          />
          <div
            className={`h-3.5 w-80 max-w-[75vw] animate-pulse rounded-md ${
              dark ? "bg-slate-800/70" : "bg-zinc-200/60"
            }`}
          />
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-2xs">
          <IosSpinner size="xs" className="text-emerald-600" />
          <span>{label}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200/85 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-28 animate-pulse rounded bg-zinc-200/70" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-zinc-100" />
            </div>
            <div className="mt-4 h-7 w-28 animate-pulse rounded-lg bg-zinc-200/80" />
            <div className="mt-4 h-3 w-40 animate-pulse rounded bg-zinc-100" />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200/85 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/70 px-6 py-4">
          <div className="h-4 w-44 animate-pulse rounded bg-zinc-200/75" />
          <div className="h-7 w-28 animate-pulse rounded-lg bg-zinc-200/60" />
        </div>
        <div className="divide-y divide-zinc-100 px-6 py-2">
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className="flex items-center justify-between gap-4 py-4">
              <div className="space-y-2">
                <div className="h-3.5 w-48 animate-pulse rounded bg-zinc-200/75" />
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

export type Tone = "emerald" | "amber" | "ruby" | "sky" | "stone" | "copper" | "neutral";

const TONE_STYLES: Record<Tone, { bg: string; text: string; border: string; dot: string }> = {
  emerald: { bg: "#ECFDF5", text: "#047857", border: "#A7F3D0", dot: "#059669" },
  amber: { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", dot: "#D97706" },
  ruby: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", dot: "#DC2626" },
  sky: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", dot: "#2563EB" },
  stone: { bg: "#F4F4F5", text: "#3F3F46", border: "#E4E4E7", dot: "#71717A" },
  neutral: { bg: "#F4F4F5", text: "#3F3F46", border: "#E4E4E7", dot: "#71717A" },
  copper: { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA", dot: "#EA580C" },
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
  const s = TONE_STYLES[tone] ?? TONE_STYLES.stone;
  return (
    <span
      style={{
        backgroundColor: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] leading-none font-medium tracking-tight whitespace-nowrap tabular-nums"
    >
      {showDot && (
        <span
          style={{ backgroundColor: s.dot, width: 6, height: 6, flexShrink: 0 }}
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        />
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
    <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {(eyebrow || badge) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {typeof eyebrow === "string" ? (
              <span className="text-[11px] font-semibold tracking-[0.07em] text-zinc-500 uppercase">
                {eyebrow}
              </span>
            ) : (
              eyebrow
            )}
            {badge}
          </div>
        )}
        <h1 className="text-[22px] sm:text-[24px] font-semibold leading-[1.25] tracking-[-0.025em] text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-3xl text-[13.5px] sm:text-sm leading-relaxed text-zinc-600">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
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
  accent?: "default" | "emerald" | "amber" | "ruby" | "copper" | "sky";
  icon?: React.ReactNode;
}) {
  const accents = {
    emerald: {
      bar: "#059669",
      chipBg: "bg-emerald-50 text-emerald-600 ring-emerald-200/70",
      dot: "bg-emerald-500",
    },
    amber: {
      bar: "#D97706",
      chipBg: "bg-amber-50 text-amber-600 ring-amber-200/70",
      dot: "bg-amber-500",
    },
    ruby: {
      bar: "#DC2626",
      chipBg: "bg-rose-50 text-rose-600 ring-rose-200/70",
      dot: "bg-rose-500",
    },
    copper: {
      bar: "#EA580C",
      chipBg: "bg-orange-50 text-orange-600 ring-orange-200/70",
      dot: "bg-orange-500",
    },
    sky: {
      bar: "#0284C7",
      chipBg: "bg-sky-50 text-sky-600 ring-sky-200/70",
      dot: "bg-sky-500",
    },
    default: {
      bar: "#E4E4E7",
      chipBg: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
      dot: "bg-zinc-400",
    },
  };
  const accentMap = accents[accent] ?? accents.default;
  const isLongText = value.length > 15;

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 hover:border-zinc-300/90 hover:shadow-[0_6px_16px_-6px_rgba(15,23,42,0.08)]">
      <div>
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              style={{ width: 8, height: 8, flexShrink: 0 }}
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${accentMap.dot}`}
            />
            <span className="truncate text-[12.5px] font-medium tracking-tight text-zinc-600">
              {label}
            </span>
          </div>

          {icon ? (
            <span
              style={{ width: 32, height: 32, flexShrink: 0 }}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${accentMap.chipBg}`}
            >
              {icon}
            </span>
          ) : changePct !== undefined && changePct !== null ? (
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                changePct >= 0
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {changePct >= 0 ? `+${changePct}%` : `${changePct}%`}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <div
            title={value}
            className={`min-w-0 font-semibold tracking-[-0.03em] text-slate-900 tabular-nums ${
              isLongText
                ? "truncate text-[17px] sm:text-[18px] leading-snug"
                : "text-[26px] xl:text-[28px] leading-none"
            }`}
          >
            {value}
          </div>
          {icon && changePct !== undefined && changePct !== null && (
            <span
              className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                changePct >= 0
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {changePct >= 0 ? `+${changePct}%` : `${changePct}%`}
            </span>
          )}
        </div>
      </div>

      <p className="mt-3.5 border-t border-zinc-100 pt-2.5 text-[12px] leading-4 text-zinc-500">
        {sublabel}
      </p>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  noPadding = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/55 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-5 tracking-[-0.015em] text-slate-900">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">{subtitle}</p>
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
    <div className="rounded-2xl border border-dashed border-zinc-300/90 bg-zinc-50/60 px-6 py-10 text-center">
      <div
        style={{ width: 44, height: 44, flexShrink: 0 }}
        className="mx-auto mb-3.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-emerald-600 shadow-2xs [&>svg]:h-5 [&>svg]:w-5 [&>svg]:shrink-0"
      >
        {icon ?? (
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            style={{ display: "inline-block", flexShrink: 0 }}
            className="h-5 w-5 shrink-0"
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
      <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-200/90 bg-white p-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div
          style={{ width: 44, height: 44, flexShrink: 0 }}
          className="mx-auto mb-4 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700"
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            style={{ display: "inline-block", flexShrink: 0 }}
            className="h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0v4" />
          </svg>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-semibold text-zinc-700">
          <span>Current Role:</span>
          <span className="font-bold text-slate-900">{roleLabel}</span>
        </div>

        <h1 className="mt-3 text-lg font-bold tracking-[-0.015em] text-slate-900">
          Access Restricted — {pageTitle}
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
  primaryColor = "#059669",
  secondaryColor = "#D97706",
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
    points.length <= 1 ? padLeft + plotW / 2 : padLeft + (idx / (points.length - 1)) * plotW;
  const yFor = (val: number) => padTop + plotH - (Math.max(0, val) / maxVal) * plotH;

  const primaryLine =
    points.length === 1
      ? `M${padLeft.toFixed(1)},${yFor(points[0]!.primary).toFixed(1)} L${(padLeft + plotW).toFixed(1)},${yFor(points[0]!.primary).toFixed(1)}`
      : points
          .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.primary).toFixed(1)}`)
          .join(" ");

  const primaryArea =
    points.length === 1
      ? `${primaryLine} L${(padLeft + plotW).toFixed(1)},${(padTop + plotH).toFixed(1)} L${padLeft.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : points.length > 1
      ? `${primaryLine} L${xFor(points.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${xFor(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : "";

  const secondaryLine =
    secondaryLabel !== undefined && points.length > 0
      ? points.length === 1
        ? `M${padLeft.toFixed(1)},${yFor(points[0]!.secondary ?? 0).toFixed(1)} L${(padLeft + plotW).toFixed(1)},${yFor(points[0]!.secondary ?? 0).toFixed(1)}`
        : points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.secondary ?? 0).toFixed(1)}`
            )
            .join(" ")
      : "";

  const yTicks = [0, 0.33, 0.66, 1];
  const labelStride = Math.max(1, Math.ceil(points.length / 7));
  const gradId = `rsl-grad-${primaryLabel.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;

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
            <span className="tabular-nums">{formatValue(primarySum)}</span>
          </span>
          {secondaryLabel && (
            <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ width: 10, height: 10, backgroundColor: secondaryColor }}
              />
              <span>{secondaryLabel}:</span>
              <span className="tabular-nums">{formatValue(secondarySum)}</span>
            </span>
          )}
        </div>
        {totalSum === 0 && <span className="text-[12px] font-medium text-zinc-500">{emptyHint}</span>}
      </div>

      <div className="w-full overflow-x-auto">
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

          {yTicks.map((ratio) => {
            const val = totalSum === 0 ? 0 : Math.round(maxVal * ratio);
            const y = padTop + plotH - ratio * plotH;
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke={ratio === 0 ? "#E4E4E7" : "#F4F4F5"}
                  strokeDasharray={ratio === 0 ? undefined : "4 4"}
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-zinc-400 text-[11px] font-medium tabular-nums"
                >
                  {totalSum === 0 && ratio > 0 ? "" : formatValue(val)}
                </text>
              </g>
            );
          })}

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

          {totalSum > 0 &&
            points.map((pt, idx) =>
              pt.primary > 0 ? (
                <circle
                  key={`pt-${idx}`}
                  cx={xFor(idx)}
                  cy={yFor(pt.primary)}
                  r={3.5}
                  fill="#FFFFFF"
                  stroke={primaryColor}
                  strokeWidth={2}
                >
                  <title>{`${pt.label}: ${formatValue(pt.primary)}`}</title>
                </circle>
              ) : null
            )}

          {points.map((pt, idx) => {
            if (idx % labelStride !== 0 && idx !== points.length - 1) return null;
            return (
              <text
                key={`${pt.label}-${idx}`}
                x={xFor(idx)}
                y={height - 8}
                textAnchor="middle"
                className="fill-zinc-500 text-[11px] font-medium tabular-nums"
              >
                {pt.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
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
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200/75">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
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
  const colors = ["#059669", "#D97706", "#EA580C", "#DC2626", "#991B1B"];
  const totalAmount = buckets.reduce((s, b) => s + b.amountPaise, 0);

  return (
    <div className="space-y-4">
      <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-100 p-0.5 ring-1 ring-zinc-200/70">
        {totalAmount > 0 &&
          buckets.map((b, i) =>
            b.sharePct > 0 ? (
              <div
                key={b.bucket}
                className="rounded-xs first:rounded-l-full last:rounded-r-full"
                style={{ width: `${b.sharePct}%`, backgroundColor: colors[i] }}
                title={`${b.bucket}: ${formatInrFn(b.amountPaise)}`}
              />
            ) : null
          )}
      </div>

      <div className="divide-y divide-zinc-100">
        {buckets.map((b, i) => (
          <div key={b.bucket} className="flex items-center justify-between py-2.5 text-[13px]">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ width: 10, height: 10, backgroundColor: colors[i] }}
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
        <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
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
        <div className="mt-1.5 text-[12px] font-medium text-zinc-500 tabular-nums">
          {totalReviews} {totalReviews === 1 ? "review" : "reviews"}
        </div>
      </div>

      <div className="space-y-2.5">
        {stars.map((s) => (
          <div key={s.star} className="flex items-center gap-3 text-[13px]">
            <span className="w-10 shrink-0 font-medium text-slate-900 tabular-nums">
              {s.star} ★
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/60">
              <div
                className="h-full rounded-full bg-amber-500"
                style={{ width: `${s.sharePct}%` }}
              />
            </div>
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
  const tokenRegex = /(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const label = match[2] ?? "";
      let href = match[3] ?? "#";
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
    } else if (match[4]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${idx++}`}
          className="rounded-md border border-zinc-200 bg-zinc-100/80 px-1.5 py-0.5 font-mono text-[12.5px] font-medium text-slate-900"
        >
          {match[5]}
        </code>
      );
    } else if (match[6]) {
      const bIdx = idx++;
      nodes.push(
        <strong key={`${keyPrefix}-b-${bIdx}`} className="font-semibold text-slate-900">
          {renderInlineGuideTokens(match[7] ?? "", linkMode, `${keyPrefix}-b-${bIdx}`)}
        </strong>
      );
    } else if (match[8]) {
      const iIdx = idx++;
      nodes.push(
        <em key={`${keyPrefix}-i-${iIdx}`} className="italic text-zinc-700">
          {renderInlineGuideTokens(match[9] ?? "", linkMode, `${keyPrefix}-i-${iIdx}`)}
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
            <span
              style={{ width: 6, height: 6, flexShrink: 0 }}
              className="mt-2.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
            />
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
            <span
              style={{ minWidth: 24, height: 24, flexShrink: 0 }}
              className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200/80 tabular-nums"
            >
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
    const text = quoteLines.join(" ");
    quoteLines = [];
    blocks.push(
      <div
        key={`q-${blockIdx++}`}
        className="my-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13.5px] leading-relaxed text-emerald-950"
      >
        {renderInlineGuideTokens(text, linkMode, `q-${blockIdx}`)}
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
          <div
            key={`code-${blockIdx++}`}
            className="my-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xs"
          >
            {codeLang && (
              <div className="border-b border-slate-800 bg-slate-900/90 px-4 py-1.5 font-mono text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                {codeLang}
              </div>
            )}
            <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-slate-100">
              <code>{codeLines.join("\n")}</code>
            </pre>
          </div>
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

    if (trimmed.startsWith("> ")) {
      flushUnordered();
      flushOrdered();
      quoteLines.push(trimmed.slice(2).trim());
      continue;
    } else if (quoteLines.length > 0) {
      flushQuote();
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
          className="mt-7 mb-2.5 border-b border-zinc-100 pb-2 text-[17px] font-semibold tracking-[-0.02em] text-slate-900 first:mt-0"
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
          className="mt-5 mb-2 text-[14.5px] font-semibold tracking-[-0.015em] text-slate-900"
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
          className="mt-4 mb-1.5 text-[13.5px] font-semibold text-slate-900"
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
  const isInterState = props.igstPaise > 0;
  const totalGstPaise = props.cgstPaise + props.sgstPaise + props.igstPaise;
  const statusTone =
    props.status === "paid" ? "emerald" : props.status === "void" ? "ruby" : "amber";
  const statusLabel =
    props.status === "paid"
      ? "PAID"
      : props.status === "void"
        ? "VOID"
        : "ISSUED • UNPAID";

  const issuedDateStr = new Date(props.issuedAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const paidDateStr = props.paidAt
    ? new Date(props.paidAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      id="rsl-print-sheet"
      className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-zinc-200/90 bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      {/* Top Corporate Stationery Accent Bar */}
      <div className="flex h-1.5 w-full">
        <div className="h-full w-3/4 bg-slate-900" />
        <div className="h-full w-1/4 bg-emerald-600" />
      </div>

      <div className="p-6 sm:p-10">
      {/* Top Document Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-col items-start gap-2">
            <img
              src="/long-logo-nobg.svg"
              alt="RapidShift Labs"
              width={122}
              height={36}
              draggable={false}
              style={{ height: 34, width: "auto", flexShrink: 0 }}
              className="shrink-0 select-none object-contain"
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
          <div className="text-[11px] font-bold tracking-[0.12em] text-zinc-500 uppercase">
            Tax Invoice (Original for Recipient)
          </div>
          <div className="mt-1 font-mono text-xl font-bold tracking-tight text-slate-900">
            {props.invoiceNumber}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:justify-end">
            <StatusPill label={statusLabel} tone={statusTone} />
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-zinc-700">
              SAC {props.sacCode}
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
                {isInterState
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
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold tracking-wide text-zinc-600 uppercase">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Description of Service</th>
              <th className="px-4 py-3 font-mono">SAC</th>
              <th className="px-4 py-3 text-right">Taxable Value</th>
              {isInterState ? (
                <th className="px-4 py-3 text-right">IGST (18%)</th>
              ) : (
                <>
                  <th className="px-4 py-3 text-right">CGST (9%)</th>
                  <th className="px-4 py-3 text-right">SGST (9%)</th>
                </>
              )}
              <th className="px-4 py-3 text-right">Total (INR)</th>
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
              <span>Taxable Subtotal</span>
              <span className="font-medium text-slate-900">
                {formatRupeeExact(props.subtotalPaise)}
              </span>
            </div>
            {isInterState ? (
              <div className="flex items-center justify-between text-zinc-600">
                <span>IGST @ 18%</span>
                <span className="font-medium text-slate-900">
                  {formatRupeeExact(props.igstPaise)}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>CGST @ 9%</span>
                  <span className="font-medium text-slate-900">
                    {formatRupeeExact(props.cgstPaise)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-zinc-600">
                  <span>SGST @ 9%</span>
                  <span className="font-medium text-slate-900">
                    {formatRupeeExact(props.sgstPaise)}
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2 text-zinc-600">
              <span>Total GST (18%)</span>
              <span className="font-medium text-slate-900">
                {formatRupeeExact(totalGstPaise)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 pt-2.5 text-sm font-bold text-slate-900">
              <span>Grand Total (INR)</span>
              <span className="text-base text-emerald-700">
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
            src="/logo-nobg.svg"
            alt="RapidShift Labs"
            width={18}
            height={18}
            draggable={false}
            style={{ width: 18, height: 18, flexShrink: 0 }}
            className="shrink-0 select-none object-contain opacity-85"
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
