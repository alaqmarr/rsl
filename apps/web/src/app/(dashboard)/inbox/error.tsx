"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorBoundaryCard
      error={error}
      reset={reset}
      sectionLabel="Shared Customer Inbox"
      fallbackHref="/"
      fallbackLabel="Back to Business Overview"
    />
  );
}
