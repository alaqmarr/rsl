"use client";

import { RouteErrorBoundaryCard } from "@/components/route-error-boundary";

export default function GlobalAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="rsl-ambient-canvas flex min-h-screen items-center justify-center p-6">
      <RouteErrorBoundaryCard
        error={error}
        reset={reset}
        sectionLabel="Application"
        fallbackHref="/"
        fallbackLabel="Return to Home"
      />
    </main>
  );
}
