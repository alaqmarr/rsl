"use client";

import React, { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { IosSpinner } from "@rsl/ui";

export function SubmitButton({
  children,
  pendingText,
  className = "rsl-btn-primary",
  spinnerSize = "xs",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  spinnerSize?: "xs" | "sm" | "md";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-1.5 ${className} disabled:cursor-wait disabled:opacity-75`}
    >
      {pending && <IosSpinner size={spinnerSize} />}
      {pending && pendingText ? <span>{pendingText}</span> : children}
    </button>
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
