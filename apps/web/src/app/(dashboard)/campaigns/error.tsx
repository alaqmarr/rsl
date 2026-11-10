"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function CampaignsError({
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
      sectionLabel="Ads & Social Posts"
      fallbackHref="/"
      fallbackLabel="Back to Business Overview"
    />
  );
}
