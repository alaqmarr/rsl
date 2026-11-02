import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN_ADMIN ||
    "https://3b6c7523594f9e4b9b1e83d24c5d4ef9@o4507276057247744.ingest.us.sentry.io/4512357186732032",
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 1.0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
