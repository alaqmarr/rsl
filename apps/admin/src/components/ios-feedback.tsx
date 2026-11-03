"use client";

import React, { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { IosSpinner, PendingSubmitButton } from "@rsl/ui";

export { IosSpinner };

export function SubmitButton({
  children,
  pendingText,
  className = "adm-btn-primary",
  spinnerSize = "xs",
  disabled = false,
  iconOnly = false,
  name,
  value,
  title,
}: {
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
  const { pending } = useFormStatus();
  return (
    <PendingSubmitButton
      pending={pending}
      pendingText={pendingText}
      className={className}
      spinnerSize={spinnerSize}
      disabled={disabled}
      iconOnly={iconOnly}
      name={name}
      value={value}
      title={title}
    >
      {children}
    </PendingSubmitButton>
  );
}

export function ActionLink({
  href,
  children,
  className = "",
  spinnerSize = "xs",
  spinnerPosition = "left",
  variant,
  onClickDone,
  prefetch = true,
  title,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  spinnerSize?: "xs" | "sm";
  spinnerPosition?: "left" | "right";
  variant?: "inline" | "card";
  onClickDone?: () => void;
  prefetch?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const isInlineFlex = /\binline-flex\b/.test(className);
  const isCardLayout =
    variant === "card" ||
    (!isInlineFlex && /\b(block|flex|flex-col|grid|justify-between)\b/.test(className));

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      href.startsWith("http") ||
      href.startsWith("#") ||
      href.startsWith("/api/")
    ) {
      onClickDone?.();
      return;
    }

    const currentFull =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : pathname;
    if (href === currentFull) {
      e.preventDefault();
      onClickDone?.();
      return;
    }

    e.preventDefault();
    onClickDone?.();
    startTransition(() => {
      router.push(href);
    });
  };

  if (isCardLayout) {
    return (
      <Link
        href={href}
        prefetch={prefetch}
        title={title}
        onClick={handleClick}
        aria-busy={isPending}
        className={`relative ${className} ${isPending ? "opacity-85" : ""}`}
      >
        {children}
        {isPending && (
          <span
            style={{ width: 20, height: 20 }}
            className="pointer-events-none absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-emerald-600 shadow-xs ring-1 ring-zinc-200"
          >
            <IosSpinner size="xs" />
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      prefetch={prefetch}
      title={title}
      onClick={handleClick}
      aria-busy={isPending}
      className={`${isInlineFlex ? "" : "inline-flex items-center gap-1.5"} ${className} ${
        isPending ? "opacity-85" : ""
      }`.trim()}
    >
      {isPending && spinnerPosition === "left" && (
        <IosSpinner size={spinnerSize} className="shrink-0" />
      )}
      {children}
      {isPending && spinnerPosition === "right" && (
        <IosSpinner size={spinnerSize} className="shrink-0" />
      )}
    </Link>
  );
}

export function AdminCopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied!",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }
      }}
      className="adm-btn-secondary py-1 px-2.5 text-[11px]"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
