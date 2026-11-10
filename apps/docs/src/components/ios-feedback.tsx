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
  variant,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  spinnerSize?: "xs" | "sm" | "md";
  variant?: "inline" | "card";
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
      href.startsWith("http")
    ) {
      return;
    }
    const targetPath = href.split("?")[0];
    if (targetPath === pathname && !href.includes("?")) return;
    e.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  };

  if (isCardLayout) {
    return (
      <Link
        href={href}
        prefetch
        onClick={handleClick}
        aria-busy={isPending}
        className={`relative ${className} ${isPending ? "opacity-85" : ""}`}
      >
        {children}
        {isPending && (
          <span
            className="pointer-events-none absolute top-3 right-3 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/95 text-emerald-700 shadow-xs ring-1 ring-zinc-200"
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
      prefetch
      onClick={handleClick}
      aria-busy={isPending}
      className={`${isInlineFlex ? "" : "inline-flex items-center gap-1.5"} ${className}`.trim()}
    >
      {isPending && <IosSpinner size={spinnerSize} className="shrink-0" />}
      {children}
    </Link>
  );
}
