"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function DashboardError({
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
      sectionLabel="Workspace Dashboard"
      fallbackHref="/"
      fallbackLabel="Back to Business Overview"
    />
  );
}
