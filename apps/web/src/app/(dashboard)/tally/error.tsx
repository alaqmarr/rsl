"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function TallyError({
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
      sectionLabel="Tally Prime & Bills"
      fallbackHref="/"
      fallbackLabel="Back to Business Overview"
    />
  );
}
