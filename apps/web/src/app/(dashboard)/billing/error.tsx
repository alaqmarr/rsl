"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function BillingError({
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
      sectionLabel="Plans, Prepaid Wallet & GST Invoices"
      fallbackHref="/"
      fallbackLabel="Back to Business Overview"
    />
  );
}
