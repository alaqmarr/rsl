import React from "react";

export function GoogleGLogo({ className = "h-4 w-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.31c-.24-.72-.38-1.49-.38-2.31s.14-1.59.38-2.31V6.6H1.29C.47 8.23 0 10.06 0 12s.47 3.77 1.29 5.4l3.99-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.99 3.09c.95-2.85 3.6-4.94 6.72-4.94z"
      />
    </svg>
  );
}

export function ConnectToGoogleDriveButton({
  returnTo = "/backups",
  label = "Connect to Google Drive",
  purpose = "google_drive",
  variant = "primary",
  size = "md",
}: {
  returnTo?: string;
  label?: string;
  purpose?: "google_drive" | "google_business";
  variant?: "primary" | "white";
  size?: "sm" | "md";
}) {
  const href = `/api/oauth/google/start?purpose=${encodeURIComponent(purpose)}&returnTo=${encodeURIComponent(returnTo)}`;
  const sizeClasses = size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-4 py-2.5 text-[13px]";

  if (variant === "white") {
    return (
      <a
        href={href}
        className={`inline-flex shrink-0 items-center justify-center gap-2.5 rounded-xl border border-zinc-300 bg-white font-semibold text-slate-900 shadow-2xs transition hover:border-emerald-400 hover:bg-emerald-50/40 ${sizeClasses}`}
      >
        <GoogleGLogo className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </a>
    );
  }

  return (
    <a
      href={href}
      className={`rsl-btn-primary inline-flex shrink-0 items-center justify-center gap-2.5 font-semibold shadow-xs ${sizeClasses}`}
    >
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white p-0.5 shadow-2xs">
        <GoogleGLogo className="h-3.5 w-3.5" />
      </span>
      <span>{label}</span>
    </a>
  );
}
