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
  className = "rsl-btn-primary",
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

export function AutoSubmitSelect({
  name,
  defaultValue,
  children,
  className = "rsl-input",
  ariaLabel,
}: {
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="relative inline-flex w-full items-center">
      <select
        name={name}
        defaultValue={defaultValue}
        aria-label={ariaLabel}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`${className} ${pending ? "pr-8 opacity-80" : ""}`}
      >
        {children}
      </select>
      {pending && (
        <span className="pointer-events-none absolute right-2.5 inline-flex items-center text-emerald-600">
          <IosSpinner size="xs" />
        </span>
      )}
    </div>
  );
}
